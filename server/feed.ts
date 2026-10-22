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
import { currentUser, runAs } from "./context.ts";
import { noticesIn, notify, seenIn } from "./notices.ts";
import { doubleTurns, gameBadges, playerBadges, reportSides, runningScore, type ReportSides } from "../shared/report.ts";
import { changeGame, gameLists, isGamePhoto, myGames, viewGame, type OpenGame } from "./sharedGames.ts";
import { Collection, newId } from "./store.ts";
import { clubSpace, getClub, listClubs } from "./clubs.ts";
import { translate, type Lang } from "../shared/i18n/index.ts";
import { headToHead, type ClubResult } from "../shared/ladder.ts";
import { listResults } from "./ladder.ts";

// Everything below lives in the current club's space (server/clubs.ts).
const posts = (space = clubSpace()) => new Collection<FeedPost>("posts", space);
const shareLinks = (space = clubSpace()) => new Collection<{ id: string; postId: string }>("post-links", space);
const photoPath = (postId: string, n: number, space = clubSpace()) => `${space}post-photos/${postId}/${n}.jpg`;
const cardPath = (postId: string, space = clubSpace()) => `${space}post-cards/${postId}.jpg`;

/** Run `fn` in another club's space (a post lives in the club it was posted to). */
async function inClub<T>(clubId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const here = currentUser().club;
  if (!clubId || clubId === here?.id) return fn();
  const c = await getClub(clubId);
  if (!c) return fn();
  return runAs({ ...currentUser(), club: { id: c.id, name: c.name, prefix: c.prefix, leaderId: c.leaderId } }, fn);
}

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
/** New notices and club posts (no club yet: just the notices). */
export async function unread(): Promise<{ notices: number; posts: number }> {
  const me = currentUser();
  const [notices, seen, all] = await Promise.all([noticesIn(me.prefix).list(), seenIn(me.prefix).get("feed"), me.club === null ? [] : posts().list()]);
  const since = seen?.at ?? "";
  return { notices: notices.filter((n) => !n.read).length, posts: all.filter((p) => p.authorId !== me.id && p.createdAt > since).length };
}

export const markFeedSeen = () => seenIn(currentUser().prefix).save({ id: "feed", at: new Date().toISOString() });

// ---------- posts ----------

const isPlayer = (p: FeedPost) => p.playerIds.includes(currentUser().id) || p.authorId === currentUser().id;

/** With the club's confirmed results, the post says how the rivalry stands (the poster's side first). */
export function postView(p: FeedPost, results?: ClubResult[]): FeedPostView {
  const me = currentUser();
  const { reactions, shareToken, playerIds: _players, photoSources: _sources, playerBadges: _pb, ...rest } = p;
  const rival = p.playerIds.find((id) => id !== p.authorId);
  const record = results && rival ? headToHead(results, p.authorId).find((h) => h.id === rival) : undefined;
  return {
    ...rest,
    ...(record && record.won + record.drawn + record.lost > 1 ? { rivalry: { won: record.won, drawn: record.drawn, lost: record.lost } } : {}),
    reactions: REACTIONS.map((emoji) => ({ emoji, count: reactions[emoji]?.length ?? 0, mine: !!reactions[emoji]?.includes(me.id) })),
    canEdit: isPlayer(p) || me.isAdmin,
    mine: isPlayer(p),
    ...(isPlayer(p) && shareToken ? { shareToken } : {}),
  };
}

export async function feed(): Promise<FeedPostView[]> {
  const [all, results] = await Promise.all([posts().list(), listResults()]);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => postView(p, results));
}

export async function getPost(id: string): Promise<FeedPost> {
  const p = await posts().get(id);
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
  if (report.postId && report.postClub && report.postClub !== currentUser().club?.id) throw new FeedError("This report is already posted in another club.");
  const existing = report.postId ? await posts().get(report.postId) : undefined;
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
  await posts().save(post);
  await changeGame(o, [
    { path: ["report", "postId"], set: id },
    { path: ["report", "postClub"], set: currentUser().club?.id },
  ]);
  await notify(playerIds, `${me.name || sides.me.name} posted the report of your game: ${post.title}`, `#/club/${id}`);
  return post;
}

/**
 * After a game changed: bring its club post up to date (score, names,
 * factions, highlights, the report's text and photos). Quietly: no
 * notifications. Returns the post when there is one.
 */
export async function syncPost(o: OpenGame): Promise<FeedPost | undefined> {
  return inClub(o.game.report?.postClub, () => syncHere(o));
}

async function syncHere(o: OpenGame): Promise<FeedPost | undefined> {
  const report = o.game.report;
  if (!report?.postId || !report.story.trim()) return undefined;
  const existing = await posts().get(report.postId);
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
  return posts().save({ ...next, updatedAt: new Date().toISOString() });
}

export async function deletePost(id: string): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p) && !currentUser().isAdmin) throw new FeedError("Only the game's players can remove its post.", 403);
  for (let n = 0; n < p.photos; n++) await blobs().remove(photoPath(id, n));
  if (p.cardAt) await blobs().remove(cardPath(id)).catch(() => undefined);
  if (p.shareToken) await shareLinks().delete(p.shareToken);
  await posts().delete(id);
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
  return posts().save(p);
}

export async function addComment(id: string, text: string): Promise<FeedPost> {
  const clean = text.trim().slice(0, 1000);
  if (!clean) throw new FeedError("Write something first.");
  limit("comment", 15, 10 * 60_000);
  const p = await getPost(id);
  const me = currentUser();
  p.comments = [...p.comments, { id: newId(), authorId: me.id, authorName: me.name || "A member", text: clean, at: new Date().toISOString() }];
  await posts().save(p);
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
  return posts().save(p);
}

export async function readPostPhoto(id: string, n: number): Promise<Buffer | undefined> {
  const p = await posts().get(id);
  if (!p || !Number.isInteger(n) || n < 0 || n >= p.photos) return undefined;
  return blobs().read(photoPath(id, n));
}

// ---------- public share links ----------

export async function sharePost(id: string): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p)) throw new FeedError("Only the game's players can share its report outside the club.", 403);
  if (p.shareToken) return p;
  p.shareToken = crypto.randomBytes(16).toString("hex");
  await shareLinks().save({ id: p.shareToken, postId: p.id });
  return posts().save(p);
}

export async function unsharePost(id: string): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p) && !currentUser().isAdmin) throw new FeedError("Only the game's players can stop sharing it.", 403);
  if (p.shareToken) await shareLinks().delete(p.shareToken);
  delete p.shareToken;
  return posts().save(p);
}

/** A shared report as anyone with the link sees it: the story, photos and score, nothing about the club. */
export async function publicPost(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return undefined;
  // Shared links are opened without signing in: look in every club's space.
  const clubs = await listClubs();
  const spaces = clubs.length ? clubs.map((c) => c.prefix) : ["club/"];
  let space = "";
  let link: { id: string; postId: string } | undefined;
  for (const s of spaces) {
    link = await shareLinks(s).get(token);
    if (link) {
      space = s;
      break;
    }
  }
  const p = link && (await posts(space).get(link.postId));
  if (!p || p.shareToken !== token) return undefined;
  const { title, story, photos, sides, battleplan, points, date, badges, createdAt, updatedAt, result } = p;
  // The score sheet goes out too; the game log and army lists stay in the club.
  const detail = p.detail && { rounds: p.detail.rounds, tactics: p.detail.tactics };
  return { post: p, space, view: { title, story, photos, sides, battleplan, points, date, badges, createdAt, updatedAt, result, detail } };
}

// ---------- the share picture and page ----------

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** The picture a shared report shows in WhatsApp and the like, drawn by a player's page (web/src/reportCard.ts). */
export async function saveCard(id: string, jpeg: Buffer): Promise<FeedPost> {
  const p = await getPost(id);
  if (!isPlayer(p) && !currentUser().isAdmin) throw new FeedError("Only the game's players can change its post.", 403);
  if (!Buffer.isBuffer(jpeg) || !jpeg.subarray(0, 3).equals(JPEG) || jpeg.length > 2_000_000) throw new FeedError("That picture didn't arrive right.");
  await blobs().write(cardPath(id), jpeg, "image/jpeg");
  // Not an update of the post itself: updatedAt stays, so the card counts as fresh.
  return posts().save({ ...p, cardAt: new Date().toISOString() });
}

export async function readPublicCard(token: string): Promise<Buffer | undefined> {
  const found = await publicPost(token);
  return found?.post.cardAt ? blobs().read(cardPath(found.post.id, found.space)) : undefined;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The page behind a shared report link (/r/<token>, /es/r/<token>): the
 * report's own preview (title, score, its picture), then members go to the
 * post in the club and everyone else to the public report, which invites
 * them to ask for access.
 */
export async function reportPage(token: string, lang: Lang, origin: string): Promise<string> {
  const found = await publicPost(token).catch(() => undefined);
  const p = found?.post;
  const t = (s: string) => translate(s, lang);
  const [a, b] = p?.sides ?? [];
  const result = p?.result === "win" ? "Victory" : p?.result === "loss" ? "Defeat" : p?.result === "draw" ? "Draw" : "";
  const title = p ? p.title : t("A battle report from Thorgrim");
  const description = p && a && b
    ? [`${a.name} ${a.vp}–${b.vp} ${b.name}`, result && t(result), p.battleplan, t("A battle report from Thorgrim")].filter(Boolean).join(" · ")
    : t("The story of a Warhammer Age of Sigmar battle, told as a legend, with the score sheet and the photos.");
  const image = p?.cardAt ? `${origin}/api/public/reports/${token}/card.jpg?v=${encodeURIComponent(p.cardAt)}` : `${origin}/og-report${lang === "es" ? "-es" : ""}.png`;
  const member = p ? `/#/club/${p.id}` : "";
  const visitor = `/#/r/${token}`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0F1115" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Thorgrim" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="${lang === "es" ? "es_ES" : "en_US"}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(image)}" />
<link rel="icon" href="/icon-192.png" />
<script>
  // Members (signed in on this phone) open the post in the club; everyone else the public report.
  var member = false;
  try { member = !!(localStorage.getItem("thorgrim-session") || localStorage.getItem("aos-coach-access-key")); } catch (e) {}
  location.replace(member && ${JSON.stringify(member)} ? ${JSON.stringify(member)} : ${JSON.stringify(visitor)});
</script>
</head>
<body style="margin:0;background:#0f1115;color:#ece6da;font-family:system-ui,sans-serif">
<noscript><p style="padding:24px"><a href="${esc(visitor)}" style="color:#d9ae55">${esc(title)}</a></p></noscript>
</body>
</html>
`;
}

/** Posts made since `iso` (for the weekly digest). */
export const postsSince = async (iso: string) => (await posts().list()).filter((p) => p.createdAt >= iso);

/** A photo of a shared report (no sign-in), from the club it lives in. */
export async function readPublicPhoto(token: string, n: number): Promise<Buffer | undefined> {
  const found = await publicPost(token);
  if (!found || !Number.isInteger(n) || n < 0 || n >= found.post.photos) return undefined;
  return blobs().read(photoPath(found.post.id, n, found.space));
}
