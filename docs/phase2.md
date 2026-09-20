# Phase 2 — Full Rules Engine

Companion to `docs/rules.md` (rules) and `CLAUDE.md` (phase plan). This document pins down the engine's data shapes and action catalog. Section references (§) point at `docs/rules.md`. Where the implementation deliberately differs from the original spec, the difference is listed in §8.

## 1. GameState shape

Everything below is plain JSON. No classes, no `Date`, no `undefined` (use `null`).

```ts
type Resource = "wood" | "clay" | "wool" | "grain" | "ore";   // names from docs/rules.md §2.1
type Hand = Record<Resource, number>;
type DevCardType = "knight" | "victoryPoint" | "roadBuilding" | "invention" | "monopoly";

interface GameState {
  version: 1;
  seed: string;
  boardKind: "beginner" | "random";
  board: Board;                   // from Phase 1
  actionIndex: number;            // count of applied actions; drives seeded RNG
  turn: number;                   // number of END_TURN actions applied so far (§1.2)
  phase: Phase;
  players: Player[];              // seat order
  currentPlayer: number;          // index into players
  bank: Hand;                     // starts 19 each
  devDeck: DevCardType[];         // hidden; top = index 0
  robberHex: HexId;
  lastRoll: [number, number] | null;
  longestRoad: { playerId: string | null; length: number };
  largestArmy: { playerId: string | null; count: number };
  pendingTrade: TradeOffer | null;
  pendingDiscards: Record<string, number>; // playerId -> count still owed
  winner: string | null;
  log: LogEntry[];                // human-readable UI feed, last 100 entries
}

interface Player {
  id: string;
  name: string;
  color: "red" | "blue" | "orange" | "white";
  hand: Hand;
  devCards: { type: DevCardType; boughtOnTurn: number }[];
  playedKnights: number;
  devCardPlayedThisTurn: boolean;
  pieces: { roads: number; settlements: number; cities: number }; // remaining in supply
  roads: EdgeId[];
  settlements: VertexId[];
  cities: VertexId[];
}

interface TradeOffer {
  from: string;
  give: Hand;
  receive: Hand;
  rejectedBy: string[];           // clears once every other player has declined
}
```

### 1.1 Phase state machine

```ts
type Phase =
  | { kind: "setup"; round: 1 | 2; step: "settlement" | "road"; lastSettlement: VertexId | null }
  | { kind: "roll" }
  | { kind: "discard" }                                 // waiting on pendingDiscards
  | { kind: "moveRobber"; via: "seven" | "knight"; returnTo: "roll" | "action" }
  | { kind: "steal"; hex: HexId; targets: string[]; returnTo: "roll" | "action" }
  | { kind: "action" }
  | { kind: "roadBuilding"; remaining: 1 | 2 }
  | { kind: "ended" };
```

Every action lists which `phase.kind` it is legal in. Any mismatch → `WRONG_PHASE`. `returnTo` records where play resumes after the robber: `roll` when a knight was played before rolling, otherwise `action`.

### 1.2 Turn counter

`turn = number of END_TURN actions applied so far` (setup does not count). Used for the "no dev card on the turn it was bought" rule.

## 2. Action catalog

All actions carry `{ type, playerId }`. `playerId` must equal `players[currentPlayer].id` unless marked **(any player)**.

| Type | Phase | Payload | Key checks | Error codes |
|---|---|---|---|---|
| `ROLL` | roll | – | – | `WRONG_PHASE`, `NOT_YOUR_TURN` |
| `DISCARD` **(any player)** | discard | `cards: Hand` | player is in `pendingDiscards`; total equals owed; has the cards | `NO_DISCARD_OWED`, `WRONG_DISCARD_COUNT`, `INSUFFICIENT_RESOURCES` |
| `MOVE_ROBBER` | moveRobber | `hex: HexId` | hex exists; hex ≠ current robber hex | `INVALID_HEX`, `ROBBER_MUST_MOVE` |
| `STEAL` | steal | `targetPlayerId: string` | target in `phase.targets` | `INVALID_STEAL_TARGET` |
| `BUILD_ROAD` | action, setup(step=road), roadBuilding | `edge: EdgeId` | §5.2; in setup must touch `lastSettlement`; supply > 0; cost (skipped in setup/roadBuilding) | `INVALID_EDGE`, `EDGE_OCCUPIED`, `ROAD_NOT_CONNECTED`, `NO_PIECES_LEFT`, `INSUFFICIENT_RESOURCES` |
| `BUILD_SETTLEMENT` | action, setup(step=settlement) | `vertex: VertexId` | §5.3 distance rule; road connection (not in setup); supply; cost (not in setup) | `INVALID_VERTEX`, `VERTEX_OCCUPIED`, `DISTANCE_RULE`, `NOT_CONNECTED_TO_ROAD`, `NO_PIECES_LEFT`, `INSUFFICIENT_RESOURCES` |
| `BUILD_CITY` | action | `vertex: VertexId` | vertex holds own settlement; supply; cost | `NOT_YOUR_SETTLEMENT`, `NO_PIECES_LEFT`, `INSUFFICIENT_RESOURCES` |
| `BUY_DEV_CARD` | action | – | deck non-empty; cost | `DECK_EMPTY`, `INSUFFICIENT_RESOURCES` |
| `PLAY_KNIGHT` | roll, action | – | has an unplayed knight not bought this turn; none played this turn | `DEV_CARD_ALREADY_PLAYED`, `NO_SUCH_CARD`, `CARD_TOO_NEW` |
| `PLAY_ROAD_BUILDING` | action | – | same card checks; supply > 0; at least one legal edge; sets phase to roadBuilding with `remaining = min(2, supply)` | as above, `NO_PIECES_LEFT`, `NO_LEGAL_ROAD` |
| `PLAY_INVENTION` | action | `resources: [Resource, Resource]` | bank has them (if bank short on one, reject whole action) | `BANK_EMPTY` |
| `PLAY_MONOPOLY` | action | `resource: Resource` | – | – |
| `OFFER_TRADE` | action | `give: Hand; receive: Hand` | both non-empty; no resource on both sides; player has `give`; no pending trade | `EMPTY_TRADE`, `INVALID_TRADE`, `INSUFFICIENT_RESOURCES`, `TRADE_ALREADY_PENDING` |
| `ACCEPT_TRADE` **(any player)** | action | – | pending trade exists and acceptor has not declined it; acceptor ≠ offerer; acceptor has `receive`; offerer still has `give` | `NO_PENDING_TRADE`, `INVALID_TRADE`, `INSUFFICIENT_RESOURCES` |
| `REJECT_TRADE` **(any player)** | action | – | pending trade exists; rejecter ≠ offerer | `NO_PENDING_TRADE`, `INVALID_TRADE` |
| `CANCEL_TRADE` | action | – | pending trade exists and is mine | `NO_PENDING_TRADE` |
| `COUNTER_TRADE` **(any player)** | action | `give: Hand; receive: Hand` | pending trade exists and I have not declined it; I am not the offerer; both non-empty; no overlap; I hold `give` (§9.1) | `NO_PENDING_TRADE`, `INVALID_TRADE`, `EMPTY_TRADE`, `INSUFFICIENT_RESOURCES` |
| `ACCEPT_COUNTER` | action | `from: PlayerId` | pending trade is mine and `from` has a counter; both sides can pay | `NO_PENDING_TRADE`, `INSUFFICIENT_RESOURCES` |
| `UNDO_BUILD` | action, specialBuild | – | `state.lastBuild` is my paid build of this turn and nothing has happened since (§5.6) | `NOTHING_TO_UNDO` |
| `MARITIME_TRADE` | action | `give: Resource; giveCount: 4|3|2; receive: Resource` | ratio matches port ownership (§9.2); has cards; bank has receive | `INVALID_TRADE`, `BAD_TRADE_RATIO`, `INSUFFICIENT_RESOURCES`, `BANK_EMPTY` |
| `END_TURN` | action | – | any pending trade is withdrawn | – |

Any action on an ended game → `GAME_OVER`. Unknown `playerId` → `UNKNOWN_PLAYER`.

`legalActions(state, playerId)` returns concrete instances — e.g. one `BUILD_ROAD` per legal edge — so the UI can highlight targets without re-implementing rules. For `OFFER_TRADE` and `COUNTER_TRADE` (unbounded payloads) it returns representative 1-for-1 offers, and for `DISCARD` one representative discard from the largest stacks; other well-formed payloads of those types are also accepted by `applyAction`. A counter's list and an `ACCEPT_COUNTER`'s list consult only the acting player's own hand, so a client computes the same list from its redacted view; the other side's ability to pay is checked when the counter is accepted.

## 3. Resolution details

### 3.1 ROLL
1. Dice = `rng(seed, actionIndex)` → two values 1–6. Stored in `lastRoll` and `log`.
2. If 7: compute `pendingDiscards` for every player with hand size > 7 (owed = floor(size/2)). If any → phase `discard`; else phase `moveRobber via seven`.
3. Else: production per §6.2 with bank shortage rule. Phase → `action`.

### 3.2 DISCARD
Remove cards, return to bank, delete from `pendingDiscards`. When empty → phase `moveRobber via seven`.

### 3.3 MOVE_ROBBER
Set `robberHex`. Compute `targets` = opponents with a settlement/city on that hex and hand size ≥ 1. If empty → skip straight to `returnTo`. Else phase `steal`.

### 3.4 STEAL
Pick a uniformly random card from the target's hand using `rng(seed, actionIndex)`. Transfer. Phase → `returnTo`. Largest Army was already recomputed when the knight was played.

### 3.5 Building
After any road or settlement: recompute Longest Road for all players (§10; an opponent's settlement can break a road). After every action: run the win check (§11) for the current player only.

### 3.6 Longest Road algorithm
For each player, DFS over their road edges from every endpoint, tracking used edges (not vertices), refusing to traverse through a vertex holding an opponent's settlement/city. Longest trail wins. Apply the §10.1 pass/return rules. Ties never transfer the card.

### 3.7 Trades
Only one `pendingTrade` at a time. `ACCEPT_TRADE` executes immediately and clears it (first acceptor wins). `REJECT_TRADE` records the rejecter; when every other player has rejected, the offer clears. `END_TURN` clears any pending trade, and so does any action after which the offerer can no longer cover the offer.

### 3.8 END_TURN
Reset `devCardPlayedThisTurn` for all; advance `currentPlayer`; increment `turn`; phase → `roll`.

## 4. `redact(state, playerId)`

Returns a deep copy with:
- Other players' `hand` replaced by `{ count: number }`.
- Other players' `devCards` replaced by `{ count: number }`.
- `devDeck` replaced by `{ count: number }`.
- Every player carries `publicVP` (buildings and special cards); `privateVP` (hidden VP cards) is set only for the requesting player and `null` for the others.
- `seed` removed; `viewer` added.

## 5. Seeded RNG

`rng(seed: string, index: number)` — deterministic PRNG (mulberry32 seeded from an FNV-1a hash of `seed` and `index`). Deck shuffle uses `index = -1`. Board generation uses `index = -2`. Never call it without an index.

## 6. Test plan

Tests are named by rule section, e.g. `"§5.3 settlement needs a road connection and the distance rule"`.

### 6.1 Unit tests (one file per section)
- `setup.test.ts` §4, `building.test.ts` §5, `production.test.ts` §6, `seven.test.ts` §7, `devcards.test.ts` §8 (incl. redact), `trading.test.ts` §9, `specialCards.test.ts` §10, `win.test.ts` §11, `contract.test.ts` §12.

### 6.2 Integration (`integration.test.ts`)
- Scripted 4-player game on the beginner board with a deterministic policy to a win, asserting the winner's VP breakdown.
- Replay: applying the action log from the seed yields a deep-equal final state.
- Redacted views leak nothing and agree with public VP.

### 6.3 Property-based (`property.test.ts`, fast-check)
200 games with a greedy-random legal action each step. Invariants after every action: bank + hands = 95; roads/settlements/cities placed + remaining = 15/5/4; distance rule; `longestRoad.length` equals an independent brute-force recomputation; every game ends within 600 turns (over forty seeds the policy's games run 80–390 turns whatever the rule set, so the earlier 400 cap was one reshuffle of the seeded stream away from a false failure).

## 7. Done criteria

All of §6 green, `pnpm lint` enforces engine purity (`no-restricted-imports`, no `Date`, no `Math.random`), and `pnpm --filter @katan/engine test` runs in under 30 seconds.

## 8. Decisions and deviations from the original spec

- **Names.** Resources are `wood | clay | wool | grain | ore` and the two-resource card is `invention`, per `docs/rules.md` and the naming rule in `CLAUDE.md`; the commercial game's card and resource names are not used.
- **`returnTo` on robber phases.** A knight played before the roll must return to the roll step, so `moveRobber` and `steal` carry `returnTo`.
- **Open offers with per-player rejection.** `TradeOffer.rejectedBy` tracks who declined; the offer clears once everyone else has. An offer the offerer can no longer pay is withdrawn automatically.
- **`lastRoll`, `boardKind`, `turn`** are stored on the state for the UI and for replay.
- **`log`** is capped at 100 entries so state clones stay cheap; the action log is the audit trail.
- **Road building** cannot be played when no road piece or no legal edge exists (`NO_PIECES_LEFT` / `NO_LEGAL_ROAD`), so the card is never wasted.
- **Win check** runs after every action for the current player, so a player who reaches 10 during an opponent's turn wins when their turn begins (§11).
