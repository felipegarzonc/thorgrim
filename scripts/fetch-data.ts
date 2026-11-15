// The army data (data/aos.json) for a deploy. BSData took its repositories
// off GitHub on 12 November 2026 after a Games Workshop DMCA notice, so a
// build can no longer download it (scripts/build-data.ts). Deploys use the
// copy kept in the app's private storage bucket instead, at
// build-data/aos.json: the owner uploads it once (Supabase dashboard, or
// `--upload` below with the Supabase settings in .env). Where an upload can't
// take a 10 MB file, gzip parts work too (see fromStorage).
//
//   npm run data:fetch                # data/aos.json from storage, unless it is already here
//   npm run data:fetch -- --upload    # put the local data/aos.json in storage
//
// "Storage" is the app's own: Supabase with SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY set (Vercel has them at build time), else the
// local folder (STORAGE_DIR).
//
// Each build stamps the file with its own time (builtAt), so open pages see
// that a new version is live even though the army data itself is unchanged.

import "../server/env.ts";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { GameData } from "../shared/types.ts";
import { blobs } from "../server/blobs.ts";

const FILE = path.resolve("data", "aos.json");
const STORED = "build-data/aos.json";
const MAX_PARTS = 20;

const valid = (raw: Buffer | string): GameData => {
  const d = JSON.parse(raw.toString()) as GameData;
  if (!d?.units || !d.factions || !Object.keys(d.units).length) throw new Error("That file isn't Thorgrim's army data (no units or factions).");
  return d;
};

async function main() {
  if (process.argv.includes("--upload")) {
    const raw = fs.readFileSync(FILE);
    valid(raw);
    await blobs().write(STORED, raw, "application/json");
    console.log(`Uploaded ${FILE} to ${blobs().kind === "supabase" ? "Supabase storage" : "local storage"} at ${STORED}.`);
    return;
  }
  const data = fs.existsSync(FILE) ? valid(fs.readFileSync(FILE)) : await fromStorage();
  data.builtAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data));
  console.log(`Army data ready: ${Object.keys(data.units).length} units, ${Object.keys(data.factions).length} factions.`);
}

/**
 * The copy in storage, in the first form found that holds valid data:
 * gzip parts (aos.json.gz.part1, .part2, … joined in order, for uploads that
 * can't take one big file), one aos.json.gz, or the plain aos.json.
 */
async function fromStorage(): Promise<GameData> {
  // Say where it looked: a build without the Supabase settings looks in an empty local folder.
  if (blobs().kind !== "supabase" && process.env.VERCEL)
    throw new Error("The army data can't be fetched: this build has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so it looked in an empty local folder. In Vercel, set both for this environment (Production / Preview) and redeploy.");
  const problems: string[] = [];
  const attempt = (name: string, read: () => Buffer): GameData | undefined => {
    try {
      return valid(read());
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message.slice(0, 120)}`);
      return undefined;
    }
  };
  const parts: Buffer[] = [];
  for (let n = 1; n <= MAX_PARTS; n++) {
    const part = await blobs().read(`${STORED}.gz.part${n}`);
    if (!part) break;
    parts.push(part);
  }
  if (parts.length) {
    const d = attempt(`${STORED}.gz.part1-${parts.length}`, () => zlib.gunzipSync(Buffer.concat(parts)));
    if (d) return d;
  }
  const gz = await blobs().read(`${STORED}.gz`);
  if (gz) {
    const d = attempt(`${STORED}.gz`, () => zlib.gunzipSync(gz));
    if (d) return d;
  }
  const plain = await blobs().read(STORED);
  if (plain) {
    const d = attempt(`${STORED} (${plain.length} bytes)`, () => plain);
    if (d) return d;
  }
  const where = blobs().kind === "supabase" ? `the "${process.env.SUPABASE_BUCKET?.trim() || "thorgrim"}" bucket of ${(process.env.SUPABASE_URL ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")}` : "local storage";
  throw new Error(
    problems.length
      ? `The army data in ${where} isn't usable (a cut-off upload?): ${problems.join("; ")}. Upload it again (README: Army data).`
      : `The army data isn't in storage yet: no ${STORED} (or ${STORED}.gz.part1…) in ${where}. Upload it there with exactly that folder and name (README: Army data).`,
  );
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
