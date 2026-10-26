// Army lists: save an opponent's list for someone, change it later, and find
// it first when playing that opponent.

import { expect, test } from "@playwright/test";

test("edit a list and keep it for an opponent", async ({ page }) => {
  await page.goto("/#/lists");
  await page.getByPlaceholder("e.g. Stonehorn Beastclaw 2k").fill("Diego's Sylvaneth");
  await page.getByLabel("Whose list").selectOption("opponent");
  await page.getByPlaceholder("A club member or any name").fill("Diego");
  await page.getByLabel("Faction (auto-detected if blank)").selectOption({ index: 1 });
  await page.locator("textarea").fill("Spirit of Durthu (380)\n• General\nKurnoth Hunters (220)");
  await page.getByRole("button", { name: "Save list" }).click();
  await expect(page).toHaveURL(/#\/lists\/[a-z0-9]+$/);
  await expect(page.locator(".card").first()).toContainText("Opponent list · Diego");

  // Change it: a new name, and it stays Diego's.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByPlaceholder("A club member or any name")).toHaveValue("Diego");
  await page.getByPlaceholder("e.g. Stonehorn Beastclaw 2k").fill("Diego's Wyldwood");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".card").first()).toContainText("Diego's Wyldwood");
  await expect(page.locator(".list-entry", { hasText: "Diego's Wyldwood" })).toContainText("Diego");
  await expect(page.locator(".list-entry", { hasText: "Diego's Sylvaneth" })).toHaveCount(0);

  // Playing Diego: his list comes first for the opponent.
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New game" }).first().click();
  await expect(page).toHaveURL(/players/);
  await page.getByPlaceholder("Opponent's name").fill("Diego");
  await page.getByPlaceholder("Opponent's name").blur();
  const theirs = page.getByLabel("Opponent's army list");
  await expect(theirs.locator("option").nth(1)).toHaveText(/Diego's Wyldwood .* · Diego/);
});
