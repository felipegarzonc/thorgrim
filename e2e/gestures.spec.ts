// Phone gestures: swipe between rounds on the battle screen, pull Home down to refresh.
import { expect, test } from "@playwright/test";
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test("gestures", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const drag = async (x0: number, y0: number, x1: number, y1: number, steps = 8, hold = false) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
      await page.waitForTimeout(16);
    }
    if (hold) return;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New game" }).first().click();
  await expect(page).toHaveURL(/players/);
  const gameUrl = page.url().replace(/\/players$/, "");
  await page.goto(gameUrl + "/round-1");
  await page.waitForTimeout(600);
  await drag(300, 500, 120, 510);
  await expect(page).toHaveURL(/round-2$/);
  await drag(100, 500, 300, 505);
  await expect(page).toHaveURL(/round-1$/);
  // A vertical scroll is not a swipe.
  await drag(200, 600, 230, 300);
  await expect(page).toHaveURL(/round-1$/);
  // Pull to refresh on Home: the games load again.
  await page.goto("/#/home");
  await page.waitForTimeout(800);
  let reloaded = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/games")) reloaded++; });
  await drag(200, 200, 200, 420, 10, true);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => reloaded).toBeGreaterThan(0);
  await expect(page.locator(".ptr.busy")).toHaveCount(0);
});
