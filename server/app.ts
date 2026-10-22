// The Thorgrim web server (API + built web app). Used three ways:
//   - on your computer and in Docker: server/index.ts starts it on a port;
//   - on Vercel: api/index.mjs hands each request to it.

import "./env.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { castChance, chargeChance, damageBySave, expectedDamage, simulate, type AttackProfile, type TargetProfile } from "../engine/dice.ts";
import type { Op } from "../shared/patch.ts";
import type { ArmyList, FeedPost, Game, GameState, LibraryDoc } from "../shared/types.ts";
import { hasCredentials, loadSavedApiKey, saveApiKey } from "./anthropic.ts";
import { blobs } from "./blobs.ts";
import { askCoach, battleReport, conversations, gamePlan, PROMPTS, resetConversation, turnTips, voiceScore } from "./coach.ts";
import { addComment, deleteComment, deletePost, feed, FeedError, getPost, markFeedSeen, postView, publicPost, publishReport, react, readPostPhoto, sharePost, syncPost, unread, unsharePost } from "./feed.ts";
import { markNoticesRead, myNotices, notify } from "./notices.ts";
import { publicKey, pushTo, subscribe, unsubscribe } from "./push.ts";
import { gameData, listRules, warscrollText } from "./data.ts";
import {
  accountSettings,
  accountsEnabled,
  AuthError,
  checkBudget,
  createInvite,
  createLogin,
  findInvite,
  limitFor,
  listAccounts,
  listInvites,
  publicAccount,
  refreshSession,
  saveAccounts,
  saveAccountSettings,
  saveInvites,
  setLoginPassword,
  signIn,
  updateAccount,
  usageOf,
  userIdFromToken,
  type Account,
  type Session,
} from "./accounts.ts";
import { currentUser, LOCAL_USER, runAs, userPrefix, type UserCtx } from "./context.ts";
import { jobs, startJob } from "./jobs.ts";
import { addDocument, deleteDocument, docPath, finishUpload, libraryDocs, listDocuments, searchLibrary, startUpload } from "./library.ts";
import { parseList } from "./listParser.ts";
import { bothConfirmed, changeGame, confirmResult, forgetShares, gameLists, joinGame, ladderSides, leaveGame, myGames, openGame, shareGame, stopSharing, viewGame, type OpenGame } from "./sharedGames.ts";
import { forgetResult, ladder, listResults, syncResult } from "./ladder.ts";
import { Collection, newId } from "./store.ts";
import { backgroundJobs, resumePendingTranscriptions, transcribeDocument, transcribeStep } from "./transcribe.ts";

const lists = new Collection<ArmyList>("lists");
const games = new Collection<Game>("games");

const app = express();
export default app;

app.set("trust proxy", 1); // behind the host's HTTPS proxy when deployed
app.use(express.json({ limit: "4mb" }));

// Browser safety: no sniffing types, no framing by other sites, no full URLs leaking to other sites.
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  next();
});

// Health check for the hosting platform (no data, no auth).
app.get(["/healthz", "/api/healthz"], (_req, res) => res.json({ ok: true }));

// ---------- who is it ----------
// Online, people sign in with their account (invite-only, email + password).
// The app password (APP_ACCESS_KEY) still works as the owner's master key,
// and is needed once to create the first admin account. On your own
// computer without Supabase there are no accounts: one local user.

const accessKey = process.env.APP_ACCESS_KEY ?? "";
const isPublic = process.env.PUBLIC === "1" || Boolean(process.env.VERCEL);
const missingPassword = isPublic && accessKey.length < 8;
if (missingPassword) console.error("APP_ACCESS_KEY (8+ characters) is not set: the app stays locked until it is.");

const sameKey = (given: unknown) => {
  if (typeof given !== "string" || !accessKey) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(accessKey).digest();
  return crypto.timingSafeEqual(a, b);
};

// Slow down password guessing: 20 wrong tries per address per 15 minutes.
const failures = new Map<string, { count: number; since: number }>();
const tooMany = (req: Request) => {
  const ip = req.ip ?? "?";
  const f = failures.get(ip);
  if (f && Date.now() - f.since > 15 * 60_000) failures.delete(ip);
  return (failures.get(ip)?.count ?? 0) >= 20;
};
const failed = (req: Request) => {
  const ip = req.ip ?? "?";
  const cur = failures.get(ip) ?? { count: 0, since: Date.now() };
  failures.set(ip, { ...cur, count: cur.count + 1 });
};

async function ownerCtx(): Promise<UserCtx> {
  const owner = accountsEnabled() ? (await listAccounts()).find((a) => a.owner) : undefined;
  return { id: owner?.id ?? "owner", name: owner?.name ?? "", isAdmin: true, prefix: "", developer: true };
}
async function accountCtx(userId: string): Promise<UserCtx> {
  const acc = (await listAccounts()).find((a) => a.id === userId);
  if (!acc) throw new AuthError("This account isn't on the app's player list. Ask the admin for an invite.", 403);
  if (acc.disabled) throw new AuthError("This account is switched off. Ask the admin.", 403);
  return { id: acc.id, name: acc.name, isAdmin: acc.role === "admin", prefix: userPrefix(acc.id, !!acc.owner) };
}

// ---------- photo pass ----------
// Images and files are loaded by the browser from plain links, which can end
// up in history and logs. They carry a short-lived pass that only opens
// photos and files, never the sign-in itself (no session token or app
// password in a link).
const MEDIA_TTL_MS = 24 * 3600_000;
const MEDIA_ROUTE = /^\/(games\/[a-z0-9-]+\/photo|feed\/[a-z0-9-]+\/photo\/\d+|library\/[a-z0-9-]+\/file)$/i;
const mediaSig = (body: string) => crypto.createHmac("sha256", `thorgrim-media:${accessKey || "local"}`).update(body).digest("base64url");
export function mediaToken(userId: string): string {
  const body = `${userId}.${Date.now() + MEDIA_TTL_MS}`;
  return `${Buffer.from(body).toString("base64url")}.${mediaSig(body)}`;
}
/** The user a photo pass was made for, if it is genuine and not expired. */
export function readMediaToken(token: string): string | undefined {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return undefined;
  const body = Buffer.from(b64, "base64url").toString();
  const want = Buffer.from(mediaSig(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return undefined;
  const dot = body.lastIndexOf(".");
  return Number(body.slice(dot + 1)) > Date.now() ? body.slice(0, dot) : undefined;
}

app.use("/api", async (req, res, next) => {
  if (missingPassword) return res.status(503).json({ error: "Set APP_ACCESS_KEY (the app password, 8+ characters) in the hosting settings, then redeploy." });
  if (req.path.startsWith("/auth/")) return next(); // sign-in routes check for themselves
  if (req.path.startsWith("/public/")) return next(); // shared battle reports: anyone with the link
  if (tooMany(req)) return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
  try {
    const master = req.get("x-access-key");
    const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const media = req.method === "GET" && MEDIA_ROUTE.test(req.path) && typeof req.query.m === "string" ? readMediaToken(req.query.m) : undefined;
    let user: UserCtx | null = null;
    if (master && sameKey(master)) user = await ownerCtx();
    else if (bearer && accountsEnabled()) user = await accountCtx(await userIdFromToken(bearer).catch(() => Promise.reject(new AuthError("Your session ended. Sign in again."))));
    else if (media) user = accountsEnabled() && media !== "owner" ? await accountCtx(media) : await ownerCtx();
    else if (!accessKey && !isPublic) user = LOCAL_USER;
    if (!user) {
      if (master) failed(req);
      return res.status(401).json({ error: "Sign in required", needsLogin: true });
    }
    runAs(user, () => next());
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message, needsLogin: e.status === 401 });
    next(e);
  }
});

// The rules library is managed by the developers only: with the app password
// (scripts/library.ts uses it) or on your own computer. Players just read it.
const requireDeveloper = (_req: Request, res: Response, next: NextFunction) =>
  currentUser().developer ? next() : res.status(403).json({ error: "The rules library is managed by the Thorgrim team." });

const requireAdmin = (_req: Request, res: Response, next: NextFunction) =>
  currentUser().isAdmin ? next() : res.status(403).json({ error: "Only the admin can do that." });

// ---------- sign in, invites ----------

app.get("/api/auth/status", async (_req, res) => {
  const enabled = accountsEnabled();
  res.json({ accounts: enabled, setupNeeded: enabled && !(await listAccounts()).length, password: !!accessKey });
});

const signedIn = async (userId: string, session: Session) => {
  const acc = (await listAccounts()).find((a) => a.id === userId);
  if (!acc) throw new AuthError("This account isn't on the app's player list. Ask the admin for an invite.", 403);
  if (acc.disabled) throw new AuthError("This account is switched off. Ask the admin.", 403);
  return { session, user: publicAccount(acc) };
};

app.post("/api/auth/login", async (req, res) => {
  if (!accountsEnabled()) return res.status(400).json({ error: "Accounts need Supabase. Use the app password." });
  if (tooMany(req)) return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
  try {
    const { session, userId } = await signIn(String(req.body.email ?? ""), String(req.body.password ?? ""));
    res.json(await signedIn(userId, session));
  } catch (e) {
    if (e instanceof AuthError && e.status === 400) failed(req);
    throw e;
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  const { session, userId } = await refreshSession(String(req.body.refresh_token ?? "")).catch(() => {
    throw new AuthError("Your session ended. Sign in again.");
  });
  res.json(await signedIn(userId, session));
});

// The very first account: needs the app password, becomes the admin and owns the existing data.
app.post("/api/auth/setup", async (req, res) => {
  if (!accountsEnabled()) return res.status(400).json({ error: "Accounts need Supabase storage." });
  if (tooMany(req)) return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
  if (!sameKey(req.body.accessKey)) {
    failed(req);
    return res.status(401).json({ error: "Wrong app password." });
  }
  if ((await listAccounts()).length) return res.status(409).json({ error: "The admin account already exists. Sign in." });
  const name = String(req.body.name ?? "").trim() || "Admin";
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const id = await createLogin(email, String(req.body.password ?? ""), name);
  await saveAccounts([{ id, email, name, role: "admin", owner: true, monthlyLimitUsd: null, createdAt: new Date().toISOString() }]);
  const { session } = await signIn(email, String(req.body.password ?? ""));
  res.json(await signedIn(id, session));
});

app.get("/api/auth/invite/:token", async (req, res) => {
  const inv = await findInvite(param(req, "token"));
  res.json(inv ? { valid: true, note: inv.note } : { valid: false });
});

app.post("/api/auth/join", async (req, res) => {
  if (tooMany(req)) return res.status(429).json({ error: "Too many tries. Try again in 15 minutes." });
  const inv = await findInvite(String(req.body.token ?? ""));
  if (!inv) {
    failed(req);
    return res.status(400).json({ error: "This invite link is not valid any more. Ask the admin for a new one." });
  }
  const name = String(req.body.name ?? "").trim();
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  if (!name) return res.status(400).json({ error: "Tell us your name (it shows on your games)." });
  const id = await createLogin(email, password, name);
  await saveAccounts([...(await listAccounts()), { id, email, name, role: inv.role, createdAt: new Date().toISOString() }]);
  await saveInvites((await listInvites()).map((i) => (i.id === inv.id ? { ...i, usedBy: id, usedAt: new Date().toISOString() } : i)));
  const { session } = await signIn(email, password);
  res.json(await signedIn(id, session));
});

// ---------- me ----------

app.get("/api/me", async (_req, res) => {
  const u = currentUser();
  const acc = accountsEnabled() ? (await listAccounts()).find((a) => a.id === u.id) : undefined;
  res.json({
    user: acc ? publicAccount(acc) : { id: u.id, name: u.name, email: "", role: "admin", owner: true },
    accounts: accountsEnabled(),
    usage: { month: new Date().toISOString().slice(0, 7), ...(await usageOf(u.id)), limitUsd: await limitFor(u.id) },
  });
});
app.patch("/api/me", async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name can't be empty." });
  res.json(publicAccount(await updateAccount(currentUser().id, { name })));
});
app.post("/api/me/password", async (req, res) => {
  if (!accountsEnabled()) return res.status(400).json({ error: "No accounts on this app." });
  await setLoginPassword(currentUser().id, String(req.body.password ?? ""));
  res.json({ ok: true });
});

// ---------- admin: players, invites, limits ----------

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const accounts = await listAccounts();
  res.json(
    await Promise.all(accounts.map(async (a) => ({ ...publicAccount(a), disabled: !!a.disabled, createdAt: a.createdAt, monthlyLimitUsd: a.monthlyLimitUsd, limitUsd: await limitFor(a.id), usage: await usageOf(a.id) }))),
  );
});
app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const b = req.body as { monthlyLimitUsd?: number | null | "default"; disabled?: boolean; role?: "admin" | "player"; name?: string };
  const target = (await listAccounts()).find((a) => a.id === param(req, "id"));
  if (!target) return res.status(404).json({ error: "No such player" });
  if (target.owner && (b.disabled || b.role === "player")) return res.status(400).json({ error: "The owner account stays an active admin." });
  const patch: Partial<Account> = {};
  if ("monthlyLimitUsd" in b)
    patch.monthlyLimitUsd = b.monthlyLimitUsd === "default" ? undefined : b.monthlyLimitUsd === null ? null : Math.max(0, Number(b.monthlyLimitUsd) || 0);
  if (typeof b.disabled === "boolean") patch.disabled = b.disabled;
  if (b.role === "admin" || b.role === "player") patch.role = b.role;
  if (b.name?.trim()) patch.name = b.name.trim();
  res.json(publicAccount(await updateAccount(target.id, patch)));
});
// A new temporary password, shown once to the admin to pass on.
app.post("/api/admin/users/:id/password", requireAdmin, async (req, res) => {
  const password = crypto.randomBytes(9).toString("base64url");
  await setLoginPassword(param(req, "id"), password);
  res.json({ password });
});
app.get("/api/admin/invites", requireAdmin, async (_req, res) => {
  const now = new Date().toISOString();
  res.json((await listInvites()).filter((i) => !i.usedBy && i.expiresAt > now).map(({ tokenHash: _t, ...i }) => i));
});
app.post("/api/admin/invites", requireAdmin, async (req, res) => {
  if (!accountsEnabled()) return res.status(400).json({ error: "Invites need accounts (Supabase)." });
  const { invite, token } = await createInvite(String(req.body.note ?? ""), req.body.role === "admin" ? "admin" : "player");
  const { tokenHash: _t, ...rest } = invite;
  res.json({ invite: rest, token });
});
app.delete("/api/admin/invites/:id", requireAdmin, async (req, res) => {
  await saveInvites((await listInvites()).filter((i) => i.id !== param(req, "id")));
  res.json({ ok: true });
});
app.get("/api/admin/settings", requireAdmin, async (_req, res) => res.json(await accountSettings()));
app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const defaultLimitUsd = Math.max(0, Number(req.body.defaultLimitUsd) || 0);
  await saveAccountSettings({ defaultLimitUsd });
  res.json({ defaultLimitUsd });
});

// A Claude key pasted in the app online is kept in storage; pick it up.
app.use("/api", async (_req, _res, next) => {
  await loadSavedApiKey().catch((e) => console.error("Could not read saved settings:", e));
  next();
});

const param = (req: Request, name: string) => String(req.params[name]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });
const newestFirst = <T extends { createdAt: string }>(xs: T[]) => xs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ---------- army data ----------

app.get("/api/media-token", (_req, res) => res.json({ media: mediaToken(currentUser().id) }));
// Which build is live: open pages compare it with the one they loaded and offer a reload.
app.get("/api/version", (_req, res) => res.json({ builtAt: gameData().builtAt }));
app.get("/api/meta", (_req, res) => {
  const d = gameData();
  const u = currentUser();
  res.json({
    user: { id: u.id, name: u.name, isAdmin: u.isAdmin, developer: !!u.developer },
    media: mediaToken(u.id),
    accounts: accountsEnabled(),
    source: d.source,
    commit: d.commit,
    builtAt: d.builtAt,
    factions: Object.keys(d.factions).sort(),
    battleTactics: d.core.filter((r) => r.ability.kind === "Battle Tactic Card").map((r) => ({ name: r.ability.name, ...r.ability.extra })),
    coachReady: hasCredentials(),
    backgroundJobs: backgroundJobs(),
    storage: blobs().kind,
  });
});

// Paste the Claude API key from the app instead of editing files by hand.
// Only from the computer running it, or with the password when online.
app.post("/api/settings/api-key", async (req, res) => {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") && !isPublic;
  const allowed = isPublic || accessKey ? currentUser().isAdmin : local;
  if (!allowed) return res.status(403).json({ error: isPublic ? "Only the admin can set the Claude API key." : "Set the API key from the computer running the app." });
  const key = String(req.body.key ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return res.status(400).json({ error: "That doesn't look like a Claude API key (it starts with sk-ant-)." });
  await saveApiKey(key);
  await resumePendingTranscriptions();
  res.json({ ok: true });
});

app.get("/api/factions/:name", (req, res) => {
  const d = gameData();
  const f = d.factions[param(req, "name")];
  if (!f) return res.status(404).json({ error: "Unknown faction" });
  res.json({ ...f, units: f.units.map((u) => ({ ...u, unit: d.units[u.id] })) });
});

app.get("/api/units/:id", (req, res) => {
  const u = gameData().units[param(req, "id")];
  if (!u) return res.status(404).json({ error: "Unknown unit" });
  res.json({ ...u, text: warscrollText(u) });
});

// ---------- lists ----------

// Lists saved with lines the reader didn't know are read again (the reader
// improves over time); kept when that recognises more.
async function refreshList(l: ArmyList): Promise<ArmyList> {
  const missingFormation = !l.formation && l.rawText?.includes("|");
  if ((!l.unmatched?.length && !missingFormation) || !l.rawText) return l;
  const again = parseList(l.rawText, l.faction || undefined);
  if (again.unmatched.length > (l.unmatched?.length ?? 0) || (again.unmatched.length === (l.unmatched?.length ?? 0) && !(missingFormation && again.formation))) return l;
  return lists.save({ ...l, ...again, tacticCards: again.tacticCards?.length ? again.tacticCards : l.tacticCards });
}
app.get("/api/lists", async (_req, res) => res.json(newestFirst(await Promise.all((await lists.list()).map(refreshList)))));
app.get("/api/lists/:id", async (req, res) => {
  const l = await lists.get(param(req, "id"));
  return l ? res.json(await refreshList(l)) : res.status(404).json({ error: "Not found" });
});
app.post("/api/lists/parse", (req, res) => res.json(parseList(String(req.body.text ?? ""), req.body.faction)));
app.post("/api/lists", async (req, res) => {
  const body = req.body as Partial<ArmyList>;
  const parsed = body.units ? { faction: body.faction ?? "", units: body.units, unmatched: body.unmatched ?? [] } : parseList(body.rawText ?? "", body.faction);
  const list: ArmyList = {
    id: body.id ?? newId(),
    name: body.name || "Untitled list",
    owner: body.owner === "opponent" ? "opponent" : "me",
    rawText: body.rawText ?? "",
    createdAt: body.createdAt ?? new Date().toISOString(),
    ...parsed,
  };
  res.json(await lists.save(list));
});
app.delete("/api/lists/:id", async (req, res) => {
  await lists.delete(param(req, "id"));
  res.json({ ok: true });
});

// ---------- library ----------

const startReading = async (doc: LibraryDoc) => {
  if (doc.transcription && hasCredentials() && backgroundJobs()) void transcribeDocument(doc.id);
};

app.get("/api/library", async (_req, res) => res.json(newestFirst(await listDocuments()).map((d) => ({ ...d, canEdit: !!currentUser().developer }))));

// Upload in one request (used for small files and by older clients).
app.post("/api/library", upload.single("file"), requireDeveloper, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const doc = await addDocument({
    title: String(req.body.title ?? ""),
    category: (req.body.category ?? "other") as LibraryDoc["category"],
    filename: req.file.originalname,
    mime: req.file.mimetype,
    buffer: req.file.buffer,
  });
  await startReading(doc);
  res.json(doc);
});

// Direct upload in three steps, so big books work online:
// 1) reserve the document and get where to send the file,
// 2) the browser sends the file there (storage, or /raw below locally),
// 3) finish: the server reads the file and indexes it.
app.post("/api/library/uploads", requireDeveloper, async (req, res) => {
  const b = req.body as { title?: string; category?: LibraryDoc["category"]; filename?: string; mime?: string };
  if (!b.filename) return res.status(400).json({ error: "Missing file name" });
  const { doc, target } = await startUpload(
    { title: b.title ?? "", category: b.category ?? "other", filename: b.filename, mime: b.mime ?? "application/octet-stream" },
    (id) => `/api/library/${id}/raw`,
  );
  res.json({ doc, target });
});
app.put("/api/library/:id/raw", requireDeveloper, express.raw({ type: () => true, limit: "150mb" }), async (req, res) => {
  const doc = await libraryDocs.get(param(req, "id"));
  if (!doc?.uploading) return res.status(404).json({ error: "No upload in progress for this document" });
  if (blobs().kind !== "file") return res.status(400).json({ error: "Upload straight to storage instead" });
  await blobs().write(docPath(doc), req.body as Buffer, doc.mime);
  res.json({ ok: true });
});
app.post("/api/library/:id/finish", requireDeveloper, async (req, res) => {
  const doc = await finishUpload(param(req, "id"));
  await startReading(doc);
  res.json(doc);
});

// Read photographed/scanned pages: in the background on your computer; online
// one batch per call (the Rules page keeps calling while it's open).
app.post("/api/library/:id/transcribe", requireDeveloper, async (req, res) => {
  const doc = await libraryDocs.get(param(req, "id"));
  if (!doc?.transcription) return res.status(404).json({ error: "Nothing to transcribe" });
  if (!hasCredentials()) return res.status(503).json({ error: "Reading scanned pages needs your Claude API key (paste it on the Ask page)." });
  if (backgroundJobs()) {
    void transcribeDocument(doc.id);
    return res.json({ ok: true, transcription: doc.transcription });
  }
  res.json({ ok: true, transcription: await transcribeStep(doc.id) });
});
app.post("/api/library/text", requireDeveloper, async (req, res) => {
  const doc = await addDocument({
    title: String(req.body.title ?? "Notes"),
    category: (req.body.category ?? "other") as LibraryDoc["category"],
    filename: "notes.txt",
    mime: "text/plain",
    buffer: Buffer.from(String(req.body.text ?? ""), "utf8"),
  });
  res.json(doc);
});
app.get("/api/library/search", async (req, res) => res.json(await searchLibrary(String(req.query.q ?? ""), 10)));
app.get("/api/library/:id/file", async (req, res) => {
  const doc = await libraryDocs.get(param(req, "id"));
  if (!doc) return res.status(404).end();
  const link = await blobs().downloadUrl(docPath(doc));
  if (link) return res.redirect(link);
  const data = await blobs().read(docPath(doc));
  if (!data) return res.status(404).end();
  res.type(doc.mime).send(data);
});
app.delete("/api/library/:id", requireDeveloper, async (req, res) => {
  await deleteDocument(param(req, "id"));
  res.json({ ok: true });
});

// ---------- games ----------

const tacticsFrom = (list?: ArmyList) =>
  (list?.tacticCards ?? []).slice(0, 2).map((card) => ({ card, affray: false, strike: false, domination: false }));

function newState(attacker: GameState["attacker"]): GameState {
  return {
    round: 1,
    attacker,
    firstThisRound: attacker,
    activePlayer: attacker,
    phase: "Deployment",
    cp: { me: 0, opponent: 0 },
    vp: { me: 0, opponent: 0 },
    fury: { me: attacker === "me" ? 1 : 2, opponent: attacker === "opponent" ? 1 : 2 },
    rage: { me: 0, opponent: 0 },
    tactics: [],
    opponentTactics: [],
    underdog: null,
    seizedInitiative: null,
    units: {},
    objectives: "",
    notes: "",
  };
}

// A game is the signed-in player's own or one they joined (server/sharedGames.ts).
const openOr404 = async (req: Request, res: Response) => {
  const o = await openGame(param(req, "id"));
  if (!o) res.status(404).json({ error: "Game not found" });
  return o;
};
const opsFrom = (body: unknown): Op[] => {
  const ops = (body as { ops?: unknown })?.ops;
  return Array.isArray(ops) ? (ops.slice(0, 2000) as Op[]) : [];
};

// Save a change to a game; its club post, if it has one, follows.
const change = async (o: OpenGame, ops: Op[]) => {
  const next = await changeGame(o, ops);
  await syncPost(next).catch((e: Error) => console.error(`Updating the club post of game ${o.game.id} failed:`, e));
  await syncResult(next).catch((e: Error) => console.error(`Updating the ladder for game ${o.game.id} failed:`, e));
  return next;
};

app.get("/api/games", async (_req, res) => res.json(newestFirst(await myGames())));
app.get("/api/games/:id", async (req, res) => {
  const o = await openOr404(req, res);
  if (o) res.json(viewGame(o));
});
// The game's two lists (and their rules), wherever each player keeps theirs.
app.get("/api/games/:id/lists", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  const found = (await gameLists(o)).filter((l): l is ArmyList => !!l);
  res.json(found.map((list) => ({ list, rules: listRules(list) })));
});
app.post("/api/games", async (req, res) => {
  const b = req.body as Partial<Game> & { attacker?: GameState["attacker"] };
  const [mine, theirs] = await Promise.all([lists.get(b.myListId ?? ""), lists.get(b.opponentListId ?? "")]);
  const last = newestFirst(await games.list())[0];
  const game: Game = {
    id: newId(),
    name: b.name || "",
    myName: b.myName ?? (last?.myName || currentUser().name),
    opponentName: b.opponentName ?? "",
    date: b.date ?? new Date().toISOString().slice(0, 10),
    points: b.points ?? 2000,
    myListId: b.myListId ?? "",
    opponentListId: b.opponentListId ?? "",
    battleplan: b.battleplan ?? "",
    battleplanNotes: b.battleplanNotes ?? "",
    references: b.references ?? [],
    state: { ...newState(b.attacker ?? "me"), tactics: tacticsFrom(mine), opponentTactics: tacticsFrom(theirs), rounds: [] },
    log: [],
    createdAt: new Date().toISOString(),
  };
  res.json(await games.save(game));
});
// Changes as small edits on the player's own view, applied to the latest game.
app.patch("/api/games/:id", async (req, res) => {
  const o = await openOr404(req, res);
  if (o) res.json(viewGame(await change(o, opsFrom(req.body))));
});
// Playing together: the creator makes a join link, opponents with an account open it.
app.post("/api/games/:id/share", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  if (o.role !== "owner") return res.status(403).json({ error: "Only the player who created the game can share it." });
  res.json(viewGame(await shareGame(o)));
});
app.delete("/api/games/:id/share", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  if (o.role !== "owner") return res.status(403).json({ error: "Only the player who created the game can stop sharing it." });
  res.json(viewGame(await stopSharing(o)));
});
// The club ladder: both players confirm a shared game's final result.
app.post("/api/games/:id/confirm", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  let next: OpenGame;
  try {
    next = await confirmResult(o);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  await syncResult(next);
  const { ownerId, playerId } = ladderSides(next);
  const other = currentUser().id === ownerId ? playerId : ownerId;
  if (other && !bothConfirmed(next)) await notify([other], `${currentUser().name || "Your opponent"} confirmed the result of your game: confirm it too so it counts on the club ladder.`, `#/games/${next.game.id}/results`);
  res.json(viewGame(next));
});
app.get("/api/club/ladder", async (_req, res) => res.json(await ladder()));
app.post("/api/games/join", async (req, res) => {
  try {
    res.json({ id: await joinGame(String(req.body?.token ?? "")) });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});
// The creator deletes the game; a player who joined just leaves it.
app.delete("/api/games/:id", async (req, res) => {
  const id = param(req, "id");
  const o = await openGame(id);
  await resetConversation(id);
  if (o?.role === "player") {
    await leaveGame(o);
    return res.json({ ok: true });
  }
  if (o) await forgetShares(o);
  await forgetResult(id);
  await games.delete(id);
  const photos = `${currentUser().prefix}game-photos/${id}`;
  for (const name of await blobs().list(photos)) await blobs().remove(`${photos}/${name}`);
  res.json({ ok: true });
});

// ---------- coach ----------

app.get("/api/coach/:id", async (req, res) => res.json((await conversations.get(param(req, "id")))?.transcript ?? []));
app.delete("/api/coach/:id", async (req, res) => {
  await resetConversation(param(req, "id"));
  res.json({ ok: true });
});
// The coach's plan for one turn. The page stores it in the game state.
app.post("/api/games/:id/tips", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  const game = viewGame(o);
  const side = req.body.side === "opponent" ? "opponent" : "me";
  const round = Number(req.body.round) || game.state.round;
  const [myList, opponentList] = await gameLists(o);
  const event = req.body.event ? { text: String(req.body.event).slice(0, 2000), phase: String(req.body.phase ?? game.state.phase), previous: req.body.previous } : undefined;
  await checkBudget();
  res.json({ job: await startJob("tips", () => turnTips({ game, myList, opponentList }, round, side, event)) });
});
// The coach's strategy for the game. The page stores it with the game.
app.post("/api/games/:id/plan", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  const game = viewGame(o);
  const [myList, opponentList] = await gameLists(o);
  await checkBudget();
  const replan = !!req.body?.replan;
  res.json({ job: await startJob("plan", () => gamePlan({ game, myList, opponentList }, { replan })) });
});
// The coach's story of the game, from its recorded facts and photos. The page stores it with the game.
app.post("/api/games/:id/report", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  const game = viewGame(o);
  const [myList, opponentList] = await gameLists(o);
  await checkBudget();
  res.json({ job: await startJob("report", () => battleReport({ game, myList, opponentList }, game.report?.photos ?? [])) });
});
// Scoring by voice: what the player said, as changes for them to check (shared/voice.ts).
app.post("/api/games/:id/voice", async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  const round = Number(req.body?.round);
  const said = String(req.body?.text ?? "").trim();
  if (!Number.isInteger(round) || round < 1 || round > 5 || !said) return res.status(400).json({ error: "Say what was scored." });
  res.json(await voiceScore(viewGame(o), round, said));
});
// Poll a background coach request (see server/jobs.ts).
app.get("/api/jobs/:id", async (req, res) => {
  const job = await jobs.get(param(req, "id"));
  if (!job) return res.status(404).json({ error: "That coach request was not found." });
  res.json(job);
});
// A photo of the table (the page shrinks it first). The page stores the path in the game.
app.post("/api/games/:id/photo", express.raw({ type: "image/*", limit: "8mb" }), async (req, res) => {
  const o = await openOr404(req, res);
  if (!o) return;
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: "No photo received" });
  // Kept with the game, so both players of a shared game see it.
  const path = `${o.prefix}game-photos/${o.game.id}/${Date.now()}.jpg`;
  await blobs().write(path, body, "image/jpeg");
  res.json({ path });
});
app.get("/api/games/:id/photo", async (req, res) => {
  // "file", not "path": on Vercel the /api/:path* rewrite puts its own "path" into the query.
  const p = String(req.query.file ?? req.query.path ?? "");
  const o = await openGame(param(req, "id"));
  if (!o || !p.startsWith(`${o.prefix}game-photos/${o.game.id}/`) || p.includes("..")) return res.status(400).end();
  const data = await blobs().read(p);
  return data ? res.type("image/jpeg").send(data) : res.status(404).end();
});
app.post("/api/coach/:id", async (req, res) => {
  const id = param(req, "id");
  const o = id === "general" ? undefined : await openGame(id);
  const game = o && viewGame(o);
  if (id !== "general" && !game) return res.status(404).json({ error: "Game not found" });
  const preset = req.body.preset as keyof typeof PROMPTS | undefined;
  const question = preset ? PROMPTS[preset] : String(req.body.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "Empty question" });
  const [myList, opponentList] = o ? await gameLists(o) : [undefined, undefined];
  const answer = await askCoach(id, { game, myList, opponentList }, question, { effort: preset ? "high" : (req.body.effort ?? "medium") });
  res.json(answer);
});

// ---------- club feed (server/feed.ts) and notifications ----------

app.get("/api/feed", async (_req, res) => res.json(await feed()));
// Post the game's battle report (or update its post).
app.post("/api/feed", async (req, res) => {
  const o = await openGame(String(req.body?.gameId ?? ""));
  if (!o) return res.status(404).json({ error: "Game not found" });
  res.json(await viewPost(await publishReport(o)));
});
app.post("/api/feed/seen", async (_req, res) => {
  await markFeedSeen();
  res.json({ ok: true });
});
// A post as the member sees it, with the rivalry between its players.
const viewPost = async (p: FeedPost) => postView(p, await listResults());
app.get("/api/feed/:id", async (req, res) => res.json(await viewPost(await getPost(param(req, "id")))));
app.delete("/api/feed/:id", async (req, res) => {
  const post = await deletePost(param(req, "id"));
  // The game forgets its post, so its report can be posted again.
  const o = await openGame(post.gameId);
  if (o?.game.report?.postId === post.id) await changeGame(o, [{ path: ["report", "postId"], del: true }]);
  res.json({ ok: true });
});
app.post("/api/feed/:id/react", async (req, res) => res.json(await viewPost(await react(param(req, "id"), String(req.body?.emoji ?? "")))));
app.post("/api/feed/:id/comments", async (req, res) => res.json(await viewPost(await addComment(param(req, "id"), String(req.body?.text ?? "")))));
app.delete("/api/feed/:id/comments/:commentId", async (req, res) => res.json(await viewPost(await deleteComment(param(req, "id"), param(req, "commentId")))));
app.post("/api/feed/:id/share", async (req, res) => res.json(await viewPost(await sharePost(param(req, "id")))));
app.delete("/api/feed/:id/share", async (req, res) => res.json(await viewPost(await unsharePost(param(req, "id")))));
app.get("/api/feed/:id/photo/:n", async (req, res) => {
  const data = await readPostPhoto(param(req, "id"), Number(param(req, "n")));
  return data ? res.type("image/jpeg").set("cache-control", "private, max-age=86400").send(data) : res.status(404).end();
});
app.get("/api/club/unread", async (_req, res) => res.json(await unread()));
// Phone notifications: the key phones subscribe with, and each phone's subscription.
app.get("/api/push/key", async (_req, res) => res.json({ key: await publicKey() }));
app.post("/api/push/subscribe", async (req, res) => {
  try {
    await subscribe(req.body?.subscription);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.post("/api/push/unsubscribe", async (req, res) => {
  await unsubscribe(String(req.body?.endpoint ?? ""));
  res.json({ ok: true });
});
app.post("/api/push/test", async (_req, res) => {
  await pushTo(currentUser().prefix, { title: "Thorgrim", body: "Notifications are on for this phone.", href: "#/club", tag: "test" });
  res.json({ ok: true });
});
app.get("/api/notices", async (_req, res) => res.json(await myNotices()));
app.post("/api/notices/read", async (_req, res) => {
  await markNoticesRead();
  res.json({ ok: true });
});
// A battle report shared outside the club (no sign-in).
app.get("/api/public/reports/:token", async (req, res) => {
  const found = await publicPost(param(req, "token"));
  return found ? res.json(found.view) : res.status(404).json({ error: "This report isn't shared any more." });
});
app.get("/api/public/reports/:token/photo/:n", async (req, res) => {
  const found = await publicPost(param(req, "token"));
  const data = found && (await readPostPhoto(found.post.id, Number(param(req, "n"))));
  return data ? res.type("image/jpeg").set("cache-control", "public, max-age=86400").send(data) : res.status(404).end();
});

// ---------- calculator (same engine the coach uses) ----------

app.post("/api/calc/damage", (req, res) => {
  const { profiles, target, runs } = req.body as { profiles: AttackProfile[]; target: TargetProfile; runs?: number };
  res.json({
    perProfile: profiles.map((p) => expectedDamage(p, target)),
    bySave: damageBySave(profiles, { ward: target.ward, saveMod: target.saveMod, rerollSaves: target.rerollSaves }),
    simulation: simulate(profiles, target, Math.min(runs ?? 20000, 100000)),
  });
});
app.post("/api/calc/charge", (req, res) => res.json(chargeChance(Number(req.body.gap), req.body)));
app.post("/api/calc/cast", (req, res) => res.json(castChance(Number(req.body.castingValue), req.body)));

// ---------- web app (on your computer / Docker; Vercel serves it itself) ----------

const dist = path.resolve("dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AuthError) return res.status(err.status).json({ error: err.message, needsLogin: err.status === 401 });
  if (err instanceof FeedError) return res.status(err.status).json({ error: err.message });
  if (/authentication method/i.test(err.message)) {
    return res.status(503).json({ error: "The coach needs your Claude API key.", needsKey: true });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return res.status(502).json({ error: "Claude rejected the API key. Paste a valid one below.", needsKey: true });
  }
  console.error(err);
  res.status(500).json({ error: err.message });
});
