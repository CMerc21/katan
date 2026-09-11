# Phase 4 — Online Multiplayer (Supabase)

Companion to `CLAUDE.md`, `docs/rules.md`, `docs/phase2.md`, `docs/phase3.md`. Phase 4 adds a `SupabaseDriver` behind the Phase 3 `GameDriver` interface so players in different places can play the same game. §10 lists what was verified here and what still needs a Supabase stack.

## 1. Principles

1. The server holds the only real state. Clients never write `games.state`; they submit actions and an Edge Function validates and applies them.
2. Clients only ever receive redacted state. Redaction happens server-side per player (`game_views`) and is enforced by Row Level Security.
3. Every state change is one Postgres transaction with `select … for update` plus an `expectedVersion` check, so concurrent submitters cannot fork the game.
4. The engine is one package on both sides. `packages/server` (engine + bots + transactions) is bundled into `supabase/functions/_shared/katan.bundle.js` by `pnpm build:functions`; the web client imports the engine directly for local hints only.

## 2. Schema

`supabase/migrations/0001_games.sql`: `games` (full state, service role only), `game_players`, `game_actions`, `game_views` (one redacted view per player), the `is_game_member(uuid)` helper, RLS policies, indexes on `game_views(user_id)`, `game_players(user_id)`, `game_actions(game_id, index desc)`, and Realtime on `game_views` only. Player ids inside `GameState` are `seat-<n>`.

### 2.1 Row Level Security

- `games`: no client privileges at all (`revoke all … from anon, authenticated`).
- `game_players`, `game_actions`: `select` for members of that game.
- `game_views`: `select` where `user_id = auth.uid()`.
- No client `insert`/`update`/`delete` anywhere.

`packages/server/test/rls.test.ts` runs the real migrations on a plain Postgres with a stubbed `auth.uid()` and asserts, as the `authenticated` role with another user's JWT subject, that another player's `game_views` row is invisible, that `games` is unreadable by anyone, that outsiders see nothing, and that every client write fails with `insufficient_privilege`.

## 3. Edge Functions

All functions are thin Deno handlers in `supabase/functions/<name>/index.ts` over `_shared/handler.ts`, which verifies the JWT with the anon client, opens one `postgres` connection per isolate (`SUPABASE_DB_URL`), parses the body, and returns `{ ok: true, … }` or `{ ok: false, code, message }` using the engine's `RuleError` codes plus transport codes (`packages/server/src/errors.ts`): `UNAUTHORIZED`, `BAD_REQUEST`, `GAME_NOT_FOUND`, `NOT_A_MEMBER`, `GAME_NOT_ACTIVE`, `VERSION_CONFLICT`, `NOT_YOUR_SEAT`, `NOT_HOST`, `INVALID_CODE`, `LOBBY_FULL`, `ALREADY_JOINED`, `COLOR_TAKEN`, `TOO_FEW_PLAYERS`, `NOT_READY`, `NOT_ABSENT`, `BOT_CAP`.

### 3.1 `apply-action` — `applyActionForUser` in `packages/server/src/game-service.ts`

Input `{ gameId, action, expectedVersion }`. In one transaction: lock the game row; require `status = 'active'`; compare `version` with `expectedVersion` (`VERSION_CONFLICT`); require `action.playerId` to be the caller's seat (`NOT_YOUR_SEAT`, also when a bot currently holds that seat); `engine.applyAction`; run the bot loop while the next actor is a bot (cap 200, reported as `botCapHit`); append one `game_actions` row per applied action; update `games` (`version += n`, status `ended` on a winner) and the `lobbies` projection; rewrite every player's `game_views` row with `engine.redact`. Returns `{ version, applied, botCapHit }`.

### 3.2 `create-game` — `createGameForUsers`

Creates an active game with fixed seats (humans by user id, bots by level), the initial views, and runs the bot loop once in case seat 0 is a bot. Used by tests and `scripts/seed-local.mjs`; the lobby replaced the planned `/dev/new-game` page (Phase 5 was built in the same pass).

### 3.3 `replay-check` — `replayCheck`

Rebuilds the state from `seed` + `game_actions` and compares it with `games.state` using canonical JSON (jsonb does not preserve key order). Returns `{ equal, version, actions, difference }`.

## 4. Realtime

`SupabaseDriver` subscribes to `postgres_changes` on `game_views` filtered by `game_id` and keeps only rows whose `player_id` is its own (RLS already guarantees this). Every event replaces the local view wholesale; a view with an older `version` than the current one is ignored. On `SUBSCRIBED` (initial and every reconnect), on `window` `online`, and on tab visibility, the driver refetches the row directly. Only `game_views` (and, for Phase 5, `game_players` and `lobbies`) are in the publication; never `games`.

## 5. `SupabaseDriver` (`apps/web/src/driver/supabase.ts`)

- `subscribe` — initial fetch plus Realtime as above.
- `legalActions()` — `engine.legalActionsForView(view)`: the engine rebuilds a state from the redacted view (`viewToState`) with placeholders for hidden information. No exception was found: legality for the viewer depends only on their own hand and cards, the deck *size*, public pieces and the phase; steal targets are computed server-side when the robber moves. `packages/engine/test/view.test.ts` asserts equality with the authoritative list for every player at every step of a random game.
- `dispatch(action)` — POST to `apply-action` with `expectedVersion = view.version`. On `VERSION_CONFLICT` the driver refetches and returns the code; the UI shows "The board updated. Try again" and never retries automatically. Network failures return `NETWORK`, flip the connection state and refetch.
- `me()` — the logged-in user's seat, fixed for the session. The driver has no `pendingHandoff`, so the hotseat overlay never appears.

The driver talks to a small `GameApi` interface; `createSupabaseApi` implements it with supabase-js, and `apps/web/test/supabase-driver.test.ts` runs the driver against a fake transport with a real engine behind it (conflict handling, network errors, reconnect refetch, stale-event drop).

## 6. Auth

Magic link or 6-digit email code via `supabase.auth.signInWithOtp` / `verifyOtp` on `/login`; `useRequireSession` redirects unauthenticated visits to `/login?next=…` and back. `display_name` is stored in `auth.users.raw_user_meta_data`.

## 7. Routes

`/play/[gameId]` (SupabaseDriver), `/play` (hotseat, unchanged), `/hotseat` (start form), plus the Phase 5 lobby routes. `/dev/new-game` was not built; the lobby covers it.

## 8. Local development

```
supabase start
supabase db reset
pnpm build:functions
supabase functions serve --env-file .env.local
pnpm seed:local        # two users + a game vs a medium bot
pnpm --filter web dev
```

`.env.example` lists the client and function variables. The service role key is never committed.

## 9. Tests

- RLS: `packages/server/test/rls.test.ts`.
- `apply-action`: `packages/server/test/apply-action.test.ts` — valid action advances version and rewrites views; rule error leaves version and log untouched; stale `expectedVersion` → `VERSION_CONFLICT`; two concurrent valid actions → exactly one succeeds; ended game refused; bot loop plays until a human must act and is capped.
- `replay-check` equals `games.state` after a scripted 20-action game and detects a corrupted state.
- `SupabaseDriver`: mocked-client tests as in §5.

The server tests run against a plain local Postgres (`KATAN_TEST_DB_URL`) with the real migrations; the harness stubs `auth.users`, `auth.uid()`, the `anon`/`authenticated` roles and the `supabase_realtime` publication.

## 10. Done criteria and what remains

Verified in this environment: schema, RLS, transactional apply-action with concurrency, replay, bot loop, driver semantics, production build.

Not verifiable here because the dev container has no Docker (so no `supabase start`) and no Deno: running the Edge Function handlers, Realtime delivery, magic-link auth, and the two-browser end-to-end game. `apps/web/e2e/online.spec.ts` covers that flow and skips unless `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `E2E_SUPABASE_SERVICE_ROLE_KEY` are set. Run it against a local stack or the Phase 6 project to close the "two browsers play to a win" and "kill the socket mid-game" criteria.

## 11. Decisions and deviations

- `packages/server` holds all transactional logic and is bundled (esbuild) for Deno rather than importing workspace packages from the functions directory; Deno cannot resolve the engine's extensionless relative imports without a bundle.
- The functions use a direct Postgres connection (`npm:postgres`) because supabase-js has no transactions; `SUPABASE_DB_URL` must point at the pooler in production.
- A seat handed to a bot keeps its `user_id` so the human keeps reading their own view and can reclaim the seat (Phase 5 §4); `apply-action` refuses human actions on a bot-held seat.
- `game_players` and a `lobbies` projection table are also published for the lobby (Phase 5); `games` never is.
