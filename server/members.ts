// The club's members: everyone with an account (not disabled). Pages see
// only ids and names; the server also needs each one's storage space.

import { accountsEnabled, listAccounts } from "./accounts.ts";
import { currentUser, userPrefix } from "./context.ts";

export interface Member {
  id: string;
  name: string;
  prefix: string;
}

export async function clubMembers(): Promise<Member[]> {
  if (!accountsEnabled()) {
    const me = currentUser();
    return [{ id: me.id, name: me.name || "You", prefix: me.prefix }];
  }
  return (await listAccounts())
    .filter((a) => !a.disabled)
    .map((a) => ({ id: a.id, name: a.name || a.email.split("@")[0], prefix: userPrefix(a.id, !!a.owner) }));
}

export async function findMember(id: string): Promise<Member | undefined> {
  return (await clubMembers()).find((m) => m.id === id);
}

/** The signed-in member as a Member (the app-password owner too). */
export function me(): Member {
  const u = currentUser();
  return { id: u.id, name: u.name, prefix: u.prefix };
}
