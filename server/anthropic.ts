// Shared Claude client. Created lazily and re-created when the API key is
// changed from the app's settings, so no restart is needed.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { blobs } from "./blobs.ts";

let client: Anthropic | null = null;
let clientKey: string | undefined;

export const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export function anthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!client || key !== clientKey) {
    client = new Anthropic();
    clientKey = key;
  }
  return client;
}

// Where a key pasted in the app is kept: the .env file on your computer
// (next to the app's data when STORAGE_DIR is set), or a private settings
// file in Supabase storage online, where there is no writable disk.
const SECRETS = "settings/secrets.json";
const defaultEnvFile = () => (process.env.STORAGE_DIR ? path.join(path.resolve(process.env.STORAGE_DIR), ".env") : path.resolve(".env"));

let checkedAt = 0;

/** Online: pick up a key saved from the app (it wins over the hosting env). Cached for a minute. */
export async function loadSavedApiKey() {
  if (blobs().kind !== "supabase" || Date.now() - checkedAt < 60_000) return;
  checkedAt = Date.now();
  const saved = await blobs().read(SECRETS);
  const key = saved ? (JSON.parse(saved.toString("utf8")) as { anthropicApiKey?: string }).anthropicApiKey : undefined;
  if (key) process.env.ANTHROPIC_API_KEY = key;
}

/** Save the API key (see above) and use it right away. */
export async function saveApiKey(key: string, envFile = defaultEnvFile()) {
  if (blobs().kind === "supabase") {
    await blobs().write(SECRETS, JSON.stringify({ anthropicApiKey: key }), "application/json");
  } else {
    const line = `ANTHROPIC_API_KEY=${key}`;
    const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
    const next = /^ANTHROPIC_API_KEY=.*$/m.test(current)
      ? current.replace(/^ANTHROPIC_API_KEY=.*$/m, line)
      : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, next, { mode: 0o600 });
  }
  process.env.ANTHROPIC_API_KEY = key;
  checkedAt = Date.now();
}
