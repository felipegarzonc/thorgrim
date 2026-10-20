// The game record behind the round screens: each battle round keeps who won
// priority, who went first, and what each player scored and spent in their
// turn. Victory points, battle tactic progress and current CP are derived
// from it, so editing an earlier round fixes the totals.

import { newBattleRound, scoringFor, TACTIC_STEPS, TACTIC_VP, type Side } from "./season.ts";
import type { Game, GameState, RoundRecord, SideRound, TacticProgress, TacticStep } from "./types.ts";

export const emptySideRound = (): SideRound => ({ scored: [], extraVp: 0, tactics: [], cpGained: 0, cpSpent: 0 });
export const emptyRound = (): RoundRecord => ({ me: emptySideRound(), opponent: emptySideRound() });

/** VP one player scored in one round. */
export function sideRoundVp(sr: SideRound, battleplan: string, round: number): number {
  const lines = scoringFor(battleplan, round) ?? [];
  const fromLines = lines.filter((l) => sr.scored.includes(l.label)).reduce((sum, l) => sum + l.vp, 0);
  return fromLines + sr.extraVp + sr.tactics.length * TACTIC_VP;
}

export function totalVp(rounds: RoundRecord[], battleplan: string, side: Side): number {
  return Math.max(0, rounds.reduce((sum, r, i) => sum + sideRoundVp(r[side], battleplan, i + 1), 0));
}

/** Battle tactic steps completed for a card, up to (and including) a round. */
export function tacticSteps(rounds: RoundRecord[], side: Side, card: string, upToRound = Infinity): Set<TacticStep> {
  const done = new Set<TacticStep>();
  rounds.forEach((r, i) => {
    if (i + 1 > upToRound) return;
    for (const t of r[side].tactics) if (t.card === card) done.add(t.step);
  });
  return done;
}

/** The next step to complete on a card (Affray, then Strike, then Domination). */
export function nextTacticStep(rounds: RoundRecord[], side: Side, card: string): TacticStep | undefined {
  const done = tacticSteps(rounds, side, card);
  return TACTIC_STEPS.find((s) => !done.has(s));
}

const tacticsKey = (side: Side) => (side === "me" ? "tactics" : "opponentTactics");
const tacticsOf = (s: GameState, side: Side): TacticProgress[] => (side === "me" ? s.tactics : (s.opponentTactics ?? []));

/** Recompute VP, tactic progress and current CP from the round records. */
export function derive(game: Pick<Game, "battleplan" | "state">): GameState {
  const s = game.state;
  const rounds = s.rounds;
  if (!rounds) return s; // games from before round records keep their stored totals
  const next: GameState = { ...s, vp: { me: totalVp(rounds, game.battleplan, "me"), opponent: totalVp(rounds, game.battleplan, "opponent") } };
  for (const side of ["me", "opponent"] as const) {
    (next as unknown as Record<string, TacticProgress[]>)[tacticsKey(side)] = tacticsOf(s, side).map((t) => {
      const done = tacticSteps(rounds, side, t.card);
      return { card: t.card, affray: done.has("affray"), strike: done.has("strike"), domination: done.has("domination") };
    });
  }
  const current = rounds[s.round - 1];
  if (current && s.phase !== "Deployment") {
    next.cp = {
      me: Math.max(0, current.me.cpGained - current.me.cpSpent),
      opponent: Math.max(0, current.opponent.cpGained - current.opponent.cpSpent),
    };
  }
  return next;
}

/**
 * Start battle round `round`: record who went first (and who won priority),
 * work out seizing the initiative and the underdog, and give each player
 * their CP (4, +1 for the underdog). Rage dice refill from the fury level.
 */
export function startRound(game: Pick<Game, "battleplan" | "state">, round: number, first: Side, priority?: Side): GameState {
  const s = game.state;
  const rounds = [...(s.rounds ?? [])];
  while (rounds.length < round) rounds.push(emptyRound());
  const r =
    round === 1
      ? { seized: null, underdog: null, cp: { me: 4, opponent: 4 } }
      : newBattleRound({ firstThisRound: rounds[round - 2].first ?? s.firstThisRound, vp: derive(game).vp }, first);
  const rec = rounds[round - 1];
  rounds[round - 1] = {
    ...rec,
    first,
    priority: priority ?? rec.priority,
    me: { ...rec.me, cpGained: rec.me.cpGained || r.cp.me },
    opponent: { ...rec.opponent, cpGained: rec.opponent.cpGained || r.cp.opponent },
  };
  return derive({
    battleplan: game.battleplan,
    state: {
      ...s,
      rounds,
      round,
      firstThisRound: first,
      activePlayer: first,
      phase: "Start of Turn",
      underdog: r.underdog,
      seizedInitiative: r.seized,
      rage: { me: s.fury.me, opponent: s.fury.opponent },
    },
  });
}

/** Result from my side, once the game is over. */
export function result(game: Pick<Game, "state" | "finished">): "win" | "loss" | "draw" | null {
  if (!game.finished) return null;
  const { conclusion } = game.finished;
  if (conclusion === "conceded-me") return "loss";
  if (conclusion === "conceded-opponent") return "win";
  const { me, opponent } = game.state.vp;
  return me > opponent ? "win" : me < opponent ? "loss" : "draw";
}

/** What a game plan depends on: when this changes, the plan is out of date. */
export function planBasis(game: Pick<Game, "myListId" | "opponentListId" | "battleplan" | "state">): string {
  const cards = (ts?: TacticProgress[]) => (ts ?? []).map((t) => t.card).sort();
  return JSON.stringify([game.myListId, game.opponentListId, game.battleplan, game.state.attacker, cards(game.state.tactics), cards(game.state.opponentTactics)]);
}
