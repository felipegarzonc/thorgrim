// The turn tracker at the table: starting rounds, moving between turns and
// rounds from any phase, a second phone following, and playing with no signal.

import { expect, test, type Page } from "@playwright/test";

/** A new game with both names set, opened on round 1. Returns the game's URL. */
async function newGame(page: Page, opponent = "Diego"): Promise<string> {
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New game" }).first().click();
  await expect(page).toHaveURL(/#\/games\/[a-z0-9]+\/players/);
  const url = page.url().replace(/\/players$/, "");
  await page.getByPlaceholder("Your name").fill("Goy");
  await page.getByPlaceholder("Opponent's name").fill(opponent);
  await page.getByPlaceholder("Opponent's name").blur();
  await page.goto(`${url}/round-1`);
  return url;
}

/** Everything on this phone has reached the server. */
const saved = (page: Page) => expect(page.locator(".sync-badge.saved")).toBeVisible();
const first = (page: Page, who: "You" | "Opponent") => page.getByRole("group", { name: "First turn" }).getByRole("button", { name: who }).click();
const tags = (page: Page) => page.locator(".score-card .turn-tag").allInnerTexts();
const fury = (page: Page) => page.locator(".score-card").evaluateAll((cards) => cards.map((c) => c.querySelectorAll(".flame.on").length));

test("the attacker sets the starting fury, and the round starts when someone goes first", async ({ page }) => {
  await newGame(page);
  const attacker = page.getByRole("group", { name: "Attacker", exact: true });
  await attacker.getByRole("button", { name: "Opponent" }).click();
  await expect.poll(() => fury(page)).toEqual([2, 1]);
  // Picking one doesn't resize or move the control.
  const box = await attacker.boundingBox();
  await attacker.getByRole("button", { name: "You" }).click();
  await expect.poll(() => fury(page)).toEqual([1, 2]);
  expect(await attacker.boundingBox()).toEqual(box);

  await expect(page.locator(".turn-card")).toHaveCount(0);
  await expect(page.locator(".round-start")).toContainText("Start round 1");
  await first(page, "You");
  await expect(page.locator(".turn-card")).toBeVisible();
  await expect(page.locator(".turn-label")).toContainText("Turn 1 · Your turn");
});

test("phases only show the plan; a turn or round ends from any phase", async ({ page }) => {
  const url = await newGame(page);
  await first(page, "You");
  const current = page.locator(".phase-chips [aria-current=step]");
  await expect(current).toHaveText("Start");
  await expect(page.getByRole("button", { name: /^Next: / })).toHaveCount(0);

  // Looking at another phase's plan changes nothing else.
  await page.locator(".phase-chips").getByRole("button", { name: "Shoot" }).click();
  await expect(current).toHaveText("Shoot");
  await expect(page.locator(".turn-label")).toContainText("Turn 1 · Your turn");

  // End the turn without walking through the phases.
  const end = page.locator("#end-turn");
  await expect(end).toHaveText(/End turn → Diego/);
  await end.click();
  await expect(page.locator(".turn-label")).toContainText("Turn 2 · Diego's turn");
  await expect(current).toHaveText("Start");

  // End the round from the first phase: on to round 2, which waits for priority.
  await expect(end).toHaveText(/End round → Round 2/);
  await end.click();
  await expect(page).toHaveURL(`${url}/round-2`);
  await expect(page.locator(".round-start")).toContainText("Start round 2");
  await expect(page.locator(".turn-card")).toHaveCount(0);
  await page.getByRole("group", { name: "Priority" }).getByRole("button", { name: "Opponent" }).click();
  await first(page, "Opponent");
  await expect(page.locator(".turn-label")).toContainText("Turn 1 · Diego's turn");
});

test("tapping the waiting player's card makes it their turn", async ({ page }) => {
  await newGame(page);
  await first(page, "You");
  expect(await tags(page)).toEqual(["YOUR TURN", "WAITING · TAP"]);
  await page.getByRole("button", { name: "Make it Diego's turn" }).click();
  await expect.poll(() => tags(page)).toEqual(["WAITING · TAP", "THEIR TURN"]);
  await expect(page.locator(".turn-label")).toContainText("Turn 2 · Diego's turn");
  await page.getByRole("button", { name: "Make it your turn" }).click();
  await expect.poll(() => tags(page)).toEqual(["YOUR TURN", "WAITING · TAP"]);
  await expect(page.locator(".turn-label")).toContainText("Turn 1 · Your turn");
});

test("five rounds played through to the results", async ({ page }) => {
  const url = await newGame(page);
  for (let n = 1; n <= 5; n++) {
    await expect(page).toHaveURL(`${url}/round-${n}`);
    if (n > 1) await page.getByRole("group", { name: "Priority" }).getByRole("button", { name: "You" }).click();
    await first(page, "You");
    await page.locator("#end-turn").click();
    await expect(page.locator(".turn-label")).toContainText("Turn 2");
    if (n === 5) await expect(page.locator("#end-turn")).toHaveText(/End game → Results/);
    await page.locator("#end-turn").click();
  }
  await expect(page).toHaveURL(`${url}/results`);
});

test("a second phone follows to the next round", async ({ page, context }) => {
  const url = await newGame(page);
  await first(page, "You");
  await saved(page);
  // Phones only watch for each other's changes in a game that has a join link.
  expect((await page.request.post(`/api/games/${url.split("/").pop()}/share`)).ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".turn-card")).toBeVisible();
  const other = await context.newPage();
  await other.goto(`${url}/round-1`);
  await expect(other.locator(".turn-card")).toBeVisible();

  await page.locator("#end-turn").click();
  await page.locator("#end-turn").click();
  await expect(page).toHaveURL(`${url}/round-2`);
  await page.getByRole("group", { name: "Priority" }).getByRole("button", { name: "You" }).click();
  await first(page, "You");
  // The other phone moves once round 2 has started.
  await expect(other).toHaveURL(`${url}/round-2`, { timeout: 20_000 });
  await expect(other.locator(".turn-label")).toContainText("Turn 1 · Your turn");
});

test("with no signal the game opens from this phone's copy and syncs later", async ({ page, context }) => {
  const url = await newGame(page);
  await page.goto(`${url}/battleplan`);
  await page.getByRole("radio", { name: /Into the Fire/ }).click();
  await page.goto(`${url}/round-1`);
  await first(page, "You");
  await expect(page.locator(".turn-card")).toBeVisible();
  const id = url.split("/").pop()!;
  await saved(page);

  await context.setOffline(true);
  await page.evaluate(() => (location.hash = "#/home"));
  await page.evaluate((id) => (location.hash = `#/games/${id}/round-1`), id);
  await expect(page.locator(".turn-card")).toBeVisible();
  await expect(page.locator(".sync-badge").first()).toContainText("Offline");
  // Score while offline.
  await page.locator(".side-block").first().getByText("Control at least 1 objective").click();
  await expect(page.locator(".game-head-title")).toContainText("Goy vs Diego");
  const scored = (await page.locator(".game-head-title").innerText()).match(/^(\d+)-/)![1];
  expect(Number(scored)).toBeGreaterThan(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // The server has the score once it syncs.
  await expect
    .poll(async () => ((await (await page.request.get(`/api/games/${id}`)).json()) as { state: { vp: { me: number } } }).state.vp.me, { timeout: 20_000 })
    .toBe(Number(scored));
});

test("undo takes back the last change, one at a time", async ({ page }) => {
  await newGame(page);
  const undo = page.getByRole("button", { name: "Undo the last change" });
  await first(page, "You");
  await expect(page.locator(".turn-card")).toBeVisible();
  // End the turn by mistake, then take it back.
  await page.locator("#end-turn").click();
  await expect(page.locator(".turn-label")).toContainText("Turn 2 · Diego's turn");
  await undo.click();
  await expect(page.locator(".turn-label")).toContainText("Turn 1 · Your turn");
  // Once more: the round hasn't started. The names set before still stand.
  await undo.click();
  await expect(page.locator(".turn-card")).toHaveCount(0);
  await expect(page.locator(".round-start")).toContainText("Start round 1");
  await expect(page.locator(".game-head-title")).toContainText("Goy vs Diego");
  await saved(page);
});

test("a plan every turn can be turned off on this phone", async ({ page }) => {
  await newGame(page);
  await first(page, "You");
  // On by default: the plan comes by itself.
  await expect(page.locator(".tips-headline")).toBeVisible();
  await page.getByRole("switch", { name: "A plan every turn: on" }).click();
  await page.locator("#end-turn").click();
  await expect(page.locator(".turn-label")).toContainText("Turn 2");
  // Off: nothing is asked for until the player wants it.
  await page.waitForTimeout(2500);
  await expect(page.locator(".tips-headline")).toHaveCount(0);
  await page.getByRole("button", { name: "Get the plan for this turn" }).click();
  await expect(page.locator(".tips-headline")).toBeVisible();
});
