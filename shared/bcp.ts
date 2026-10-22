// Best Coast Pairings (bestcoastpairings.com), where most tournaments run.
// It has no public API, so Thorgrim only links to it: an event's BCP page,
// and for a tournament game the result ready to enter there.

/** A link to Best Coast Pairings, cleaned up; anything else is undefined. */
export function bcpUrl(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (host !== "bestcoastpairings.com" && !host.endsWith(".bestcoastpairings.com")) return undefined;
    u.protocol = "https:";
    return u.toString().slice(0, 300);
  } catch {
    return undefined;
  }
}

export const BCP_HOME = "https://www.bestcoastpairings.com/";
