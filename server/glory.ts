// Glory in the club (shared/progress.ts does the counting): each member's
// experience, level, achievements and weekly missions; bounties; predictions
// on upcoming battles; the club's votes (battle of the week, army of the
// month); games being played right now, which members can cheer; and the
// season's wrap-up. Everything lives in the club's space.
//
//   glory/<member id>.json      what a member has unlocked (and when), missions done
//   predictions/<battle>.json   picks for an upcoming battle
//   ballots/<kind-period>.json  votes for the battle of the week / army of the month
//   cheers/<owner-game>.json    cheers for a game in progress

import {
  ACHIEVEMENTS,
  ballotWinner,
  bountiesFrom,
  bountyClaims,
  closedWinners,
  levelOf,
  memberStats,
  MISSION_XP,
  missionProgress,
  monthOf,
  PERFECT_WEEK_XP,
  predictionOutcome,
  weekOf,
  weekRange,
  wrapped,
  xpFrom,
  type Ballot,
  type ClubData,
  type Prediction,
} from "../shared/progress.ts";
import { seasonRanges } from "../shared/ladder.ts";
import type { FeedPost, Game } from "../shared/types.ts";
import { allChallenges } from "./challenges.ts";
import { clubSpace } from "./clubs.ts";
import { currentUser } from "./context.ts";
import { listEvents } from "./events.ts";
import { allPosts, FeedError } from "./feed.ts";
import { listResults, listSeasons } from "./ladder.ts";
import { clubMembers, findMember } from "./members.ts";
import { notify } from "./notices.ts";
import { allArmies } from "./showcase.ts";
import { Collection } from "./store.ts";

interface GloryRecord {
  /** The member's id. */
  id: string;
  /** Achievement id -> when it was first seen unlocked. */
  unlocked: Record<string, string>;
  /** Week -> missions completed that week (kept, so later rule changes don't take XP away). */
  missions: Record<string, string[]>;
  level: number;
}

const records = () => new Collection<GloryRecord>("glory", clubSpace());
const predictions = () => new Collection<Prediction>("predictions", clubSpace());
const ballots = () => new Collection<Ballot & { announced?: boolean }>("ballots", clubSpace());
const cheers = () => new Collection<{ id: string; counts: Record<string, number>; last: Record<string, string> }>("cheers", clubSpace());

const lite = (p: FeedPost) => ({
  id: p.id,
  kind: p.kind ?? ("report" as const),
  authorId: p.authorId,
  playerIds: p.playerIds,
  createdAt: p.createdAt,
  photos: p.photos,
  result: p.result,
  totals: p.detail?.totals ?? [],
  tactics: p.detail?.tactics.me ?? [],
  comments: p.comments.map((c) => ({ authorId: c.authorId, at: c.at })),
  reactors: [...new Set(Object.values(p.reactions).flat())],
});

/** Everything the counting needs, for the current club. */
export async function clubData(): Promise<ClubData> {
  const [results, posts, armies, events, challenges, preds, bs] = await Promise.all([listResults(), allPosts(), allArmies(), listEvents(), allChallenges(), predictions().list(), ballots().list()]);
  return {
    results,
    posts: posts.map(lite),
    armies: armies.map((a) => ({ memberId: a.memberId, armyId: a.id, name: a.name, faction: a.faction, photos: a.photos.length, createdAt: a.createdAt })),
    events: events.map((e) => ({ id: e.id, organiserId: e.organiser.id, date: e.date, playerIds: e.players.map((p) => p.id) })),
    challenges: challenges.map((c) => ({ fromId: c.from.id, toId: c.to.id, status: c.status, createdAt: c.createdAt, answeredAt: c.answeredAt })),
    predictions: preds,
    ballots: bs,
  };
}

// ---------- a member's progress ----------

function progressOf(data: ClubData, id: string, rec: GloryRecord | undefined, now: Date) {
  const s = memberStats(data, id, {}, now);
  const week = weekOf(now);
  const missionsDone = Object.values(rec?.missions ?? {}).reduce((n, ms) => n + ms.length, 0);
  const perfectWeeks = Object.values(rec?.missions ?? {}).filter((ms) => ms.length >= 3).length;
  const sources = [
    ...xpFrom(s),
    ...(missionsDone ? [{ label: "Weekly missions", xp: missionsDone * MISSION_XP + perfectWeeks * PERFECT_WEEK_XP }] : []),
  ];
  const xp = sources.reduce((n, x) => n + x.xp, 0);
  const achievements = ACHIEVEMENTS.map((a) => {
    const done = a.done(s, { perfectWeeks });
    const at = rec?.unlocked[a.id];
    const hidden = a.secret && !done;
    return {
      id: a.id,
      name: hidden ? "???" : a.name,
      description: hidden ? "A secret achievement." : a.description,
      icon: hidden ? ("spark" as const) : a.icon,
      rarity: a.rarity,
      secret: !!a.secret,
      unlocked: done,
      ...(done && at ? { at } : {}),
    };
  });
  return { stats: s, xp, level: levelOf(xp), sources, achievements, perfectWeeks, missions: missionProgress(data, id, week, now), week };
}

/**
 * Works out a member's progress and keeps what's new (achievements, finished
 * missions, a new level), telling them. `quiet`: keep it without telling
 * (the first time, so old deeds don't flood their notices).
 */
async function settle(data: ClubData, id: string, now: Date) {
  const rec = await records().get(id);
  const first = !rec;
  let p = progressOf(data, id, rec, now);
  const next: GloryRecord = rec ? structuredClone(rec) : { id, unlocked: {}, missions: {}, level: 1 };
  const fresh: string[] = [];
  for (const a of p.achievements) if (a.unlocked && !next.unlocked[a.id]) (next.unlocked[a.id] = now.toISOString()), fresh.push(a.id);
  // This week's and last week's missions (a late report still counts).
  const lastWeek = weekOf(new Date(now.getTime() - 7 * 86_400_000));
  const finished: string[] = [];
  for (const w of [lastWeek, p.week]) {
    const done = missionProgress(data, id, w, now).filter((m) => m.done).map((m) => m.id);
    const had = next.missions[w] ?? [];
    const added = done.filter((m) => !had.includes(m));
    if (added.length) {
      next.missions[w] = [...had, ...added];
      finished.push(...added);
    }
  }
  p = progressOf(data, id, next, now);
  // A perfect week can unlock its achievement only now.
  for (const a of p.achievements) if (a.unlocked && !next.unlocked[a.id]) (next.unlocked[a.id] = now.toISOString()), fresh.push(a.id);
  const levelUp = p.level.level > next.level;
  next.level = p.level.level;
  if (fresh.length || finished.length || levelUp || first) await records().save(next);
  // The member's own screen celebrates what's new; others (and the daily run) send notices.
  const news = first ? undefined : { achievements: fresh.map((f) => ACHIEVEMENTS.find((a) => a.id === f)!.name), missions: finished.length, level: levelUp ? p.level : undefined };
  if (!first) {
    const names = fresh.map((f) => ACHIEVEMENTS.find((a) => a.id === f)!.name);
    for (const name of names) await notify([id], `Achievement unlocked: ${name}`, `#/club/member/${id}`);
    if (finished.length) await notify([id], finished.length === 1 ? "Weekly mission complete: +50 XP" : `${finished.length} weekly missions complete: +${finished.length * MISSION_XP} XP`, "#/profile");
    if (levelUp) await notify([id], `You reached level ${p.level.level}: ${p.level.name}`, `#/club/member/${id}`);
  }
  return { ...progressOf(data, id, next, now), unlockedAt: next.unlocked, news };
}

/** The signed-in member's progress (kept, and they hear of anything new). */
export async function myGlory(now = new Date()) {
  const me = currentUser();
  const data = await clubData();
  const p = await settle(data, me.id, now);
  return { ...view(p, data, me.id, true), news: p.news };
}

/** Another member's progress, as the club sees it (no missions). */
export async function memberGlory(id: string, now = new Date()) {
  const m = await findMember(id);
  if (!m) throw new FeedError("That member isn't in the club.", 404);
  const data = await clubData();
  const p = progressOf(data, id, await records().get(id), now);
  return view(p, data, id, false);
}

function view(p: ReturnType<typeof progressOf>, data: ClubData, id: string, own: boolean) {
  return {
    xp: p.xp,
    level: p.level,
    sources: p.sources,
    achievements: p.achievements,
    ...(own ? { missions: p.missions, week: p.week, weekEnds: weekRange(p.week).to } : {}),
    bountiesClaimed: bountyClaims(data.results)
      .filter((c) => c.winnerId === id)
      .map((c) => ({ target: c.targetName, date: c.date })),
  };
}

/** Every member's level, best first. */
export async function gloryBoard(now = new Date()) {
  const [members, data, recs] = await Promise.all([clubMembers(), clubData(), records().list()]);
  return members
    .map((m) => {
      const p = progressOf(data, m.id, recs.find((r) => r.id === m.id), now);
      return { id: m.id, name: m.name, xp: p.xp, level: p.level.level, levelName: p.level.name, achievements: p.achievements.filter((a) => a.unlocked).length };
    })
    .sort((a, b) => b.xp - a.xp);
}

/** Every day: keep each member's progress, and tell them what's new. */
export async function settleAll(now = new Date()) {
  const [members, data] = await Promise.all([clubMembers(), clubData()]);
  for (const m of members) await settle(data, m.id, now);
  return members.length;
}

export async function bounties() {
  return bountiesFrom(await listResults());
}

// ---------- predictions ----------

interface Upcoming {
  id: string;
  label: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  resultIds: string[];
}

/** Battles still to be played: accepted challenges and the current round of running events. */
async function upcoming(): Promise<Upcoming[]> {
  const [challenges, events, results] = await Promise.all([allChallenges(), listEvents(), listResults()]);
  const played = new Set(results.map((r) => r.id));
  const out: Upcoming[] = [];
  for (const c of challenges)
    if (c.status === "accepted" && c.gameId && !played.has(c.gameId)) out.push({ id: `ch-${c.id}`, label: "Challenge", a: c.from, b: c.to, resultIds: [c.gameId] });
  for (const e of events) {
    if (e.finishedAt) continue;
    const round = e.pairings[e.pairings.length - 1];
    if (!round) continue;
    round.tables.forEach((t, i) => {
      if (!t.b) return;
      const ids = [`ev-${e.id}-${round.round}-${i}`, ...(t.gameId ? [t.gameId] : [])];
      if (ids.some((x) => played.has(x))) return;
      const name = (pid: string) => e.players.find((p) => p.id === pid)?.name ?? "Player";
      out.push({ id: `ev-${e.id}-${round.round}-${i}`, label: `${e.name} · round ${round.round}`, a: { id: t.a, name: name(t.a) }, b: { id: t.b, name: name(t.b) }, resultIds: ids });
    });
  }
  return out;
}

/** Upcoming battles with the club's picks, and the last fortnight's settled ones. */
export async function listPredictions(now = new Date()) {
  const me = currentUser().id;
  const [open, stored, results] = await Promise.all([upcoming(), predictions().list(), listResults()]);
  const shape = (u: Upcoming, p?: Prediction) => {
    const picks = Object.values(p?.picks ?? {});
    const outcome = p ? predictionOutcome(p, results) : undefined;
    return {
      id: u.id,
      label: u.label,
      a: u.a,
      b: u.b,
      picks: { a: picks.filter((x) => x.pick === "a").length, b: picks.filter((x) => x.pick === "b").length },
      mine: p?.picks[me]?.pick ?? null,
      playing: u.a.id === me || u.b.id === me,
      ...(outcome ? { outcome } : {}),
    };
  };
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  return {
    upcoming: open.map((u) => shape(u, stored.find((p) => p.id === u.id))),
    settled: stored
      .filter((p) => predictionOutcome(p, results) && p.createdAt >= since)
      .map((p) => shape(p, p))
      .slice(0, 10),
  };
}

export async function predict(battleId: string, pick: "a" | "b", now = new Date()) {
  const me = currentUser().id;
  const u = (await upcoming()).find((x) => x.id === battleId);
  if (!u) throw new FeedError("That battle isn't open for predictions any more.");
  if (u.a.id === me || u.b.id === me) throw new FeedError("You can't predict your own battle.");
  const p = (await predictions().get(battleId)) ?? { ...u, createdAt: now.toISOString(), picks: {} };
  p.picks[me] = { pick, at: now.toISOString() };
  await predictions().save(p);
  return listPredictions(now);
}

// ---------- the club's votes ----------

/** This week's battle-of-the-week ballot and this month's army ballot, with last period's winners. */
export async function votes(now = new Date()) {
  const me = currentUser().id;
  const week = weekOf(now);
  const month = monthOf(now);
  const [b, a, posts, armies] = await Promise.all([ballots().get(`battle-${week}`), ballots().get(`army-${month}`), allPosts(), allArmies()]);
  const tally = (bl?: Ballot) => {
    const t: Record<string, number> = {};
    for (const c of Object.values(bl?.votes ?? {})) t[c] = (t[c] ?? 0) + 1;
    return t;
  };
  const lastWeek = weekOf(new Date(Date.parse(weekRange(week).from) - 86_400_000));
  const lastMonth = monthOf(new Date(Date.parse(`${month}-01`) - 86_400_000));
  const [lw, lm] = await Promise.all([ballots().get(`battle-${lastWeek}`), ballots().get(`army-${lastMonth}`)]);
  const wPost = posts.find((p) => p.id === ballotWinner(lw));
  const wArmyKey = ballotWinner(lm);
  const wArmy = wArmyKey ? armies.find((x) => `${x.memberId}:${x.id}` === wArmyKey) : undefined;
  return {
    battle: { week, ends: weekRange(week).to, counts: tally(b), mine: b?.votes[me] ?? null },
    army: { month, counts: tally(a), mine: a?.votes[me] ?? null },
    lastBattle: wPost ? { postId: wPost.id, title: wPost.title, author: wPost.authorName, week: lastWeek } : null,
    lastArmy: wArmy ? { memberId: wArmy.memberId, armyId: wArmy.id, name: wArmy.name, faction: wArmy.faction, month: lastMonth } : null,
  };
}

export async function voteBattle(postId: string, now = new Date()) {
  const me = currentUser().id;
  const post = (await allPosts()).find((p) => p.id === postId);
  if (!post || (post.kind ?? "report") !== "report") throw new FeedError("That report isn't in the club feed.");
  const week = weekOf(now);
  if (weekOf(post.createdAt) !== week) throw new FeedError("Only this week's reports are in the running.");
  if (post.authorId === me || post.playerIds.includes(me)) throw new FeedError("You can't vote for your own battle.");
  const id = `battle-${week}`;
  const b = (await ballots().get(id)) ?? { id, kind: "battle" as const, period: week, votes: {} };
  b.votes[me] = postId;
  await ballots().save(b);
  return votes(now);
}

export async function voteArmy(memberId: string, armyId: string, now = new Date()) {
  const me = currentUser().id;
  if (memberId === me) throw new FeedError("You can't vote for your own army.");
  if (!(await allArmies()).some((a) => a.memberId === memberId && a.id === armyId)) throw new FeedError("That army isn't in the showcase.");
  const month = monthOf(now);
  const id = `army-${month}`;
  const b = (await ballots().get(id)) ?? { id, kind: "army" as const, period: month, votes: {} };
  b.votes[me] = `${memberId}:${armyId}`;
  await ballots().save(b);
  return votes(now);
}

/** Tells the club who won a closed ballot, once. */
export async function announceWinners(now = new Date()) {
  const [all, posts, armies, members] = await Promise.all([ballots().list(), allPosts(), allArmies(), clubMembers()]);
  const ids = members.map((m) => m.id);
  let told = 0;
  for (const w of closedWinners({ ballots: all } as ClubData, now)) {
    const b = all.find((x) => x.kind === w.kind && x.period === w.period)!;
    if (b.announced) continue;
    if (w.kind === "battle") {
      const p = posts.find((x) => x.id === w.winner);
      if (p) await notify(ids, (lang) => (lang === "es" ? `Batalla de la semana: «${p.title}» de ${p.authorName}` : `Battle of the week: "${p.title}" by ${p.authorName}`), `#/club/${p.id}`);
    } else {
      const a = armies.find((x) => `${x.memberId}:${x.id}` === w.winner);
      const owner = members.find((m) => m.id === a?.memberId);
      if (a) await notify(ids, (lang) => (lang === "es" ? `Ejército del mes: ${a.name} (${a.faction}) de ${owner?.name ?? "un miembro"}` : `Army of the month: ${a.name} (${a.faction}) by ${owner?.name ?? "a member"}`), `#/club/member/${a.memberId}`);
    }
    await ballots().save({ ...b, announced: true });
    told++;
  }
  return told;
}

// ---------- games in progress ----------

const LIVE_HOURS = 4;

/** Members' games being played right now (something happened in the last hours), for the club to follow. */
export async function liveGames(now = new Date()) {
  const members = await clubMembers();
  const cheer = await cheers().list();
  const out = [];
  for (const m of members) {
    for (const g of await new Collection<Game>("games", m.prefix).list()) {
      // Under way: something was logged (a game set up and never started isn't live).
      if (g.finished || !g.state || g.state.round < 1 || !g.log?.length) continue;
      const lastAt = g.log[g.log.length - 1].at;
      if (now.getTime() - Date.parse(lastAt) > LIVE_HOURS * 3_600_000) continue;
      out.push({
        ownerId: m.id,
        ownerName: m.name,
        gameId: g.id,
        opponentName: g.opponentName || "Opponent",
        myFaction: g.myFaction ?? "",
        opponentFaction: g.opponentFaction ?? "",
        battleplan: g.battleplan ?? "",
        round: g.state.round,
        vp: g.state.vp,
        lastAt,
        cheers: cheer.find((c) => c.id === `${m.id}-${g.id}`)?.counts ?? {},
      });
    }
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export const CHEERS = ["fire", "skull", "shield", "laugh"] as const;
const CHEER_TEXT: Record<(typeof CHEERS)[number], { en: string; es: string }> = {
  fire: { en: "🔥", es: "🔥" },
  skull: { en: "💀", es: "💀" },
  shield: { en: "🛡️", es: "🛡️" },
  laugh: { en: "😂", es: "😂" },
};

/** Cheer a game in progress (once every 2 minutes per member and game); the player hears of it. */
export async function cheer(ownerId: string, gameId: string, kind: string, now = new Date()) {
  if (!(CHEERS as readonly string[]).includes(kind)) throw new FeedError("Unknown cheer.");
  const live = (await liveGames(now)).find((g) => g.ownerId === ownerId && g.gameId === gameId);
  if (!live) throw new FeedError("That game isn't being played right now.");
  const me = currentUser();
  const id = `${ownerId}-${gameId}`;
  const c = (await cheers().get(id)) ?? { id, counts: {}, last: {} };
  const last = c.last[me.id];
  if (last && now.getTime() - Date.parse(last) < 120_000) return liveGames(now);
  c.counts[kind] = (c.counts[kind] ?? 0) + 1;
  c.last[me.id] = now.toISOString();
  await cheers().save(c);
  if (ownerId !== me.id) {
    const icon = CHEER_TEXT[kind as (typeof CHEERS)[number]];
    await notify([ownerId], (lang) => (lang === "es" ? `${me.name || "Un miembro"} te anima en tu partida ${icon.es}` : `${me.name || "A member"} cheers your game ${icon.en}`), `#/games/${gameId}`);
  }
  return liveGames(now);
}

// ---------- the season's wrap-up ----------

/** A member's wrap-up for a season (the current one by default; all time when there are no seasons). */
export async function seasonWrapped(memberId: string, seasonId?: string, now = new Date()) {
  const m = await findMember(memberId);
  if (!m) throw new FeedError("That member isn't in the club.", 404);
  const seasons = seasonRanges(await listSeasons());
  // Latest first: the current season is the first.
  const s = (seasonId ? seasons.find((x) => x.id === seasonId) : seasons[0]) ?? { id: "all", name: "All time", start: "0000-01-01" };
  return {
    ...wrapped(await clubData(), { id: m.id, name: m.name }, s, now),
    seasons: seasons.map((x) => ({ id: x.id, name: x.name })),
  };
}
