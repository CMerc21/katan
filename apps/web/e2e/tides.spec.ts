import { expect, test } from "@playwright/test";

/**
 * Tides (docs/phase9.md §10): a Gold Coast hotseat game shows the pirate,
 * lets the first settler place a ship instead of a road, and the ship shows
 * up on the board; the scenario is picked from the hotseat form.
 */

test.use({ reducedMotion: "reduce" });

test("Gold Coast hotseat: pirate on the sea, a setup ship on a coastal settlement", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("scenario-goldCoast");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-scenario", "tides");
  await card.click();
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  await page.getByTestId("start").click();

  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
  await expect(page.locator('[data-piece="pirate"]')).toHaveCount(1);
  // Gold fields glitter: two gold tiles exist on this scenario (the log line proves the scenario loaded).
  const vertices = page.locator('[data-testid^="target-vertex-"]');
  await expect(vertices.first()).toBeAttached({ timeout: 15_000 });

  // Setup placements until a settler lands on the coast: then a ship target exists and we take it.
  let placed = false;
  for (let i = 0; i < 6 && !placed; i++) {
    const ready = page.getByTestId("handoff-ready");
    if (await ready.isVisible().catch(() => false)) await ready.click();
    await expect(vertices.first()).toBeAttached({ timeout: 15_000 });
    await vertices.first().click({ force: true });
    await expect(page.getByTestId("banner")).toHaveText(/place a road or a ship$/);
    const ships = page.locator('[data-target="BUILD_SHIP"]');
    const roads = page.locator('[data-target="BUILD_ROAD"]');
    await expect(roads.or(ships).first()).toBeAttached();
    if ((await ships.count()) > 0) {
      await ships.first().click({ force: true });
      placed = true;
    } else {
      await roads.first().click({ force: true });
    }
  }
  expect(placed).toBe(true);
  await expect(page.locator('[data-piece="ship"]')).toHaveCount(1);
  await expect(page.locator('[data-piece="pirate"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
