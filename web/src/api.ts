// Thin fetch wrapper. When the server is password-protected (always when it
// is online), the password is entered once on the login screen and kept in
// this browser.

const KEY = "aos-coach-access-key";

export function accessKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAccessKey(k: string) {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the password is asked again next time */
  }
}

/** Link to a server file (e.g. an uploaded PDF) that carries the password. */
export const withKey = (url: string) => (accessKey() ? `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(accessKey())}` : url);

export const LOGIN_EVENT = "aos-coach-login-required";

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessKey()) headers["x-access-key"] = accessKey();
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, body, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { needsLogin?: boolean }).needsLogin) {
    window.dispatchEvent(new Event(LOGIN_EVENT));
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}
