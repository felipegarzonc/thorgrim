// Reads pages that have no text layer (phone photos of a book, scanned PDFs,
// images of battleplan cards) with Claude and stores a faithful transcription,
// so the coach can search and cite them like any other page. Runs once per
// upload, in the background, a few pages per request.

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import type { LibraryDoc } from "../shared/types.ts";
import { anthropic, hasCredentials } from "./anthropic.ts";
import { docFile, libraryDocs, setPageText } from "./library.ts";

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
  if (response.stop_reason === "refusal") throw new Error("Claude declined to transcribe these pages");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return splitPages(text, pageNumbers);
}

const running = new Set<string>();

function update(doc: LibraryDoc, patch: Partial<NonNullable<LibraryDoc["transcription"]>>) {
  const fresh = libraryDocs.get(doc.id);
  if (!fresh?.transcription) return;
  fresh.transcription = { ...fresh.transcription, ...patch };
  libraryDocs.save(fresh);
}

/** Transcribe the doc's text-less pages. Safe to call again to resume. */
export async function transcribeDocument(id: string): Promise<void> {
  const doc = libraryDocs.get(id);
  if (!doc?.transcription || doc.transcription.status === "done" || running.has(id)) return;
  running.add(id);
  try {
    update(doc, { status: "running", error: undefined });
    const buffer = fs.readFileSync(docFile(doc));
    const todo = doc.transcription.pages.slice(doc.transcription.done);
    let done = doc.transcription.done;

    if (doc.kind === "image") {
      const media = doc.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      const pages = await transcribeBatch([{ type: "image", source: { type: "base64", media_type: media, data: buffer.toString("base64") } }], [1]);
      setPageText(id, 1, pages.get(1) ?? "");
      update(doc, { status: "done", done: 1 });
      return;
    }

    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    for (let i = 0; i < todo.length; i += PAGES_PER_REQUEST) {
      const batch = todo.slice(i, i + PAGES_PER_REQUEST);
      const part = await PDFDocument.create();
      for (const page of await part.copyPages(source, batch.map((n) => n - 1))) part.addPage(page);
      const data = Buffer.from(await part.save()).toString("base64");
      const pages = await transcribeBatch([{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }], batch);
      for (const n of batch) setPageText(id, n, pages.get(n) ?? "");
      done += batch.length;
      update(doc, { done });
    }
    update(doc, { status: "done" });
  } catch (err) {
    console.error(`Transcription failed for ${doc.title}:`, err);
    update(doc, { status: "failed", error: (err as Error).message });
  } finally {
    running.delete(id);
  }
}

/** On startup, resume anything that was interrupted. */
export function resumePendingTranscriptions() {
  if (!hasCredentials()) return;
  for (const doc of libraryDocs.list()) {
    if (doc.transcription && (doc.transcription.status === "pending" || doc.transcription.status === "running")) {
      void transcribeDocument(doc.id);
    }
  }
}
