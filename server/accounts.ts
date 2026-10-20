// Accounts for the online app: invite-only, email + password through
// Supabase Auth (the same Supabase project as the storage). Sign-in goes
// through this server, so the browser never needs a Supabase key.
//
// The list of players, their roles and monthly coach limits, and the open
// invites are kept as small JSON files in storage, next to the data.

import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";

export interface Account {
  id: string; // Supabase Auth user id
  email: string;
  name: string;
  role: "admin" | "player";
  /** The first admin: their data is the app's original data (no prefix). */
  owner?: boolean;
  /** Monthly coach budget in USD; null = no limit; undefined = the default. */
  monthlyLimitUsd?: number | null;
  disabled?: boolean;
  createdAt: string;
}

export interface Invite {
  id: string;
  tokenHash: string;
  note: string;
  role: "admin" | "player";
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
}

export interface Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  costUsd: number;
}

export interface AccountSettings {
  defaultLimitUsd: number;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

// ---------- stored JSON ----------

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const b = await blobs().read(path);
  return b ? (JSON.parse(b.toString("utf8")) as T) : fallback;
}
const writeJson = (path: string, data: unknown) => blobs().write(path, JSON.stringify(data, null, 2), "application/json");

const USERS = "settings/users.json";
const INVITES = "settings/invites.json";
const SETTINGS = "settings/accounts.json";

export const listAccounts = () => readJson<Account[]>(USERS, []);
export const saveAccounts = (a: Account[]) => writeJson(USERS, a);
export const listInvites = () => readJson<Invite[]>(INVITES, []);
export const saveInvites = (i: Invite[]) => writeJson(INVITES, i);
export const accountSettings = async () => ({ defaultLimitUsd: 5, ...(await readJson<Partial<AccountSettings>>(SETTINGS, {})) });
export const saveAccountSettings = (s: AccountSettings) => writeJson(SETTINGS, s);

export async function updateAccount(id: string, patch: Partial<Account>): Promise<Account> {
  const all = await listAccounts();
  const i = all.findIndex((a) => a.id === id);
  if (i < 0) throw new AuthError("No such player", 404);
  all[i] = { ...all[i], ...patch, id: all[i].id, owner: all[i].owner };
  await saveAccounts(all);
  return all[i];
}

export const publicAccount = (a: Account) => ({ id: a.id, email: a.email, name: a.name, role: a.role, owner: !!a.owner });

// ---------- Supabase Auth (GoTrue REST) ----------

/** Accounts work when the app stores its data in Supabase. */
export const accountsEnabled = () => Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

const authUrl = () => process.env.SUPABASE_AUTH_URL?.trim() || `${process.env.SUPABASE_URL!.trim().replace(/\/$/, "")}/auth/v1`;
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();

async function gotrue<T>(path: string, init: { method?: string; body?: unknown; bearer?: string } = {}): Promise<T> {
  const res = await fetch(`${authUrl()}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { apikey: serviceKey(), authorization: `Bearer ${init.bearer ?? serviceKey()}`, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(data.msg ?? data.error_description ?? data.message ?? data.error ?? res.statusText);
    throw new AuthError(/invalid login credentials/i.test(msg) ? "Wrong email or password." : msg, res.status === 400 || res.status === 422 ? 400 : res.status);
  }
  return data as T;
}

type TokenReply = Session & { user: { id: string; email: string } };
const toSession = (t: TokenReply): Session => ({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at });

export async function signIn(email: string, password: string) {
  const t = await gotrue<TokenReply>("/token?grant_type=password", { body: { email: email.trim().toLowerCase(), password } });
  return { session: toSession(t), userId: t.user.id };
}

export async function refreshSession(refreshToken: string) {
  const t = await gotrue<TokenReply>("/token?grant_type=refresh_token", { body: { refresh_token: refreshToken } });
  return { session: toSession(t), userId: t.user.id };
}

/** Create a confirmed login (no email is sent: invites are shared as links). */
export async function createLogin(email: string, password: string, name: string): Promise<string> {
  if (password.length < 8) throw new AuthError("Use a password of at least 8 characters.", 400);
  const u = await gotrue<{ id: string }>("/admin/users", { body: { email: email.trim().toLowerCase(), password, email_confirm: true, user_metadata: { name } } });
  return u.id;
}

export async function setLoginPassword(userId: string, password: string) {
  if (password.length < 8) throw new AuthError("Use a password of at least 8 characters.", 400);
  await gotrue(`/admin/users/${userId}`, { method: "PUT", body: { password } });
}

// Verifying a token is a call to Supabase; remember the answer for a few minutes.
const tokenCache = new Map<string, { userId: string; until: number }>();
export async function userIdFromToken(token: string): Promise<string> {
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const hit = tokenCache.get(key);
  if (hit && hit.until > Date.now()) return hit.userId;
  const u = await gotrue<{ id: string }>("/user", { bearer: token });
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(key, { userId: u.id, until: Date.now() + 5 * 60_000 });
  return u.id;
}

// ---------- invites ----------

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export async function createInvite(note: string, role: Invite["role"]): Promise<{ invite: Invite; token: string }> {
  const token = crypto.randomBytes(18).toString("base64url");
  const invite: Invite = {
    id: crypto.randomBytes(6).toString("hex"),
    tokenHash: hashToken(token),
    note: note.trim().slice(0, 80),
    role,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
  await saveInvites([...(await listInvites()), invite]);
  return { invite, token };
}

export async function findInvite(token: string): Promise<Invite | undefined> {
  const h = hashToken(token);
  return (await listInvites()).find((i) => i.tokenHash === h && !i.usedBy && i.expiresAt > new Date().toISOString());
}

// ---------- coach usage and the monthly limit ----------

// Claude Opus 5.5 list prices per million tokens (estimate; the bill is the source of truth).
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2, webSearch: 0.01 };
const month = () => new Date().toISOString().slice(0, 7);
const usagePath = (userId: string, m = month()) => `usage/${userId}/${m}.json`;
const emptyUsage = (): Usage => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, costUsd: 0 });

export const usageOf = (userId: string, m = month()) => readJson<Usage>(usagePath(userId, m), emptyUsage());

/** Add one Claude response to the current user's usage this month. */
export async function recordUsage(usage: Anthropic.Beta.BetaUsage | undefined) {
  if (!usage) return;
  const id = currentUser().id;
  const u = await usageOf(id);
  const web = usage.server_tool_use?.web_search_requests ?? 0;
  u.requests += 1;
  u.inputTokens += usage.input_tokens ?? 0;
  u.outputTokens += usage.output_tokens ?? 0;
  u.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  u.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
  u.webSearches += web;
  u.costUsd +=
    ((usage.input_tokens ?? 0) * PRICE.input +
      (usage.output_tokens ?? 0) * PRICE.output +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
      1_000_000 +
    web * PRICE.webSearch;
  await writeJson(usagePath(id), u).catch((e) => console.error("Could not save usage:", e));
}

/** The current user's monthly limit in USD (null = none). Admins have none. */
export async function limitFor(userId: string): Promise<number | null> {
  if (!accountsEnabled()) return null;
  const acc = (await listAccounts()).find((a) => a.id === userId);
  if (!acc || acc.role === "admin") return null;
  return acc.monthlyLimitUsd === undefined ? (await accountSettings()).defaultLimitUsd : acc.monthlyLimitUsd;
}

/** Stop before a Claude call when this month's allowance is used up. */
export async function checkBudget() {
  const { id, isAdmin } = currentUser();
  if (isAdmin) return;
  const limit = await limitFor(id);
  if (limit === null) return;
  const spent = (await usageOf(id)).costUsd;
  if (spent >= limit) throw new AuthError(`You've used this month's coach allowance ($${limit.toFixed(2)}). Ask the admin to raise it.`, 402);
}
