// The VP chart: each side's score after every battle round, in the armies'
// colours. Used on a game's Results and in a club post's full battle.

import { BATTLE_ROUNDS } from "../../shared/season.ts";

type Side = "me" | "opponent";

/** Each side's VP round by round: a comeback shows as the lines crossing; double turns are marked. */
export function VpLines({
  totals,
  doubles,
  names,
  colors,
}: {
  totals: { me: number; opponent: number }[];
  doubles: { round: number; side: Side }[];
  names: Record<Side, string>;
  colors: Record<Side, string>;
}) {
  const W = 330;
  const H = 170;
  const top = Math.max(30, Math.ceil(Math.max(...totals.flatMap((t) => [t.me, t.opponent])) / 10) * 10);
  const x = (i: number) => 34 + (i * (W - 50)) / (BATTLE_ROUNDS - 1);
  const y = (v: number) => 140 - (v / top) * 120;
  const line = (side: Side) => totals.map((t, i) => `${x(i)},${y(t[side])}`).join(" ");
  const last = totals[totals.length - 1];
  const summary = `${names.me} ${totals.map((t) => t.me).join(", ")}; ${names.opponent} ${totals.map((t) => t.opponent).join(", ")}`;
  return (
    <section className="card vp-chart" aria-label="Victory points round by round">
      <div className="vp-chart-head">
        <span className="grow">The battle</span>
        <span className="legend">
          <i style={{ background: colors.me }} />
          {names.me}
        </span>
        <span className="legend">
          <i style={{ background: colors.opponent }} />
          {names.opponent}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score after each round: ${summary}`}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1="30" x2={W - 10} y1={y(v)} y2={y(v)} className="grid" />
            <text x="0" y={y(v) + 4} className="axis">
              {v}
            </text>
          </g>
        ))}
        {Array.from({ length: BATTLE_ROUNDS }, (_, i) => (
          <text key={i} x={x(i) - 7} y={H - 6} className="axis">
            R{i + 1}
          </text>
        ))}
        {(["opponent", "me"] as const).map((side) => (
          <polyline key={side} points={line(side)} fill="none" stroke={colors[side]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {last &&
          (["me", "opponent"] as const).map((side) => <circle key={side} cx={x(totals.length - 1)} cy={y(last[side])} r="5" fill={colors[side]} />)}
        {doubles.map((d) =>
          totals[d.round - 1] ? (
            <g key={d.round}>
              <circle cx={x(d.round - 1)} cy={y(totals[d.round - 1][d.side])} r="9" fill="none" stroke="var(--brass)" strokeWidth="1.5" />
              <text x={Math.min(x(d.round - 1) + 12, W - 80)} y={y(totals[d.round - 1][d.side]) + 22} className="axis brass">
                DOUBLE TURN
              </text>
            </g>
          ) : null,
        )}
      </svg>
    </section>
  );
}
