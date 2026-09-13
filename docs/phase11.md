# Phase 11 — Crown & Castle (Cities Module)

Companion to `CLAUDE.md`, `docs/rules.md` (§16 is new), `docs/modules.md` and `docs/phase10.md`. When `scenario.modules.crown` is on, development cards and Largest Army are gone, three commodities and three improvement tracks appear, knights become board pieces, and a barbarian fleet attacks. Win at 13 VP by default. Composes with Tides boards and every Wayfarers variant except raiders (validation refuses the pair). §13 lists decisions and deviations from the original spec.

## 1. Engine structure (`packages/engine/src/modules/crown/`)

PLACEHOLDER_ENGINE

## 2. State and redaction

`GameState.crown` (`CrownState` in `modules/types.ts`): per-player commodities, track levels, progress hand, walls, metropolises, defender chips, crane / merchant-fleet flags; the commodity bank (12 each); three hidden progress decks; `knights[]`; the fleet position and attack count; the defender chip supply (6); the merchant token; the alchemist's dice; the last event die. `redact` hides the decks (counts only) and other players' progress cards (count plus their revealed victory point cards); knights, walls, metropolises, the merchant and track levels are public. `viewToState` fills the hidden parts with placeholders so `legalActions` runs on the client and in bots.

## 3. Built-in scenario

`crownStandard` — **Crown & Castle — Standard**: the standard frame, 13 VP, no development cards.

## 4. Bots

PLACEHOLDER_BOTS

## 5. UI

PLACEHOLDER_UI

## 6. Tests

PLACEHOLDER_TESTS

## 13. Decisions and deviations

PLACEHOLDER_DECISIONS
