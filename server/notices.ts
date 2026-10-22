// In-app notifications: a short line and a link, kept in each member's own
// space (a comment on their post, a report of their game, an opponent who
// joined their game). The Club tab shows how many are unread, and phones
// with notifications on get them too (server/push.ts).

import type { Notice } from "../shared/types.ts";
import { accountsEnabled, listAccounts } from "./accounts.ts";
import { currentUser, userPrefix } from "./context.ts";
import { pushTo } from "./push.ts";
import { translate, type Lang } from "../shared/i18n/index.ts";
import { langOf } from "./lang.ts";
import { Collection, newId } from "./store.ts";

export const noticesIn = (prefix: string) => new Collection<Notice>("notices", prefix);
export const seenIn = (prefix: string) => new Collection<{ id: string; at: string }>("seen", prefix);

/** Storage space of each member, by account id ("" for the owner). */
async function spaces(): Promise<Map<string, string>> {
  if (!accountsEnabled()) return new Map([[currentUser().id, currentUser().prefix]]);
  return new Map((await listAccounts()).filter((a) => !a.disabled).map((a) => [a.id, userPrefix(a.id, !!a.owner)]));
}

/**
 * Tell these members something happened (never the one who did it), in each
 * one's language: the text is translated (shared/i18n), or written per language.
 */
export async function notify(userIds: string[], text: string | ((lang: Lang) => string), href: string) {
  const me = currentUser().id;
  const where = await spaces();
  const at = new Date().toISOString();
  for (const id of new Set(userIds)) {
    const prefix = where.get(id);
    if (id === me || prefix === undefined) continue;
    // In the member's own language.
    const lang = await langOf(prefix).catch(() => "en" as const);
    const said = typeof text === "function" ? text(lang) : translate(text, lang);
    await noticesIn(prefix).save({ id: `${Date.now().toString(36)}-${newId()}`, at, text: said.slice(0, 300), href });
    // And to their phones, if they turned notifications on (never holding up the request for long).
    await Promise.race([pushTo(prefix, { title: "Thorgrim", body: said.slice(0, 200), href }).catch(() => undefined), new Promise((r) => setTimeout(r, 4000))]);
  }
}

export async function myNotices(): Promise<Notice[]> {
  const all = await noticesIn(currentUser().prefix).list();
  const sorted = all.sort((a, b) => b.at.localeCompare(a.at));
  // Keep the latest 50; older ones are dropped.
  for (const old of sorted.slice(50)) await noticesIn(currentUser().prefix).delete(old.id);
  return sorted.slice(0, 50);
}

export async function markNoticesRead() {
  for (const n of await noticesIn(currentUser().prefix).list()) if (!n.read) await noticesIn(currentUser().prefix).save({ ...n, read: true });
}
