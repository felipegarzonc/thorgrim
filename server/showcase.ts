// The army showcase: each member's armies with photos of their painted
// models, shown on their member page. Kept in the club's space; only the
// member edits their own.

import { blobs } from "./blobs.ts";
import { FeedError } from "./feed.ts";
import { me } from "./members.ts";
import { Collection, newId } from "./store.ts";
import { clubSpace } from "./clubs.ts";

export interface ShowcaseArmy {
  id: string;
  faction: string;
  name: string;
  note?: string;
  /** Photo ids, in order (see photoPath). */
  photos: string[];
  createdAt: string;
}

interface Showcase {
  id: string; // the member's id
  armies: ShowcaseArmy[];
}

/** The current club's showcases. */
const showcases = () => new Collection<Showcase>("showcase", clubSpace());
const photoPath = (memberId: string, armyId: string, photoId: string) => `${clubSpace()}showcase-photos/${memberId}/${armyId}/${photoId}.jpg`;
const MAX_ARMIES = 8;
const MAX_PHOTOS = 12;
const ID = /^[a-z0-9-]{1,64}$/i;

/** Every member's armies in the current club (for Glory). */
export async function allArmies(): Promise<(ShowcaseArmy & { memberId: string })[]> {
  return (await showcases().list()).flatMap((s) => s.armies.map((a) => ({ ...a, memberId: s.id })));
}

export async function showcaseOf(memberId: string): Promise<ShowcaseArmy[]> {
  if (!ID.test(memberId)) return [];
  return (await showcases().get(memberId))?.armies ?? [];
}

async function mine(): Promise<Showcase> {
  const id = me().id;
  return (await showcases().get(id)) ?? { id, armies: [] };
}

function findArmy(s: Showcase, armyId: string): ShowcaseArmy {
  const a = s.armies.find((x) => x.id === armyId);
  if (!a) throw new FeedError("That army was removed.", 404);
  return a;
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function saveArmy(b: Partial<ShowcaseArmy>, armyId?: string): Promise<ShowcaseArmy[]> {
  const s = await mine();
  const fields = { faction: clean(b.faction, 80), name: clean(b.name, 80), note: clean(b.note, 500) || undefined };
  if (!fields.faction) throw new FeedError("Pick the army's faction.");
  if (armyId) {
    findArmy(s, armyId);
    s.armies = s.armies.map((a) => (a.id === armyId ? { ...a, ...fields, name: fields.name || a.name } : a));
  } else {
    if (s.armies.length >= MAX_ARMIES) throw new FeedError(`Up to ${MAX_ARMIES} armies.`);
    s.armies.push({ id: newId(), ...fields, name: fields.name || fields.faction, photos: [], createdAt: new Date().toISOString() });
  }
  return (await showcases().save(s)).armies;
}

export async function deleteArmy(armyId: string): Promise<ShowcaseArmy[]> {
  const s = await mine();
  const a = findArmy(s, armyId);
  for (const p of a.photos) await blobs().remove(photoPath(s.id, a.id, p)).catch(() => undefined);
  s.armies = s.armies.filter((x) => x.id !== armyId);
  return (await showcases().save(s)).armies;
}

export async function addPhoto(armyId: string, jpeg: Buffer): Promise<ShowcaseArmy[]> {
  const s = await mine();
  const a = findArmy(s, armyId);
  if (a.photos.length >= MAX_PHOTOS) throw new FeedError(`Up to ${MAX_PHOTOS} photos per army.`);
  const photoId = newId();
  await blobs().write(photoPath(s.id, a.id, photoId), jpeg, "image/jpeg");
  a.photos.push(photoId);
  return (await showcases().save(s)).armies;
}

export async function deletePhoto(armyId: string, photoId: string): Promise<ShowcaseArmy[]> {
  const s = await mine();
  const a = findArmy(s, armyId);
  if (!a.photos.includes(photoId)) return s.armies;
  await blobs().remove(photoPath(s.id, a.id, photoId)).catch(() => undefined);
  a.photos = a.photos.filter((p) => p !== photoId);
  return (await showcases().save(s)).armies;
}

/** A showcase photo, only if it is one of that member's army's photos. */
export async function readPhoto(memberId: string, armyId: string, photoId: string): Promise<Buffer | undefined> {
  const a = (await showcaseOf(memberId)).find((x) => x.id === armyId);
  if (!a?.photos.includes(photoId)) return undefined;
  return (await blobs().read(photoPath(memberId, armyId, photoId))) ?? undefined;
}
