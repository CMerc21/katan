# Phase 10 — Wayfarers (Variants Module)

A set of small, independent rule toggles a scenario can mix. Module name in code: `wayfarers`, with one flag per variant under `scenario.variants`. Each variant is self-contained: its own engine file, tests, events, UI, and bot hooks. Build them in the order listed; each is shippable alone.

## 1. Event deck (`variants.eventDeck`)

Replaces dice with a 36-card deck matching the 2d6 distribution (one 2, two 3s … six 7s … one 12). Five of the cards also carry an event:

| Event | Effect |
|---|---|
| Plentiful harvest | Every player takes 1 resource of their choice (gold-style choice phase). |
| Robber's rest | No robber move on this 7; discards still apply. |
| Neighborly help | Every player may give one card to the player with fewest VP (optional, in seat order). |
| Tax collector | Each player with 8+ cards gives 1 to the bank. |
| Bounty | The current player takes 1 resource from the bank. |

The deck is shuffled with the seed; when the "reshuffle" card (placed 5th from the bottom) is drawn, the deck is rebuilt after that roll. `ROLL` draws instead; `diceRolled` event carries `card: { total, event? }`. Bots: no change (they can't see the deck).

## 2. Fishing (`variants.fishing`)

- Board: a **lake** hex (new terrain `lake`, replaces the desert in the built-in scenario) and **fishing grounds**: sea/frame edges marked in the editor with a number token (`HarborDef`-like `FishingGroundDef { edge, token }`).
- On the token's roll, each settlement on the ground's vertices draws 1 fish token, cities 2, from a fish bag: 11×1, 10×2, 8×3 fish, plus 1 old boot. Lake: settlements draw 1, cities 2, on **any** 2, 3, 11, or 12.
- Fish spend (any number per turn): 2 → move the robber to the desert/lake (or off-board); 3 → steal 1 card from any player; 4 → take 1 resource from the bank; 5 → build a road free; 7 → buy a dev card free (or a free settlement upgrade to city if no deck).
- Old boot: −1 VP while held; may be passed to any player with ≥ your VP when trading with them (it rides along with the trade). Win check counts it.
- Actions: `SPEND_FISH { option, payload }`, `PASS_BOOT` embedded in `ACCEPT_TRADE`. Events: `fishDrawn`, `fishSpent`, `bootPassed`.
- Bots: spend fish greedily on the highest-value option they can afford this turn; pass the boot whenever a trade allows.

## 3. Rivers (`variants.rivers`)

- Editor: mark edges as **river** segments (an edge attribute). A settlement/city with ≥ 1 river edge is riverside.
- Rules:
  - Building a road along a river edge costs an extra 1 brick (bridge).
  - The player with the most river roads (≥ 3) holds **Bridge Builder** (+1 VP, transfers on strict exceed).
  - The player with the fewest gold coins (below) holds the **Poor Settler** (−2 VP); coins: 1 per riverside settlement, 2 per riverside city, awarded each time that player's turn ends. Ties → nobody holds it.
- Events: `bridgeBuilt`, `coinsAwarded`, `chipMoved`. Bots: add river adjacency to `vertexScore` when this variant is on.

## 4. Harbormaster (`variants.harbormaster`)

Harbor points: 1 per settlement and 2 per city on a harbor vertex. First to 3 harbor points takes the **Harbormaster** chip (+2 VP); transfers on strict exceed. Replaces nothing. Tiny; bots add harbor weight.

## 5. Raiders (`variants.raiders`)

A cooperative-defense variant on coastal hexes.

- Each player's setup includes 1 **castle** (upgrade of one settlement, +1 VP, immune to raids); castles cannot be captured.
- A raider counter starts at 0; on every 7 (before robber), it advances by the number of cities on the board. At 15, the raiders land: for each coastal land hex, compare raider strength (hexes adjacent producing that turn: 1 per settlement, 2 per city touching it) to defense (knights, below). Undefended hexes become **raided**: they produce nothing until a player pays 1 ore + 1 wool to rebuild them (and gains 1 VP for doing so). Counter resets.
- Knights: cost 1 ore + 1 wool; placed on a land hex the player touches; each contributes 1 defense to that hex. After a raid, knights on raided hexes are removed. Max 6 per player.
- Actions: `BUILD_KNIGHT { hex }`, `BUILD_CASTLE { vertex }` (setup only), `REBUILD_HEX { hex }`. Events: `raidersAdvanced`, `raid`, `hexRebuilt`.
- Bots: place knights on their highest-pip coastal hexes when the counter ≥ 10.

## 6. Caravans (`variants.caravans`)

- Three **oases** (editor-marked land hexes producing nothing but holding a caravan start). Three caravan tracks of 3 roads each, extended one step whenever any player builds a road adjacent to the caravan's current end **and** pays 1 spice; spice is a 6th resource produced by oasis-adjacent settlements on the oasis's token.
- Roads and settlements adjacent to a caravan track: roads count double for Longest Road; settlements produce +1 on any roll of the adjacent hexes' numbers.
- Actions: `EXTEND_CARAVAN { caravan, edge }`. Events: `caravanExtended`. Bots: pay spice whenever a caravan can be pulled toward their roads.

## 7. Wagons (`variants.wagons`)

- Each player has a **wagon** piece that moves along roads (any player's roads; 2 steps per turn, 1 more per grain paid). Wagons carry up to 2 **commodities** picked up at cities (marble, glass, sand, or tools — abstract types produced 1 per city per turn end) and delivered to a city of another player for VP: 1 VP per delivery, +1 VP if the delivered commodity matches that city's demand token (rotating).
- Wagons on a road segment block enemy wagons from passing unless a toll of 1 resource is paid to the blocker.
- Actions: `MOVE_WAGON { path }`, `LOAD_COMMODITY`, `DELIVER`. Events: `wagonMoved`, `delivered`.
- Bots: greedy nearest-delivery planner.

## 8. Scenario integration

- `scenario.variants: { eventDeck?, fishing?, rivers?, harbormaster?, raiders?, caravans?, wagons? }`. Editor **Scenario** tab shows a toggle per variant with a one-paragraph plain-language rule summary (write these from the sections above; no borrowed text).
- Editor tools added: lake terrain, fishing-ground edges, river edges, oasis marker. All stored in `HexDef.extras` / new `edges: EdgeDef[]` on `BoardDefinition`.
- Built-in scenarios: **The Great Lake** (fishing + harbormaster), **River Country** (rivers + event deck), **Coastal Watch** (raiders), **Salt Road** (caravans + wagons, 6 players).
- VP target per scenario; variants that add VP sources default to 12–13.

## 9. Tests

- One suite per variant, base suite must pass with all variants off, and a combined "all on" property test of 100 bot games for invariant checks (bank totals now include spice and fish separately; VP math includes chips and boot).
- Editor Playwright: mark a river, a fishing ground, an oasis; save; start each built-in scenario.

## 10. Done criteria

- Each built-in scenario completes with bots and is playable online.
- Every variant can be toggled independently without breaking another.
