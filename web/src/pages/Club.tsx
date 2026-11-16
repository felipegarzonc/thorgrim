// The club: battle reports members posted (reactions, comments, share
// links) and your activity (comments on your posts, reports of your games,
// opponents joining). Members only.

import { useEffect, useState } from "react";
import type { FeedPostView, Notice } from "../../../shared/types.ts";
import { api, CLUB_SEEN, setCurrentClub } from "../api.ts";
import { baseFaction } from "../../../shared/season.ts";
import { Icon, Seg, useLoad, useMeta, useOnRefresh } from "../ui.tsx";
import { Skeleton } from "../motion.tsx";
import { EventPage, EventsList } from "./Events.tsx";
import { MemberPage, MembersList } from "./Members.tsx";
import { LastWinners, LiveGames, Predictions, WrappedPage, type Votes } from "./Glory.tsx";
import { when, PostCard } from "./club/posts.tsx";
import { Ladder } from "./club/ladder.tsx";

export { CLUB_SEEN } from "../api.ts";

export function Activity() {
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

export type ClubTab = "reports" | "events" | "ladder" | "members";
export const CLUB_TABS: ClubTab[] = ["reports", "events", "ladder", "members"];

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

export function ClubHome({ tab, postId, unreadNotices }: { tab: ClubTab; postId?: string; unreadNotices: number }) {
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
