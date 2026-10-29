# Phase 14 — Discovery (face-down tiles) and the editor overhaul

Companion to `CLAUDE.md`, `docs/rules.md` §17 (the rules), `docs/modules.md` (hooks) and `docs/phase8.md` §4 (the editor as first built). Two pieces of work, asked for together: tiles that start face down and turn over when players build next to them, and a pass over the board editor to fix what was broken and make it less clunky.

## 1. Discovery

### 1.1 Rules (decided with the user, 2026-10-29)

`docs/rules.md` §17. A discoverable tile is land that starts face down. Each tile is either **this tile** (its own terrain and number, hidden) or **from the pool** (drawn from the board's discovery pool). It turns over when anyone builds a settlement on one of its corners, or a road or ship with an end on one of its corners — setup included. The builder takes one card of its resource; a gold field gives a resource of their choice; a wasteland or lake gives nothing; an empty bank gives nothing. Several tiles can turn over at once. A face-down tile produces nothing and the robber may stand on it.

### 1.2 Data

- `HexExtras.discover?: "tile" | "pool"` on a land hex; `BoardDefinition.discovery?: { terrains?, tokens? }` is the pool. Without an explicit pool, `discoveryPoolFor(def)` scales one to the number of pool tiles (the main terrain pool without its wasteland; tokens from `tokenPool`). An explicit pool short of tokens is topped up.
- Validation: `DISCOVER_NOT_LAND`, `DISCOVER_POOL_CONTENT` (a pool tile carries a terrain or token of its own), `DISCOVER_POOL_SHORT` (fewer pool terrains than pool tiles), `BAD_TERRAIN` / `BAD_TOKEN` in the pool, warning `DISCOVER_POOL_UNUSED`. Pool tiles do not count towards terrain or token requirements (`resolvedLandHexes`).
- `resolveBoard` deals the shuffled pool onto the pool tiles **after** everything else, so boards without pool tiles draw exactly as before. `Board.hidden` lists the tiles that start face down (absent when none); `definitionFromBoard` snapshots every face-down tile as a "this tile" one.
- `GameState.discovery?: { hidden, owedGold, revealedThisAction }` exists only on such boards (absent, not null, so a base game's state is unchanged). The robber never starts on a face-down tile (`wastelandHex` skips them).

### 1.3 Engine (`packages/engine/src/modules/discovery.ts`)

A module switched on by the board (`board.hidden` non-empty), the first board-driven switch (`docs/modules.md` §2):

- `hexProduces` → false while face down.
- `onBuilt` → `touchedTiles` (a vertex's hexes, or both ends' hexes of an edge) → `reveal`: drop from `hidden`, pay the card, owe gold, emit `tileDiscovered { playerId, hex, terrain, token, resource, gold }`.
- `afterAction` (new hook) → turn owed gold into a `chooseGold` phase wrapping whatever the build left (merged into an existing `chooseGold`, e.g. a setup settlement beside another gold field), and clear `lastBuild` for a build that revealed something. The module sets `buildsUndoable: true` (new flag), so the §5.6 undo stays on for builds that reveal nothing.
- `redact` replaces each face-down tile with `{ terrain: "wasteland", token: null }` until it turns over or the game ends; `view.discovery.hidden` and `view.board.hidden` say which tiles are face down (public).
- `describeEvent`: "Ada discovered a mountain (9) and took 1 ore"; "… a gold field (5) and picks a resource". The client's event queue turns the tile over in the view (`applyEventToView`, 1.1 s).

Tests: `packages/engine/test/discovery.test.ts` (16, every `it` names its §17 clause): what each kind resolves to and determinism, the automatic pool, an unchanged base board, validation codes, redaction and the robber's start, setup and road reveals (several at once), no production while face down, gold / wasteland / lake / empty bank, the second setup settlement, undo, and seeded random games with the bank conserved, nothing face down next to a piece, and exact replay.

### 1.4 Client

- `apps/web/src/board3d/Discovery3d.tsx`: `FaceDownTiles` lays a walnut tile back with a gilt "?" (`faceDownTexture`) on each hidden hex, the same for every tile; when a tile leaves the list its back lifts, turns over and shrinks away over 900 ms. `Board3D` passes face-down tiles to `Tiles` without terrain or token and gives them no props (props would give the terrain away).
- `apps/web/src/board2d/Thumbnail.tsx`: face-down tiles draw as a dark hex with "?" and no number.
- Editor: the **Face-down** tool (D) with a "This tile" / "From the pool" brush; a hex's inspector has a "Starts face up / face down (this tile) / face down (from the pool)" choice; the **Face-down tiles** section explains the rule, counts the tiles, edits the pool's terrain counts (− / +, "Back to automatic") and turns them all face up. On the canvas a pool tile shows the tile back (it has no terrain of its own) and a "this tile" one a small "?" badge. Painting a terrain or a number on a pool tile makes it a "this tile" tile. Model actions: `setDiscoverKind`, `toggleDiscover` (symmetry applies), `setDiscover` (inspector, one hex), `setDiscoveryPool`, `clearLayer "discovery"`.

## 2. The editor

An audit drove the editor through a whole board (painting, terrain, symmetry, numbers, harbours, rivers, fishing, oases, templates, undo, renaming, seats, scenario settings, save, reload, Save as, the board list, delete, test play, both views) at 1900×1150 and 1280×800, and read the save path against the Edge Functions. Fixed:

### 2.1 Broken

| What | Cause | Fix |
|---|---|---|
| The empty grid, the hover ring and the selection ring drew as half hexagons ("chevrons") | the 30° turn was on the Y axis, tilting each ring so half sank under the table | rotate about the ring's own normal: `[-π/2, 0, π/6]` |
| Clicking a hex (anywhere but its exact centre) or an edge never kept the selection, so the number field never appeared | the click reached the table behind, which clears the selection | cell and edge meshes stop the click |
| A drag that started on a cell centre painted nothing; a shift-rectangle ending on one was dropped | the accessible overlay buttons sat over every centre and only handled `click` | the buttons drive the brush with pointer down / enter / up; a click counts only from the keyboard |
| Hand-placed numbers were reshuffled in play | under Shuffle and Balanced the engine treated placed numbers as pool members | placed numbers now stay on their hexes and only the open hexes are dealt (as painted terrain already did; `docs/phase8.md` §2). Boards with no placed numbers draw exactly as before (pinned by a snapshot test) |
| Hand-picked harbour types were redrawn in play | Harbours: Shuffle keeps spots, redraws kinds | picking a harbour by hand switches Harbours to Fixed, with a note |
| Saving wiped the undo history, reset the tool and the camera | the save moved the URL to the new id and the page remounted | the editor lives in `app/boards/editor/layout.tsx`, which survives a change of id; the page tells the layout not to reload what it holds |
| Unsaved work was lost on Boards, on Back after Test play, on reload | no guard, nothing stashed | `beforeunload` while dirty; Boards asks; Test play keeps a recovery copy in `sessionStorage` that the editor restores on return ("Restored the board you were testing"); leaving the test game returns to the editor (`HotseatConfig.returnTo`) |
| "Points to win" and "Island bonus" could not be typed ("12" became 30) | clamped on every keystroke | `NumberField`: typed freely, clamped on blur or Enter |
| After setting a number the next shortcut keys were typed into the field; Delete with the harbour/river/fishing tool wiped a hex's terrain | focus stayed in the field; Delete fell through to "clear terrain" | the field lets go on submit; Delete acts only on the active tool's layer |
| Re-saving a public board made it private; saving after turning a board into a scenario (or back) sent the wrong table's id; someone else's board could not be saved; server detail was dropped; a double click saved twice | `isPublic` started false; the id was sent whatever its table; no owner check; `errorText(code)` only; no in-flight guard | the page passes the saved row's public flag, table and owner; ids go only to their own table and the other kind's draft is removed; someone else's board is saved as your copy; an invalid board shows the server's sentence; Save is disabled while saving; an offline save says nothing was saved |
| Duplicate drafts with the same name | switching kind left both; Save as copied the name | the other kind's draft is deleted; a copy is named "… (copy)" |
| The oasis tool accepted a wasteland, which then failed validation | no check | refused with a note |
| Hydration warning on `/boards` | harbour marker angles differed in the last bits between server and browser | rounded |

### 2.2 Quality of life

- **Top bar** holds only the name, Undo / Redo, a Top-down / Diorama switch (it used to name the state you would switch to), a status ("Unsaved changes", "All changes saved", or a "N problems to fix" button that scrolls to Validation), Public, Save, **Save as copy**, Test play, Boards. The generation switches moved out.
- **Sidebar** is collapsible sections, so it fits 1280×800: Tool, Terrain, Symmetry (with a one-line explanation), **Game setup** (seats and the three generation modes, each with what it means: "Placed numbers stay; the rest are dealt for a fair spread"), Numbers and harbours (tray, Auto-fill, Auto-place, Clear with an "Undo brings them back" note), Face-down tiles, Markers (open only when there are any), Templates (open only on an empty board).
- **Names**: the Frame tool is **Shape** and its brush **Border** (it was "Frame" twice); Token is **Number**; tool buttons show their key and have `aria-pressed`, as do symmetry and generation buttons.
- **Empty board**: a hint strip at the bottom of the canvas ("Click or drag on the grid to paint land … or start from a template") with the templates; Validation shows one plain sentence instead of the raw "0 land / 0 seats" errors.
- **Inspector order**: Selected, Board, Validation, then Scenario, so the reason Save is off is never below the fold.
- **Templates** ask before replacing a non-empty board and name an untitled board after themselves ("Standard board", not "My random"). Deleting on `/boards` asks.
- **Undo**: typing a name is one undo step, not one per keystroke.
- **Scenario**: "Make it a scenario" starts with Tides off (a Wayfarers-only scenario no longer gets ships and a pirate by surprise); turning on Raiders or Crown & Castle says why the other went off.
- **Test play** seats as many players as the board allows (up to 6), not 4.

Not done (from the audit, judged lower value for the size): a brush-coloured hover preview and a drawn symmetry axis; scenario settings in the undo history (kept out on purpose, `docs/phase9.md` §5); touch input was not tested.

### 2.3 Tests

`apps/web/test/editor.test.ts` (face-down brush, pool tiles, symmetry, Clear, sea drops the marker, the name-edit undo step, Tides off by default), `packages/engine/test/boards.test.ts` (placed numbers stay under Shuffle and Balanced; the built-in random board's layout is pinned unchanged), `apps/web/e2e/editor.spec.ts` (a drag from a cell centre paints; an off-centre click selects; keys work after a number; save keeps undo and the tool; Back from Test play restores; points to win types as 12; a hand-placed harbour switches to Fixed; a face-down tile marked in the editor turns over in a test game and the log reads "Ada discovered a mountain (9) and took 1 ore").
