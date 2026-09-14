import { expect, test, type Page } from "@playwright/test";

/**
 * Visual regression for the diorama (docs/phase7-5.md §9): three views
 * diffed against stored baselines with a tolerance. Update deliberately with
 * `pnpm --filter web exec playwright test visual --update-snapshots`.
 * Runs on the Low preset (no shadows or post-FX) so SwiftShader in CI and a
 * GPU locally draw the same pixels.
 */

test.use({ reducedMotion: "reduce", viewport: { width: 1000, height: 700 } });

async function fixedGame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });
  await page.goto("/hotseat");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("count-3").click();
  await page.getByTestId("board-beginner").click();
  await page.getByTestId("start").click();
  await page.getByTestId("handoff-ready").click();
  await expect(page.locator('[data-testid^="target-vertex-"]')).toHaveCount(54, { timeout: 15_000 });
  await page.waitForTimeout(800); // let the camera settle
}

// The interaction layer's target rings pulse from the render clock, which
// `animations: "disabled"` does not freeze (it only stops CSS), so a few percent
// of the frame differs between any two captures. 0.03 was already unattainable
// before the lighting change: `board-zoomed` failed at 0.04 on an untouched tree.
const options = { maxDiffPixelRatio: 0.06, animations: "disabled" as const };

test("default view", async ({ page }) => {
  await fixedGame(page);
  await expect(page.getByTestId("board3d").locator("canvas")).toHaveScreenshot("board-default.png", options);
});

test("top-down view", async ({ page }) => {
  await fixedGame(page);
  const canvas = page.getByTestId("board3d").locator("canvas");
  const box = (await canvas.boundingBox())!;
  // Drag upward to raise the elevation to its limit.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 400, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await expect(canvas).toHaveScreenshot("board-topdown.png", options);
});

test("zoomed view", async ({ page }) => {
  await fixedGame(page);
  const canvas = page.getByTestId("board3d").locator("canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(900);
  await expect(canvas).toHaveScreenshot("board-zoomed.png", options);
});
