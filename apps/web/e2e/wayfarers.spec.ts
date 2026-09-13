import { expect, test, type Page } from "@playwright/test";

/**
 * Wayfarers (docs/phase10.md §5): a Coastal Watch hotseat game asks every
 * settler for a castle after their second settlement and the castles show up
 * on the board; The Great Lake renders its lake and fishing grounds. Both are
 * driven through the accessible overlay buttons and the sr-only piece list.
 */

test.use({ reducedMotion: "reduce" });

async function acknowledgeHandoff(page: Page): Promise<void> {
  const ready = page.getByTestId("handoff-ready");
  if (await ready.isVisible().catch(() => false)) await ready.click();
}

async function startScenario(page: Page, id: string): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId(`scenario-${id}`);
  await expect(card).toBeVisible();
  await card.click();
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
}

test("Coastal Watch hotseat: setup with the castle prompt puts three castles on the board", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startScenario(page, "coastalWatch");

  // The raider track is on from the start; nobody has a castle yet.
  await expect(page.getByTestId("raider-counter")).toHaveText("Raiders 0/15");
  await expect(page.locator('[data-piece="castle"]')).toHaveCount(0);

  const vertices = page.locator('[data-testid^="target-vertex-"]');
  const order = ["Ada", "Bo", "Cy", "Cy", "Bo", "Ada"];
  for (const [i, name] of order.entries()) {
    await acknowledgeHandoff(page);
    await expect(page.getByTestId("banner")).toHaveText(`${name}: place a settlement`);
    await expect(vertices.first()).toBeAttached({ timeout: 15_000 });
    const n = await vertices.count();
    await vertices.nth(Math.floor(n / 3)).click({ force: true });
    if (i >= 3) {
      // docs/rules.md §15.5: after the second settlement the settler picks their castle.
      await expect(page.getByTestId("banner")).toHaveText("Choose the settlement that becomes your castle");
      const castles = page.locator('[data-target="castle"]');
      await expect(castles).toHaveCount(2);
      await castles.first().click({ force: true });
      await expect(page.getByTestId("log")).toContainText(`${name} raised a castle`);
    }
    await expect(page.getByTestId("banner")).toHaveText(`${name}: place a road`);
    const edges = page.locator('[data-testid^="target-edge-"]');
    await expect(edges.first()).toBeAttached();
    await edges.first().click({ force: true });
  }

  await expect(page.locator('[data-testid="board"] [data-piece="castle"]')).toHaveCount(3);
  await expect(page.getByTestId("castle-p1-ada")).toBeVisible();
  await expect(page.getByTestId("guards-p1-ada")).toHaveText("0/6 guards");
  await expect(page.getByTestId("log")).toContainText("setup complete");

  // The first turn: the guard button is offered (and explains itself) once the dice are rolled.
  await acknowledgeHandoff(page);
  await expect(page.getByTestId("banner")).toHaveText("Roll the dice");
  await page.getByTestId("roll").click();
  const hexes = page.locator('[data-testid^="target-hex-"]');
  if ((await hexes.count()) > 0) {
    await hexes.first().click({ force: true });
    const steal = page.locator('[data-testid^="steal-"]');
    if ((await steal.count()) > 0) await steal.first().click();
  }
  await expect(page.getByTestId("guard")).toBeAttached();
  expect(errors).toEqual([]);
});

test("The Great Lake hotseat: the lake and three fishing grounds are on the board, fish are counted", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startScenario(page, "greatLake");
  await expect(page.locator('[data-testid="board"] [data-piece="lake"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="board"] [data-piece="fishing-ground"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="board"] [data-piece="fishing-ground"]').first()).toContainText(/Fishing ground \d+ on/);
  await expect(page.getByTestId("fish-p1-ada")).toHaveText("0 fish");
  await expect(page.locator('[data-testid^="target-vertex-"]').first()).toBeAttached({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
