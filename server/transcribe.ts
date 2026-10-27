// Reads pages that have no text layer (phone photos of a book, scanned PDFs,
// images of battleplan cards) with Claude and stores a faithful transcription,
// so the coach can search and cite them like any other page. Runs once per
// upload, in the background, a few pages per request.

import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import type { LibraryDoc } from "../shared/types.ts";
import { checkBudget, recordUsage } from "./accounts.ts";
import { anthropic, hasCredentials } from "./anthropic.ts";
import { blobs } from "./blobs.ts";
import { docPath, libraryDocs, setPageText } from "./library.ts";
import { UserError } from "./errors.ts";

const MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";
const PAGES_PER_REQUEST = 4;

const INSTRUCTIONS = `Transcribe the Warhammer Age of Sigmar rules on these pages so they can be searched later. The images may be photos of a printed book (angled, curled, glare) or screenshots.

- Transcribe rules text exactly: ability names, the timing bar (e.g. "Once Per Turn (Army), Any Combat Phase", "Passive", "Reaction: ..."), Declare, Effect, Keywords, casting/chanting values, points.
- Warscrolls: unit name, Move / Health / Save / Control (and Ward), weapon tables as Markdown tables (Weapon | Rng | Atk | Hit | Wnd | Rnd | Dmg | Ability), abilities, keywords.
- Keep section headings (e.g. "BATTLE FORMATIONS", "HEROIC TRAITS").
- Skip italic flavour text, lore/story paragraphs and art. If a page has no rules, write "(no rules on this page)".
- If a word is unreadable, write [unclear] rather than guessing.

Start each page with a line "=== PAGE N ===" using the page numbers given, in order. Output only the transcription.`;

/** Split a transcription that uses "=== PAGE N ===" markers. */
export function splitPages(text: string, pageNumbers: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const parts = text.split(/^=== PAGE (\d+) ===\s*$/m);
  // parts: [preamble, n1, text1, n2, text2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    if (pageNumbers.includes(n)) out.set(n, parts[i + 1].trim());
  }
  if (out.size === 0 && pageNumbers.length === 1) out.set(pageNumbers[0], text.trim());
  return out;
}

async function transcribeBatch(blocks: Anthropic.Beta.BetaContentBlockParam[], pageNumbers: number[]) {
  await checkBudget();
  const response = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [
      {
        role: "user",
        content: [...blocks, { type: "text", text: `${INSTRUCTIONS}\n\nThese are pages ${pageNumbers.join(", ")}.` }],
      },
    ],
  });
  await recordUsage(response.usage);
  if (response.stop_reason === "refusal") throw new Error("Claude declined to transcribe these pages");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return splitPages(text, pageNumbers);
}

/**
 * Read the next batch of text-less pages (at most PAGES_PER_REQUEST) and
 * save them. Short enough to fit in one online request; call it again until
 * the status is "done". Returns the document's progress.
 */
export async function transcribeStep(id: string): Promise<LibraryDoc["transcription"]> {
  const doc = await libraryDocs.get(id);
  const t = doc?.transcription;
  if (!doc || !t || t.status === "done") return t;
  try {
    const buffer = await blobs().read(docPath(doc));
    if (!buffer) throw new UserError("The file is missing from storage. Upload it again.", 404);
    let batch: number[];
    let pages: Map<number, string>;
    if (doc.kind === "image") {
      const media = doc.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      batch = [1];
      pages = await transcribeBatch([{ type: "image", source: { type: "base64", media_type: media, data: buffer.toString("base64") } }], batch);
    } else {
      batch = t.pages.slice(t.done, t.done + PAGES_PER_REQUEST);
      const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const part = await PDFDocument.create();
      for (const page of await part.copyPages(source, batch.map((n) => n - 1))) part.addPage(page);
      const data = Buffer.from(await part.save()).toString("base64");
      pages = await transcribeBatch([{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }], batch);
    }
    for (const n of batch) await setPageText(id, n, pages.get(n) ?? "");
    const done = t.done + batch.length;
    doc.transcription = { ...t, done, status: done >= t.pages.length ? "done" : "running", error: undefined };
  } catch (err) {
    console.error(`Transcription failed for ${doc.title}:`, err);
    doc.transcription = { ...t, status: "failed", error: (err as Error).message };
  }
  await libraryDocs.save(doc);
  return doc.transcription;
}

const running = new Set<string>();

/** Read all text-less pages in the background (on your own computer). */
export async function transcribeDocument(id: string): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    for (;;) {
      const t = await transcribeStep(id);
      if (!t || t.status === "done" || t.status === "failed") return;
    }
  } finally {
    running.delete(id);
  }
}

/**
 * Online (Vercel) there is no long-running server: the Rules page drives
 * the reading one step at a time while it is open.
 */
export const backgroundJobs = () => !process.env.VERCEL;

/** On startup, resume anything that was interrupted. */
export async function resumePendingTranscriptions() {
  if (!hasCredentials() || !backgroundJobs()) return;
  for (const doc of await libraryDocs.list()) {
    if (doc.transcription && (doc.transcription.status === "pending" || doc.transcription.status === "running")) {
      void transcribeDocument(doc.id);
    }
  }
}
