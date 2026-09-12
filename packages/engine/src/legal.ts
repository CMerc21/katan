/**
 * Placement queries and `legalActions` (docs/phase2.md §2).
 *
 * `legalActions` returns concrete action instances so the UI can highlight
 * targets. For action types with an unbounded payload space (OFFER_TRADE,
 * DISCARD) it returns representative instances only; other well-formed
 * payloads of those types may also be accepted by `applyAction`.
 */

import { RESOURCES, boardGeometry, type Resource } from "./board";
import type { EdgeId, Geometry, HexId, VertexId } from "./geometry";
import {
  COSTS,
  buildingAt,
  buildingsMap,
  currentPlayerId,
  emptyHand,
  getPlayer,
  hand,
  handSize,
  hasResources,
  ratioAllowed,
  roadsMap,
} from "./state";
import type { Action, DevCardType, GameState, Hand, Player, PlayerId } from "./types";

// ---------------------------------------------------------------------------
// Placement rules

/** A vertex where a building may stand: it touches at least one land hex (sea-only corners never do). */
export function isLandVertex(state: GameState, vertex: VertexId, geo: Geometry = boardGeometry(state.board)): boolean {
  return (geo.vertexHexes[vertex] ?? []).some((h) => state.board.hexes[h] !== undefined);
}

/** §5.3 distance rule: no building on the vertex or any neighbour. */
export function satisfiesDistanceRule(state: GameState, vertex: VertexId): boolean {
  const geo = boardGeometry(state.board);
  const buildings = buildingsMap(state);
  if (buildings.has(vertex)) return false;
  return (geo.vertexNeighbors[vertex] ?? []).every((n) => !buildings.has(n));
}

/** §4.2: vertices where a setup settlement may go. */
export function legalSetupSettlementVertices(state: GameState): VertexId[] {
  const geo = boardGeometry(state.board);
  const buildings = buildingsMap(state);
  const allowed = setupVertexFilter(state);
  return geo.vertices.filter(
    (v) => isLandVertex(state, v, geo) && allowed(v) && !buildings.has(v) && (geo.vertexNeighbors[v] ?? []).every((n) => !buildings.has(n)),
  );
}

/** Hook for scenario setup restrictions (docs/phase9.md §5); the base game allows every land vertex. */
export let setupVertexFilter: (state: GameState) => (v: VertexId) => boolean = () => () => true;
export function installSetupVertexFilter(fn: typeof setupVertexFilter): void {
  setupVertexFilter = fn;
}

/** §4.2: empty edges touching the just-placed settlement. */
export function legalSetupRoadEdges(state: GameState, settlement: VertexId): EdgeId[] {
  const geo = boardGeometry(state.board);
  const roads = roadsMap(state);
  return (geo.vertexEdges[settlement] ?? []).filter((e) => !roads.has(e) && isLandEdge(state, e, geo));
}

/** An edge a road may use: it borders at least one land hex. */
export function isLandEdge(state: GameState, edge: EdgeId, geo: Geometry = boardGeometry(state.board)): boolean {
  return (geo.edgeHexes[edge] ?? []).some((h) => state.board.hexes[h] !== undefined);
}

function connectsWith(
  geo: Geometry,
  playerId: PlayerId,
  edge: EdgeId,
  roads: Map<EdgeId, PlayerId>,
  buildings: Map<VertexId, { owner: PlayerId }>,
): boolean {
  for (const v of geo.edgeVertices[edge] ?? []) {
    const b = buildings.get(v);
    if (b) {
      if (b.owner === playerId) return true;
      continue; // opponent's building blocks this end
    }
    for (const e of geo.vertexEdges[v] ?? []) {
      if (e !== edge && roads.get(e) === playerId) return true;
    }
  }
  return false;
}

/** §5.2: is `edge` connected to the player's network without passing an opponent's building? */
export function roadConnects(state: GameState, playerId: PlayerId, edge: EdgeId): boolean {
  return connectsWith(boardGeometry(state.board), playerId, edge, roadsMap(state), buildingsMap(state));
}

/** §5.2: empty edges the player could build on (ignores cost and supply). */
export function legalRoadEdges(state: GameState, playerId: PlayerId): EdgeId[] {
  const geo = boardGeometry(state.board);
  const roads = roadsMap(state);
  const buildings = buildingsMap(state);
  return geo.edges.filter((e) => !roads.has(e) && isLandEdge(state, e, geo) && connectsWith(geo, playerId, e, roads, buildings));
}

/** §5.3: empty vertices satisfying the distance rule and touching an own road (ignores cost and supply). */
export function legalSettlementVertices(state: GameState, playerId: PlayerId): VertexId[] {
  const geo = boardGeometry(state.board);
  const roads = roadsMap(state);
  const buildings = buildingsMap(state);
  return geo.vertices.filter(
    (v) =>
      isLandVertex(state, v, geo) &&
      !buildings.has(v) &&
      (geo.vertexNeighbors[v] ?? []).every((n) => !buildings.has(n)) &&
      (geo.vertexEdges[v] ?? []).some((e) => roads.get(e) === playerId),
  );
}

// ---------------------------------------------------------------------------
// Dev cards

export type DevCardCheck = "ok" | "DEV_CARD_ALREADY_PLAYED" | "NO_SUCH_CARD" | "CARD_TOO_NEW";

/** §8.2 */
export function devCardPlayable(state: GameState, player: Player, type: DevCardType): DevCardCheck {
  if (player.devCardPlayedThisTurn) return "DEV_CARD_ALREADY_PLAYED";
  const owned = player.devCards.filter((c) => c.type === type);
  if (owned.length === 0) return "NO_SUCH_CARD";
  if (!owned.some((c) => c.boughtOnTurn < state.turn)) return "CARD_TOO_NEW";
  return "ok";
}

// ---------------------------------------------------------------------------
// Robber

/** §7.3: opponents with a building on `hex` and at least one card. */
export function stealTargets(state: GameState, hex: HexId, thief: PlayerId): PlayerId[] {
  const out: PlayerId[] = [];
  for (const v of boardGeometry(state.board).hexVertices[hex] ?? []) {
    const b = buildingAt(state, v);
    if (!b || b.owner === thief || out.includes(b.owner)) continue;
    if (handSize(getPlayer(state, b.owner).hand) >= 1) out.push(b.owner);
  }
  return out;
}

/** §7.1: cards owed by a player holding `size` cards. */
export function discardOwed(size: number): number {
  return size > 7 ? Math.floor(size / 2) : 0;
}

/** A representative discard: take from the largest stacks first. */
export function representativeDiscard(h: Hand, owed: number): Hand {
  const remaining = { ...h };
  const out = emptyHand();
  for (let i = 0; i < owed; i++) {
    let best: Resource = RESOURCES[0];
    for (const r of RESOURCES) if (remaining[r] > remaining[best]) best = r;
    if (remaining[best] === 0) break;
    remaining[best] -= 1;
    out[best] += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// legalActions

export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  const phase = state.phase;
  const isCurrent = currentPlayerId(state) === playerId;
  const out: Action[] = [];

  switch (phase.kind) {
    case "ended":
      return [];

    case "setup": {
      if (!isCurrent) return [];
      if (phase.step === "settlement") {
        for (const vertex of legalSetupSettlementVertices(state)) {
          out.push({ type: "BUILD_SETTLEMENT", playerId, vertex });
        }
      } else if (phase.lastSettlement !== null) {
        for (const edge of legalSetupRoadEdges(state, phase.lastSettlement)) {
          out.push({ type: "BUILD_ROAD", playerId, edge });
        }
      }
      return out;
    }

    case "roll": {
      if (!isCurrent) return [];
      out.push({ type: "ROLL", playerId });
      if (devCardPlayable(state, player, "knight") === "ok") out.push({ type: "PLAY_KNIGHT", playerId });
      return out;
    }

    case "discard": {
      const owed = state.pendingDiscards[playerId];
      if (owed === undefined) return [];
      out.push({ type: "DISCARD", playerId, cards: representativeDiscard(player.hand, owed) });
      return out;
    }

    case "moveRobber": {
      if (!isCurrent) return [];
      for (const hex of Object.keys(state.board.hexes)) {
        if (hex !== state.robberHex) out.push({ type: "MOVE_ROBBER", playerId, hex });
      }
      return out;
    }

    case "specialBuild": {
      // docs/phase8.md §5: the special builder may build and buy, nothing else.
      if (phase.order[phase.index] !== playerId) return [];
      const h = player.hand;
      if (player.pieces.roads > 0 && hasResources(h, COSTS.road)) {
        for (const edge of legalRoadEdges(state, playerId)) out.push({ type: "BUILD_ROAD", playerId, edge });
      }
      if (player.pieces.settlements > 0 && hasResources(h, COSTS.settlement)) {
        for (const vertex of legalSettlementVertices(state, playerId)) out.push({ type: "BUILD_SETTLEMENT", playerId, vertex });
      }
      if (player.pieces.cities > 0 && hasResources(h, COSTS.city)) {
        for (const vertex of player.settlements) out.push({ type: "BUILD_CITY", playerId, vertex });
      }
      if (state.devDeck.length > 0 && hasResources(h, COSTS.devCard)) out.push({ type: "BUY_DEV_CARD", playerId });
      out.push({ type: "SPECIAL_BUILD_DONE", playerId });
      return out;
    }

    case "steal": {
      if (!isCurrent) return [];
      for (const targetPlayerId of phase.targets) out.push({ type: "STEAL", playerId, targetPlayerId });
      return out;
    }

    case "roadBuilding": {
      if (!isCurrent) return [];
      if (player.pieces.roads > 0) {
        for (const edge of legalRoadEdges(state, playerId)) out.push({ type: "BUILD_ROAD", playerId, edge });
      }
      return out;
    }

    case "action": {
      const trade = state.pendingTrade;
      if (!isCurrent) {
        if (trade && trade.from !== playerId && !trade.rejectedBy.includes(playerId)) {
          if (hasResources(player.hand, trade.receive)) out.push({ type: "ACCEPT_TRADE", playerId });
          out.push({ type: "REJECT_TRADE", playerId });
        }
        return out;
      }

      const h = player.hand;
      if (player.pieces.roads > 0 && hasResources(h, COSTS.road)) {
        for (const edge of legalRoadEdges(state, playerId)) out.push({ type: "BUILD_ROAD", playerId, edge });
      }
      if (player.pieces.settlements > 0 && hasResources(h, COSTS.settlement)) {
        for (const vertex of legalSettlementVertices(state, playerId)) {
          out.push({ type: "BUILD_SETTLEMENT", playerId, vertex });
        }
      }
      if (player.pieces.cities > 0 && hasResources(h, COSTS.city)) {
        for (const vertex of player.settlements) out.push({ type: "BUILD_CITY", playerId, vertex });
      }
      if (state.devDeck.length > 0 && hasResources(h, COSTS.devCard)) {
        out.push({ type: "BUY_DEV_CARD", playerId });
      }

      if (devCardPlayable(state, player, "knight") === "ok") out.push({ type: "PLAY_KNIGHT", playerId });
      if (
        devCardPlayable(state, player, "roadBuilding") === "ok" &&
        player.pieces.roads > 0 &&
        legalRoadEdges(state, playerId).length > 0
      ) {
        out.push({ type: "PLAY_ROAD_BUILDING", playerId });
      }
      if (devCardPlayable(state, player, "invention") === "ok") {
        for (let i = 0; i < RESOURCES.length; i++) {
          for (let j = i; j < RESOURCES.length; j++) {
            const a = RESOURCES[i] as Resource;
            const b = RESOURCES[j] as Resource;
            const need = a === b ? 2 : 1;
            if (state.bank[a] >= need && state.bank[b] >= need) {
              out.push({ type: "PLAY_INVENTION", playerId, resources: [a, b] });
            }
          }
        }
      }
      if (devCardPlayable(state, player, "monopoly") === "ok") {
        for (const resource of RESOURCES) out.push({ type: "PLAY_MONOPOLY", playerId, resource });
      }

      if (trade) {
        if (trade.from === playerId) out.push({ type: "CANCEL_TRADE", playerId });
      } else {
        // Representative 1:1 offers.
        for (const give of RESOURCES) {
          if (h[give] < 1) continue;
          for (const receive of RESOURCES) {
            if (receive === give) continue;
            out.push({ type: "OFFER_TRADE", playerId, give: hand({ [give]: 1 }), receive: hand({ [receive]: 1 }) });
          }
        }
      }

      for (const give of RESOURCES) {
        for (const giveCount of [4, 3, 2] as const) {
          if (h[give] < giveCount || !ratioAllowed(state, player, give, giveCount)) continue;
          for (const receive of RESOURCES) {
            if (receive === give || state.bank[receive] < 1) continue;
            out.push({ type: "MARITIME_TRADE", playerId, give, giveCount, receive });
          }
        }
      }

      out.push({ type: "END_TURN", playerId });
      return out;
    }

    default: {
      const exhaustive: never = phase;
      throw new Error(`unknown phase ${JSON.stringify(exhaustive)}`);
    }
  }
}
