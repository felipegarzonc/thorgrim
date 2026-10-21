import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scoringFor } from "../shared/season.ts";
import { listPoints } from "../shared/types.ts";
import { parseList } from "./listParser.ts";

const hasData = fs.existsSync(path.resolve("data", "aos.json"));

describe.skipIf(!hasData)("parseList", () => {
  const list = `Beastclaw Hunt 1990/2000 pts
Ogor Mawtribes
Hinterland Hunters
Battle Tactic Cards: Blazing Onslaught, Flanking Firestorm

General's Regiment
Frostlord on Stonehorn (340)
• General
Mournfang Pack (400)
• Reinforced
Frost Sabres (70)
Tyrant`;

  it("reads the battle tactic cards line", () => {
    expect(parseList(list).tacticCards).toEqual(["Blazing Onslaught", "Flanking Firestorm"]);
  });

  it("uses the points printed in the list, including reinforcement", () => {
    const units = parseList(list).units;
    const mournfang = units.find((u) => u.name === "Mournfang Pack")!;
    expect(mournfang.reinforced).toBe(true);
    expect(mournfang.points).toBe(400);
    expect(units.find((u) => u.name === "Frostlord on Stonehorn")!.points).toBe(340);
  });

  it("falls back to the army data's points when the list has none", () => {
    const tyrant = parseList(list).units.find((u) => u.name === "Tyrant")!;
    expect(tyrant.points).toBeGreaterThan(0);
  });
});

describe("scoringFor", () => {
  it("knows the standard battleplan lines", () => {
    expect(scoringFor("Into the Fire", 1)?.map((l) => l.vp)).toEqual([3, 3, 4]);
  });
  it("switches round-dependent lines after round 1", () => {
    const r1 = scoringFor("Bloodstained Coasts", 1)!.map((l) => l.label);
    const r2 = scoringFor("Bloodstained Coasts", 2)!.map((l) => l.label);
    expect(r1).toContain("Control more objectives than your opponent");
    expect(r2).toContain("Control an objective your opponent controlled at the start of the turn");
    expect(r2).not.toContain("Control more objectives than your opponent");
  });
  it("matches names loosely and returns null for unknown battleplans", () => {
    expect(scoringFor("what's yours is ours", 3)).not.toBeNull();
    expect(scoringFor("Hidden Under Ash-clouds", 1)).toBeNull();
  });
});

describe.skipIf(!hasData)("GW app extras", () => {
  it("reads labelled units and skips the alliance header", () => {
    const text = [
      "My list 1990/2000 pts",
      "Grand Alliance Destruction | Ogor Mawtribes | Maw-Cult Fanatics (10 Points)",
      "Redd the Maw, High Slaughtermaster (200)",
      "• General",
      "Scourge of Aqshy: Huskard on Thundertusk (260)",
    ].join("\n");
    const r = parseList(text);
    expect(r.unmatched).toEqual([]);
    expect(r.faction).toBe("Ogor Mawtribes");
    const huskard = r.units.find((u) => /Huskard/.test(u.name));
    expect(huskard?.name).toBe("Huskard on Thundertusk (Scourge of Aqshy)");
    expect(huskard?.points).toBe(260);
    expect(r.formation).toEqual({ name: "Maw-Cult Fanatics", points: 10 });
    expect(listPoints(r)).toBe(470);
  });
});
