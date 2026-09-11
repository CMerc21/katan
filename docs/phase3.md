# Phase 3 — Board UI and Hotseat Mode

Companion to `docs/rules.md`, `docs/phase2.md`, and `CLAUDE.md`. Phase 3 creates `apps/web` and makes a full game playable in one browser tab with all players sharing the screen. No network, no Supabase, no auth. Everything is built so Phase 4 can swap in a network driver without touching components. §8 lists where the implementation deviates from the original spec.

## 1. Setup

- `apps/web`: Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind 4, `@katan/engine` as a workspace dependency (transpiled from source via `transpilePackages`).
- Routes: `/` (start a hotseat game), `/play` (the game).
- No global state library. One `useGame(driver)` hook wraps the driver (§2) and exposes `{ view, legal, dispatch, me }`.
- Board is a single `<svg>` element. No canvas, no third-party hex libraries.

## 2. Driver interface

The UI never imports the engine's `applyAction`. It talks to a `GameDriver` (`src/driver/types.ts`):

```ts
interface GameDriver {
  subscribe(cb: (view: RedactedState) => void): () => void; // fires immediately with the current view
  legalActions(): Action[];          // for the acting player (`me()`)
  dispatch(action: Action): Promise<Result<void, RuleError>>;
  me(): string;                      // playerId this client acts as
}
```

- `HotseatDriver` — holds the full `GameState` in memory, calls `engine.applyAction`, and after each action sets `me()` to whichever player must act next: the current player, or the player who owes a discard, or (in seat order after the offerer) the next player who has not yet answered an open trade offer. Emits `engine.redact(state, me())`.
- Phase 4 will add a network driver with the same interface. Nothing in `components/` depends on which driver is live; `src/game/store.ts` has `installDriver()` for that.

## 3. Screens

### 3.1 `/` — start

Player count (3–4), names, seat colours (assigned by seat: red, blue, orange, white), board choice (Beginner / Random + seed). **Start game** stores the driver in memory and navigates to `/play`. `/play` with no game redirects to `/`.

### 3.2 `/play` — game

Desktop-first grid: board (hero) on the left, players panel and log stacked on the right, and a bottom bar for the acting player. Below `md` the side panel keeps its width and the board shrinks; the layout stays usable at 768px.

### 3.3 Hotseat handoff

When `me()` changes, a full-screen overlay says "Pass the device to **{name}**" with one button, **I'm {name}**. While it is up, the hand and dev cards are not rendered and the board has no interactive targets.

## 4. Board rendering

### 4.1 Geometry

`src/board/layout.ts` scales the engine's unit geometry by `R = 50` and computes the viewBox from vertex extents plus a water margin. Corner `k` of a hex is at angle −(30 + 60k)° in screen space, which matches the engine's corner numbering; the unit tests assert that every hex corner lands on the vertex ID's position.

### 4.2 Layers (bottom to top)

1. Water hexagon and harbor markers (ratio + resource abbreviation, dashed lines to their two vertices; owned harbors get an underline).
2. Terrain hexes filled with an SVG `<pattern>` per terrain (tree marks, brick hatching, grass strokes, wheat rows, peak lines; wasteland plain).
3. Number tokens with pips; 6 and 8 in red-orange.
4. Robber, offset from the token so the number stays readable.
5. Roads: ink underline plus player-colour line.
6. Settlement and city glyphs at vertices.
7. Interaction layer: only targets present in `legalActions()` are rendered, each with `role="button"`, a `data-testid`, keyboard activation, and a hit polygon with a real bounding box (vertical edges included).

### 4.3 Highlight semantics

Legal vertex: pulsing ring in the acting player's colour. Legal edge: dashed line. Legal robber hex: tinted fill and glowing outline. Clicking dispatches the matching action object from `legalActions()`; only payload dialogs (§5) construct actions.

## 5. Dialogs and panels

| Phase / trigger | UI |
|---|---|
| `setup` | Banner "{name}: place a settlement / road"; board highlights only. |
| `roll` | **Roll dice**; **Play knight first** when a knight is playable. |
| `discard` (this player owes) | Non-dismissable dialog with steppers, "n of m chosen", **Discard m cards** at the exact count. |
| `discard` (others owe) | Banner "Waiting for {names} to discard"; hotseat cycles `me()` through them. |
| `moveRobber` | Banner "Move the robber"; hex highlights. |
| `steal` | Popover on the robber's hex listing targets with card counts. |
| `action` | **Build road / settlement / city** (toggle a targeting mode; Esc cancels), **Buy development card**, **Trade**, **Withdraw offer**, **End turn**. Disabled buttons carry a `title` explaining why. |
| `roadBuilding` | Banner "Place n free road(s)"; edges highlighted automatically. |
| Dev card play | Cards are buttons; Invention and Monopoly open a resource picker that only enables combinations the bank can supply. |
| Trade | Dialog with **Players** (give/get steppers → open offer; hotseat cycles opponents to accept or decline) and **Bank** (ratio per resource from harbor ownership). |
| `ended` | Overlay "{name} wins" with a VP table (buildings and badges, VP cards, total); **Play again** clears the driver and returns to `/`. |

## 6. Panels

- **Players**: swatch, name, VP (public + revealed private), card count, dev count, knights, Longest Road / Largest Army badges. The acting player's row carries `aria-current`.
- **Hand**: five resource stacks; a stack that grew slides in (the only motion effect besides the target pulse; both off under `prefers-reduced-motion`).
- **Log**: newest first, from `state.log`; dice rolls show both dice.

## 7. Visual direction

Material palette in `src/game/theme.ts`: forest green, clay red, meadow green, grain gold, mountain grey, wasteland sand, water teal, ink, parchment, plus the four player colours. One humanist sans stack. Panels have thin borders, no shadows or gradients; boldness lives in the board and player colours. Sentence case everywhere; visible focus rings on every button.

## 8. Testing

- `test/layout.test.ts` — shared vertex coordinates, edge geometry, viewBox bounds, outward vectors.
- `test/hotseat.test.ts` — `me()` through setup, multiple discards, trade responses (decline cycling and accept), end turn; illegal actions return `RuleError` results without mutating.
- `e2e/smoke.spec.ts` — start a 3-player beginner game, complete setup by clicking highlighted targets, roll, end turn twice; hidden info absent before handoff; `/play` redirect.
- `e2e/fullgame.spec.ts` — a whole 4-player game driven through the UI by a greedy policy, asserting a winner and no console errors (slow; run on demand).

## 9. Done criteria

- A 4-player hotseat game plays from setup to a win in the browser with no console errors (`fullgame.spec.ts`).
- Every action in the Phase 2 catalog is reachable from the UI.
- Playwright smoke test green; `pnpm --filter web build` succeeds.
- Vercel Root Directory can be set to `apps/web`; `/` and `/play` are static routes.

## 10. Decisions and deviations from the original spec

- **Engine `redact` reveals every player's hidden VP once the game has ended** so the final VP table is complete. Nothing else is revealed.
- **Trade responses** use the engine's per-player rejection (`rejectedBy`); the hotseat driver hands the device to each opponent in seat order after the offerer until someone accepts or everyone declines.
- **Playwright** never downloads a browser: the config points at the preinstalled Chromium build, overridable with `PW_CHROMIUM`.
- **`allowedDevOrigins`** includes `127.0.0.1` so the dev server's HMR socket works when tests connect by IP.
- Next.js 16 writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` on `next dev`; they are committed as generated.
