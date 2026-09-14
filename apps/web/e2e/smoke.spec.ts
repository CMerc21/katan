import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke test (docs/phase3.md §8): start a 3-player beginner game, complete
 * setup by clicking highlighted targets, roll, and end two turns. This
 * proves the interaction layer maps clicks to engine actions.
 */

test.use({ reducedMotion: "reduce" });

async function acknowledgeHandoff(page: Page): Promise<void> {
  const ready = page.getByTestId("handoff-ready");
  if (await ready.isVisible().catch(() => false)) await ready.click();
}

/** Get through a seven if one was rolled: move the robber, steal if offered. */
async function resolveSeven(page: Page): Promise<void> {
  const discard = page.getByTestId("discard-confirm");
  while (await discard.isVisible().catch(() => false)) {
    // Nobody can hold more than 7 cards this early, but stay robust.
    await page.getByRole("dialog").getByRole("button", { name: /^More /, disabled: false }).first().click();
  }
  const hexes = page.locator('[data-testid^="target-hex-"]');
  if ((await hexes.count()) > 0) {
    await hexes.first().click();
    const steal = page.locator('[data-testid^="steal-"]');
    if ((await steal.count()) > 0) await steal.first().click();
  }
}

test("3-player hotseat: setup by clicking, roll, end turn twice", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });

  // Auto-detection is gone, so a spec must pin its own preset: SwiftShader cannot
  // drive Medium's shadows at 2x inside the test budget (every other spec does this).
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "normal", sound: false, quality: "low", followTurns: false }));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  await page.getByTestId("board-beginner").click();
  await page.getByTestId("start").click();

  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId("handoff-ready")).toBeVisible();
  // Hidden information is not rendered before the handoff is acknowledged.
  await expect(page.getByTestId("hand")).toHaveCount(0);
  await acknowledgeHandoff(page);
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");

  // Setup: 3 players × 2 placements, each a settlement then a road.
  const order = ["Ada", "Bo", "Cy", "Cy", "Bo", "Ada"];
  for (const name of order) {
    await acknowledgeHandoff(page);
    await expect(page.getByTestId("banner")).toHaveText(`${name}: place a settlement`);
    const vertices = page.locator('[data-testid^="target-vertex-"]');
    await expect(vertices.first()).toBeAttached({ timeout: 15_000 }); // the diorama projects targets after its first frame
    const n = await vertices.count();
    expect(n).toBeGreaterThan(0);
    await vertices.nth(Math.floor(n / 3)).click();
    await expect(page.getByTestId("banner")).toHaveText(`${name}: place a road`);
    const edges = page.locator('[data-testid^="target-edge-"]');
    await expect(edges.first()).toBeAttached();
    await edges.first().click();
  }

  // Pieces are on the board: 6 settlements and 6 roads.
  await expect(page.locator('[data-testid="board"] [data-piece="settlement"]')).toHaveCount(6);
  await expect(page.locator('[data-testid="board"] [data-piece="road"]')).toHaveCount(6);
  await expect(page.getByTestId("log")).toContainText("setup complete");

  // Two full turns.
  for (const name of ["Ada", "Bo"]) {
    await acknowledgeHandoff(page);
    await expect(page.getByTestId("banner")).toHaveText("Roll the dice");
    await expect(page.getByTestId("player-row-" + (name === "Ada" ? "p1-ada" : "p2-bo"))).toHaveAttribute("aria-current", "true");
    await page.getByTestId("roll").click();
    await expect(page.getByTestId("log")).toContainText(`${name} rolled`);
    await resolveSeven(page);
    await expect(page.getByTestId("end-turn")).toBeEnabled();
    await page.getByTestId("end-turn").click();
  }
  await acknowledgeHandoff(page);
  await expect(page.getByTestId("banner")).toHaveText("Roll the dice");
  await expect(page.getByTestId("player-row-p3-cy")).toHaveAttribute("aria-current", "true");

  expect(errors).toEqual([]);
});

test("/play without a game redirects to /", async ({ page }) => {
  await page.goto("/play");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("start")).toBeVisible();
});
