// A battle report shared outside the club (#/r/<token>): readable by anyone
// with the link, no sign-in. Only the story, photos and score.

import { useEffect, useState } from "react";
import type { FeedPost } from "../../../shared/types.ts";
import { publicApi } from "../api.ts";
import { PostBody } from "./Club.tsx";

type PublicPost = Pick<FeedPost, "title" | "story" | "photos" | "sides" | "battleplan" | "points" | "date" | "badges" | "createdAt" | "updatedAt">;

export function PublicReport({ token }: { token: string }) {
  const [post, setPost] = useState<PublicPost>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    publicApi<PublicPost>(`/public/reports/${encodeURIComponent(token)}`)
      .then((p) => {
        setPost(p);
        document.title = `${p.title} · Thorgrim`;
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);
  return (
    <main className="public-report">
      {error && <p className="muted">{error}</p>}
      {!post && !error && <p className="muted">Loading…</p>}
      {post && (
        <article className="card post single">
          <PostBody post={post} photoUrl={(n) => `/api/public/reports/${encodeURIComponent(token)}/photo/${n}?v=${encodeURIComponent(post.updatedAt ?? post.createdAt)}`} />
        </article>
      )}
      <p className="small muted public-foot">A battle report from Thorgrim, an Age of Sigmar game tracker and coach.</p>
    </main>
  );
}
