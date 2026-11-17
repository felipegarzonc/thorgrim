// Opening the app again shows what this phone kept at once, while the server
// answers (slow on a phone with poor signal, or a server that was asleep).

import { expect, test } from "@playwright/test";

test("a second visit shows the games before the server answers", async ({ page }) => {
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New game" }).first().click();
  await expect(page).toHaveURL(/players/);
  await page.getByPlaceholder("Opponent's name").fill("Diego");
  await page.getByPlaceholder("Opponent's name").blur();
  await expect(page.locator(".sync-badge.saved")).toBeVisible();
  await page.goto("/#/home");
  await expect(page.getByText(/Diego/).first()).toBeVisible();

  // Now every answer from the server takes 3 seconds.
  let release!: () => void;
  const slow = new Promise<void>((r) => (release = r));
  await page.route("**/api/**", async (route) => {
    await Promise.race([slow, new Promise((r) => setTimeout(r, 3000))]);
    await route.continue();
  });
  const started = Date.now();
  await page.reload();
  // Home and the last games are there well before the server answers...
  await expect(page.getByText(/Diego/).first()).toBeVisible({ timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2500);
  await expect(page.locator(".page-loading")).toHaveCount(0);
  // ...and the fresh answers still arrive and replace them.
  const fresh = page.waitForResponse((r) => r.url().endsWith("/api/games"));
  release();
  expect((await fresh).ok()).toBe(true);
  await expect(page.getByText(/Diego/).first()).toBeVisible();
});
