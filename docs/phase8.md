# Phase 8 — Generalized Boards and the Board Editor

Companion to `CLAUDE.md`, `docs/rules.md` (§13 is new) and `docs/phase7.md`. The engine no longer assumes the 19-hex standard board: a game is created from a `BoardDefinition` of any shape, the built-in boards are definitions too, tables seat 3–6, and a browser editor builds, validates, saves and shares boards. §8 lists decisions and deviations from the original spec.

## 1. Board definitions (`packages/engine/src/definition.ts`)

```ts
interface BoardDefinition {
  id?: string; name: string;
  hexes: { at: {q, r}; kind: "land" | "sea" | "frame"; terrain?: Terrain; token?: number; extras?: {} }[];
  harbors: { edge: EdgeId; ratio: 3 | 2; resource?: Resource }[];
  seats: { min: 3; max: 4 | 5 | 6 };
  generation: { terrain: "fixed" | "shuffle"; tokens: "fixed" | "shuffle" | "balanced"; harbors: "fixed" | "shuffle" };
  presets?: { terrainPool?; tokenPool?; harborPool? };
}
```

- `frame` hexes are the wooden edge of the table: drawn, never playable, never part of the geometry. `sea` hexes are drawn and become playable only with Tides (Phase 9). Missing cells are open water.
- `isBoardDefinition(x)` is the structural guard used by the server and the storage layer before anything else touches a stored blob.
- `definitionFromBoard(board)` pins a resolved board (everything fixed); the server snapshots it into `games.board_definition` so later edits to a saved board never touch a running game.

## 2. Geometry and the engine

- `geometry.ts`: `buildGeometry(hexCoords)` computes vertices, edges and adjacency for any set of hex coordinates; `geometryFor(hexIds)` memoises per hex set; `GEOMETRY` is the standard board's. `boardGeometry(board)` (in `board.ts`) is what every rule uses; the geometry is built from `board.hexes` (land) plus `board.sea` when `seaPlayable` (Phase 9), never from frame cells.
- `Board` gained `name`, `sea`, `frame`, `seats` and `seaPlayable`; `hexes` holds land only. `wastelandHex` falls back to the first land hex on a board without a wasteland.
- Placement rules (`legal.ts`) only offer land vertices and land edges (`isLandVertex`, `isLandEdge`); the setup filter hook `installSetupVertexFilter` lets Phase 9 restrict starting islands.
- `createGame({ board })` accepts a `BoardKind` ("beginner" | "random") or a `BoardDefinition`. A definition is validated and resolved with the game seed (`rng(seed, "board")`); errors throw `RuleError("INVALID_BOARD")`. `state.boardKind` is `"custom"` for definitions.
- Pools (`pools.ts`): `terrainPool(n)`, `tokenPool(n)` and `harborPool(count)` scale the standard proportions to any land count by largest-remainder apportionment (`apportion`), always keeping at least one wasteland; `trimPool` removes evenly when painted hexes leave fewer to fill. `harborCount(n)` ≈ 9 · n / 19.
- Generation (`generation.ts`): `resolveBoard(def, rng)` fills terrain (fixed hexes keep theirs; the rest draw from the pool minus what is painted), tokens (`shuffle` retries until no two 6/8 tokens touch; `balanced` runs seeded random restarts then pair-swap hill climbing scored 10·hot-adjacent + 3·same-number-adjacent + heavy vertices) and harbours (`autoHarborEdges` spaces them evenly along the coast; `shuffle` keeps the painted edges and draws kinds from the pool).

## 3. Validation (`packages/engine/src/validation.ts`)

`validateBoard(def, { allowIslands? })` returns `{ code, severity, message, at? }[]`; `hasErrors(issues)` gates saving and playing. Warnings are advisory.

| Code | Severity | Meaning |
| --- | --- | --- |
| `OVERLAP` | error | two hexes at one coordinate |
| `TOO_SMALL` | error | fewer than 7 land hexes |
| `SEA_CONTENT` | error | terrain or token on a sea/frame hex |
| `UNASSIGNED_TERRAIN` | error | a land hex without terrain when generation is fixed |
| `BAD_TERRAIN` | error | not one of the rules terrains |
| `NO_WASTELAND` | warning | no wasteland on a fixed board (the robber starts on the first land hex) |
| `MISSING_TERRAIN` | warning | a resource nobody can produce |
| `BAD_TOKEN`, `TOKEN_ON_WASTELAND`, `TOKEN_COUNT` | error | token outside 2–12/7, on a wasteland, or fixed tokens on a producing hex count mismatch |
| `HOT_ADJACENT`, `SAME_ADJACENT` | warning | two 6/8 (or two equal) tokens on neighbouring hexes |
| `BAD_EDGE`, `HARBOR_INLAND`, `BAD_RATIO`, `HARBOR_SHARED_VERTEX` | error | harbour edge unknown, not coastal, wrong ratio/resource, or two harbours share a vertex |
| `FEW_HARBORS` | warning | fewer than `harborCount(n)` fixed harbours |
| `LAND_SPLIT` | error unless `allowIslands` | land is not one connected region (Tides allows islands) |
| `TOO_MANY_SEATS`, `BAD_SEATS` | error | `seatsSupported` (from `startingCapacity`: distance-rule-respecting starting spots) is below `seats.max`, or seats outside 3–6 |

Helpers: `coastalLand`, `coastalEdges`, `landComponents`, `startingCapacity`, `seatsSupported`.

## 4. Built-in boards, storage and the client

### 4.1 Frames (`packages/engine/src/frames.ts`)

`standardFrame()` (19 hexes, 4 seats), `largeFrame()` (30 hexes, 6 seats), `longStripFrame()` (21 hexes in a 7×3 band, 5 seats), `ringFrame()` (24 land around 7 sea, 6 seats). `beginnerDefinition()` pins the Phase 1 beginner layout; `randomDefinition()` is the standard frame with everything shuffled. `builtInBoard(id)` / `BUILT_IN_BOARD_IDS` / `isBuiltInBoardId` name them: `beginner`, `random`, `large`, `longStrip`, `ring`.

### 4.2 Server (`packages/server`, `supabase/migrations/0004_boards.sql`)

- `boards (id, owner_id, name, definition jsonb, is_public, forked_from, created_at, updated_at)` with RLS: owners read their own, anyone signed in reads public boards; writes go through the `save-board`, `delete-board` and `fork-board` Edge Functions (`board-service.ts`). Saving validates with `allowIslands: true` and refuses errors (`INVALID_BOARD`); `BOARD_NOT_FOUND` and `NOT_OWNER` are the new service codes. Names are trimmed to 40 characters.
- `games.board` allows `custom` and `games.board_definition` snapshots the resolved definition; `games.max_players` allows 3–6; `game_players.color` gained `green` and `brown`; `lobbies.board_name` (also on the `lobby_games` view) labels the lobby.
- `create-lobby` accepts `board` as a `BoardKind`, a built-in id, `{ boardId }` (a saved board you can see) or `{ definition }` (a draft, validated inline), and `maxPlayers` up to the board's `seats.max`. `boardOptionOf(game)` rebuilds the `createGame` option when starting or replaying.

### 4.3 Client

- Drafts live in `localStorage` (`katan.boards.drafts`, ids `draft-…`) so the editor and hotseat work without an account; saved boards come from the `boards` table (`src/editor/storage.ts`).
- `/boards` lists built-in frames, drafts, your boards and public boards with thumbnails (`src/board2d/Thumbnail.tsx`, the SVG board), with edit / fork / delete / play actions.
- `BoardPicker` (`src/components/BoardPicker.tsx`) is shared by the hotseat form and the create-lobby form: cards for the five built-ins plus drafts and saved boards, each with a fixed-seed preview and its seat cap; boards with errors are disabled. Player-count buttons run from 3 to the chosen board's `seats.max`. The lobby shows `board_name` and seats up to six.
- `HotseatConfig.board` is `BoardKind | BoardDefinition`; the hotseat driver passes it straight to `createGame`.

### 4.4 Editor (`/boards/editor/[id?]`, `src/editor/`)

- `model.ts` is a pure reducer over `{ def, tool, terrain, symmetry, selected, gridRadius, dirty, boardId }` with undo/redo (`historyReduce`, 200 steps; view-only actions are not recorded). Tools: **frame** (click cycles empty → land → sea → frame → empty, right-click erases, shift-drag paints a rectangle, mirror/rotate symmetry), **terrain** (paint one terrain, keys 1–7; painting a wasteland drops its token), **token** (select a hex and type 2–12; the tray shows what the balanced pool still owes), **harbour** (click a coastal edge to cycle none → 3:1 → 2:1 per resource → none). "Auto tokens" runs the engine's balanced generator and pins the result as fixed tokens; "Auto harbours" spaces `harborCount` harbours along the coast. Templates load any built-in frame.
- `EditorCanvas.tsx` reuses the Phase 7.5 diorama (tiles, props, harbours) with a ghost-cell grid, a top-down camera by default and an accessible overlay of one button per cell (`cell-q,r`) and per coastal edge (`edge-…`) for keyboards and tests.
- `Editor.tsx` shows validation live (errors block Save / Save as / Test play; warnings do not), a stats line, the token tray, and saves to a draft (signed out) or to the `boards` table (signed in, with a Public checkbox). Test play starts a hotseat game on the board with bots in the other seats.

## 5. Five and six players (`docs/rules.md` §13)

- `MAX_PLAYERS` is 6; `PLAYER_COLORS` gained `green` and `brown`. Piece counts per player are unchanged.
- With more than four players, `END_TURN` opens a **special build phase**: every other player, in seat order after the current player, may build roads, settlements and cities and buy development cards at the usual prices (no trading, no card play), then sends `SPECIAL_BUILD_DONE`. Each builder gets a `specialBuildTurn` event; after the last one the next turn starts. `nextActor` returns the current special builder; bots handle it with `chooseSpecialBuild`.
- The win check runs on every build, so a game can end during a special build.

## 6. Bots

`eval.ts` reads geometry from the view's board (`geo(view)`) and scores edges by a depth-4 search toward good vertices (`edgeTowardScore`), so the policies play any shape. The tournament test plays every built-in frame with 3–6 seats to completion.

## 7. Tests

- Engine `test/boards.test.ts`: geometry for arbitrary hex sets, pools sum and keep a wasteland, `resolveBoard` honours 6/8 and fixed parts, every validation code fires on a crafted board, all frames validate and reach a win with 5 and 6 players, the special build order and its legal actions. `board.test.ts` and `contract.test.ts` cover the beginner/random boards through the new path; the property test's action weights include `SPECIAL_BUILD_DONE`.
- Server tests: create a lobby on a built-in frame, a saved board and an inline draft; seat caps; save/fork/delete with ownership and RLS.
- Web `test/editor.test.ts`: the reducer (tools, symmetry, wasteland rule, auto tokens, auto harbours, undo/redo, templates, dirty flag). Playwright `e2e/editor.spec.ts` paints a 12-hex island, auto-fills tokens and harbours, saves a draft, picks it in the hotseat form, starts a 3-player game and places the first settlement.

## 8. Decisions and deviations

- Sea hexes are stored now but only drawn until Phase 9; `Board.seaPlayable` is false for every Phase 8 board.
- `LAND_SPLIT` is an error for play and a warning-free save: the editor and `save-board` validate with `allowIslands: true` so an island board can be kept for Tides, while the picker and `createGame` refuse it until a scenario enables sea play.
- Drafts stay in the browser rather than an anonymous server row; signing in and saving moves a draft to the table and deletes the local copy.
- Special build happens after every turn with 5+ players (not only after turns that rolled); the current player never builds in it.
- The editor's canvas is the diorama rather than a flat SVG, so what you build looks like what you play; the SVG board survives only for thumbnails.
