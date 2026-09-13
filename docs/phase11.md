# Phase 11 — Crown & Castle (Cities Module)

Companion to `CLAUDE.md`, `docs/rules.md` (§16 is new), `docs/modules.md` and `docs/phase10.md`. When `scenario.modules.crown` is on, development cards and Largest Army are gone, three commodities and three improvement tracks appear, knights become board pieces, and a barbarian fleet attacks. Win at 13 VP by default. Composes with Tides boards and every Wayfarers variant except raiders (validation refuses the pair). §13 lists decisions and deviations from the original spec.

## 1. Engine structure (`packages/engine/src/modules/crown/`)

| File | Contents |
| --- | --- |
| `common.ts` | `crownState`, `crownPlayer`, `seatOrder`, the knight / activation / wall costs. |
| `production.ts` | §1: `yieldOverride` (a city on meadow, mountain or forest yields one resource), `afterProduction` (the matching commodity, paid in seat order from the current player, `commoditiesProduced`; science level-3 aid through `ctx.gold`), `cardCount` / `stealExtra` / `discardExtra` (commodities in hand), the discard instance with commodities. |
| `trade.ts` | The `maritime` hook: commodities 4:1, 2:1 with trade level 3 or a Merchant Fleet naming the card; resources for commodities at port ratios; resource↔resource 2:1 through the Merchant Fleet or the merchant token (owned, on a hex the owner touches). |
| `progress.ts` | Decks (`createRng(seed, "crown:deck:<track>")`), `drawProgress` (VP cards revealed at once), thresholds (`drawsOnRed`: level ≥ red − 1, red 1 never), the hand limit (four unrevealed cards; the `discardProgress` prompt and `DISCARD_PROGRESS` return a card to the bottom of its deck). |
| `progressCards.ts` | The card effects behind `PLAY_PROGRESS { card, payload }` and the `deserter`, `placeFreeKnight`, `spy`, `commercialHarbor` and `giveCards` prompts (§4). |
| `improvements.ts` | `BUILD_IMPROVEMENT { track }` (n commodities for level n, the crane, at least one city), metropolis award at level 4 and the level-5 steal from a level-4 holder (`placeMetropolis` prompt when more than one city qualifies). |
| `knights.ts` | §5: `BUILD_KNIGHT { vertex }`, `ACTIVATE_KNIGHT`, `PROMOTE_KNIGHT`, `KNIGHT_MOVE`, `KNIGHT_DISPLACE` (+ the `knightRetreat` prompt / `RETREAT_KNIGHT`), `KNIGHT_CHASE_ROBBER`; `blockedVertices` (opposing knights break roads and Longest Road) and `unbuildableVertices` (no settlement on any knight); per-turn flags. |
| `fleet.ts` | §6: advance, the attack (strength = cities, defence = active knight levels), the Defender chip or tie draws, raids with the `downgradeCity` prompt / `CHOOSE_DOWNGRADE`, `downgradeCity`. |
| `walls.ts` | `BUILD_WALL` and the discard threshold 7 + 2 × walls. |
| `victory.ts` | 2 per metropolis, Defender chips, revealed VP cards, the merchant. |
| `index.ts` | `init` (state, decks, the empty development deck), `roll` (Alchemist dice, the event die from the action's seeded stream, the red die = the first number die), `afterRoll` (fleet or track draws), `onSeven` (the robber stays home until the first attack), `onTurnStart`, and the `apply` / `extraActions` / `promptActions` dispatch. |

The core stays free of `crown` checks: commodities enter the base rules through `cardCount`, `stealExtra`, `discardExtra`, `discardThreshold` and `maritime`; knights through `blockedVertices` / `unbuildableVertices`; the third die through the `roll` chain.

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
