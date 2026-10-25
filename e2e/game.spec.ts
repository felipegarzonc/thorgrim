// A whole game in the browser: set it up, score a round, finish it, let the
// coach write the report and post it to the club.

import fs from "node:fs";
import { expect, test } from "@playwright/test";

test("score a game and post its report to the club", async ({ page }) => {
  // The sounds the game plays (Web Audio runs; the cues are seen through their event).
  await page.addInitScript(() => {
    (window as unknown as { cues: string[] }).cues = [];
    window.addEventListener("thorgrim-sound", (e) => (window as unknown as { cues: string[] }).cues.push((e as CustomEvent<string>).detail));
  });
  const cues = () => page.evaluate(() => (window as unknown as { cues: string[] }).cues);
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New game" }).first().click();

  // Players.
  await expect(page).toHaveURL(/#\/games\/[a-z0-9]+\/players/);
  const gameUrl = page.url().replace(/\/players$/, "");
  await page.getByPlaceholder("Your name").fill("Goy");
  await page.getByPlaceholder("Opponent's name").fill("Diego");
  await page.getByPlaceholder("Opponent's name").blur();

  // Battleplan.
  await page.goto(`${gameUrl}/battleplan`);
  await page.getByRole("radio", { name: /Into the Fire/ }).click();
  await expect(page.getByRole("radio", { name: /Into the Fire/ })).toHaveAttribute("aria-checked", "true");

  // Round 1: I go first and hold two objectives.
  await page.goto(`${gameUrl}/round-1`);
  await page.getByRole("group", { name: "First turn" }).getByRole("button", { name: "You" }).click();
  await expect(page.locator(".turn-card")).toBeVisible();
  const mine = page.locator(".side-block").first();
  await mine.getByText("Control at least 1 objective").click();
  await mine.getByText("Control at least 2 objectives").click();
  await expect(page.locator(".game-head-title")).toContainText("6-0 Goy vs Diego");

  // The chess clock runs and pauses.
  await page.locator(".chess-clock").click();
  await expect(page.locator(".chess-clock")).toContainText("Pause");
  await page.locator(".chess-clock").click();
  await expect(page.locator(".chess-clock")).toContainText("Resume");
  expect(await cues()).toEqual(["score", "score", "clockStart", "clockPause"]);

  // Results, then finish the game.
  await page.goto(`${gameUrl}/results`);
  await expect(page.locator(".victory-title")).toHaveText("VICTORY");
  await expect.poll(cues).toContain("victory");
  await page.getByRole("button", { name: "Finish game" }).click();
  await expect(page).toHaveURL(/#\/games$/);

  // The coach's review and the report, then post it.
  await page.goto(`${gameUrl}/results`);
  await expect(page.locator(".review-verdict")).toBeVisible();
  await page.getByRole("button", { name: "Write the report" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("The Saga of the Test Table");
  await page.getByRole("button", { name: "Post to the club" }).click();

  await expect(page).toHaveURL(/#\/club\/[a-z0-9]+/);
  const post = page.locator(".post").first();
  await expect(post.locator(".post-title")).toHaveText("The Saga of the Test Table");
  await expect(post.locator(".post-stats")).toContainText("6–0");
  await expect(post.locator(".story")).toContainText("The test army won the day.");

  // Share it outside the club: the link's page carries this battle's own picture.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  // The picture goes with the link: on a computer it's saved and the link (with the title) copied.
  const download = page.waitForEvent("download");
  await post.getByRole("button", { name: "Share outside the club" }).click();
  await expect(post.getByText("Picture saved and link copied.")).toBeVisible({ timeout: 15_000 });
  expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split("\n")[0]).toBe("The Saga of the Test Table");
  const link = copied.split("\n").pop()!;
  expect(link).toMatch(/\/r\/[a-f0-9]{32}$/);
  const html = await (await page.request.get(link)).text();
  expect(html).toContain('og:title" content="The Saga of the Test Table"');
  expect(html).toContain("Goy 6–0 Diego");
  const image = /og:image" content="([^"]+)"/.exec(html)![1];
  expect(image).toMatch(/\/api\/public\/reports\/[a-f0-9]{32}\/card\.jpg/);
  const card = await page.request.get(image);
  expect(card.headers()["content-type"]).toBe("image/jpeg");
  // Someone without an account: the report, then the way to ask for access.
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto(link);
  await expect(visitor).toHaveURL(/#\/r\/[a-f0-9]{32}$/);
  await expect(visitor.locator(".post-title")).toHaveText("The Saga of the Test Table");
  await expect(visitor.locator(".public-join")).toContainText("Join the battles.");
  await expect(visitor.locator(".public-join").getByRole("button", { name: "Request access" })).toBeVisible();
  if (process.env.E2E_SHOTS) await visitor.screenshot({ path: `${process.env.E2E_SHOTS}/public-report.png`, fullPage: true });
  await visitor.close();
  if (process.env.E2E_SHOTS) fs.writeFileSync(`${process.env.E2E_SHOTS}/report-card.jpg`, await card.body());
});

test("the app in Spanish", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("thorgrim-lang", "es"));
  await page.goto("/#/home");
  await expect(page.getByRole("button", { name: "Nueva partida" }).first()).toBeVisible();
  await expect(page.locator(".bottom-nav")).toContainText("Partidas");
  await page.goto("/#/club/events");
  await expect(page.getByRole("button", { name: /Organiza una noche de club o un torneo/ })).toBeVisible();
});

// Newer Chrome returns promises from scroll methods; asking used to blank the page.
test("asking Thorgrim when scrolling returns a promise", async ({ page }) => {
  await page.addInitScript(() => {
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<typeof scroll>) {
      scroll.apply(this, args);
      return Promise.resolve() as unknown as void;
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/ask");
  await page.getByRole("textbox").first().fill("How do Skaven play?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Test answer from the coach.").first()).toBeVisible();
  expect(errors).toEqual([]);
});
