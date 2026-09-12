import { expect, test, type Page } from "@playwright/test";

/**
 * Bot pacing (docs/phase7.md §3, §8): with three bots and one human on the
 * Normal setting a bot's turn is watchable (2–8 s); on Off it is instant.
 * The hotseat driver applies every bot action at once, so the whole wait is
 * the client-side animation queue.
 */

async function startVsBots(page: Page, speed: "normal" | "off"): Promise<void> {
  await page.addInitScript((s) => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: s, sound: false, quality: "low", followTurns: false }));
  }, speed);
  await page.goto("/hotseat");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("count-4").click();
  await page.getByTestId("name-0").fill("Ada");
  for (const i of [1, 2, 3]) await page.getByTestId(`kind-${i}`).selectOption("easy");
  await page.getByTestId("board-beginner").click();
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
}

/** Ada places her first settlement and road; then three bots place twice each before the device returns to her. */
async function adaFirstPlacement(page: Page): Promise<number> {
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
  const vertices = page.locator('[data-testid^="target-vertex-"]');
  await vertices.nth(Math.floor((await vertices.count()) / 3)).click({ force: true });
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a road");
  const t0 = Date.now();
  await page.locator('[data-testid^="target-edge-"]').first().click({ force: true });
  // The queue drains the bots' twelve placements, then Ada is back for her second settlement.
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement", { timeout: 60_000 });
  return Date.now() - t0;
}

test("bots take visible, paced turns on Normal and are instant on Off", async ({ page }) => {
  await startVsBots(page, "normal");
  const elapsed = await adaFirstPlacement(page);
  // Twelve bot placements with thinking pauses: at least 2 s per bot turn, comfortably under 8 s each.
  expect(elapsed).toBeGreaterThan(3 * 2000);
  expect(elapsed).toBeLessThan(3 * 8000 + 6000);
  await expect(page.locator('[data-testid="board"] [data-piece="settlement"]')).toHaveCount(7);
  // Bot names are generated, with the level as a separate badge.
  const badge = page.locator('[data-testid^="bot-badge-"]').first();
  await expect(badge).toHaveText("easy");
  const rows = page.locator('[data-testid^="player-row-"]');
  const text = await rows.allInnerTexts();
  expect(text.join(" ")).not.toMatch(/Bot \(/);
});

test("Off restores instant bot play", async ({ page }) => {
  await startVsBots(page, "off");
  const elapsed = await adaFirstPlacement(page);
  expect(elapsed).toBeLessThan(1500);
  await expect(page.locator('[data-testid="board"] [data-piece="settlement"]')).toHaveCount(7);
});

test("skip fast-forwards a draining queue", async ({ page }) => {
  await startVsBots(page, "normal");
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
  const vertices = page.locator('[data-testid^="target-vertex-"]');
  await vertices.nth(Math.floor((await vertices.count()) / 3)).click({ force: true });
  const t0 = Date.now();
  await page.locator('[data-testid^="target-edge-"]').first().click({ force: true });
  await expect(page.getByTestId("skip")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement", { timeout: 30_000 });
  expect(Date.now() - t0).toBeLessThan(6000);
});
