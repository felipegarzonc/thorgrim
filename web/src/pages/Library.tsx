import { useState } from "react";
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

  const search = async () => setHits(await api(`/library/search?q=${encodeURIComponent(query)}`));

  return (
    <div className="stack">
      <Card title="Upload rules you own">
        <p className="muted">
          PDFs (core rules, General's Handbook, battletomes, FAQs) are indexed page by page so the coach can search them and cite pages. Images (battleplan cards,
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
        {!docs?.length && <p className="muted">Nothing uploaded yet.</p>}
        <ul className="rows">
          {docs?.map((d) => (
            <li key={d.id}>
              <a href={`/api/library/${d.id}/file`} target="_blank" rel="noreferrer">
                <strong>{d.title}</strong>
              </a>
              <span className="tag">{CATEGORIES.find(([v]) => v === d.category)?.[1]}</span>
              <span className="muted">{d.kind === "pdf" ? `${d.pages} pages` : d.kind}</span>
              <button type="button" className="small" onClick={() => remove(d)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {docs?.some((d) => d.kind === "pdf") && (
          <>
            <div className="row">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search the rules, e.g. Counter-charge" />
              <button type="button" onClick={search} disabled={!query.trim()}>
                Search
              </button>
            </div>
            {hits && !hits.length && <p className="muted">No matches. Scanned PDFs without a text layer can't be searched.</p>}
            {hits?.map((h, i) => (
              <div key={i} className="hit">
                <strong>
                  {h.title} — p.{h.page}
                </strong>
                <p>{h.text.slice(0, 600)}…</p>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}
