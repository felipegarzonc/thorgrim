// Thin fetch wrapper. If the server sets APP_ACCESS_KEY, the key is asked once
// and kept in this browser.

const KEY = "aos-coach-access-key";

function accessKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-access-key": accessKey() };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, body, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (res.status === 401) {
    const k = prompt("Access key for this coach:");
    if (k) {
      try {
        localStorage.setItem(KEY, k);
      } catch {
        /* ignore */
      }
      return api<T>(path, init);
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}
