# Phase 9 — Tides (Sea Module)

Companion to `CLAUDE.md`, `docs/rules.md` (§14 is new) and `docs/phase8.md`. Tides adds ships, gold fields, the pirate, islands and a scenario format. Everything is gated by a scenario: a base game (no scenario, or one with `modules.tides` off) plays exactly as before, and the whole Phase 2 suite runs unchanged. §11 lists decisions and deviations from the original spec.

## 1. Scenarios (`packages/engine/src/scenario.ts`, `scenarios.ts`)

```ts
interface Scenario {
  id: string; name: string; board: BoardDefinition;
  modules: { tides?: boolean };
  pirate?: boolean;            // default true under Tides
  islandBonus?: number;        // VP per newly settled island
  setup?: "standard" | "mainIslandOnly"; mainIsland?: number;
  victoryPoints: number;       // 3–30
  specialRules?: string[];     // free text for the lobby
}
```

- `isScenario` is the structural guard; `validateScenario` returns the board's issues (islands allowed under Tides) plus `SCENARIO_VP`, `SCENARIO_SETUP` and `SCENARIO_MAIN_ISLAND`. `scenarioRules` is the plain-JSON subset the engine keeps in `state.scenario` (`tides`, `pirate`, `islandBonus`, `setup`, `mainIsland`, `victoryPoints`, `specialRules`); the board is resolved into `state.board` with `seaPlayable = tides`.
- `createGame({ scenario })` takes precedence over `board`; errors throw `RuleError("INVALID_SCENARIO")`.
- Built-ins (`builtInScenario(id)`, `BUILT_IN_SCENARIO_IDS`): **Across the Strait** (the standard island, a strait, and a ten-hex island with two gold fields; setup on the main island only; island bonus 2; 12 VP), **Archipelago** (five five-hex islands, two with gold; no pirate; island bonus 2; 13 VP), **Gold Coast** (the standard frame with two gold fields in place of a meadow and a forest, ringed by sea; 11 VP). Islands and sea are hex masks; terrain, tokens and harbours are filled at game start with the seeded generator, the gold fields pinned.

## 2. Board changes

- `Board.islands: { id, hexes }[]` is computed for every board (`landComponents`, largest first, so ids are stable for a definition); a base board has one island.
- Under Tides `boardGeometry` includes the sea hexes, so sea vertices and edges exist; buildings still need a land vertex (`isLandVertex`) and roads a land edge (`isLandEdge`). A ship needs a sea edge (`isSeaEdge`: at least one adjacent playable sea hex). Frame hexes and missing cells stay unplayable.
- Gold (`terrain: "gold"`) is a producing terrain with a token: on its number every adjacent settlement owes its owner one resource of their choice, a city two (§14.3). It is active whenever a gold hex exists; base boards have none.

## 3. Engine

- **Pieces and state.** `pieces.ships` (15 per player, always present so piece invariants stay simple), `player.ships`, `shipsBuiltThisTurn`, `shipMovedThisTurn`, `startIslands`, `islandChips`; `state.pirateHex` (null without the pirate), `state.scenario`.
- **Actions.** `BUILD_SHIP { edge }` (wood + wool; setup, action, special build and Road Building phases; connected to an own building or ship, never straight to a road; never on a pirate edge), `MOVE_SHIP { from, to }` (once per turn in the action phase; `from` must be at the open end of a route, not built this turn, not beside the pirate; `to` a legal ship position connected without `from`), `CHOOSE_GOLD { resources }` (exactly the owed count, capped by what the bank holds), and `MOVE_ROBBER { hex, target?: "robber" | "pirate" }`.
- **Phases.** `chooseGold { owed, returnTo }` parks the game after a roll (or after a second setup settlement beside a gold field) until every owing player has chosen, in seat order from the current player (`nextActor`); `returnTo` is the phase to resume, so setup continues with the road step. Road Building counts ships as pieces and ends when neither a road nor a ship can be placed (`canPlaceRoadOrShip`).
- **Settlements** may be built at a vertex touching an own road *or* ship (`legalSettlementVertices`); a setup road may be a ship when the settlement is coastal (`legalSetupShipEdges`).
- **Longest route** (`longestRoadLength`): one trail over roads and ships; a road continues into a ship, or back, only through the player's own settlement or city. Same 5+ threshold and transfer rules as Longest Road.
- **Pirate** (§14.5): starts on the sea hex with the fewest land neighbours (`initialPirateHex`); on a seven or a knight the current player moves either the robber (land) or the pirate (sea); the pirate steals from players with a ship on an edge of its hex (`pirateStealTargets`) and blocks building on, moving to and moving from its six edges (`pirateEdges`).
- **Island bonus** (§14.4): setup settlements record `startIslands`; the first settlement on any other island appends the island id to `islandChips` and emits `islandSettled`; `victoryPoints` adds `islandChips.length × islandBonus`; `winningVP(state)` is the scenario's target.
- **Setup restriction** (`setupAllowed`): `mainIslandOnly` keeps starting settlements on vertices touching the main island.
- **Events**: `shipBuilt`, `shipMoved`, `pirateMoved`, `goldChosen`, `islandSettled` (all public; `describeEvent` has a line for each). New rule codes: `TIDES_OFF`, `PIRATE_BLOCKS`, `SHIP_NOT_CONNECTED`, `NOT_YOUR_SHIP`, `NOT_OPEN_END`, `SHIP_TOO_NEW`, `SHIP_ALREADY_MOVED`, `NO_GOLD_OWED`, `WRONG_GOLD_COUNT`, `INVALID_SCENARIO`.
- `legalActions` lists every ship edge, every `(from, to)` ship move, every pirate hex and every gold multiset the bank can pay (up to 70; the client and bots pick from that list).

## 4. Bots (`packages/bots`)

- `edgeTowardScore(view, edge, player, kind)` runs the same BFS over sea edges for ships; `bestSetupLink` scores roads and ships together in setup and Road Building; a new-island vertex is worth `islandBonus × 3` more (`newIslandBonus`); `resourceNeed` targets a ship when no road can be placed.
- `chooseShipMove` relocates the open-end ship when a destination scores at least one point better; `pirateHexScore` prefers the sea hex with the most opposing ships and never one beside the bot's own; `goldPick` fills the next build's missing cards, then the scarcest resource. Gold hexes count as the bot's least-produced resource in `productionOf`/`vertexPips`.
- Hard's plan BFS walks ships as well as roads, and its lookahead includes `BUILD_SHIP` and `MOVE_SHIP` candidates.

## 5. Server and storage

- `supabase/migrations/0005_scenarios.sql`: `games.scenario jsonb` (the snapshot a game was made from; its board is also in `board_definition`) and a `scenarios` table mirroring `boards` with the same RLS. `scenario-service.ts` (`saveScenario`, `deleteScenario`, `forkScenario`) behind the `save-scenario`, `delete-scenario` and `fork-scenario` Edge Functions; `SCENARIO_NOT_FOUND` joins the service codes. Stored definitions carry their row id.
- `create-lobby` accepts a built-in scenario id, `{ scenarioId }` or `{ scenario }` (validated) next to the Phase 8 board choices; `gameOptionsOf(game)` gives `createGame` the scenario when there is one, so start and replay-check agree.
- Client: scenario drafts live in `localStorage` (`katan.scenarios.drafts`, ids `sdraft-…`); `BoardPicker` shows a Scenarios row (built-ins, drafts, yours, public) with a Tides badge and the VP target; `HotseatConfig.scenario` reaches `createGame` through the hotseat driver.

## 6. Editor

The inspector gains a **Scenario** section: "Make it a scenario" turns the board into one with Tides on, then toggles for Tides and the pirate, the island bonus, points to win, the setup mode, the main island (a button per island, or the **Main island** tool to click a hex), and free-text special rules. Validation switches to `validateScenario`; Save stores a scenario draft or a `scenarios` row instead of a board; Test play starts a hotseat game on the scenario. `/boards/editor/<built-in scenario id>` opens a built-in as a template; `/boards` lists built-in, draft, own and public scenarios beside the boards.

## 7. UI

- Ships are hulls with a sail in the player's colour on sea edges (bobbing gently; fresh ones rise in); the pirate is a black-sailed hull that sails between sea hexes with the robber's hop. Sea vertices and edges are only ever targets for ships.
- Bottom bar: **Build ship** and **Move ship** under Tides. Move-ship mode is two clicks: the movable ships ring first, then the legal destinations. Moving the robber shows land targets and, under Tides, sea targets for the pirate at the same time (hover shows which figure moves).
- Gold fields glitter; a **Gold field** dialog with the invention stepper appears when you are owed gold. Island pennants (small gilt flags with the bonus) sit in the players panel; a toast announces a new island.
- Overlay buttons carry `data-target` (`BUILD_SHIP`, `MOVE_SHIP`, `robber`, `pirate`, …) and the sr-only piece list includes ships and the pirate, for tests and assistive tech.

## 8. Events and the queue

`eventQueue.ts` applies the five Tides events to the rendered view (ships, the ship supply, the pirate, gold cards from the bank, pennants and public VP) and times them (`shipBuilt` 300 ms, `shipMoved`/`pirateMoved` 450, `goldChosen` 400, `islandSettled` 700). The special build phase now also pays for pieces in the rendered view.

## 9. Tests

- Engine `test/tides.test.ts`: scenario loading and the guard; islands and the pirate start; setup restriction; ship placement, cost and the road/ship junction rule; settlements at the end of a route; open-end moves (not this turn's ship, once per turn, not beside the pirate); longest route joins only through a building; robber-or-pirate choice, pirate stealing and blocking; gold owed and chosen in seat order with bank limits; a setup gold field; setup ships and Road Building ships; the island bonus once per island, never a start island, counted toward the scenario's target; random legal play on every built-in scenario with piece, bank and pirate invariants.
- Bots: each built-in scenario completes 50 mixed games with ships built, gold chosen, pirate moves (where it exists) and island bonuses earned (where offered).
- Server: `test/boards.test.ts` saves, forks and deletes scenarios with ownership and validation, and starts lobbies from a built-in, a saved and an inline scenario with the snapshot in `games.scenario` and `state.scenario`.
- Web: the event queue reconstructs a Tides game event by event; the editor's scenario settings round-trip and clamp; Playwright `e2e/tides.spec.ts` starts a Gold Coast hotseat game from the picker, sees the pirate, and places a setup ship from a coastal settlement.

## 10. Done criteria

- Archipelago and the other built-ins are playable in the hotseat and online (lobby picker → `create-lobby` → `start-game`); the bot tournaments reach new islands and collect the bonus.
- A custom scenario can be built in the editor, saved (draft or account) and played from the picker.

## 11. Decisions and deviations

- Gold is active on any board with a gold field, not only under `tides`; base boards never contain one, so base games are unchanged.
- Gold owed in the second setup round is chosen before the setup road/ship is placed, via the same `chooseGold` phase (the spec left setup gold unspecified).
- The robber/pirate choice is made on the board (both target sets show) rather than in a dialog.
- A route's open end is any ship end with neither an own building nor another own ship, including a route ending at an opponent's building.
- `pieces.ships` exists in every game (15), so Phase 2 piece-count invariants extend naturally; without Tides no action can use them.
- Bots treat ships as a separate network in the BFS (a ship path never continues over land and vice versa), which is an approximation of the junction rule that keeps the search cheap.
