// Loads the generated BSData snapshot and formats warscrolls for the coach.

import fs from "node:fs";
import path from "node:path";
import type { Ability, ArmyList, FactionRule, GameData, Unit } from "../shared/types.ts";

const dataFile = path.resolve("data", "aos.json");
let cached: GameData | null = null;

export function gameData(): GameData {
  if (!cached) {
    if (!fs.existsSync(dataFile)) {
      throw new Error("data/aos.json is missing. Run `npm run data` first.");
    }
    cached = JSON.parse(fs.readFileSync(dataFile, "utf8")) as GameData;
  }
  return cached;
}

export const norm = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/** Find a unit by (approximate) name, preferring the given faction. */
export function findUnit(name: string, faction?: string): Unit | undefined {
  const d = gameData();
  const target = norm(name);
  const all = Object.values(d.units);
  const pool = faction ? all.filter((u) => u.faction === faction.split(" - ")[0]) : [];
  for (const set of [pool, all]) {
    const exact = set.find((u) => norm(u.name) === target);
    if (exact) return exact;
  }
  for (const set of [pool, all]) {
    const partial = set
      .filter((u) => norm(u.name).includes(target) || target.includes(norm(u.name)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (partial) return partial;
  }
  return undefined;
}

export function pointsFor(unitId: string, faction: string): number | undefined {
  return gameData().factions[faction]?.units.find((u) => u.id === unitId)?.points;
}

const strip = (s: string) => s.replace(/\*+/g, "");

export function abilityText(a: Ability): string {
  const parts = [`- ${a.name}${a.kind !== "Ability (Passive)" && a.kind !== "Rule" ? ` [${a.kind.replace(/^Ability \((.*)\)$/, "$1")}]` : ""}`];
  if (a.timing) parts.push(`  Timing: ${a.timing}`);
  if (a.extra) for (const [k, v] of Object.entries(a.extra)) parts.push(`  ${k}: ${strip(v)}`);
  if (a.declare) parts.push(`  Declare: ${strip(a.declare)}`);
  if (a.effect) parts.push(`  Effect: ${strip(a.effect)}`);
  if (a.keywords) parts.push(`  Keywords: ${a.keywords}`);
  return parts.join("\n");
}

/** Compact text warscroll for the model. */
export function warscrollText(u: Unit, opts: { reinforced?: boolean } = {}): string {
  const s = u.stats;
  const models = opts.reinforced ? u.models * 2 : u.models;
  const lines = [
    `## ${u.name}${opts.reinforced ? " (Reinforced)" : ""} — ${u.faction}`,
    s
      ? `Move ${s.move} | Health ${s.health} | Save ${s.save} | Control ${s.control}${s.ward ? ` | Ward ${s.ward}` : ""} | Models ${models}`
      : `Models ${models}`,
    `Keywords: ${u.keywords.join(", ")}`,
  ];
  if (u.weapons.length) {
    lines.push("Weapons:");
    for (const w of u.weapons) {
      lines.push(
        `- ${w.name} (${w.kind}${w.range ? ` ${w.range}` : ""}): Atk ${w.attacks} Hit ${w.hit} Wnd ${w.wound} Rnd ${w.rend} Dmg ${w.damage}${w.ability && w.ability !== "-" ? ` — ${w.ability}` : ""}`,
      );
    }
  }
  if (u.abilities.length) {
    lines.push("Abilities:");
    for (const a of u.abilities) lines.push(abilityText(a));
  }
  return lines.join("\n");
}

export function factionRulesText(rules: FactionRule[], filter?: (r: FactionRule) => boolean): string {
  const byGroup = new Map<string, FactionRule[]>();
  for (const r of rules.filter(filter ?? (() => true))) {
    const g = r.group || r.entry || "Rules";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(r);
  }
  const out: string[] = [];
  for (const [g, rs] of byGroup) {
    out.push(`### ${g}`);
    for (const r of rs) out.push(abilityText({ ...r.ability, name: r.entry && r.entry !== r.ability.name ? `${r.entry}: ${r.ability.name}` : r.ability.name }));
  }
  return out.join("\n");
}

// Path to Glory / narrative-only groups are noise for matched play.
const NARRATIVE = /battle (scars|wounds)|path|anvil of apotheosis|aqshian artefacts|thyrian wonders|hallmarks|pride of thyria|veteran abilit|renown/i;
export const matchedPlayRule = (r: FactionRule) => !NARRATIVE.test(`${r.group} ${r.entry}`);

/** Everything the coach needs to know about one army list. */
export function listDossier(list: ArmyList): string {
  const d = gameData();
  const faction = d.factions[list.faction];
  const lines = [
    `# ${list.owner === "me" ? "MY ARMY" : "OPPONENT ARMY"}: ${list.name} (${list.faction})`,
    "",
    "## List as written",
    list.rawText.trim() || "(no list text)",
    "",
  ];
  if (list.unmatched.length) lines.push(`Lines not matched to a warscroll: ${list.unmatched.join(" | ")}`, "");
  if (faction) {
    // Only include the faction rules that matter: battle traits always, other
    // groups only when the list mentions their entries.
    const raw = norm(list.rawText);
    const relevant = faction.rules.filter(
      (r) => matchedPlayRule(r) && (/battle traits/i.test(r.entry) || /battle traits/i.test(r.group) || (r.entry && raw.includes(norm(r.entry)))),
    );
    lines.push(`## Faction rules used by this list`, factionRulesText(relevant), "");
  }
  lines.push("## Warscrolls");
  const seen = new Set<string>();
  for (const lu of list.units) {
    const u = d.units[lu.unitId];
    if (!u) continue;
    const key = `${u.id}:${lu.reinforced}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(warscrollText(u, { reinforced: lu.reinforced }), "");
  }
  return lines.join("\n");
}
