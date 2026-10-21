// Rules library: the PDFs, images and notes the user owns (core rules,
// General's Handbook, battletomes, battleplan cards, maps). PDFs are split
// into page text so the coach can search them and cite page numbers.
//
// Files live in the blob store (a folder locally, Supabase Storage online).
// Large files are uploaded by the browser straight to storage, then
// finished here, so online body-size limits don't apply.

import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import type { LibraryDoc } from "../shared/types.ts";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";
import { Collection, newId } from "./store.ts";

// The shared library lives at the root (the admin's books); each invited
// player can add their own under their space. The coach uses both.
const shared = new Collection<LibraryDoc>("library", "");
const isShared = (doc: Pick<LibraryDoc, "owner">) => !doc.owner || doc.owner === "shared";
const prefixOf = (doc: Pick<LibraryDoc, "owner">) => (isShared(doc) ? "" : `users/${doc.owner}/`);
const own = () => (currentUser().prefix ? new Collection<LibraryDoc>("library", currentUser().prefix) : null);

/** Library entries visible to the current user: the shared ones and their own. */
export const libraryDocs = {
  async get(id: string) {
    return (await own()?.get(id)) ?? (await shared.get(id));
  },
  async list() {
    return [...(await shared.list()), ...((await own()?.list()) ?? [])];
  },
  async save(doc: LibraryDoc) {
    return new Collection<LibraryDoc>("library", prefixOf(doc)).save(doc);
  },
  async delete(doc: LibraryDoc) {
    return new Collection<LibraryDoc>("library", prefixOf(doc)).delete(doc.id);
  },
};


const pagesPath = (doc: Pick<LibraryDoc, "id" | "owner">) => `${prefixOf(doc)}library-files/${doc.id}.pages.json`;
export const docPath = (doc: Pick<LibraryDoc, "id" | "filename" | "owner">) =>
  `${prefixOf(doc)}library-files/${doc.id}${path.extname(doc.filename).toLowerCase() || ""}`;

/** Pages with less text than this are treated as images (photos, scans). */
export const MIN_PAGE_TEXT = 50;

const isPdfFile = (mime: string, filename: string) => mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");

type NewDoc = { title: string; category: LibraryDoc["category"]; filename: string; mime: string };

function newDoc(input: NewDoc): LibraryDoc {
  const isPdf = isPdfFile(input.mime, input.filename);
  return {
    id: newId(),
    title: input.title || input.filename.replace(/\.[^.]+$/, ""),
    kind: isPdf ? "pdf" : input.mime.startsWith("image/") ? "image" : "text",
    category: input.category,
    filename: input.filename,
    mime: input.mime || "application/octet-stream",
    pages: 1,
    createdAt: new Date().toISOString(),
    // Everything uploaded goes to the shared library (developers manage it).
    owner: "shared",
  };
}

/** Read the file's text and decide which pages need Claude to read them. */
async function process(doc: LibraryDoc, buffer: Buffer): Promise<LibraryDoc> {
  let pages: string[] = [];
  delete doc.uploading;
  if (doc.kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    doc.pages = totalPages;
    pages = (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").trim());
    const scanned = pages.flatMap((t, i) => (t.length < MIN_PAGE_TEXT ? [i + 1] : []));
    if (scanned.length) doc.transcription = { status: "pending", pages: scanned, done: 0 };
  } else if (doc.kind === "image") {
    // Battleplan cards, maps or photos of rules: transcribe so they are searchable too.
    pages = [""];
    doc.transcription = { status: "pending", pages: [1], done: 0 };
  } else {
    pages = [buffer.toString("utf8")];
  }
  await blobs().write(pagesPath(doc), JSON.stringify(pages), "application/json");
  await libraryDocs.save(doc);
  return doc;
}

/** Upload in one request (small files, notes, or the local multipart form). */
export async function addDocument(input: NewDoc & { buffer: Buffer }): Promise<LibraryDoc> {
  const doc = newDoc(input);
  await blobs().write(docPath(doc), input.buffer, doc.mime);
  return process(doc, input.buffer);
}

/** Step 1 of a direct upload: reserve the document and say where to send the file. */
export async function startUpload(input: NewDoc, apiPathFor: (id: string) => string) {
  const doc = { ...newDoc(input), uploading: true };
  await libraryDocs.save(doc);
  const target = await blobs().uploadTarget(docPath(doc), doc.mime, apiPathFor(doc.id));
  return { doc, target };
}

/** Step 2: the file is in storage, read it. */
export async function finishUpload(id: string): Promise<LibraryDoc> {
  const doc = await libraryDocs.get(id);
  if (!doc) throw new Error("No such document");
  if (!doc.uploading) return doc;
  const buffer = await blobs().read(docPath(doc));
  if (!buffer) throw new Error("The file did not arrive. Try uploading it again.");
  return process(doc, buffer);
}

export async function setPageText(id: string, page: number, text: string) {
  const doc = await libraryDocs.get(id);
  if (!doc) return;
  const pages = await getPages(id);
  while (pages.length < page) pages.push("");
  pages[page - 1] = text;
  await blobs().write(pagesPath(doc), JSON.stringify(pages), "application/json");
}

export async function deleteDocument(id: string) {
  const doc = await libraryDocs.get(id);
  if (!doc) return;
  await blobs().remove(docPath(doc));
  await blobs().remove(pagesPath(doc));
  await libraryDocs.delete(doc);
}

export async function getPages(id: string): Promise<string[]> {
  const doc = await libraryDocs.get(id);
  const b = doc ? await blobs().read(pagesPath(doc)) : undefined;
  return b ? (JSON.parse(b.toString("utf8")) as string[]) : [];
}

/** Documents ready to use (uploads still in progress are left out). */
export async function listDocuments(): Promise<LibraryDoc[]> {
  return (await libraryDocs.list()).filter((d) => !d.uploading);
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

interface Index {
  signature: string;
  chunks: Chunk[];
  df: Map<string, number>;
  avgLen: number;
}

// Rebuilt whenever the set of documents or their transcription progress
// changes (online, several server instances may each hold their own copy).
const indexes = new Map<string, Index>(); // per user: their own books differ

const STOP = new Set("the a an of to and or in on for is are be this that it its with as at by from if any each your you can cannot not their them they".split(" "));
const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+"]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));

async function currentIndex(): Promise<Index> {
  const docs = await listDocuments();
  const signature = docs
    .map((d) => `${d.id}:${d.transcription?.done ?? 0}:${d.transcription?.status ?? ""}`)
    .sort()
    .join("|");
  const cached = indexes.get(currentUser().id);
  if (cached?.signature === signature) return cached;
  const chunks: Chunk[] = [];
  const allPages = await Promise.all(docs.map((d) => getPages(d.id)));
  docs.forEach((doc, di) => {
    allPages[di].forEach((pageText, i) => {
      // Split long pages so a hit points at a focused passage.
      for (let start = 0; start < pageText.length; start += 1500) {
        const text = pageText.slice(Math.max(0, start - 200), start + 1500);
        const toks = tokenize(text);
        const terms = new Map<string, number>();
        for (const t of toks) terms.set(t, (terms.get(t) ?? 0) + 1);
        chunks.push({ docId: doc.id, title: doc.title, page: i + 1, text, terms, length: toks.length });
      }
    });
  });
  const df = new Map<string, number>();
  for (const c of chunks) for (const t of c.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = chunks.reduce((s, c) => s + c.length, 0) / Math.max(1, chunks.length);
  const index = { signature, chunks, df, avgLen };
  indexes.set(currentUser().id, index);
  return index;
}

export async function searchLibrary(query: string, limit = 6, docIds?: string[]) {
  const { chunks, df, avgLen } = await currentIndex();
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
