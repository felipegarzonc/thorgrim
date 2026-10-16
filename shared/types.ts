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
  units: Record<string, UnitStatus>; // keyed by "me:<key>" / "opponent:<key>"
  objectives: string;
  notes: string;
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
