// The battle report at the end of a game: photos of the battle, then the
// coach tells the story from what the game recorded, as an epic battle. The
// players can edit it and post it to the club feed; once posted, the post
// follows the game (score, names, the report's text and photos). One report
// per game, shared by its players.

import { useEffect, useRef, useState } from "react";
import { reviewBasis, type BattleReport, type FeedPostView, type Game, type GameReview } from "../../../shared/types.ts";
import { api, pendingJob, runJob, waitForJob, withKey } from "../api.ts";
import { shrinkPhoto } from "../media.tsx";
import { Icon, useMeta } from "../ui.tsx";

type Mutate = (fn: (g: Game) => Game, log?: string) => Promise<void>;

const MAX_PHOTOS = 8;
const empty = (): BattleReport => ({ title: "", story: "", tone: "saga", photos: [] });

export const gamePhotoUrl = (gameId: string, path: string) => withKey(`/api/games/${gameId}/photo?file=${encodeURIComponent(path)}`);

/** Story paragraphs, split on blank lines. */
export function Story({ text, short }: { text: string; short?: boolean }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="story" translate="no">
      {(short ? paras.slice(0, 2) : paras).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

/** The coach's short review: how the game went, where the points went, one thing to try next. Written by itself once the game is finished. */
export function ReviewCard({ game, mutate, saved }: { game: Game; mutate: Mutate; saved: () => Promise<unknown> }) {
  const meta = useMeta();
  const review = game.review;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const jobKey = `review:${game.id}`;
  const stale = !!review && review.basis !== reviewBasis(game);
  const keep = (r: Omit<GameReview, "writtenAt" | "basis">, basis: string) => mutate((g) => ({ ...g, review: { ...r, writtenAt: new Date().toISOString(), basis } }));
  const write = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saved();
      const basis = reviewBasis(game);
      await keep(await runJob<Omit<GameReview, "writtenAt" | "basis">>(`/games/${game.id}/review`, {}, jobKey), basis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const asked = useRef(false);
  useEffect(() => {
    const id = pendingJob(jobKey);
    if (id) {
      setBusy(true);
      waitForJob<Omit<GameReview, "writtenAt" | "basis">>(id, jobKey)
        .then((r) => keep(r, reviewBasis(game)))
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(false));
    } else if (game.finished && !review && meta?.coachReady && !asked.current) {
      asked.current = true;
      void write();
    }
  }, [game.id, !!game.finished, meta?.coachReady]);
  if (!meta?.coachReady) return null;

  return (
    <section className="card review-card">
      <header className="card-header">
        <h2>
          <Icon name="spark" /> Coach's review
        </h2>
        {review && !busy && (
          <button type="button" className="icon small-icon" aria-label="Write the review again" onClick={write}>
            <Icon name="refresh" />
          </button>
        )}
      </header>
      {busy ? (
        <p className="muted small thinking">Reviewing the game…</p>
      ) : review ? (
        <>
          {stale && (
            <p className="small warning">
              The score changed since this review.{" "}
              <button type="button" className="ghost small" onClick={write}>
                Update it
              </button>
            </p>
          )}
          <p className="review-verdict">{review.verdict}</p>
          <ul className="review-lost">
            {review.lost.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="review-next">
            <b>Next time:</b> {review.tryNext}
          </p>
        </>
      ) : (
        <button type="button" className="small primary" onClick={write}>
          <Icon name="spark" /> Review this game
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

export function BattleReportCard({ game, mutate, saved }: { game: Game; mutate: Mutate; saved: () => Promise<unknown> }) {
  const report = game.report;
  const [title, setTitle] = useState(report?.title ?? "");
  const [story, setStory] = useState(report?.story ?? "");
  const [writing, setWriting] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const editing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const jobKey = `report:${game.id}`;

  // Follow the other player's changes, unless typing here.
  useEffect(() => {
    if (editing.current) return;
    setTitle(report?.title ?? "");
    setStory(report?.story ?? "");
  }, [report?.title, report?.story]);

  const setReport = (fn: (r: BattleReport) => BattleReport) => mutate((g) => ({ ...g, report: fn(g.report ?? empty()) }));

  const keep = (r: { title: string; story: string }) =>
    setReport((cur) => ({ ...cur, title: r.title, story: r.story, tone: "saga", writtenAt: new Date().toISOString() }));
  const write = async () => {
    if (report?.story && !confirm("Write the report again? The current text is replaced.")) return;
    setWriting(true);
    setError(undefined);
    try {
      await saved();
      keep(await runJob<{ title: string; story: string }>(`/games/${game.id}/report`, {}, jobKey));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWriting(false);
    }
  };
  // A report still being written when the page was closed is picked up again.
  useEffect(() => {
    const id = pendingJob(jobKey);
    if (!id) return;
    setWriting(true);
    waitForJob<{ title: string; story: string }>(id, jobKey)
      .then(keep)
      .catch((e: Error) => setError(e.message))
      .finally(() => setWriting(false));
  }, [game.id]);

  const addPhotos = async (files: FileList | null) => {
    const picked = [...(files ?? [])].slice(0, MAX_PHOTOS - (report?.photos.length ?? 0));
    if (!picked.length) return;
    setUploading(picked.length);
    setError(undefined);
    try {
      for (const f of picked) {
        const body = await shrinkPhoto(f);
        const { path } = await api<{ path: string }>(`/games/${game.id}/photo`, { method: "POST", body, headers: { "content-type": "image/jpeg" } });
        await setReport((r) => ({ ...r, photos: [...r.photos, path] }));
        setUploading((n) => n - 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(0);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const post = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saved();
      const p = await api<FeedPostView>("/feed", { method: "POST", json: { gameId: game.id } });
      await setReport((r) => ({ ...r, postId: p.id }));
      window.location.hash = `#/club/${p.id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unpost = async () => {
    if (!report?.postId || !confirm("Remove the post from the club feed? Its comments and reactions go too. The report stays here.")) return;
    setBusy(true);
    try {
      await api(`/feed/${report.postId}`, { method: "DELETE" }).catch(() => undefined);
      await setReport((r) => {
        const { postId: _gone, ...rest } = r;
        return rest;
      });
    } finally {
      setBusy(false);
    }
  };

  const photos = report?.photos ?? [];
  return (
    <section className="card report-card">
      <h2 className="report-head">
        <Icon name="spark" /> Battle report
      </h2>
      <p className="small muted">Snap the battlefield, your best models and the key moments. The coach then tells the game as an epic battle, from what you recorded.</p>

      <div className="report-photos">
        {photos.map((p) => (
          <figure key={p}>
            <img src={gamePhotoUrl(game.id, p)} alt="Battle photo" loading="lazy" />
            <button type="button" className="icon photo-remove" aria-label="Remove photo" onClick={() => setReport((r) => ({ ...r, photos: r.photos.filter((x) => x !== p) }))}>
              <Icon name="close" />
            </button>
          </figure>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button type="button" className="add-photo" disabled={!!uploading} onClick={() => fileInput.current?.click()}>
            <Icon name="camera" />
            <span>{uploading ? `Adding ${uploading}…` : photos.length ? "Add more" : "Add photos"}</span>
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
      </div>

      <button type="button" className={report?.story ? "outline wide" : "primary wide"} disabled={writing || !!uploading} onClick={write}>
        <Icon name="spark" /> {writing ? "The coach is writing…" : report?.story ? "Write it again" : "Write the report"}
      </button>

      {report?.story && (
        <>
          <label className="field">
            <span className="field-label">Title</span>
            <span className="field-box">
              <input
                value={title}
                onFocus={() => (editing.current = true)}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  editing.current = false;
                  if (title !== report.title) void setReport((r) => ({ ...r, title: title.trim() }));
                }}
              />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Story (edit anything)</span>
            <textarea
              rows={12}
              value={story}
              onFocus={() => (editing.current = true)}
              onChange={(e) => setStory(e.target.value)}
              onBlur={() => {
                editing.current = false;
                if (story !== report.story) void setReport((r) => ({ ...r, story }));
              }}
            />
          </label>
          {report.postId ? (
            <>
              <a className="button outline wide" href={`#/club/${report.postId}`}>
                <Icon name="club" /> See it in Club
              </a>
              <p className="small muted">Posted. Changes to this game (score, names, this report and its photos) show in the post too.</p>
            </>
          ) : (
            <button type="button" className="primary wide" disabled={busy || !game.finished} onClick={post}>
              <Icon name="send" /> {busy ? "Posting…" : "Post to the club"}
            </button>
          )}
          {!game.finished && <p className="small muted">Finish the game to post its report to the club.</p>}
          {report.postId && (
            <button type="button" className="ghost danger" disabled={busy} onClick={unpost}>
              Remove from the club feed
            </button>
          )}
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
