import { useEffect, useState } from "react";
import type { AttackProfile, Crit, Reroll, SimulationResult, TargetProfile } from "../../../engine/dice.ts";
import type { Faction, Unit } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, useLoad, useMeta } from "../ui.tsx";

interface Row extends AttackProfile {
  enabled: boolean;
}

interface Result {
  perProfile: { expectedDamage: number; expectedHits: number; expectedWounds: number; expectedUnsaved: number; expectedMortals: number }[];
  bySave: { save: string; damage: number }[];
  simulation: SimulationResult;
}

const num = (s: string) => {
  const m = /(\d+)/.exec(s);
  return m ? Number(m[1]) : 0;
};
const critOf = (ability: string): Crit => {
  const a = ability.toLowerCase();
  return a.includes("2 hits") ? "2 hits" : a.includes("auto-wound") ? "auto-wound" : a.includes("crit (mortal)") ? "mortal" : "none";
};
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

function UnitPicker({ label, onPick, defaultFaction = "" }: { label: string; onPick: (u: Unit, points?: number) => void; defaultFaction?: string }) {
  const meta = useMeta();
  const [faction, setFaction] = useState(defaultFaction);
  const [data] = useLoad<Omit<Faction, "units"> & { units: { id: string; points: number; unit: Unit }[] }>(faction ? `/factions/${encodeURIComponent(faction)}` : null);
  return (
    <div className="grid2">
      <label>
        {label} faction
        <select value={faction} onChange={(e) => setFaction(e.target.value)}>
          <option value="">—</option>
          {meta?.factions.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <label>
        Unit
        <select
          value=""
          onChange={(e) => {
            const entry = data?.units.find((u) => u.id === e.target.value);
            if (entry) onPick(entry.unit, entry.points);
          }}
        >
          <option value="">Pick a unit…</option>
          {data?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.unit.name}
              {u.points ? ` (${u.points})` : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function CalculatorPage() {
  const [attacker, setAttacker] = useState<{ name: string; points?: number }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState<TargetProfile & { name?: string }>({ save: 4, ward: null, saveMod: 0, rerollSaves: "none", health: 0, models: 1, damageTaken: 0 });
  const [result, setResult] = useState<Result>();
  const [pinned, setPinned] = useState<{ label: string; bySave: Result["bySave"] }[]>([]);

  const pickAttacker = (u: Unit, points?: number, reinforced = false) => {
    setAttacker({ name: u.name, points: points ? points * (reinforced ? 2 : 1) : undefined });
    setRows(
      u.weapons.map((w) => ({
        enabled: true,
        name: `${w.name}${w.kind === "ranged" ? ` (${w.range})` : ""}`,
        attacks: w.attacks,
        hit: num(w.hit),
        wound: num(w.wound),
        rend: w.rend === "-" ? 0 : num(w.rend),
        damage: w.damage,
        crit: critOf(w.ability),
        models: u.models * (reinforced ? 2 : 1),
        hitMod: 0,
        woundMod: 0,
        rerollHits: "none",
        rerollWounds: "none",
      })),
    );
  };
  const pickTarget = (u: Unit) =>
    setTarget({
      ...target,
      name: u.name,
      save: u.stats?.save ? num(u.stats.save) || null : null,
      ward: u.stats?.ward ? num(u.stats.ward) : null,
      health: u.stats ? num(u.stats.health) : 0,
      models: u.models,
      damageTaken: 0,
    });

  const active = rows.filter((r) => r.enabled);
  useEffect(() => {
    if (!active.length) return setResult(undefined);
    const t = setTimeout(() => {
      api<Result>("/calc/damage", { method: "POST", json: { profiles: active, target, runs: 20000 } })
        .then(setResult)
        .catch(() => setResult(undefined));
    }, 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(active), JSON.stringify(target)]);

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = result?.perProfile.reduce((s, p, i) => s + (active[i] ? p.expectedDamage : 0), 0) ?? 0;
  const maxBySave = Math.max(1, ...(result?.bySave.map((b) => b.damage) ?? [1]), ...pinned.flatMap((p) => p.bySave.map((b) => b.damage)));

  return (
    <div className="stack">
      <Card title="Attacker" className="attacker">
        <UnitPicker label="Attacker" defaultFaction="Ogor Mawtribes" onPick={(u, p) => pickAttacker(u, p)} />
        {attacker && (
          <p className="muted">
            {attacker.name}
            {attacker.points ? ` · ${attacker.points} pts` : ""} — edit any value below (models, modifiers, re-rolls).
          </p>
        )}
        <div className="table-wrap">
          <table className="calc">
            <thead>
              <tr>
                <th />
                <th>Weapon</th>
                <th>Models</th>
                <th>Atk</th>
                <th>Hit</th>
                <th>Wnd</th>
                <th>Rnd</th>
                <th>Dmg</th>
                <th>Crit</th>
                <th>Hit ±</th>
                <th>Wnd ±</th>
                <th>Re-roll hits</th>
                <th>Re-roll wounds</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <input className="w-name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input className="w-num" type="number" value={r.models} onChange={(e) => setRow(i, { models: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="w-num" value={r.attacks} onChange={(e) => setRow(i, { attacks: e.target.value })} />
                  </td>
                  <td>
                    <input className="w-num" type="number" value={r.hit} onChange={(e) => setRow(i, { hit: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="w-num" type="number" value={r.wound} onChange={(e) => setRow(i, { wound: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="w-num" type="number" value={r.rend} onChange={(e) => setRow(i, { rend: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="w-num" value={r.damage} onChange={(e) => setRow(i, { damage: e.target.value })} />
                  </td>
                  <td>
                    <select value={r.crit} onChange={(e) => setRow(i, { crit: e.target.value as Crit })}>
                      {(["none", "2 hits", "auto-wound", "mortal"] as Crit[]).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="w-num" type="number" min={-1} max={1} value={r.hitMod} onChange={(e) => setRow(i, { hitMod: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="w-num" type="number" min={-1} max={1} value={r.woundMod} onChange={(e) => setRow(i, { woundMod: Number(e.target.value) })} />
                  </td>
                  <td>
                    <RerollSelect value={r.rerollHits ?? "none"} onChange={(v) => setRow(i, { rerollHits: v })} />
                  </td>
                  <td>
                    <RerollSelect value={r.rerollWounds ?? "none"} onChange={(v) => setRow(i, { rerollWounds: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="small"
          onClick={() => setRows([...rows, { enabled: true, name: "Custom", attacks: "2", hit: 4, wound: 4, rend: 0, damage: "1", crit: "none", models: 1, hitMod: 0, woundMod: 0, rerollHits: "none", rerollWounds: "none" }])}
        >
          + Custom profile
        </button>
      </Card>

      <Card title="Target" className="target">
        <UnitPicker label="Target" onPick={pickTarget} />
        <div className="grid3">
          <label>
            Armour save
            <select value={target.save ?? ""} onChange={(e) => setTarget({ ...target, save: e.target.value ? Number(e.target.value) : null })}>
              {[2, 3, 4, 5, 6].map((s) => (
                <option key={s} value={s}>
                  {s}+
                </option>
              ))}
              <option value="">none</option>
            </select>
          </label>
          <label>
            Ward
            <select value={target.ward ?? ""} onChange={(e) => setTarget({ ...target, ward: e.target.value ? Number(e.target.value) : null })}>
              <option value="">none</option>
              {[3, 4, 5, 6].map((s) => (
                <option key={s} value={s}>
                  {s}+
                </option>
              ))}
            </select>
          </label>
          <label>
            Save bonus
            <select value={target.saveMod ?? 0} onChange={(e) => setTarget({ ...target, saveMod: Number(e.target.value) })}>
              <option value={0}>0</option>
              <option value={1}>+1 (cover / All-out Defence)</option>
            </select>
          </label>
          <label>
            Re-roll saves
            <RerollSelect value={target.rerollSaves ?? "none"} onChange={(v) => setTarget({ ...target, rerollSaves: v })} />
          </label>
          <label>
            Health per model
            <input type="number" value={target.health} onChange={(e) => setTarget({ ...target, health: Number(e.target.value) })} />
          </label>
          <label>
            Models
            <input type="number" value={target.models} onChange={(e) => setTarget({ ...target, models: Number(e.target.value) })} />
          </label>
          <label>
            Damage already taken
            <input type="number" value={target.damageTaken} onChange={(e) => setTarget({ ...target, damageTaken: Number(e.target.value) })} />
          </label>
        </div>
      </Card>

      {result && (
        <Card
          title="Results"
          actions={
            <button type="button" className="small" onClick={() => setPinned([...pinned, { label: attacker?.name ?? `Profile ${pinned.length + 1}`, bySave: result.bySave }].slice(-3))}>
              Pin to compare
            </button>
          }
        >
          <div className="kpis">
            <div>
              <span className="kpi accent">{fmt(total)}</span>
              <span className="muted">average damage vs {target.save ? `${target.save}+` : "no"} save{target.ward ? `, ${target.ward}+ ward` : ""}</span>
            </div>
            {result.simulation.killChance !== undefined && (
              <div>
                <span className="kpi">{Math.round(result.simulation.killChance * 100)}%</span>
                <span className="muted">chance to destroy {target.name ?? "target"}</span>
              </div>
            )}
            {result.simulation.expectedModelsSlain !== undefined && (
              <div>
                <span className="kpi">{fmt(result.simulation.expectedModelsSlain)}</span>
                <span className="muted">models slain on average</span>
              </div>
            )}
            {attacker?.points && (
              <div>
                <span className="kpi">{fmt((total / attacker.points) * 100)}</span>
                <span className="muted">damage per 100 pts</span>
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Weapon</th>
                  <th>Hits</th>
                  <th>Wounds</th>
                  <th>Unsaved</th>
                  <th>Mortals</th>
                  <th>Damage</th>
                </tr>
              </thead>
              <tbody>
                {result.perProfile.map((p, i) => (
                  <tr key={i}>
                    <td>{active[i]?.name}</td>
                    <td>{fmt(p.expectedHits)}</td>
                    <td>{fmt(p.expectedWounds)}</td>
                    <td>{fmt(p.expectedUnsaved)}</td>
                    <td>{fmt(p.expectedMortals)}</td>
                    <td>
                      <strong>{fmt(p.expectedDamage)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Average damage by target save</h3>
          <div className="bars">
            {result.bySave.map((b, i) => (
              <div key={b.save} className="bar-row">
                <span className="bar-label">{b.save}</span>
                <div className="bar-stack">
                  <div className={`bar ${b.save === (target.save ? `${target.save}+` : "-") ? "highlight" : ""}`} style={{ width: `${(b.damage / maxBySave) * 100}%` }}>
                    <span>{fmt(b.damage)}</span>
                  </div>
                  {pinned.map((p, j) => (
                    <div key={j} className={`bar pinned p${j}`} style={{ width: `${(p.bySave[i].damage / maxBySave) * 100}%` }}>
                      <span>
                        {fmt(p.bySave[i].damage)} · {p.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {pinned.length > 0 && (
            <button type="button" className="small" onClick={() => setPinned([])}>
              Clear comparison
            </button>
          )}

          <h3>Chance to deal at least…</h3>
          <div className="bars">
            {result.simulation.atLeast
              .map((p, n) => ({ p, n }))
              .filter(({ n, p }) => n > 0 && p >= 0.01)
              .map(({ p, n }) => (
                <div key={n} className="bar-row">
                  <span className="bar-label">{n}+</span>
                  <div className="bar-stack">
                    <div className="bar alt" style={{ width: `${p * 100}%` }}>
                      <span>{Math.round(p * 100)}%</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      <DiceOdds />
    </div>
  );
}

function RerollSelect({ value, onChange }: { value: Reroll; onChange: (v: Reroll) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Reroll)}>
      <option value="none">none</option>
      <option value="ones">1s</option>
      <option value="failed">failed</option>
    </select>
  );
}

function DiceOdds() {
  const [gap, setGap] = useState(7);
  const [bonus, setBonus] = useState(0);
  const [reroll, setReroll] = useState(false);
  const [charge, setCharge] = useState<{ needed: number; chance: number }>();
  const [cv, setCv] = useState(7);
  const [castMod, setCastMod] = useState(0);
  const [unbind, setUnbind] = useState(true);
  const [cast, setCast] = useState<{ cast: number; castNotUnbound: number; miscast: number }>();

  useEffect(() => {
    api<typeof charge>("/calc/charge", { method: "POST", json: { gap, bonus, reroll } }).then(setCharge);
  }, [gap, bonus, reroll]);
  useEffect(() => {
    api<typeof cast>("/calc/cast", { method: "POST", json: { castingValue: cv, castMod, unbind } }).then(setCast);
  }, [cv, castMod, unbind]);

  const pct = (p?: number) => (p === undefined ? "–" : `${Math.round(p * 100)}%`);
  return (
    <Card title="Charges & spells">
      <div className="grid2">
        <div>
          <h3>Charge</h3>
          <label>
            Gap (inches, edge to edge)
            <input type="number" step={0.5} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
          </label>
          <label>
            Bonus to charge roll
            <input type="number" value={bonus} onChange={(e) => setBonus(Number(e.target.value))} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={reroll} onChange={(e) => setReroll(e.target.checked)} /> Can re-roll the charge
          </label>
          <p>
            Need <strong>{charge?.needed}</strong> on 2D6 → <span className="kpi">{pct(charge?.chance)}</span>
          </p>
        </div>
        <div>
          <h3>Cast / chant</h3>
          <label>
            Casting / chanting value
            <input type="number" value={cv} onChange={(e) => setCv(Number(e.target.value))} />
          </label>
          <label>
            Modifier to the roll
            <input type="number" value={castMod} onChange={(e) => setCastMod(Number(e.target.value))} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={unbind} onChange={(e) => setUnbind(e.target.checked)} /> Opponent can unbind
          </label>
          <p>
            Cast <span className="kpi">{pct(cast?.cast)}</span>
            {unbind && (
              <>
                {" "}
                · gets through <span className="kpi">{pct(cast?.castNotUnbound)}</span>
              </>
            )}{" "}
            · miscast {pct(cast?.miscast)}
          </p>
        </div>
      </div>
    </Card>
  );
}
