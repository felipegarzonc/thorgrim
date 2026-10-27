// Deterministic dice math for AoS 4th edition. The coach calls these
// functions instead of estimating odds itself.
//
// Attack sequence modelled: hit roll -> wound roll -> save roll -> damage ->
// ward. Unmodified 1s always fail, unmodified 6s to hit are critical hits.
// Hit and wound modifiers are capped at +/-1; positive save modifiers at +1;
// rend is uncapped.

export type Reroll = "none" | "ones" | "failed";
export type Crit = "none" | "2 hits" | "auto-wound" | "mortal";

export interface AttackProfile {
  name?: string;
  attacks: string; // "4", "D6", "2D6", "D3+1"
  hit: number; // 4 for 4+
  wound: number;
  rend: number;
  damage: string;
  crit: Crit;
  hitMod?: number;
  woundMod?: number;
  rerollHits?: Reroll;
  rerollWounds?: Reroll;
  /** Models attacking with this weapon (attacks are per model). */
  models?: number;
}

export interface TargetProfile {
  save: number | null; // null = no save
  ward?: number | null;
  saveMod?: number; // e.g. +1 for cover / All-out Defence
  rerollSaves?: Reroll;
  health?: number; // per model
  models?: number;
  damageTaken?: number; // damage already on the unit
}

// ---------- dice expressions ----------

export interface DiceExpr {
  count: number;
  sides: number; // 0 = flat value
  flat: number;
}

export function parseDice(expr: string | number): DiceExpr {
  if (typeof expr === "number") return { count: 0, sides: 0, flat: expr };
  const s = expr.replace(/\s+/g, "").toUpperCase();
  if (s === "" || s === "-") return { count: 0, sides: 0, flat: 0 };
  const m = /^(\d*)D(\d+)(?:\+(\d+))?$/.exec(s);
  if (m) return { count: m[1] ? Number(m[1]) : 1, sides: Number(m[2]), flat: m[3] ? Number(m[3]) : 0 };
  const n = Number(s);
  if (Number.isFinite(n)) return { count: 0, sides: 0, flat: n };
  throw new Error(`Unrecognised dice expression: ${expr}`);
}

export const diceMean = (d: DiceExpr) => d.count * (d.sides + 1) / 2 + d.flat;

export function rollDice(d: DiceExpr, rng: () => number = Math.random): number {
  let total = d.flat;
  for (let i = 0; i < d.count; i++) total += 1 + Math.floor(rng() * d.sides);
  return total;
}

/** Parse "4+" style characteristics; returns null for "-" or empty. */
export function parseTarget(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const m = /(\d)\+?/.exec(value);
  return m ? Number(m[1]) : null;
}

export function parseCrit(ability: string): Crit {
  const a = ability.toLowerCase();
  if (a.includes("crit (2 hits)")) return "2 hits";
  if (a.includes("crit (auto-wound)")) return "auto-wound";
  if (a.includes("crit (mortal)")) return "mortal";
  return "none";
}

// ---------- single-die probabilities ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Probability distribution over final unmodified faces 1..6 after an
 * optional re-roll. `succeeds(face)` decides success, used for "failed".
 */
function faceDistribution(succeeds: (face: number) => boolean, reroll: Reroll): number[] {
  const rerolled = (f: number) => (reroll === "ones" ? f === 1 : reroll === "failed" ? !succeeds(f) : false);
  const pReroll = [1, 2, 3, 4, 5, 6].filter(rerolled).length / 6;
  const dist = [0];
  for (let f = 1; f <= 6; f++) dist.push((rerolled(f) ? 0 : 1 / 6) + pReroll / 6);
  return dist;
}

/** Success test for a hit/wound roll (target n+, modifier capped to +/-1). */
function rollSucceeds(target: number, mod: number) {
  const m = clamp(mod, -1, 1);
  return (face: number) => face !== 1 && (face === 6 || face + m >= target);
}

export function hitChances(p: AttackProfile) {
  const ok = rollSucceeds(p.hit, p.hitMod ?? 0);
  const dist = faceDistribution(ok, p.rerollHits ?? "none");
  const crit = dist[6];
  let success = 0;
  for (let f = 1; f <= 6; f++) if (ok(f)) success += dist[f];
  return { crit, normal: success - crit };
}

export function woundChance(p: AttackProfile) {
  const ok = rollSucceeds(p.wound, p.woundMod ?? 0);
  const dist = faceDistribution(ok, p.rerollWounds ?? "none");
  let success = 0;
  for (let f = 1; f <= 6; f++) if (ok(f)) success += dist[f];
  return success;
}

/** Probability that a save roll FAILS against the given rend. */
export function failedSaveChance(t: TargetProfile, rend: number) {
  if (t.save === null) return 1;
  const mod = Math.min(t.saveMod ?? 0, 1) - rend;
  const ok = (face: number) => face !== 1 && face + mod >= (t.save as number);
  const dist = faceDistribution(ok, t.rerollSaves ?? "none");
  let success = 0;
  for (let f = 1; f <= 6; f++) if (ok(f)) success += dist[f];
  return 1 - success;
}

export const wardPassChance = (ward?: number | null) => (ward ? (7 - ward) / 6 : 0);

// ---------- expected damage ----------

export interface DamageSummary {
  expectedHits: number;
  expectedWounds: number;
  expectedUnsaved: number;
  expectedMortals: number;
  expectedDamage: number;
}

export function expectedDamage(p: AttackProfile, t: TargetProfile): DamageSummary {
  const attacks = diceMean(parseDice(p.attacks)) * (p.models ?? 1);
  const dmg = diceMean(parseDice(p.damage));
  const { crit, normal } = hitChances(p);
  const pw = woundChance(p);
  const pf = failedSaveChance(t, p.rend);
  const keep = 1 - wardPassChance(t.ward);

  const hitsPerAttack = normal + crit * (p.crit === "2 hits" ? 2 : 1);
  let woundsPerAttack: number;
  let mortalPerAttack = 0;
  switch (p.crit) {
    case "auto-wound":
      woundsPerAttack = crit + normal * pw;
      break;
    case "mortal":
      woundsPerAttack = normal * pw;
      mortalPerAttack = crit * dmg;
      break;
    case "2 hits":
      woundsPerAttack = (normal + 2 * crit) * pw;
      break;
    default:
      woundsPerAttack = (normal + crit) * pw;
  }
  const unsavedPerAttack = woundsPerAttack * pf;
  return {
    expectedHits: attacks * hitsPerAttack,
    expectedWounds: attacks * woundsPerAttack,
    expectedUnsaved: attacks * unsavedPerAttack,
    expectedMortals: attacks * mortalPerAttack * keep,
    expectedDamage: attacks * (unsavedPerAttack * dmg + mortalPerAttack) * keep,
  };
}

/** Expected damage against every save value, like a Statshammer table. */
export function damageBySave(profiles: AttackProfile[], base: Omit<TargetProfile, "save"> = {}) {
  const saves: (number | null)[] = [2, 3, 4, 5, 6, null];
  return saves.map((save) => ({
    save: save === null ? "-" : `${save}+`,
    damage: profiles.reduce((sum, p) => sum + expectedDamage(p, { ...base, save }).expectedDamage, 0),
  }));
}

// ---------- simulation ----------

const d6 = (rng: () => number) => 1 + Math.floor(rng() * 6);

function rollWithReroll(succeeds: (f: number) => boolean, reroll: Reroll, rng: () => number) {
  let f = d6(rng);
  if ((reroll === "ones" && f === 1) || (reroll === "failed" && !succeeds(f))) f = d6(rng);
  return f;
}

/** One simulated activation: total damage dealt by the profiles. */
export function simulateOnce(profiles: AttackProfile[], t: TargetProfile, rng: () => number = Math.random): number {
  let total = 0;
  for (const p of profiles) {
    const hitOk = rollSucceeds(p.hit, p.hitMod ?? 0);
    const woundOk = rollSucceeds(p.wound, p.woundMod ?? 0);
    const saveMod = Math.min(t.saveMod ?? 0, 1) - p.rend;
    const saveOk = (f: number) => t.save !== null && f !== 1 && f + saveMod >= (t.save as number);
    const atkExpr = parseDice(p.attacks);
    const dmgExpr = parseDice(p.damage);
    const applyWard = (dmg: number) => {
      if (!t.ward) return dmg;
      let kept = 0;
      for (let i = 0; i < dmg; i++) if (d6(rng) < (t.ward as number)) kept++;
      return kept;
    };
    const resolveWound = () => {
      const s = rollWithReroll(saveOk, t.rerollSaves ?? "none", rng);
      if (!saveOk(s)) total += applyWard(rollDice(dmgExpr, rng));
    };
    for (let m = 0; m < (p.models ?? 1); m++) {
      const attacks = rollDice(atkExpr, rng);
      for (let a = 0; a < attacks; a++) {
        const h = rollWithReroll(hitOk, p.rerollHits ?? "none", rng);
        if (!hitOk(h)) continue;
        const isCrit = h === 6;
        if (isCrit && p.crit === "mortal") {
          total += applyWard(rollDice(dmgExpr, rng));
          continue;
        }
        if (isCrit && p.crit === "auto-wound") {
          resolveWound();
          continue;
        }
        const hits = isCrit && p.crit === "2 hits" ? 2 : 1;
        for (let i = 0; i < hits; i++) {
          const w = rollWithReroll(woundOk, p.rerollWounds ?? "none", rng);
          if (woundOk(w)) resolveWound();
        }
      }
    }
  }
  return total;
}

export interface SimulationResult {
  runs: number;
  mean: number;
  /** P(damage >= n) for n = 0..max */
  atLeast: number[];
  /** Only when target health/models are known. */
  killChance?: number;
  expectedModelsSlain?: number;
}

// ---------- limits ----------
// The calculator takes its numbers from the page (and the coach), so huge
// ones (a million models, "100000D6" attacks) are refused, and runs are cut
// when a unit is big, so one request can't keep the server busy for minutes.

const MAX_PROFILES = 30;
/** Most damage one simulated activation could deal. A real unit is in the low thousands. */
const MAX_DAMAGE = 100_000;
/** Dice rolled across all runs of one simulation, at most. */
const MAX_WORK = 30_000_000;

const maxRoll = (d: DiceExpr) => d.count * d.sides + d.flat;

/** Throws when the profiles can't be a real attack; else the most dice one run can roll. */
export function workPerRun(profiles: AttackProfile[], t: TargetProfile): number {
  if (!Array.isArray(profiles) || profiles.length > MAX_PROFILES) throw new Error(`Up to ${MAX_PROFILES} weapon profiles at a time.`);
  let work = 0;
  let damage = 0;
  for (const p of profiles) {
    const atk = parseDice(p.attacks);
    const dmg = parseDice(p.damage);
    const models = p.models ?? 1;
    const sane = (d: DiceExpr) => d.count <= 100 && d.sides <= 100 && d.flat >= 0 && d.flat <= 1000;
    if (!(Number.isFinite(models) && models >= 0 && models <= 1000) || !sane(atk) || !sane(dmg)) throw new Error("Those numbers are too big for one unit.");
    const attacks = models * maxRoll(atk);
    damage += attacks * 2 * maxRoll(dmg);
    // Per attack: hit, two wounds and saves with re-rolls, damage dice, and a ward roll per point of damage.
    work += models * atk.count + attacks * (6 + 2 * (dmg.count + (t.ward ? maxRoll(dmg) : 0)));
  }
  if (!(damage <= MAX_DAMAGE)) throw new Error("Those numbers are too big for one unit.");
  return Math.max(1, work);
}

export function simulate(profiles: AttackProfile[], t: TargetProfile, runs = 20000, rng: () => number = Math.random): SimulationResult {
  runs = Math.max(1, Math.min(Math.floor(runs) || 1, Math.floor(MAX_WORK / workPerRun(profiles, t))));
  const counts: number[] = [];
  let sum = 0;
  let kills = 0;
  let slain = 0;
  const health = t.health ?? 0;
  const models = t.models ?? 1;
  const already = t.damageTaken ?? 0;
  const pool = health * models;
  for (let i = 0; i < runs; i++) {
    const dmg = simulateOnce(profiles, t, rng);
    sum += dmg;
    counts[dmg] = (counts[dmg] ?? 0) + 1;
    if (health > 0) {
      // In AoS 4 excess damage carries over to the next model in the unit.
      const total = Math.min(already + dmg, pool);
      if (total >= pool) kills++;
      slain += Math.floor(total / health) - Math.floor(already / health);
    }
  }
  const atLeast: number[] = [];
  let remaining = runs;
  for (let n = 0; n < counts.length; n++) {
    atLeast.push(remaining / runs);
    remaining -= counts[n] ?? 0;
  }
  return {
    runs,
    mean: sum / runs,
    atLeast,
    killChance: health > 0 ? kills / runs : undefined,
    expectedModelsSlain: health > 0 ? slain / runs : undefined,
  };
}

// ---------- 2D6 rolls: charges and casting ----------

const twoD6 = (() => {
  const dist = new Array(13).fill(0);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) dist[a + b] += 1 / 36;
  return dist as number[];
})();

const atLeast2D6 = (n: number) => twoD6.reduce((s, p, v) => (v >= n ? s + p : s), 0);

/**
 * Chance to make a charge across `gapInches` (closest edge to closest edge).
 * A charge must end within 1/2" of the target, so the roll needed is
 * ceil(gap - 0.5) after modifiers.
 */
export function chargeChance(gapInches: number, opts: { bonus?: number; reroll?: boolean } = {}) {
  const needed = Math.max(2, Math.ceil(gapInches - 0.5) - (opts.bonus ?? 0));
  const p = atLeast2D6(needed);
  return { needed, chance: opts.reroll ? 1 - (1 - p) ** 2 : p };
}

/**
 * Casting a spell (or chanting a prayer) with value `castingValue`.
 * Miscast on an unmodified double 1. If the opponent can unbind, they need
 * to roll higher than the casting roll on 2D6 (+ their modifier).
 */
export function castChance(castingValue: number, opts: { castMod?: number; unbind?: boolean; unbindMod?: number } = {}) {
  let cast = 0;
  let castNotUnbound = 0;
  const miscast = 1 / 36;
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      if (a === 1 && b === 1) continue;
      const roll = a + b + (opts.castMod ?? 0);
      if (roll < castingValue) continue;
      cast += 1 / 36;
      // Unbind needs to beat the casting roll.
      const pUnbind = opts.unbind ? atLeast2D6(roll + 1 - (opts.unbindMod ?? 0)) : 0;
      castNotUnbound += (1 / 36) * (1 - pUnbind);
    }
  }
  return { cast, castNotUnbound, miscast };
}
