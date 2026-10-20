// Thin fetch wrapper. Online, each person signs in with their account and
// the session (Supabase tokens, via our server) is kept in this browser and
// refreshed when it is about to expire. The old app password still works as
// the owner's master key.

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
  window.location.hash = "#/home";
  window.location.reload();
}

/** Link to a server file (an uploaded PDF, a photo) that carries the sign-in. */
export const withKey = (url: string) => {
  const sep = url.includes("?") ? "&" : "?";
  const s = session();
  if (s) return `${url}${sep}token=${encodeURIComponent(s.access_token)}`;
  return accessKey() ? `${url}${sep}key=${encodeURIComponent(accessKey())}` : url;
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
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

/** Calls that work before signing in (status, login, join). */
export async function publicApi<T>(path: string, json?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, json === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}
