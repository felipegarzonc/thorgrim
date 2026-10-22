// Private beta: visitors ask for access from the landing page; admins see the
// requests in their profile and approve or decline them. Approving makes an
// invite and emails its link to the person (server/mail.ts), in the language
// they asked in; without email set up, the admin gets the link to send.

import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import type { Lang } from "../shared/i18n/index.ts";
import { accountsEnabled, createInvite, listAccounts } from "./accounts.ts";
import { currentUser } from "./context.ts";
import { FeedError } from "./feed.ts";
import { escapeHtml, sendMail } from "./mail.ts";
import { notify } from "./notices.ts";
import { Collection } from "./store.ts";

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  club?: string;
  message?: string;
  lang: Lang;
  createdAt: string;
  status: "pending" | "approved" | "declined";
  decidedAt?: string;
  decidedBy?: string;
  /** Whether the invite went out by email (else the admin sends the link). */
  emailed?: boolean;
}

const requests = new Collection<AccessRequest>("access-requests", "");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MAX_PENDING = 300;

/** A few requests per address per hour, on this server instance. */
const recent = new Map<string, number[]>();
function slowDown(ip: string) {
  const now = Date.now();
  const times = (recent.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (times.length >= 5) throw new FeedError("Slow down a little: try again in a few minutes.", 429);
  recent.set(ip, [...times, now]);
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** A visitor asks for access. Always answers the same way, so it never tells whether an email is known. */
export async function requestAccess(b: Record<string, unknown>, ip: string): Promise<void> {
  if (!accountsEnabled()) throw new FeedError("Access requests need accounts (Supabase).");
  if (clean(b.website, 10)) return; // a field people don't see: only bots fill it
  const name = clean(b.name, 60);
  const email = clean(b.email, 254).toLowerCase();
  if (!name) throw new FeedError("Tell us your name.");
  if (!EMAIL.test(email)) throw new FeedError("That email doesn't look right.");
  slowDown(ip);
  const all = await requests.list();
  if (all.some((r) => r.status === "pending" && r.email === email)) return;
  if ((await listAccounts()).some((a) => a.email.toLowerCase() === email)) return;
  if (all.filter((r) => r.status === "pending").length >= MAX_PENDING) throw new FeedError("Slow down a little: try again in a few minutes.", 429);
  const r: AccessRequest = {
    id: crypto.randomBytes(6).toString("hex"),
    name,
    email,
    club: clean(b.club, 80) || undefined,
    message: String(b.message ?? "").trim().slice(0, 500) || undefined,
    lang: b.lang === "es" ? "es" : "en",
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await requests.save(r);
  const admins = (await listAccounts()).filter((a) => a.role === "admin" && !a.disabled).map((a) => a.id);
  waitUntil(notify(admins, `New access request: ${name}${r.club ? ` (${r.club})` : ""}.`, "#/profile").catch(() => undefined));
}

/** For admins: pending requests first, then the ones decided in the last month. */
export async function listRequests(): Promise<AccessRequest[]> {
  const month = new Date(Date.now() - 30 * 86400_000).toISOString();
  return (await requests.list())
    .filter((r) => r.status === "pending" || (r.decidedAt ?? "") > month)
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt));
}

async function load(id: string) {
  const r = await requests.get(id);
  if (!r) throw new FeedError("That request was removed.", 404);
  return r;
}

function inviteEmail(r: AccessRequest, link: string) {
  const es = r.lang === "es";
  const hello = es ? `¡Hola, ${r.name}!` : `Hello, ${r.name}!`;
  const lines = es
    ? ["Tu solicitud de acceso a Thorgrim ha sido aprobada.", "Crea tu cuenta con este enlace (funciona una vez y dura 14 días):", link, "Los dados esperan, comandante. Y yo también.", "— Thorgrim"]
    : ["Your request to join Thorgrim was approved.", "Create your account with this link (it works once and lasts 14 days):", link, "The dice are waiting, commander. So am I.", "— Thorgrim"];
  const subject = es ? "Tu acceso a Thorgrim está listo" : "Your Thorgrim access is ready";
  const text = [hello, "", lines[0], lines[1], lines[2], "", lines[3], lines[4]].join("\n");
  const button = es ? "Crear mi cuenta" : "Create my account";
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:24px;background:#0f1115;color:#ece6da;border-radius:12px">
<p style="font-size:22px;letter-spacing:.14em;color:#d9ae55;margin:0 0 16px">THORGRIM</p>
<p>${escapeHtml(hello)}</p><p>${escapeHtml(lines[0])}</p><p>${escapeHtml(lines[1])}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#d9ae55;color:#1e1608;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">${escapeHtml(button)}</a></p>
<p style="font-size:13px;color:#a8a396;word-break:break-all">${escapeHtml(link)}</p>
<p style="font-style:italic">${escapeHtml(lines[3])}<br>${escapeHtml(lines[4])}</p></div>`;
  return { subject, text, html };
}

/** Approve: an invite for them, emailed when email is set up. Returns the link for the admin. */
export async function approve(id: string, origin: string): Promise<{ request: AccessRequest; link: string; email: { subject: string; text: string } }> {
  const r = await load(id);
  if (r.status !== "pending") throw new FeedError("This request was already answered.");
  const { token } = await createInvite(`${r.name}${r.club ? ` · ${r.club}` : ""}`, "player");
  // Through the invite's preview page (web/public/join.html), in their language.
  const link = `${origin}/${r.lang === "es" ? "es/" : ""}join/${token}`;
  const mail = inviteEmail(r, link);
  const emailed = await sendMail({ to: r.email, ...mail });
  const done = await requests.save({ ...r, status: "approved", decidedAt: new Date().toISOString(), decidedBy: currentUser().name || currentUser().id, emailed });
  return { request: done, link, email: { subject: mail.subject, text: mail.text } };
}

export async function decline(id: string): Promise<AccessRequest> {
  const r = await load(id);
  if (r.status !== "pending") return r;
  return requests.save({ ...r, status: "declined", decidedAt: new Date().toISOString(), decidedBy: currentUser().name || currentUser().id });
}
