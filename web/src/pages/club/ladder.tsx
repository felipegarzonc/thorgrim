// The club's ladder and the season's recap.

import { useState } from "react";
import { api } from "../../api.ts";
import { armyStats, headToHead, inSeason, seasonRanges, seasonRecap, standings, type ClubResult, type Season, type SeasonRecap } from "../../../../shared/ladder.ts";
import { Avatar, Icon, useLoad, useMeta } from "../../ui.tsx";
import { Skeleton } from "../../motion.tsx";
import { Bounties, GloryBoard } from "../Glory.tsx";
import { when } from "./posts.tsx";

/** The club ladder from confirmed results, your record against each member, and how each army does. */
export function Ladder() {
  const meta = useMeta();
  const [data, reload] = useLoad<{ me: string; results: ClubResult[]; seasons: Season[] }>("/club/ladder");
  const [pick, setPick] = useState<string>();
  if (!data) return <Skeleton />;
  const ranges = seasonRanges(data.seasons ?? []);
  const season = pick === "all" ? undefined : (ranges.find((s) => s.id === pick) ?? ranges[0]);
  const results = season ? inSeason(data.results, season) : data.results;
  const newSeason = async () => {
    const name = prompt("Name of the new season (the current one ends today):", `Season ${ranges.length + 1}`);
    if (name === null) return;
    try {
      await api("/club/seasons", { method: "POST", json: { name } });
      setPick(undefined);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const picker = (ranges.length > 0 || meta?.user?.isAdmin) && (
    <div className="season-bar">
      {ranges.length > 0 && (
        <select value={season?.id ?? "all"} onChange={(e) => setPick(e.target.value)} aria-label="Season">
          {ranges.map((s, i) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {i === 0 ? " (now)" : ""}
            </option>
          ))}
          <option value="all">All time</option>
        </select>
      )}
      {meta?.user?.isAdmin && (
        <button type="button" className="ghost small" onClick={newSeason}>
          <Icon name="flag" /> Start a new season
        </button>
      )}
    </div>
  );
  if (!results.length)
    return (
      <div className="stack">
        {picker}
        <section className="card empty">
          <h2>{season ? `No confirmed results in ${season.name} yet` : "No confirmed results yet"}</h2>
          <p className="muted">Play a game together (share it with your opponent), and when it ends both of you confirm the result on the Results screen. Confirmed games count here.</p>
        </section>
        <GloryBoard />
      </div>
    );
  const table = standings(results);
  const rivals = headToHead(results, data.me);
  const armies = armyStats(results);
  return (
    <div className="stack">
      {picker}
      <Bounties />
      {season?.end && <Recap recap={seasonRecap(results)} name={season.name} />}
      <section className="card ladder" aria-label="Standings">
        <div className="ladder-row ladder-head" aria-hidden="true">
          <span>#</span>
          <span />
          <span>Player</span>
          <span>P</span>
          <span>W-D-L</span>
          <span>Pts</span>
        </div>
        {table.map((s, i) => (
          <div key={s.id} className={`ladder-row ${s.id === data.me ? "me" : ""}`}>
            <span className="ladder-rank">{i + 1}</span>
            <Avatar faction={s.faction} size={1.8} />
            <span className="ladder-name">
              <b>{s.name}</b>
              <small>
                VP {s.vpFor - s.vpAgainst >= 0 ? "+" : ""}
                {s.vpFor - s.vpAgainst} · {s.faction || "—"}
              </small>
            </span>
            <span>{s.played}</span>
            <span>
              {s.won}-{s.drawn}-{s.lost}
            </span>
            <b className="ladder-pts">{s.points}</b>
          </div>
        ))}
        <p className="small muted ladder-foot">Win 3 points, draw 1. Ties: VP difference, then wins. Only results both players confirmed.</p>
      </section>
      {rivals.length > 0 && (
        <section>
          <h2 className="section-title">Your record</h2>
          <div className="card rivals">
            {rivals.map((r) => (
              <div key={r.id} className="rival">
                <span className="grow">vs {r.name}</span>
                <b>
                  {r.won}-{r.drawn}-{r.lost}
                </b>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="section-title">Armies at the club</h2>
        <div className="card rivals">
          {armies.map((a) => (
            <div key={a.faction} className="rival">
              <Avatar faction={a.faction} size={1.6} />
              <span className="grow">{a.faction}</span>
              <span className="muted small">
                {a.played} game{a.played > 1 ? "s" : ""}
              </span>
              <b>{Math.round(a.rate * 100)}%</b>
            </div>
          ))}
        </div>
      </section>
      <GloryBoard />
    </div>
  );
}

/** A finished season's highlights. */
export function Recap({ recap, name }: { recap: SeasonRecap; name: string }) {
  return (
    <section className="card recap">
      <p className="recap-kicker">{name} · recap</p>
      {recap.champion && (
        <div className="recap-champion">
          <Icon name="trophy" />
          <span>
            <small className="muted">Champion</small>
            <b>{recap.champion.name}</b>
            <small className="muted">
              {recap.champion.points} pts · {recap.champion.won}-{recap.champion.drawn}-{recap.champion.lost}
              {recap.champion.faction ? ` · ${recap.champion.faction}` : ""}
            </small>
          </span>
        </div>
      )}
      <div className="recap-grid">
        <span>
          <b>{recap.games}</b>
          <small>games played</small>
        </span>
        {recap.mostGames && (
          <span>
            <b>{recap.mostGames.name}</b>
            <small>most games ({recap.mostGames.played})</small>
          </span>
        )}
        {recap.biggestWin && (
          <span>
            <b>{recap.biggestWin.score}</b>
            <small>
              biggest win: {recap.biggestWin.winner} over {recap.biggestWin.loser}
            </small>
          </span>
        )}
        {recap.mostPlayedArmy && (
          <span>
            <b>{recap.mostPlayedArmy.faction}</b>
            <small>most played army</small>
          </span>
        )}
        {recap.bestArmy && (
          <span>
            <b>{Math.round(recap.bestArmy.rate * 100)}%</b>
            <small>best army: {recap.bestArmy.faction}</small>
          </span>
        )}
      </div>
    </section>
  );
}
