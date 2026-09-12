import { expect, test } from "@playwright/test";

/**
 * The board editor (docs/phase8.md §4, §7): paint a 12-hex island with the
 * frame and terrain tools, auto-fill tokens and harbours, save it as a draft
 * on this device, pick it in the hotseat form, and place the first
 * settlement on it.
 */

test.use({ reducedMotion: "reduce" });

const TERRAINS = ["forest", "meadow", "farmland", "claypit", "mountain", "wasteland"] as const;

/** A 4×3 parallelogram of cells around the origin (all within the editor's starting grid). */
const CELLS: { q: number; r: number }[] = [];
for (let r = -1; r <= 1; r++) for (let c = 0; c < 4; c++) CELLS.push({ q: c - 1 - Math.floor((r + 1) / 2), r });

test("paint an island, auto-fill, save a draft, then play it hotseat", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });

  await page.goto("/boards/editor");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("editor-canvas")).toBeVisible();
  const cell = (c: { q: number; r: number }) => page.getByTestId(`cell-${c.q},${c.r}`);
  await expect(cell({ q: 0, r: 0 })).toBeAttached({ timeout: 15_000 }); // projected after the first frame

  await page.getByTestId("board-name").fill("Isle test");

  // Frame tool: one click turns an empty cell into land.
  for (const c of CELLS) await cell(c).click({ force: true });
  for (const c of CELLS) await expect(cell(c)).toHaveAttribute("data-kind", "land");
  await expect(page.getByTestId("board-stats")).toContainText("12 land");

  // Terrain tool: two of each terrain.
  await page.getByTestId("tool-terrain").click();
  for (const [i, c] of CELLS.entries()) {
    const t = TERRAINS[i % TERRAINS.length]!;
    await page.getByTestId(`terrain-${t}`).click();
    await cell(c).click({ force: true });
    await expect(cell(c)).toHaveAttribute("data-terrain", t);
  }

  // Auto tokens: every producing hex gets a fixed token, wastelands none.
  await page.getByTestId("tool-token").click();
  await page.getByTestId("auto-tokens").click();
  for (const [i, c] of CELLS.entries()) {
    const t = TERRAINS[i % TERRAINS.length]!;
    if (t === "wasteland") await expect(cell(c)).toHaveAttribute("data-token", "");
    else await expect(cell(c)).toHaveAttribute("data-token", /^(2|3|4|5|6|8|9|10|11|12)$/);
  }

  // Auto harbours cover the coast; the board then validates and can be saved.
  await page.getByTestId("tool-harbor").click();
  await page.getByTestId("auto-harbors").click();
  await expect(page.getByTestId("validation")).not.toContainText("Error");
  await expect(page.getByTestId("save")).toBeEnabled();
  await page.getByTestId("save").click();
  await expect(page.getByTestId("editor-toast")).toHaveText("Saved on this device");
  await expect(page).toHaveURL(/\/boards\/editor\/draft-/);

  // The draft is listed on /boards and offered by the hotseat picker.
  await page.goto("/boards");
  await expect(page.getByText("Isle test").first()).toBeVisible();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const draftCard = page.locator('[data-testid^="board-draft-"]').first();
  await expect(draftCard).toBeVisible();
  await expect(draftCard.getByTestId("board-card-name")).toHaveText("Isle test");
  await expect(draftCard).toHaveAttribute("data-seats", "4");
  await draftCard.click();
  await expect(draftCard).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  await page.getByTestId("start").click();

  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
  const vertices = page.locator('[data-testid^="target-vertex-"]');
  await expect(vertices.first()).toBeAttached({ timeout: 15_000 });
  // A 12-hex island has far fewer vertices than the standard 54.
  expect(await vertices.count()).toBeLessThan(54);
  await vertices.first().click({ force: true });
  await expect(page.locator('[data-piece="settlement"]')).toHaveCount(1);
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a road");

  expect(errors).toEqual([]);
});
