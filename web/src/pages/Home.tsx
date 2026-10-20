import { useState } from "react";
import { result } from "../../../shared/scoring.ts";
import type { ArmyList, Game } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { GameCard, gameHref, sideInfo } from "../gameView.tsx";
import { Icon, useLoad } from "../ui.tsx";

export async function newGame() {
  const g = await api<Game>("/games", { method: "POST", json: {} });
  window.location.hash = `#/games/${g.id}/players`;
}

const byDate = (a: Game, b: Game) => (a.date ?? a.createdAt).localeCompare(b.date ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt);

export function HomePage() {
  const [games] = useLoad<Game[]>("/games");
  const [lists] = useLoad<ArmyList[]>("/lists");
  if (!games) return <p className="muted">Loading…</p>;

  const live = games.filter((g) => !g.finished).sort(byDate).reverse()[0];
  const finished = games.filter((g) => g.finished).sort(byDate);
  const latest = finished[finished.length - 1];

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Thorgrim</h1>
        <a className="button small ghost" href="#/calc">
          <Icon name="calc" /> Calculator
        </a>
      </div>

      {!games.length && (
        <section className="card empty">
          <h2>Ready for your first game?</h2>
          <p className="muted">Tap + to set up a game: both armies, the battleplan and your battle tactics. The coach then gives you a plan for every turn.</p>
          <button type="button" className="primary" onClick={newGame}>
            <Icon name="plus" /> New game
          </button>
        </section>
      )}

      {live && (
        <section>
          <h2 className="section-title">Game in progress</h2>
          <GameCard
            game={live}
            lists={lists}
            actions={
              <a className="button primary-container" href={gameHref(live)}>
                CONTINUE
              </a>
            }
          />
        </section>
      )}

      {latest && (
        <section>
          <h2 className="section-title">Latest game</h2>
          <GameCard
            game={latest}
            lists={lists}
            actions={
              <>
                <a className="button primary-container" href={`#/games/${latest.id}/results`}>
                  VIEW RESULTS
                </a>
                <a className="button ghost accent" href={`#/games/${latest.id}/players`}>
                  EDIT
                </a>
              </>
            }
          />
        </section>
      )}

      {finished.length >= 2 && (
        <section>
          <h2 className="section-title">Win rate over time</h2>
          <WinRateChart games={finished} lists={lists} />
        </section>
      )}

      {finished.length > 0 && <Stats games={finished} />}

      <button type="button" className="fab" aria-label="New game" onClick={newGame}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

function WinRateChart({ games, lists }: { games: Game[]; lists?: ArmyList[] }) {
  const [hover, setHover] = useState<number | null>(null);
  let wins = 0;
  const points = games.map((g, i) => {
    if (result(g) === "win") wins++;
    return { rate: wins / (i + 1), game: g };
  });
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 8, t: 10, b: 10 };
  const x = (i: number) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (r: number) => pad.t + (1 - r) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`;
  const h = hover !== null ? points[hover] : null;
  const pick = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  return (
    <div className="card chart-card">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={`Win rate over ${points.length} games, now ${Math.round(points[points.length - 1].rate * 100)}%`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((r) => (
          <g key={r}>
            <line x1={pad.l} x2={W - pad.r} y1={y(r)} y2={y(r)} className="grid" />
            <text x={pad.l - 6} y={y(r) + 4} textAnchor="end" className="axis">
              {r * 100}%
            </text>
          </g>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {h && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={H - pad.b} className="crosshair" />
            <circle cx={x(hover!)} cy={y(h.rate)} r="5" className="dot" />
          </>
        )}
      </svg>
      <p className="chart-tip small" aria-live="polite">
        {h ? (
          <>
            Game {hover! + 1}: <b>{Math.round(h.rate * 100)}%</b> after {result(h.game) === "win" ? "a win" : result(h.game) === "loss" ? "a loss" : "a draw"} vs{" "}
            {sideInfo(h.game, lists, "opponent").base} ({h.game.state.vp.me}-{h.game.state.vp.opponent})
          </>
        ) : (
          <span className="muted">Tap the chart to see each game.</span>
        )}
      </p>
    </div>
  );
}

function Stats({ games }: { games: Game[] }) {
  const results = games.map(result);
  const count = (r: string) => results.filter((x) => x === r).length;
  const wins = count("win");
  const avg = (r: string) => {
    const vps = games.filter((g) => result(g) === r).map((g) => g.state.vp.me);
    return vps.length ? (vps.reduce((a, b) => a + b, 0) / vps.length).toFixed(1) : "–";
  };
  let current = 0;
  let longest = 0;
  for (const r of results) {
    current = r === "win" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return (
    <section>
      <h2 className="section-title">Stats</h2>
      <div className="stat-grid">
        <div className="stat-tile">
          <b>{games.length}</b>
          <span>games played</span>
        </div>
        <div className="stat-tile">
          <b>{Math.round((wins / games.length) * 100)}%</b>
          <span>win rate</span>
        </div>
        <div className="stat-tile">
          <b>
            {wins}-{count("loss")}-{count("draw")}
          </b>
          <span>wins · losses · draws</span>
        </div>
        <div className="stat-tile">
          <b>
            {current}
            <small> / {longest}</small>
          </b>
          <span>win streak · longest</span>
        </div>
        <div className="stat-tile">
          <b>{avg("win")}</b>
          <span>average VP in wins</span>
        </div>
        <div className="stat-tile">
          <b>{avg("loss")}</b>
          <span>average VP in losses</span>
        </div>
      </div>
    </section>
  );
}
