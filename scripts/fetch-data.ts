// The army data (data/aos.json) for a deploy. BSData took its repositories
// off GitHub on 12 November 2026 after a Games Workshop DMCA notice, so a
// build can no longer download it (scripts/build-data.ts). Deploys use the
// copy kept in the app's private storage bucket instead, at
// build-data/aos.json: the owner uploads it once (Supabase dashboard, or
// `--upload` below with the Supabase settings in .env).
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
import type { GameData } from "../shared/types.ts";
import { blobs } from "../server/blobs.ts";

const FILE = path.resolve("data", "aos.json");
const STORED = "build-data/aos.json";

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
  let raw: Buffer | undefined = fs.existsSync(FILE) ? fs.readFileSync(FILE) : undefined;
  if (!raw) {
    raw = await blobs().read(STORED);
    if (!raw) throw new Error(`The army data isn't in storage yet: upload data/aos.json to the "${process.env.SUPABASE_BUCKET?.trim() || "thorgrim"}" bucket at ${STORED} (README: Army data).`);
  }
  const data = valid(raw);
  data.builtAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data));
  console.log(`Army data ready: ${Object.keys(data.units).length} units, ${Object.keys(data.factions).length} factions.`);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
