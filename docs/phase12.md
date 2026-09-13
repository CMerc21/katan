# Phase 12 — HUD Rework

Presentation only: the rules engine, the drivers and the Edge Functions are untouched. The in-game screen is now one full-bleed diorama with a single HUD layer over it, laid out like a modern digital tabletop: player banners across the top, an icon-only resource tray at the bottom, a left rail of square icon buttons, round action buttons bottom right, and every reference or status panel as a dark translucent overlay on the wooden table. The old parchment sidebar, bottom bar and text button row are gone; their last state is the git tag `hud-legacy`.

## 1. Layer and grid (`src/hud/HudLayer.tsx`)

`GameScreen` renders `Board3D` in an absolutely positioned `<main>` that fills the viewport and `HudLayer` over it. The layer is a CSS grid (`.hud-layer` in `src/styles/hud.css`): a 120 px top row, a 96 px bottom row, an 80 px left column, 16 px outer margin. `pointer-events: none` on the layer; only interactive children (`.hud-interactive`, the buttons, the panels) take pointer events, so the canvas keeps its raycasting everywhere else.

Regions: `hud-banners` (top, `PlayerBanner` × N, flex-wrap), `hud-rail` + `hud-side` (left), `hud-bottom` (a three-column row: `BuildCostCard` · `ResourceTray` with the dice widget, the mode hint, the trade response and the module strip above it · `ActionButtons`). Overlays: the status line (`data-testid="banner"`, docked under the top row), `TurnBanner`, `EventToast`, `HelpTip`, and the Wayfarers pill (raider counter, event deck) at the top right.

Minimum viewport is 1280 × 720. Banners shrink from 400 px to 288 px so four fit beside the camera button; below the minimum they collapse to portrait + VP (`@media` in `hud.css`). No HUD element covers the central hex at 1280 × 720.

## 2. Tokens (`src/styles/hud.css`)

`--hud-panel`, `--hud-panel-solid`, `--hud-border`, `--hud-radius`, `--hud-text`, `--hud-text-dim`, `--hud-accent` (gold), `--hud-font` (Oswald / Barlow Condensed / system fallback; no font is downloaded), `--hud-parchment` (the cost card only) and the `--player-*` tints. Rules: every panel is `.hud-panel` (dark, translucent, blurred); numerals are `.hud-num` (white, bold, condensed); player colours appear only as banner borders, ribbons and piece tints; parchment is reserved for the cost card. `.hud-dark` restyles the shared `Button`, `Modal`, checkboxes and the ink text tokens for dark chrome, so the existing dialogs, sheets and prompts (discard, gold, resource picker, the knight menu, the improvement and progress sheets, the Crown prompts, the fish sheet, the end screen, the handoff) simply swapped `parchment` for `hud-panel hud-dark`.

Banner tints (`HUD_PLAYER_COLOR`) match the pieces on the table; argent (white) gets a slate ribbon so the white name stays legible.

## 3. Components

* `PlayerBanner` — 400 × 110 (shrinks to 288 wide). VP badge (36 px gold circle, top-left of the portrait), gold turn marker (200 ms scale-in) for the acting player, 72 × 72 portrait with a 4 px player-colour border, two pills hanging under it (Crown: active knights / defence; base: knights played / longest road), the name ribbon (`clip-path` flag, bot glyph with the difficulty tag underneath, presence dot online, the hand as up to three tiny cards with a numeral over 3), and the stat block: Roads · Largest Army (base) or Defence (Crown) · Knights · Dev / Progress cards · City improvements (Crown only; its icon is the tri-track). A column glows gold while the player holds the matching title. A thin gold progress bar runs under the ribbon for the length of a bot's thinking pause. Wayfarers badges, island pennants and the host's "let a bot play" control ride in an extra row under the block (those variants carry state the five columns do not cover). Hover for 300 ms → the detail tip (goods, progress cards, tracks and abilities, walls, pieces left, fish/coins/guards/spice/deliveries). Banners are ordered by seat with the local player first. Test ids: `player-row-<id>` (`aria-current` while acting), `vp-<id>`, `knights-<id>`, `defense-<id>`, `tracks-<id>`, `bot-badge-<id>`, `presence-<id>`, `thinking-<id>`, `emote-bubble-<id>`.
* `ResourceTray` — 640 × 72, eight cells (Wood, Clay, Wool, Grain, Ore, Cloth, Coin, Paper; the last three only under Crown & Castle): 26 px numeral + 28 px icon, no label; zero cells at `--hud-text-dim`. `data-testid="hand"` wraps the five resource cells (`[data-resource]`, `aria-label="N Wood"`), `commodities` the three commodity cells, so the existing specs read them unchanged. While the trade panel is composing an offer a resource cell is clickable and adds one card to the "give" side (`TradeDialog` accepts a controlled `give`). The cells register the `hand:<card>` anchors for flying cards. Before the hotseat handoff the tray shows dim icons with no numbers and no `hand` wrapper.
* `LeftRail` + `SidePanel` — seven 48 px buttons (Chat, Emote, Log, Stats, Rules, Settings, Leave; `rail-<key>`, the Settings one keeps `data-testid="settings"`). Each opens a 280 px dark panel that slides in from the left (200 ms), never a modal; Esc or ✕ closes. Chat is local to this screen (no transport yet; the messages are state in the layer). Emote shows a bubble over your banner for 2.5 s. Log is the old log panel, newest first; while closed the same list is rendered `sr-only` so `data-testid="log"` is always in the page. Stats: a per-player table, the titles and a 2–12 roll histogram. Rules: this scenario's summary and special rules, build costs, titles, the Crown tracks, the active Wayfarers variants. Settings: the old menu's body (`SettingsBody` in `src/hud/SettingsMenu.tsx`, same test ids) plus the key list. Leave: the online escape hatches (`hand-to-bot`, `reclaim-seat`, `abandon`) and a confirmed "Leave the table".
* `DiceWidget` — above the tray's left end: the current roll (the DOM dice tray with `dice-tray`, `red-die`, `event-die`, `event-card`, moved from `anim/effects.tsx`) and a history toggle (`dice-history`) that lists the last six rolls with the event die.
* `BuildCostCard` — 250 px parchment card, tilted −2°, bottom left beside the rail. Rows: Road, Ship (Tides), Settlement, City, Development card (base), City wall, Knight, Promote knight, City improvement (Crown). Each row: name + note on the left, the cost as resource icons on the right; an affordable row gets the gold left bar and is a button (`build-road`, `build-ship`, `build-settlement`, `build-city`, `buy-dev`, `wall`, `knight`, `knight-promote`, `improve`) that enters the placement mode, buys the card, or opens the improvement sheet; a disabled row carries its reason in `title`. Rows come from the pure `costRows` in `src/hud/model.ts`.
* `ActionButtons` — bottom right: Cards (52 px, `cards`, with a count badge; opens `CardsPanel` above the tray: dev cards as `dev-<type>` buttons or progress cards as `progress-<card>` buttons opening the progress sheet), Trade (84 px, `trade`) and the primary slot: Roll (`roll`, pulsing) during your roll phase, "Done" (`special-build-done`) in the special build phase, else End turn (`end-turn`, dimmed until legal, pulsing gold when it is the only action left — `onlyEndTurnLeft`). While the animation queue drains the slot is Skip (`skip`).
* `ModuleStrip` — the dark strip above the tray's right half for what the base layout has no slot for: Tides' Move ship, the Wayfarers buttons (`src/hud/WayfarersActions.tsx`), the Diplomat / Smith one-answer buttons, Withdraw offer. Renders nothing otherwise. Knights are reached by clicking a knight on the board (the interaction layer already exposes your knights whenever no mode is active), so the old "Knights" button is gone; Promote knight on the cost card enters the same pick.
* `TurnBanner` — dark panel, gold display text, the player's colour as a left bar; appears at 22 % from the top, shrinks to 60 % after 1.5 s and docks under the top row before fading (2.6 s total; skipped when animations are off).
* `EventToast` — 480 px max dark panel with a white tab, centred at 20 % from the top, four seconds each, queued: roll results (with the event die), event cards, robber and pirate moves, island bonuses, raids, the boot, barbarian attacks, Defender awards, metropolises, opponents' progress cards, the graphics watchdog notice. The connection notice uses the same chrome at 12 %.
* `HelpTip` — one provider at the end of the layer; `useTipHandlers(content, delay)` gives any element mouse/focus handlers. Content comes from `src/hud/hudCopy.ts` (rail, actions, costs, tracks, titles, stats, table props).
* `icons/` — an original monochrome 24 × 24 set (resources, commodities, pieces, stats, rail glyphs, actions) filled with `currentColor`; resource glyphs take a material tint in the tray and the cost card.

## 4. On-table props (`src/board/props/`)

Rendered inside the diorama through `Board3D`'s `children`, positioned by the pure `layout.ts` from the board's bounds (unit tested):

* `BankDecks` — one flat stack per resource (and commodity) down the right edge, height by count, hover for the count (drei `Html`); the development deck or the three progress decks after them with a permanent count label (`deck-count`). The board's projector resolves the `bank` and `deck` anchor keys to these spots so card flights still land on the bank.
* `PiecePiles` — each player's unplaced roads, settlements, cities, ships (Tides) and knights (Crown) as small clusters by their seat edge in the player's tint; they shrink as pieces are placed.
* `BarbarianTrack` — Crown & Castle: a ring of seven markers off the top-left corner (the landing in wax red), a black-sailed ship that eases 600 ms one marker per fleet step, and two screen-space pills anchored beside it (`Active knights N`, `Barbarian strength N`) plus the last event die. The pill group carries `data-testid="fleet-track"` with `data-position` / `data-attacks`, and `fleet-odds`, `fleet-attacks`, `fleet-ship` (sr-only) for the specs. Replaces the top-centre Fleet bar.
* Dice stay in the scene; the event die already lands beside them under Crown.

The "Reset view" button became a camera icon at the top-right corner (still `reset-view`, still owned by `Board3D`).

## 5. Behaviour and pacing

* Every HUD numeral is a `Numeral` (`src/hud/primitives.tsx`): on change it bumps (scale 1.3 → 1, 250 ms) and floats a `+N` / `−N`; nothing jumps.
* `hud:tick` fires on every bump and `hud:open` when a panel or the cards panel opens; `installHudSounds` in `src/game/sound.ts` plays a soft tick / breath for them while sound is on (ticks are rate-limited to one per 60 ms).
* Keys: `E` end turn, `T` trade, `L` toggle the log, `Space` skip, `Esc` closes the side panel, the cards panel, the trade panel or the targeting mode (in that order). Keys are ignored while typing.
* Bot turns: the gold progress bar under the bot's ribbon runs for the thinking pause.

## 6. Tests

* `test/hud.test.ts` — banner statistics per module, cost-card rows and reasons, the end-turn pulse rule, the status line, the dice history and histogram, the prop layout.
* e2e: `crown.spec.ts` now reads the cost-card rows (`knight`, `knight-promote`, `improve`, `wall`), the banner's `knights-` / `defense-` cells, the `cards` button's reason and the fleet pills; `fullgame.spec.ts` opens the Cards panel when the button's count is non-zero. The other specs pass unchanged because the test ids were preserved. Visual baselines were regenerated: the canvas is now full-bleed.

## 7. Decisions and deviations

* The cost card sits right of the rail (x = 64 px) rather than at 16 px: at 720 p the rail's lower buttons and a nine-row card would overlap. It can cover a legal target near the table's bottom-left corner; the camera can be dragged, and the specs click central vertices.
* Banners shrink (400 → 288 px) before they wrap so four fit at 1280 wide beside the camera button; the spec's flex-wrap remains for five and six players.
* Roll is a round button in the End turn slot during the roll phase (the spec lists only Trade and End turn); the specs and the greedy full-game policy click `roll`.
* Wayfarers and Tides have no slot in the spec's layout; their per-player badges ride under the banner's stat block and their actions in the module strip above the tray. The raider counter and event deck count sit in a pill under the top row.
* Chat has no transport in this phase (the messages stay on the screen); the rail button, the panel and the input are in place for a later phase.
* The barbarian pills sit beside the ring, not above it, so they never fall under the rail or the banners.
* The old components (`BottomBar`, `PlayersPanel`, `LogPanel`, `CrownBadges`, `CrownActions`, `wayfarers/Badges`, `SettingsMenu` popover) were deleted; `git tag hud-legacy` marks the last commit that had them.
