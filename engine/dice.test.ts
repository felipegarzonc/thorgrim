import { describe, expect, it } from "vitest";
import {
  castChance,
  chargeChance,
  damageBySave,
  expectedDamage,
  failedSaveChance,
  hitChances,
  parseCrit,
  parseDice,
  simulate,
  type AttackProfile,
} from "./dice.ts";

// Small seeded RNG so simulation tests are deterministic.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const meatcleavers: AttackProfile = { attacks: "4", hit: 4, wound: 2, rend: 2, damage: "3", crit: "mortal" };

describe("parseDice", () => {
  it("parses flat values and dice", () => {
    expect(parseDice("3")).toEqual({ count: 0, sides: 0, flat: 3 });
    expect(parseDice("D3")).toEqual({ count: 1, sides: 3, flat: 0 });
    expect(parseDice("2D6")).toEqual({ count: 2, sides: 6, flat: 0 });
    expect(parseDice("d3+1")).toEqual({ count: 1, sides: 3, flat: 1 });
  });
  it("rejects garbage", () => {
    expect(() => parseDice("lots")).toThrow();
  });
});

describe("single rolls", () => {
  it("4+ to hit: 1/6 crit, 2/6 normal", () => {
    const { crit, normal } = hitChances({ ...meatcleavers, crit: "none" });
    expect(crit).toBeCloseTo(1 / 6);
    expect(normal).toBeCloseTo(2 / 6);
  });
  it("caps hit modifiers at +1", () => {
    const { crit, normal } = hitChances({ ...meatcleavers, hitMod: 3 });
    expect(crit + normal).toBeCloseTo(4 / 6);
  });
  it("re-rolling failed hits on 4+ gives 3/4", () => {
    const { crit, normal } = hitChances({ ...meatcleavers, rerollHits: "failed" });
    expect(crit + normal).toBeCloseTo(0.75);
  });
  it("save 4+ against rend 2 fails 5/6 of the time", () => {
    expect(failedSaveChance({ save: 4 }, 2)).toBeCloseTo(5 / 6);
  });
  it("an unmodified 1 always fails a save", () => {
    expect(failedSaveChance({ save: 2, saveMod: 1 }, 0)).toBeCloseTo(1 / 6);
  });
  it("detects crit abilities", () => {
    expect(parseCrit("Crit (Mortal)")).toBe("mortal");
    expect(parseCrit("Anti-charge (+1 Rend), Crit (2 Hits)")).toBe("2 hits");
    expect(parseCrit("-")).toBe("none");
  });
});

describe("expectedDamage", () => {
  it("matches a hand calculation (Tyrant vs 4+ save)", () => {
    // Per attack: crit 1/6 -> 3 mortal; normal hit 2/6 * wound 5/6 * fail 5/6 * 3
    const perAttack = (1 / 6) * 3 + (2 / 6) * (5 / 6) * (5 / 6) * 3;
    expect(expectedDamage(meatcleavers, { save: 4 }).expectedDamage).toBeCloseTo(4 * perAttack);
  });
  it("applies ward to all damage", () => {
    const noWard = expectedDamage(meatcleavers, { save: 4 }).expectedDamage;
    const ward5 = expectedDamage(meatcleavers, { save: 4, ward: 5 }).expectedDamage;
    expect(ward5).toBeCloseTo(noWard * (4 / 6));
  });
  it("produces a row per save", () => {
    const rows = damageBySave([meatcleavers]);
    expect(rows.map((r) => r.save)).toEqual(["2+", "3+", "4+", "5+", "6+", "-"]);
    expect(rows[0].damage).toBeLessThan(rows[5].damage);
  });
});

describe("simulate", () => {
  it("agrees with the analytic mean", () => {
    const profile: AttackProfile = { attacks: "D6", hit: 3, wound: 4, rend: 1, damage: "D3", crit: "2 hits", models: 3 };
    const target = { save: 4, ward: 6 };
    const sim = simulate([profile], target, 40000, mulberry32(1));
    expect(sim.mean).toBeCloseTo(expectedDamage(profile, target).expectedDamage, 0);
    expect(sim.atLeast[0]).toBe(1);
  });
  it("reports kill chance with damage carrying over between models", () => {
    const sim = simulate([{ attacks: "10", hit: 2, wound: 2, rend: 3, damage: "2", crit: "none" }], { save: 6, health: 1, models: 3 }, 5000, mulberry32(2));
    expect(sim.killChance).toBeGreaterThan(0.99);
    expect(sim.expectedModelsSlain).toBeCloseTo(3, 1);
  });
});

describe("2D6", () => {
  it("a 9\" charge needs a 9", () => {
    const { needed, chance } = chargeChance(9);
    expect(needed).toBe(9);
    expect(chance).toBeCloseTo(10 / 36);
  });
  it("re-rolls improve the charge", () => {
    expect(chargeChance(9, { reroll: true }).chance).toBeCloseTo(1 - (26 / 36) ** 2);
  });
  it("casting value 7 without unbind", () => {
    const { cast, miscast } = castChance(7);
    expect(cast).toBeCloseTo(21 / 36);
    expect(miscast).toBeCloseTo(1 / 36);
  });
  it("unbinding reduces the success chance", () => {
    const r = castChance(7, { unbind: true });
    expect(r.castNotUnbound).toBeLessThan(r.cast);
  });
});
