// The club: battle reports members posted (reactions, comments, share
// links) and your activity (comments on your posts, reports of your games,
// opponents joining). Members only.

import { useEffect, useRef, useState } from "react";
import type { BattleDetail, FeedPost, FeedPostView, Notice } from "../../../shared/types.ts";
import { api, CLUB_SEEN, setCurrentClub, withKey } from "../api.ts";
import { baseFaction } from "../../../shared/season.ts";
import { armyStats, headToHead, inSeason, seasonRanges, seasonRecap, standings, type ClubResult, type Season, type SeasonRecap } from "../../../shared/ladder.ts";
import { Avatar, Icon, Seg, useLoad, useMeta, useOnRefresh, type IconName } from "../ui.tsx";
import { BattleHeader, rowsFromDetail, SheetRows } from "../scoreSheet.tsx";
import { Story } from "./report.tsx";
import { shareUrl } from "../links.ts";
import { drawReportCard } from "../reportCard.ts";
import { drawResult, shareImageAndLink } from "../shareImage.ts";
import { moment } from "../analytics.tsx";
import { Skeleton } from "../motion.tsx";
import { feedback } from "../sound.ts";
import { EventPage, EventsList } from "./Events.tsx";
import { MemberPage, MembersList } from "./Members.tsx";
import { BattleVote, Bounties, GloryBoard, isThisWeek, LastWinners, LiveGames, Predictions, WrappedPage, type Votes } from "./Glory.tsx";

/** Reactions keep their emoji keys on the server; the page shows them as themed icons. */
const REACTION_LOOK: Record<string, { icon: IconName; label: string }> = {
  "⚔️": { icon: "swords", label: "Charge" },
  "🔥": { icon: "flame", label: "Fire" },
  "😂": { icon: "laugh", label: "Ha!" },
  "👏": { icon: "flag", label: "Salute" },
  "💀": { icon: "skull", label: "Brutal" },
};

/**
 * The picture sent when a post is shared: the full score sheet (the same as a
 * game's Results share), or the report card when the post has no rounds.
 * The link's own preview stays the wide report card (reportCard.ts).
 */
function sharePicture(p: FeedPostView): Promise<Blob> {
  const [a, b] = p.sides;
  if (!p.detail?.rounds.length || !a || !b) return drawReportCard(p);
  const side = (s: typeof a, key: "me" | "opponent") => ({ name: s.name, faction: s.faction, sub: "", vp: s.vp, rows: rowsFromDetail(p.detail!, key) });
  return drawResult({
    date: p.date ? new Date(`${p.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "",
    status: p.result === "win" ? "VICTORY" : p.result === "loss" ? "DEFEAT" : "DRAW",
    me: side(a, "me"),
    opponent: side(b, "opponent"),
    footer: ["Age of Sigmar 4e · Pitched Battles 2026-27", p.battleplan, p.points && `${p.points}pts`].filter(Boolean).join(" · "),
    title: p.title,
    badges: p.badges,
  });
}

export { CLUB_SEEN } from "../api.ts";

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
  const status = post.result === "win" ? "VICTORY" : post.result === "loss" ? "DEFEAT" : post.result === "draw" ? "DRAW" : "";
  // The same layout as the shared picture (shareImage.ts): title, armies and score, highlights, then the score sheet.
  return (
    <>
      <h2 className="post-title">{post.title}</h2>
      {a && b && <BattleHeader sides={[a, b]} status={status} tone={post.result ?? ""} badges={post.badges} />}
      <div className="post-lines">
        {(post.battleplan || post.points) && (
          <span>
            <Icon name="map" /> {[post.battleplan, post.points && `${post.points} pts`].filter(Boolean).join(" · ")}
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
                    <SheetRows
                      sides={[
                        { name: a.name, faction: a.faction, rows: rowsFromDetail(post.detail, "me") },
                        { name: b.name, faction: b.faction, rows: rowsFromDetail(post.detail, "opponent") },
                      ]}
                    />
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

function PostCard({ post, single, changed, votes, onVotes }: { post: FeedPostView; single?: boolean; changed: (p: FeedPostView | null) => void; votes?: Votes; onVotes?: (v: Votes) => void }) {
  const meta = useMeta();
  const [open, setOpen] = useState(!!single);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [popped, setPopped] = useState<string>();
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
  const link = post.shareToken ? shareUrl("r", post.shareToken) : "";
  // The picture the shared link shows (web/src/reportCard.ts): drawn when the link is made, and again when the post changes.
  const cardStale = (p: FeedPostView) => p.mine && !!p.shareToken && (!p.cardAt || p.cardAt < (p.updatedAt ?? p.createdAt));
  const drawCard = async (p: FeedPostView) => {
    const body = await drawReportCard(p);
    setPicture(cardFile(p, body));
    return api<FeedPostView>(`/feed/${p.id}/card`, { method: "POST", body, headers: { "content-type": "image/jpeg" } });
  };
  // The battle's picture, ready before the tap: sharing always sends it with the link.
  const cardFile = (p: FeedPostView, body: Blob) => new File([body], `${p.title || "battle"}.jpg`.replace(/[^\w.-]+/g, "-"), { type: "image/jpeg" });
  const [picture, setPicture] = useState<File>();
  useEffect(() => {
    if (!post.shareToken) return;
    void sharePicture(post)
      .then((b) => setPicture(cardFile(post, b)))
      .catch(() => undefined);
  }, [post.shareToken, post.updatedAt]);
  const drawing = useRef(false);
  useEffect(() => {
    if (!cardStale(post) || drawing.current) return;
    drawing.current = true;
    void drawCard(post)
      .then(changed)
      .catch(() => undefined)
      .finally(() => (drawing.current = false));
  }, [post.updatedAt, post.cardAt, post.shareToken]);
  /** The picture and the link to the full report, together. */
  const sendLink = async (url: string, file = picture) => {
    const pic = file ?? cardFile(post, await sharePicture(post));
    const how = await shareImageAndLink(pic, post.title, url);
    if (how === "tap-again") setMsg("The link is ready: tap Share image and link to send it.");
    else if (how === "saved") setMsg("Picture saved and link copied.");
  };
  const reactors = post.reactions.filter((r) => r.count);
  /** Share outside the club: the picture and the public link (made on the first share). */
  const canShare = post.canEdit && post.kind !== "chronicle";
  const shareOut = () =>
    link
      ? void sendLink(link)
      : call(async () => {
          let p = await api<FeedPostView>(`/feed/${post.id}/share`, { method: "POST" });
          // The link's preview picture first, so the very first preview shows this battle.
          drawing.current = true;
          const body = await drawReportCard(p).catch(() => undefined);
          if (body) p = await api<FeedPostView>(`/feed/${p.id}/card`, { method: "POST", body, headers: { "content-type": "image/jpeg" } }).catch(() => p);
          drawing.current = false;
          const pic = await sharePicture(p).catch(() => undefined);
          if (p.shareToken) void sendLink(shareUrl("r", p.shareToken), pic ? cardFile(p, pic) : undefined);
          moment("Report shared");
          return p;
        });

  return (
    <article className={`card post ${single ? "single" : ""} ${post.kind === "chronicle" ? "chronicle" : ""}`}>
      <header className="post-head">
        {post.kind === "chronicle" ? (
          <span className="avatar post-avatar chronicle-seal" aria-hidden="true">
            <Icon name="spark" />
          </span>
        ) : (
          <span className="avatar post-avatar">{(post.authorName || "?").slice(0, 1).toUpperCase()}</span>
        )}
        <span className="grow post-who">
          <b>{post.authorName}</b>
          <small className="muted">
            {when(post.createdAt)}
            {post.battleplan ? ` · ${post.battleplan}` : ""}
          </small>
        </span>
        {canShare && (
          <button type="button" className="icon share-post" disabled={busy} onClick={shareOut} aria-label="Share" title="Share">
            <Icon name="share" />
          </button>
        )}
      </header>
      <PostBody post={post} photoUrl={(n) => withKey(`/api/feed/${post.id}/photo/${n}?v=${encodeURIComponent(post.updatedAt ?? post.createdAt)}`)} short={!open} onMore={() => setOpen(true)} />

      {votes && onVotes && post.kind !== "chronicle" && !post.mine && isThisWeek(post.createdAt, votes) && <BattleVote postId={post.id} votes={votes} onVotes={onVotes} />}
      {votes?.lastBattle?.postId === post.id && (
        <p className="small accent-text">
          <Icon name="flag" /> Battle of the week
        </p>
      )}
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
              onClick={() => {
                feedback("tap");
                setPopped(r.mine ? undefined : `${r.emoji}-${Date.now()}`);
                void call(() => api<FeedPostView>(`/feed/${post.id}/react`, { method: "POST", json: { emoji: r.emoji } }));
              }}
            >
              <span key={popped?.startsWith(r.emoji) ? popped : r.emoji} className={popped?.startsWith(r.emoji) ? "react-pop" : "react-ico"}>
                <Icon name={look.icon} />
              </span>
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
        <button type="button" className="comment-peek" translate="no" onClick={() => setOpen(true)}>
          <b>{post.comments[post.comments.length - 1].authorName}</b> {post.comments[post.comments.length - 1].text}
        </button>
      )}

      {open && (
        <div className="comments">
          {post.comments.map((c) => (
            <div key={c.id} className="comment" translate="no">
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

          {post.canEdit && post.kind === "chronicle" && (
            <div className="post-owner">
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
          )}
          {canShare && (
            <div className="post-owner">
              {link ? (
                <>
                  <p className="small muted">Anyone with the public link can read this report (story, photos and score; no comments).</p>
                  <div className="two-buttons">
                    <button type="button" className="outline" onClick={() => void sendLink(link)}>
                      <Icon name="share" /> Share image and link
                    </button>
                    <button type="button" className="ghost" disabled={busy} onClick={() => call(() => api<FeedPostView>(`/feed/${post.id}/share`, { method: "DELETE" }))}>
                      Stop the public link
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="outline wide" disabled={busy} onClick={shareOut}>
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
  if (!notices) return <Skeleton />;
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
  if (section === "wrapped" && sub) return <WrappedPage id={sub} />;
  const tab = CLUB_TABS.includes(section as ClubTab) ? (section as ClubTab) : "reports";
  const postId = section && !CLUB_TABS.includes(section as ClubTab) ? section : undefined;
  return <ClubHome tab={tab} postId={postId} unreadNotices={unreadNotices} />;
}

function ClubHome({ tab, postId, unreadNotices }: { tab: ClubTab; postId?: string; unreadNotices: number }) {
  const [posts, setPosts] = useState<FeedPostView[]>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"feed" | "activity">("feed");
  const [filter, setFilter] = useState("all");
  const meta = useMeta();
  const [votesLoaded] = useLoad<Votes>(meta?.club === null ? null : "/glory/votes");
  const [votesNow, setVotes] = useState<Votes>();
  const votes = votesNow ?? votesLoaded;
  const setTab = (t: ClubTab) => window.location.replace(`#/club/${t}`);

  const loadFeed = () =>
    api<FeedPostView[]>("/feed")
      .then(setPosts)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    if (meta?.club === null) return;
    void loadFeed();
    void api("/feed/seen", { method: "POST" }).then(() => window.dispatchEvent(new Event(CLUB_SEEN)));
  }, [postId]);
  useOnRefresh(() => (meta?.club === null ? undefined : loadFeed()));

  const changed = (id: string) => (p: FeedPostView | null) => setPosts((cur) => (p ? cur?.map((x) => (x.id === id ? p : x)) : cur?.filter((x) => x.id !== id)));
  const armies = [...new Set((posts ?? []).flatMap((p) => p.sides.map((x) => (x.faction ? baseFaction(x.faction) : ""))).filter(Boolean))].sort();
  const filtered = posts?.filter((p) => filter === "all" || (filter === "mine" ? p.mine : p.sides.some((x) => x.faction && baseFaction(x.faction) === filter)));
  const shown = postId ? posts?.filter((p) => p.id === postId) : filtered;

  if (meta?.club === null)
    return (
      <div className="stack">
        <h1>Club</h1>
        <section className="card empty-club">
          <Icon name="swords" />
          <p>
            <b>You're not in a club yet.</b>
          </p>
          <p className="muted small">Ask a club leader to add you. Your games, lists and Thorgrim work as always.</p>
        </section>
      </div>
    );

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="grow" translate={view === "activity" || !meta?.club?.name ? undefined : "no"}>
          {view === "activity" ? "Activity" : meta?.club?.name || "Club"}
        </h1>
        {view !== "activity" && (meta?.clubs?.length ?? 0) > 1 && (
          <select
            className="club-switch"
            aria-label="Switch club"
            value={meta?.club?.id}
            onChange={(e) => {
              setCurrentClub(e.target.value);
              window.location.reload();
            }}
          >
            {meta?.clubs?.map((c) => (
              <option key={c.id} value={c.id} translate="no">
                {c.name}
              </option>
            ))}
          </select>
        )}
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
          {!postId && (
            <>
              <LiveGames />
              <LastWinners votes={votes} />
              <Predictions />
            </>
          )}
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
          {!posts && !error && <Skeleton />}
          {postId && posts && (
            <a className="small" href="#/club">
              ← The whole feed
            </a>
          )}
          {postId && posts && !shown?.length && <p className="muted">That post was removed.</p>}
          {!postId && posts && !posts.length && (
            <section className="card empty">
              <h2>No battle reports yet</h2>
              <p className="muted">When a game ends, open its Results: add photos of the battle, let Thorgrim write the story, and post it here for the club.</p>
            </section>
          )}
          <div className="stack rise">
            {shown?.map((p) => (
              <PostCard key={p.id} post={p} single={!!postId} changed={changed(p.id)} votes={votes} onVotes={setVotes} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
