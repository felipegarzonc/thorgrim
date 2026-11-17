// Thin fetch wrapper. Online, each person signs in with their account and
// the session (Supabase tokens, via our server) is kept in this browser and
// refreshed when it is about to expire. The old app password still works as
// the owner's master key.

import { currentLang } from "./i18n.ts";

const KEY = "aos-coach-access-key";
const SESSION = "thorgrim-session";
const CLUB = "thorgrim-club";

/** The club this browser is working in (a player can be in several). */
export const currentClub = (): string => read(CLUB) ?? "";
export const setCurrentClub = (id: string) => write(CLUB, id || null);

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
  forgetOfflineCopies();
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
  const c = currentClub();
  const club = c ? `&c=${encodeURIComponent(c)}` : "";
  return t ? `${url}${url.includes("?") ? "&" : "?"}m=${encodeURIComponent(t)}${club}` : url;
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

/** Who is asking (session or app password), in which language and club; the session renewed first when it's about to end. */
async function requestHeaders(): Promise<Record<string, string>> {
  const s = session();
  if (s && s.expires_at * 1000 < Date.now() + 60_000) await refresh();
  const headers: Record<string, string> = {};
  const current = session();
  if (current) headers.authorization = `Bearer ${current.access_token}`;
  else if (accessKey()) headers["x-access-key"] = accessKey();
  headers["x-lang"] = currentLang();
  if (currentClub()) headers["x-club"] = currentClub();
  return headers;
}

/** A signed-in download: the file and the name the server gave it. */
export async function apiFile(path: string): Promise<{ blob: Blob; name: string }> {
  const res = await fetch(`/api${path}`, { headers: await requestHeaders() });
  if (!res.ok) throw new Error(errorText(res, await res.json().catch(() => ({}))));
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "download";
  return { blob: await res.blob(), name };
}

/**
 * A signed-in POST answered with server-sent events: calls `onEvent` for each
 * event as it arrives, and resolves with the data of the "done" event (an
 * "error" event rejects with its message).
 */
export async function apiStream<T>(path: string, json: unknown, onEvent: (event: string, data: unknown) => void): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", headers: { ...(await requestHeaders()), "content-type": "application/json" }, body: JSON.stringify(json) });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && (data as { needsLogin?: boolean }).needsLogin) window.dispatchEvent(new Event(LOGIN_EVENT));
    throw new Error(errorText(res, data));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Events are separated by a blank line: "event: <name>\ndata: <json>".
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(raw)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] ?? "null") as unknown;
      if (event === "done") return data as T;
      if (event === "error") throw new Error((data as { error?: string })?.error ?? "Thorgrim couldn't answer.");
      onEvent(event, data);
    }
  }
  throw new Error("The answer was cut off. Try again.");
}

// ---------- copies for the table without signal ----------
// What a game needs (the app's info, the games, each game opened, its lists
// and warscrolls) is kept on this phone as it loads. With no connection at
// all, those copies answer instead, so a game opens and can be played; the
// game screen sends its changes once the signal is back (see Game.tsx). Only
// a missing connection uses them, never an error the server answered with.
// Signing out forgets them.

const OFFLINE = "thorgrim-offline:";
const OFFLINE_INDEX = "thorgrim-offline-index";
const OFFLINE_MAX = 120;
export const OFFLINE_EVENT = "thorgrim-offline-copy";
const keptForTable = (path: string) => /^\/(meta|lists|games|units\/[^/?]+|games\/[a-z0-9-]+(\/lists(\?.*)?)?)$/i.test(path);

function offlineIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_INDEX) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function keepOffline(path: string, data: unknown) {
  const index = offlineIndex().filter((p) => p !== path);
  index.push(path);
  const save = () => {
    while (index.length > OFFLINE_MAX) localStorage.removeItem(OFFLINE + index.shift());
    localStorage.setItem(OFFLINE + path, JSON.stringify(data));
    localStorage.setItem(OFFLINE_INDEX, JSON.stringify(index));
  };
  try {
    save();
  } catch {
    // The phone's storage is full: drop the oldest half and try once more; failing that, just don't keep it.
    try {
      for (const old of index.splice(0, Math.floor(index.length / 2))) localStorage.removeItem(OFFLINE + old);
      save();
    } catch {
      /* not kept */
    }
  }
}
function offlineCopy<T>(path: string): T | undefined {
  try {
    const raw = localStorage.getItem(OFFLINE + path);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}
/**
 * What this phone kept for a page, to show at once while the fresh copy
 * loads (the app opens on what it showed last time, then updates in place).
 * Undefined for anything not kept, or when nothing was kept yet.
 */
export function keptCopy<T>(path: string | null): T | undefined {
  return path && keptForTable(path) ? offlineCopy<T>(path) : undefined;
}

export function forgetOfflineCopies() {
  try {
    for (const p of offlineIndex()) localStorage.removeItem(OFFLINE + p);
    localStorage.removeItem(OFFLINE_INDEX);
  } catch {
    /* nothing kept */
  }
}
/** No connection at all (not an answer from the server): fetch fails with a TypeError. */
const noConnection = (e: unknown) => e instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const read = (!init.method || init.method === "GET") && keptForTable(path);
  if (!read) {
    const data = await apiRequest<T>(path, init, retried);
    // Saving a game answers with the game as it now is: that becomes this phone's copy,
    // so without signal the game opens as it was last saved, not as it was last opened.
    if (init.method === "PATCH" && /^\/games\/[a-z0-9-]+$/i.test(path)) keepOffline(path, data);
    return data;
  }
  try {
    const data = await apiRequest<T>(path, init, retried);
    keepOffline(path, data);
    return data;
  } catch (e) {
    const copy = noConnection(e) ? offlineCopy<T>(path) : undefined;
    if (copy === undefined) throw e;
    window.dispatchEvent(new Event(OFFLINE_EVENT));
    return copy;
  }
}

async function apiRequest<T>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const headers = await requestHeaders();
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, body, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { needsLogin?: boolean }).needsLogin) {
    if (!retried && session() && (await refresh())) return apiRequest<T>(path, init, true);
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

/** Tells the bottom bar to re-count what's unread (the club page sends it after marking things seen). */
export const CLUB_SEEN = "thorgrim-club-seen";
