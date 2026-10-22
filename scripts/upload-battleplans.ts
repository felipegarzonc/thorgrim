// Upload the General's Handbook 2026-27 battleplan and battle tactic cards
// (the photographed cards PDF) to the rules library, one image per card,
// titled so games pick up their battleplan's card automatically. Claude then
// reads each card so the coach can search them.
//
//   THORGRIM_URL=https://thorgrim.co APP_ACCESS_KEY=… npx tsx scripts/upload-battleplans.ts ./GHB_26-27_ENG.pdf
//   (add --no-read to skip reading the cards with Claude now)
//
// Cards already in the library (same title) are skipped, so it can be re-run.

import fs from "node:fs";
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { api, type Doc, upload } from "./library.ts";

// Page order of the cards PDF → what each card is. Repeated pages are left out.
const CARDS: { page: number; title: string; category: "battleplan" | "season" }[] = [
  { page: 1, title: "Into the Fire (battleplan 11 card)", category: "battleplan" },
  { page: 2, title: "Bloodstained Coasts (battleplan 12 card)", category: "battleplan" },
  { page: 3, title: "Caverns of Slaughter (battleplan 14 card)", category: "battleplan" },
  { page: 4, title: "Avalanche of Ash (battleplan 13 card)", category: "battleplan" },
  { page: 5, title: "Curse of the Gnaw (battleplan 22 card)", category: "battleplan" },
  { page: 7, title: "What's Yours is Ours (battleplan 15 card)", category: "battleplan" },
  { page: 8, title: "Warped Ruins (battleplan 21 card)", category: "battleplan" },
  { page: 9, title: "Seize the Embers (battleplan 23 card)", category: "battleplan" },
  { page: 10, title: "Escape From the Coast (battleplan 25 card)", category: "battleplan" },
  { page: 11, title: "Treacherous Ground (battleplan 24 card)", category: "battleplan" },
  { page: 12, title: "Power of the Realms (battleplan 26 card)", category: "battleplan" },
  { page: 13, title: "Battle tactic card: Blazing Onslaught", category: "season" },
  { page: 14, title: "Battle tactic card: Siege of Ashes", category: "season" },
  { page: 15, title: "Battle tactic card: Smokescreen", category: "season" },
  { page: 16, title: "Battle tactic card: Flanking Firestorm", category: "season" },
  { page: 17, title: "Battle tactic card: Legend of the Parch", category: "season" },
];

/** The photo on a PDF page (the cards PDF holds one JPEG per page). */
export function pageJpegs(pdf: PDFDocument): (Uint8Array | undefined)[] {
  return pdf.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return undefined;
    for (const [, ref] of xobjects.entries()) {
      const obj = ref instanceof PDFRef ? pdf.context.lookup(ref) : ref;
      if (!(obj instanceof PDFRawStream)) continue;
      const filter = obj.dict.get(PDFName.of("Filter"));
      if (filter?.toString() === "/DCTDecode") return obj.contents;
    }
    return undefined;
  });
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    console.log("Usage: upload-battleplans.ts <cards.pdf> [--no-read]");
    process.exitCode = 1;
    return;
  }
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  const images = pageJpegs(pdf);
  const existing = new Set((await api<Doc[]>("/library")).map((d) => d.title));
  for (const card of CARDS) {
    if (existing.has(card.title)) {
      console.log(`Already there: ${card.title}`);
      continue;
    }
    const jpeg = images[card.page - 1];
    if (!jpeg) {
      console.log(`No photo on page ${card.page} (${card.title}): skipped`);
      continue;
    }
    await upload("", card.title, card.category, {
      bytes: Buffer.from(jpeg),
      filename: `${card.title.replace(/[^\w]+/g, "-").toLowerCase()}.jpg`,
      read: !process.argv.includes("--no-read"),
    });
  }
  console.log("Done. Games show each battleplan's card, and the coach reads it.");
}

if (process.argv[1]?.endsWith("upload-battleplans.ts")) {
  await main().catch((e: Error) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
