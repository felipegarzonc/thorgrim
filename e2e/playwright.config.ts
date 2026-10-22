// End-to-end tests: the built app on a temporary store, signed in as the
// local user, with a fake Claude API (fake-claude.mjs). Run: npm run e2e

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const storage = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-e2e-"));

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:8897",
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium" },
  },
  webServer: [
    { command: "node fake-claude.mjs", port: 8898, reuseExistingServer: false },
    {
      command: "npx tsx server/index.ts",
      cwd: "..",
      port: 8897,
      reuseExistingServer: false,
      env: {
        PORT: "8897",
        STORAGE_DIR: storage,
        NODE_ENV: "production",
        APP_ACCESS_KEY: "",
        SUPABASE_URL: "",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://localhost:8898",
      },
    },
  ],
});
