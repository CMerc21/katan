# Phase 5 — Lobby, Resilience, and AI Bots

Companion to `CLAUDE.md`, `docs/rules.md`, `docs/phase2.md` through `docs/phase4.md`. Phase 5 makes the game usable by friends without a developer in the room, and adds bots so a game can start with fewer than three humans (or none, for testing). §10 lists deviations and what still needs a Supabase stack to verify.

## 1. Lobby flow

```
/  ──────────► Create game ──► /lobby/[code]  ──► (host presses Start) ──► /play/[gameId]
   └─ Join with code ─────────► /lobby/[code]  ──┘
   └─ Invite link /join/[code] ► /lobby/[code]  ──┘
```

- **Create** (`create-lobby`): host picks board and max players (3–4). A `games` row with `status = 'lobby'`, a 6-character join code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), unique among non-ended games (partial unique index; the function retries on collision), and the host in seat 0.
- **Join** (`join-game { code }`): requires login. Idempotent for members; otherwise takes the next free seat and free colour. Refuses full (`LOBBY_FULL`) and active/ended games (`GAME_NOT_ACTIVE`, `INVALID_CODE`).
- **Lobby screen** (`/lobby/[code]`): seats (name, colour, human/bot with level, ready), the join code big and copyable, an invite-link button, board and player-count summary. Host: add bot (level), remove seat, start. Everyone: ready toggle, rename, take a free colour, leave.
- **Start** (`start-game`): enabled with 3–4 seats and every human ready; `engine.createGame` with the seats' names and colours, `status = 'active'`, initial `game_views`, and the bot loop runs once in case seat 0 is a bot. Lobby pages watch `game_players` and the `lobbies` projection over Realtime and navigate to `/play/[gameId]` when the status flips.
- **Leave** (`leave-game`): frees the seat; the earliest-joined human becomes host; an empty lobby ends.

### 1.1 Schema additions (`supabase/migrations/0002_lobby.sql`)

`games.join_code`, `games.host_user_id`, `games.max_players`, `games.board`; `game_players.ready`, `bot_level`, `last_seen_at`, `joined_at`; the client-readable `lobbies` projection table (no state, no seed) with `lobby_games` as a `security_invoker` view over it; Realtime on `game_players` and `lobbies`.

Edge Functions: `create-lobby`, `join-game`, `set-ready`, `set-seat`, `add-bot`, `remove-player`, `start-game`, `leave-game`, plus `hand-to-bot` (with `reclaim: true`), `botify-absent`, `abandon-game`, `heartbeat`. All logic is in `packages/server/src/lobby-service.ts`.

## 2. Presence and reconnect

Realtime Presence on the per-game channel tracks `{ playerId, userId, connectedAt }`; the players panel shows a connected/disconnected dot per human. The driver also calls `heartbeat` every minute to keep `game_players.last_seen_at` fresh for the absent-player rule. On reconnect, tab wake or `online`, the driver refetches `game_views` before trusting any event (see `docs/phase4.md` §4). `/` lists "Your games" from `lobby_games` (RLS: games you are in), so a game can be reopened from any device.

## 3. Waiting states

`BottomBar.waitingText` always names who the game waits for and for what: "Waiting for Bo (bot) to roll", "… to place a settlement", "… to discard", "… to move the robber", "… to respond to your trade", "… to build, trade, or end their turn". Opponents with an open offer see a non-blocking Accept / Decline card; the offerer sees "Declined: …" as responses arrive and can withdraw. On a 7 everyone who owes sees the discard dialog at once; everyone else sees who is still deciding.

## 4. Stuck-game escape hatches

- **Let a bot play for me** (`hand-to-bot`): converts my seat to a bot (default medium) and runs the bot loop immediately; the seat keeps my `user_id` so I still see my view and can **Take my seat back** (`reclaim: true`). While a bot holds my seat the board is inert and the bar says so.
- **Bot-ify an absent player** (`botify-absent`, host only): allowed when the target is human, is the player being waited on (`engine.nextActor`), and was last seen 10+ minutes ago. Logged in the game log. The players panel offers the button only when those conditions hold client-side; the server re-checks.
- **Abandon game** (`abandon-game`, host only): status `ended`, `phase = ended`, no winner; every view updates and the ended overlay shows.

## 5. Error handling and copy

`errorText(code)` maps every engine `RuleError` code and every transport code to a short sentence; disabled buttons use it as tooltip text and rejected dispatches show it in the bar. Network failures show "Couldn't reach the game server. Retrying…" and refetch; the board is never left half-applied because the client only ever renders server views.

## 6. AI bots (`packages/bots`)

### 6.1 Contract

```ts
type BotLevel = "easy" | "medium" | "hard";
interface BotPolicy { level: BotLevel; chooseAction(view: RedactedState, legal: Action[], rng: () => number): Action }
function createBot(level: BotLevel): BotPolicy;
```

Bots receive a `RedactedGameState`, exactly like a human, and choose from `legal` (payload-bearing choices are checked with `ensureLegal`). `botStep(state, actor, policy)` in `simulate.ts` is the single boundary the server and hotseat use: it redacts, asks the bot, and rejects any action not in the legal list. Bot RNG is `rng(seed, actionIndex)`, so bot play is part of the replay.

### 6.2 Where bots run

Server-side inside `apply-action` (and `start-game`, `hand-to-bot`, `botify-absent`) via `runBotLoop`, capped at 200 actions per request (`botCapHit` in the reply). `HotseatDriver` accepts `bots: { [playerId]: level }` for local play; the hotseat start form offers "Bot (easy/medium/hard)" per seat.

### 6.3 Evaluation helpers (`eval.ts`)

`vertexScore` (scarcity-weighted pips + diversity + matching harbor), `edgeTowardScore` (best newly reachable settlement spot within two roads), `resourceNeed` (missing cards for the next planned build), `threat` (leader and Longest Road / Largest Army pressure), plus robber and monopoly estimators.

### 6.4–6.6 Levels

Easy, medium and hard follow the spec's behaviours (`easy.ts`, `medium.ts`, `hard.ts`). Hard keeps a plan of settlement targets within three roads scored by value per road, evaluates candidate builds, purchases, card plays and useful maritime trades by applying them to a local copy rebuilt from the view and scoring the position (VP with an endgame multiplier, weighted production, plan value, distance to the next build, special-card opportunity, leader threat), and prunes to at most 60 candidates.

### 6.7 Bot tests (`packages/bots/test/bots.test.ts`)

| Test | Result here |
|---|---|
| Each level completes 100 seeded games with no illegal action and no stall | pass (easy ~10 s, medium ~15 s, hard ~50 s) |
| Tournament hard vs medium vs easy vs easy over 100 games, rotating seats | pass (hard > medium > easy per seat) |
| Determinism: same seed and opponents → identical action log and final state | pass |
| Bots only receive `engine.redact` output and out-of-list choices are rejected | pass |
| Hard `chooseAction` under 50 ms on a mid-game position | pass |

## 7. Copy and naming

Bots are named "Bot (easy)", "Bot (medium)", "Bot (hard)" by default; the host may pass a name to `add-bot`. Their log lines read like a human's. The players panel and lobby show `bot · level`.

## 8. Tests (non-bot)

- Lobby (`packages/server/test/lobby.test.ts`, real Postgres): join-code alphabet, uniqueness among non-ended games and retry on collision; seating and colours; cannot join a full or active game; start needs 3+ seats, all humans ready, and the host; seat edits; leave frees the seat, host transfer, empty lobby ends; hand to bot and reclaim; botify-absent rules; abandon.
- Playwright (`apps/web/e2e/online.spec.ts`): two browser contexts create, join by code, ready, add a bot, start, play, go offline and back, hand a seat to a bot, and reach a win. Skips without a Supabase stack.

## 9. Done criteria

- Friend with only the invite link: `/join/[code]` → login → lobby → play. Built; end-to-end run needs a stack.
- A single human can start against three bots: the hotseat form offers bot seats (verified locally), and online the host adds three bots in the lobby. Hard wins the tournament ordering test.
- Bot loop never exceeds its cap in the tournament and server tests (verified).
- Every waiting state in §3 is rendered by `waitingText`.

## 10. Decisions and deviations

- **`lobbies` table instead of a view over `games`**: Realtime cannot publish a view and `games` must never be published; the Edge Functions keep `lobbies.status`/`winner`/`host_user_id` in step inside the same transaction. `lobby_games` remains as a `security_invoker` view over it.
- **Heartbeat** is an Edge Function (`heartbeat`) rather than a client column write, keeping the "no client writes" rule intact.
- **`/dev/new-game`** was skipped; `create-game` still exists for tests and seeding.
- **Bots offer at most one trade per turn** by reading their own "offered a trade" log line, since policies are stateless.
- Verification of Edge Functions, Realtime, presence and the two-browser flow needs `supabase start` (Docker) or the Phase 6 project; see `docs/phase4.md` §10.
