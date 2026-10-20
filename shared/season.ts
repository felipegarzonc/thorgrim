// Matched play reference for the General's Handbook 2026-27 season, written
// as short summaries (not rules text) so the tracker and checklist can work
// without the books. The full wording lives in the player's uploaded books.

import type { Phase } from "./types.ts";

export type Side = "me" | "opponent";

export interface Command {
  name: string;
  cost: number; // command points; 0 for non-command season abilities
  phases: Phase[];
  /** Who can use it: the active player, the player whose turn it isn't, or either. */
  side: "active" | "inactive" | "both";
  summary: string;
}

export const CORE_COMMANDS: Command[] = [
  { name: "Rally", cost: 1, phases: ["Hero"], side: "both", summary: "Unit not in combat rolls 6 dice; each 4+ is a rally point. Spend points to heal 1 each, or to return a slain model (points = its Health)." },
  { name: "Magical Intervention", cost: 1, phases: ["Hero"], side: "inactive", summary: "A Wizard or Priest casts/chants in the enemy hero phase, -1 to the roll." },
  { name: "Redeploy", cost: 1, phases: ["Movement"], side: "inactive", summary: "Unit not in combat moves up to D6\"; can't pass through or end in enemy combat range." },
  { name: "At the Double", cost: 1, phases: ["Movement"], side: "active", summary: "Reaction to declaring a Run: don't roll, add 6\" instead." },
  { name: "Covering Fire", cost: 1, phases: ["Shooting"], side: "inactive", summary: "Unit that didn't Run and isn't in combat shoots the closest enemy unit, -1 to hit." },
  { name: "Counter-charge", cost: 2, phases: ["Charge"], side: "inactive", summary: "Unit not in combat can charge in the enemy charge phase." },
  { name: "Forward to Victory", cost: 1, phases: ["Charge"], side: "active", summary: "Reaction to declaring a Charge: re-roll the charge roll." },
  { name: "All-out Attack", cost: 1, phases: ["Shooting", "Combat"], side: "both", summary: "Reaction to declaring an attack: +1 to hit (Companion too); that unit is -1 to save for the rest of the turn." },
  { name: "All-out Defence", cost: 1, phases: ["Shooting", "Combat"], side: "both", summary: "Reaction to being targeted by an attack: +1 to save rolls against it." },
  { name: "Power Through", cost: 1, phases: ["End of Turn"], side: "both", summary: "A unit that charged this turn: D3 mortal damage to an enemy unit in combat with lower Health, then move up to its Move through that unit (not others), not ending in combat." },
];

export const SEASON_ABILITIES: Command[] = [
  { name: "Simmering Rage", cost: 0, phases: ["Start of Turn"], side: "both", summary: "Start of each battle round: gain rage dice equal to your fury level. Unspent rage dice are lost at the end of the round." },
  { name: "Activate Place of Power", cost: 0, phases: ["Start of Turn"], side: "both", summary: "Hero within 3\" of a Place of Power rolls a dice: 1 = D3 mortal damage to it; 2+ = gain 2 rage dice and +2 fury (max 7), or +1 to cast/chant, or unbind as Wizard (1)." },
  { name: "Eruption of Fury", cost: 0, phases: ["End of Turn"], side: "both", summary: "Once per turn: a unit in combat spends up to 3 rage dice for that many extra attacks with one melee weapon (no crits). Each unmodified 6: D3 mortal damage to each enemy unit in combat with it, and the opponent's fury +1. Each 1: D3 mortal damage to your unit, no ward." },
  { name: "Fight Through the Pain", cost: 0, phases: ["Combat"], side: "both", summary: "Before allocating damage to your unit: spend rage dice, lowering your fury by 1 each; each 3+ removes 1 damage point." },
];

export const BATTLEPLANS = {
  "Table 1": ["Into the Fire", "Bloodstained Coasts", "Avalanche of Ash", "Caverns of Slaughter", "What's Yours is Ours", "Hidden Under Ash-clouds"],
  "Table 2": ["Warped Ruins", "Curse of the Gnaw", "Seize the Embers", "Treacherous Ground", "Escape From the Coast", "Power of the Realms"],
};

export const BATTLE_ROUNDS = 5;
export const SEIZE_EXCEPTION_LEAD = 11;

export function usableBy(c: Command, phase: Phase, owner: Side, active: Side) {
  if (!c.phases.includes(phase)) return false;
  return c.side === "both" || (c.side === "active") === (owner === active);
}

/**
 * Start of a new battle round. `first` is who takes the first turn.
 * Going first after going second last round is seizing the initiative,
 * unless the opponent leads by 11+ VP; the other player is then the underdog.
 * Otherwise the underdog is whoever has fewer VP (none on a tie).
 * Each player gets 4 CP, +1 for the underdog.
 */
export function newBattleRound(prev: { firstThisRound: Side; vp: Record<Side, number> }, first: Side) {
  const other = (s: Side): Side => (s === "me" ? "opponent" : "me");
  const wentSecond = other(prev.firstThisRound);
  const lead = prev.vp[other(first)] - prev.vp[first];
  const seized = first === wentSecond && lead < SEIZE_EXCEPTION_LEAD ? first : null;
  let underdog: Side | null = null;
  if (seized) underdog = other(seized);
  else if (prev.vp.me !== prev.vp.opponent) underdog = prev.vp.me < prev.vp.opponent ? "me" : "opponent";
  const cp = { me: 4 + (underdog === "me" ? 1 : 0), opponent: 4 + (underdog === "opponent" ? 1 : 0) };
  return { seized, underdog, cp };
}

// ---------- battleplan scoring (General's Handbook 2026-27) ----------
// Short summaries of each battleplan's end-of-turn scoring, from the
// player's battleplan cards. Each line scores on its own.

export interface ScoringLine {
  label: string;
  vp: number;
  /** "first": battle round 1 only; "later": from battle round 2. */
  rounds?: "first" | "later";
}

const STANDARD: ScoringLine[] = [
  { label: "Control at least 1 objective", vp: 3 },
  { label: "Control at least 2 objectives", vp: 3 },
  { label: "Control more objectives than your opponent", vp: 4 },
];

export const BATTLEPLAN_SCORING: Record<string, ScoringLine[]> = {
  "Into the Fire": STANDARD,
  "Bloodstained Coasts": [
    STANDARD[0],
    STANDARD[1],
    { label: "Control more objectives than your opponent", vp: 4, rounds: "first" },
    { label: "Control an objective your opponent controlled at the start of the turn", vp: 4, rounds: "later" },
  ],
  "Avalanche of Ash": [
    ...STANDARD,
    { label: "Only 1 objective left, and you control a non-faction terrain feature in enemy territory", vp: 3 },
    { label: "No objectives left, and you control more terrain features than your opponent", vp: 7 },
  ],
  "Caverns of Slaughter": [STANDARD[0], STANDARD[1], { label: "Control at least 1 pair of objectives", vp: 4 }],
  "What's Yours is Ours": [STANDARD[0], { label: "Control the coveted objective pair", vp: 3 }, STANDARD[2]],
  "Warped Ruins": [STANDARD[0], { label: "Control at least 1 pair of objectives", vp: 3 }, STANDARD[2]],
  "Curse of the Gnaw": [
    { label: "Control the Golden Lions objective", vp: 3 },
    { label: "Control the Sun Seekers objective", vp: 3 },
    STANDARD[2],
  ],
  "Seize the Embers": [
    STANDARD[0],
    { label: "Control at least 2 objectives", vp: 3, rounds: "first" },
    { label: "Used 'Return to Base Camp' this turn", vp: 3, rounds: "later" },
    STANDARD[2],
  ],
  "Treacherous Ground": [
    { label: "Control at least 1 stable objective", vp: 3 },
    { label: "Control at least 2 stable objectives", vp: 3 },
    { label: "Control more stable objectives than your opponent", vp: 4 },
  ],
  "Escape From the Coast": STANDARD,
  "Power of the Realms": [
    { label: "Control the primary objective", vp: 3 },
    { label: "Control at least 2 secondary objectives", vp: 3 },
    STANDARD[2],
  ],
};

const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Scoring lines for a battleplan this round, or null if the app doesn't know it. */
export function scoringFor(battleplan: string, round: number): ScoringLine[] | null {
  const key = Object.keys(BATTLEPLAN_SCORING).find((k) => normName(k) === normName(battleplan));
  if (!key) return null;
  return BATTLEPLAN_SCORING[key].filter((l) => !l.rounds || (l.rounds === "first") === (round === 1));
}

export const TACTIC_VP = 5;
export const TACTIC_STEPS = ["affray", "strike", "domination"] as const;
