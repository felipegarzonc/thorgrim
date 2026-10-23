// The score sheet: both players, the final score and each side's points
// round by round (objectives and every battle tactic). The heart of a game's
// Results and the main picture of its club post.

import { BATTLE_ROUNDS, TACTIC_VP } from "../../shared/season.ts";
import type { BattleDetail } from "../../shared/types.ts";
import type { ShareRow } from "./shareImage.ts";

export interface SheetSide {
  name: string;
  /** The army ("Ogor Mawtribes") and, when there is one, its subfaction. */
  base: string;
  sub?: string;
  vp: number;
  rows: ShareRow[];
}

export function ScoreSheet({ date, status, tone, sides, footer }: { date: string; status: string; tone: string; sides: [SheetSide, SheetSide]; footer: string }) {
  const [a, b] = sides;
  return (
    <article className="card result-card">
      <div className="game-card-body">
        <div className="gc-side">
          <span className="muted gc-date">{date}</span>
          <b className="gc-name">{a.name}</b>
          <span className="gc-faction">{a.base}</span>
          {a.sub && <small className="muted">{a.sub}</small>}
        </div>
        <div className="gc-score">
          <span className="big-score">
            {a.vp}-{b.vp}
          </span>
          {status && <span className={`gc-status ${tone}`}>{status}</span>}
        </div>
        <div className="gc-side right">
          <span className="muted gc-date">&nbsp;</span>
          <b className="gc-name">{b.name}</b>
          <span className="gc-faction">{b.base}</span>
          {b.sub && <small className="muted">{b.sub}</small>}
        </div>
      </div>
      <SheetRows sides={sides} />
      <p className="res-foot">
        {footer}
        <br />
        Tracked with Thorgrim
      </p>
    </article>
  );
}

/** Each side's rows: objectives and battle tactics, round by round. */
export function SheetRows({ sides }: { sides: (Pick<SheetSide, "name" | "rows"> & { note?: string })[] }) {
  return (
    <>
      {sides.map((side, i) => (
        <div key={i} className="res-side">
          <h2>{side.name}</h2>
          {side.rows.map((row) => (
            <div key={row.label} className="res-row">
              <span className="grow">{row.label}</span>
              <span className="cells">
                {row.cells.map((c, j) => (
                  <span key={j} className="cell">
                    {c === null ? "-" : c}
                  </span>
                ))}
              </span>
              <span className="res-total">{row.total}</span>
            </div>
          ))}
          {side.note && <p className="muted small">{side.note}</p>}
        </div>
      ))}
    </>
  );
}

/** A side's score-sheet rows from a club post's battle record. */
export function rowsFromDetail(d: Pick<BattleDetail, "rounds" | "tactics">, side: "me" | "opponent"): ShareRow[] {
  const byRound = (value: (r: BattleDetail["rounds"][number]) => number) =>
    Array.from({ length: BATTLE_ROUNDS }, (_, i) => {
      const r = d.rounds.find((x) => x.round === i + 1);
      return r ? value(r) : null;
    });
  const objectives = byRound((r) => r[side].vp - r[side].tactics.length * TACTIC_VP);
  return [
    { label: "Objectives", cells: objectives, total: String(objectives.reduce<number>((s, v) => s + (v ?? 0), 0)) },
    ...d.tactics[side].map((t) => ({
      label: t.card,
      cells: byRound((r) => (r[side].tactics.some((x) => x.startsWith(`${t.card}:`)) ? TACTIC_VP : 0)),
      total: `${t.done.length * TACTIC_VP}/15`,
    })),
  ];
}
