import { expect, test, type Page } from "@playwright/test";

/**
 * Plays a complete 4-player hotseat game through the UI with a simple
 * greedy policy (docs/phase3.md §9 done criterion). Slow: it drives every
 * click through the browser. Run with `pnpm test:e2e -- fullgame`.
 */

test.use({ reducedMotion: "reduce" });
test.setTimeout(20 * 60_000);

const MAX_STEPS = 6000;

async function visible(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).isVisible().catch(() => false);
}

async function enabled(page: Page, testId: string): Promise<boolean> {
  const el = page.getByTestId(testId);
  if (!(await el.isVisible().catch(() => false))) return false;
  return el.isEnabled();
}

async function clickFirst(page: Page, selector: string): Promise<boolean> {
  const loc = page.locator(selector);
  if ((await loc.count()) === 0) return false;
  await loc.first().click();
  return true;
}

test("a 4-player hotseat game plays from setup to a win with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("count-4").click();
  await page.getByTestId("board-random").click();
  await page.locator("#seed").fill("fullgame-e2e");
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);

  let steps = 0;
  let turnsSeen = 0;
  const seen = new Set<string>();
  while (steps++ < MAX_STEPS) {
    if (await visible(page, "winner")) break;

    if (await visible(page, "handoff-ready")) {
      await page.getByTestId("handoff-ready").click();
      continue;
    }
    if (await visible(page, "discard-confirm")) {
      // Add cards until the confirm button enables.
      const confirm = page.getByTestId("discard-confirm");
      while (!(await confirm.isEnabled())) {
        const plus = page.getByRole("dialog").getByRole("button", { name: /^More / }).filter({ hasNot: page.locator("[disabled]") });
        const options = await plus.all();
        let clicked = false;
        for (const b of options) {
          if (await b.isEnabled()) {
            await b.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) throw new Error("discard dialog stuck");
      }
      await confirm.click();
      seen.add("DISCARD");
      continue;
    }
    if (await visible(page, "trade-response")) {
      await page.getByRole("button", { name: "Decline" }).click();
      seen.add("REJECT_TRADE");
      continue;
    }
    if (await clickFirst(page, '[data-testid^="steal-"]')) {
      seen.add("STEAL");
      continue;
    }
    if (await clickFirst(page, '[data-testid^="target-hex-"]')) {
      seen.add("MOVE_ROBBER");
      continue;
    }
    // Setup and road-building placements are highlighted without a mode.
    if (await clickFirst(page, '[data-testid^="target-vertex-"]')) {
      seen.add("BUILD_SETTLEMENT");
      continue;
    }
    if (await clickFirst(page, '[data-testid^="target-edge-"]')) {
      seen.add("BUILD_ROAD");
      continue;
    }
    if (await enabled(page, "roll")) {
      // Play a knight first now and then so knights get exercised.
      const knight = page.getByTestId("dev-knight");
      if ((await knight.count()) > 0 && (await knight.first().isEnabled()) && turnsSeen % 3 === 0) {
        await knight.first().click();
        seen.add("PLAY_KNIGHT");
        continue;
      }
      await page.getByTestId("roll").click();
      seen.add("ROLL");
      turnsSeen++;
      continue;
    }
    if (await visible(page, "end-turn")) {
      // Greedy: city > settlement > road > dev card > play cards > bank trade > end turn.
      for (const kind of ["build-city", "build-settlement", "build-road"] as const) {
        if (await enabled(page, kind)) {
          await page.getByTestId(kind).click();
          const target = kind === "build-road" ? '[data-testid^="target-edge-"]' : '[data-testid^="target-vertex-"]';
          if (await clickFirst(page, target)) {
            seen.add(kind === "build-city" ? "BUILD_CITY" : kind === "build-settlement" ? "BUILD_SETTLEMENT" : "BUILD_ROAD");
          } else {
            await page.keyboard.press("Escape");
          }
          continue;
        }
      }
      if (await enabled(page, "buy-dev")) {
        await page.getByTestId("buy-dev").click();
        seen.add("BUY_DEV_CARD");
        continue;
      }
      for (const card of ["dev-roadBuilding", "dev-knight", "dev-invention", "dev-monopoly"] as const) {
        const btn = page.getByTestId(card).first();
        if ((await btn.count()) > 0 && (await btn.isEnabled())) {
          await btn.click();
          if (card === "dev-invention" || card === "dev-monopoly") {
            const dialog = page.getByRole("dialog");
            await dialog.getByRole("button", { name: "Ore" }).click();
            if (card === "dev-invention") await dialog.getByRole("button", { name: "Grain" }).click();
            await dialog.getByRole("button", { name: "Play card" }).click();
          }
          seen.add(card);
          break;
        }
      }
      if (await visible(page, "end-turn")) {
        // Occasionally use the bank so maritime trades are exercised.
        if (turnsSeen % 5 === 0 && (await enabled(page, "trade"))) {
          await page.getByTestId("trade").click();
          await page.getByRole("tab", { name: "Bank" }).click();
          const dialog = page.getByRole("dialog");
          const give = dialog.getByRole("button", { name: /^[234]:1 / }).filter({ hasNot: page.locator("[disabled]") });
          const giveOptions = await give.all();
          let traded = false;
          for (const g of giveOptions) {
            if (!(await g.isEnabled())) continue;
            await g.click();
            const label = (await g.textContent()) ?? "";
            const receive = ["Ore", "Grain", "Wood", "Clay", "Wool"].find((r) => !label.includes(r))!;
            await dialog.getByRole("button", { name: receive, exact: true }).click();
            if (await page.getByTestId("bank-trade").isEnabled()) {
              await page.getByTestId("bank-trade").click();
              seen.add("MARITIME_TRADE");
              traded = true;
            }
            break;
          }
          if (!traded) await page.keyboard.press("Escape");
          continue;
        }
        if (await enabled(page, "end-turn")) {
          await page.getByTestId("end-turn").click();
          seen.add("END_TURN");
          continue;
        }
      }
      continue;
    }
    // Nothing to do: give the UI a moment.
    await page.waitForTimeout(50);
  }

  await expect(page.getByTestId("winner")).toBeVisible();
  const winner = await page.getByTestId("winner").textContent();
  expect(winner).toMatch(/wins$/);
  expect(errors).toEqual([]);
  // The greedy game reaches the core of the catalog.
  for (const type of ["ROLL", "END_TURN", "BUILD_SETTLEMENT", "BUILD_ROAD", "MOVE_ROBBER"]) expect(seen).toContain(type);
  test.info().annotations.push({ type: "actions", description: [...seen].sort().join(", ") });
  test.info().annotations.push({ type: "turns", description: String(turnsSeen) });
});
