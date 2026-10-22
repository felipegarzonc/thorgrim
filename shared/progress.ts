// Glory: experience, levels, achievements, weekly missions, bounties and the
// season's wrap-up, all worked out from what the club already records
// (confirmed results, reports, comments, reactions, the army showcase,
// events, challenges, predictions and votes). Pure functions: the server
// (server/progress.ts) gathers the club's data and keeps what was unlocked.

import { standings, winnerOf, type ClubResult } from "./ladder.ts";
import { baseFaction } from "./season.ts";

// ---------- the club's data, as these functions need it ----------

export interface PostLite {
  id: string;
  kind: "report" | "chronicle";
  authorId: string;
  playerIds: string[];
  createdAt: string;
  photos: number;
  result: "win" | "loss" | "draw" | null;
  /** VP after each round, the poster's side as "me". */
  totals: { me: number; opponent: number }[];
  /** The poster's battle tactic cards and the steps done. */
  tactics: { card: string; done: string[] }[];
  comments: { authorId: string; at: string }[];
  /** Who reacted (any emoji). */
  reactors: string[];
}

export interface ArmyLite {
  memberId: string;
  armyId: string;
  name: string;
  faction: string;
  photos: number;
  createdAt: string;
}

export interface Prediction {
  /** The battle: "ch-<challenge id>" or "ev-<event>-<round>-<table>". */
  id: string;
  label: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** The results that settle it (a challenge's game, an event table's game or paper result). */
  resultIds: string[];
  createdAt: string;
  picks: Record<string, { pick: "a" | "b"; at: string }>;
}

export interface Ballot {
  /** "battle-<week>" (a report) or "army-<YYYY-MM>" (a showcase army). */
  id: string;
  kind: "battle" | "army";
  period: string;
  /** Voter id -> candidate (post id, or "<member id>:<army id>"). */
  votes: Record<string, string>;
}

export interface ClubData {
  results: ClubResult[];
  posts: PostLite[];
  armies: ArmyLite[];
  events: { id: string; organiserId: string; date: string; playerIds: string[] }[];
  challenges: { fromId: string; toId: string; status: string; createdAt: string; answeredAt?: string }[];
  predictions: Prediction[];
  ballots: Ballot[];
}

export interface Window {
  /** Inclusive, ISO date or datetime. */
  from?: string;
  /** Exclusive. */
  to?: string;
}
const inWindow = (at: string, w: Window = {}) => (!w.from || at >= w.from) && (!w.to || at < w.to);

// ---------- weeks and months ----------

/** The ISO week of a date, e.g. "2026-W43" (weeks start on Monday, UTC). */
export function weekOf(at: string | Date): string {
  const d = new Date(typeof at === "string" ? at : at.toISOString());
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The Monday that starts a week and the next Monday, as ISO dates. */
export function weekRange(week: string): { from: string; to: string } {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000 + (w - 1) * 7 * 86_400_000);
  const next = new Date(monday.getTime() + 7 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: next.toISOString().slice(0, 10) };
}

export const monthOf = (at: string | Date) => (typeof at === "string" ? at : at.toISOString()).slice(0, 7);
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

// ---------- votes ----------

/** The winner of a ballot: most votes (at least one), ties to the earliest-cast. */
export function ballotWinner(b: Ballot | undefined): string | undefined {
  if (!b) return undefined;
  const count = new Map<string, number>();
  for (const c of Object.values(b.votes)) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
}

/** Ballots whose period is over, with their winners. */
export function closedWinners(data: ClubData, now: Date): { kind: "battle" | "army"; period: string; winner: string }[] {
  const out: { kind: "battle" | "army"; period: string; winner: string }[] = [];
  for (const b of data.ballots) {
    const over = b.kind === "battle" ? weekRange(b.period).to <= now.toISOString().slice(0, 10) : nextMonth(b.period) <= monthOf(now);
    const w = over ? ballotWinner(b) : undefined;
    if (w) out.push({ kind: b.kind, period: b.period, winner: w });
  }
  return out;
}

// ---------- bounties ----------

export interface Bounty {
  id: string;
  name: string;
  reason: "leader" | "streak";
  streak?: number;
}

/** Who is wanted now: the ladder's leader (3+ games) and anyone on 3+ wins in a row. */
export function bountiesFrom(results: ClubResult[]): Bounty[] {
  const sorted = [...results].sort((x, y) => x.date.localeCompare(y.date) || x.confirmedAt.localeCompare(y.confirmedAt));
  const streak = new Map<string, number>();
  for (const r of sorted) {
    const w = winnerOf(r);
    r.players.slice(0, 2).forEach((p, i) => streak.set(p.id, w === i ? (streak.get(p.id) ?? 0) + 1 : 0));
  }
  const table = standings(results);
  const out: Bounty[] = [];
  const leader = table[0];
  if (leader && leader.played >= 3) out.push({ id: leader.id, name: leader.name, reason: "leader" });
  for (const s of table)
    if ((streak.get(s.id) ?? 0) >= 3 && s.id !== leader?.id) out.push({ id: s.id, name: s.name, reason: "streak", streak: streak.get(s.id) });
  return out;
}

/** Bounties claimed: wins over someone who was wanted when the game was played. */
export function bountyClaims(results: ClubResult[]): { winnerId: string; targetId: string; targetName: string; date: string; resultId: string }[] {
  const sorted = [...results].sort((x, y) => x.date.localeCompare(y.date) || x.confirmedAt.localeCompare(y.confirmedAt));
  const claims: { winnerId: string; targetId: string; targetName: string; date: string; resultId: string }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const w = winnerOf(r);
    if (w === null) continue;
    const wanted = new Set(bountiesFrom(sorted.slice(0, i)).map((b) => b.id));
    const loser = r.players[1 - w];
    if (wanted.has(loser.id)) claims.push({ winnerId: r.players[w].id, targetId: loser.id, targetName: loser.name, date: r.date, resultId: r.id });
  }
  return claims;
}

// ---------- a member's numbers ----------

export interface MemberStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  opponents: string[];
  newOpponents: number;
  opponentFactions: string[];
  factionsPlayed: string[];
  bestStreak: number;
  crushingWins: number;
  closeWins: number;
  comebacks: number;
  tacticSteps: number;
  tacticsMastered: number;
  reports: number;
  reportsWithPhotos: number;
  /** Posts by others this member commented on. */
  postsCommented: number;
  comments: number;
  /** Posts by others this member reacted to. */
  reactionsGiven: number;
  reactionsReceived: number;
  armies: number;
  armyPhotos: number;
  /** Armies with 3+ photos. */
  paintedArmies: number;
  eventsPlayed: number;
  eventsOrganised: number;
  challengesSent: number;
  challengesAccepted: number;
  bountiesClaimed: number;
  predictionsMade: number;
  predictionsCorrect: number;
  votesCast: number;
  battlesOfTheWeek: number;
  armiesOfTheMonth: number;
}

/** Who won a prediction's battle, once a result settles it. */
export function predictionOutcome(p: Prediction, results: ClubResult[]): "a" | "b" | "draw" | undefined {
  const r = results.find((x) => p.resultIds.includes(x.id));
  if (!r) return undefined;
  const w = winnerOf(r);
  if (w === null) return "draw";
  return r.players[w].id === p.a.id ? "a" : "b";
}

export function memberStats(data: ClubData, id: string, w: Window = {}, now = new Date()): MemberStats {
  const mine = [...data.results].filter((r) => r.players.slice(0, 2).some((p) => p.id === id)).sort((x, y) => x.date.localeCompare(y.date) || x.confirmedAt.localeCompare(y.confirmedAt));
  const before = new Set<string>();
  let wins = 0,
    draws = 0,
    losses = 0,
    streak = 0,
    bestStreak = 0,
    crushingWins = 0,
    closeWins = 0,
    newOpponents = 0;
  const opponents = new Set<string>();
  const oppFactions = new Set<string>();
  const played = new Set<string>();
  for (const r of mine) {
    const i = r.players.findIndex((p) => p.id === id);
    const me = r.players[i];
    const them = r.players[1 - i];
    const win = winnerOf(r);
    const counted = inWindow(r.date, w);
    if (counted) {
      if (!before.has(them.id)) newOpponents++;
      opponents.add(them.id);
      if (them.faction) oppFactions.add(baseFaction(them.faction));
      if (me.faction) played.add(baseFaction(me.faction));
      if (win === null) draws++;
      else if (win === i) {
        wins++;
        const margin = me.vp - them.vp;
        if (margin >= 25) crushingWins++;
        if (margin > 0 && margin <= 3) closeWins++;
      } else losses++;
    }
    before.add(them.id);
    streak = win === i ? streak + 1 : 0;
    if (counted) bestStreak = Math.max(bestStreak, streak);
  }
  const myPosts = data.posts.filter((p) => p.kind === "report" && p.authorId === id && inWindow(p.createdAt, w));
  const comebacks = myPosts.filter((p) => p.result === "win" && p.totals.some((t) => t.me < t.opponent)).length;
  const tactics = myPosts.flatMap((p) => p.tactics);
  const others = data.posts.filter((p) => p.authorId !== id);
  const commentsMine = others.flatMap((p) => p.comments.filter((c) => c.authorId === id && inWindow(c.at, w)).map(() => p.id));
  const myArmies = data.armies.filter((a) => a.memberId === id);
  const preds = data.predictions.filter((p) => p.picks[id] && inWindow(p.picks[id].at, w));
  const closed = closedWinners(data, now).filter((c) => inWindow(c.kind === "battle" ? weekRange(c.period).from : `${c.period}-01`, w));
  const challengesIn = data.challenges.filter((c) => inWindow(c.createdAt, w));
  return {
    games: wins + draws + losses,
    wins,
    draws,
    losses,
    opponents: [...opponents],
    newOpponents,
    opponentFactions: [...oppFactions],
    factionsPlayed: [...played],
    bestStreak,
    crushingWins,
    closeWins,
    comebacks,
    tacticSteps: tactics.reduce((n, t) => n + t.done.length, 0),
    tacticsMastered: tactics.filter((t) => t.done.length >= 3).length,
    reports: myPosts.length,
    reportsWithPhotos: myPosts.filter((p) => p.photos > 0).length,
    postsCommented: new Set(commentsMine).size,
    comments: commentsMine.length,
    // Reactions carry no date: they count for all time.
    reactionsGiven: w.from || w.to ? 0 : others.filter((p) => p.reactors.includes(id)).length,
    reactionsReceived: data.posts.filter((p) => p.authorId === id && inWindow(p.createdAt, w)).reduce((n, p) => n + p.reactors.filter((r) => r !== id).length, 0),
    armies: myArmies.filter((a) => inWindow(a.createdAt, w)).length,
    armyPhotos: myArmies.filter((a) => inWindow(a.createdAt, w)).reduce((n, a) => n + Math.min(a.photos, 5), 0),
    paintedArmies: myArmies.filter((a) => a.photos >= 3 && inWindow(a.createdAt, w)).length,
    eventsPlayed: data.events.filter((e) => e.playerIds.includes(id) && inWindow(e.date, w)).length,
    eventsOrganised: data.events.filter((e) => e.organiserId === id && inWindow(e.date, w)).length,
    challengesSent: challengesIn.filter((c) => c.fromId === id).length,
    challengesAccepted: challengesIn.filter((c) => c.toId === id && c.status === "accepted").length,
    bountiesClaimed: bountyClaims(data.results).filter((c) => c.winnerId === id && inWindow(c.date, w)).length,
    predictionsMade: preds.length,
    predictionsCorrect: preds.filter((p) => predictionOutcome(p, data.results) === p.picks[id].pick).length,
    votesCast: data.ballots.filter((b) => b.votes[id] && (!w.from || (b.kind === "battle" ? weekRange(b.period).from >= w.from.slice(0, 10) : b.period >= w.from.slice(0, 7)))).length,
    battlesOfTheWeek: closed.filter((c) => c.kind === "battle" && data.posts.find((p) => p.id === c.winner)?.authorId === id).length,
    armiesOfTheMonth: closed.filter((c) => c.kind === "army" && c.winner.startsWith(`${id}:`)).length,
  };
}

// ---------- experience and levels ----------

/** Where experience comes from (the profile shows this). */
export function xpFrom(s: MemberStats): { label: string; xp: number }[] {
  return [
    { label: "Games played", xp: s.games * 40 },
    { label: "Wins", xp: s.wins * 30 + s.draws * 15 },
    { label: "Battle tactics", xp: s.tacticSteps * 2 + s.tacticsMastered * 10 },
    { label: "Battle reports", xp: s.reports * 25 + s.reportsWithPhotos * 10 },
    { label: "Club life", xp: s.postsCommented * 3 + s.reactionsGiven + s.challengesSent * 5 + s.challengesAccepted * 10 + s.votesCast * 5 },
    { label: "Showcase", xp: s.armies * 30 + s.armyPhotos * 5 },
    { label: "Events", xp: s.eventsPlayed * 30 + s.eventsOrganised * 40 },
    { label: "Bounties", xp: s.bountiesClaimed * 100 },
    { label: "Predictions", xp: s.predictionsCorrect * 10 },
    { label: "Club votes won", xp: s.battlesOfTheWeek * 75 + s.armiesOfTheMonth * 100 },
  ].filter((x) => x.xp > 0);
}

export const MISSION_XP = 50;
export const PERFECT_WEEK_XP = 50;

export const LEVELS = [
  { xp: 0, name: "Recruit" },
  { xp: 100, name: "Sworn Warrior" },
  { xp: 250, name: "Veteran" },
  { xp: 500, name: "Sergeant" },
  { xp: 850, name: "Champion" },
  { xp: 1300, name: "Hero" },
  { xp: 1900, name: "Captain" },
  { xp: 2700, name: "Warlord" },
  { xp: 3700, name: "Grand Marshal" },
  { xp: 5000, name: "Legend of the Realms" },
];

export function levelOf(xp: number): { level: number; name: string; xp: number; floor: number; next: number | null } {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  return { level: i + 1, name: LEVELS[i].name, xp, floor: LEVELS[i].xp, next: LEVELS[i + 1]?.xp ?? null };
}

// ---------- achievements ----------

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: "swords" | "flag" | "spark" | "skull" | "shield" | "castle" | "pencil" | "camera" | "coach" | "calendar" | "flame" | "map";
  rarity: "common" | "rare" | "epic" | "legendary";
  /** Hidden (name and description) until unlocked. */
  secret?: boolean;
  done: (s: MemberStats, extra: { perfectWeeks: number }) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-blood", name: "First Blood", description: "Play your first club game.", icon: "swords", rarity: "common", done: (s) => s.games >= 1 },
  { id: "first-victory", name: "First Victory", description: "Win a club game.", icon: "flag", rarity: "common", done: (s) => s.wins >= 1 },
  { id: "seasoned", name: "Battle-Hardened", description: "Play 10 club games.", icon: "shield", rarity: "rare", done: (s) => s.games >= 10 },
  { id: "tireless", name: "Tireless", description: "Play 25 club games.", icon: "shield", rarity: "epic", done: (s) => s.games >= 25 },
  { id: "table-legend", name: "Legend of the Table", description: "Play 50 club games.", icon: "castle", rarity: "legendary", done: (s) => s.games >= 50 },
  { id: "comeback", name: "Epic Comeback", description: "Win a game you were losing at the end of a round.", icon: "flame", rarity: "rare", done: (s) => s.comebacks >= 1 },
  { id: "crushing", name: "Crushing Victory", description: "Win by 25 points or more.", icon: "skull", rarity: "rare", done: (s) => s.crushingWins >= 1 },
  { id: "close-call", name: "By a Hair", description: "Win by 3 points or fewer.", icon: "spark", rarity: "rare", done: (s) => s.closeWins >= 1 },
  { id: "unstoppable", name: "Unstoppable", description: "Win 3 club games in a row.", icon: "flame", rarity: "epic", done: (s) => s.bestStreak >= 3 },
  { id: "undefeated", name: "Undefeated", description: "Win 5 club games in a row.", icon: "flame", rarity: "legendary", secret: true, done: (s) => s.bestStreak >= 5 },
  { id: "dead-even", name: "Dead Even", description: "Draw a club game.", icon: "swords", rarity: "rare", secret: true, done: (s) => s.draws >= 1 },
  { id: "well-met", name: "Well Met", description: "Play 5 different members.", icon: "swords", rarity: "rare", done: (s) => s.opponents.length >= 5 },
  { id: "realms-seen", name: "Seen the Realms", description: "Face 10 different armies.", icon: "map", rarity: "epic", done: (s) => s.opponentFactions.length >= 10 },
  { id: "mercenary", name: "Mercenary", description: "Play 3 different armies.", icon: "map", rarity: "rare", done: (s) => s.factionsPlayed.length >= 3 },
  { id: "tactician", name: "Master Tactician", description: "Complete all three steps of a battle tactic card.", icon: "spark", rarity: "rare", done: (s) => s.tacticsMastered >= 1 },
  { id: "strategist", name: "Grand Strategist", description: "Master 10 battle tactic cards.", icon: "spark", rarity: "epic", done: (s) => s.tacticsMastered >= 10 },
  { id: "first-chronicle", name: "First Chronicle", description: "Post a battle report.", icon: "pencil", rarity: "common", done: (s) => s.reports >= 1 },
  { id: "chronicler", name: "Chronicler", description: "Post 10 battle reports.", icon: "pencil", rarity: "epic", done: (s) => s.reports >= 10 },
  { id: "war-correspondent", name: "War Correspondent", description: "Post 5 reports with photos.", icon: "camera", rarity: "rare", done: (s) => s.reportsWithPhotos >= 5 },
  { id: "steady-brush", name: "Steady Brush", description: "Show an army with 3 or more photos.", icon: "camera", rarity: "rare", done: (s) => s.paintedArmies >= 1 },
  { id: "collector", name: "Collector", description: "Show 3 armies.", icon: "castle", rarity: "epic", done: (s) => s.armies >= 3 },
  { id: "voice", name: "Voice of the Club", description: "Comment on 20 members' posts.", icon: "coach", rarity: "rare", done: (s) => s.postsCommented >= 20 },
  { id: "cheerleader", name: "Cheerleader", description: "React to 50 members' posts.", icon: "flame", rarity: "rare", done: (s) => s.reactionsGiven >= 50 },
  { id: "beloved", name: "Beloved of the Club", description: "Get 25 reactions on your reports.", icon: "flame", rarity: "epic", done: (s) => s.reactionsReceived >= 25 },
  { id: "kingslayer", name: "Kingslayer", description: "Beat a wanted player: the ladder's leader or someone on a winning streak.", icon: "skull", rarity: "epic", done: (s) => s.bountiesClaimed >= 1 },
  { id: "oracle", name: "Oracle", description: "Predict 5 battles right.", icon: "spark", rarity: "rare", done: (s) => s.predictionsCorrect >= 5 },
  { id: "battle-of-the-week", name: "Battle of the Week", description: "The club votes your report the week's best.", icon: "flag", rarity: "epic", done: (s) => s.battlesOfTheWeek >= 1 },
  { id: "army-of-the-month", name: "Army of the Month", description: "The club votes your army the month's best.", icon: "camera", rarity: "legendary", done: (s) => s.armiesOfTheMonth >= 1 },
  { id: "tournament-player", name: "Tournament Player", description: "Play a club event.", icon: "calendar", rarity: "common", done: (s) => s.eventsPlayed >= 1 },
  { id: "organiser", name: "Organiser", description: "Organise a club event.", icon: "calendar", rarity: "rare", done: (s) => s.eventsOrganised >= 1 },
  { id: "challenger", name: "Challenger", description: "Challenge members 3 times.", icon: "swords", rarity: "common", done: (s) => s.challengesSent >= 3 },
  { id: "perfect-week", name: "Perfect Week", description: "Complete all three weekly missions.", icon: "flag", rarity: "epic", done: (_s, x) => x.perfectWeeks >= 1 },
];

// ---------- weekly missions ----------

export interface Mission {
  id: string;
  text: string;
  target: number;
  measure: (s: MemberStats) => number;
}

const PLAY: Mission[] = [
  { id: "play-1", text: "Play a club game", target: 1, measure: (s) => s.games },
  { id: "play-2", text: "Play 2 club games", target: 2, measure: (s) => s.games },
  { id: "new-foe", text: "Play a member you've never played", target: 1, measure: (s) => s.newOpponents },
  { id: "win-1", text: "Win a club game", target: 1, measure: (s) => s.wins },
];
const MORE: Mission[] = [
  { id: "tactic-master", text: "Complete all three steps of a battle tactic card", target: 1, measure: (s) => s.tacticsMastered },
  { id: "tactics-4", text: "Complete 4 battle tactic steps", target: 4, measure: (s) => s.tacticSteps },
  { id: "report-photo", text: "Post a battle report with a photo", target: 1, measure: (s) => s.reportsWithPhotos },
  { id: "report", text: "Post a battle report", target: 1, measure: (s) => s.reports },
  { id: "comment-3", text: "Comment on 3 members' posts", target: 3, measure: (s) => s.postsCommented },
  { id: "challenge", text: "Challenge a member", target: 1, measure: (s) => s.challengesSent },
  { id: "predict-2", text: "Predict 2 battles", target: 2, measure: (s) => s.predictionsMade },
  { id: "vote", text: "Vote for the battle of the week", target: 1, measure: (s) => s.votesCast },
];
export const MISSIONS = [...PLAY, ...MORE];

/** A small, stable random number from a text (so a member's missions don't change during the week). */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A member's three missions for a week: one at the table, two around the club. */
export function missionsFor(memberId: string, week: string): Mission[] {
  const rand = seeded(`${memberId}:${week}`);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const more = [...MORE];
  const first = pick(more);
  more.splice(more.indexOf(first), 1);
  return [pick(PLAY), first, pick(more)];
}

export function missionProgress(data: ClubData, memberId: string, week: string, now = new Date()) {
  const s = memberStats(data, memberId, weekRange(week), now);
  return missionsFor(memberId, week).map((m) => {
    const value = Math.min(m.measure(s), m.target);
    return { id: m.id, text: m.text, target: m.target, value, done: value >= m.target };
  });
}

// ---------- the season's wrap-up ----------

export interface Wrapped {
  member: { id: string; name: string };
  season: { name: string; from: string; to?: string };
  games: number;
  wins: number;
  draws: number;
  losses: number;
  favouriteArmy?: { faction: string; games: number };
  nemesis?: { name: string; won: number; lost: number };
  favouriteFoe?: { name: string; won: number; lost: number };
  biggestWin?: { opponent: string; score: string; date: string };
  comebacks: number;
  tacticsMastered: number;
  reports: number;
  reactionsReceived: number;
  xp: number;
  title: string;
}

export function wrapped(data: ClubData, member: { id: string; name: string }, season: { name: string; start: string; end?: string }, now = new Date()): Wrapped {
  const w = { from: season.start, to: season.end };
  const s = memberStats(data, member.id, w, now);
  const games = data.results.filter((r) => inWindow(r.date, w) && r.players.slice(0, 2).some((p) => p.id === member.id));
  const armies = new Map<string, number>();
  const vs = new Map<string, { name: string; won: number; lost: number }>();
  const beaten = new Map<string, number>();
  let biggest: Wrapped["biggestWin"];
  let margin = 0;
  for (const r of games) {
    const i = r.players.findIndex((p) => p.id === member.id);
    const me = r.players[i];
    const them = r.players[1 - i];
    if (me.faction) armies.set(baseFaction(me.faction), (armies.get(baseFaction(me.faction)) ?? 0) + 1);
    const h = vs.get(them.id) ?? { name: them.name, won: 0, lost: 0 };
    const win = winnerOf(r);
    if (win === i) {
      h.won++;
      if (them.faction) beaten.set(baseFaction(them.faction), (beaten.get(baseFaction(them.faction)) ?? 0) + 1);
      if (me.vp - them.vp > margin) {
        margin = me.vp - them.vp;
        biggest = { opponent: them.name, score: `${me.vp}-${them.vp}`, date: r.date };
      }
    } else if (win !== null) h.lost++;
    vs.set(them.id, h);
  }
  const fav = [...armies.entries()].sort((a, b) => b[1] - a[1])[0];
  const nemesis = [...vs.values()].filter((h) => h.lost > h.won).sort((a, b) => b.lost - a.lost)[0];
  const foe = [...vs.values()].filter((h) => h.won > h.lost).sort((a, b) => b.won - a.won)[0];
  const scourge = [...beaten.entries()].sort((a, b) => b[1] - a[1])[0];
  const title =
    s.games === 0
      ? "Keeper of the Sidelines"
      : s.comebacks >= 2
        ? "The Unbreakable"
        : scourge && scourge[1] >= 3
          ? `Scourge of ${scourge[0]}`
          : s.bestStreak >= 3
            ? "The Unstoppable"
            : s.reports >= 5
              ? "The Chronicler"
              : s.draws >= 2
                ? "The Even Hand"
                : s.games >= 10
                  ? "The Tireless"
                  : s.wins > s.losses
                    ? "The Conqueror"
                    : "The Stalwart";
  return {
    member,
    season: { name: season.name, from: season.start, to: season.end },
    games: s.games,
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
    ...(fav ? { favouriteArmy: { faction: fav[0], games: fav[1] } } : {}),
    ...(nemesis ? { nemesis } : {}),
    ...(foe ? { favouriteFoe: foe } : {}),
    ...(biggest ? { biggestWin: biggest } : {}),
    comebacks: s.comebacks,
    tacticsMastered: s.tacticsMastered,
    reports: s.reports,
    reactionsReceived: s.reactionsReceived,
    xp: xpFrom(s).reduce((n, x) => n + x.xp, 0),
    title,
  };
}
