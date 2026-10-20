import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-transcribe-test-"));

const calls: any[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        create: async (params: any) => {
          calls.push(params);
          const prompt = params.messages[0].content.at(-1).text as string;
          const pages = /These are pages ([\d, ]+)\./.exec(prompt)![1].split(", ").map(Number);
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: pages.map((n) => `=== PAGE ${n} ===\nRULE ${n}: Gutbuster charge ability`).join("\n\n") }],
          };
        },
      },
    };
  }
  return { default: Anthropic };
});

const { splitPages, transcribeDocument } = await import("./transcribe.ts");
const { addDocument, getPages, libraryDocs, searchLibrary } = await import("./library.ts");

describe("splitPages", () => {
  it("splits on page markers and ignores unknown pages", () => {
    const m = splitPages("=== PAGE 3 ===\nA\n=== PAGE 4 ===\nB\n=== PAGE 9 ===\nC", [3, 4]);
    expect([...m.entries()]).toEqual([
      [3, "A"],
      [4, "B"],
    ]);
  });
  it("uses the whole text for a single page without markers", () => {
    expect(splitPages("just text", [7]).get(7)).toBe("just text");
  });
});

describe("transcribeDocument", () => {
  it("reads text-less PDF pages in batches and makes them searchable", async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 6; i++) pdf.addPage([200, 200]); // blank pages: no text layer
    const doc = await addDocument({
      title: "Photo book",
      category: "battletome",
      filename: "book.pdf",
      mime: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
    expect(doc.transcription).toMatchObject({ status: "pending", pages: [1, 2, 3, 4, 5, 6], done: 0 });

    await transcribeDocument(doc.id);

    expect(calls).toHaveLength(2); // 4 pages + 2 pages
    const sent = await PDFDocument.load(Buffer.from(calls[0].messages[0].content[0].source.data, "base64"));
    expect(sent.getPageCount()).toBe(4);
    expect(calls[0].fallbacks).toBe("default");
    expect((await libraryDocs.get(doc.id))?.transcription).toMatchObject({ status: "done", done: 6 });
    expect((await getPages(doc.id))[5]).toBe("RULE 6: Gutbuster charge ability");
    expect((await searchLibrary("Gutbuster charge"))[0]).toMatchObject({ docId: doc.id });
  });
});
