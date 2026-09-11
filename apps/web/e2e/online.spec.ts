import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Online flow with two browser contexts (docs/phase5.md §8): create, join by
 * code, ready, start, play three turns, one goes offline and back, one hands
 * the seat to a bot, and the game reaches a win with the bot playing.
 *
 * Needs a running Supabase stack and Next dev server configured against it:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   E2E_SUPABASE_SERVICE_ROLE_KEY (to mint sessions for two test users).
 * Skips otherwise, so the default e2e run stays green without Docker.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

test.skip(!URL || !ANON || !SERVICE, "set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_ROLE_KEY to run");
test.setTimeout(15 * 60_000);
test.use({ reducedMotion: "reduce" });

/** Mint a session for a test user with the service role and install it in a fresh context. */
async function loginAs(browser: Browser, email: string, name: string): Promise<Page> {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers();
  let id = list.users.find((u) => u.email === email)?.id;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: name } });
    if (error) throw error;
    id = data.user.id;
  }
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const context = await browser.newContext();
  const page = await context.newPage();
  // Verify the OTP in-page with the anon client so the session lands in localStorage.
  await page.goto("/login");
  await page.evaluate(
    async ({ url, anon, email, token }) => {
      const specifier: string = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
      const mod = (await import(specifier)) as { createClient: (u: string, k: string) => { auth: { verifyOtp: (o: object) => Promise<{ error: { message: string } | null }> } } };
      const client = mod.createClient(url, anon);
      const { error } = await client.auth.verifyOtp({ email, token, type: "magiclink" });
      if (error) throw new Error(error.message);
    },
    { url: URL!, anon: ANON!, email, token: link.properties.email_otp },
  );
  await page.goto("/");
  await expect(page.getByTestId("create-lobby")).toBeVisible();
  return page;
}

async function greedyStep(page: Page): Promise<"winner" | "acted" | "idle"> {
  const q = async (id: string) => page.getByTestId(id);
  if (await (await q("winner")).isVisible().catch(() => false)) return "winner";
  for (const sel of ['[data-testid^="steal-"]', '[data-testid^="target-hex-"]', '[data-testid^="target-vertex-"]', '[data-testid^="target-edge-"]']) {
    const loc = page.locator(sel);
    if ((await loc.count()) > 0) {
      await loc.first().click();
      return "acted";
    }
  }
  const discard = await q("discard-confirm");
  if (await discard.isVisible().catch(() => false)) {
    while (!(await discard.isEnabled())) await page.getByRole("dialog").getByRole("button", { name: /^More /, disabled: false }).first().click();
    await discard.click();
    return "acted";
  }
  if (await page.getByTestId("trade-response").isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Decline" }).click();
    return "acted";
  }
  const roll = await q("roll");
  if (await roll.isEnabled().catch(() => false)) {
    await roll.click();
    return "acted";
  }
  for (const kind of ["build-city", "build-settlement", "build-road"]) {
    const b = await q(kind);
    if (await b.isEnabled().catch(() => false)) {
      await b.click();
      const target = page.locator(kind === "build-road" ? '[data-testid^="target-edge-"]' : '[data-testid^="target-vertex-"]');
      if ((await target.count()) > 0) await target.first().click();
      else await page.keyboard.press("Escape");
      return "acted";
    }
  }
  const end = await q("end-turn");
  if (await end.isEnabled().catch(() => false)) {
    await end.click();
    return "acted";
  }
  return "idle";
}

test("two players create, join, ready, start, play, reconnect, hand off to a bot, and finish", async ({ browser }) => {
  const host = await loginAs(browser, "e2e-host@example.com", "Hosty");
  const guest = await loginAs(browser, "e2e-guest@example.com", "Guesty");

  // Create and read the code.
  await host.getByTestId("create-lobby").click();
  await expect(host).toHaveURL(/\/lobby\//);
  const code = (await host.getByTestId("join-code").textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  // Guest joins by code, both ready, host adds a bot and starts.
  await guest.getByTestId("join-code-input").fill(code);
  await guest.getByTestId("join").click();
  await expect(guest).toHaveURL(new RegExp(`/lobby/${code}$`));
  await guest.getByTestId("ready").click();
  await host.getByTestId("ready").click();
  await host.getByTestId("add-bot").click();
  await expect(host.getByTestId("seat-2")).toBeVisible();
  await expect(host.getByTestId("start-game")).toBeEnabled();
  await host.getByTestId("start-game").click();
  await expect(host).toHaveURL(/\/play\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(guest).toHaveURL(/\/play\/[0-9a-f-]+$/, { timeout: 20_000 });

  // Presence: both humans show as connected on both screens.
  await expect(host.getByTestId("presence-seat-1")).toHaveAttribute("aria-label", "connected", { timeout: 20_000 });
  await expect(guest.getByTestId("presence-seat-0")).toHaveAttribute("aria-label", "connected", { timeout: 20_000 });

  // Play three human turns each, whoever is up.
  let rolls = 0;
  for (let i = 0; i < 400 && rolls < 6; i++) {
    let acted = false;
    for (const page of [host, guest]) {
      const before = await page.getByTestId("log").textContent();
      const r = await greedyStep(page);
      if (r === "acted") {
        acted = true;
        const after = await page.getByTestId("log").textContent();
        if (after !== before && /rolled/.test(after ?? "") && !/rolled/.test((before ?? "").slice(0, 60))) rolls++;
      }
    }
    if (!acted) await host.waitForTimeout(200);
  }

  // Guest goes offline and back: on reconnect the view is refetched and matches the host's version.
  await guest.context().setOffline(true);
  await host.waitForTimeout(1500);
  await guest.context().setOffline(false);
  await expect(guest.getByTestId("connection")).toHaveCount(0, { timeout: 20_000 });
  const hostLog = (await host.getByTestId("log").textContent()) ?? "";
  await expect.poll(async () => (await guest.getByTestId("log").textContent()) ?? "", { timeout: 20_000 }).toContain(hostLog.slice(0, 40));

  // Guest hands the seat to a bot; from here the host and two bots finish the game.
  await guest.getByTestId("hand-to-bot").click();
  await expect(guest.getByTestId("reclaim-seat")).toBeVisible({ timeout: 20_000 });

  for (let i = 0; i < 3000; i++) {
    const r = await greedyStep(host);
    if (r === "winner") break;
    if (r === "idle") await host.waitForTimeout(150);
  }
  await expect(host.getByTestId("winner")).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId("winner")).toBeVisible({ timeout: 30_000 });
});
