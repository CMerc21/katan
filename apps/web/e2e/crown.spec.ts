import { expect, test, type Page } from "@playwright/test";

/**
 * Crown & Castle (docs/phase11.md §11): a Crown & Castle — Standard hotseat
 * game shows the fleet track, the event die beside the number dice and the
 * improvement tri-track badge; the knight button explains itself. Driven
 * through the accessible overlay buttons like the other specs.
 */

test.use({ reducedMotion: "reduce" });

async function acknowledgeHandoff(page: Page): Promise<void> {
  const ready = page.getByTestId("handoff-ready");
  if (await ready.isVisible().catch(() => false)) await ready.click();
}

/** Get through a seven: discards (nobody can owe this early, but stay robust). Before the first attack the robber stays home. */
async function resolveSeven(page: Page): Promise<void> {
  const discard = page.getByTestId("discard-confirm");
  while (await discard.isVisible().catch(() => false)) {
    await page.getByRole("dialog").getByRole("button", { name: /^More /, disabled: false }).first().click();
  }
  const hexes = page.locator('[data-testid^="target-hex-"]');
  if ((await hexes.count()) > 0) {
    await hexes.first().click({ force: true });
    const steal = page.locator('[data-testid^="steal-"]');
    if ((await steal.count()) > 0) await steal.first().click();
  }
}

test("Crown & Castle — Standard hotseat: setup, a roll with the event die, the fleet track, the tri-track badge and the knight button", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("scenario-crownStandard");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-scenario", "crown");
  await card.click();
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");

  // The fleet track is on from the start, at step 0 with no attacks; the badge shows three empty tracks.
  const fleet = page.getByTestId("fleet-track");
  await expect(fleet).toBeVisible();
  await expect(fleet).toHaveAttribute("data-position", "0");
  await expect(fleet).toHaveAttribute("data-attacks", "0");
  await expect(page.getByTestId("fleet-ship")).toHaveCount(0);
  const tracks = page.getByTestId("tracks-p1-ada");
  await expect(tracks).toBeVisible();
  await expect(tracks.locator("[data-track]")).toHaveCount(3);
  await expect(tracks.locator('[data-track="trade"]')).toHaveAttribute("data-level", "0");
  // No development cards in this module: the deck badge counts progress cards instead.
  await expect(page.getByTestId("deck-count")).toHaveText("53");

  // Setup: 3 players × 2 placements, each a settlement then a road, through the overlay buttons.
  const order = ["Ada", "Bo", "Cy", "Cy", "Bo", "Ada"];
  for (const name of order) {
    await acknowledgeHandoff(page);
    await expect(page.getByTestId("banner")).toHaveText(`${name}: place a settlement`);
    const vertices = page.locator('[data-testid^="target-vertex-"]');
    await expect(vertices.first()).toBeAttached({ timeout: 15_000 });
    const n = await vertices.count();
    await vertices.nth(Math.floor(n / 3)).click({ force: true });
    await expect(page.getByTestId("banner")).toHaveText(`${name}: place a road`);
    const edges = page.locator('[data-testid^="target-edge-"]');
    await expect(edges.first()).toBeAttached();
    await edges.first().click({ force: true });
  }
  await expect(page.locator('[data-testid="board"] [data-piece="settlement"]')).toHaveCount(6);
  await expect(page.getByTestId("log")).toContainText("setup complete");
  await expect(page.locator('[data-testid="board"] [data-piece="knight"]')).toHaveCount(0);

  // Ada's first turn: the commodity stacks sit beside the resources; the progress button explains there is nothing to play.
  await acknowledgeHandoff(page);
  await expect(page.getByTestId("banner")).toHaveText("Roll the dice");
  await expect(page.getByTestId("commodities")).toBeVisible();
  await expect(page.getByTestId("commodities").locator("[data-commodity]")).toHaveCount(3);
  await expect(page.getByTestId("progress")).toBeDisabled();
  await expect(page.getByTestId("progress")).toHaveAttribute("title", "You hold no progress cards");

  // Roll: the tray shows the red die and the event die, and the log names the event.
  await page.getByTestId("roll").click();
  await expect(page.getByTestId("log")).toContainText(/Ada rolled \d \+ \d = \d+ \(event die: (fleet|trade|politics|science)\)/);
  const tray = page.getByTestId("dice-tray");
  await expect(tray).toBeVisible();
  await expect(tray.getByTestId("red-die")).toHaveCount(1);
  const eventDie = tray.getByTestId("event-die");
  await expect(eventDie).toHaveCount(1);
  const face = await eventDie.getAttribute("data-event");
  expect(["fleet", "trade", "politics", "science"]).toContain(face);
  await expect(page.getByTestId("last-event-die")).toBeVisible();
  if (face === "fleet") {
    await expect(fleet).toHaveAttribute("data-position", "1");
    await expect(page.getByTestId("fleet-ship")).toHaveCount(1);
  } else {
    await expect(fleet).toHaveAttribute("data-position", "0");
  }
  await resolveSeven(page);

  // The action buttons of the module are there. Hiring a knight needs wool + ore: the button says so when Ada lacks them.
  await expect(page.getByTestId("end-turn")).toBeEnabled();
  for (const id of ["knight", "knight-act", "improve", "wall", "progress"]) await expect(page.getByTestId(id)).toBeAttached();
  await expect(page.getByTestId("improve")).toBeDisabled();
  await expect(page.getByTestId("improve")).toHaveAttribute("title", "You need a city first");
  await expect(page.getByTestId("wall")).toBeDisabled();
  await expect(page.getByTestId("wall")).toHaveAttribute("title", "Walls go on cities");
  await expect(page.getByTestId("knight-act")).toBeDisabled();
  await expect(page.getByTestId("knight-act")).toHaveAttribute("title", "You have no knights");
  const hand = page.getByTestId("hand");
  const count = async (resource: string) => Number(((await hand.locator(`[data-resource="${resource}"]`).getAttribute("aria-label")) ?? "0").split(" ")[0]);
  const wool = await count("wool");
  const ore = await count("ore");
  const grain = await count("grain");
  const knight = page.getByTestId("knight");
  if (wool >= 1 && ore >= 1) {
    // Affordable: hiring is a board mode with the free vertices on Ada's roads as targets.
    await expect(knight).toBeEnabled();
    await knight.click();
    await expect(page.getByTestId("mode-hint")).toContainText("Choose a vertex on your roads for the knight");
    const spots = page.locator('[data-target="knight"]');
    await expect(spots.first()).toBeAttached({ timeout: 15_000 });
    await spots.first().click({ force: true });
    await expect(page.getByTestId("log")).toContainText("Ada hired a knight");
    await expect(page.locator('[data-testid="board"] [data-piece="knight"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="board"] [data-piece="knight"]')).toContainText("inactive");
    await expect(page.getByTestId("knights-p1-ada")).toHaveText("1 knights · def 0");
    if (grain >= 1) {
      // A grain activates it: pick the knight (its menu opens over the board) and activate.
      await expect(page.getByTestId("knight-act")).toBeEnabled();
      const knights = page.locator('[data-target="knightAct"]');
      await expect(knights).toHaveCount(1, { timeout: 15_000 });
      await knights.first().click({ force: true });
      await expect(page.getByTestId("knight-menu")).toBeVisible();
      await expect(page.getByTestId("knight-move")).toBeDisabled();
      await page.getByTestId("knight-activate").click();
      await expect(page.getByTestId("log")).toContainText("Ada activated a knight");
      await expect(page.getByTestId("knights-p1-ada")).toHaveText("1 knights · def 1");
      await expect(page.getByTestId("fleet-odds")).toHaveText("0 vs 1");
    } else {
      await expect(page.getByTestId("knight-act")).toBeDisabled();
      await expect(page.getByTestId("knight-act")).toHaveAttribute("title", "None of your knights can do anything right now");
    }
  } else {
    await expect(knight).toBeDisabled();
    await expect(knight).toHaveAttribute("title", "Needs wool + ore");
  }
  await page.getByTestId("end-turn").click();
  await acknowledgeHandoff(page);
  await expect(page.getByTestId("banner")).toHaveText("Roll the dice");
  await expect(page.getByTestId("player-row-p2-bo")).toHaveAttribute("aria-current", "true");

  expect(errors).toEqual([]);
});
