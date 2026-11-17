// End-to-end tests: the built app on a temporary store, signed in as the
// local user, with a fake Claude API (fake-claude.mjs). Run: npm run e2e

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const storage = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-e2e-"));
// The same app with accounts on, for the admin's screens: sign-in goes to a stand-in for Supabase Auth
// (fake-auth.mjs) and records stay in a folder. Its tests are the accounts.*.spec.ts files; they are told
// where that folder is (workers inherit the variable, so every process sees the same one).
process.env.E2E_ACCOUNTS_STORAGE ??= fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-e2e-accounts-"));
export const ACCOUNTS_APP_PASSWORD = "e2e-app-password";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  projects: [
    { name: "app", testIgnore: /accounts\..*\.spec\.ts$/ },
    { name: "accounts", testMatch: /accounts\..*\.spec\.ts$/, use: { baseURL: "http://localhost:8896" } },
  ],
  use: {
    baseURL: "http://localhost:8897",
    viewport: { width: 390, height: 844 },
    // Where a Chromium is already installed at this path (cloud sessions), use it; elsewhere, Playwright's own.
    launchOptions: !process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {},
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
        // Made-up armies, so the tests run the same everywhere (the real data isn't in the repository).
        DATA_FILE: "e2e/fixtures/aos.json",
        NODE_ENV: "production",
        APP_ACCESS_KEY: "",
        SUPABASE_URL: "",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://localhost:8898",
      },
    },
    { command: "node fake-auth.mjs", port: 8895, reuseExistingServer: false },
    {
      command: "npx tsx server/index.ts",
      cwd: "..",
      port: 8896,
      reuseExistingServer: false,
      env: {
        PORT: "8896",
        STORAGE_DIR: process.env.E2E_ACCOUNTS_STORAGE,
        BLOB_STORE: "local",
        DATA_FILE: "e2e/fixtures/aos.json",
        NODE_ENV: "production",
        APP_ACCESS_KEY: ACCOUNTS_APP_PASSWORD,
        SUPABASE_URL: "http://localhost:8895",
        SUPABASE_AUTH_URL: "http://localhost:8895",
        SUPABASE_SERVICE_ROLE_KEY: "e2e-service-key",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://localhost:8898",
        RESEND_API_KEY: "",
        GMAIL_USER: "",
      },
    },
  ],
});
