import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BATTLEPLAN_INFO, battleplanInfo, battleplanText } from "../shared/battleplans.ts";
import { NUMBERED_BATTLEPLANS, scoringFor } from "../shared/season.ts";

describe("battleplans", () => {
  it("covers every battleplan of the season, by name and card title", () => {
    for (const b of NUMBERED_BATTLEPLANS) expect(battleplanInfo(b.name)?.number).toBe(b.number);
    expect(battleplanInfo("In the Flames")?.name).toBe("Into the Fire");
    expect(battleplanInfo("The Might of Kingdoms")?.name).toBe("Power of the Realms");
  });
  it("maps stay on the 60x44 battlefield with sensible territories", () => {
    for (const b of BATTLEPLAN_INFO.filter((b) => b.map)) {
      const m = b.map!;
      for (const p of [...m.objectives, ...m.terrain]) {
        expect(p.x, b.name).toBeGreaterThanOrEqual(0);
        expect(p.x, b.name).toBeLessThanOrEqual(60);
        expect(p.y, b.name).toBeGreaterThanOrEqual(0);
        expect(p.y, b.name).toBeLessThanOrEqual(44);
      }
      const key = (c: [number, number]) => c.join(",");
      expect(m.attacker.filter((c) => m.defender.map(key).includes(key(c))), b.name).toEqual([]);
      expect(m.attacker.length, b.name).toBe(m.defender.length);
      expect(scoringFor(b.name, 1), b.name).not.toBeNull();
    }
  });
  it("describes the battleplan for the coach", () => {
    const t = battleplanText("Curse of the Gnaw");
    expect(t).toContain("Town Echoes");
    expect(t).toContain("Golden Lions (red) at (15\", 11\")");
    expect(t).toContain("Attacker's territory: cells A2 A3 B3 A4 B4 C4");
  });
});

const cards = "/root/.claude/uploads/1e46e6de-174a-556b-a9b1-89d9e16af752/cf941de0-GHB_26-27_ENG.pdf";
describe.skipIf(!fs.existsSync(cards))("cards PDF", () => {
  it("finds one photo per page", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { pageJpegs } = await import("../scripts/upload-battleplans.ts");
    const jpegs = pageJpegs(await PDFDocument.load(fs.readFileSync(cards)));
    expect(jpegs).toHaveLength(18);
    expect(jpegs.every((j) => j && j[0] === 0xff && j[1] === 0xd8)).toBe(true);
  });
});
