// In-game tools shared by the round screens: the "don't forget" checklist,
// attack odds, unit damage, the board notes and the game log.

import { useEffect, useMemo, useState } from "react";
import type { AttackProfile, Crit, SimulationResult } from "../../../engine/dice.ts";
import { CORE_COMMANDS, SEASON_ABILITIES, usableBy } from "../../../shared/season.ts";
import type { Ability, ArmyList, FactionRule, Game, GameState, ListUnit, Phase, Unit } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, Icon, RulesText } from "../ui.tsx";

export type Side = "me" | "opponent";
export type Update = (patch: Partial<GameState>, log?: string) => void;

export const other = (s: Side): Side => (s === "me" ? "opponent" : "me");

const PHASE_MATCH: Record<Phase, RegExp> = {
  Deployment: /deployment/,
  "Start of Turn": /start of (the |any |your |enemy |)?(turn|battle round)/,
  Hero: /hero phase/,
  Movement: /movement phase/,
  Shooting: /shooting phase/,
  Charge: /charge phase/,
  Combat: /combat phase/,
  "End of Turn": /end of (the |any |your |enemy |)?(turn|battle round)/,
};

/** Is this ability usable by `owner` in `phase` while `active` is taking their turn? */
export function usableNow(a: Ability, phase: Phase, owner: Side, active: Side): boolean {
  if (!a.timing || a.kind === "Ability (Passive)" || a.kind === "Rule") return false;
  const t = a.timing.toLowerCase();
  if (!PHASE_MATCH[phase].test(t)) return false;
  if (/\byour\b/.test(t)) return owner === active;
  if (/\benemy\b/.test(t)) return owner !== active;
  return true;
}

// ---------- data hooks ----------

export function useUnits(lists: (ArmyList | undefined)[]) {
  const [units, setUnits] = useState<Record<string, Unit>>({});
  const ids = [...new Set(lists.flatMap((l) => l?.units.map((u) => u.unitId) ?? []))].sort().join(",");
  useEffect(() => {
    if (!ids) return;
    Promise.all(ids.split(",").map((id) => api<Unit>(`/units/${id}`))).then((us) => setUnits(Object.fromEntries(us.map((u) => [u.id, u]))));
  }, [ids]);
  return units;
}

/** Total health of a list unit (doubled models when reinforced). */
function unitHealth(lu: ListUnit, u?: Unit) {
  if (!u?.stats) return undefined;
  const h = Number(u.stats.health);
  return Number.isFinite(h) ? h * u.models * (lu.reinforced ? 2 : 1) : undefined;
}

export interface Army {
  side: Side;
  list?: ArmyList;
  rules: FactionRule[];
}


// ---------- don't forget ----------

interface Source {
  owner: Side;
  from: string;
  ability: Ability;
}

const ONCE_PER_BATTLE = /once per battle(?! round)/i;
const usedKey = (x: { owner: Side; ability: Ability }) => `${x.owner}:${x.ability.name}`;

/**
 * What each player can do this phase, folded under a summary that says how
 * many. Once-per-battle abilities can be marked as used, and then drop out.
 */
export function PhaseChecklist({ game, armies, units, update }: { game: Game; armies: Record<Side, Army>; units: Record<string, Unit>; update: Update }) {
  const s = game.state;
  const sources = useMemo(() => {
    const out: Source[] = [];
    for (const side of ["me", "opponent"] as const) {
      const { list, rules } = armies[side];
      const seen = new Set<string>();
      for (const lu of list?.units ?? []) {
        if (s.units[`${side}:${lu.key}`]?.destroyed || seen.has(lu.unitId)) continue;
        seen.add(lu.unitId);
        for (const a of units[lu.unitId]?.abilities ?? []) out.push({ owner: side, from: lu.name, ability: a });
      }
      for (const r of rules) out.push({ owner: side, from: r.group && !/battle traits/i.test(r.group) ? r.group : r.entry || "Faction", ability: r.ability });
    }
    return out;
  }, [armies, units, s.units]);

  const used = s.used ?? {};
  const isUsed = (x: Source) => ONCE_PER_BATTLE.test(x.ability.timing ?? "") && used[usedKey(x)] !== undefined;
  const now = sources.filter((x) => usableNow(x.ability, s.phase, x.owner, s.activePlayer) && !isUsed(x));
  const spent = sources.filter(isUsed);
  const markUsed = (x: Source, on: boolean) => {
    const next = { ...used };
    if (on) next[usedKey(x)] = s.round;
    else delete next[usedKey(x)];
    update({ used: next }, on ? `Used ${x.ability.name} (once per battle).` : undefined);
  };
  const reactions = sources.filter((x) => x.ability.timing?.toLowerCase().startsWith("reaction"));
  const commands = [...CORE_COMMANDS, ...SEASON_ABILITIES];
  const commandsFor = (o: Side) => commands.filter((c) => usableBy(c, s.phase, o, s.activePlayer) && (c.cost === 0 || c.cost <= s.cp[o]));

  const AbilityItem = ({ x }: { x: Source }) => {
    const value = x.ability.extra?.["Casting Value"] ?? x.ability.extra?.["Chanting Value"];
    return (
      <li>
        <details>
          <summary>
            <span className="name">
              <b>{x.ability.name}</b>
              <span>
                {x.from}
                {value ? ` · ${x.ability.extra?.["Casting Value"] ? "cast" : "chant"} ${value}` : ""}
                {x.ability.timing ? ` · ${x.ability.timing}` : " · always on"}
              </span>
            </span>
            <span className={`who ${x.owner}`}>{x.owner === "me" ? "YOU" : "THEM"}</span>
          </summary>
          <div className="body">
            {x.ability.declare && <RulesText text={`*Declare:* ${x.ability.declare}`} />}
            <RulesText text={x.ability.effect} />
            {ONCE_PER_BATTLE.test(x.ability.timing ?? "") &&
              (isUsed(x) ? (
                <button type="button" className="small ghost" onClick={() => markUsed(x, false)}>
                  Used in round {used[usedKey(x)]} · Undo
                </button>
              ) : (
                <button type="button" className="small" onClick={() => markUsed(x, true)}>
                  Mark as used
                </button>
              ))}
          </div>
        </details>
      </li>
    );
  };
  const CommandItem = ({ c, o }: { c: (typeof commands)[number]; o: Side }) => (
    <li>
      <details>
        <summary>
          <span className="name">
            <b>{c.name}</b>
            <span>{c.cost > 0 ? "Command" : "Season rule"}</span>
          </span>
          <span className={`who ${o}`}>
            {o === "me" ? "YOU" : "THEM"}
            {c.cost > 0 ? ` · ${c.cost} CP` : ""}
          </span>
        </summary>
        <div className="body">{c.summary}</div>
      </details>
    </li>
  );
  // Army-wide passives (formation, enhancements) never match a phase, so list them once.
  const alwaysOn = (["me", "opponent"] as const).flatMap((side) =>
    armies[side].rules
      .filter((r) => !r.ability.timing && r.ability.kind !== "Rule" && !/battle traits/i.test(`${r.group} ${r.entry}`))
      .map((r) => ({ owner: side, from: r.group || r.entry, ability: r.ability })),
  );
  const mine = now.filter((x) => x.owner === "me");
  const theirs = now.filter((x) => x.owner === "opponent");

  const yours = mine.length + commandsFor("me").length;
  const them = theirs.length + commandsFor("opponent").length;
  return (
    <details className="forget-wrap">
      <summary>
        <span>
          Don't forget this phase{yours + them > 0 && <span className="forget-count"> · {yours} yours · {them} theirs</span>}
        </span>
        <Icon name="down" />
      </summary>
    <Card title={`${s.phase} — don't forget`}>
      <ul className="forget">
        {mine.map((x, i) => (
          <AbilityItem key={`m${i}`} x={x} />
        ))}
        {commandsFor("me").map((c) => (
          <CommandItem key={`mc${c.name}`} c={c} o="me" />
        ))}
        {(theirs.length > 0 || commandsFor("opponent").length > 0) && <hr className="divider" />}
        {theirs.map((x, i) => (
          <AbilityItem key={`t${i}`} x={x} />
        ))}
        {commandsFor("opponent").map((c) => (
          <CommandItem key={`tc${c.name}`} c={c} o="opponent" />
        ))}
      </ul>
      {alwaysOn.length > 0 && (
        <details>
          <summary className="muted small" style={{ padding: "0.5rem 0", cursor: "pointer" }}>
            Always on: formation & enhancements ({alwaysOn.length})
          </summary>
          <ul className="forget">
            {alwaysOn.map((x, i) => (
              <AbilityItem key={`p${i}`} x={x} />
            ))}
          </ul>
        </details>
      )}
      {spent.length > 0 && (
        <details>
          <summary className="muted small" style={{ padding: "0.5rem 0", cursor: "pointer" }}>
            Once per battle, already used ({spent.length})
          </summary>
          <ul className="forget">
            {spent.map((x, i) => (
              <AbilityItem key={`u${i}`} x={x} />
            ))}
          </ul>
        </details>
      )}
      {reactions.length > 0 && (
        <details>
          <summary className="muted small" style={{ padding: "0.5rem 0", cursor: "pointer" }}>
            Reactions in play ({reactions.length})
          </summary>
          <ul className="forget">
            {reactions.map((x, i) => (
              <AbilityItem key={`r${i}`} x={x} />
            ))}
          </ul>
        </details>
      )}
    </Card>
    </details>
  );
}

// ---------- attack odds ----------

const num = (v: string) => Number(/(\d+)/.exec(v)?.[1] ?? 0);
const critOf = (a: string): Crit => {
  const t = a.toLowerCase();
  return t.includes("2 hits") ? "2 hits" : t.includes("auto-wound") ? "auto-wound" : t.includes("crit (mortal)") ? "mortal" : "none";
};
const plusOne = (dmg: string) => (/^\d+$/.test(dmg) ? String(Number(dmg) + 1) : /\+\d+$/.test(dmg) ? dmg.replace(/\+(\d+)$/, (_, n) => `+${Number(n) + 1}`) : `${dmg}+1`);

interface GameUnit {
  key: string;
  side: Side;
  lu: ListUnit;
  u?: Unit;
  health?: number;
  damage: number;
  destroyed: boolean;
}

function gameUnits(game: Game, armies: Record<Side, Army>, units: Record<string, Unit>): GameUnit[] {
  return (["me", "opponent"] as const).flatMap((side) =>
    (armies[side].list?.units ?? []).map((lu) => {
      const key = `${side}:${lu.key}`;
      const st = game.state.units[key] ?? { damage: 0, destroyed: false };
      const u = units[lu.unitId];
      return { key, side, lu, u, health: unitHealth(lu, u), damage: st.damage, destroyed: st.destroyed };
    }),
  );
}

export function OddsCard({ game, armies, units }: { game: Game; armies: Record<Side, Army>; units: Record<string, Unit> }) {
  const s = game.state;
  const all = gameUnits(game, armies, units).filter((g) => !g.destroyed && g.u);
  const [attackerKey, setAttackerKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [ranged, setRanged] = useState(s.phase === "Shooting");
  const [charged, setCharged] = useState(s.phase === "Charge" || s.phase === "Combat");
  const [aoa, setAoa] = useState(false);
  const [saveBonus, setSaveBonus] = useState(false);
  const [result, setResult] = useState<{ mean: number; sim: SimulationResult }>();
  const [open, setOpen] = useState(false);

  useEffect(() => setRanged(s.phase === "Shooting"), [s.phase]);
  const attacker = all.find((g) => g.key === attackerKey) ?? all.find((g) => g.side === s.activePlayer);
  const target = all.find((g) => g.key === targetKey && g.side !== attacker?.side) ?? all.find((g) => g.side !== attacker?.side);

  const profiles: AttackProfile[] = useMemo(() => {
    if (!attacker?.u) return [];
    const perModel = num(attacker.u.stats?.health ?? "0");
    const models = attacker.u.models * (attacker.lu.reinforced ? 2 : 1);
    const alive = perModel ? Math.max(1, models - Math.floor(attacker.damage / perModel)) : models;
    return attacker.u.weapons
      .filter((w) => (w.kind === "ranged") === ranged)
      .map((w) => ({
        name: w.name,
        attacks: w.attacks,
        hit: num(w.hit),
        wound: num(w.wound),
        rend: w.rend === "-" ? 0 : num(w.rend),
        damage: charged && /charge \(\+1 damage\)/i.test(w.ability) ? plusOne(w.damage) : w.damage,
        crit: critOf(w.ability),
        models: alive,
        hitMod: aoa ? 1 : 0,
      }));
  }, [attacker?.key, attacker?.damage, ranged, charged, aoa, units]);

  const tu = target?.u;
  const targetProfile = tu?.stats
    ? {
        save: num(tu.stats.save) || null,
        ward: tu.stats.ward ? num(tu.stats.ward) : null,
        saveMod: saveBonus ? 1 : 0,
        health: num(tu.stats.health),
        models: tu.models * (target!.lu.reinforced ? 2 : 1),
        damageTaken: target!.damage,
      }
    : undefined;

  useEffect(() => {
    if (!open || !profiles.length || !targetProfile) return setResult(undefined);
    const t = setTimeout(() => {
      api<{ simulation: SimulationResult; perProfile: { expectedDamage: number }[] }>("/calc/damage", {
        method: "POST",
        json: { profiles, target: targetProfile, runs: 10000 },
      }).then((r) => setResult({ mean: r.perProfile.reduce((a, p) => a + p.expectedDamage, 0), sim: r.simulation }));
    }, 200);
    return () => clearTimeout(t);
  }, [open, JSON.stringify(profiles), JSON.stringify(targetProfile)]);

  const options = (side: Side | "other") =>
    all
      .filter((g) => (side === "other" ? g.side !== attacker?.side : true))
      .map((g) => (
        <option key={g.key} value={g.key}>
          {g.side === "me" ? "Mine" : "Theirs"} · {g.lu.name}
          {g.lu.reinforced ? " (R)" : ""}
          {g.damage ? ` (−${g.damage})` : ""}
        </option>
      ));

  return (
    <Card>
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer", listStyle: "none" }}>
          <h2 style={{ display: "inline" }}>Attack odds</h2> <span className="muted small">— who can kill what, with current damage</span>
        </summary>
        <div className="grid2" style={{ marginTop: "0.6rem" }}>
          <label>
            Attacker
            <select value={attacker?.key ?? ""} onChange={(e) => setAttackerKey(e.target.value)}>
              {options("me")}
            </select>
          </label>
          <label>
            Target
            <select value={target?.key ?? ""} onChange={(e) => setTargetKey(e.target.value)}>
              {options("other")}
            </select>
          </label>
        </div>
        <div className="chips" style={{ margin: "0.3rem 0" }}>
          <button type="button" className={`chip ${ranged ? "" : "strong"}`} aria-pressed={!ranged} onClick={() => setRanged(false)}>
            Melee
          </button>
          <button type="button" className={`chip ${ranged ? "strong" : ""}`} aria-pressed={ranged} onClick={() => setRanged(true)}>
            Shooting
          </button>
          <button type="button" className={`chip ${charged ? "strong" : ""}`} aria-pressed={charged} onClick={() => setCharged(!charged)}>
            Charged
          </button>
          <button type="button" className={`chip ${aoa ? "strong" : ""}`} aria-pressed={aoa} onClick={() => setAoa(!aoa)}>
            All-out Attack
          </button>
          <button type="button" className={`chip ${saveBonus ? "strong" : ""}`} aria-pressed={saveBonus} onClick={() => setSaveBonus(!saveBonus)}>
            Target +1 save
          </button>
        </div>
        {!profiles.length && <p className="muted small">{attacker?.lu.name} has no {ranged ? "shooting" : "melee"} weapons.</p>}
        {result && profiles.length > 0 && (
          <div className="kpis">
            <div>
              <span className="kpi accent">{result.mean.toFixed(1)}</span>
              <span className="muted small">average damage</span>
            </div>
            {result.sim.killChance !== undefined && (
              <div>
                <span className="kpi">{Math.round(result.sim.killChance * 100)}%</span>
                <span className="muted small">to destroy {target?.lu.name}</span>
              </div>
            )}
            {result.sim.expectedModelsSlain !== undefined && (
              <div>
                <span className="kpi">{result.sim.expectedModelsSlain.toFixed(1)}</span>
                <span className="muted small">models slain</span>
              </div>
            )}
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Uses the warscroll weapons and models still alive. Other buffs (spells, auras, champions): use the full Calculator.
        </p>
      </details>
    </Card>
  );
}

// ---------- units ----------

export function UnitsCard({ game, armies, units, update }: { game: Game; armies: Record<Side, Army>; units: Record<string, Unit>; update: Update }) {
  const s = game.state;
  const [view, setView] = useState<Side>(other(s.activePlayer));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showDead, setShowDead] = useState(false);
  useEffect(() => setView(other(s.activePlayer)), [s.activePlayer]);

  const list = gameUnits(game, armies, units).filter((g) => g.side === view);
  const dead = list.filter((g) => g.destroyed);
  const shown = list.filter((g) => showDead || !g.destroyed);

  const change = (g: GameUnit, damage: number, destroyed?: boolean) => {
    const dmg = Math.max(0, damage);
    const isDead = destroyed ?? (g.health !== undefined && dmg >= g.health);
    const who = `${g.side === "me" ? "My" : "Their"} ${g.lu.name}`;
    const log =
      isDead && !g.destroyed
        ? `${who} destroyed.`
        : !isDead && g.destroyed
          ? `${who} back on the table.`
          : dmg > g.damage
            ? `${who} took ${dmg - g.damage} damage${g.health ? ` (${Math.max(0, g.health - dmg)}/${g.health} left)` : ""}.`
            : undefined;
    update({ units: { ...s.units, [g.key]: { damage: dmg, destroyed: isDead } } }, log);
    if (isDead) setOpenKey(null);
  };

  return (
    <Card
      title="Units"
      actions={
        <div className="seg" role="group" aria-label="Which army">
          {(["opponent", "me"] as const).map((v) => (
            <button key={v} type="button" className={view === v ? `active ${v}` : ""} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "me" ? "Mine" : "Theirs"}
            </button>
          ))}
        </div>
      }
    >
      {shown.map((g) => {
        const left = g.health !== undefined ? (g.destroyed ? 0 : Math.max(0, g.health - g.damage)) : undefined;
        const isOpen = openKey === g.key;
        return (
          <div key={g.key} className={`unit-row ${g.destroyed ? "destroyed" : ""}`}>
            <button type="button" className="unit-main unit-toggle" aria-expanded={isOpen} onClick={() => setOpenKey(isOpen ? null : g.key)}>
              <span className="unit-top">
                <span>
                  {g.lu.name}
                  {g.lu.reinforced ? " (R)" : ""}
                </span>
                <span className="muted">{g.destroyed ? "destroyed" : left !== undefined ? `${left} / ${g.health}` : ""}</span>
              </span>
              {g.health !== undefined && (
                <span className={`hp ${g.side}`} aria-hidden="true">
                  <span style={{ width: `${((left ?? 0) / g.health) * 100}%` }} />
                </span>
              )}
            </button>
            {isOpen && (
              <div className="quick">
                {g.destroyed ? (
                  <button type="button" onClick={() => change(g, 0, false)}>
                    Bring back
                  </button>
                ) : (
                  <>
                    <button type="button" aria-label="Heal 1" onClick={() => change(g, g.damage - 1)}>
                      −1
                    </button>
                    {[1, 3, 5].map((n) => (
                      <button key={n} type="button" className="dmg" aria-label={`${n} damage`} onClick={() => change(g, g.damage + n)}>
                        +{n}
                      </button>
                    ))}
                    <button type="button" className="kill" onClick={() => change(g, g.health ?? g.damage, true)}>
                      Destroyed
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {dead.length > 0 && (
        <button type="button" className="small" style={{ marginTop: "0.5rem" }} onClick={() => setShowDead(!showDead)}>
          {showDead ? "Hide" : "Show"} {dead.length} destroyed
        </button>
      )}
    </Card>
  );
}

// ---------- coach tab extras ----------

export function BoardInfo({ state, update }: { state: GameState; update: Update }) {
  const [objectives, setObjectives] = useState(state.objectives);
  const [notes, setNotes] = useState(state.notes);
  const dirty = objectives !== state.objectives || notes !== state.notes;
  return (
    <Card title="Board for Thorgrim">
      <p className="muted small" style={{ marginTop: 0 }}>
        Optional. Thorgrim asks when he needs positions; anything you note here he sees with every question.
      </p>
      <label>
        Objectives
        <input value={objectives} onChange={(e) => setObjectives(e.target.value)} placeholder="e.g. I hold A and C, B contested, they hold D" />
      </label>
      <label>
        Positions & threats
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Hell Pit 8&quot; from my Stonehorn, Jezzails on the left ruin" />
      </label>
      {dirty && (
        <button type="button" className="small primary" onClick={() => update({ objectives, notes })}>
          Save board
        </button>
      )}
    </Card>
  );
}

export function LogCard({ game, update }: { game: Game; update: Update }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    update({}, text.trim());
    setText("");
  };
  return (
    <Card title="Game log">
      <p className="muted small" style={{ marginTop: 0 }}>
        Rounds, scoring, damage and destroyed units are logged automatically. Add anything else worth remembering for the review.
      </p>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. Failed a 6&quot; charge with the Stonehorn" />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
      <ul className="log" translate="no">
        {[...game.log].reverse().map((l, i) => (
          <li key={i}>{l.text}</li>
        ))}
      </ul>
    </Card>
  );
}
