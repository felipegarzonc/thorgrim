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
  // Each step is checked, so a failure says which one broke: the page is at its top, with nothing open over it...
  await expect.poll(() => page.evaluate(() => ({ scrollY: Math.round(window.scrollY), sheetOpen: !!document.querySelector("[role=dialog], dialog[open]") }))).toEqual({ scrollY: 0, sheetOpen: false });
  await drag(200, 200, 200, 420, 10, true);
  // ...the pull shows while the finger is down...
  await expect.poll(() => page.locator(".ptr").evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(72);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  // ...and letting go loads the games again.
  await expect.poll(() => reloaded).toBeGreaterThan(0);
  await expect(page.locator(".ptr.busy")).toHaveCount(0);
});

// On a slow phone the last page's scrolling can land after the next page opened.
test("a page that just opened stays at its top, without holding the person back", async ({ page }) => {
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  await page.goto("/#/games");
  await page.addStyleTag({ content: "body { min-height: 3000px; }" }); // tall enough to scroll, whatever is on it
  await page.evaluate(() => (location.hash = "#/home"));
  // A scroll arriving just after the section changed is undone...
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(scrollY).toBe(0);
  // ...the person scrolling is not...
  await page.mouse.wheel(0, 250);
  await expect.poll(scrollY).toBe(250);
  // ...and after a moment the page scrolls freely again.
  await page.evaluate(() => (location.hash = "#/games"));
  await expect.poll(scrollY).toBe(0);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(150);
  expect(await scrollY()).toBe(200);
});
