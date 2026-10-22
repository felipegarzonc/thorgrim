// Your numbers from every finished game: overall, by army, battleplan and
// battle tactic, points round by round, double turns, and your rivals.

import { playerStats, type Record3 } from "../../../shared/stats.ts";
import { result } from "../../../shared/scoring.ts";
import type { ArmyList, Game } from "../../../shared/types.ts";
import { sideInfo } from "../gameView.tsx";
import { Avatar, useLoad } from "../ui.tsx";
import { Stats, WinRateChart } from "./Home.tsx";
import { Skeleton } from "../motion.tsx";

const pct = (r: Record3) => `${Math.round((r.won / r.played) * 100)}%`;
const wdl = (r: Record3) => `${r.won}-${r.drawn}-${r.lost}`;

export function StatsPage() {
  const [games] = useLoad<Game[]>("/games");
  const [lists] = useLoad<ArmyList[]>("/lists");
  if (!games) return <Skeleton />;
  const finished = games.filter((g) => result(g)).sort((a, b) => (a.date ?? a.createdAt).localeCompare(b.date ?? b.createdAt));
  if (!finished.length) return <p className="muted">Finish a game to see your stats here.</p>;
  const s = playerStats(finished, (g, side) => sideInfo(g, lists, side).faction);
  const maxRound = Math.max(1, ...s.perRound.flatMap((r) => [r.me, r.opponent]));
  const best = s.tactics[0];
  const worst = s.tactics.length > 1 ? s.tactics[s.tactics.length - 1] : undefined;

  return (
    <div className="stack stats-page rise">
      {finished.length >= 2 && (
        <section className="card">
          <WinRateChart games={finished} lists={lists} />
        </section>
      )}
      <Stats games={finished} />

      {s.rivals.length > 0 && (
        <section>
          <h2 className="section-title">Rivals</h2>
          <div className="card rivals">
            {s.rivals.map((r) => (
              <a key={r.name} className="rival rival-link" href={`#/games/${r.last.gameId}/results`}>
                <Avatar faction={r.armies[0]} size={1.8} />
                <span className="grow">
                  <b>{r.name}</b>
                  <small className="muted">
                    Last: {r.last.result === "win" ? "won" : r.last.result === "loss" ? "lost" : "drew"} {r.last.me}-{r.last.opponent}
                    {r.armies.length ? ` · ${r.armies.slice(0, 2).join(", ")}` : ""}
                  </small>
                </span>
                <span className="rival-score">
                  <b>{wdl(r)}</b>
                  <small className="muted">W-D-L</small>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {s.armies.length > 0 && (
        <section>
          <h2 className="section-title">Your armies</h2>
          <div className="card rivals">
            {s.armies.map((a) => (
              <div key={a.faction} className="rival">
                <Avatar faction={a.faction} size={1.6} />
                <span className="grow">{a.faction}</span>
                <span className="muted small">{wdl(a)}</span>
                <b>{pct(a)}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {s.tactics.length > 0 && (
        <section>
          <h2 className="section-title">Battle tactics</h2>
          <div className="card rivals">
            {best && worst && (
              <p className="small muted stats-note">
                Best: <b>{best.card}</b> ({best.avgVp}/15 a game). Weakest: <b>{worst.card}</b> ({worst.avgVp}/15).
              </p>
            )}
            {s.tactics.map((t) => (
              <div key={t.card} className="rival">
                <span className="grow">
                  {t.card}
                  <small className="muted">
                    {t.picked} game{t.picked > 1 ? "s" : ""} · all 3 steps {t.full}×
                  </small>
                </span>
                <span className="tactic-meter" aria-hidden="true">
                  <span style={{ width: `${(t.avgVp / 15) * 100}%` }} />
                </span>
                <b>{t.avgVp}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Points per battle round</h2>
        <div className="card round-bars">
          {s.perRound.map((r) => (
            <div key={r.round} className="round-bar">
              <span className="muted small">R{r.round}</span>
              <span className="bars">
                <span className="bar-me" style={{ width: `${(r.me / maxRound) * 100}%` }}>
                  {r.me}
                </span>
                <span className="bar-them" style={{ width: `${(r.opponent / maxRound) * 100}%` }}>
                  {r.opponent}
                </span>
              </span>
            </div>
          ))}
          <p className="small muted">
            Average a game. <span className="key-me">You</span> · <span className="key-them">Opponents</span>
          </p>
        </div>
      </section>

      <section>
        <h2 className="section-title">Double turns</h2>
        <div className="stat-grid">
          <div className="stat-tile">
            <b>{s.doubleTurns.taken}</b>
            <span>
              games you took one
              {s.doubleTurns.taken ? ` · won ${s.doubleTurns.wonWhenTaken}` : ""}
            </span>
          </div>
          <div className="stat-tile">
            <b>{s.doubleTurns.suffered}</b>
            <span>
              games they took one
              {s.doubleTurns.suffered ? ` · you still won ${s.doubleTurns.wonWhenSuffered}` : ""}
            </span>
          </div>
        </div>
      </section>

      {s.battleplans.length > 0 && (
        <section>
          <h2 className="section-title">Battleplans</h2>
          <div className="card rivals">
            {s.battleplans.map((p) => (
              <div key={p.name} className="rival">
                <span className="grow">{p.name}</span>
                <span className="muted small">{wdl(p)}</span>
                <b>{pct(p)}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
