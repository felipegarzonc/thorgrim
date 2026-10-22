import { useState } from "react";
import { result } from "../../../shared/scoring.ts";
import { baseFaction } from "../../../shared/season.ts";
import type { ArmyList, FeedPostView, Game } from "../../../shared/types.ts";
import { api, withKey } from "../api.ts";
import { gameDate, gameHref, sideInfo } from "../gameView.tsx";
import { Avatar, Icon, useLoad, useMeta } from "../ui.tsx";
import { gamePhotoUrl } from "./report.tsx";

export async function newGame() {
  const g = await api<Game>("/games", { method: "POST", json: {} });
  window.location.hash = `#/games/${g.id}/players`;
}

const byDate = (a: Game, b: Game) => (a.date ?? a.createdAt).localeCompare(b.date ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt);

export function HomePage({ unread = 0 }: { unread?: number }) {
  const meta = useMeta();
  const [games] = useLoad<Game[]>("/games");
  const [lists] = useLoad<ArmyList[]>("/lists");
  const [posts] = useLoad<FeedPostView[]>("/feed");
  if (!games) return <p className="muted">Loading…</p>;

  const live = games.filter((g) => !g.finished).sort(byDate).reverse()[0];
  const finished = games.filter((g) => g.finished).sort(byDate);
  const latest = finished[finished.length - 1];
  const hero = live ?? latest;
  const post = posts?.[0];

  return (
    <div className="stack home">
      <div className="page-head home-head">
        <a className="me-link" href="#/profile" aria-label="Your profile">
          <span className="avatar me-avatar">{(meta?.user?.name || "T").slice(0, 1).toUpperCase()}</span>
        </a>
        <span className="wordmark grow">THORGRIM</span>
        <a className="icon-button" href="#/club" aria-label={unread ? `Club, ${unread} new` : "Club activity"}>
          <Icon name="bell" />
          {unread > 0 && <span className="count-dot">{Math.min(unread, 99)}</span>}
        </a>
      </div>

      {!games.length && (
        <section className="card empty">
          <h2>Ready for your first battle?</h2>
          <p className="muted">Set up a game: both armies, the battleplan and your battle tactics. The coach then gives you a plan for every turn.</p>
          <button type="button" className="primary" onClick={newGame}>
            <Icon name="plus" /> New game
          </button>
        </section>
      )}

      {hero && <GameHero game={hero} lists={lists} />}

      <div className="quick-actions">
        <button type="button" className="quick" onClick={newGame}>
          <span className="quick-ico">
            <Icon name="plus" />
          </span>
          New game
        </button>
        <a className="quick" href="#/ask">
          <span className="quick-ico">
            <Icon name="spark" />
          </span>
          Ask the coach
        </a>
      </div>

      {finished.length > 0 && <Season games={finished} lists={lists} />}

      {post && (
        <section>
          <div className="row spread section-row">
            <h2 className="section-title">From the club</h2>
            <a className="small" href="#/club">
              See all
            </a>
          </div>
          <a className="club-teaser" href={`#/club/${post.id}`}>
            {post.photos > 0 ? (
              <img src={withKey(`/api/feed/${post.id}/photo/0?v=${encodeURIComponent(post.updatedAt ?? post.createdAt)}`)} alt="" loading="lazy" />
            ) : (
              <span className="teaser-photo">
                <Icon name="club" />
              </span>
            )}
            <span className="teaser-text">
              <b className="teaser-title">{post.title}</b>
              <small className="muted">
                {post.authorName} · {post.sides.map((x) => `${x.faction ? baseFaction(x.faction).split(" ")[0] : x.name} ${x.vp}`).join(" – ")}
              </small>
              <small className="muted">
                {post.reactions.reduce((n, r) => n + r.count, 0)} reactions · {post.comments.length} comments
              </small>
            </span>
          </a>
        </section>
      )}
    </div>
  );
}

/** The game that matters now: the one being played, else the last one, with its photo. */
function GameHero({ game, lists }: { game: Game; lists?: ArmyList[] }) {
  const me = sideInfo(game, lists, "me");
  const opp = sideInfo(game, lists, "opponent");
  const s = game.state;
  const photo = s.tablePhoto?.path ?? game.report?.photos[0];
  const r = result(game);
  const started = (s.rounds?.length ?? 0) > 0 && s.phase !== "Deployment";
  const tag = game.finished ? (r === "win" ? "VICTORY" : r === "loss" ? "DEFEAT" : "DRAW") : started ? `LIVE · ROUND ${s.round}` : "SETTING UP";
  const turn = game.finished ? gameDate(game) : started ? `${s.activePlayer === "me" ? "Your turn" : `${opp.name}'s turn`} · ${s.phase}` : "Armies and battleplan";
  return (
    <section className="hero card" aria-label={game.finished ? "Your last battle" : "Battle in progress"}>
      <div className="hero-photo">
        {photo ? <img src={gamePhotoUrl(game.id, photo)} alt="The table" /> : <Icon name="castle" />}
        <span className={`hero-tag ${game.finished ? "" : "live"}`}>{tag}</span>
      </div>
      <div className="hero-body">
        <div className="hero-score">
          <span className="hero-side">
            <Avatar faction={me.faction} size={2.5} />
            <b>{me.name}</b>
            <small>{me.base}</small>
          </span>
          <span className="big-score">
            {s.vp.me}
            <span className="score-dot">·</span>
            {s.vp.opponent}
          </span>
          <span className="hero-side">
            <Avatar faction={opp.faction} size={2.5} />
            <b>{opp.name}</b>
            <small>{opp.base}</small>
          </span>
        </div>
        <p className="small muted hero-sub">{[game.battleplan, turn].filter(Boolean).join(" · ")}</p>
        <a className="button primary wide hero-go" href={gameHref(game)}>
          {game.finished ? "SEE THE RESULTS" : "CONTINUE THE BATTLE"} <Icon name="right" />
        </a>
      </div>
    </section>
  );
}

/** Won, lost, drawn, the last five results; the chart and the numbers behind a tap. */
function Season({ games, lists }: { games: Game[]; lists?: ArmyList[] }) {
  const results = games.map(result);
  const count = (r: string) => results.filter((x) => x === r).length;
  const last = results.slice(-5);
  return (
    <section>
      <h2 className="section-title">Your season</h2>
      <div className="card season">
        <div className="season-counts">
          <span>
            <b className="won">{count("win")}</b>
            <small>won</small>
          </span>
          <span>
            <b>{count("loss")}</b>
            <small>lost</small>
          </span>
          <span>
            <b>{count("draw")}</b>
            <small>drawn</small>
          </span>
          <small className="grow muted season-last">Last {last.length}</small>
        </div>
        <div className="form-bar" role="img" aria-label={`Last ${last.length} results: ${last.join(", ")}`}>
          {last.map((r, i) => (
            <span key={i} className={r ?? ""} />
          ))}
        </div>
        {games.length >= 1 && (
          <a className="more-stats-link" href="#/stats">
            Your stats: armies, tactics, rivals <Icon name="right" />
          </a>
        )}
      </div>
    </section>
  );
}

export function WinRateChart({ games, lists }: { games: Game[]; lists?: ArmyList[] }) {
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

export function Stats({ games }: { games: Game[] }) {
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
