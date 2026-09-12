# Phase 7 — Feel and Pacing

Companion to `CLAUDE.md`, `docs/rules.md`, `docs/phase2.md`–`docs/phase5.md` and `docs/art-direction.md`. No rule changes. Phase 7 gives the client something to animate (an event stream), paces bot turns, gives every seat a portrait and every bot a name, and re-skins the app as a medieval table. §10 lists decisions and deviations from the original spec.

## 1. Event stream

### 1.1 Engine (`packages/engine/src/events.ts`)

`applyActionWithEvents(state, action)` returns `{ state, events }`; `applyAction` remains the Phase 2 contract and returns only the state. Events are numbered by `state.eventSeq` (a new counter on `GameState`, so replay reproduces the same numbering), ordered, and typed:

`turnStarted`, `diceRolled`, `produced` (per-hex gains), `productionBlocked`, `bankShort`, `discarded` (cards only for the discarder), `robberMoved`, `stole` (resource only for thief and victim), `built`, `devCardBought` (card only for the buyer), `devCardPlayed`, `inventionTaken`, `monopolised`, `tradeOffered` / `tradeAccepted` / `tradeDeclined` / `tradeCancelled` (with a reason), `maritimeTrade`, `specialCardMoved`, `turnEnded`, `setupCompleted`, `gameEnded` (with every score), and `note` (free text from the server's escape hatches, via `appendNote`).

`state.log` is now derived: `emit()` numbers the event, hands it to the collector, and appends `describeEvent(event, names)` when it has a public sentence. Existing log texts are preserved ("Ada rolled 3 + 4 = 7", "setup complete", "offered a trade") because tests, bots and the e2e specs read them. Setup starting resources are `produced` events with the hex attributed, so cards fly from the right tile.

`redactEvents(events, viewer)` hides discard contents, the stolen resource and the bought card from third parties. `redact(state, viewer, events)` attaches the redacted events to the view as `events` (empty when not given).

### 1.2 Server

- `game_views.view.events` carries the events since the previous version, redacted per player. `runBotLoop` concatenates every bot action's events, so one version bump can carry a long sequence; `persist` writes them.
- `game_events (game_id, seq, event jsonb)` holds the whole history for replay and debugging; no client privileges (`supabase/migrations/0003_events.sql`).
- The hotseat driver does the same in memory: each emitted view carries the events from the human action plus the bot actions that followed.

## 2. Animation queue (client)

- `src/game/eventQueue.ts` is the pure core: `planSteps` turns a batch of events into timed steps, `applyEventToView` advances a rendered view one event at a time (pieces, hand and bank counts, robber, special cards, log line), and `EventQueue` is a small state machine with an injectable clock. `useEventQueue(driver, settings, isBot)` sits between the driver and the components and returns the rendered view, the latest server view, the current step, `draining` and `skip()`.
- Views arrive with `events`; contiguous ones are queued, a gap or an event that cannot be applied snaps to the server view and clears the queue. At the end of every batch the rendered view is replaced by the server view, so the screen can never drift.
- Input is disabled while draining; legal actions come from the latest server view once idle. **Skip**: click the board, press Space, or the Skip button, which fast-forwards the remaining steps at 5×.
- Settings (`src/game/settings.ts`): `Animation speed: Normal / Fast / Off`, sound, and the Phase 7.5 graphics options, in localStorage and mirrored into the auth user's metadata when signed in. `prefers-reduced-motion` forces Off.
- Timings are the table in the spec (`BASE_DURATION`); Fast divides by 3. Choreography: heraldic ribbon banner with the avatar; bone dice tumbling in a leather tray and matching tokens pulsing; resource cards flying from the hex to the player's row (or into your own hand) with an 80 ms stagger; discards to the bank; the robber hopping with a CSS transition and the blocked hex shaking; pieces popping in (road draws from one end, city rises); cards sliding from the deck; the dev card flipping centre-board; a glint on the special-card badge; restrained confetti and the winner's portrait on the end screen. Flying cards are DOM elements positioned from measured anchors (`src/components/anim/anchors.tsx`).

## 3. Bot pacing

Client-side only. Before a bot's first event of a turn the plan inserts a "thinking…" pause of 600–1200 ms seeded from the event `seq` (same on every client), a 300–500 ms beat before a bot build or trade offer, and 300 ms before it ends its turn. A bot turn lands at 3–6 s on Normal, 1–2 s on Fast, instant on Off. Humans' own actions animate unpadded.

## 4. Avatars (`packages/avatars`)

Pure and seeded. `AvatarSpec` is eleven small integers (skin 6, face 3, eyes 4, brows 3, mouth 4, hair 10 incl. none, hair colour 6, facial hair 6 incl. none, headwear 9 incl. none, garment 5, accessory 5 incl. none); `renderAvatar(spec, { color })` returns an SVG string (96×96, flat shapes, thick ink outline, garment in the player's colour); `randomAvatar(rng)`, `avatarFromSeed(seed)`, `cycleLayer`, `normalizeAvatar`.

Stored on `game_players.avatar jsonb`. Every seat gets a seeded default (`gameId:seat`); the lobby has **Shuffle** and a per-layer picker (`set-seat { avatar }`); the hotseat form has Shuffle per seat. Portraits appear in the players panel, the turn banner, the bottom bar, the trade dialog, lobby seats and the win screen.

## 5. Bot names (`packages/bots/src/names.ts`)

`generateBotName(rng, taken)` builds `first + (epithet | "of " + place)` from 60 first names, 40 epithets and 30 places, never repeating within a game. `add-bot` uses it by default (seeded from the game id and seat); the host can rename a bot (`set-seat { playerId, name }`). Difficulty shows as a small badge next to the name, never in it. The hotseat form fills bot seats with generated names.

## 6. Theme

See `docs/art-direction.md`. Walnut table, parchment panels with an SVG fibre filter, wax-seal buttons, a display face in small caps for titles and banners, humanist serif body, tabular numerals, heraldic player tinctures. Board: terrain detail passes (pines with shadows, furrows, quarried faces, kilns, sheep), clay discs with embossed numerals and a gilt ring on 6/8, timber roads with stakes, thatched cottages, stone keeps with a banner, piers with hanging harbour signs, a hooded robber with a sack. Resource cards have woodcut faces; development cards a gilt frame with a crest. Layout is unchanged from Phase 3.

## 7. Sound

`src/game/sound.ts` synthesises six short cues with WebAudio (no files): dice, card, piece, robber, turn chime, win. Off by default; muted when animations are Off.

## 8. Tests

- Engine: `test/events.test.ts` — expected event sequence per rule section, redaction for third parties, contiguous `seq`, the log equals the described events, illegal actions emit nothing.
- Server: events in views and `game_events` after a bot loop; clients cannot read `game_events`; seats carry avatars and bots get generated names; host renames a bot.
- Web: `test/eventQueue.test.ts` — ordering, reconstruction equals the engine's view, skip at 5×, Off is instant, Fast ≈ 3× quicker, snap on gaps and impossible events, seeded thinking pauses, bot-turn budget. `test/hotseat.test.ts` — views carry events.
- Avatars: determinism, coverage of every option, well-formed SVG, distinct drawings.
- Playwright: `e2e/pacing.spec.ts` — a bot turn takes 2–8 s on Normal and is instant on Off; Space skips.

## 9. Done criteria

- Every state change on Normal is preceded by an animation step; the rendered view advances only as events play.
- A four-seat game with three bots is watchable from the banner, dice, flights and pieces alone.
- Every seat has a distinct portrait; bots have generated medieval names.
- Off restores the previous instant behaviour (verified by the Playwright spec).

## 10. Decisions and deviations

- **Extra event kinds** beyond the spec list (`bankShort`, `inventionTaken`, `monopolised`, `setupCompleted`, `note`, and a `reason` on `tradeCancelled`) so the log and the animations have everything they need without reading state diffs.
- **`eventSeq` lives on the state** so replay from the action log reproduces event numbering exactly.
- **Own-hand costs during animation** are applied for `built` only when the rendered view is in the action phase (setup and road-building placements are free); the end-of-batch snap corrects any residue.
- **Framer Motion was not added**; CSS transitions and keyframes cover the choreography, and Phase 7.5 moves the board animations into the 3D scene anyway.
- **Fonts** are system stacks (`Cinzel`/`Palatino` fallbacks) rather than web fonts, so the build has no network dependency; the display face is small caps rather than true blackletter for legibility.
- **Settings sync** uses the auth user's metadata (`settings`) instead of a `user_settings` table; local storage wins when both exist.
- The 2D SVG board keeps its Phase 3 layout and becomes the thumbnail renderer in Phase 7.5.
