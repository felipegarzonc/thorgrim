// Clubs. Each has a name, a leader and its members, and its own space for
// everything the club shares (battle reports, the ladder and its seasons,
// events, challenges, the army showcase). Only the app's owner creates clubs
// for now; a club's leader adds and removes its members.
//
// The first club takes over the space the app used before clubs ("club/"),
// so nothing moves. Until a club exists, everyone shares that space.

import { accountsEnabled, listAccounts } from "./accounts.ts";
import { currentUser, runAs, type UserCtx } from "./context.ts";
import { FeedError } from "./feed.ts";
import { Collection, newId } from "./store.ts";

export interface Club {
  id: string;
  name: string;
  leaderId: string;
  memberIds: string[];
  /** Its storage space ("club/" for the first, "clubs/<id>/" after). */
  prefix: string;
  createdAt: string;
}

/** What a request knows of its club (UserCtx.club). */
export type ClubCtx = Pick<Club, "id" | "name" | "prefix" | "leaderId">;

const registry = new Collection<Club>("clubs", "settings/");
const LEGACY = "club/";

export const listClubs = async () => (await registry.list()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export const getClub = (id: string) => registry.get(id);

/** The app's owner (the first admin, or the app password): the only one who creates clubs for now. */
export const isOwner = (u: UserCtx = currentUser()) => u.prefix === "";

/**
 * The club a request works in: the one asked for (header x-club) if the
 * player is in it, else their first. None: no club yet. Before any club
 * exists, everyone shares the old space.
 */
export async function clubFor(user: UserCtx, wanted?: string): Promise<ClubCtx | undefined> {
  const clubs = await listClubs();
  if (!clubs.length) return { id: "club", name: "", prefix: LEGACY, leaderId: "" };
  const mine = await myClubs(user, clubs);
  const c = mine.find((x) => x.id === wanted) ?? mine[0];
  return c && { id: c.id, name: c.name, prefix: c.prefix, leaderId: c.leaderId };
}

/** The current club's space; a player in no club (null) can't use club features. Work outside a request (no club resolved) uses the first space. */
export function clubSpace(): string {
  const c = currentUser().club;
  if (c === undefined) return LEGACY;
  if (!c) throw new FeedError("You're not in a club yet: ask a club leader to add you.", 403);
  return c.prefix;
}

export const isLeader = (u: UserCtx = currentUser()) => !!u.club && (u.club.leaderId === u.id || isOwner(u));

/** The clubs a player can open: theirs, or every club for the app's owner. */
export async function myClubs(user: UserCtx, clubs?: Club[]): Promise<Club[]> {
  const all = clubs ?? (await listClubs());
  return isOwner(user) ? all : all.filter((c) => c.memberIds.includes(user.id));
}

/** Run `fn` inside each club in turn (scheduled work). */
export async function eachClub<T>(fn: (club: Club) => Promise<T>): Promise<T[]> {
  const clubs = await listClubs();
  const user = currentUser();
  const out: T[] = [];
  if (!clubs.length) {
    out.push(await runAs({ ...user, club: { id: "club", name: "", prefix: LEGACY, leaderId: "" } }, () => fn({ id: "club", name: "", leaderId: "", memberIds: [], prefix: LEGACY, createdAt: "" })));
    return out;
  }
  for (const c of clubs) out.push(await runAs({ ...user, club: { id: c.id, name: c.name, prefix: c.prefix, leaderId: c.leaderId } }, () => fn(c)));
  return out;
}

/** A new club (the owner only). The first one adopts the space used before clubs. */
export async function createClub(name: string, leaderId: string, memberIds: string[] = []): Promise<Club> {
  if (!isOwner()) throw new FeedError("Only the app's owner can create clubs for now.", 403);
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new FeedError("Give the club a name.");
  const clubs = await listClubs();
  if (clubs.some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new FeedError("There's already a club with that name.");
  const accounts = accountsEnabled() ? await listAccounts() : [];
  const known = (id: string) => !accountsEnabled() || accounts.some((a) => a.id === id);
  if (!known(leaderId)) throw new FeedError("That leader isn't a member of the app.");
  const id = newId();
  const club: Club = {
    id,
    name: clean,
    leaderId,
    memberIds: [...new Set([leaderId, ...memberIds.filter(known)])],
    prefix: clubs.length ? `clubs/${id}/` : LEGACY,
    createdAt: new Date().toISOString(),
  };
  return registry.save(club);
}

async function mustLead(clubId: string): Promise<Club> {
  const c = await registry.get(clubId);
  if (!c) throw new FeedError("That club doesn't exist.", 404);
  const u = currentUser();
  if (c.leaderId !== u.id && !isOwner(u)) throw new FeedError("Only the club's leader can do that.", 403);
  return c;
}

export async function addMembers(clubId: string, ids: string[]): Promise<Club> {
  const c = await mustLead(clubId);
  const accounts = await listAccounts();
  const add = ids.filter((id) => accounts.some((a) => a.id === id && !a.disabled));
  return registry.save({ ...c, memberIds: [...new Set([...c.memberIds, ...add])] });
}

export async function removeMember(clubId: string, id: string): Promise<Club> {
  const c = await mustLead(clubId);
  if (id === c.leaderId) throw new FeedError("The leader stays in the club: name another leader first.");
  return registry.save({ ...c, memberIds: c.memberIds.filter((m) => m !== id) });
}

/** A new leader (the owner, or the current leader handing over); they must be a member. */
export async function setLeader(clubId: string, id: string): Promise<Club> {
  const c = await mustLead(clubId);
  if (!c.memberIds.includes(id)) throw new FeedError("The new leader has to be a member of the club.");
  return registry.save({ ...c, leaderId: id });
}

export async function renameClub(clubId: string, name: string): Promise<Club> {
  const c = await mustLead(clubId);
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new FeedError("Give the club a name.");
  return registry.save({ ...c, name: clean });
}

/** Someone who joins with a club's invite becomes a member (no leader check: the invite is the leader's). */
export async function joinClub(clubId: string, userId: string) {
  const c = await registry.get(clubId);
  if (c && !c.memberIds.includes(userId)) await registry.save({ ...c, memberIds: [...c.memberIds, userId] });
}
