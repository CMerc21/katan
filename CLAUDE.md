# CLAUDE.md — Katan

Online multiplayer hex settlement-building game for 3–4 friends. Read `docs/rules.md` before touching anything in `packages/engine`. It is the source of truth for game rules.

## Naming and IP

The name is chosen. Do not use the artwork, card text, or trademarks of any commercial board game anywhere in code, assets, copy, or comments. Terrain, resources, and pieces use the names in `docs/rules.md`. All art is original SVG generated in this repo.

## Stack

* Monorepo: pnpm workspaces + TypeScript strict mode everywhere.
* `packages/engine` — pure rules engine. No React, DOM, Supabase, network, Date, Math.random, or filesystem imports. Seeded RNG only.
* `apps/web` — Next.js (App Router), React, Tailwind. Board rendered as SVG. Deployed to Vercel.
* `supabase/` — Postgres schema + migrations, Edge Functions (Deno), Realtime channels. Auth via Supabase magic links.
* Tests: Vitest. Engine must stay at high coverage; every rule in `docs/rules.md` §5–§11 has at least one test that references its section number in the test name.

## Architecture rules

1. Server is authoritative. Clients send `Action`s to an Edge Function. The function loads state, calls `engine.applyAction`, persists the new state and appends to the action log, and Realtime broadcasts the redacted state to each player. Clients may run the engine locally for instant validation/UI hints only — never as the source of truth.
2. State is a JSON blob in `games.state` (jsonb). Do not normalize board state into relational tables; the action log (`game_actions`) is the audit trail and replay source.
3. Hidden info stays hidden. Anything sent to a client goes through `engine.redact(state, playerId)`. Row Level Security must prevent a player from selecting another player's hand.
4. Randomness is seeded. `games.seed` + action log = full replay. Dice, deck order, and steal targets are derived from the seed and action index, never `Math.random`.
5. Optimistic UI is fine; reconciliation is mandatory. On any Realtime update, the client replaces local state with the server's.

## Build phases

Work one phase per session. Do not start the next phase's files early. Stop when the phase's "done" criteria are met and summarize what changed.

### Phase 1 — Engine foundation (done)

* Hex/vertex/edge geometry with canonical IDs and adjacency helpers (§3).
* Fixed beginner board + seeded random board generator honoring the 6/8 rule.
* `createGame`, setup phase (§4), `legalActions`, `applyAction` scaffold with `RuleError`s.
* Done when: a full setup round for 4 players can be simulated in a test and starting resources are correct.

### Phase 2 — Full rules (done)

* Production incl. bank shortage (§6.2), building and all placement rules (§5), rolling 7 / discard / robber (§7), dev cards (§8), trading (§9), Longest Road and Largest Army (§2.7, §10), win check (§11), `redact`.
* Data shapes and the action catalog are pinned in `docs/phase2.md`.
* Done when: a scripted full game reaches a win in tests, and a property-based test plays 200 random legal-action games to completion with no invariant violations (piece counts, bank totals, VP math).

### Phase 3 — Board UI, hotseat (done)

* SVG board component, click targets for vertices/edges/hexes, hand/resource panel, turn controls, trade dialog, discard dialog.
* Hotseat mode: all players on one screen, driven directly by the engine. No network.
* UI shapes, driver interface, and screens are pinned in `docs/phase3.md`.
* Done when: a full hotseat game is playable in the browser.

### Phase 4 — Supabase multiplayer (built; verified against local Postgres, not yet against a Supabase stack)

* Schema + RLS + migrations, `apply-action` Edge Function, Realtime subscription in the client, replace hotseat driver with the network driver behind the same interface.
* Details and deviations in `docs/phase4.md`. Server logic lives in `packages/server` and is bundled into the Edge Functions by `pnpm build:functions`.
* Done when: two browser sessions in different accounts can play a full game. (Blocked in the dev container: no Docker, so no `supabase start`; the Playwright online spec is written and skips without a stack.)

### Phase 5 — Lobby, resilience, bots (built; same verification caveat as Phase 4)

* Create game, 6-character join code, ready-up, seat order, reconnect/resume, "waiting on X to discard" states, basic error toasts, AI bots (`packages/bots`), hand-a-seat-to-a-bot and host escape hatches. Details in `docs/phase5.md`.

### Phase 6 — Deploy

* Vercel + Supabase project, env vars documented in `.env.example`, `README.md` with the "how to play with friends" instructions.

### Phase 7 — Feel and pacing (done)

* Engine event stream (`applyActionWithEvents`, `describeEvent`, `redactEvents`; `state.log` is derived), events in `game_views` and `game_events`, client animation queue with skip and speed settings, bot thinking pauses, `packages/avatars`, generated bot names, medieval re-skin, optional synthesised sound. Details in `docs/phase7.md`, palette in `docs/art-direction.md`.

### Phase 7.5 — 3D diorama board (done)

* react-three-fiber board in `apps/web/src/board3d` (tiles, seeded props, figurines, camera rig, raycast interaction layer with accessible overlay buttons, in-scene dice and robber animations, quality presets with a frame watchdog); the SVG board moved to `board2d` for thumbnails. Details in `docs/phase7-5.md`.

### Phase 8 — Generalized boards and the editor (done)

* `BoardDefinition` + `isBoardDefinition`, `geometryFor`/`boardGeometry` for any hex set, scaled pools, `validateBoard`, built-in frames (Beginner, Random, Large, Long strip, Ring), 3–6 players with the special build phase (`docs/rules.md` §13), `boards` table + `save-board`/`delete-board`/`fork-board`, `/boards`, the editor at `/boards/editor/[id?]`, the shared `BoardPicker` in the hotseat and create-lobby forms. Details in `docs/phase8.md`.

### Phase 9 — Tides (sea module) (done)

* `Scenario` + `validateScenario`, built-in scenarios (Across the Strait, Archipelago, Gold Coast), ships (`BUILD_SHIP`/`MOVE_SHIP`), the pirate (`MOVE_ROBBER { target }`), gold fields (`chooseGold` phase, `CHOOSE_GOLD`), islands and the island bonus, longest route, setup restriction (`docs/rules.md` §14), `scenarios` table + `save-scenario`/`delete-scenario`/`fork-scenario`, scenario picker, editor Scenario section, 3D ships/pirate/gold. Details in `docs/phase9.md`.

### Phase 10 — Wayfarers (variants module) (done)

* Seven independent variants under `scenario.variants` (`docs/rules.md` §15): event deck, fishing (lake, fishing grounds, fish, the old boot), rivers (bridges, Bridge Builder, Poor Settler), harbormaster, raiders (castles, guards, raids), caravans (oases, spice, tracks), wagons (goods, deliveries). Engine modules in `packages/engine/src/modules/wayfarers/`, plugged in through the hook list (`docs/modules.md`). Board definitions gained `edges` (rivers, fishing grounds), the `lake` terrain and `extras.oasis`; the editor has tools for each and a variant toggle list. Built-ins: The Great Lake, River Country, Coastal Watch, Salt Road. Details in `docs/phase10.md`.

### Phase 11 — Crown & Castle (cities module) (done)

* `scenario.modules.crown` (`docs/rules.md` §16): commodities, the event die, improvement tracks, progress cards, knights as board pieces, the barbarian fleet, walls and metropolises, 13 VP. Engine in `packages/engine/src/modules/crown/`; no development cards in this module. Built-in: Crown & Castle — Standard. Details in `docs/phase11.md`.

### Phase 12 — HUD rework (done)

* Presentation only. One full-bleed diorama with a single `HudLayer` over it (`apps/web/src/hud/`): player banners across the top, an icon-only resource tray, a left rail of square icon buttons with slide-in side panels (chat, emote, log, stats, rules, settings, leave), the parchment build-cost card, round Trade / End turn / Cards buttons, dark event toasts and help tips fed by `hudCopy.ts`. On-table props in `apps/web/src/board/props/` (bank decks, piece piles, the barbarian track). The old sidebar and bottom bar are gone (tag `hud-legacy`). Details in `docs/phase12.md`.

## Conventions

* Commit per meaningful step with a message in the form `phaseN: <what>`.
* Before writing a new engine feature, write the failing test first.
* Prefer small pure functions over classes. No `any`. Exhaustive `switch` on action types with a `never` default.
* Do not add dependencies to `packages/engine` without asking.
* When a rule is ambiguous, ask rather than guess — then update `docs/rules.md` with the decision.
* Keep this file current: if you change the stack or phase plan, edit it here.
* Migrations use timestamp prefixes: create them with `supabase migration new <name>`, never a hand-written sequential number. The remote migration history is timestamped, so a new file must sort after the last applied entry or `supabase db push` fails.

## Packages

* `packages/engine` — rules (pure). `packages/bots` — AI policies over redacted views (pure) and seeded bot names. `packages/avatars` — seeded SVG portraits (pure). `packages/server` — game and lobby transactions over a `postgres` client, shared by the Edge Functions and the Node tests. `apps/web` — Next.js client. `supabase/` — migrations, config, Edge Functions (thin Deno handlers importing `_shared/katan.bundle.js`).

## Engine layout (packages/engine/src)

* `rng.ts` — seeded RNG (`rng(seed, index)`); the only source of randomness.
* `geometry.ts` — axial hex coords, canonical vertex/edge IDs, precomputed adjacency (`GEOMETRY`), pixel helpers for SVG.
* `board.ts` — terrain/resource tables, beginner board, seeded random board, ports.
* `types.ts` — `GameState`, `Phase`, `Action` catalog, player/bank shapes.
* `errors.ts` — `RuleError` with a stable `code`.
* `events.ts` — `GameEvent` union, `describeEvent` (public log sentences), `redactEvents`.
* `state.ts` — pure helpers: hands, costs, occupancy lookups, ports, victory points, `cloneJson`.
* `specialCards.ts` — Longest Road and Largest Army.
* `legal.ts` — placement queries and `legalActions`.
* `actions.ts` — `applyActionWithEvents` / `applyAction` (the authoritative transition) and `replay`.
* `game.ts` — `createGame`.
* `redact.ts` — `redact(state, playerId)`, the only thing a client should ever receive.
* `definition.ts` — `BoardDefinition` and its guard. `pools.ts` — terrain/token/harbour pools scaled to any land count. `validation.ts` — `validateBoard` (error/warning codes). `generation.ts` — `resolveBoard` (definition + seed → `Board`). `frames.ts` — built-in boards.
* `scenario.ts` — `Scenario`, `ScenarioRules`, `isScenario`, `validateScenario`, `scenarioSummary`. `scenarios.ts` — the built-in scenarios (Tides, Wayfarers, Crown & Castle).
* `guards.ts` — phase/turn/payment guards shared by the core and the modules. `turnHelpers.ts` — gold, discards, random steals, city upgrades, Road Building, shared the same way.
* `modules/` — the hook list (`hooks.ts`: `ModuleHooks`, `registerModule`, `activeModules`), prompts (`prompt.ts`), module state shapes and card lists (`types.ts`), `wayfarers/<variant>.ts` (one file per Phase 10 variant) and `crown/` (Phase 11). The core never tests a scenario flag; see `docs/modules.md`.

`pnpm lint` enforces engine purity (no host/framework imports, no `Date`, no `Math.random`) via `eslint.config.js`.

## Web layout (apps/web)

* `app/` — `/` (online home + hotseat form), `/hotseat`, `/play` (hotseat game), `/login`, `/join/[code]`, `/lobby/[code]`, `/play/[gameId]` (online game), `/boards` (board list), `/boards/editor/[[...id]]` (board editor). All client components.
* `src/driver/` — `GameDriver` interface (`types.ts`), `HotseatDriver` (in-memory, device handoff, optional bot seats) and `SupabaseDriver` (server views over Realtime, actions via Edge Functions). Components never import `applyAction`; they only talk to a driver and its optional capabilities.
* `src/lib/supabase.ts` — browser client, magic-link helpers, Edge Function envelope.
* `src/game/store.ts` — in-memory holder for the live driver; a reload loses it and `/play` redirects to `/`.
* `src/hooks/useGame.ts` — the one hook: `{ view, legal, dispatch, me }`. `src/hooks/useEventQueue.ts` — the animation queue between the driver and the components (`src/game/eventQueue.ts` is its pure core).
* `src/game/settings.ts` — animation speed, sound, graphics quality (localStorage, mirrored to the profile). `src/game/sound.ts` — WebAudio cues.
* `src/board/layout.ts` — hex/vertex/edge screen geometry and viewBox (unit tested).
* `src/board3d/` — the diorama used in play, built to the tile and prop brief in `docs/props.md`: `Board3D` (Canvas, lights), `layout3d` (world coords = engine geometry, y → z), `slab.ts` (slab geometry: layers, recess, relief, jitter), `palette.ts` (the diorama's colours), `Tiles` (slabs, tokens, sea ripple), `Props` + `props.ts` (prop geometry and seeded layouts), `Pieces`, `loadPiece` (GLB figurines from `public/models/<name>.glb` via GLTFLoader: geometry cached by name, normals computed, flat-shaded material coloured by the caller, foot at the origin and scaled to the procedural height; `usePiece` returns `null` so callers keep the procedural figure as a fallback), `Crown3d` (knights, walls, metropolis, merchant, longship), `Wayfarers3d`, `Harbor`, `Camera`, `Interaction` (layer-1 raycast targets), `Effects3d` (dice, robber, projector), `quality` (presets, detection, watchdog), `textures` (canvas sprites).
* `src/board2d/` — the SVG board (`Board`, `parts`, `Thumbnail`), thumbnails only.
* `src/editor/` — board editor: `model.ts` (pure reducer + undo/redo + scenario settings, unit tested), `storage.ts` (localStorage drafts, `boards` and `scenarios` tables), `EditorCanvas` (diorama with a cell grid and accessible overlay), `Editor` (tools, validation, Scenario section, save, test play). `src/components/BoardPicker.tsx` is the shared board and scenario chooser.
* `src/hud/` — the Phase 12 HUD: `HudLayer` (grid, keys, toasts, panels), `PlayerBanner`, `ResourceTray`, `LeftRail` + `SidePanel` + `panels` (chat, emote, log, stats, rules, leave) + `SettingsMenu` (the settings body), `BuildCostCard`, `ActionButtons`, `CardsPanel`, `ModuleStrip` + `WayfarersActions`, `DiceWidget`, `TurnBanner`, `EventToast`, `HelpTip`, `primitives` (`Numeral`, `hud:*` events), `hudCopy.ts` (all HUD text), `model.ts` (pure: banner stats, cost rows, status line, dice history; unit tested), `icons/`. Tokens in `src/styles/hud.css`.
* `src/board/props/` — on-table props rendered inside the diorama: `layout.ts` (pure positions from the board bounds), `BankDecks`, `PiecePiles`, `BarbarianTrack`.
* `src/components/` — `GameScreen` (board + HUD + dialogs), `dialogs` (handoff, discard, trade panel, steal, resource picker, ended), `ui` primitives (dark under `.hud-dark`), `cards` (resource and dev card faces), `Avatar` / `AvatarPicker`, `anim/` (anchors, flying cards, dev card reveal, confetti), `crown/` and `wayfarers/` sheets and prompts.
* `test/slab.test.ts` and the props block of `test/board3d.test.ts` pin `docs/props.md` (slab heights, recess, relief, jitter, prop margins, counts, heroes).
* `e2e/` — Playwright (Chromium on SwiftShader for WebGL): `smoke.spec.ts` (setup by clicking, roll, end turn), `pacing.spec.ts` (bot turns take 2–8 s on Normal, instant on Off), `board3d.spec.ts` (diorama renders, raycast and overlay clicks dispatch), `visual.spec.ts` (screenshot baselines in `e2e/__screenshots__`), `editor.spec.ts` (paint, auto-fill, save a draft, play it), `tides.spec.ts` (Gold Coast: pirate on the sea, a setup ship), `crown.spec.ts` (the cost-card rows, the banner cells, the barbarian pills) and `fullgame.spec.ts` (a whole greedy game through the UI; slow).
* Chromium is preinstalled in the dev container; `playwright.config.ts` points at it and never downloads a browser.

## Commands

```
pnpm install
pnpm test            # all workspaces
pnpm lint            # eslint, including engine purity rules
pnpm typecheck
pnpm --filter @katan/engine test -- --watch
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web test:e2e          # Playwright (starts next dev on :3100)
pnpm --filter web test:e2e -- fullgame   # slow whole-game run
pnpm --filter @katan/server test   # needs a local Postgres (KATAN_TEST_DB_URL); runs the real migrations
pnpm build:functions # bundle engine+bots+server for the Edge Functions (before serve/deploy)
supabase start       # local stack (Docker)
supabase db reset    # apply migrations locally
supabase functions serve --env-file .env.local
pnpm seed:local      # two test users + a game (needs SUPABASE_SERVICE_ROLE_KEY)
supabase db reset    # apply migrations locally
```
