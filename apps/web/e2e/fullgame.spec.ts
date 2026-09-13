import { expect, test, type Page } from "@playwright/test";

/**
 * Plays a complete 4-player hotseat game through the UI with a greedy
 * policy (docs/phase3.md §9 done criterion). One `page.evaluate` per step
 * reads everything the policy needs, so the loop is not dominated by
 * locator round-trips. Run with `pnpm test:e2e -- fullgame`.
 */

test.use({ reducedMotion: "reduce" });
test.setTimeout(15 * 60_000);

const MAX_STEPS = 8000;

interface UiState {
  winner: boolean;
  handoff: boolean;
  discard: boolean;
  discardEnabled: boolean;
  tradeResponse: boolean;
  steal: string | null;
  hex: string | null;
  vertex: string | null;
  edge: string | null;
  roll: boolean;
  knight: boolean;
  endTurn: boolean;
  builds: { city: boolean; settlement: boolean; road: boolean };
  buyDev: boolean;
  cards: string[];
  /** Phase 12: the dev cards live behind the round Cards button. */
  cardsHeld: number;
  cardsOpen: boolean;
  trade: boolean;
  bankTrade: boolean;
  hand: Record<string, number>;
}

/** Everything the greedy policy needs, in one round-trip. */
function readUi(page: Page): Promise<UiState> {
  return page.evaluate(() => {
    const q = (sel: string) => document.querySelector<HTMLElement>(sel);
    const enabled = (sel: string) => {
      const el = q(sel) as HTMLButtonElement | null;
      return Boolean(el && !el.disabled);
    };
    const first = (sel: string) => q(sel)?.getAttribute("data-testid") ?? null;
    return {
      winner: Boolean(q('[data-testid="winner"]')),
      handoff: Boolean(q('[data-testid="handoff-ready"]')),
      discard: Boolean(q('[data-testid="discard-confirm"]')),
      discardEnabled: enabled('[data-testid="discard-confirm"]'),
      tradeResponse: Boolean(q('[data-testid="trade-response"]')),
      steal: first('[data-testid^="steal-"]'),
      hex: first('[data-testid^="target-hex-"]'),
      vertex: first('[data-testid^="target-vertex-"]'),
      edge: first('[data-testid^="target-edge-"]'),
      roll: enabled('[data-testid="roll"]'),
      knight: enabled('[data-testid="dev-knight"]'),
      endTurn: enabled('[data-testid="end-turn"]'),
      builds: {
        city: enabled('[data-testid="build-city"]'),
        settlement: enabled('[data-testid="build-settlement"]'),
        road: enabled('[data-testid="build-road"]'),
      },
      buyDev: enabled('[data-testid="buy-dev"]'),
      cards: ["dev-roadBuilding", "dev-knight", "dev-invention", "dev-monopoly"].filter((id) => enabled(`[data-testid="${id}"]`)),
      cardsHeld: Number(q('[data-testid="cards"]')?.getAttribute("data-count") ?? 0),
      cardsOpen: q('[data-testid="cards"]')?.getAttribute("aria-pressed") === "true",
      trade: enabled('[data-testid="trade"]'),
      bankTrade: Boolean(q('[data-testid="bank-trade"]')),
      hand: Object.fromEntries(
        Array.from(document.querySelectorAll<HTMLElement>('[data-testid="hand"] [aria-label]')).map((el) => {
          const [n, name] = (el.getAttribute("aria-label") ?? "0 ?").split(" ");
          return [name ?? "?", Number(n)];
        }),
      ),
    };
  });
}

async function clickId(page: Page, id: string): Promise<void> {
  await page.getByTestId(id).first().click({ timeout: 5000 });
}

/** The Cards button is enabled during our roll and action phases. */
function enabledCards(ui: UiState): boolean {
  return ui.roll || ui.endTurn;
}

test("a 4-player hotseat game plays from setup to a win with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });

  // Software WebGL in CI: the low preset keeps the main thread free for the game loop.
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });
  await page.goto("/hotseat");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("count-4").click();
  await page.getByTestId("board-random").click();
  await page.locator("#seed").fill("fullgame-e2e");
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);

  const seen = new Set<string>();
  let turns = 0;
  let steps = 0;
  while (steps++ < MAX_STEPS) {
    const ui = await readUi(page);
    if (ui.winner) break;
    if (ui.handoff) {
      await clickId(page, "handoff-ready");
      continue;
    }
    if (ui.discard) {
      if (ui.discardEnabled) {
        await clickId(page, "discard-confirm");
        seen.add("DISCARD");
      } else {
        await page.getByRole("dialog").getByRole("button", { name: /^More /, disabled: false }).first().click();
      }
      continue;
    }
    if (ui.tradeResponse) {
      await page.getByRole("button", { name: "Decline" }).click();
      seen.add("REJECT_TRADE");
      continue;
    }
    if (ui.steal) {
      await page.getByTestId(ui.steal).click();
      seen.add("STEAL");
      continue;
    }
    if (ui.hex) {
      await page.getByTestId(ui.hex).click();
      seen.add("MOVE_ROBBER");
      continue;
    }
    if (ui.vertex) {
      await page.getByTestId(ui.vertex).click();
      seen.add("BUILD_SETTLEMENT");
      continue;
    }
    if (ui.edge) {
      await page.getByTestId(ui.edge).click();
      seen.add("BUILD_ROAD");
      continue;
    }
    // Open the Cards panel whenever there is something in it, so the greedy reads below see the card buttons.
    if (ui.cardsHeld > 0 && !ui.cardsOpen && enabledCards(ui)) {
      await clickId(page, "cards");
      continue;
    }
    if (ui.roll) {
      if (ui.knight && turns % 3 === 0) {
        await clickId(page, "dev-knight");
        seen.add("PLAY_KNIGHT");
        continue;
      }
      await clickId(page, "roll");
      seen.add("ROLL");
      turns++;
      continue;
    }
    if (ui.endTurn || ui.builds.city || ui.builds.settlement || ui.builds.road || ui.buyDev) {
      const kind = ui.builds.city ? "build-city" : ui.builds.settlement ? "build-settlement" : ui.builds.road ? "build-road" : null;
      if (kind) {
        await clickId(page, kind);
        const next = await readUi(page);
        const target = kind === "build-road" ? next.edge : next.vertex;
        if (target) {
          await page.getByTestId(target).click();
          seen.add(kind === "build-city" ? "BUILD_CITY" : kind === "build-settlement" ? "BUILD_SETTLEMENT" : "BUILD_ROAD");
        } else {
          await page.keyboard.press("Escape");
        }
        continue;
      }
      if (ui.buyDev) {
        await clickId(page, "buy-dev");
        seen.add("BUY_DEV_CARD");
        continue;
      }
      const card = ui.cards[0];
      if (card) {
        await clickId(page, card);
        if (card === "dev-invention" || card === "dev-monopoly") {
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("button", { name: "Ore", exact: true }).click();
          if (card === "dev-invention") await dialog.getByRole("button", { name: "Grain", exact: true }).click();
          await dialog.getByRole("button", { name: "Play card" }).click();
        }
        seen.add(card);
        continue;
      }
      // Bank: turn a surplus stack into a resource we lack, so hands do not just pile up for the next seven.
      const stacks = Object.entries(ui.hand).sort((a, b) => b[1] - a[1]);
      const surplus = stacks[0];
      const lacking = stacks.filter(([, n]) => n === 0).map(([name]) => name);
      if (ui.trade && surplus && surplus[1] >= 4 && lacking.length > 0) {
        await clickId(page, "trade");
        await page.getByRole("tab", { name: "Bank" }).click();
        const dialog = page.getByRole("dialog");
        const give = dialog.getByRole("button", { name: new RegExp(`^[234]:1 ${surplus[0]}$`), disabled: false });
        let traded = false;
        if ((await give.count()) > 0) {
          await give.first().click();
          const receive = dialog.getByRole("button", { name: new RegExp(`^(${lacking.join("|")})$`), disabled: false }).first();
          if ((await receive.count()) > 0) {
            await receive.click();
            if (await page.getByTestId("bank-trade").isEnabled()) {
              await clickId(page, "bank-trade");
              seen.add("MARITIME_TRADE");
              traded = true;
            }
          }
        }
        if (!traded) {
          await page.keyboard.press("Escape");
          if (ui.endTurn) {
            await clickId(page, "end-turn");
            seen.add("END_TURN");
          }
        }
        continue;
      }
      if (ui.endTurn) {
        await clickId(page, "end-turn");
        seen.add("END_TURN");
        continue;
      }
    }
    await page.waitForTimeout(30);
  }

  await expect(page.getByTestId("winner")).toBeVisible();
  expect(await page.getByTestId("winner").textContent()).toMatch(/wins$/);
  expect(errors).toEqual([]);
  for (const type of ["ROLL", "END_TURN", "BUILD_SETTLEMENT", "BUILD_ROAD", "MOVE_ROBBER"]) expect(seen).toContain(type);
  test.info().annotations.push({ type: "actions", description: [...seen].sort().join(", ") });
  test.info().annotations.push({ type: "turns", description: String(turns) });
});
