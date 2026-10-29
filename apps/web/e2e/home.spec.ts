import { expect, test } from "@playwright/test";

/**
 * The home lobby (docs/phase13.md §1–§2): the scene and the showcase render,
 * the wardrobe and the showcase arrows change the character at once and the
 * look survives a reload, the panels open and close, and Solo play starts a
 * hotseat game with seat 1 wearing the wardrobe. Friends and invites need a
 * Supabase stack; without one the Friends panel explains and offers sign-in.
 */

test("the lobby renders the scene, the character, both rails and Play", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.getByTestId("lobby-scene")).toBeVisible();
  await expect(page.getByTestId("showcase-figure")).toBeVisible();
  await expect(page.getByTestId("showcase-name")).toHaveText("Settler");
  for (const id of ["rail-friends", "rail-wardrobe", "rail-games", "rail-boards", "rail-editor", "rail-settings", "profile-badge", "home-boards", "lobby-play", "mode-solo", "mode-online", "party-slot-left", "party-slot-right"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("mode-solo")).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("the wardrobe equips instantly, the arrows step the active category, and the look survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const figure = page.locator("[data-figure]").first();
  const garment = async () => (JSON.parse((await figure.getAttribute("data-figure"))!) as { garment: number; headwear: number }).garment;

  await page.getByTestId("open-wardrobe").click();
  await expect(page.getByTestId("wardrobe")).toBeVisible();
  await page.getByTestId("wardrobe-garment-3").click();
  await expect(page.getByTestId("wardrobe-garment-3")).toHaveAttribute("aria-pressed", "true");
  expect(await garment()).toBe(3);
  await expect(page.getByTestId("showcase-option")).toHaveText("Cloak");
  await page.getByTestId("wardrobe-color-green").click();
  await expect(figure).toHaveAttribute("data-color", "green");

  await page.getByTestId("wardrobe-tab-headwear").click();
  await page.getByTestId("wardrobe-headwear-6").click();
  await expect(page.getByTestId("showcase-title")).toHaveText("the Crowned");
  await page.getByTestId("wardrobe-name").fill("Ada");
  await page.getByTestId("wardrobe-name").blur();
  await expect(page.getByTestId("showcase-name")).toHaveText("Ada");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wardrobe")).toHaveCount(0);

  // The arrows step the category picked under the figure.
  await page.getByTestId("showcase-category").selectOption("outfit");
  await page.getByTestId("showcase-next").click();
  expect(await garment()).toBe(4);
  await expect(page.getByTestId("showcase-option")).toHaveText("Apron");
  await page.getByTestId("showcase-next").click();
  expect(await garment()).toBe(0);
  await page.getByTestId("showcase-prev").click();
  expect(await garment()).toBe(4);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("showcase-name")).toHaveText("Ada");
  await expect(page.locator("[data-figure]").first()).toHaveAttribute("data-color", "green");
  expect(await garment()).toBe(4);
});

test("panels: friends explains sign-in without an account, settings and play open and close", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("rail-friends").click();
  await expect(page.getByTestId("friends-panel")).toBeVisible();
  await expect(page.getByTestId("friends-sign-in")).toBeVisible();
  await page.getByTestId("friends-close").click();
  await expect(page.getByTestId("friends-panel")).toHaveCount(0);
  // An empty party slot opens the same panel.
  await page.getByTestId("party-slot-left").click();
  await expect(page.getByTestId("friends-panel")).toBeVisible();

  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("lobby-settings")).toBeVisible();
  await expect(page.getByTestId("friends-panel")).toHaveCount(0);
  await expect(page.getByTestId("speed-normal")).toBeVisible();

  await page.getByTestId("mode-online").click();
  await page.getByTestId("lobby-play").click();
  await expect(page.getByTestId("play-sheet")).toContainText("Play online");
  await page.getByTestId("mode-solo").click();
  await expect(page.getByTestId("play-sheet")).toContainText("Hotseat on this device");
  await page.getByTestId("play-sheet-close").click();
  await expect(page.getByTestId("play-sheet")).toHaveCount(0);
});

test("Solo play starts a hotseat game; seat 1 wears the wardrobe", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("katan.settings", JSON.stringify({ animation: "off", sound: false, quality: "low", followTurns: false }));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("open-wardrobe").click();
  await page.getByTestId("wardrobe-tab-headwear").click();
  await page.getByTestId("wardrobe-headwear-6").click();
  await page.getByTestId("wardrobe-close").click();
  await page.getByTestId("lobby-play").click();
  // The first seat's portrait is the wardrobe's (crowned) look.
  const seatOne = page.getByTestId("play-sheet").locator("li").first();
  await expect(seatOne.locator("svg").first()).toBeVisible();
  const portrait = await seatOne.locator("span[aria-hidden]").first().innerHTML();
  expect(portrait).toContain("#d9a21b"); // the crown's gold
  await page.getByTestId("count-3").click();
  await page.getByTestId("name-0").fill("Ada");
  await page.getByTestId("board-beginner").click();
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/play$/);
  await page.getByTestId("handoff-ready").click();
  await expect(page.getByTestId("banner")).toHaveText("Ada: place a settlement");
});
