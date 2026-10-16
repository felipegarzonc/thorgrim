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

export function parseList(text: string, factionHint?: string): Pick<ArmyList, "faction" | "units" | "unmatched"> {
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
  let last: ListUnit | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isBullet = BULLET.test(rawLine);
    const content = line.replace(BULLET, "");
    if (isBullet && last) {
      if (/^reinforced$/i.test(content.trim())) last.reinforced = true;
      else last.notes.push(content);
      continue;
    }
    const qty = Number(QTY.exec(content)?.[1] ?? 1);
    const name = content.replace(QTY, "").replace(POINTS, "");
    const unit = match(name);
    if (unit) {
      for (let i = 0; i < qty; i++) {
        last = {
          key: `${units.length + 1}`,
          unitId: unit.id,
          name: unit.name,
          reinforced: /reinforced/i.test(content),
          points: pointsFor(unit.id, faction) ?? pointsFor(unit.id, base),
          notes: [],
        };
        units.push(last);
      }
    } else if (UNIT_LINE.test(content) && !content.includes("/")) {
      // Looks like a unit line ("Something (150)") but we don't know it.
      unmatched.push(content);
      last = undefined;
    }
  }
  return { faction, units, unmatched };
}
