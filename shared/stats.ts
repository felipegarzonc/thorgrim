// A player's numbers from their finished games: by army, battleplan and
// battle tactic, points round by round, double turns, and each rival.

import { doubleTurns } from "./report.ts";
import { BATTLE_ROUNDS, baseFaction, TACTIC_VP } from "./season.ts";
import { result, roundPlayed, sideRoundVp, tacticSteps } from "./scoring.ts";
import type { Game } from "./types.ts";

type Side = "me" | "opponent";
type Result = "win" | "loss" | "draw";

export interface Record3 {
  played: number;
  won: number;
  drawn: number;
  lost: number;
}

export interface Rival extends Record3 {
  name: string;
  /** The armies they played against you, most played first. */
  armies: string[];
  last: { date: string; result: Result; me: number; opponent: number; gameId: string };
}

export interface PlayerStats {
  games: number;
  /** Per army you played (base faction). */
  armies: (Record3 & { faction: string })[];
  battleplans: (Record3 & { name: string })[];
  /** Per battle tactic card: games picked, average VP scored from it (out of 15), and how often all three steps were done. */
  tactics: { card: string; picked: number; avgVp: number; full: number }[];
  /** Average VP per battle round, yours and your opponents'. */
  perRound: { round: number; me: number; opponent: number }[];
  doubleTurns: { taken: number; wonWhenTaken: number; suffered: number; wonWhenSuffered: number };
  rivals: Rival[];
}

const add = (r: Record3, res: Result) => {
  r.played++;
  if (res === "win") r.won++;
  else if (res === "loss") r.lost++;
  else r.drawn++;
};
const empty = (): Record3 => ({ played: 0, won: 0, drawn: 0, lost: 0 });
const byPlayed = <T extends Record3>(a: T, b: T) => b.played - a.played || b.won - a.won;
/** Rivals are matched by name, ignoring case and spaces at the ends. */
const rivalKey = (name: string) => name.trim().toLowerCase();

export function playerStats(games: Game[], factionOf: (g: Game, side: Side) => string): PlayerStats {
  const done = games
    .filter((g) => result(g))
    .sort((a, b) => (a.date ?? a.createdAt).localeCompare(b.date ?? b.createdAt));
  const armies = new Map<string, Record3 & { faction: string }>();
  const plans = new Map<string, Record3 & { name: string }>();
  const tactics = new Map<string, { card: string; picked: number; vp: number; full: number }>();
  const rounds = Array.from({ length: BATTLE_ROUNDS }, () => ({ me: 0, opponent: 0, n: 0 }));
  const dt = { taken: 0, wonWhenTaken: 0, suffered: 0, wonWhenSuffered: 0 };
  const rivals = new Map<string, Rival & { armyCount: Map<string, number> }>();

  for (const g of done) {
    const res = result(g)!;
    const mine = factionOf(g, "me");
    if (mine) {
      const f = baseFaction(mine);
      const a = armies.get(f) ?? { faction: f, ...empty() };
      add(a, res);
      armies.set(f, a);
    }
    if (g.battleplan) {
      const p = plans.get(g.battleplan) ?? { name: g.battleplan, ...empty() };
      add(p, res);
      plans.set(g.battleplan, p);
    }
    const recs = g.state.rounds ?? [];
    for (const t of g.state.tactics ?? []) {
      const steps = tacticSteps(recs, "me", t.card).size;
      const x = tactics.get(t.card) ?? { card: t.card, picked: 0, vp: 0, full: 0 };
      x.picked++;
      x.vp += steps * TACTIC_VP;
      if (steps === 3) x.full++;
      tactics.set(t.card, x);
    }
    recs.slice(0, BATTLE_ROUNDS).forEach((r, i) => {
      if (!roundPlayed(r)) return;
      rounds[i].me += sideRoundVp(r.me, g.battleplan, i + 1);
      rounds[i].opponent += sideRoundVp(r.opponent, g.battleplan, i + 1);
      rounds[i].n++;
    });
    const turns = doubleTurns(g);
    if (turns.some((d) => d.side === "me")) {
      dt.taken++;
      if (res === "win") dt.wonWhenTaken++;
    }
    if (turns.some((d) => d.side === "opponent")) {
      dt.suffered++;
      if (res === "win") dt.wonWhenSuffered++;
    }
    const name = g.opponentName?.trim();
    if (name) {
      const key = rivalKey(name);
      const r = rivals.get(key) ?? { name, armies: [], armyCount: new Map(), last: undefined as unknown as Rival["last"], ...empty() };
      add(r, res);
      r.name = name; // the latest spelling
      const theirs = factionOf(g, "opponent");
      if (theirs) r.armyCount.set(baseFaction(theirs), (r.armyCount.get(baseFaction(theirs)) ?? 0) + 1);
      r.last = { date: g.date ?? g.createdAt.slice(0, 10), result: res, me: g.state.vp.me, opponent: g.state.vp.opponent, gameId: g.id };
      rivals.set(key, r);
    }
  }

  return {
    games: done.length,
    armies: [...armies.values()].sort(byPlayed),
    battleplans: [...plans.values()].sort(byPlayed),
    tactics: [...tactics.values()]
      .map((t) => ({ card: t.card, picked: t.picked, avgVp: Math.round((t.vp / t.picked) * 10) / 10, full: t.full }))
      .sort((a, b) => b.avgVp - a.avgVp || b.picked - a.picked),
    perRound: rounds.map((r, i) => ({
      round: i + 1,
      me: r.n ? Math.round((r.me / r.n) * 10) / 10 : 0,
      opponent: r.n ? Math.round((r.opponent / r.n) * 10) / 10 : 0,
    })),
    doubleTurns: dt,
    rivals: [...rivals.values()]
      .map(({ armyCount, ...r }) => ({ ...r, armies: [...armyCount.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f) }))
      .sort(byPlayed),
  };
}

/** One rival's record, for a game or a post ("3-1-0 against Diego"). */
export function rivalRecord(games: Game[], opponentName: string): Record3 | undefined {
  const key = rivalKey(opponentName);
  if (!key) return undefined;
  const r = empty();
  for (const g of games) {
    const res = result(g);
    if (res && rivalKey(g.opponentName ?? "") === key) add(r, res);
  }
  return r.played ? r : undefined;
}
