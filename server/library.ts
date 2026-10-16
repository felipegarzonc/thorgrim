// Rules library: the PDFs, images and notes the user owns (core rules,
// General's Handbook, battletomes, battleplan cards, maps). PDFs are split
// into page text so the coach can search them and cite page numbers.

import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import type { LibraryDoc } from "../shared/types.ts";
import { Collection, newId, storageDir } from "./store.ts";

export const libraryDocs = new Collection<LibraryDoc>("library");
const filesDir = path.join(storageDir, "library-files");
fs.mkdirSync(filesDir, { recursive: true });

const pagesFile = (id: string) => path.join(filesDir, `${id}.pages.json`);
export const docFile = (doc: LibraryDoc) => path.join(filesDir, `${doc.id}${path.extname(doc.filename) || ""}`);

export async function addDocument(input: {
  title: string;
  category: LibraryDoc["category"];
  filename: string;
  mime: string;
  buffer: Buffer;
}): Promise<LibraryDoc> {
  const id = newId();
  const isPdf = input.mime === "application/pdf" || input.filename.toLowerCase().endsWith(".pdf");
  const isImage = input.mime.startsWith("image/");
  const doc: LibraryDoc = {
    id,
    title: input.title || input.filename,
    kind: isPdf ? "pdf" : isImage ? "image" : "text",
    category: input.category,
    filename: input.filename,
    mime: input.mime,
    pages: 1,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(docFile(doc), input.buffer);
  let pages: string[] = [];
  if (isPdf) {
    const pdf = await getDocumentProxy(new Uint8Array(input.buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    doc.pages = totalPages;
    pages = (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").trim());
  } else if (!isImage) {
    pages = [input.buffer.toString("utf8")];
  }
  if (isImage) {
    // Battleplan cards, maps or photos of rules: transcribe so they are searchable too.
    pages = [""];
    doc.transcription = { status: "pending", pages: [1], done: 0 };
  }
  if (isPdf) {
    const scanned = pages.flatMap((t, i) => (t.length < MIN_PAGE_TEXT ? [i + 1] : []));
    if (scanned.length) doc.transcription = { status: "pending", pages: scanned, done: 0 };
  }
  fs.writeFileSync(pagesFile(id), JSON.stringify(pages));
  libraryDocs.save(doc);
  invalidateIndex();
  return doc;
}

/** Pages with less text than this are treated as images (photos, scans). */
export const MIN_PAGE_TEXT = 50;

export function setPageText(id: string, page: number, text: string) {
  const pages = getPages(id);
  while (pages.length < page) pages.push("");
  pages[page - 1] = text;
  fs.writeFileSync(pagesFile(id), JSON.stringify(pages));
  invalidateIndex();
}

export function deleteDocument(id: string) {
  const doc = libraryDocs.get(id);
  if (!doc) return;
  for (const f of [docFile(doc), pagesFile(id)]) if (fs.existsSync(f)) fs.unlinkSync(f);
  libraryDocs.delete(id);
  invalidateIndex();
}

export function getPages(id: string): string[] {
  const f = pagesFile(id);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as string[]) : [];
}

/** "3-5,9" -> [3,4,5,9] (1-based, clamped to the document). */
export function parsePageRange(range: string | undefined, max: number): number[] {
  if (!range?.trim()) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of range.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (!Number.isFinite(a)) continue;
    for (let p = a; p <= (Number.isFinite(b) ? b : a); p++) if (p >= 1 && p <= max) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

// ---------- search (BM25 over page chunks) ----------

interface Chunk {
  docId: string;
  title: string;
  page: number;
  text: string;
  terms: Map<string, number>;
  length: number;
}

let index: { chunks: Chunk[]; df: Map<string, number>; avgLen: number } | null = null;
const invalidateIndex = () => (index = null);

const STOP = new Set("the a an of to and or in on for is are be this that it its with as at by from if any each your you can cannot not their them they".split(" "));
const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+"]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));

function buildIndex() {
  const chunks: Chunk[] = [];
  for (const doc of libraryDocs.list()) {
    getPages(doc.id).forEach((pageText, i) => {
      // Split long pages so a hit points at a focused passage.
      for (let start = 0; start < pageText.length; start += 1500) {
        const text = pageText.slice(Math.max(0, start - 200), start + 1500);
        const toks = tokenize(text);
        const terms = new Map<string, number>();
        for (const t of toks) terms.set(t, (terms.get(t) ?? 0) + 1);
        chunks.push({ docId: doc.id, title: doc.title, page: i + 1, text, terms, length: toks.length });
      }
    });
  }
  const df = new Map<string, number>();
  for (const c of chunks) for (const t of c.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = chunks.reduce((s, c) => s + c.length, 0) / Math.max(1, chunks.length);
  index = { chunks, df, avgLen };
  return index;
}

export function searchLibrary(query: string, limit = 6, docIds?: string[]) {
  const { chunks, df, avgLen } = index ?? buildIndex();
  const q = [...new Set(tokenize(query))];
  const N = chunks.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = chunks
    .filter((c) => !docIds || docIds.includes(c.docId))
    .map((c) => {
      let score = 0;
      for (const t of q) {
        const tf = c.terms.get(t);
        if (!tf) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.length) / avgLen));
      }
      // Exact phrase bonus.
      if (query.length > 4 && c.text.toLowerCase().includes(query.toLowerCase())) score *= 1.5;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  // At most two hits per page.
  const perPage = new Map<string, number>();
  const out: { docId: string; title: string; page: number; text: string }[] = [];
  for (const { c } of scored) {
    const k = `${c.docId}:${c.page}`;
    if ((perPage.get(k) ?? 0) >= 2) continue;
    perPage.set(k, (perPage.get(k) ?? 0) + 1);
    out.push({ docId: c.docId, title: c.title, page: c.page, text: c.text });
    if (out.length >= limit) break;
  }
  return out;
}
