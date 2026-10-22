import { useEffect, useRef, useState } from "react";
import type { LibraryDoc } from "../../../shared/types.ts";
import { api, withKey } from "../api.ts";
import { Card, useLoad, useMeta } from "../ui.tsx";

const CATEGORIES: [LibraryDoc["category"], string][] = [
  ["core", "Core rules"],
  ["season", "General's Handbook / season"],
  ["battletome", "Battletome"],
  ["battleplan", "Battleplan"],
  ["map", "Map / terrain layout"],
  ["other", "Other (FAQ, errata, notes)"],
];

export function LibraryPage() {
  const [docs, reload] = useLoad<LibraryDoc[]>("/library");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<LibraryDoc["category"]>("battletome");
  const [busy, setBusy] = useState<string | false>(false);
  const meta = useMeta();
  // Only developers (app password, or the app on your own computer) manage the books.
  const canManage = !!meta?.user?.developer;
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ docId: string; title: string; page: number; text: string }[]>();

  const uploadFile = async () => {
    if (!file) return;
    setBusy("Starting…");
    setError(undefined);
    try {
      // 1) reserve, 2) send the file straight to storage, 3) let the server read it.
      setBusy("Uploading…");
      const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
      const { doc, target } = await api<{ doc: LibraryDoc; target: { url: string; viaApi: boolean; headers: Record<string, string> } }>("/library/uploads", {
        method: "POST",
        json: { title: title || file.name.replace(/\.[^.]+$/, ""), category, filename: file.name, mime },
      });
      if (target.viaApi) {
        await api(target.url.replace(/^\/api/, ""), { method: "PUT", body: file, headers: target.headers });
      } else {
        const sent = await fetch(target.url, { method: "PUT", body: file, headers: target.headers });
        if (!sent.ok) throw new Error(`Upload failed (${sent.status}). Try again.`);
      }
      setBusy("Reading the file…");
      const finished = await api<LibraryDoc>(`/library/${doc.id}/finish`, { method: "POST" });
      setFile(null);
      setTitle("");
      reload();
      if (finished.transcription && meta?.coachReady && !meta.backgroundJobs) void drive(finished);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: LibraryDoc) => {
    if (!confirm(`Remove ${d.title}?`)) return;
    await api(`/library/${d.id}`, { method: "DELETE" });
    reload();
  };

  // On your computer the server reads scanned pages in the background: poll.
  const reading = docs?.some((d) => d.transcription?.status === "running");
  useEffect(() => {
    if (!reading || !meta?.backgroundJobs) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [reading, meta?.backgroundJobs]);

  // Online there's no background worker: this page reads one batch of pages
  // per request while it's open, and stops when you leave it.
  const driving = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const drive = async (d: LibraryDoc) => {
    if (driving.current) return;
    driving.current = d.id;
    try {
      for (;;) {
        const r = await api<{ transcription?: LibraryDoc["transcription"] }>(`/library/${d.id}/transcribe`, { method: "POST" });
        reload();
        const status = r.transcription?.status;
        if (!mounted.current || !status || status === "done" || status === "failed") break;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      driving.current = null;
    }
  };

  // Pick up a read that stopped when the page was closed.
  useEffect(() => {
    if (meta?.backgroundJobs !== false || !meta.coachReady || driving.current) return;
    if (!canManage) return;
    const next = docs?.find((d) => d.canEdit !== false && (d.transcription?.status === "running" || d.transcription?.status === "pending"));
    if (next) void drive(next);
  }, [docs, meta?.backgroundJobs, meta?.coachReady]);

  const transcribe = async (d: LibraryDoc) => {
    if (!meta?.backgroundJobs) return drive(d);
    try {
      await api(`/library/${d.id}/transcribe`, { method: "POST" });
      setTimeout(reload, 500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const search = async () => setHits(await api(`/library/search?q=${encodeURIComponent(query)}`));

  return (
    <div className="stack">
      {!canManage && (
        <p className="muted small" style={{ margin: 0 }}>
          The books and battleplan cards Thorgrim reads. They are kept up to date by the Thorgrim team; search them here.
        </p>
      )}
      {canManage && (
      <Card title="Upload rules (developers)">
        <p className="muted">
          PDFs (core rules, General's Handbook, battletomes, FAQs) are indexed page by page so Thorgrim can search them and cite pages. Photos of
          book pages and scanned PDFs work too: Claude reads those pages once after upload (about a minute per 10 pages). Images (battleplan cards,
          maps) are shown to Thorgrim automatically in games with that battleplan: put the battleplan's name in the title, e.g. "Into the Fire". Files stay private: on your computer, or in your own storage when the app is online.
        </p>
        <div className="grid2">
          <label>
            File (PDF or image)
            <input type="file" accept="application/pdf,image/*,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Battletome: Ogor Mawtribes" />
          </label>
          <label>
            Type
            <select value={category} onChange={(e) => setCategory(e.target.value as LibraryDoc["category"])}>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="primary" onClick={uploadFile} disabled={!file || !!busy}>
          {busy || "Upload"}
        </button>
        {error && <p className="error">{error}</p>}
      </Card>
      )}

      <Card title="Books">
        {!docs?.length && <p className="muted">No books in the library yet.</p>}
        {docs?.some((d) => d.kind === "pdf") && (
          <>
            <div className="row" style={{ marginTop: 0 }}>
              <label style={{ flex: 1, margin: 0 }}>
                <span className="muted small">Search the rules</span>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="e.g. Counter-charge" />
              </label>
              <button type="button" onClick={search} disabled={!query.trim()}>
                Search
              </button>
            </div>
            {hits && !hits.length && <p className="muted">No matches.</p>}
            {hits?.map((h, i) => (
              <div key={i} className="hit">
                <span className="muted small">
                  {h.title} · <b style={{ color: "var(--text)" }}>p.{h.page}</b>
                </span>
                <p>
                  <Highlight text={`${h.text.slice(0, 600)}…`} query={query} />
                </p>
              </div>
            ))}
          </>
        )}
        <div className="stack" style={{ gap: "0.6rem", marginTop: "0.75rem" }}>
          {docs?.map((d) => (
            <BookCard key={d.id} doc={d} category={CATEGORIES.find(([v]) => v === d.category)?.[1] ?? d.category} onStart={() => transcribe(d)} onRemove={() => remove(d)} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

function BookCard({ doc, category, onStart, onRemove }: { doc: LibraryDoc; category: string; onStart: () => void; onRemove: () => void }) {
  const backgroundJobs = useMeta()?.backgroundJobs;
  const t = doc.transcription;
  const total = t?.pages.length ?? 0;
  const size = doc.kind === "pdf" ? `${doc.pages} pages` : doc.kind;
  let status: [string, string];
  if (!t || t.status === "done") status = ["done", "Searchable"];
  else if (t.status === "running") status = ["busy", `Reading ${t.done} / ${total}`];
  else if (t.status === "failed") status = ["failed", "Reading failed"];
  else status = ["todo", `${total} page${total > 1 ? "s" : ""} to read`];
  return (
    <div className={`book ${t?.status === "running" ? "reading" : ""}`}>
      <div className="book-head">
        <a href={withKey(`/api/library/${doc.id}/file`)} target="_blank" rel="noreferrer">
          <b>{doc.title}</b>
        </a>
        <span className={`status ${status[0]}`}>{status[1]}</span>
      </div>
      {t?.status === "running" && (
        <div className="progress" aria-hidden="true">
          <div style={{ width: `${Math.round((t.done / Math.max(1, total)) * 100)}%` }} />
        </div>
      )}
      <span className="muted small">
        {category} · {size}
        {t?.status === "done" ? ` · ${total} scanned page${total > 1 ? "s" : ""} read` : ""}
        {t?.status === "running" ? (backgroundJobs === false ? " · keep this page open while it reads" : " · photos and scans are read once, then searchable") : ""}
        {t?.status === "failed" && t.error ? ` · ${t.error}` : ""}
      </span>
      <div className="row" style={{ margin: 0 }}>
        {doc.canEdit !== false && t && (t.status === "pending" || t.status === "failed") && (
          <button type="button" className="small primary" onClick={onStart}>
            {t.status === "failed" || t.done > 0 ? "Resume reading" : "Read with Claude"}
          </button>
        )}
        {doc.canEdit !== false && (
          <button type="button" className="small" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
