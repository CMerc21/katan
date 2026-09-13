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

- `src/components/crown/`: `CrownBadges` (a tri-track badge per player with level-3 markers and metropolis crowns, commodity / progress / knight / wall / defender / merchant counts, revealed VP cards) and the `FleetTrack` over the board (seven steps, the ship token, attack count, odds, last event die); `CrownActions` (buttons `knight`, `knight-act`, `improve`, `wall`, `progress`, the commodity hand row and the progress hand row where the development cards used to be); `KnightMenu` (activate / promote / move / displace / chase with reasons), `ImprovementSheet`, `ProgressSheet` (player, card and dice pickers; board modes for hex/vertex/edge cards), and the prompt dialogs (`DowngradeDialog`, `MetropolisDialog`, `DeserterDialog`, `FreeKnightDialog`, `RetreatDialog`, `DiscardProgressDialog`, `SpyDialog`, `CommercialSwapDialog`, `GiveCardsDialog`). `DiscardDialog` gains commodity steppers; the trade dialog's bank tab is driven by the legal list (commodities, 2:1 through trade level 3, the merchant or a Merchant Fleet). Dev-card UI is hidden under the module.
- `src/board3d/Crown3d.tsx`: knight figures (a shield with 1–3 pips, laid back and greyed when inactive), wall rings, metropolis crowns in the track colour, the merchant; `Interaction` target modes `knight | knightAct | knightMove | knightDisplace | wall | metropolis | downgrade | retreat | progress:<card>` with two-step picks for Inventor, Diplomat and Smith, `data-target` values and the sr-only pieces `knight`, `wall`, `metropolis`, `merchant`. The dice tray shows the red die and a third event die (sail / cloth / coin / paper faces), in 3D and in the DOM tray.
- `eventQueue.ts` (`applyCrownEvent`) applies every Crown event to the rendered view, with crown-aware base cases (commodities in `stole` / `discarded` / `maritimeTrade`, Medicine-priced cities); three reconstruction tests compare the rendered view with `redact()` over long crown games.
- `SupabaseDriver` prefers the server's legal list when the `game_views` row carries one (`legal jsonb`, migration `0006_game_views_legal.sql`; `refreshViews` writes it), so the Spy prompt works online; the hotseat driver already uses the engine's full list.
- Cards: `cards.tsx` has commodity faces and progress card faces with track crests; copy lives in `labels.ts` (`PROGRESS_CARD_HELP`, track and commodity labels, event die labels).

## 6. Tests

- Engine (`packages/engine/test/crown-*.test.ts`, `crown-helpers.ts` fixtures): `crown-production` (13: yields per terrain, the robber, the commodity bank running short, discards and steals with commodities, maritime ratios, the event die, the red-die/level draw table, track draws, the hand limit, science aid), `crown-improvements` (4), `crown-knights` (9: build, activate, promote incl. the politics rule and supply, move, displace and retreat, chase, blocking, Longest Road broken and healed, the first-attack rule), `crown-fleet` (7: chip, exhausted supply, ties, raids with prompt and auto downgrade, metropolis and no-city immunity, walls lost, knights stood down), `crown-walls` (2: limits, thresholds 9/11/13), `crown-victory` (2: the VP terms, a win at 13), `crown-progress` (26: timing, every card, the listing/apply loop), `crown-property` (50 random games: resources 95, commodities 36, knight pieces ≤ 2 per level, walls ≤ 3 and only on own cities, metropolis cities are cities, VP recount; cap 1500 turns for the random driver). The base and Phase 9/10 suites are unchanged with `crown` off.
- Bots: 50 mixed games on Crown & Castle — Standard with improvements, knights, an attack with a downgrade and a Defender award; hard beats medium in the tournament; a Tides + Crown scenario completes 50 games (see §4).

## 13. Decisions and deviations

- **No development cards**: `init` empties `state.devDeck`, so buying is `DECK_EMPTY` and no knight card exists; Largest Army therefore never moves.
- **Science deck has 17 cards**: the spec's own list sums to 17 (`PROGRESS_DECKS`).
- **Hook order**: the event die resolves after production (or after a seven's discards were set up); its prompts wrap whatever phase is current. `fleetAttacked` is emitted before the awards and downgrades, then `knightsDeactivated`.
- **Merchant** 2:1 needs the owner to still touch the hex; commodities never trade at 3:1.
- **Science aid** is skipped when the player is already owed gold-field gold.
- **Knights**: a knight built, placed, or activated this turn (Warlord included) acts next turn; a retreating knight keeps its active flag; own pieces are passable on the network (ships included), opposing buildings and knights are not. `RETREAT_KNIGHT { vertex: null }` is always offered; with no legal retreat the knight is removed without a prompt.
- **Metropolis** with no eligible city (every city carries another track's metropolis) stays where it is. **Downgrade** without a settlement piece in supply drives `pieces.settlements` to −1 until a city is rebuilt (conservation holds).
- **Progress cards**: Alchemist only before the roll; politics cards, Inventor, Irrigation and Mining before or after; trade cards, Crane, Engineer, Medicine, Road Building and Smith only after. Bishop respects the first-attack rule (`ROBBER_LOCKED`) and steals automatically. Cards that happen to do nothing (Warlord with no knights, Saboteur with nobody richer …) may still be played, except Road Building (`NO_LEGAL_ROAD`). Master Merchant takes two *random* cards (the spec's "of your choice" is not implemented). Deserter skips the placement prompt when no piece or vertex is available. Diplomat's "open road" has an end with no other piece of its owner; a relocation must be a legal road edge after the lift. Wedding gifts are enumerated as every multiset of the count. Smith promotes in payload order with supply tracked step by step. Merchant may sit on any touched land hex. Intrigue and Deserter re-evaluate Longest Road.
- **Spy** reveals the target's cards through the server's legal list only; a client computing legal actions from its redacted view never sees them, so the UI uses the server's list for that prompt.
- Error codes: a wall on a walled city → `VERTEX_OCCUPIED`, on a settlement → `NOT_A_CITY`; `BUILD_KNIGHT` without `vertex` → `INVALID_PAYLOAD`. Module build actions are offered only in the action phase (not in the 5–6 player special build).
- **Core**: `stealTargets` counts commodities; `onSeven` runs for every module (a raiders/crown mix is refused anyway); `crown.alchemist` is visible in redacted views before the roll.
