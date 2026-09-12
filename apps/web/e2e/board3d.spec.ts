import { expect, test, type Page } from "@playwright/test";

/**
 * The diorama board (docs/phase7-5.md §9): it renders under WebGL, a legal
 * vertex is clickable both through the raycast layer and the accessible
 * overlay, and a bot turn animates within the Phase 7 budget.
 */

test.use({ reducedMotion: "no-preference" });

async function startGame(page: Page, speed: "normal" | "off", bots = 0): Promise<void> {
  await page.addInitScript((s) => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: s, sound: false, quality: "low", followTurns: false }));
  }, speed);
  await page.goto("/hotseat");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  for (let i = 1; i <= bots; i++) await page.getByTestId(`kind-${i}`).selectOption("easy");
  await page.getByTestId("board-beginner").click();
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
}

test("renders the diorama and a vertex click dispatches BUILD_SETTLEMENT", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startGame(page, "off");
  const board = page.getByTestId("board3d");
  await expect(board).toBeVisible();
  await expect(board.locator("canvas")).toBeVisible();
  await expect(board).toHaveAttribute("data-quality", "low");
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");

  // Overlay buttons exist for exactly the legal vertices (54 on an empty beginner board).
  const vertices = page.locator('[data-testid^="target-vertex-"]');
  await expect(vertices).toHaveCount(54, { timeout: 15_000 });

  // Raycast path: with the overlay buttons inert, a click on the canvas at a vertex's position goes through the 3D layer.
  const target = vertices.nth(20);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-testid^="target-"]').forEach((b) => (b.style.pointerEvents = "none")));
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a road");
  // A setup road must touch the new settlement: 2 edges on the coast, 3 inland.
  await expect.poll(() => page.locator('[data-testid^="target-edge-"]').count()).toBeGreaterThanOrEqual(2);
  expect(await page.locator('[data-testid^="target-edge-"]').count()).toBeLessThanOrEqual(3);

  // Overlay path: the accessible button dispatches the road.
  await page.locator('[data-testid^="target-edge-"]').first().click();
  await expect(page.getByTestId("banner")).toHaveText("Bo: place a settlement");
  await expect(page.getByTestId("log")).toContainText("Ada built a road");
  expect(errors).toEqual([]);
});

test("a bot turn animates within the Phase 7 budget on the 3D board", async ({ page }) => {
  await startGame(page, "normal", 2);
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
  const vertices = page.locator('[data-testid^="target-vertex-"]');
  await expect(vertices).toHaveCount(54, { timeout: 15_000 });
  await vertices.nth(18).click({ force: true });
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a road");
  const t0 = Date.now();
  await page.locator('[data-testid^="target-edge-"]').first().click({ force: true });
  // Two bots place both rounds (8 placements): between 2 and 8 s per bot turn.
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement", { timeout: 60_000 });
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeGreaterThan(2 * 2000);
  expect(elapsed).toBeLessThan(2 * 8000 + 6000);
  await expect(page.getByTestId("dice-tray")).toHaveCount(0);
});

test("reset view and settings menu graphics options are present", async ({ page }) => {
  await startGame(page, "off");
  await expect(page.getByTestId("reset-view")).toBeVisible();
  await page.getByTestId("reset-view").click();
  await page.getByTestId("settings").click();
  await expect(page.getByTestId("quality-auto")).toBeVisible();
  await page.getByTestId("quality-medium").click();
  await expect(page.getByTestId("board3d")).toHaveAttribute("data-quality", "medium");
});
