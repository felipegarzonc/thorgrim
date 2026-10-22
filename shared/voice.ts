// Scoring by voice: the coach turns what a player said ("Goy scored both
// objectives and Strike of Siege of Ashes, Diego spent 2 CP") into these
// changes, the player checks them, and the page applies them to the round.

import { scoringFor, TACTIC_VP } from "./season.ts";
import { emptyRound, nextTacticStep } from "./scoring.ts";
import type { Game } from "./types.ts";

type Side = "me" | "opponent";

export interface VoiceChange {
  side: Side;
  /** objective: a scoring line (label); tactic: the next step of a card (label); the rest change a number by `amount` (fury and rage: set to it). */
  kind: "objective" | "tactic" | "extraVp" | "cpGained" | "cpSpent" | "fury" | "rage";
  label?: string;
  amount?: number;
}

/** What the coach may pick from in battle round `round`, given to it with what was said. */
export function voiceOptions(game: Pick<Game, "battleplan" | "state">, round: number) {
  const rounds = game.state.rounds ?? [];
  const tactics = (side: Side) => ((side === "me" ? game.state.tactics : game.state.opponentTactics) ?? []).map((t) => t.card).filter((c) => nextTacticStep(rounds, side, c));
  return {
    objectives: (scoringFor(game.battleplan, round) ?? []).map((l) => l.label),
    tactics: { me: tactics("me"), opponent: tactics("opponent") },
  };
}

/** Drop changes that don't fit this game (unknown lines or cards, silly numbers). */
export function cleanChanges(game: Pick<Game, "battleplan" | "state">, round: number, changes: VoiceChange[]): VoiceChange[] {
  const o = voiceOptions(game, round);
  return changes.filter((c) => {
    if (c.side !== "me" && c.side !== "opponent") return false;
    if (c.kind === "objective") return !!c.label && o.objectives.includes(c.label);
    if (c.kind === "tactic") return !!c.label && o.tactics[c.side].includes(c.label);
    if (!["extraVp", "cpGained", "cpSpent", "fury", "rage"].includes(c.kind)) return false;
    return Number.isInteger(c.amount) && Math.abs(c.amount!) <= 50;
  });
}

/** The game with the changes made to battle round `round`. */
export function applyVoice<G extends Pick<Game, "battleplan" | "state">>(game: G, round: number, changes: VoiceChange[]): G {
  const rs = [...(game.state.rounds ?? [])];
  while (rs.length < round) rs.push(emptyRound());
  let state = { ...game.state, rounds: rs };
  for (const c of changes) {
    const rec = { ...rs[round - 1] };
    const sr = { ...rec[c.side] };
    if (c.kind === "objective" && c.label && !sr.scored.includes(c.label)) sr.scored = [...sr.scored, c.label];
    if (c.kind === "tactic" && c.label && !sr.tactics.some((t) => t.card === c.label)) {
      const step = nextTacticStep(rs, c.side, c.label);
      if (step) sr.tactics = [...sr.tactics, { card: c.label, step }];
    }
    if (c.kind === "extraVp" || c.kind === "cpGained" || c.kind === "cpSpent") sr[c.kind] = Math.max(c.kind === "extraVp" ? -50 : 0, sr[c.kind] + (c.amount ?? 0));
    rec[c.side] = sr;
    rs[round - 1] = rec;
    if (c.kind === "fury") state = { ...state, fury: { ...state.fury, [c.side]: Math.max(0, Math.min(7, c.amount ?? 0)) } };
    if (c.kind === "rage") state = { ...state, rage: { ...state.rage, [c.side]: Math.max(0, c.amount ?? 0) } };
  }
  return { ...game, state: { ...state, rounds: rs } };
}

/** "Goy: +3 Control at least 1 objective" for the check before applying. */
export function describeChange(c: VoiceChange, names: Record<Side, string>, game: Pick<Game, "battleplan" | "state">, round: number): string {
  const who = names[c.side];
  const n = c.amount ?? 0;
  const signed = `${n >= 0 ? "+" : ""}${n}`;
  switch (c.kind) {
    case "objective": {
      const line = scoringFor(game.battleplan, round)?.find((l) => l.label === c.label);
      return `${who}: ${c.label} (+${line?.vp ?? 0})`;
    }
    case "tactic": {
      const step = nextTacticStep(game.state.rounds ?? [], c.side, c.label!);
      return `${who}: ${step ? step[0].toUpperCase() + step.slice(1) : "step"} of ${c.label} (+${TACTIC_VP})`;
    }
    case "extraVp":
      return `${who}: ${signed} other VP`;
    case "cpGained":
      return `${who}: ${signed} CP gained`;
    case "cpSpent":
      return `${who}: ${signed} CP spent`;
    case "fury":
      return `${who}: fury ${n}`;
    case "rage":
      return `${who}: ${n} rage dice`;
  }
}
