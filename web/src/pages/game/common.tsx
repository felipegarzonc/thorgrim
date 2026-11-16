// What every screen of a game shares: the steps, the phases, and the
// tap-to-explain text for abilities Thorgrim names.

import { createContext, useContext, useState } from "react";
import { BATTLE_ROUNDS, CORE_COMMANDS, SEASON_ABILITIES } from "../../../../shared/season.ts";
import { result } from "../../../../shared/scoring.ts";
import { PHASES, type Game, type GlossaryEntry, type Phase, type Unit } from "../../../../shared/types.ts";
import { RulesText } from "../../ui.tsx";
import type { Army, Side } from "../gameTools.tsx";

export type Step = string;
export const ROUND_STEPS = Array.from({ length: BATTLE_ROUNDS }, (_, i) => `round-${i + 1}`);
/** The battle: its rounds and the result (the bottom bar's buttons, and swipes). */
export const BATTLE_STEPS = [...ROUND_STEPS, "results"];
// Every screen of a game (the menu lists them all)...
export const STEPS: Step[] = ["players", "setup", "battleplan", "tactics", "plan", ...ROUND_STEPS, "results"];
// ...and the quick way through it: game details and Thorgrim's plan are optional, so Next skips them.
export const FLOW: Step[] = STEPS.filter((s) => s !== "setup" && s !== "plan");
/** Older links to the two tactics screens open the combined one. */
export const OLD_STEPS: Record<string, Step> = { "tactics-me": "tactics", "tactics-opponent": "tactics" };
export const STEP_TITLE: Record<string, string> = {
  players: "Players",
  setup: "Game details (optional)",
  battleplan: "Battleplan",
  tactics: "Battle Tactics",
  plan: "Game plan (optional)",
  results: "Results",
};
/** The quick-flow step before / after any step (optional ones sit between their neighbours). */
export const flowStep = (current: Step, dir: 1 | -1): Step | undefined => {
  const i = STEPS.indexOf(current);
  const around = dir === 1 ? STEPS.slice(i + 1) : STEPS.slice(0, i).reverse();
  return around.find((s) => FLOW.includes(s));
};
export const stepTitle = (s: Step) => STEP_TITLE[s] ?? `Round ${s.split("-")[1]}`;
export const cap = (k: string) => k[0].toUpperCase() + k.slice(1);
export const PLAY_PHASES: Phase[] = PHASES.filter((p) => p !== "Deployment");
export const SHORT: Record<Phase, string> = {
  Deployment: "Deploy",
  "Start of Turn": "Start",
  Hero: "Hero",
  Movement: "Move",
  Shooting: "Shoot",
  Charge: "Charge",
  Combat: "Combat",
  "End of Turn": "End",
};

export type Mutate = (fn: (g: Game) => Game, log?: string) => Promise<void>;
export type SheetName = "menu" | "coach" | "armies" | "odds" | "log" | "share";

// ---------- explaining abilities Thorgrim names ----------

export interface RuleText {
  name: string;
  from: string;
  text: string;
}
export const RulesContext = createContext<(name: string) => RuleText | undefined>(() => undefined);
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Find an ability, spell, prayer or command by name in both armies and the core rules. */
export function rulesLookup(armies: Record<Side, Army>, units: Record<string, Unit>) {
  const index = new Map<string, RuleText>();
  const add = (name: string, from: string, text: string) => {
    if (!index.has(norm(name))) index.set(norm(name), { name, from, text });
  };
  for (const side of ["me", "opponent"] as const) {
    for (const lu of armies[side].list?.units ?? []) {
      for (const a of units[lu.unitId]?.abilities ?? []) add(a.name, lu.name, [a.timing && `*${a.timing}*`, a.declare && `**Declare:** ${a.declare}`, a.effect].filter(Boolean).join("\n\n"));
    }
    for (const r of armies[side].rules) add(r.ability.name, r.group || r.entry, [r.ability.timing && `*${r.ability.timing}*`, r.ability.declare && `**Declare:** ${r.ability.declare}`, r.ability.effect].filter(Boolean).join("\n\n"));
  }
  for (const c of [...CORE_COMMANDS, ...SEASON_ABILITIES]) add(c.name, c.cost ? `Command · ${c.cost} CP` : "Season rule", c.summary);
  return (name: string) => index.get(norm(name));
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Coach text with the abilities it names made tappable: what it does, and the full rule. */
export function Explained({ text, glossary = [] }: { text: string; glossary?: GlossaryEntry[] }) {
  const lookup = useContext(RulesContext);
  const [open, setOpen] = useState<string | null>(null);
  const terms = glossary.filter((g) => g.name.trim().length > 2).sort((a, b) => b.name.length - a.name.length);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => escapeRe(t.name)).join("|")})`, "gi");
  const parts = text.split(re);
  const entry = open ? terms.find((t) => t.name.toLowerCase() === open.toLowerCase()) : undefined;
  const full = entry ? lookup(entry.name) : undefined;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <button key={i} type="button" className={`term ${open?.toLowerCase() === part.toLowerCase() ? "on" : ""}`} onClick={() => setOpen(open?.toLowerCase() === part.toLowerCase() ? null : part)}>
            {part}
          </button>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
      {entry && (
        <span className="term-card" role="note">
          <b>{entry.name}</b>
          {full?.from && <small className="muted"> · {full.from}</small>}
          <span className="term-effect">{entry.effect}</span>
          {full && (
            <details>
              <summary>Full rule</summary>
              <RulesText text={full.text} />
            </details>
          )}
        </span>
      )}
    </>
  );
}
