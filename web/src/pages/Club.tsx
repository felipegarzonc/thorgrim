// The club: battle reports members posted (reactions, comments, share
// links) and your activity (comments on your posts, reports of your games,
// opponents joining). Members only.

import { useEffect, useRef, useState } from "react";
import type { BattleDetail, FeedPost, FeedPostView, Notice } from "../../../shared/types.ts";
import { api, withKey } from "../api.ts";
import { baseFaction } from "../../../shared/season.ts";
import { armyStats, headToHead, inSeason, seasonRanges, seasonRecap, standings, type ClubResult, type Season, type SeasonRecap } from "../../../shared/ladder.ts";
import { Avatar, Icon, Seg, useLoad, useMeta, type IconName } from "../ui.tsx";
import { rowsFromDetail, ScoreSheet, type SheetSide } from "../scoreSheet.tsx";
import { Story } from "./report.tsx";
import { EventPage, EventsList } from "./Events.tsx";
import { MemberPage, MembersList } from "./Members.tsx";

/** Reactions keep their emoji keys on the server; the page shows them as themed icons. */
const REACTION_LOOK: Record<string, { icon: IconName; label: string }> = {
  "⚔️": { icon: "swords", label: "Charge" },
  "🔥": { icon: "flame", label: "Fire" },
  "😂": { icon: "laugh", label: "Ha!" },
  "👏": { icon: "flag", label: "Salute" },
  "💀": { icon: "skull", label: "Brutal" },
};

/** Tells the bottom bar to re-count what's unread. */
export const CLUB_SEEN = "thorgrim-club-seen";

type PostLike = Pick<FeedPost, "title" | "story" | "photos" | "sides" | "battleplan" | "points" | "date" | "badges" | "createdAt" | "result"> & {
  detail?: Pick<BattleDetail, "rounds" | "tactics">;
  rivalry?: FeedPostView["rivalry"];
};

const when = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: mins > 300 * 24 * 60 ? "numeric" : undefined });
};

/** Full-width slides, one at a time: swipe, or tap the dots. */
export function Carousel({ slides }: { slides: React.ReactNode[] }) {
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const go = (i: number) => strip.current?.scrollTo({ left: i * strip.current.clientWidth, behavior: "smooth" });
  return (
    <div className="carousel">
      <div
        ref={strip}
        className="carousel-strip"
        aria-label="Score sheet and battle photos"
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
      >
        {slides.map((slide, i) => (
          <div key={i} className="carousel-slide" aria-label={`${i + 1} of ${slides.length}`}>
            {slide}
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="carousel-dots">
          {slides.map((_, i) => (
            <button key={i} type="button" className={i === at ? "on" : ""} aria-label={`Show ${i + 1} of ${slides.length}`} aria-current={i === at} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The report itself, like an activity card: the score sheet, the battle
 * photos, then the title, highlights and story. Also used on the public page.
 */
export function PostBody({ post, photoUrl, short, onMore }: { post: PostLike; photoUrl: (n: number) => string; short?: boolean; onMore?: () => void }) {
  const [a, b] = post.sides;
  const paras = post.story.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const side = (x: (typeof post.sides)[number], rows: SheetSide["rows"]): SheetSide => ({
    name: x.name,
    base: x.faction ? baseFaction(x.faction) : "Unknown faction",
    sub: x.faction?.includes(" - ") ? x.faction.split(" - ").slice(1).join(" - ") : undefined,
    vp: x.vp,
    rows,
  });
  const status = post.result === "win" ? "VICTORY" : post.result === "loss" ? "DEFEAT" : post.result === "draw" ? "DRAW" : "";
  const tactics = post.detail?.tactics.me ?? [];
  const tacticVp = tactics.reduce((n, t) => n + t.done.length * 5, 0);
  return (
    <>
      <h2 className="post-title">{post.title}</h2>
      {a && b && (
        <div className="post-stats">
          <span>
            <small>Score</small>
            <b>
              {a.vp}–{b.vp}
            </b>
          </span>
          {status && (
            <span>
              <small>Result</small>
              <b className={`post-result ${post.result ?? ""}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</b>
            </span>
          )}
          {tactics.length > 0 && (
            <span>
              <small>Tactics</small>
              <b>
                {tacticVp}/{tactics.length * 15}
              </b>
            </span>
          )}
        </div>
      )}
      <div className="post-lines">
        {(post.battleplan || post.points) && (
          <span>
            <Icon name="map" /> {[post.battleplan, post.points && `${post.points} pts`].filter(Boolean).join(" · ")}
          </span>
        )}
        {a && b && (
          <span>
            <Avatar faction={a.faction} size={1.15} /> {a.faction ? baseFaction(a.faction) : a.name} <span className="muted">vs</span> <Avatar faction={b.faction} size={1.15} />{" "}
            {b.faction ? baseFaction(b.faction) : b.name}
          </span>
        )}
        {!!post.badges.length && (
          <span>
            <Icon name="flag" /> {post.badges.join(" · ")}
          </span>
        )}
        {post.rivalry && a && b && (
          <span>
            <Icon name="swords" /> Rivalry: {a.name} {post.rivalry.won} · {b.name} {post.rivalry.lost}
            {post.rivalry.drawn ? ` · ${post.rivalry.drawn} drawn` : ""}
          </span>
        )}
      </div>
      {(post.detail || post.photos > 0) && (
        <Carousel
          slides={[
            ...(a && b && post.detail
              ? [
                  <div key="sheet" className="media-sheet">
                    <ScoreSheet date="" status="" tone="" sides={[side(a, rowsFromDetail(post.detail, "me")), side(b, rowsFromDetail(post.detail, "opponent"))]} footer="" />
                  </div>,
                ]
              : []),
            ...Array.from({ length: post.photos }, (_, n) => (
              <a key={n} href={photoUrl(n)} target="_blank" rel="noreferrer">
                <img src={photoUrl(n)} alt={`Battle photo ${n + 1}`} loading="lazy" />
              </a>
            )),
          ]}
        />
      )}
      <Story text={post.story} short={short} />
      {short && paras > 2 && (
        <button type="button" className="ghost small read-more" onClick={onMore}>
          Read more
        </button>
      )}
    </>
  );
}

function PostCard({ post, single, changed }: { post: FeedPostView; single?: boolean; changed: (p: FeedPostView | null) => void }) {
  const meta = useMeta();
  const [open, setOpen] = useState(!!single);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const call = async (fn: () => Promise<FeedPostView | null>) => {
    setBusy(true);
    setMsg(undefined);
    try {
      changed(await fn());
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const link = post.shareToken ? `${window.location.origin}${window.location.pathname}#/r/${post.shareToken}` : "";
  const sendLink = async (url: string) => {
    if (navigator.share) return navigator.share({ title: post.title, url }).catch(() => undefined);
    await navigator.clipboard?.writeText(url);
    setMsg("Link copied.");
  };
  const reactors = post.reactions.filter((r) => r.count);

  return (
    <article className={`card post ${single ? "single" : ""}`}>
      <header className="post-head">
        <span className="avatar post-avatar">{(post.authorName || "?").slice(0, 1).toUpperCase()}</span>
        <span className="grow post-who">
          <b>{post.authorName}</b>
          <small className="muted">
            {when(post.createdAt)}
            {post.battleplan ? ` · ${post.battleplan}` : ""}
          </small>
        </span>
      </header>
      <PostBody post={post} photoUrl={(n) => withKey(`/api/feed/${post.id}/photo/${n}?v=${encodeURIComponent(post.updatedAt ?? post.createdAt)}`)} short={!open} onMore={() => setOpen(true)} />

      <div className="post-actions">
        {post.reactions.map((r) => {
          const look = REACTION_LOOK[r.emoji] ?? { icon: "spark" as const, label: r.emoji };
          return (
            <button
              key={r.emoji}
              type="button"
              className={`react ${r.mine ? "on" : ""}`}
              aria-pressed={r.mine}
              aria-label={`${look.label}${r.count ? `, ${r.count}` : ""}`}
              title={look.label}
              disabled={busy}
              onClick={() => call(() => api<FeedPostView>(`/feed/${post.id}/react`, { method: "POST", json: { emoji: r.emoji } }))}
            >
              <Icon name={look.icon} />
              {r.count > 0 && <span>{r.count}</span>}
            </button>
          );
        })}
        <span className="grow" />
        <button type="button" className="react" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${post.comments.length} comments`}>
          <Icon name="coach" />
          <span>{post.comments.length || ""}</span>
        </button>
      </div>
      {!open && reactors.length === 0 && post.comments.length === 0 && <p className="small muted">Be the first to react.</p>}
      {!open && post.comments.length > 0 && (
        <button type="button" className="comment-peek" onClick={() => setOpen(true)}>
          <b>{post.comments[post.comments.length - 1].authorName}</b> {post.comments[post.comments.length - 1].text}
        </button>
      )}

      {open && (
        <div className="comments">
          {post.comments.map((c) => (
            <div key={c.id} className="comment">
              <span className="avatar post-avatar small-avatar">{(c.authorName || "?").slice(0, 1).toUpperCase()}</span>
              <div className="grow">
                <b>{c.authorName}</b> <small className="muted">{when(c.at)}</small>
                <p>{c.text}</p>
              </div>
              {(c.authorId === meta?.user?.id || post.canEdit) && (
                <button
                  type="button"
                  className="icon"
                  aria-label="Remove comment"
                  onClick={() => confirm("Remove this comment?") && call(() => api<FeedPostView>(`/feed/${post.id}/comments/${c.id}`, { method: "DELETE" }))}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          ))}
          <form
            className="comment-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              void call(async () => {
                const p = await api<FeedPostView>(`/feed/${post.id}/comments`, { method: "POST", json: { text: comment } });
                setComment("");
                return p;
              });
            }}
          >
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={1000} aria-label="Comment" />
            <button type="submit" className="icon" aria-label="Send comment" disabled={busy || !comment.trim()}>
              <Icon name="send" />
            </button>
          </form>

          {post.canEdit && (
            <div className="post-owner">
              {link ? (
                <>
                  <p className="small muted">Anyone with the public link can read this report (story, photos and score; no comments).</p>
                  <div className="two-buttons">
                    <button type="button" className="outline" onClick={() => void sendLink(link)}>
                      <Icon name="share" /> Send the link
                    </button>
                    <button type="button" className="ghost" disabled={busy} onClick={() => call(() => api<FeedPostView>(`/feed/${post.id}/share`, { method: "DELETE" }))}>
                      Stop the public link
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="outline wide"
                  disabled={busy}
                  onClick={() =>
                    call(async () => {
                      const p = await api<FeedPostView>(`/feed/${post.id}/share`, { method: "POST" });
                      if (p.shareToken) void sendLink(`${window.location.origin}${window.location.pathname}#/r/${p.shareToken}`);
                      return p;
                    })
                  }
                >
                  <Icon name="share" /> Share outside the club
                </button>
              )}
              <div className="two-buttons">
                <a className="button ghost" href={`#/games/${post.gameId}/results`}>
                  Edit the report
                </a>
                <button
                  type="button"
                  className="ghost danger"
                  disabled={busy}
                  onClick={() =>
                    confirm("Remove this post from the club feed? Its comments and reactions go too.") &&
                    call(async () => {
                      await api(`/feed/${post.id}`, { method: "DELETE" });
                      return null;
                    })
                  }
                >
                  <Icon name="trash" /> Remove post
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </article>
  );
}

/** The club ladder from confirmed results, your record against each member, and how each army does. */
function Ladder() {
  const meta = useMeta();
  const [data, reload] = useLoad<{ me: string; results: ClubResult[]; seasons: Season[] }>("/club/ladder");
  const [pick, setPick] = useState<string>();
  if (!data) return <p className="muted">Loading…</p>;
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
          <h2>No confirmed results{season ? ` in ${season.name}` : ""} yet</h2>
          <p className="muted">Play a game together (share it with your opponent), and when it ends both of you confirm the result on the Results screen. Confirmed games count here.</p>
        </section>
      </div>
    );
  const table = standings(results);
  const rivals = headToHead(results, data.me);
  const armies = armyStats(results);
  return (
    <div className="stack">
      {picker}
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
    </div>
  );
}

/** A finished season's highlights. */
function Recap({ recap, name }: { recap: SeasonRecap; name: string }) {
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

function Activity() {
  const [notices] = useLoad<Notice[]>("/notices");
  useEffect(() => {
    if (!notices?.some((n) => !n.read)) return;
    void api("/notices/read", { method: "POST" }).then(() => window.dispatchEvent(new Event(CLUB_SEEN)));
  }, [notices]);
  if (!notices) return <p className="muted">Loading…</p>;
  if (!notices.length) return <p className="muted">Nothing yet. Comments on your posts, reports of your games and opponents joining your games show up here.</p>;
  return (
    <ul className="notices">
      {notices.map((n) => (
        <li key={n.id} className={n.read ? "" : "unread"}>
          <a href={n.href}>
            <span className="grow">{n.text}</span>
            <small className="muted">{when(n.at)}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

type ClubTab = "reports" | "events" | "ladder" | "members";
const CLUB_TABS: ClubTab[] = ["reports", "events", "ladder", "members"];

/**
 * #/club, #/club/<tab>, #/club/<post id>, #/club/event/<id>, #/club/member/<id>.
 */
export function ClubPage({ postId: section, sub, unreadNotices }: { postId?: string; sub?: string; unreadNotices: number }) {
  if (section === "event" && sub) return <EventPage id={sub} />;
  if (section === "member" && sub) return <MemberPage id={sub} />;
  const tab = CLUB_TABS.includes(section as ClubTab) ? (section as ClubTab) : "reports";
  const postId = section && !CLUB_TABS.includes(section as ClubTab) ? section : undefined;
  return <ClubHome tab={tab} postId={postId} unreadNotices={unreadNotices} />;
}

function ClubHome({ tab, postId, unreadNotices }: { tab: ClubTab; postId?: string; unreadNotices: number }) {
  const [posts, setPosts] = useState<FeedPostView[]>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"feed" | "activity">("feed");
  const [filter, setFilter] = useState("all");
  const setTab = (t: ClubTab) => window.location.replace(`#/club/${t}`);

  useEffect(() => {
    api<FeedPostView[]>("/feed")
      .then(setPosts)
      .catch((e: Error) => setError(e.message));
    void api("/feed/seen", { method: "POST" }).then(() => window.dispatchEvent(new Event(CLUB_SEEN)));
  }, [postId]);

  const changed = (id: string) => (p: FeedPostView | null) => setPosts((cur) => (p ? cur?.map((x) => (x.id === id ? p : x)) : cur?.filter((x) => x.id !== id)));
  const armies = [...new Set((posts ?? []).flatMap((p) => p.sides.map((x) => (x.faction ? baseFaction(x.faction) : ""))).filter(Boolean))].sort();
  const filtered = posts?.filter((p) => filter === "all" || (filter === "mine" ? p.mine : p.sides.some((x) => x.faction && baseFaction(x.faction) === filter)));
  const shown = postId ? posts?.filter((p) => p.id === postId) : filtered;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="grow">{view === "activity" ? "Activity" : "Club"}</h1>
        <button
          type="button"
          className={`icon-button ${view === "activity" ? "on" : ""}`}
          aria-pressed={view === "activity"}
          aria-label={unreadNotices ? `Activity, ${unreadNotices} new` : "Activity"}
          onClick={() => setView(view === "activity" ? "feed" : "activity")}
        >
          <Icon name={view === "activity" ? "close" : "bell"} />
          {view !== "activity" && unreadNotices > 0 && <span className="count-dot">{unreadNotices}</span>}
        </button>
      </div>
      {view === "feed" && !postId && (
        <Seg
          label="Club"
          value={tab}
          options={[
            ["reports", "Reports"],
            ["events", "Events"],
            ["ladder", "Ladder"],
            ["members", "Members"],
          ]}
          onChange={setTab}
        />
      )}
      {view === "activity" ? (
        <Activity />
      ) : tab === "ladder" && !postId ? (
        <Ladder />
      ) : tab === "events" && !postId ? (
        <EventsList />
      ) : tab === "members" && !postId ? (
        <MembersList />
      ) : (
        <>
          {!postId && posts && posts.length > 0 && (
            <div className="filter-chips" role="group" aria-label="Show">
              {[["all", "All reports"], ["mine", "My games"], ...armies.map((a) => [a, a])].map(([key, label]) => (
                <button key={key} type="button" className={filter === key ? "on" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {!posts && !error && <p className="muted">Loading…</p>}
          {postId && posts && (
            <a className="small" href="#/club">
              ← The whole feed
            </a>
          )}
          {postId && posts && !shown?.length && <p className="muted">That post was removed.</p>}
          {!postId && posts && !posts.length && (
            <section className="card empty">
              <h2>No battle reports yet</h2>
              <p className="muted">When a game ends, open its Results: add photos of the battle, let the coach write the story, and post it here for the club.</p>
            </section>
          )}
          {shown?.map((p) => (
            <PostCard key={p.id} post={p} single={!!postId} changed={changed(p.id)} />
          ))}
        </>
      )}
    </div>
  );
}
