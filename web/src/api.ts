// Thin fetch wrapper. Online, each person signs in with their account and
// the session (Supabase tokens, via our server) is kept in this browser and
// refreshed when it is about to expire. The old app password still works as
// the owner's master key.

import { currentLang } from "./i18n.ts";

const KEY = "aos-coach-access-key";
const SESSION = "thorgrim-session";

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds since epoch
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* private mode: signed out on the next visit */
  }
};

export const accessKey = (): string => read(KEY) ?? "";
export const setAccessKey = (k: string) => write(KEY, k || null);

export function session(): Session | null {
  try {
    return JSON.parse(read(SESSION) ?? "null") as Session | null;
  } catch {
    return null;
  }
}
export const setSession = (s: Session | null) => write(SESSION, s ? JSON.stringify(s) : null);

export function signOut() {
  setSession(null);
  setAccessKey("");
  setMediaToken("");
  window.location.hash = "#/home";
  window.location.reload();
}

// The photo pass: a short-lived token that only opens photos and files, so
// links never carry the sign-in itself. Comes with /api/meta.
const MEDIA = "thorgrim-media";
export const setMediaToken = (t: string) => write(MEDIA, t || null);
/** When the photo pass runs out (ms), or 0. */
export function mediaExpiry(): number {
  const t = read(MEDIA);
  if (!t) return 0;
  try {
    const body = atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"));
    return Number(body.slice(body.lastIndexOf(".") + 1)) || 0;
  } catch {
    return 0;
  }
}

/** Link to a server file (an uploaded PDF, a photo) that opens with the photo pass. */
export const withKey = (url: string) => {
  const t = read(MEDIA);
  return t ? `${url}${url.includes("?") ? "&" : "?"}m=${encodeURIComponent(t)}` : url;
};

export const LOGIN_EVENT = "aos-coach-login-required";

let refreshing: Promise<boolean> | null = null;
/** Get a fresh session from the refresh token (one at a time). */
function refresh(): Promise<boolean> {
  const s = session();
  if (!s) return Promise.resolve(false);
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) })
    .then(async (r) => {
      if (!r.ok) return false;
      setSession(((await r.json()) as { session: Session }).session);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const s = session();
  if (s && s.expires_at * 1000 < Date.now() + 60_000) await refresh();
  const headers: Record<string, string> = {};
  const current = session();
  if (current) headers.authorization = `Bearer ${current.access_token}`;
  else if (accessKey()) headers["x-access-key"] = accessKey();
  headers["x-lang"] = currentLang();
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, body, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { needsLogin?: boolean }).needsLogin) {
    if (!retried && session() && (await refresh())) return api<T>(path, init, true);
    window.dispatchEvent(new Event(LOGIN_EVENT));
  }
  if (!res.ok) throw new Error(errorText(res, data));
  return data as T;
}

/** Always a readable message, also when the host answers with no JSON (timeouts). */
function errorText(res: Response, data: unknown): string {
  const msg = (data as { error?: string }).error;
  if (msg) return msg;
  if (res.status === 504 || res.status === 502) return "Thorgrim took too long to answer and the server cut it off.";
  return `Something went wrong (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}).`;
}

/** Calls that work before signing in (status, login, join). */
export async function publicApi<T>(path: string, json?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, json === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(res, data));
  return data as T;
}

// ---------- background coach requests ----------
// The server answers at once with a job and keeps working; we check back
// every few seconds. A dropped connection (screen locked, bad signal) just
// means checking again, and a job can be picked up after a reload.

interface Job<T> {
  id: string;
  status: "running" | "done" | "failed";
  result?: T;
  error?: string;
  startedAt: string;
}

const JOB_KEY = (key: string) => `thorgrim-job:${key}`;
export const pendingJob = (key: string) => read(JOB_KEY(key));
const MAX_WAIT_MS = 14 * 60_000;

export async function waitForJob<T>(id: string, key?: string): Promise<T> {
  const started = Date.now();
  for (;;) {
    let job: Job<T> | undefined;
    try {
      job = await api<Job<T>>(`/jobs/${id}`);
    } catch (e) {
      // Network hiccup: try again; a missing job is final.
      if (/not found/i.test((e as Error).message)) {
        if (key) write(JOB_KEY(key), null);
        throw e;
      }
    }
    if (job?.status === "done") {
      if (key) write(JOB_KEY(key), null);
      return job.result as T;
    }
    if (job?.status === "failed") {
      if (key) write(JOB_KEY(key), null);
      throw new Error(job.error || "The request to Thorgrim failed.");
    }
    const age = job ? Date.now() - Date.parse(job.startedAt) : Date.now() - started;
    if (age > MAX_WAIT_MS) {
      if (key) write(JOB_KEY(key), null);
      throw new Error("Thorgrim took too long to answer.");
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/** Start a coach job (POST returning {job}) and wait for its result. `key` lets the page pick it up after a reload. */
export async function runJob<T>(path: string, json: unknown, key?: string): Promise<T> {
  const { job } = await api<{ job: { id: string } }>(path, { method: "POST", json });
  if (key) write(JOB_KEY(key), job.id);
  return waitForJob<T>(job.id, key);
}
