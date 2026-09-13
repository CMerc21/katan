# Phase 11 — Crown & Castle (Cities Module)

The largest engine change since Phase 2. Module name in code: `crown`. When `scenario.modules.crown = true`: development cards and Largest Army are removed, three commodities and three improvement tracks are added, knights become board pieces, and a barbarian fleet periodically attacks. Win at **13 VP** by default. Requires Phase 8; composes with Phase 9 boards and most Phase 10 variants (raiders is mutually exclusive with crown).

## 1. Commodities

Three new card types alongside the five resources: **cloth**, **coin**, **paper**.

- Production for **cities** changes: on pasture, a city yields 1 wool + 1 cloth; on mountains, 1 ore + 1 coin; on forest, 1 lumber + 1 paper. On fields and hills a city still yields 2 of the resource. Settlements are unchanged.
- Commodities count toward the hand limit for discards and can be stolen. Bank stock: 12 of each.
- Maritime trade: commodities are 4:1 like resources (2:1 with the Trade track level-3 ability, §3).

## 2. Third die

Each roll adds an **event die** with six faces: three **fleet** faces, one each **trade** (cloth), **politics** (coin), **science** (paper). The two number dice stay; one of them is designated the **red die**.

- Fleet face → the barbarian fleet advances one step (§6).
- Track face → every player whose improvement level on that track is high enough draws a progress card: red die 1 never; red die `n` (2–6) → players with level ≥ `n − 1` on that track. Level 5 draws on red 2–6.
- `diceRolled` event gains `red: number; event: 'fleet' | 'trade' | 'politics' | 'science'`.

## 3. City improvements

Three tracks, each with levels 1–5. Building level `n` on a track costs `n` cards of that track's commodity (trade → cloth, politics → coin, science → paper). A player needs at least one city to build improvements; a player with no cities cannot advance (and metropolises count as cities).

Level-3 abilities:
- **Trade:** may trade commodities with the bank at 2:1.
- **Politics:** may promote knights to level 3 (§5).
- **Science:** if a roll (not 7) produces nothing for this player, they take 1 resource of their choice.

Levels 4 and 5 → metropolis (§7). Levels are shown on a small tri-track badge in the player panel.

## 4. Progress cards

Three decks (one per track), hidden; each 18 cards. Hand limit 4 progress cards (excess discarded immediately, player's choice). A player may play any number per turn, but at most one **before** rolling. VP progress cards are revealed immediately and permanently.

Card lists (counts; mechanics in one line each — write the in-game text originally):

**Trade (cloth):** Merchant ×6 (place the merchant token on a hex you touch; 2:1 trade for that resource while it stays; +1 VP while held), Trade Monopoly ×2 (all other players give you 1 of a named commodity), Resource Monopoly ×4 (all others give you up to 2 of a named resource), Master Merchant ×2 (take 2 cards of your choice from a player with more VP), Merchant Fleet ×2 (2:1 for one resource or commodity this turn), Commercial Harbor ×2 (each other player must swap a commodity for one of your resources, once each).

**Politics (coin):** Bishop ×2 (move robber, take 1 card from every adjacent player), Constitution ×1 (+1 VP), Deserter ×2 (a player of your choice removes one of their knights; you place one of equal level for free), Diplomat ×2 (remove one open road — yours may be relocated), Intrigue ×2 (remove an opposing knight adjacent to your road network), Saboteur ×2 (each player with more VP discards half), Spy ×3 (look at a player's progress cards and take one), Warlord ×2 (activate all your knights free), Wedding ×2 (each player with more VP gives you 2 cards).

**Science (paper):** Alchemist ×2 (choose the number dice before rolling; event die still random), Crane ×2 (next improvement costs 1 less), Engineer ×1 (build a city wall free), Inventor ×2 (swap two number tokens 3–5 or 9–11), Irrigation ×2 (2 grain per fields hex you touch), Medicine ×2 (city for 2 ore + 1 grain), Mining ×2 (2 ore per mountains hex you touch), Printer ×1 (+1 VP), Road Building ×1 (2 free roads), Smith ×2 (promote 2 knights one level free, politics rule still applies for level 3).

Actions: `PLAY_PROGRESS { card, payload }`, `DISCARD_PROGRESS`. Events per card.

## 5. Knights

Board pieces placed at **vertices** (not settlements) connected to the player's roads.

- Build: 1 wool + 1 ore places a level-1 (basic) knight, **inactive**. Activate: 1 grain. Promote: 1 wool + 1 ore per level, to level 2 (strong) freely and to level 3 (mighty) only with Politics level 3. Piece supply: 2 of each level per player.
- Active knights may, once each per turn, do one of: **move** along the player's connected roads to another free vertex; **displace** a weaker opposing knight (it retreats to a vertex of its owner's choice on their network, or is removed if none); **chase away** the robber from an adjacent hex (owner moves it); or **break** an opposing road by occupying a vertex on it (it no longer counts toward their longest road). Acting deactivates the knight.
- Knights block settlement placement at their vertex and block opposing roads through it.
- Knights are what the barbarians count (§6). Each player's **defense** = sum of levels of their **active** knights.
- Actions: `BUILD_KNIGHT`, `ACTIVATE_KNIGHT`, `PROMOTE_KNIGHT`, `KNIGHT_MOVE`, `KNIGHT_DISPLACE`, `KNIGHT_CHASE_ROBBER`. Events accordingly.
- The robber cannot be moved onto a hex until the fleet has attacked once (first-attack rule); before that, a 7 only causes discards.

## 6. Barbarian fleet

A track of 7 steps. Each fleet face on the event die advances it. On the 7th step the fleet **attacks**:

- Fleet strength = total cities + metropolises on the board.
- Defense = sum of every player's defense. If defense ≥ strength: the players with the single highest defense each receive **Defender of the Realm** (+1 VP, a limited supply of 6; if tied, each tied player instead draws a progress card of their choice). If defense < strength: every player with the lowest defense among those who have at least one city loses one city (downgrade to settlement; owner's choice; walls on it are lost; metropolises are immune and do not count for choosing). Players with no cities are immune.
- After any attack, all knights become inactive and the track resets.
- Events: `fleetAdvanced`, `fleetAttacked { strength, defense, result }`.

## 7. City walls and metropolises

- **Walls:** 2 brick each, on a city, max 3 per player. Each wall raises that player's discard threshold by 2 (7 → 9 → 11 → 13). Lost with the city.
- **Metropolis:** the first player to reach level 4 on a track places the metropolis of that track on one of their cities (+2 VP, immune to the barbarians). A player who later reaches level 5 on that track takes the metropolis from a level-4 holder (not from another level-5 holder). A city with a metropolis cannot be downgraded.

## 8. Victory

`settlements + 2×cities + 2×metropolis + Longest Road + Defender chips + VP progress cards + Merchant (1 if held) ≥ scenario.victoryPoints (default 13)`. Largest Army does not exist in this module.

## 9. Engine structure

- `packages/engine/src/modules/crown/` with `production.ts`, `improvements.ts`, `progress.ts`, `knights.ts`, `fleet.ts`, `walls.ts`, `victory.ts`, and `index.ts` exposing `legalActions`/`applyAction` extensions. The core dispatches to a module by scenario flags; no `if (crown)` scattered through base code — use a hook list (`beforeRoll`, `onProduction`, `extraActions`, `victoryTerms`, `discardLimit`).
- `redact` hides other players' progress cards (count only), decks, and the merchant is public.
- `GameState.crown` holds tracks, progress hands and decks, knights, walls, metropolis holders, fleet position, defender supply, merchant position.

## 10. Bots

- Planner adds an "improvement plan": pick a primary track by commodity income; target level 3 for its ability, then 4 for the metropolis if uncontested.
- Knight policy: maintain defense ≥ own fair share of fleet strength (`cities / players` rounded up) and activate knights when the fleet is within 2 steps; use chase-robber when the robber is on own best hex.
- Progress cards: play VP cards immediately; play Warlord when the fleet is within 1 step; play Saboteur/Wedding when trailing.
- Hard bot evaluates fleet risk each turn: expected steps to attack ≈ remaining / (3/6 per roll).

## 11. UI

- Commodity cards with distinct woodcut art; improvement tri-track badge; knight pieces (shield with 1–3 pips, greyed when inactive); fleet track along the top edge of the board with a ship token; wall ring around cities; metropolis crown on the city; progress card hand row beside dev cards' old spot; event die tray next to the number dice.
- Dialogs: knight action menu on click; improvement build sheet; progress card play sheet with payload pickers; downgrade-choice dialog on attack.

## 12. Tests

- One file per section, with the same rule-section naming. Production yields per terrain; draw thresholds for every red-die/level combination; each progress card; knight actions and restrictions; fleet math including ties, immunities, supply of defender chips; walls and discard thresholds; metropolis award/steal; win at 13.
- Property test: 100 bot games with `crown` on, invariants extended for commodities and knight piece counts.
- Base and Phase 9/10 suites unchanged with `crown` off; a combined tides+crown scenario completes 50 bot games.

## 13. Done criteria

- Built-in scenario **Crown & Castle — Standard** (standard frame, 13 VP) is playable online with bots, and the fleet attack visibly happens with a downgrade and a defender award across a game.
- Hard bot beats medium in the tournament test in this module.
