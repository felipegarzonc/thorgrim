// Types shared by the data build script, the server and the web app.

export interface Weapon {
  name: string;
  kind: "melee" | "ranged";
  range?: string;
  attacks: string;
  hit: string;
  wound: string;
  rend: string;
  damage: string;
  ability: string;
}

export interface Ability {
  name: string;
  kind: string; // "Ability (Activated)", "Ability (Passive)", "Ability (Spell)", ...
  timing?: string;
  declare?: string;
  effect: string;
  keywords?: string;
  extra?: Record<string, string>; // e.g. Casting Value, Chanting Value, Cost
}

export interface UnitStats {
  move: string;
  health: string;
  save: string;
  control: string;
  ward?: string;
}

export interface Unit {
  id: string;
  name: string;
  faction: string;
  keywords: string[];
  stats?: UnitStats;
  models: number;
  baseSize?: string;
  weapons: Weapon[];
  abilities: Ability[];
}

/** A faction-level rule: battle trait, formation, enhancement, lore entry... */
export interface FactionRule {
  group: string;
  entry: string;
  ability: Ability;
}

export interface Faction {
  name: string;
  units: { id: string; points: number }[];
  rules: FactionRule[];
}

export interface GameData {
  source: string;
  commit: string;
  builtAt: string;
  units: Record<string, Unit>;
  factions: Record<string, Faction>;
  /** Rules from the game system file: battle tactics, core abilities, etc. */
  core: FactionRule[];
}

// ---- Persisted app objects ----

export interface ListUnit {
  key: string;
  unitId: string;
  name: string;
  reinforced: boolean;
  /** Cost of this unit as listed (already doubled when reinforced). */
  points?: number;
  notes: string[]; // enhancements, general, etc.
}

export interface ArmyList {
  id: string;
  name: string;
  owner: "me" | "opponent";
  faction: string;
  rawText: string;
  units: ListUnit[];
  unmatched: string[];
  /** Battle tactic cards named in the list ("Battle Tactic Cards: …"). */
  tacticCards?: string[];
  createdAt: string;
}

export interface LibraryDoc {
  id: string;
  title: string;
  kind: "pdf" | "image" | "text";
  category: "core" | "season" | "battletome" | "battleplan" | "map" | "other";
  filename: string;
  mime: string;
  pages: number;
  createdAt: string;
  /** Set while the browser is still sending the file to storage. */
  uploading?: boolean;
  /** Pages with no text layer (photos/scans) are read by Claude and transcribed. */
  transcription?: {
    status: "pending" | "running" | "done" | "failed";
    pages: number[]; // 1-based page numbers that need it
    done: number;
    error?: string;
  };
}

export interface TacticProgress {
  card: string;
  affray: boolean;
  strike: boolean;
  domination: boolean;
}

export type TacticStep = "affray" | "strike" | "domination";

/** What one player did in their turn of a battle round. */
export interface SideRound {
  /** Battleplan scoring lines achieved (by label). */
  scored: string[];
  /** VP from anything else (manual), can be negative to correct. */
  extraVp: number;
  /** Battle tactics completed this turn. */
  tactics: { card: string; step: TacticStep }[];
  cpGained: number;
  cpSpent: number;
}

export interface RoundRecord {
  /** Who won the priority roll (round 2+). */
  priority?: "me" | "opponent";
  /** Who took the first turn. */
  first?: "me" | "opponent";
  me: SideRound;
  opponent: SideRound;
}

/** The coach's plan for one turn, split by phase. */
export interface TurnTips {
  headline: string;
  phases: Partial<Record<Phase, string[]>>;
  generatedAt: string;
}

/** The coach's strategy for a game, written once the armies, battleplan and tactics are set. */
export interface GamePlan {
  summary: string;
  ourStrengths: string[];
  theirThreats: string[];
  deployment: string[];
  rounds: { round: number; plan: string }[];
  tactics: string[];
  priority: string[];
  avoid: string[];
  generatedAt: string;
  /** What the plan was based on (lists, battleplan, tactics), to spot changes. */
  basis: string;
}

export interface UnitStatus {
  damage: number;
  destroyed: boolean;
}

export interface GameState {
  round: number;
  attacker: "me" | "opponent";
  firstThisRound: "me" | "opponent";
  activePlayer: "me" | "opponent";
  phase: Phase;
  cp: { me: number; opponent: number };
  vp: { me: number; opponent: number };
  fury: { me: number; opponent: number };
  rage: { me: number; opponent: number };
  tactics: TacticProgress[];
  opponentTactics?: TacticProgress[];
  /** VP scored in the end-of-turn prompt, keyed "round:side", so a turn is scored once. */
  scoredTurns?: Record<string, number>;
  /** Fewest VP at the start of the round, or the opponent of whoever seized the initiative. */
  underdog?: "me" | "opponent" | null;
  /** Who seized the initiative this round (they can't complete battle tactics this turn). */
  seizedInitiative?: "me" | "opponent" | null;
  units: Record<string, UnitStatus>; // keyed by "me:<key>" / "opponent:<key>"
  objectives: string;
  notes: string;
  /** Per-round record of priority, scoring and CP. VP and tactic progress are derived from it. */
  rounds?: RoundRecord[];
  /** Latest photo of the table, shown to the coach. */
  tablePhoto?: { path: string; at: string; round: number; phase: Phase };
  /** Coach tips per turn, keyed "round:side". */
  tips?: Record<string, TurnTips>;
}

export const PHASES = [
  "Deployment",
  "Start of Turn",
  "Hero",
  "Movement",
  "Shooting",
  "Charge",
  "Combat",
  "End of Turn",
] as const;
export type Phase = (typeof PHASES)[number];

export interface Game {
  id: string;
  name: string;
  myName?: string;
  opponentName?: string;
  /** Faction when no list is attached (a list's own faction wins). */
  myFaction?: string;
  opponentFaction?: string;
  points?: number;
  /** YYYY-MM-DD */
  date?: string;
  plan?: GamePlan;
  finished?: { conclusion: "played" | "conceded-me" | "conceded-opponent" | "time"; at: string };
  myListId: string;
  opponentListId: string;
  battleplan: string;
  battleplanNotes: string;
  /** Library docs the coach should read for this game (battleplan pages, maps...). */
  references: { docId: string; pages?: string }[];
  state: GameState;
  log: { at: string; text: string }[];
  createdAt: string;
}
