import { expect, test } from "@playwright/test";
import { BUILT_IN_SCENARIO_IDS } from "@katan/engine";

/**
 * Every built-in scenario (docs/phase9.md, docs/phase10.md §8, docs/phase11.md)
 * starts from the hotseat picker with three players and reaches the first
 * setup placement: the setup banner shows and a settlement can be placed
 * through the overlay. The module-specific play is covered elsewhere; this
 * only proves each scenario loads and the board interacts.
 */

test.use({ reducedMotion: "reduce" });

for (const id of BUILT_IN_SCENARIO_IDS) {
  test(`${id}: a 3-player hotseat game starts and the first settlement goes down`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId(`scenario-${id}`);
    await expect(card).toBeVisible();
    await expect(card).toBeEnabled();
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("count-3").click();
    await page.getByTestId("name-0").fill("Ada");
    await page.getByTestId("start").click();

    await expect(page).toHaveURL(/\/play$/);
    await page.getByTestId("handoff-ready").click();
    await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
    const vertices = page.locator('[data-testid^="target-vertex-"]');
    await expect(vertices.first()).toBeAttached({ timeout: 15_000 });
    await vertices.first().click({ force: true });
    await expect(page.locator('[data-piece="settlement"]')).toHaveCount(1);
    await expect(page.getByTestId("banner")).toHaveText(/^Ada: place a road/);

    expect(errors).toEqual([]);
  });
}
