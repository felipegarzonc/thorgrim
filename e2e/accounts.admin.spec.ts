// The admin's screens, which only exist with accounts on: signing in, the
// version line, what the coach cost by month, and taking a backup and
// restoring from it.

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ACCOUNTS_APP_PASSWORD } from "./playwright.config.ts";

const OWNER = { name: "Ana", email: "ana@example.com", password: "a-long-password" };

test("the owner signs in, sees the cost by month, and restores a deleted game from a backup", async ({ page }) => {
  // The first account (the owner), made with the app password as on a new install.
  const setup = await page.request.post("/api/auth/setup", { data: { accessKey: ACCOUNTS_APP_PASSWORD, ...OWNER } });
  expect(setup.ok()).toBe(true);
  const ownerId = ((await setup.json()) as { user: { id: string } }).user.id;
  // What the coach cost her this month, as the app records it.
  const month = new Date().toISOString().slice(0, 7);
  const usage = path.join(process.env.E2E_ACCOUNTS_STORAGE!, "usage", ownerId);
  fs.mkdirSync(usage, { recursive: true });
  fs.writeFileSync(path.join(usage, `${month}.json`), JSON.stringify({ requests: 3, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, costUsd: 1.25 }));

  await page.goto("/#/signin");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".bottom-nav")).toBeVisible();

  // A game to lose and get back.
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New game" }).first().click();
  await expect(page).toHaveURL(/#\/games\/[a-z0-9]+\/players/);
  const gameId = /games\/([a-z0-9]+)\//.exec(page.url())![1];
  await page.getByPlaceholder("Opponent's name").fill("Diego");
  await page.getByPlaceholder("Opponent's name").blur();
  await expect(page.locator(".sync-badge.saved")).toBeVisible();

  await page.goto("/#/profile");
  await expect(page.locator(".app-version")).toContainText("Thorgrim ·");

  // The coach's cost: this month first and open, with who spent it.
  const cost = page.locator(".card", { hasText: "Thorgrim's cost by month" });
  await expect(cost.locator(".usage-month")).toHaveCount(6);
  await expect(cost.locator(".usage-month").first()).toContainText(month);
  await expect(cost.locator(".usage-month").first().locator("summary")).toContainText("$1.25");
  await expect(cost.locator(".usage-players li").first()).toContainText(/Ana.*3 requests.*\$1\.25/);

  // A backup, downloaded.
  const backups = page.locator(".card", { hasText: "Backups" });
  const download = page.waitForEvent("download");
  await backups.getByRole("button", { name: "Download a backup now" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^thorgrim-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json\.gz$/);
  const saved = path.join(test.info().outputDir, file.suggestedFilename());
  await file.saveAs(saved);

  // The game is deleted...
  page.once("dialog", (d) => void d.accept());
  await page.goto(`/#/games/${gameId}/players`);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Delete game" }).click();
  await expect(page).toHaveURL(/#\/games$/);
  await expect(page.getByText("Diego")).toHaveCount(0);

  // ...and restored from the file: first what it would do, then, with the word typed, done.
  await page.goto("/#/profile");
  await backups.getByRole("button", { name: "Restore from a backup…" }).click();
  await backups.getByLabel("Backup file").setInputFiles(saved);
  await backups.getByRole("button", { name: "See what it would do" }).click();
  await expect(backups.locator(".restore-plan")).toContainText(/Restoring brings back 1 missing now and puts 0 changed/);
  const restore = backups.getByRole("button", { name: "Restore 1 records" });
  await expect(restore).toBeDisabled();
  await backups.getByLabel("Type RESTORE to go ahead").fill("RESTORE");
  await restore.click();
  await expect(backups.getByRole("status")).toContainText(/Restored 1 records.*before-restore\.json\.gz/);
  // How things were just before is kept, and offered in the list at once.
  await expect(backups.getByLabel("A kept backup").locator("option")).toContainText([/Choose/, /before-restore\.json\.gz/]);
  if (process.env.E2E_SHOTS) {
    await cost.screenshot({ path: `${process.env.E2E_SHOTS}/admin-cost.png` });
    await backups.screenshot({ path: `${process.env.E2E_SHOTS}/admin-restore.png` });
  }
  await page.goto("/#/games");
  await expect(page.getByText("Diego").first()).toBeVisible();
});

test("someone who isn't signed in gets no backup", async ({ request }) => {
  expect((await request.get("/api/admin/backup")).status()).toBe(401);
  expect((await request.post("/api/admin/restore?confirm=RESTORE")).status()).toBe(401);
});
