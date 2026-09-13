# Phase 10 — Wayfarers (Variants Module)

Companion to `CLAUDE.md`, `docs/rules.md` (§15 is new), `docs/modules.md` (how modules plug into the engine) and `docs/phase9.md`. Seven small, independent rule toggles a scenario can mix under `scenario.variants`. Each variant is one engine file with its own hooks, tests, events and UI; a game with every switch off plays exactly as before and the whole Phase 2–9 suite runs unchanged. §11 lists decisions and deviations from the original spec.

## 1. Scenario integration

```ts
interface Scenario {
  modules: { tides?: boolean; crown?: boolean };
  variants?: { eventDeck?, fishing?, rivers?, harbormaster?, raiders?, caravans?, wagons? };
  ...
}
```

- `scenarioRules` keeps `variants: VariantFlags` (every flag, false by default) and `crown` in `state.scenario`; `variantOn(state, name)` and `crownOn(state)` are the only switches the engine reads. `state.wayfarers` holds the variant state (null unless a variant is on; each variant owns one nullable sub-object created by its `init` hook).
- `validateScenario` adds `SCENARIO_MODULES` (raiders with Crown & Castle), `SCENARIO_OASES` (caravans without an oasis) and advisory warnings (`SCENARIO_OASES_COUNT`, `SCENARIO_OASES_UNUSED`, `SCENARIO_NO_FISH`, `SCENARIO_FISH_UNUSED`, `SCENARIO_NO_RIVERS`, `SCENARIO_RIVERS_UNUSED`, `SCENARIO_VP_LOW`). `scenarioModuleLabels` / `scenarioSummary` name the switched-on modules for pickers and lobbies.
- Board definitions (`definition.ts`) gained `edges?: EdgeDef[]` (`{ edge, kind: "river" }` and `{ edge, kind: "fishingGround", token }`), the `lake` terrain (no token; the robber starts there when there is no wasteland; `TOKEN_ON_LAKE`) and `extras.oasis` on land hexes. `resolveBoard` copies them into `Board.rivers`, `Board.fishingGrounds` and `Board.oases`; `definitionFromBoard` writes them back. Validation: `RIVER_AT_SEA`, `FISHING_INLAND`, `EDGE_DUPLICATE`, `OASIS_TERRAIN`, and `BAD_TOKEN` for fishing tokens. Painted terrain is now pinned when the rest of a board is shuffled (it used to be shuffled along; docs/phase8.md §2 always said fixed hexes keep theirs).

## 2. Engine (`packages/engine/src/modules/wayfarers/`)

Every variant registers a `ModuleHooks` object (`docs/modules.md` §3) and exposes its actions through `extraActions`, its decisions through prompts (`parkPrompt` / `finishPrompt`), and its points through `victoryPoints`.

| Variant | File | State (`state.wayfarers.<name>`) | Hooks and actions |
| --- | --- | --- | --- |
| Event deck | `eventDeck.ts` | `{ cards, shuffles, lastEvent?, reshufflePending? }` — `buildEventDeck(seed, shuffles)` shuffles with `createRng(seed, "eventDeck:<n>")`, the marker is the 5th card from the bottom | `roll` pops the top card (dice shown as `[⌊t/2⌋, t−⌊t/2⌋]`, `diceRolled.card`), `onSeven` → `"noRobber"` on Robber's Rest, `afterRoll` resolves the event: harvest / bounty wrap the phase in `chooseGold`, Neighborly help is a `neighborlyHelp` prompt chain answered by `NEIGHBORLY_GIVE { resource \| null }`, the tax collector sets `pendingDiscards = { id: 1 }` with a `discard` phase (plus `taxCollected` announcements); the deck is rebuilt after the roll that drew the marker (`deckReshuffled`). |
| Fishing | `fishing.ts` | `{ fish, bag, boot, spent }` — bag 11×1, 10×2, 8×3 + boot (0), `createRng(seed, "fishing:bag")` | `afterProduction` draws for fishing grounds on their token and for lakes on 2/3/11/12 (robber on the lake blocks), `fishDrawn` per token; `SPEND_FISH { option, hex \| targetPlayerId \| resource \| edge \| vertex }` in the action phase (`FISH_COST`: 2/3/4/5/7), `fishSpent` then the effect's events; `victoryPoints` −1 for the boot holder; `onTradeAccepted` moves the boot (`bootPassed`); `extraActions` lists every affordable instance and the `boot: true` trade variants. |
| Rivers | `rivers.ts` | `{ bridgeBuilder: { playerId, count }, coins, poorSettler }` | `roadCost` +1 clay on `board.rivers`; `onBuilt` (roads) emits `bridgeBuilt` and re-evaluates Bridge Builder with the Longest Road transfer rules; `onTurnEnd` awards coins (`coinsAwarded`) and re-evaluates the Poor Settler; chips move with `chipMoved`. |
| Harbormaster | `harbormaster.ts` | `{ playerId, points }` | `onBuilt` (settlements, cities) recounts harbour points (1 / 2 on `board.ports[].vertices`), `chipMoved { chip: "harbormaster" }`, +2 VP. |
| Raiders | `raiders.ts` | `{ counter, castles, guards, raided, rebuilt, landings }` | `onSetupSettlement` (round 2) parks the `placeCastle` prompt (`BUILD_CASTLE { vertex }`, `castleBuilt`); `onSeven` advances the counter by the city count (`raidersAdvanced`) and lands at 15 (`raid { raided, defended, guardsLost }`, guards on raided hexes return to supply, counter → 0); `hexProduces` false while raided; `BUILD_KNIGHT { hex }` posts a guard (1 ore + 1 wool, a land hex the player touches, six per player, never on a raided hex; `guardPlaced`); `REBUILD_HEX { hex }` (1 ore + 1 wool, `hexRebuilt`, +1 VP). Helpers `coastalHexes`, `hexStrength`, `hexDefense`, `touchedLandHexes`. |
| Caravans | `caravans.ts` | `{ tracks: [{ oasis, edges }], spice, spiceBank }` (one track per `board.oases` entry, in that order) | `yieldOverride` 0 resources on an oasis; `afterProduction` pays spice (1 / 2, seat order from the current player, bank of 19; `spiceProduced`) and the +1 track bonus as a second `produced` event; `EXTEND_CARAVAN { caravan, edge }` (own road adjacent to the track's end, 1 spice, at most 3 edges; `caravanExtended`, then `updateLongestRoad`); `edgeWeight` 2 on or beside a track. |
| Wagons | `wagons.ts` | `{ wagons: { at, cargo, cargoFrom, stepsUsed }, stock, demand, points }` | `onSetupSettlement` (round 2) places the wagon; `onTurnStart` resets steps; `onTurnEnd` stocks one seeded good per city (`goodsStocked`, cap 2) and sets each new city's demand; `MOVE_WAGON { path, grain?, toll? }` (simple path over any player's roads, 2 free steps, 1 grain per extra step, one toll per blocking opposing wagon; `wagonMoved`); `LOAD_COMMODITY { good }` at any city with stock (`goodLoaded`); `DELIVER { good }` at an opponent's city other than where it was loaded (`delivered { points }`, demand rotates); `victoryPoints` = delivery points. |

Shared behaviour: `startDiscards` / the `discard` phase carry a `returnTo` phase, so any rule that makes players discard (a seven, the tax collector, Saboteur) resumes where it left off; `chooseGold` is reused for "take a resource of your choice"; `nextActor` returns the prompted player during a `modulePrompt`; `finishSetup` in the test helpers walks through prompts.

## 3. Built-in scenarios (`scenarios.ts`)

| Id | Board | Variants | VP |
| --- | --- | --- | --- |
| `greatLake` | The Great Lake: the standard frame with a lake at the centre, fixed harbours and three fishing grounds (tokens 5, 9, 8) between them | fishing, harbormaster | 12 |
| `riverCountry` | River Country: the standard frame with a ten-edge river winding along the middle column | rivers, eventDeck | 12 |
| `coastalWatch` | Coastal Watch: the standard island ringed by decorative sea | raiders | 12 |
| `saltRoad` | Salt Road: the Large frame with oases at `0,0`, `3,-3` and `-2,3`, 3–6 seats | caravans, wagons | 13 |

## 4. Bots

`packages/bots/src/wayfarers.ts` holds every variant heuristic; medium and hard call it from marked hook points (`choosePrompt`, before/after-build hooks in the turn action, `vertexBonus` inside `vertexScore`, `linkBonus` for road choice, `positionBonus` in hard's `positionScore`); easy takes the before-build hook 70 % of the time and otherwise plays as before.

- Prompts: `placeCastle` → the own settlement with the most pips; `neighborlyHelp` → the most-held resource when holding ≥ 5 cards and the receiver is not the leader, else nothing; unknown prompt kinds fall back to a random legal answer.
- Fishing: spend greedily, most expensive affordable first (free development card or free city, free road toward the best `edgeTowardScore` edge, a needed bank resource, a steal from the leader, and the 2-fish robber move only when the robber sits on an own producing hex). The boot variants of accept/offer are preferred whenever the engine lists them; responders decline boot-carrying offers unless the trade completes their build.
- Rivers: +0.8 per river edge in `vertexScore`, a river-edge road preference once the bot has two bridges; Harbormaster: +1.5 on harbour vertices and harbour settlements are upgraded first; Caravans: oasis pips count, a caravan is always extended when legal (spice has no other use), preferring the edge with the most own roads and buildings around it; Raiders: raided own hexes are rebuilt whenever legal, and from counter ≥ 10 guards go on the bot's coastal producing hexes whose strength exceeds their defence, unless a settlement or city is affordable right now; Wagons: a multi-source BFS over every player's roads drives deliver → load (a good some opponent city demands, only when a target is reachable) → move toward the nearest useful city, paying grain or a toll only when the move completes the job.

## 5. Editor and client

- `src/components/wayfarers/`: `FishSheet` (the five favours with costs and reasons; player / resource pickers; board modes `fishRobber`, `fishRoad`, `fishCity`), `NeighborlyDialog`, `WayfarersActions` (bottom-bar buttons `fish`, `guard`, `rebuild`, `caravan`, `wagon` with step-by-step path picking and `wagon-go`, `wagon-load` / `wagon-deliver` with a good picker), `Badges` (fish, boot, coins, chips, castle, guards, rebuilt, spice, deliveries, cargo; the raider strip "Raiders x/15" and the event deck count). The trade dialog and the accept popover gain "pass the old boot" checkboxes when the legal list carries the boot variant; the dice tray shows the drawn event card under the event deck.
- `src/board3d/Wayfarers3d.tsx`: lake water with ripples, fishing buoys with tokens, river ribbons and bridges, oasis pools with a palm, camels along caravan tracks, guards ringed around hexes, castle keeps, ash-and-stakes raided overlays, animated wagons with cargo cubes, city goods and demand signs; `Interaction` target modes `guard | rebuild | caravan | wagon | fishRobber | fishRoad | fishCity` (castle prompts need no mode) with `data-target` values and an sr-only piece list (`lake`, `fishing-ground`, `castle`, `guard`, `raided`, `wagon`, `caravan`). `board2d/Thumbnail` draws rivers, oases and fishing tokens.
- `eventQueue.ts` (`applyWayfarersEvent`) applies every Wayfarers event to the rendered view (a one-event `freeBuild` marker makes the build that follows a fish spend cost nothing); five reconstruction tests compare the rendered view with `redact()` on each Wayfarers built-in and on the "Everything" scenario.
- Editor: see §1 and `docs/phase8.md` §4 — tools **River** (R), **Fishing ground** (G, token typed 2–12), **Oasis** (O), the lake as terrain 8, a Markers section to clear layers, the Scenario section's **Crown & Castle** toggle and **Variants** list with a plain-language summary per variant, and `scenarioSummary` blurbs in `/boards` and the picker.
- Lobby / picker: `BoardPicker` badges scenarios as `tides`, `crown` or `wayfarers`; blurbs come from `scenarioSummary`.

## 6. Tests

- Engine: `eventDeck.test.ts` (10), `fishing.test.ts` (19), `rivers.test.ts` (7), `harbormaster.test.ts` (4), `raiders.test.ts` (10), `caravans.test.ts` (11), `wagons.test.ts` (12) — every `it` names its `docs/phase10.md §n`; each variant has a 20-game random-play test asserting its own conservation law (fish: bag + purses + spent = 55; spice: bank + held = 19; guards ≤ 6 and never on raided hexes; stock ≤ 2, cargo ≤ 2) and that `victoryPoints` matches an independent recount. `wayfarers-all.test.ts` plays 100 random games with every variant on (`everythingScenario`: the Great Lake board with a river and three oases) under all of those invariants at once; `scenarios.test.ts` loads every built-in. The base suites are unchanged with the variants off (`state.wayfarers === null`, no module events).
- Bots: each Wayfarers built-in completes 30 mixed games with the variant exercised (see §4).
- Web: `test/editor.test.ts` (tools, lake, scenario round-trip, exclusivity, validation codes), `test/eventQueue.test.ts` (reconstruction with the variants on); Playwright `editor.spec.ts` (mark a river, a fishing ground and an oasis, turn on variants, save a draft, find it in the picker), `scenarios.spec.ts` (every built-in scenario starts a hotseat game and the first settlement goes down), `wayfarers.spec.ts` (see §5).

## 7. Done criteria

- Each built-in scenario completes with bots and can be created online (the lobby accepts any built-in id; the scenario snapshot carries `variants`).
- Every variant can be toggled independently; the "all on" property test plays every variant together.

## 11. Decisions and deviations

- **Event deck.** The five event cards sit on fixed numbers (12 harvest, 2 bounty, a 7 rest, a 3 help, an 11 tax) so the events' odds are the numbers' odds. Events resolve after the number (harvest/bounty after production, the tax after a seven's discards); "poorest" for Neighborly help counts hidden VP cards; givers must hold a resource; the tax counts commodities (`cardCount`).
- **Fishing.** Fish are a fungible total per player (no token denominations); spent fish leave the game (`spent` keeps the conservation law); the bag is not refilled. Fishing grounds are not blocked by the robber, only the lake is. The 2-fish robber move needs a lake or a wasteland to move to (and is unavailable otherwise); it never steals. The boot passes with an offer or an acceptance; an offer with the boot attached may still be accepted by an ineligible player — the trade completes and the boot stays.
- **Rivers.** The bridge surcharge applies to paid roads only; free roads (setup, Road Building, a fish road) on river edges are still bridges. Ships on a coastal river edge are not bridges. Chip transfer for Bridge Builder mirrors Longest Road; the Poor Settler is re-evaluated after each coin award.
- **Harbormaster.** "First to 3, strict exceed" is implemented with the Longest Road transfer rules (equivalent, since one player's points change per build). A city lost to the barbarians under Crown & Castle does not recount harbour points (the two rarely mix).
- **Raiders.** The castle is chosen right after the second setup settlement (a prompt wrapping the road step). The castle stays a settlement (it may become a city) and contributes zero strength; a raid never touches it. `raidersAdvanced` is only emitted when there are cities; the counter resets to 0 on landing with no carry-over; a hex already raided stays raided. Guards can go on any touched land hex (coastal or not) except a raided one; `BUILD_KNIGHT` works in the special build too, `REBUILD_HEX` only in the action phase. Raided hexes also block gold fields.
- **Caravans.** The spec's "settlements produce +1" bonus goes to any building on a track vertex. Spice is not a card (never stolen or discarded). Spice and the bonus respect other modules' `hexProduces` (a raided oasis yields nothing). A bad caravan index is `INVALID_PAYLOAD`.
- **Wagons.** Wagons stand on vertices; a wagon blocks a vertex, and entering it costs a one-resource toll to its owner (at most one blocker per move). Paths must be simple. Goods have a fixed kind per city (seeded from the vertex) and a demand token that rotates in list order; a good cannot be delivered to the city it was loaded at (random play showed a same-city loop worth 10 VP a game). Same-turn free steps are 2; extra steps cost grain up front.
- **Core.** The `onSeven` hook runs for every module (a Robber's Rest seven still advances the raider counter). `legalActions` now calls `extraActions` for non-current players in the action phase too (the boot on an acceptance), so modules check the current player themselves. `stealTargets` counts module cards (a player holding only commodities can be robbed).
