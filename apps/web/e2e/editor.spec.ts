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

/**
 * Wayfarers markers (docs/phase10.md §8, §9): on the standard template lay a
 * river on an inland edge, a fishing ground with a token on a coastal edge
 * and an oasis on a hex, switch on the Rivers, Fishing and Caravans
 * variants, save the scenario as a draft and find it in the hotseat picker
 * with its summary.
 */
test.describe("wayfarers-editor", () => {
  test("mark a river, a fishing ground and an oasis, turn on variants, save a draft, see it in the picker", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
    });

    await page.goto("/boards/editor/random");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.getByTestId("cell-0,0")).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId("board-stats")).toContainText("19 land");
    await page.getByTestId("board-name").fill("Marsh test");

    // River tool: every land edge is a target; an inland edge takes a segment.
    await page.getByTestId("tool-river").click();
    const inland = page.getByTestId("edge-0,0|1,0");
    await expect(inland).toBeAttached({ timeout: 15_000 });
    await expect(inland).toHaveAttribute("data-river", "");
    await inland.click({ force: true });
    await expect(inland).toHaveAttribute("data-river", "true");
    await expect(page.getByTestId("board-stats")).toContainText("1 river");
    await expect(page.getByTestId("inspector-river")).toBeChecked();

    // Fishing tool: only coastal edges are targets; the first click places the default token, the inspector re-numbers it.
    await page.getByTestId("tool-fishing").click();
    await expect(inland).toHaveCount(0);
    const coast = page.getByTestId("edge-2,0|3,0");
    await expect(coast).toBeAttached({ timeout: 15_000 });
    await coast.click({ force: true });
    await expect(coast).toHaveAttribute("data-fishing", "5");
    await page.getByTestId("fishing-token-input").fill("8");
    await page.getByTestId("fishing-token-input").press("Enter");
    await expect(coast).toHaveAttribute("data-fishing", "8");
    await expect(page.getByTestId("board-stats")).toContainText("1 fishing ground");

    // Oasis tool: a land hex takes the marker.
    await page.getByTestId("tool-oasis").click();
    await page.getByTestId("cell-0,0").click({ force: true });
    await expect(page.getByTestId("cell-0,0")).toHaveAttribute("data-oasis", "true");
    await expect(page.getByTestId("board-stats")).toContainText("1 oasis");

    // Scenario: variants on; markers now matter and the summary names them.
    await page.getByTestId("scenario-on").click();
    await page.getByTestId("scenario-tides").uncheck();
    await page.getByTestId("scenario-variant-rivers").check();
    await page.getByTestId("scenario-variant-fishing").check();
    await page.getByTestId("scenario-variant-caravans").check();
    await expect(page.getByTestId("scenario-summary")).toHaveText("Fishing · Rivers · Caravans · 10 points to win");
    await expect(page.getByTestId("rules-rivers")).toContainText("bridge");
    await expect(page.getByTestId("validation")).toContainText("three oases");
    await expect(page.getByTestId("validation")).not.toContainText("Error");
    // Raiders and Crown & Castle exclude each other.
    await page.getByTestId("scenario-variant-raiders").check();
    await page.getByTestId("scenario-crown").check();
    await expect(page.getByTestId("scenario-variant-raiders")).not.toBeChecked();
    await page.getByTestId("scenario-crown").uncheck();
    await expect(page.getByTestId("scenario-summary")).toHaveText("Fishing · Rivers · Caravans · 10 points to win");

    await expect(page.getByTestId("save")).toBeEnabled();
    await page.getByTestId("save").click();
    await expect(page.getByTestId("editor-toast")).toHaveText("Scenario saved on this device");
    await expect(page).toHaveURL(/\/boards\/editor\/sdraft-/);

    // Reloading the draft keeps the markers and the switches.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("board-stats")).toContainText("1 river · 1 fishing ground · 1 oasis");
    await expect(page.getByTestId("scenario-variant-caravans")).toBeChecked();

    // The hotseat picker lists the draft with its summary.
    await page.goto("/boards");
    await expect(page.getByText("Marsh test").first()).toBeVisible();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const draftCard = page.locator('[data-testid^="scenario-draft-"]').first();
    await expect(draftCard).toBeVisible();
    await expect(draftCard.getByTestId("board-card-name")).toContainText("Marsh test");
    await expect(draftCard).toHaveAttribute("data-scenario", "wayfarers");
    await expect(draftCard).toContainText("Fishing · Rivers · Caravans · 10 points to win");
    await draftCard.click();
    await expect(draftCard).toHaveAttribute("aria-checked", "true");

    expect(errors).toEqual([]);
  });
});
