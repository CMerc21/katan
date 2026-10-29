/**
 * Discovery: face-down tiles (docs/rules.md §17).
 *
 * The board already holds every tile's terrain and token (pool tiles are
 * dealt from the seeded pool in `resolveBoard`); this module keeps the list
 * of tiles still face down, turns tiles over when a build touches one of
 * their corners, pays the discoverer, and keeps face-down tiles from
 * producing. `redact` hides what is under them.
 *
 * The switch is the board itself: `state.discovery` exists only when the
 * board has face-down tiles (docs/modules.md §2).
 */

import { TERRAIN_RESOURCE, boardGeometry } from "../board";
import { edgeVerticesOf, type EdgeId, type HexId, type VertexId } from "../geometry";
import { emit } from "../state";
import { resolveGold } from "../turnHelpers";
import type { GameState, PlayerId } from "../types";
import { registerModule } from "./hooks";
import type { DiscoveryState } from "./types";

export function discoveryOn(state: GameState): boolean {
  return state.discovery !== undefined && state.discovery !== null;
}

function discoveryOf(state: GameState): DiscoveryState {
  if (!state.discovery) throw new Error("discovery state missing");
  return state.discovery;
}

/** Whether `hex` is still face down. */
export function isHidden(state: GameState, hex: HexId): boolean {
  return state.discovery?.hidden.includes(hex) ?? false;
}

/** §17.2: the tiles whose corners a piece at `at` touches (a vertex, or either end of an edge). */
export function touchedTiles(state: GameState, piece: "road" | "ship" | "settlement" | "city", at: EdgeId | VertexId): HexId[] {
  const geo = boardGeometry(state.board);
  const corners: VertexId[] = piece === "road" || piece === "ship" ? edgeVerticesOf(at as EdgeId) : [at as VertexId];
  const out: HexId[] = [];
  for (const v of corners) for (const h of geo.vertexHexes[v] ?? []) if (!out.includes(h)) out.push(h);
  return out;
}

/** §17.2–§17.3: turn `hex` over for `playerId` and pay them (gold is owed until the build is done). */
function reveal(state: GameState, playerId: PlayerId, hex: HexId): void {
  const d = discoveryOf(state);
  d.hidden = d.hidden.filter((h) => h !== hex);
  d.revealedThisAction = true;
  const tile = state.board.hexes[hex];
  if (!tile) return;
  const player = state.players.find((p) => p.id === playerId);
  let resource = TERRAIN_RESOURCE[tile.terrain];
  const gold = tile.terrain === "gold";
  if (resource !== null && player && state.bank[resource] > 0) {
    state.bank[resource] -= 1;
    player.hand[resource] += 1;
  } else {
    resource = null;
  }
  if (gold) d.owedGold[playerId] = (d.owedGold[playerId] ?? 0) + 1;
  emit(state, { kind: "tileDiscovered", playerId, hex, terrain: tile.terrain, token: tile.token, resource, gold });
}

registerModule({
  id: "discovery",
  // The board is the switch (it never changes during a game), so `init` runs before `state.discovery` exists.
  enabled: (state) => (state.board.hidden?.length ?? 0) > 0,
  buildsUndoable: true,

  init(state) {
    const hidden = state.board.hidden ?? [];
    if (hidden.length > 0) state.discovery = { hidden: [...hidden], owedGold: {}, revealedThisAction: false };
  },

  // §17.2: a face-down tile produces nothing.
  hexProduces(state, hex) {
    return !isHidden(state, hex);
  },

  onBuilt(state, playerId, piece, at) {
    for (const hex of touchedTiles(state, piece, at)) if (isHidden(state, hex)) reveal(state, playerId, hex);
  },

  afterAction(state) {
    const d = discoveryOf(state);
    // §5.6: turning a tile over cannot be taken back, so neither can the build that did it.
    if (d.revealedThisAction) state.lastBuild = null;
    d.revealedThisAction = false;
    const owed = d.owedGold;
    if (Object.keys(owed).length === 0) return;
    d.owedGold = {};
    // §17.3: the gold choice comes at once, wrapping whatever the build left (a setup road step, Road Building, the action phase).
    if (state.phase.kind === "chooseGold") {
      const merged = { ...state.phase.owed };
      for (const [id, n] of Object.entries(owed)) merged[id] = (merged[id] ?? 0) + n;
      state.phase = { ...state.phase, owed: merged };
      return;
    }
    resolveGold(state, owed, state.phase);
  },
});
