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

PLACEHOLDER_ENGINE

## 3. Built-in scenarios (`scenarios.ts`)

| Id | Board | Variants | VP |
| --- | --- | --- | --- |
| `greatLake` | The Great Lake: the standard frame with a lake at the centre, fixed harbours and three fishing grounds (tokens 5, 9, 8) between them | fishing, harbormaster | 12 |
| `riverCountry` | River Country: the standard frame with a ten-edge river winding along the middle column | rivers, eventDeck | 12 |
| `coastalWatch` | Coastal Watch: the standard island ringed by decorative sea | raiders | 12 |
| `saltRoad` | Salt Road: the Large frame with oases at `0,0`, `3,-3` and `-2,3`, 3–6 seats | caravans, wagons | 13 |

## 4. Bots

PLACEHOLDER_BOTS

## 5. Editor and client

PLACEHOLDER_UI

## 6. Tests

PLACEHOLDER_TESTS

## 7. Done criteria

- Each built-in scenario completes with bots and can be created online (the lobby accepts any built-in id; the scenario snapshot carries `variants`).
- Every variant can be toggled independently; the "all on" property test plays every variant together.

## 11. Decisions and deviations

PLACEHOLDER_DECISIONS
