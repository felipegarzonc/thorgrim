// The club: battle reports members posted (reactions, comments, share
// links) and your activity (comments on your posts, reports of your games,
// opponents joining). Members only.

import { useEffect, useState } from "react";
import type { FeedPost, FeedPostView, Notice } from "../../../shared/types.ts";
import { api, withKey } from "../api.ts";
import { baseFaction } from "../../../shared/season.ts";
import { armyColor, Icon, useLoad, useMeta, type IconName } from "../ui.tsx";
import { Story } from "./report.tsx";

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

type PostLike = Pick<FeedPost, "title" | "story" | "photos" | "sides" | "battleplan" | "points" | "date" | "badges" | "createdAt">;

const when = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: mins > 300 * 24 * 60 ? "numeric" : undefined });
};

/** The report itself, photo first: photos, title, the score in both armies' colours, highlights and story. Also used on the public page. */
export function PostBody({ post, photoUrl, short, onMore }: { post: PostLike; photoUrl: (n: number) => string; short?: boolean; onMore?: () => void }) {
  const [a, b] = post.sides;
  const paras = post.story.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return (
    <>
      {post.photos > 0 && (
        <div className="post-photos" aria-label="Battle photos">
          {Array.from({ length: post.photos }, (_, n) => (
            <a key={n} href={photoUrl(n)} target="_blank" rel="noreferrer">
              <img src={photoUrl(n)} alt={`Battle photo ${n + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <h2 className="post-title">{post.title}</h2>
      {a && b && (
        <div className="post-score">
          <div className="post-score-row">
            <span>
              <b>{a.name}</b>
              <small style={{ color: armyColor(a.faction) }}>{a.faction ? baseFaction(a.faction) : ""}</small>
            </span>
            <span className="post-vp">
              {a.vp}–{b.vp}
            </span>
            <span className="right">
              <b>{b.name}</b>
              <small style={{ color: armyColor(b.faction) }}>{b.faction ? baseFaction(b.faction) : ""}</small>
            </span>
          </div>
          <div className="score-bar" aria-hidden="true">
            <span style={{ flex: Math.max(a.vp, 1), background: armyColor(a.faction) }} />
            <span style={{ flex: Math.max(b.vp, 1), background: armyColor(b.faction) }} />
          </div>
        </div>
      )}
      {!!post.badges.length && (
        <div className="post-badges">
          {post.badges.map((x) => (
            <span key={x} className="badge">
              {x}
            </span>
          ))}
        </div>
      )}
      <p className="small muted post-meta">{[post.battleplan, post.points && `${post.points}pts`, post.date].filter(Boolean).join(" · ")}</p>
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

export function ClubPage({ postId, unreadNotices }: { postId?: string; unreadNotices: number }) {
  const [posts, setPosts] = useState<FeedPostView[]>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"feed" | "activity">("feed");
  const [filter, setFilter] = useState("all");

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
      {view === "activity" ? (
        <Activity />
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
