// In-app notifications: a short line and a link, kept in each member's own
// space (a comment on their post, a report of their game, an opponent who
// joined their game). The Club tab shows how many are unread.

import type { Notice } from "../shared/types.ts";
import { accountsEnabled, listAccounts } from "./accounts.ts";
import { currentUser, userPrefix } from "./context.ts";
import { Collection, newId } from "./store.ts";

export const noticesIn = (prefix: string) => new Collection<Notice>("notices", prefix);
export const seenIn = (prefix: string) => new Collection<{ id: string; at: string }>("seen", prefix);

/** Storage space of each member, by account id ("" for the owner). */
async function spaces(): Promise<Map<string, string>> {
  if (!accountsEnabled()) return new Map([[currentUser().id, currentUser().prefix]]);
  return new Map((await listAccounts()).filter((a) => !a.disabled).map((a) => [a.id, userPrefix(a.id, !!a.owner)]));
}

/** Tell these members something happened (never the one who did it). */
export async function notify(userIds: string[], text: string, href: string) {
  const me = currentUser().id;
  const where = await spaces();
  const at = new Date().toISOString();
  for (const id of new Set(userIds)) {
    const prefix = where.get(id);
    if (id === me || prefix === undefined) continue;
    await noticesIn(prefix).save({ id: `${Date.now().toString(36)}-${newId()}`, at, text: text.slice(0, 300), href });
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
