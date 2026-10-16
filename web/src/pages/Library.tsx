import { useEffect, useState } from "react";
import type { LibraryDoc } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, useLoad } from "../ui.tsx";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ docId: string; title: string; page: number; text: string }[]>();

  const uploadFile = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title || file.name.replace(/\.[^.]+$/, ""));
      form.append("category", category);
      await api("/library", { method: "POST", body: form });
      setFile(null);
      setTitle("");
      reload();
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

  // Poll while scanned pages are being read.
  const reading = docs?.some((d) => d.transcription?.status === "running");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [reading]);

  const transcribe = async (d: LibraryDoc) => {
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
      <Card title="Upload rules you own">
        <p className="muted">
          PDFs (core rules, General's Handbook, battletomes, FAQs) are indexed page by page so the coach can search them and cite pages. Photos of
          book pages and scanned PDFs work too: Claude reads those pages once after upload (about a minute per 10 pages). Images (battleplan cards,
          maps, a photo of the table) are shown to the coach when you attach them to a game. Files stay on your server.
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
        <button type="button" className="primary" onClick={uploadFile} disabled={!file || busy}>
          {busy ? "Uploading and indexing…" : "Upload"}
        </button>
        {error && <p className="error">{error}</p>}
      </Card>

      <Card title="Your rules library">
        {!docs?.length && <p className="muted">Nothing uploaded yet: add your core rules, General's Handbook and battletome above.</p>}
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
        <a href={`/api/library/${doc.id}/file`} target="_blank" rel="noreferrer">
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
        {t?.status === "running" ? " · photos and scans are read once, then searchable" : ""}
        {t?.status === "failed" && t.error ? ` · ${t.error}` : ""}
      </span>
      <div className="row" style={{ margin: 0 }}>
        {t && (t.status === "pending" || t.status === "failed") && (
          <button type="button" className="small primary" onClick={onStart}>
            {t.status === "failed" || t.done > 0 ? "Resume reading" : "Read with Claude"}
          </button>
        )}
        <button type="button" className="small" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
