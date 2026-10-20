// Shared Claude client. Created lazily and re-created when the API key is
// changed from the app's settings, so no restart is needed.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

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

// Saved next to the app's data when STORAGE_DIR is set, so it survives redeploys.
const defaultEnvFile = () => (process.env.STORAGE_DIR ? path.join(path.resolve(process.env.STORAGE_DIR), ".env") : path.resolve(".env"));

/** Save the API key to .env (creating it if needed) and use it right away. */
export function saveApiKey(key: string, envFile = defaultEnvFile()) {
  const line = `ANTHROPIC_API_KEY=${key}`;
  const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const next = /^ANTHROPIC_API_KEY=.*$/m.test(current)
    ? current.replace(/^ANTHROPIC_API_KEY=.*$/m, line)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, next, { mode: 0o600 });
  process.env.ANTHROPIC_API_KEY = key;
}
