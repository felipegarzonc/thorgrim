// The score sheet: both players, the final score and each side's points
// round by round (objectives and every battle tactic). The heart of a game's
// Results and the main picture of its club post.

import { baseFaction, BATTLE_ROUNDS, TACTIC_VP } from "../../shared/season.ts";
import type { BattleDetail } from "../../shared/types.ts";
import type { ShareRow } from "./shareImage.ts";
import { armyColor, Avatar } from "./ui.tsx";

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
      {date && <p className="tally-date">{date}</p>}
      <BattleHeader
        sides={[
          { name: a.name, faction: a.base, vp: a.vp },
          { name: b.name, faction: b.base, vp: b.vp },
        ]}
        status={status}
        tone={tone}
      />
      <SheetRows sides={sides.map((x) => ({ ...x, faction: x.base }))} />
      <p className="res-foot">
        {footer}
        <br />
        Tracked with Thorgrim
      </p>
    </article>
  );
}

/**
 * Each side's rows round by round (objectives and every battle tactic), in
 * the look of the shared picture (shareImage.ts): the rounds on top, each
 * side under its army's colour, rounds that scored in brass.
 */
export function SheetRows({ sides }: { sides: (Pick<SheetSide, "name" | "rows"> & { faction?: string; note?: string })[] }) {
  return (
    <div className="tally">
      <div className="tally-row tally-rounds" aria-hidden="true">
        <span className="grow" />
        <span className="tally-cells">
          {Array.from({ length: BATTLE_ROUNDS }, (_, i) => (
            <span key={i}>{`R${i + 1}`}</span>
          ))}
        </span>
        <span className="tally-total" />
      </div>
      {sides.map((side, i) => (
        <div key={i} className="tally-side">
          <h3 style={{ ["--army" as string]: side.faction ? armyColor(side.faction) : undefined }}>{side.name}</h3>
          {side.rows.map((row) => (
            <div key={row.label} className="tally-row">
              <span className="grow">{row.label}</span>
              <span className="tally-cells">
                {row.cells.map((c, j) => (
                  <span key={j} className={`tally-cell ${c === null ? "none" : c ? "scored" : ""}`}>
                    {c === null ? "–" : c}
                  </span>
                ))}
              </span>
              <span className="tally-total">{row.total}</span>
            </div>
          ))}
          {side.note && <p className="muted small">{side.note}</p>}
        </div>
      ))}
    </div>
  );
}

/** The top of a battle, as on the shared picture: both armies' crests and names, the score and result, the highlights. */
export function BattleHeader({ sides, status, tone, badges = [] }: { sides: [{ name: string; faction?: string; vp: number }, { name: string; faction?: string; vp: number }]; status?: string; tone?: string; badges?: string[] }) {
  const [a, b] = sides;
  const who = (x: typeof a, right?: boolean) => (
    <span className={`bh-side ${right ? "right" : ""}`}>
      <Avatar faction={x.faction} size={3.2} />
      <b translate="no">{x.name}</b>
      <small>{x.faction ? baseFaction(x.faction) : "Unknown faction"}</small>
    </span>
  );
  return (
    <div className="battle-head">
      <div className="bh-main">
        {who(a)}
        <span className="bh-score">
          <b>
            {a.vp}–{b.vp}
          </b>
          {status && <span className={`bh-result ${tone ?? ""}`}>{status}</span>}
        </span>
        {who(b, true)}
      </div>
      {badges.length > 0 && (
        <div className="bh-pills">
          {badges.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      )}
    </div>
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
