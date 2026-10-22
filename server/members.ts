// The current club's members (server/clubs.ts), or, before any club exists,
// everyone with an account. Pages see only ids and names; the server also
// needs each one's storage space.

import { accountsEnabled, listAccounts } from "./accounts.ts";
import { currentUser, userPrefix } from "./context.ts";
import { getClub } from "./clubs.ts";

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
  const accounts = (await listAccounts()).filter((a) => !a.disabled);
  const club = currentUser().club;
  const known = club && club.id !== "club" ? await getClub(club.id) : undefined;
  return accounts
    .filter((a) => !known || known.memberIds.includes(a.id))
    .map((a) => ({ id: a.id, name: a.name || a.email.split("@")[0], prefix: userPrefix(a.id, !!a.owner) }));
}

/** Everyone with an account, in any club (for leaders adding members). */
export async function allAccounts(): Promise<Member[]> {
  if (!accountsEnabled()) return clubMembers();
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
