// A battleplan at a glance: the twist and its abilities, the scoring, and a
// schematic map drawn from shared/battleplans.ts (your territory and theirs,
// objectives, terrain). The real card photo, when uploaded, is shown too.

import { battleplanInfo, OBJECTIVE_NAMES, TERRAIN_NAMES, type BattleplanMap, type ObjectiveKind, type TerrainKind } from "../../shared/battleplans.ts";
import { scoringFor } from "../../shared/season.ts";

type Side = "me" | "opponent";

const OBJ_FILL: Record<ObjectiveKind, string> = { lions: "#c8382e", soliphiles: "#e3b43a", heldenhain: "#141414", comet: "#2f54c4" };

function MapSvg({ map, attacker }: { map: BattleplanMap; attacker: Side }) {
  const mine = attacker === "me" ? map.attacker : map.defender;
  const theirs = attacker === "me" ? map.defender : map.attacker;
  const cell = (c: number, r: number, cls: string) => <rect key={`${cls}${c}${r}`} x={c * 15} y={r * 11} width={15} height={11} className={cls} />;
  const label = (cells: [number, number][], text: string, cls: string) => {
    if (!cells.length) return null;
    const [c, r] = cells[0];
    return (
      <text x={c * 15 + 1} y={r * 11 + 2.6} className={`map-label ${cls}`}>
        {text}
      </text>
    );
  };
  const terrain = (t: { kind: TerrainKind; x: number; y: number; small?: boolean }, i: number) => {
    const s = t.small ? 1.6 : 2.6;
    if (t.kind === "power") return <path key={`t${i}`} d={`M${t.x} ${t.y - s} L${t.x + s * 0.8} ${t.y} L${t.x} ${t.y + s} L${t.x - s * 0.8} ${t.y} Z`} className="map-power" />;
    if (t.kind === "zone") return <rect key={`t${i}`} x={t.x - s} y={t.y - s * 0.75} width={s * 2} height={s * 1.5} rx={0.4} className="map-zone" />;
    return <ellipse key={`t${i}`} cx={t.x} cy={t.y} rx={s} ry={s * 0.75} className="map-obscuring" />;
  };
  return (
    <svg viewBox="-1 -1 62 46" className="bp-map" role="img" aria-label="Schematic battleplan map">
      <rect x={0} y={0} width={60} height={44} className="map-ground" />
      {mine.map(([c, r]) => cell(c, r, "map-mine"))}
      {theirs.map(([c, r]) => cell(c, r, "map-theirs"))}
      {[15, 30, 45].map((x) => (
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={44} className="map-grid" />
      ))}
      {[11, 22, 33].map((y) => (
        <line key={`h${y}`} x1={0} y1={y} x2={60} y2={y} className="map-grid" />
      ))}
      {label(mine, "YOUR TERRITORY", "mine")}
      {label(theirs, "THEIR TERRITORY", "theirs")}
      {map.terrain.map(terrain)}
      {map.objectives.map((o, i) => (
        <g key={`o${i}`}>
          <circle cx={o.x} cy={o.y} r={3} className="map-obj-range" />
          <circle cx={o.x} cy={o.y} r={1.5} fill={OBJ_FILL[o.kind]} className="map-obj" />
        </g>
      ))}
      <text x={57.5} y={3} className="map-north">
        N
      </text>
      <line x1={1} y1={42.3} x2={7} y2={42.3} className="map-scale" />
      <text x={7.8} y={42.9} className="map-scale-text">
        6"
      </text>
    </svg>
  );
}

export function BattleplanCard({ name, attacker, compact = false }: { name: string; attacker: Side; compact?: boolean }) {
  const b = battleplanInfo(name);
  if (!b) return null;
  const first = scoringFor(b.name, 1) ?? [];
  const later = scoringFor(b.name, 2) ?? [];
  const sameScoring = JSON.stringify(first) === JSON.stringify(later);
  const usedKinds = [...new Set(b.map?.objectives.map((o) => o.kind) ?? [])];
  const usedTerrain = [...new Set(b.map?.terrain.map((t) => t.kind) ?? [])];
  return (
    <div className="bp-card">
      {b.map && (
        <figure className="bp-figure">
          <MapSvg map={b.map} attacker={attacker} />
          <figcaption className="bp-legend">
            {usedKinds.map((k) => (
              <span key={k}>
                <i className="dot" style={{ background: OBJ_FILL[k] }} /> {OBJECTIVE_NAMES[k]}
              </span>
            ))}
            {usedTerrain.map((k) => (
              <span key={k}>
                <i className={`key ${k}`} /> {TERRAIN_NAMES[k]}
              </span>
            ))}
            <span className="muted">Schematic: positions approximate, rings show 3" around objectives.</span>
          </figcaption>
        </figure>
      )}
      <p className="bp-twist">
        <b>Twist.</b> {b.twist}
      </p>
      {b.abilities.map((a) => (
        <div key={a.name} className="bp-ability">
          <b>{a.name}</b>
          <small>{a.when}</small>
          <span>{a.effect}</span>
        </div>
      ))}
      {!compact && first.length > 0 && (
        <div className="bp-scoring">
          <b>Scoring (end of each of your turns)</b>
          <ul>
            {(sameScoring ? first : first).map((l) => (
              <li key={`1${l.label}`}>
                {l.label} <span className="muted">{l.vp} VP</span>
                {!sameScoring && l.rounds === "first" ? <span className="muted"> · round 1 only</span> : null}
              </li>
            ))}
            {!sameScoring &&
              later
                .filter((l) => l.rounds === "later")
                .map((l) => (
                  <li key={`2${l.label}`}>
                    {l.label} <span className="muted">{l.vp} VP · from round 2</span>
                  </li>
                ))}
          </ul>
        </div>
      )}
    </div>
  );
}
