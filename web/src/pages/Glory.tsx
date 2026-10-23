// Glory in the club (server/glory.ts): a member's level, experience,
// achievements and weekly missions; the wanted board; predictions on upcoming
// battles; games being played right now; the club's votes; and the season's
// wrap-up (#/club/wrapped/<member>).

import { useEffect, useState } from "react";
import type { BattleDetail } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { rowsFromDetail, SheetRows } from "../scoreSheet.tsx";
import { CountUp, Skeleton, Sparks } from "../motion.tsx";
import { feedback, feedbackOnce } from "../sound.ts";
import { Avatar, Icon, useLoad, useMeta, type IconName } from "../ui.tsx";

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  rarity: "common" | "rare" | "epic" | "legendary";
  secret: boolean;
  unlocked: boolean;
  at?: string;
}
interface Level {
  level: number;
  name: string;
  xp: number;
  floor: number;
  next: number | null;
}
interface Mission {
  id: string;
  text: string;
  target: number;
  value: number;
  done: boolean;
}
export interface Glory {
  xp: number;
  level: Level;
  sources: { label: string; xp: number }[];
  achievements: Achievement[];
  missions?: Mission[];
  weekEnds?: string;
  bountiesClaimed: { target: string; date: string }[];
  news?: { achievements: string[]; missions: number; level?: Level };
}

/** The level's seal: its number on a shield. */
export function LevelSeal({ level, size = 2.4 }: { level: number; size?: number }) {
  return (
    <span className={`level-seal tier-${Math.min(5, Math.ceil(level / 2))}`} style={{ width: `${size}rem`, height: `${size}rem` }} aria-label={`Level ${level}`}>
      <Icon name="shield" />
      <b>{level}</b>
    </span>
  );
}

function XpBar({ level }: { level: Level }) {
  const span = level.next ? level.next - level.floor : 1;
  const pct = level.next ? Math.min(100, Math.round(((level.xp - level.floor) / span) * 100)) : 100;
  return (
    <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Experience to the next level">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** What's new since the member last looked: a small celebration. */
function News({ news }: { news: NonNullable<Glory["news"]> }) {
  const empty = !news.achievements.length && !news.missions && !news.level;
  useEffect(() => {
    if (!empty) feedbackOnce(`glory-${JSON.stringify(news)}`, news.level ? "levelUp" : news.achievements.length ? "achievement" : "mission");
  }, [empty, news]);
  if (empty) return null;
  return (
    <div className="glory-news card" role="status">
      <Sparks />
      {news.level && (
        <p>
          <b>{`Level ${news.level.level}: ${news.level.name}`}</b>
        </p>
      )}
      {news.achievements.map((a) => (
        <p key={a}>{`Achievement unlocked: ${a}`}</p>
      ))}
      {news.missions > 0 && <p>{news.missions === 1 ? "Weekly mission complete: +50 XP" : `${news.missions} weekly missions complete: +${news.missions * 50} XP`}</p>}
    </div>
  );
}

function Missions({ missions }: { missions: Mission[] }) {
  const done = missions.filter((m) => m.done).length;
  return (
    <div className="missions">
      <div className="row spread">
        <h3>Weekly missions</h3>
        <small className="muted">{`${done}/3 · new ones on Monday`}</small>
      </div>
      {missions.map((m) => (
        <div key={m.id} className={`mission ${m.done ? "done" : ""}`}>
          <Icon name={m.done ? "check" : "flag"} />
          <span className="grow">{m.text}</span>
          <small>{m.done ? "+50 XP" : `${m.value}/${m.target}`}</small>
        </div>
      ))}
      {done === 3 && <p className="small accent-text">Perfect week: +50 XP bonus.</p>}
    </div>
  );
}

function Achievements({ list }: { list: Achievement[] }) {
  const [open, setOpen] = useState<string>();
  const unlocked = list.filter((a) => a.unlocked).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const locked = list.filter((a) => !a.unlocked);
  const shown = open === "all" ? [...unlocked, ...locked] : unlocked.slice(0, 8);
  const info = list.find((a) => a.id === open);
  return (
    <div className="achievements">
      <div className="row spread">
        <h3>Achievements</h3>
        <small className="muted">{`${unlocked.length}/${list.length}`}</small>
      </div>
      {!unlocked.length && open !== "all" && <p className="small muted">None yet: play, post a report, comment. They come quickly.</p>}
      <div className="achievement-grid">
        {shown.map((a) => (
          <button key={a.id} type="button" className={`achievement ${a.rarity} ${a.unlocked ? "" : "locked"}`} onClick={() => setOpen(open === a.id ? "all" : a.id)} aria-label={a.name}>
            <Icon name={a.icon} />
            <span>{a.name}</span>
          </button>
        ))}
      </div>
      {info && (
        <p className="small achievement-info">
          <b>{info.name}</b> · {info.description} <span className={`rarity ${info.rarity}`}>{info.rarity}</span>
        </p>
      )}
      <button type="button" className="ghost small" onClick={() => setOpen(open === "all" ? undefined : "all")}>
        {open === "all" ? "Show fewer" : "See them all"}
      </button>
    </div>
  );
}

/** A member's glory: level, experience, missions (their own), achievements. */
export function GloryCard({ memberId, own }: { memberId: string; own: boolean }) {
  const [g] = useLoad<Glory>(own ? "/glory/me" : `/glory/members/${memberId}`, [memberId]);
  const [why, setWhy] = useState(false);
  if (!g) return <Skeleton cards={1} />;
  return (
    <section className="card glory">
      {g.news && <News news={g.news} />}
      <div className="glory-head">
        <LevelSeal level={g.level.level} size={3} />
        <div className="grow">
          <b className="glory-level">{g.level.name}</b>
          <small className="muted">
            <CountUp value={g.xp} /> XP{g.level.next ? ` · ${g.level.next - g.xp} to level ${g.level.level + 1}` : " · top level"}
          </small>
          <XpBar level={g.level} />
        </div>
      </div>
      {g.missions && <Missions missions={g.missions} />}
      <Achievements list={g.achievements} />
      {g.bountiesClaimed.length > 0 && (
        <p className="small">
          <Icon name="skull" /> {`Bounties claimed: ${g.bountiesClaimed.map((b) => b.target).join(", ")}`}
        </p>
      )}
      <div className="row spread">
        <button type="button" className="ghost small" onClick={() => setWhy(!why)} aria-expanded={why}>
          Where the experience comes from
        </button>
        <a className="small" href={`#/club/wrapped/${memberId}`}>
          Season wrap-up →
        </a>
      </div>
      {why && (
        <div className="xp-sources">
          {g.sources.map((s) => (
            <div key={s.label} className="row spread small">
              <span>{s.label}</span>
              <b>{s.xp} XP</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** On Home: the level and this week's missions, at a glance. */
export function GloryStrip() {
  const meta = useMeta();
  const [g] = useLoad<Glory>(meta?.club ? "/glory/me" : null);
  if (!g?.missions || !meta?.user) return null;
  const done = g.missions.filter((m) => m.done).length;
  return (
    <a className="card glory-strip" href={`#/club/member/${meta.user.id}`}>
      {g.news && <News news={g.news} />}
      <div className="glory-head">
        <LevelSeal level={g.level.level} />
        <div className="grow">
          <b>{g.level.name}</b>
          <XpBar level={g.level} />
        </div>
        <small className="muted">{`Missions ${done}/3`}</small>
      </div>
      <div className="strip-missions">
        {g.missions.map((m) => (
          <span key={m.id} className={m.done ? "done" : ""}>
            <Icon name={m.done ? "check" : "flag"} /> {m.text}
          </span>
        ))}
      </div>
    </a>
  );
}

/** The club's levels, best first. */
export function GloryBoard() {
  const meta = useMeta();
  const [board] = useLoad<{ id: string; name: string; xp: number; level: number; levelName: string; achievements: number }[]>("/glory/board");
  if (!board?.length) return null;
  return (
    <section>
      <h2 className="section-title">Glory</h2>
      <div className="card rivals">
        {board.map((m, i) => (
          <a key={m.id} className={`rival rival-link ${m.id === meta?.user?.id ? "me" : ""}`} href={`#/club/member/${m.id}`}>
            <span className="ladder-rank">{i + 1}</span>
            <LevelSeal level={m.level} size={1.9} />
            <span className="grow">
              <b>{m.name}</b>
              <small className="muted">{`${m.levelName} · ${m.achievements} achievements`}</small>
            </span>
            <b className="small">{m.xp} XP</b>
          </a>
        ))}
      </div>
    </section>
  );
}

/** Wanted: the ladder's leader and anyone on a winning streak. Beat them for a bounty. */
export function Bounties() {
  const meta = useMeta();
  const [list] = useLoad<{ id: string; name: string; reason: "leader" | "streak"; streak?: number }[]>("/glory/bounties");
  if (!list?.length) return null;
  return (
    <section className="bounties">
      <h2 className="section-title">Wanted</h2>
      {list.map((b) => (
        <a key={b.id} className="card bounty" href={`#/club/member/${b.id}`}>
          <Icon name="skull" />
          <span className="grow">
            <b>{b.id === meta?.user?.id ? "You" : b.name}</b>
            <small className="muted">{b.reason === "leader" ? "Top of the ladder" : `${b.streak} wins in a row`}</small>
          </span>
          <span className="bounty-reward">+100 XP</span>
        </a>
      ))}
      <p className="small muted">Beat a wanted player in a club game to claim the bounty and the Kingslayer achievement.</p>
    </section>
  );
}

interface PredictionView {
  id: string;
  label: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  picks: { a: number; b: number };
  mine: "a" | "b" | null;
  playing: boolean;
  outcome?: "a" | "b" | "draw";
}

/** Upcoming battles: who will win? Right calls earn experience (and the Oracle achievement). */
export function Predictions() {
  const [data, setData] = useState<{ upcoming: PredictionView[]; settled: PredictionView[] }>();
  const [loaded] = useLoad<{ upcoming: PredictionView[]; settled: PredictionView[] }>("/glory/predictions");
  const [error, setError] = useState<string>();
  const shown = data ?? loaded;
  if (!shown || (!shown.upcoming.length && !shown.settled.length)) return null;
  const pick = async (p: PredictionView, side: "a" | "b") => {
    setError(undefined);
    feedback("tap");
    try {
      setData(await api(`/glory/predictions/${p.id}`, { method: "POST", json: { pick: side } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="predictions">
      <h2 className="section-title">Who will win?</h2>
      {shown.upcoming.map((p) => {
        const total = p.picks.a + p.picks.b;
        return (
          <div key={p.id} className="card prediction">
            <small className="muted">{p.label}</small>
            <div className="prediction-sides">
              {(["a", "b"] as const).map((side) => (
                <button key={side} type="button" className={`prediction-pick ${p.mine === side ? "on" : ""}`} disabled={p.playing} aria-pressed={p.mine === side} onClick={() => pick(p, side)}>
                  <b translate="no">{p[side].name}</b>
                  <small>{total ? `${Math.round((p.picks[side] / total) * 100)}%` : "—"}</small>
                </button>
              ))}
            </div>
            <small className="muted">{p.playing ? "Your battle: the club is predicting." : total ? `${total} predictions · +10 XP if you're right` : "Be the first to predict · +10 XP if you're right"}</small>
          </div>
        );
      })}
      {shown.settled.length > 0 && (
        <div className="card rivals">
          {shown.settled.map((p) => (
            <div key={p.id} className="rival small">
              <span className="grow" translate="no">
                {p.a.name} vs {p.b.name}
              </span>
              <span>{p.outcome === "draw" ? "Draw" : p.mine ? (p.mine === p.outcome ? "You called it ✓" : "Missed") : `${p[p.outcome as "a" | "b"].name} won`}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="small error">{error}</p>}
    </section>
  );
}

interface LiveGame {
  ownerId: string;
  ownerName: string;
  gameId: string;
  opponentName: string;
  myFaction: string;
  opponentFaction: string;
  battleplan: string;
  round: number;
  vp: { me: number; opponent: number };
  cheers: Record<string, number>;
  /** How many members back each player, and whom you back. */
  backers: { me: number; opponent: number };
  myBack: "me" | "opponent" | null;
  detail: Pick<BattleDetail, "rounds" | "tactics">;
}
/** The same themed icons as the reactions on club posts. */
const CHEER_LOOK: [string, IconName, string][] = [
  ["fire", "flame", "Fire"],
  ["skull", "skull", "Brutal"],
  ["shield", "shield", "Hold the line"],
  ["laugh", "laugh", "Ha!"],
];

/** Games being played right now in the club, with cheers. */
export function LiveGames() {
  const [games, setGames] = useState<LiveGame[]>();
  useEffect(() => {
    let on = true;
    // Only while the page is in front of someone: a phone in a pocket doesn't poll.
    const load = () => {
      if (document.visibilityState === "visible") void api<LiveGame[]>("/glory/live").then((g) => on && setGames(g)).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      on = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);
  if (!games?.length) return null;
  const send = async (g: LiveGame, what: "cheer" | "back", json: Record<string, string>) =>
    setGames(await api<LiveGame[]>(`/glory/live/${g.ownerId}/${g.gameId}/${what}`, { method: "POST", json }).catch(() => games));
  return (
    <section className="live">
      <h2 className="section-title">
        <span className="live-dot" /> Live now
      </h2>
      {games.map((g) => (
        <LiveCard
          key={`${g.ownerId}-${g.gameId}`}
          g={g}
          cheer={(kind) => (feedback("cheer"), void send(g, "cheer", { kind }))}
          back={(side) => (feedback("cheer"), void send(g, "back", { side }))}
        />
      ))}
    </section>
  );
}

function LiveCard({ g, cheer, back }: { g: LiveGame; cheer: (kind: string) => void; back: (side: "me" | "opponent") => void }) {
  const [sheet, setSheet] = useState(false);
  const names = { me: g.ownerName, opponent: g.opponentName };
  const total = g.backers.me + g.backers.opponent;
  const hasSheet = g.detail.rounds.length > 0;
  return (
    <div className="card live-game">
      <small className="muted">{`Round ${g.round}${g.battleplan ? ` · ${g.battleplan}` : ""}`}</small>
      <div className="live-score">
        <span className="live-side">
          <Avatar faction={g.myFaction} size={1.6} />
          <b translate="no">{g.ownerName}</b>
        </span>
        <b className="live-vp">
          {g.vp.me}–{g.vp.opponent}
        </b>
        <span className="live-side right">
          <b translate="no">{g.opponentName}</b>
          <Avatar faction={g.opponentFaction} size={1.6} />
        </span>
      </div>
      {/* Whom the club backs: tap a side to back that player, again to stop. */}
      <div className="live-back">
        {(["me", "opponent"] as const).map((side) => (
          <button key={side} type="button" className={`back-side ${side} ${g.myBack === side ? "on" : ""}`} aria-pressed={g.myBack === side} onClick={() => back(side)}>
            <Icon name="flag" />
            <span className="back-name">{`Back ${names[side]}`}</span>
            <span className="back-count">{g.backers[side]}</span>
          </button>
        ))}
      </div>
      {total > 0 && (
        <div className="back-meter" aria-label={`Backers: ${g.backers.me} for ${g.ownerName}, ${g.backers.opponent} for ${g.opponentName}`}>
          <span className="me" style={{ flexGrow: g.backers.me }} />
          <span className="opponent" style={{ flexGrow: g.backers.opponent }} />
        </div>
      )}
      <div className="post-actions live-cheers">
        {CHEER_LOOK.map(([kind, icon, label]) => (
          <button key={kind} type="button" className="react" onClick={() => cheer(kind)} aria-label={`${label}${g.cheers[kind] ? `, ${g.cheers[kind]}` : ""}`} title={label}>
            <span className="react-ico">
              <Icon name={icon} />
            </span>
            {g.cheers[kind] ? <span>{g.cheers[kind]}</span> : null}
          </button>
        ))}
        {hasSheet && (
          <button type="button" className={`react sheet-toggle ${sheet ? "on" : ""}`} aria-expanded={sheet} onClick={() => setSheet((s) => !s)}>
            <Icon name="log" />
            <span>{sheet ? "Hide points" : "Points"}</span>
          </button>
        )}
      </div>
      {sheet && hasSheet && (
        <div className="live-sheet">
          <SheetRows
            sides={[
              ...(["me", "opponent"] as const).map((side) => ({
                name: names[side],
                rows: rowsFromDetail(g.detail, side),
                // Tactic rows come from the cards picked for that player: none picked, none shown.
                note: g.detail.tactics[side].length ? undefined : "No battle tactic cards picked yet.",
              })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

export interface Votes {
  battle: { week: string; ends: string; counts: Record<string, number>; mine: string | null };
  army: { month: string; counts: Record<string, number>; mine: string | null };
  lastBattle: { postId: string; title: string; author: string; week: string } | null;
  lastArmy: { memberId: string; armyId: string; name: string; faction: string; month: string } | null;
}

/** The current week, as the server counts it (ISO weeks start on Monday). */
export function isThisWeek(createdAt: string, votes?: Votes) {
  if (!votes) return false;
  const ends = Date.parse(`${votes.battle.ends}T00:00:00Z`);
  const at = Date.parse(createdAt);
  return at < ends && at >= ends - 7 * 86_400_000;
}

/** On a report of this week: vote it the battle of the week. */
export function BattleVote({ postId, votes, onVotes }: { postId: string; votes: Votes; onVotes: (v: Votes) => void }) {
  const [error, setError] = useState<string>();
  const n = votes.battle.counts[postId] ?? 0;
  const mine = votes.battle.mine === postId;
  return (
    <>
      <button
        type="button"
        className={`vote-button ${mine ? "on" : ""}`}
        aria-pressed={mine}
        onClick={async () => {
          setError(undefined);
          feedback("tap");
          try {
            onVotes(await api<Votes>("/glory/votes/battle", { method: "POST", json: { postId } }));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <Icon name="flag" /> {mine ? "Your battle of the week" : "Battle of the week?"}
        {n > 0 && <span className="vote-count">{n}</span>}
      </button>
      {error && <p className="small error">{error}</p>}
    </>
  );
}

/** On a showcase army: vote it the army of the month. */
export function ArmyVote({ memberId, armyId, votes, onVotes }: { memberId: string; armyId: string; votes: Votes; onVotes: (v: Votes) => void }) {
  const key = `${memberId}:${armyId}`;
  const n = votes.army.counts[key] ?? 0;
  const mine = votes.army.mine === key;
  return (
    <button
      type="button"
      className={`vote-button ${mine ? "on" : ""}`}
      aria-pressed={mine}
      onClick={async () => {
        feedback("tap");
        onVotes(await api<Votes>("/glory/votes/army", { method: "POST", json: { memberId, armyId } }).catch(() => votes));
      }}
    >
      <Icon name="camera" /> {mine ? "Your army of the month" : "Army of the month?"}
      {n > 0 && <span className="vote-count">{n}</span>}
    </button>
  );
}

/** Last week's winner, at the top of the feed. */
export function LastWinners({ votes }: { votes?: Votes }) {
  if (!votes?.lastBattle && !votes?.lastArmy) return null;
  return (
    <div className="winners">
      {votes.lastBattle && (
        <a className="card winner" href={`#/club/${votes.lastBattle.postId}`}>
          <Icon name="flag" />
          <span className="grow">
            <small className="muted">Battle of the week</small>
            <b>{votes.lastBattle.title}</b>
            <small className="muted" translate="no">
              {votes.lastBattle.author}
            </small>
          </span>
        </a>
      )}
      {votes.lastArmy && (
        <a className="card winner" href={`#/club/member/${votes.lastArmy.memberId}`}>
          <Icon name="camera" />
          <span className="grow">
            <small className="muted">Army of the month</small>
            <b translate="no">{votes.lastArmy.name}</b>
            <small className="muted">{votes.lastArmy.faction}</small>
          </span>
        </a>
      )}
    </div>
  );
}

interface WrappedView {
  member: { id: string; name: string };
  season: { name: string; from: string; to?: string };
  seasons: { id: string; name: string }[];
  games: number;
  wins: number;
  draws: number;
  losses: number;
  favouriteArmy?: { faction: string; games: number };
  nemesis?: { name: string; won: number; lost: number };
  favouriteFoe?: { name: string; won: number; lost: number };
  biggestWin?: { opponent: string; score: string; date: string };
  comebacks: number;
  tacticsMastered: number;
  reports: number;
  reactionsReceived: number;
  xp: number;
  title: string;
}

/** A member's season, told in a few big numbers, ready to share. */
export function WrappedPage({ id }: { id: string }) {
  const [season, setSeason] = useState<string>();
  const [w] = useLoad<WrappedView>(`/glory/wrapped/${id}${season ? `?season=${season}` : ""}`, [id, season]);
  const [copied, setCopied] = useState(false);
  if (!w) return <Skeleton cards={3} />;
  const share = async () => {
    const lines = [
      `${w.member.name} · ${w.season.name}: "${w.title}"`,
      `${w.games} games · ${w.wins}-${w.draws}-${w.losses}`,
      w.favouriteArmy && `Army: ${w.favouriteArmy.faction}`,
      w.nemesis && `Nemesis: ${w.nemesis.name}`,
      w.biggestWin && `Biggest win: ${w.biggestWin.score} vs ${w.biggestWin.opponent}`,
      `${w.xp} XP · thorgrim.co`,
    ].filter(Boolean);
    const text = lines.join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };
  const slides: { big: string; small: string }[] = [
    { big: String(w.games), small: w.games === 1 ? "club game" : "club games" },
    { big: `${w.wins}-${w.draws}-${w.losses}`, small: "wins · draws · losses" },
    ...(w.favouriteArmy ? [{ big: w.favouriteArmy.faction, small: `your army, ${w.favouriteArmy.games} games` }] : []),
    ...(w.biggestWin ? [{ big: w.biggestWin.score, small: `your biggest win, against ${w.biggestWin.opponent}` }] : []),
    ...(w.nemesis ? [{ big: w.nemesis.name, small: `your nemesis: ${w.nemesis.won}-${w.nemesis.lost}` }] : []),
    ...(w.favouriteFoe ? [{ big: w.favouriteFoe.name, small: `your favourite foe: ${w.favouriteFoe.won}-${w.favouriteFoe.lost}` }] : []),
    ...(w.comebacks ? [{ big: String(w.comebacks), small: w.comebacks === 1 ? "comeback" : "comebacks" }] : []),
    ...(w.tacticsMastered ? [{ big: String(w.tacticsMastered), small: "battle tactic cards mastered" }] : []),
    ...(w.reports ? [{ big: String(w.reports), small: `battle reports · ${w.reactionsReceived} reactions` }] : []),
    { big: `${w.xp} XP`, small: "earned this season" },
  ];
  return (
    <div className="stack wrapped rise">
      <a className="small" href={`#/club/member/${id}`}>
        ← {w.member.name}
      </a>
      <section className="card wrapped-head">
        <Sparks />
        <small className="muted">{w.season.name}</small>
        <h1 translate="no">{w.member.name}</h1>
        <p className="wrapped-title">{w.title}</p>
      </section>
      {w.seasons.length > 1 && (
        <select value={season ?? w.seasons[0].id} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          {w.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div className="wrapped-grid">
        {slides.map((s, i) => (
          <div key={i} className="card wrapped-stat stamp" style={{ animationDelay: `${i * 60}ms` }}>
            <b translate="no">{s.big}</b>
            <span>{s.small}</span>
          </div>
        ))}
      </div>
      <button type="button" className="primary wide" onClick={share}>
        <Icon name="share" /> {copied ? "Copied" : "Share my season"}
      </button>
    </div>
  );
}
