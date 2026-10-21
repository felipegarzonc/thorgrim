// Turns a pasted army list (GW app, New Recruit, Listhammer…) into units
// matched against the BSData warscrolls.

import type { ArmyList, ListUnit, Unit } from "../shared/types.ts";
import { gameData, norm, pointsFor } from "./data.ts";

const BULLET = /^\s*[•*\-–·]\s*/;
const POINTS = /\s*[([]?\s*\d+\s*(pts|points)?\s*[)\]]?\s*$/i;
// A line that carries a points cost, e.g. "Mysterious Thing (90)" or "Thing 90 pts".
const UNIT_LINE = /\(\s*\d+\s*(pts|points)?\s*\)\s*$|\b\d+\s*(pts|points)\s*$/i;
const QTY = /^\s*(\d+)\s*x\s+/i;

export function detectFaction(text: string): string | undefined {
  const d = gameData();
  const t = norm(text);
  // Longest faction name first so "Ogor Mawtribes - The Roving Maw" wins.
  return Object.keys(d.factions)
    .sort((a, b) => b.length - a.length)
    .find((f) => t.includes(norm(f)));
}

const LISTED_POINTS = /\(\s*(\d+)\s*(?:pts|points)?\s*\)\s*$|\b(\d+)\s*(?:pts|points)\s*$/i;
const TACTICS_LINE = /^battle\s*tactics?(?:\s*cards?)?\s*[:\-–]\s*(.+)$/i;

/** Battle tactic card names mentioned on a "Battle Tactic Cards: A, B" line. */
function tacticCardsIn(line: string): string[] {
  const m = TACTICS_LINE.exec(line.trim());
  if (!m) return [];
  const known = gameData()
    .core.filter((r) => r.ability.kind === "Battle Tactic Card")
    .map((r) => r.ability.name);
  return m[1]
    .split(/,|;|\||\band\b/i)
    .map((part) => known.find((k) => norm(k) === norm(part)))
    .filter((k): k is string => Boolean(k));
}

export function parseList(text: string, factionHint?: string): Pick<ArmyList, "faction" | "units" | "unmatched" | "tacticCards" | "formation"> {
  const d = gameData();
  const faction = factionHint || detectFaction(text) || "";
  const base = faction.split(" - ")[0];
  const factionUnits = new Set((d.factions[faction]?.units ?? d.factions[base]?.units ?? []).map((u) => u.id));
  const all = Object.values(d.units);
  const pools: Unit[][] = [all.filter((u) => factionUnits.has(u.id)), all];

  const match = (name: string): Unit | undefined => {
    const n = norm(name);
    if (!n) return undefined;
    for (const pool of pools) {
      const exact = pool.find((u) => norm(u.name) === n);
      if (exact) return exact;
    }
    for (const pool of pools) {
      const prefix = pool.filter((u) => n.startsWith(norm(u.name) + " ")).sort((a, b) => b.name.length - a.name.length)[0];
      if (prefix) return prefix;
    }
    return undefined;
  };

  const units: ListUnit[] = [];
  const unmatched: string[] = [];
  const tacticCards: string[] = [];
  let formation: ArmyList["formation"];
  const listed = new Map<ListUnit, number>();
  let last: ListUnit | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isBullet = BULLET.test(rawLine);
    const content = line.replace(BULLET, "");
    const cards = tacticCardsIn(content);
    if (cards.length) {
      for (const c of cards) if (!tacticCards.includes(c)) tacticCards.push(c);
      continue;
    }
    if (isBullet && last) {
      if (/^reinforced$/i.test(content.trim())) last.reinforced = true;
      else last.notes.push(content);
      continue;
    }
    const qty = Number(QTY.exec(content)?.[1] ?? 1);
    const pm = LISTED_POINTS.exec(content);
    const listedPoints = pm ? Number(pm[1] ?? pm[2]) / qty : undefined;
    let name = content.replace(QTY, "").replace(POINTS, "");
    let label: string | undefined;
    let unit = match(name);
    // "Scourge of Aqshy: Huskard on Thundertusk (260)": a label before the unit.
    const colon = name.lastIndexOf(":");
    if (!unit && colon > 0 && !/^https?$/i.test(name.slice(0, colon).trim())) {
      // The army data may have its own version, e.g. "Huskard on Thundertusk (Scourge of Aqshy)".
      unit = match(`${name.slice(colon + 1)} (${name.slice(0, colon)})`) ?? match(name.slice(colon + 1));
      if (unit) {
        label = name.slice(0, colon).trim();
        name = name.slice(colon + 1);
      }
    }
    if (unit) {
      for (let i = 0; i < qty; i++) {
        last = {
          key: `${units.length + 1}`,
          unitId: unit.id,
          name: unit.name,
          reinforced: /reinforced/i.test(content),
          points: pointsFor(unit.id, faction) ?? pointsFor(unit.id, base),
          notes: label ? [label] : [],
        };
        units.push(last);
        if (listedPoints !== undefined) listed.set(last, listedPoints);
      }
    } else if (content.includes("|")) {
      // GW app header, "Grand Alliance Destruction | Ogor Mawtribes | Maw-Cult Fanatics (10 Points)":
      // the last part is the battle formation and its cost.
      const part = content.split("|").at(-1)!.trim();
      const fp = LISTED_POINTS.exec(part);
      const fname = part.replace(POINTS, "").trim();
      if (fname && !/grand alliance/i.test(fname) && norm(fname) !== norm(faction)) formation = { name: fname, points: fp ? Number(fp[1] ?? fp[2]) : undefined };
      last = undefined;
    } else if (UNIT_LINE.test(content) && !content.includes("/")) {
      // Looks like a unit line ("Something (150)") but we don't know it.
      unmatched.push(content);
      last = undefined;
    }
  }
  // The list's own points win (they include reinforcement); otherwise use
  // the army data's cost, doubled for reinforced units.
  for (const u of units) {
    const p = listed.get(u);
    if (p !== undefined) u.points = p;
    else if (u.points !== undefined && u.reinforced) u.points *= 2;
  }
  return { faction, units, unmatched, tacticCards, formation };
}
