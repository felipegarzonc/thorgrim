// The club feed: battle reports the members chose to post, with reactions and
// comments. Members only; a post's players can also make a public share link
// for one report. Posts live in the club's space ("club/"), with their own
// copies of the photos, so they stay when a game is deleted.
//
// Nothing is posted automatically: a player taps Post on the game's report.
// After that the post follows the game: changes to the score, the names or
// the report update it (syncPost).

import crypto from "node:crypto";
import { result, sideRoundVp, tacticSteps } from "../shared/scoring.ts";
import { flipGame } from "../shared/perspective.ts";
import type { ArmyList, BattleDetail, FeedPost, FeedPostView, Game } from "../shared/types.ts";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";
import { noticesIn, notify, seenIn } from "./notices.ts";
import { doubleTurns, gameBadges, playerBadges, reportSides, runningScore, type ReportSides } from "../shared/report.ts";
import { changeGame, gameLists, isGamePhoto, myGames, viewGame, type OpenGame } from "./sharedGames.ts";
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
  const { reactions, shareToken, playerIds: _players, photoSources: _sources, playerBadges: _pb, ...rest } = p;
  return {
    ...rest,
    reactions: REACTIONS.map((emoji) => ({ emoji, count: reactions[emoji]?.length ?? 0, mine: !!reactions[emoji]?.includes(me.id) })),
    canEdit: isPlayer(p) || me.isAdmin,
    mine: isPlayer(p),
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

/** The game's players: its creator and everyone who joined. */
function playersOf(o: OpenGame): string[] {
  const me = currentUser().id;
  const ownerId = o.role === "owner" ? me : o.game.share?.ownerId;
  return [...new Set([...(ownerId ? [ownerId] : []), ...(o.game.share?.players.map((p) => p.id) ?? []), ...(o.role === "player" ? [me] : [])])];
}

/** The game's battle photos for its post: the report's, then the latest table photo (games from before table photos joined the report). */
function battlePhotos(o: OpenGame): string[] {
  const table = o.game.state.tablePhoto?.path;
  const photos = [...(o.game.report?.photos ?? [])];
  if (table && !photos.includes(table)) photos.push(table);
  return photos.slice(0, MAX_PHOTOS);
}

/** The post keeps its own copies of the photos; copied again only when they changed. */
async function copyPhotos(o: OpenGame, id: string, sources: string[], existing?: FeedPost): Promise<number> {
  if (existing && JSON.stringify(existing.photoSources ?? []) === JSON.stringify(sources)) return existing.photos;
  let count = 0;
  for (const p of sources.filter((x) => isGamePhoto(o.prefix, o.game.id, x))) {
    const data = await blobs().read(p);
    if (data) await blobs().write(photoPath(id, count++), data, "image/jpeg");
  }
  for (let n = count; n < (existing?.photos ?? 0); n++) await blobs().remove(photoPath(id, n));
  return count;
}

/** What a post shows from its game, seen from the side of the player who posted it. */
function fromGame(game: Game, sides: ReportSides, playerBadgeList: string[]) {
  const report = game.report!;
  return {
    title: report.title.trim() || `${sides.me.name} vs ${sides.opponent.name}`,
    story: report.story.trim(),
    sides: [
      { name: sides.me.name, faction: sides.me.faction, vp: game.state.vp.me },
      { name: sides.opponent.name, faction: sides.opponent.faction, vp: game.state.vp.opponent },
    ],
    result: result(game),
    battleplan: game.battleplan,
    points: game.points,
    date: game.date,
    badges: [...gameBadges(game, sides), ...playerBadgeList],
    playerBadges: playerBadgeList,
    detail: battleDetail(game, sides),
  };
}

/** The battle laid out for "See the full battle", from the poster's side. */
function battleDetail(game: Game, sides: ReportSides): BattleDetail {
  const s = game.state;
  const rounds = s.rounds ?? [];
  const steps = (side: "me" | "opponent", card: string) => [...tacticSteps(rounds, side, card)];
  const army = (side: "me" | "opponent") =>
    (sides[side].list?.units ?? []).map((u) => ({ name: u.name, destroyed: !!s.units[`${side}:${u.key}`]?.destroyed, damage: s.units[`${side}:${u.key}`]?.damage ?? 0 }));
  return {
    attacker: s.attacker,
    rounds: rounds.flatMap((r, i) =>
      r.first
        ? [
            {
              round: i + 1,
              first: r.first,
              ...(r.priority ? { priority: r.priority } : {}),
              me: { vp: sideRoundVp(r.me, game.battleplan, i + 1), scored: r.me.scored, tactics: r.me.tactics.map((t) => `${t.card}: ${t.step}`) },
              opponent: { vp: sideRoundVp(r.opponent, game.battleplan, i + 1), scored: r.opponent.scored, tactics: r.opponent.tactics.map((t) => `${t.card}: ${t.step}`) },
            },
          ]
        : [],
    ),
    totals: runningScore(game),
    doubleTurns: doubleTurns(game),
    tactics: {
      me: (s.tactics ?? []).map((t) => ({ card: t.card, done: steps("me", t.card) })),
      opponent: (s.opponentTactics ?? []).map((t) => ({ card: t.card, done: steps("opponent", t.card) })),
    },
    armies: { me: army("me"), opponent: army("opponent") },
    log: game.log.slice(-80).map((l) => l.text),
  };
}

/** Post the game's battle report to the club feed (once; after that the post follows the game). */
export async function publishReport(o: OpenGame): Promise<FeedPost> {
  const game = viewGame(o);
  const report = game.report;
  if (!report?.story.trim()) throw new FeedError("Write the battle report first.");
  const existing = report.postId ? await posts.get(report.postId) : undefined;
  if (existing) {
    if (!isPlayer(existing) && !currentUser().isAdmin) throw new FeedError("Only the game's players can change its post.", 403);
    return (await syncPost(o)) ?? existing;
  }
  const me = currentUser();
  const [myList, opponentList] = await gameLists(o);
  const sides = reportSides(game, myList, opponentList);
  const id = newId();
  const photoSources = battlePhotos(o);
  const photos = await copyPhotos(o, id, photoSources);
  // Highlights about the poster ("First game with…", win streaks) are worked out once, from their own games.
  const history = await myGames();
  const ownLists = await new Collection<ArmyList>("lists", me.prefix).list();
  const factionOf = (g: Game) => ownLists.find((l) => l.id === g.myListId)?.faction || g.myFaction || "";
  const mine = playerBadges(game, sides.me.faction, history.map((g) => ({ game: g, faction: g.id === game.id ? sides.me.faction : factionOf(g) })));
  const playerIds = [...new Set([...playersOf(o), me.id])];
  const post: FeedPost = {
    id,
    createdAt: new Date().toISOString(),
    authorId: me.id,
    authorName: me.name || sides.me.name,
    gameId: game.id,
    playerIds,
    ...fromGame(game, sides, mine),
    tone: "saga",
    photos,
    photoSources,
    reactions: {},
    comments: [],
  };
  await posts.save(post);
  await changeGame(o, [{ path: ["report", "postId"], set: id }]);
  await notify(playerIds, `${me.name || sides.me.name} posted the report of your game: ${post.title}`, `#/club/${id}`);
  return post;
}

/**
 * After a game changed: bring its club post up to date (score, names,
 * factions, highlights, the report's text and photos). Quietly: no
 * notifications. Returns the post when there is one.
 */
export async function syncPost(o: OpenGame): Promise<FeedPost | undefined> {
  const report = o.game.report;
  if (!report?.postId || !report.story.trim()) return undefined;
  const existing = await posts.get(report.postId);
  if (!existing || existing.gameId !== o.game.id) return undefined;
  // Seen from the side of whoever posted it, as when it was posted.
  const me = currentUser().id;
  const ownerId = o.role === "owner" ? me : o.game.share?.ownerId;
  const authorIsOwner = existing.authorId === me ? o.role === "owner" : o.role === "player" ? !ownerId || existing.authorId === ownerId : false;
  const { share: _s, viewers: _v, listSpaces: _l, ...stored } = o.game;
  const game = authorIsOwner ? (stored as Game) : flipGame(stored as Game);
  let [mine, theirs] = await gameLists(o);
  if ((o.role === "owner") !== authorIsOwner) [mine, theirs] = [theirs, mine];
  const photoSources = battlePhotos(o);
  const photos = await copyPhotos(o, existing.id, photoSources, existing);
  const next: FeedPost = {
    ...existing,
    ...fromGame(game, reportSides(game, mine, theirs), existing.playerBadges ?? []),
    playerIds: [...new Set([...existing.playerIds, ...playersOf(o)])],
    photos,
    photoSources,
  };
  const { updatedAt: _a, ...a } = next;
  const { updatedAt: _b, ...b } = existing;
  if (JSON.stringify(a) === JSON.stringify(b)) return existing;
  return posts.save({ ...next, updatedAt: new Date().toISOString() });
}

export async function deletePost(id: string): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p) && !currentUser().isAdmin) throw new FeedError("Only the game's players can remove its post.", 403);
  for (let n = 0; n < p.photos; n++) await blobs().remove(photoPath(id, n));
  if (p.shareToken) await shareLinks.delete(p.shareToken);
  await posts.delete(id);
  return p;
}

// Slow down spam: per member, per server instance (enough for a club).
const recent = new Map<string, number[]>();
function limit(kind: string, max: number, windowMs: number) {
  const key = `${kind}:${currentUser().id}`;
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length >= max) throw new FeedError("Slow down a little: try again in a few minutes.", 429);
  recent.set(key, [...times, now]);
}

export async function react(id: string, emoji: string): Promise<FeedPost> {
  if (!REACTIONS.includes(emoji)) throw new FeedError("Unknown reaction.");
  limit("react", 60, 10 * 60_000);
  const p = await getPost(id);
  const me = currentUser().id;
  const who = p.reactions[emoji] ?? [];
  p.reactions = { ...p.reactions, [emoji]: who.includes(me) ? who.filter((x) => x !== me) : [...who, me] };
  return posts.save(p);
}

export async function addComment(id: string, text: string): Promise<FeedPost> {
  const clean = text.trim().slice(0, 1000);
  if (!clean) throw new FeedError("Write something first.");
  limit("comment", 15, 10 * 60_000);
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
  const { title, story, photos, sides, battleplan, points, date, badges, createdAt, updatedAt, result } = p;
  // The score sheet goes out too; the game log and army lists stay in the club.
  const detail = p.detail && { rounds: p.detail.rounds, tactics: p.detail.tactics };
  return { post: p, view: { title, story, photos, sides, battleplan, points, date, badges, createdAt, updatedAt, result, detail } };
}
