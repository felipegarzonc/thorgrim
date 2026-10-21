// The club feed: battle reports the members chose to post, with reactions and
// comments. Members only; a post's players can also make a public share link
// for one report. Posts live in the club's space ("club/"), with their own
// copies of the photos, so they stay when a game is deleted.
//
// Nothing is posted automatically: a player taps Post on the game's report.

import crypto from "node:crypto";
import { result } from "../shared/scoring.ts";
import type { ArmyList, FeedPost, FeedPostView } from "../shared/types.ts";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";
import { noticesIn, notify, seenIn } from "./notices.ts";
import { gameBadges, playerBadges, reportSides } from "./report.ts";
import { changeGame, gameLists, myGames, viewGame, type OpenGame } from "./sharedGames.ts";
import { Collection, newId } from "./store.ts";

const CLUB = "club/";
const posts = new Collection<FeedPost>("posts", CLUB);
const shareLinks = new Collection<{ id: string; postId: string }>("post-links", CLUB);
const photoPath = (postId: string, n: number) => `${CLUB}post-photos/${postId}/${n}.jpg`;

export const REACTIONS = ["⚔️", "🔥", "😂", "👏", "💀"];
const MAX_PHOTOS = 8;

export class FeedError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** What's new for the signed-in member: unread notices and posts by others since they last looked. */
export async function unread(): Promise<{ notices: number; posts: number }> {
  const me = currentUser();
  const [notices, seen, all] = await Promise.all([noticesIn(me.prefix).list(), seenIn(me.prefix).get("feed"), posts.list()]);
  const since = seen?.at ?? "";
  return { notices: notices.filter((n) => !n.read).length, posts: all.filter((p) => p.authorId !== me.id && p.createdAt > since).length };
}

export const markFeedSeen = () => seenIn(currentUser().prefix).save({ id: "feed", at: new Date().toISOString() });

// ---------- posts ----------

const isPlayer = (p: FeedPost) => p.playerIds.includes(currentUser().id) || p.authorId === currentUser().id;

export function postView(p: FeedPost): FeedPostView {
  const me = currentUser();
  const { reactions, shareToken, playerIds: _players, ...rest } = p;
  return {
    ...rest,
    reactions: REACTIONS.map((emoji) => ({ emoji, count: reactions[emoji]?.length ?? 0, mine: !!reactions[emoji]?.includes(me.id) })),
    canEdit: isPlayer(p) || me.isAdmin,
    ...(isPlayer(p) && shareToken ? { shareToken } : {}),
  };
}

export async function feed(): Promise<FeedPostView[]> {
  return (await posts.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(postView);
}

export async function getPost(id: string): Promise<FeedPost> {
  const p = await posts.get(id);
  if (!p) throw new FeedError("That post was removed.", 404);
  return p;
}

/** Post the game's battle report to the club feed, or update the post made from it. */
export async function publishReport(o: OpenGame): Promise<FeedPost> {
  const game = viewGame(o);
  const report = game.report;
  if (!report?.story.trim()) throw new FeedError("Write the battle report first.");
  const me = currentUser();
  const [myList, opponentList] = await gameLists(o);
  const sides = reportSides(game, myList, opponentList);
  const existing = report.postId ? await posts.get(report.postId) : undefined;
  if (existing && !isPlayer(existing) && !me.isAdmin) throw new FeedError("Only the game's players can change its post.", 403);
  const id = existing?.id ?? newId();

  // The post keeps its own copies of the photos.
  const photos = report.photos.slice(0, MAX_PHOTOS);
  let count = 0;
  for (const p of photos) {
    const data = await blobs().read(p);
    if (data) await blobs().write(photoPath(id, count++), data, "image/jpeg");
  }
  for (let n = count; n < (existing?.photos ?? 0); n++) await blobs().remove(photoPath(id, n));

  const ownerId = o.role === "owner" ? me.id : o.game.share?.ownerId;
  const playerIds = [...new Set([...(ownerId ? [ownerId] : []), ...(o.game.share?.players.map((p) => p.id) ?? []), me.id])];
  const history = await myGames();
  const ownLists = await new Collection<ArmyList>("lists", me.prefix).list();
  const factionOf = (g: (typeof history)[number]) => ownLists.find((l) => l.id === g.myListId)?.faction || g.myFaction || "";
  const badges = [...gameBadges(game, sides), ...playerBadges(game, sides.me.faction, history.map((g) => ({ game: g, faction: g.id === game.id ? sides.me.faction : factionOf(g) })))];

  const post: FeedPost = {
    id,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    ...(existing ? { updatedAt: new Date().toISOString() } : {}),
    authorId: existing?.authorId ?? me.id,
    authorName: existing?.authorName || me.name || sides.me.name,
    gameId: game.id,
    playerIds,
    title: report.title.trim() || `${sides.me.name} vs ${sides.opponent.name}`,
    story: report.story.trim(),
    tone: report.tone,
    photos: count,
    sides: [
      { name: sides.me.name, faction: sides.me.faction, vp: game.state.vp.me },
      { name: sides.opponent.name, faction: sides.opponent.faction, vp: game.state.vp.opponent },
    ],
    result: result(game),
    battleplan: game.battleplan,
    points: game.points,
    date: game.date,
    badges,
    reactions: existing?.reactions ?? {},
    comments: existing?.comments ?? [],
    ...(existing?.shareToken ? { shareToken: existing.shareToken } : {}),
  };
  await posts.save(post);
  if (report.postId !== id) await changeGame(o, [{ path: ["report", "postId"], set: id }]);
  if (!existing) await notify(playerIds, `${me.name || sides.me.name} posted the report of your game: ${post.title}`, `#/club/${id}`);
  return post;
}

export async function deletePost(id: string) {
  const p = await getPost(id);
  if (!isPlayer(p) && !currentUser().isAdmin) throw new FeedError("Only the game's players can remove its post.", 403);
  for (let n = 0; n < p.photos; n++) await blobs().remove(photoPath(id, n));
  if (p.shareToken) await shareLinks.delete(p.shareToken);
  await posts.delete(id);
}

export async function react(id: string, emoji: string): Promise<FeedPost> {
  if (!REACTIONS.includes(emoji)) throw new FeedError("Unknown reaction.");
  const p = await getPost(id);
  const me = currentUser().id;
  const who = p.reactions[emoji] ?? [];
  p.reactions = { ...p.reactions, [emoji]: who.includes(me) ? who.filter((x) => x !== me) : [...who, me] };
  return posts.save(p);
}

export async function addComment(id: string, text: string): Promise<FeedPost> {
  const clean = text.trim().slice(0, 1000);
  if (!clean) throw new FeedError("Write something first.");
  const p = await getPost(id);
  const me = currentUser();
  p.comments = [...p.comments, { id: newId(), authorId: me.id, authorName: me.name || "A member", text: clean, at: new Date().toISOString() }];
  await posts.save(p);
  // The game's players and everyone else in the conversation hear about it.
  const short = clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
  await notify([p.authorId, ...p.playerIds, ...p.comments.map((c) => c.authorId)], `${me.name || "A member"} commented on "${p.title}": ${short}`, `#/club/${id}`);
  return p;
}

export async function deleteComment(id: string, commentId: string): Promise<FeedPost> {
  const p = await getPost(id);
  const c = p.comments.find((x) => x.id === commentId);
  if (!c) return p;
  if (c.authorId !== currentUser().id && !isPlayer(p) && !currentUser().isAdmin) throw new FeedError("You can only remove your own comments.", 403);
  p.comments = p.comments.filter((x) => x.id !== commentId);
  return posts.save(p);
}

export async function readPostPhoto(id: string, n: number): Promise<Buffer | undefined> {
  const p = await posts.get(id);
  if (!p || !Number.isInteger(n) || n < 0 || n >= p.photos) return undefined;
  return blobs().read(photoPath(id, n));
}

// ---------- public share links ----------

export async function sharePost(id: string): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p)) throw new FeedError("Only the game's players can share its report outside the club.", 403);
  if (p.shareToken) return p;
  p.shareToken = crypto.randomBytes(16).toString("hex");
  await shareLinks.save({ id: p.shareToken, postId: p.id });
  return posts.save(p);
}

export async function unsharePost(id: string): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p) && !currentUser().isAdmin) throw new FeedError("Only the game's players can stop sharing it.", 403);
  if (p.shareToken) await shareLinks.delete(p.shareToken);
  delete p.shareToken;
  return posts.save(p);
}

/** A shared report as anyone with the link sees it: the story, photos and score, nothing about the club. */
export async function publicPost(token: string) {
  const link = /^[a-f0-9]{32}$/.test(token) ? await shareLinks.get(token) : undefined;
  const p = link && (await posts.get(link.postId));
  if (!p || p.shareToken !== token) return undefined;
  const { title, story, photos, sides, battleplan, points, date, badges, createdAt, updatedAt } = p;
  return { post: p, view: { title, story, photos, sides, battleplan, points, date, badges, createdAt, updatedAt } };
}
