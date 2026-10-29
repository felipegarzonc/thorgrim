// Forgotten passwords: a player asks from the sign-in screen and gets an
// email with a link to choose a new password. The link works once and lasts
// an hour; only a hash of it is stored. The answer never says whether an
// email has an account. Without email set up (server/mail.ts) the player is
// told to ask an admin, who can still give a new password from the profile.

import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import type { Lang } from "../shared/i18n/index.ts";
import { accountsEnabled, listAccounts, setLoginPassword, type Account } from "./accounts.ts";
import { userPrefix } from "./context.ts";
import { langOf } from "./lang.ts";
import { UserError } from "./errors.ts";
import { escapeHtml, mailReady, sendMail } from "./mail.ts";
import { Collection } from "./store.ts";

interface PasswordReset {
  id: string; // sha256 of the token
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const resets = new Collection<PasswordReset>("password-resets", "settings/");
const TTL_MS = 60 * 60_000;
/** A link an admin sends may travel by WhatsApp and be opened later: a day. */
const ADMIN_TTL_MS = 24 * 60 * 60_000;
/** One email per account in this time, however often someone asks. */
const RESEND_MS = 5 * 60_000;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** A few requests per address per hour, on this server instance. */
const recent = new Map<string, number[]>();
function slowDown(ip: string) {
  const now = Date.now();
  const times = (recent.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (times.length >= 5) throw new UserError("Slow down a little: try again in a few minutes.", 429);
  recent.set(ip, [...times, now]);
}

function resetEmail(name: string, link: string, lang: Lang, byAdmin = false) {
  const es = lang === "es";
  const hello = es ? `¡Hola, ${name}!` : `Hello, ${name}!`;
  const lines = es
    ? [
        byAdmin ? "El administrador de tu club te envía un enlace para elegir una contraseña nueva de Thorgrim." : "Alguien (esperamos que tú) pidió una contraseña nueva para tu cuenta de Thorgrim.",
        `Elígela con este enlace (funciona una vez y dura ${byAdmin ? "un día" : "una hora"}):`,
        byAdmin ? "Hasta que la elijas, tu contraseña actual sigue funcionando." : "Si no fuiste tú, ignora este correo: tu contraseña no cambia.",
        "— Thorgrim",
      ]
    : [
        byAdmin ? "Your club admin sent you a link to choose a new Thorgrim password." : "Someone (we hope you) asked for a new password for your Thorgrim account.",
        `Choose it with this link (it works once and lasts ${byAdmin ? "a day" : "an hour"}):`,
        byAdmin ? "Until you choose it, your current password keeps working." : "If it wasn't you, ignore this email: your password stays as it is.",
        "— Thorgrim",
      ];
  const subject = es ? "Tu contraseña nueva de Thorgrim" : "Your new Thorgrim password";
  const button = es ? "Elegir contraseña" : "Choose a password";
  const text = [hello, "", lines[0], lines[1], link, "", lines[2], lines[3]].join("\n");
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:24px;background:#0f1115;color:#ece6da;border-radius:12px">
<p style="font-size:22px;letter-spacing:.14em;color:#d9ae55;margin:0 0 16px">THORGRIM</p>
<p>${escapeHtml(hello)}</p><p>${escapeHtml(lines[0])}</p><p>${escapeHtml(lines[1])}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#d9ae55;color:#1e1608;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">${escapeHtml(button)}</a></p>
<p style="font-size:13px;color:#a8a396;word-break:break-all">${escapeHtml(link)}</p>
<p style="font-style:italic">${escapeHtml(lines[2])}<br>${escapeHtml(lines[3])}</p></div>`;
  return { subject, text, html };
}

/**
 * Someone forgot their password: email that account a link, if it exists.
 * Answers the same either way; `mail: false` means email isn't set up here.
 */
export async function requestReset(rawEmail: unknown, lang: Lang, origin: string, ip: string): Promise<{ mail: boolean }> {
  if (!accountsEnabled()) throw new UserError("Accounts need Supabase. Use the app password.");
  if (!mailReady()) return { mail: false };
  const email = String(rawEmail ?? "").trim().toLowerCase().slice(0, 254);
  if (!email.includes("@")) throw new UserError("That email doesn't look right.");
  slowDown(ip);
  // In the background, so an email with an account takes no longer to answer than one without.
  waitUntil(sendLink(email, lang, origin).catch((e: Error) => console.error("Password reset email failed:", e)));
  return { mail: true };
}

async function sendLink(email: string, lang: Lang, origin: string) {
  const account = (await listAccounts()).find((a) => a.email.toLowerCase() === email && !a.disabled);
  if (!account) return;
  const now = Date.now();
  const all = await resets.list();
  // Expired links go; a link sent a moment ago isn't sent again.
  for (const r of all) if (Date.parse(r.expiresAt) < now) await resets.delete(r.id);
  if (all.some((r) => r.userId === account.id && now - Date.parse(r.createdAt) < RESEND_MS)) return;
  const token = await issue(account.id, TTL_MS);
  await sendMail({ to: account.email, ...resetEmail(account.name, `${origin}/#/reset/${token}`, lang) });
}

/** A new link for an account; only its hash is kept. */
async function issue(userId: string, ttlMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await resets.save({ id: hash(token), userId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() });
  return token;
}

/**
 * From the admin's profile: a link for a player to choose a new password,
 * emailed to them in their language when email is set up, and returned so
 * the admin can also send it themselves. Their current password keeps
 * working until they use it.
 */
export async function adminResetLink(account: Account, origin: string): Promise<{ link: string; emailed: boolean }> {
  if (account.disabled) throw new UserError("Switch the account on first.");
  const link = `${origin}/#/reset/${await issue(account.id, ADMIN_TTL_MS)}`;
  const lang = await langOf(userPrefix(account.id, !!account.owner)).catch((): Lang => "en");
  const emailed = mailReady() && (await sendMail({ to: account.email, ...resetEmail(account.name, link, lang, true) }));
  return { link, emailed };
}

async function find(token: unknown): Promise<PasswordReset | undefined> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const r = await resets.get(hash(token));
  return r && Date.parse(r.expiresAt) > Date.now() ? r : undefined;
}

export const resetValid = async (token: unknown) => !!(await find(token));

/** Set the new password with a link from the email. Returns the account's email, to sign in with. */
export async function finishReset(token: unknown, password: string): Promise<{ userId: string; email: string } | undefined> {
  const r = await find(token);
  if (!r) return undefined;
  const account = (await listAccounts()).find((a) => a.id === r.userId && !a.disabled);
  if (!account) return undefined;
  await setLoginPassword(account.id, password);
  // The link is used up, and so is any other one sent to this account.
  for (const other of await resets.list()) if (other.userId === account.id) await resets.delete(other.id);
  return { userId: account.id, email: account.email };
}
