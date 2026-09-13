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
import { activeModules } from "./modules/hooks";
import {
  COSTS,
  buildingAt,
  buildingsMap,
  cardCount,
  currentPlayerId,
  emptyHand,
  getPlayer,
  hand,
  handSize,
  hasResources,
  ratioAllowed,
  roadsMap,
  shipsMap,
  tidesOn,
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

/** Vertices no building may be placed on beyond the distance rule (knights, docs/phase11.md §5). */
export function unbuildableVertices(state: GameState, playerId: PlayerId): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const h of activeModules(state)) for (const v of h.unbuildableVertices?.(state, playerId) ?? []) out.add(v);
  return out;
}

/** Vertices `playerId`'s roads may not pass through (opposing knights, docs/phase11.md §5). */
export function blockedVertices(state: GameState, playerId: PlayerId): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const h of activeModules(state)) for (const v of h.blockedVertices?.(state, playerId) ?? []) out.add(v);
  return out;
}

/** §4.2 (and §14.6 for restricted scenarios): vertices where a setup settlement may go. */
export function legalSetupSettlementVertices(state: GameState): VertexId[] {
  const geo = boardGeometry(state.board);
  const buildings = buildingsMap(state);
  const unbuildable = unbuildableVertices(state, currentPlayerId(state));
  return geo.vertices.filter(
    (v) => isLandVertex(state, v, geo) && setupAllowed(state, v, geo) && !buildings.has(v) && !unbuildable.has(v) && (geo.vertexNeighbors[v] ?? []).every((n) => !buildings.has(n)),
  );
}

/** Scenario setup restriction (docs/phase9.md §5): `mainIslandOnly` keeps starting settlements on the main island. */
export function setupAllowed(state: GameState, vertex: VertexId, geo: Geometry = boardGeometry(state.board)): boolean {
  const rules = state.scenario;
  if (!rules || rules.setup !== "mainIslandOnly" || rules.mainIsland === null) return true;
  const island = state.board.islands.find((i) => i.id === rules.mainIsland);
  if (!island) return true;
  return (geo.vertexHexes[vertex] ?? []).some((h) => island.hexes.includes(h));
}

/** §4.2: empty edges touching the just-placed settlement. */
export function legalSetupRoadEdges(state: GameState, settlement: VertexId): EdgeId[] {
  const geo = boardGeometry(state.board);
  const taken = edgesTaken(state);
  return (geo.vertexEdges[settlement] ?? []).filter((e) => !taken.has(e) && isLandEdge(state, e, geo));
}

/** §14.2: a setup ship may replace the setup road when the settlement is coastal. */
export function legalSetupShipEdges(state: GameState, settlement: VertexId): EdgeId[] {
  if (!tidesOn(state)) return [];
  const geo = boardGeometry(state.board);
  const taken = edgesTaken(state);
  const pirate = pirateEdges(state, geo);
  return (geo.vertexEdges[settlement] ?? []).filter((e) => !taken.has(e) && isSeaEdge(state, e, geo) && !pirate.has(e));
}

/** An edge a road may use: it borders at least one land hex. */
export function isLandEdge(state: GameState, edge: EdgeId, geo: Geometry = boardGeometry(state.board)): boolean {
  return (geo.edgeHexes[edge] ?? []).some((h) => state.board.hexes[h] !== undefined);
}

/** §14.2: an edge a ship may use: it borders at least one playable sea hex. */
export function isSeaEdge(state: GameState, edge: EdgeId, geo: Geometry = boardGeometry(state.board)): boolean {
  if (!state.board.seaPlayable) return false;
  return (geo.edgeHexes[edge] ?? []).some((h) => state.board.sea.includes(h));
}

/** Every edge holding a road or a ship. */
export function edgesTaken(state: GameState): Set<EdgeId> {
  const out = new Set<EdgeId>();
  for (const p of state.players) {
    for (const e of p.roads) out.add(e);
    for (const e of p.ships) out.add(e);
  }
  return out;
}

/** §14.5: the six edges around the pirate (no ship may be built on or moved to or from them). */
export function pirateEdges(state: GameState, geo: Geometry = boardGeometry(state.board)): Set<EdgeId> {
  return new Set(state.pirateHex === null ? [] : (geo.hexEdges[state.pirateHex] ?? []));
}

function connectsWith(
  geo: Geometry,
  playerId: PlayerId,
  edge: EdgeId,
  roads: Map<EdgeId, PlayerId>,
  buildings: Map<VertexId, { owner: PlayerId }>,
  blocked: Set<VertexId> = new Set(),
): boolean {
  for (const v of geo.edgeVertices[edge] ?? []) {
    const b = buildings.get(v);
    if (b) {
      if (b.owner === playerId) return true;
      continue; // opponent's building blocks this end
    }
    if (blocked.has(v)) continue; // an opposing knight blocks this end (docs/phase11.md §5)
    for (const e of geo.vertexEdges[v] ?? []) {
      if (e !== edge && roads.get(e) === playerId) return true;
    }
  }
  return false;
}

/** §5.2: is `edge` connected to the player's network without passing an opponent's building? */
export function roadConnects(state: GameState, playerId: PlayerId, edge: EdgeId): boolean {
  return connectsWith(boardGeometry(state.board), playerId, edge, roadsMap(state), buildingsMap(state), blockedVertices(state, playerId));
}

/** §5.2: empty edges the player could build a road on (ignores cost and supply). */
export function legalRoadEdges(state: GameState, playerId: PlayerId): EdgeId[] {
  const geo = boardGeometry(state.board);
  const roads = roadsMap(state);
  const taken = edgesTaken(state);
  const buildings = buildingsMap(state);
  const blocked = blockedVertices(state, playerId);
  return geo.edges.filter((e) => !taken.has(e) && isLandEdge(state, e, geo) && connectsWith(geo, playerId, e, roads, buildings, blocked));
}

/**
 * §14.2: is `edge` connected to the player's shipping network (an own
 * building or an own ship at one end, never a road) without passing an
 * opponent's building? `ignoring` leaves one own ship out (for moves).
 */
export function shipConnects(state: GameState, playerId: PlayerId, edge: EdgeId, ignoring: EdgeId | null = null): boolean {
  const geo = boardGeometry(state.board);
  const ships = shipsMap(state);
  if (ignoring !== null) ships.delete(ignoring);
  return connectsWith(geo, playerId, edge, ships, buildingsMap(state));
}

/** §14.2: empty sea edges the player could build a ship on (ignores cost and supply). */
export function legalShipEdges(state: GameState, playerId: PlayerId, ignoring: EdgeId | null = null): EdgeId[] {
  if (!tidesOn(state)) return [];
  const geo = boardGeometry(state.board);
  const ships = shipsMap(state);
  if (ignoring !== null) ships.delete(ignoring);
  const taken = edgesTaken(state);
  if (ignoring !== null) taken.delete(ignoring);
  const pirate = pirateEdges(state, geo);
  const buildings = buildingsMap(state);
  return geo.edges.filter((e) => !taken.has(e) && !pirate.has(e) && isSeaEdge(state, e, geo) && connectsWith(geo, playerId, e, ships, buildings));
}

/**
 * §14.2: a ship sits at the open end of a route when one of its ends has
 * neither an own building nor another own ship.
 */
export function isOpenEndShip(state: GameState, playerId: PlayerId, edge: EdgeId): boolean {
  const geo = boardGeometry(state.board);
  const player = getPlayer(state, playerId);
  const mine = new Set(player.ships);
  const buildings = buildingsMap(state);
  return (geo.edgeVertices[edge] ?? []).some((v) => {
    const b = buildings.get(v);
    if (b && b.owner === playerId) return false;
    return !(geo.vertexEdges[v] ?? []).some((e) => e !== edge && mine.has(e));
  });
}

/** §14.2: own ships that may move this turn (open end, not built this turn, not beside the pirate). */
export function movableShips(state: GameState, playerId: PlayerId): EdgeId[] {
  if (!tidesOn(state)) return [];
  const player = getPlayer(state, playerId);
  if (player.shipMovedThisTurn) return [];
  const pirate = pirateEdges(state);
  return player.ships.filter((e) => !player.shipsBuiltThisTurn.includes(e) && !pirate.has(e) && isOpenEndShip(state, playerId, e));
}

/** §14.2: every legal (from, to) ship move. */
export function legalShipMoves(state: GameState, playerId: PlayerId): { from: EdgeId; to: EdgeId }[] {
  const out: { from: EdgeId; to: EdgeId }[] = [];
  for (const from of movableShips(state, playerId)) {
    for (const to of legalShipEdges(state, playerId, from)) if (to !== from) out.push({ from, to });
  }
  return out;
}

/** §5.3 (and §14.2): empty vertices satisfying the distance rule and touching an own road or ship (ignores cost and supply). */
export function legalSettlementVertices(state: GameState, playerId: PlayerId): VertexId[] {
  const geo = boardGeometry(state.board);
  const roads = roadsMap(state);
  const ships = shipsMap(state);
  const buildings = buildingsMap(state);
  const unbuildable = unbuildableVertices(state, playerId);
  return geo.vertices.filter(
    (v) =>
      isLandVertex(state, v, geo) &&
      !buildings.has(v) &&
      !unbuildable.has(v) &&
      (geo.vertexNeighbors[v] ?? []).every((n) => !buildings.has(n)) &&
      (geo.vertexEdges[v] ?? []).some((e) => roads.get(e) === playerId || ships.get(e) === playerId),
  );
}

/** Road Building (§8.2, §14.2): somewhere to put a road, or a ship under Tides. */
export function canPlaceRoadOrShip(state: GameState, player: Player): boolean {
  if (player.pieces.roads > 0 && legalRoadEdges(state, player.id).length > 0) return true;
  return player.pieces.ships > 0 && legalShipEdges(state, player.id).length > 0;
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
    if (cardCount(state, getPlayer(state, b.owner)) >= 1) out.push(b.owner);
  }
  return out;
}

/** §14.5: opponents with a ship on an edge of the pirate's hex and at least one card. */
export function pirateStealTargets(state: GameState, hex: HexId, thief: PlayerId): PlayerId[] {
  const out: PlayerId[] = [];
  const edges = new Set(boardGeometry(state.board).hexEdges[hex] ?? []);
  for (const p of state.players) {
    if (p.id === thief || out.includes(p.id)) continue;
    if (p.ships.some((e) => edges.has(e)) && cardCount(state, p) >= 1) out.push(p.id);
  }
  return out;
}

/** §14.5: may the current player move the pirate? */
export function pirateEnabled(state: GameState): boolean {
  return tidesOn(state) && state.scenario?.pirate === true && state.pirateHex !== null;
}

// ---------------------------------------------------------------------------
// Gold (§14.3)

const GOLD_CHOICE_LIMIT = 70;

/** What a player may still take from a gold field: the owed count capped by what the bank holds. */
export function goldOwedNow(state: GameState, playerId: PlayerId): number {
  const phase = state.phase;
  if (phase.kind !== "chooseGold") return 0;
  const owed = phase.owed[playerId] ?? 0;
  return Math.min(owed, handSize(state.bank));
}

/** Every multiset of `n` resources the bank can pay (all of them up to 70 options, then one per resource). */
export function goldChoices(state: GameState, n: number): Resource[][] {
  if (n <= 0) return [[]];
  const out: Resource[][] = [];
  const walk = (start: number, left: number, acc: Resource[]) => {
    if (out.length >= GOLD_CHOICE_LIMIT) return;
    if (left === 0) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < RESOURCES.length; i++) {
      const r = RESOURCES[i] as Resource;
      const already = acc.filter((x) => x === r).length;
      if (state.bank[r] <= already) continue;
      acc.push(r);
      walk(i, left - 1, acc);
      acc.pop();
    }
  };
  walk(0, n, []);
  if (out.length === 0) return [[]];
  return out;
}

/** §7.1: cards owed by a player holding `size` cards (base threshold 7; see `discardThreshold` for walls). */
export function discardOwed(size: number, threshold = 7): number {
  return size > threshold ? Math.floor(size / 2) : 0;
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
  const hooks = activeModules(state);

  switch (phase.kind) {
    case "ended":
      return [];

    case "modulePrompt": {
      // A module needs a decision from one player (docs/phase10.md, docs/phase11.md).
      if (phase.prompt.playerId !== playerId) return [];
      for (const h of hooks) h.promptActions?.(state, phase.prompt, playerId, out);
      return out;
    }

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
        if (player.pieces.ships > 0) {
          for (const edge of legalSetupShipEdges(state, phase.lastSettlement)) out.push({ type: "BUILD_SHIP", playerId, edge });
        }
      }
      break;
    }

    case "chooseGold": {
      // §14.3: each owing player picks, in seat order (see nextActor).
      if (phase.owed[playerId] === undefined) return [];
      for (const resources of goldChoices(state, goldOwedNow(state, playerId))) out.push({ type: "CHOOSE_GOLD", playerId, resources });
      break;
    }

    case "roll": {
      if (!isCurrent) return [];
      out.push({ type: "ROLL", playerId });
      if (devCardPlayable(state, player, "knight") === "ok") out.push({ type: "PLAY_KNIGHT", playerId });
      break;
    }

    case "discard": {
      const owed = state.pendingDiscards[playerId];
      if (owed === undefined) return [];
      if (handSize(player.hand) >= owed) out.push({ type: "DISCARD", playerId, cards: representativeDiscard(player.hand, owed) });
      break;
    }

    case "moveRobber": {
      if (!isCurrent) return [];
      for (const hex of Object.keys(state.board.hexes)) {
        if (hex !== state.robberHex) out.push({ type: "MOVE_ROBBER", playerId, hex });
      }
      if (pirateEnabled(state)) {
        for (const hex of state.board.sea) {
          if (hex !== state.pirateHex) out.push({ type: "MOVE_ROBBER", playerId, hex, target: "pirate" });
        }
      }
      break;
    }

    case "specialBuild": {
      // docs/phase8.md §5: the special builder may build and buy, nothing else.
      if (phase.order[phase.index] !== playerId) return [];
      const h = player.hand;
      if (player.pieces.roads > 0 && hasResources(h, COSTS.road)) {
        for (const edge of legalRoadEdges(state, playerId)) if (hasResources(h, roadCostOf(state, edge))) out.push({ type: "BUILD_ROAD", playerId, edge });
      }
      if (player.pieces.ships > 0 && hasResources(h, COSTS.ship)) {
        for (const edge of legalShipEdges(state, playerId)) out.push({ type: "BUILD_SHIP", playerId, edge });
      }
      if (player.pieces.settlements > 0 && hasResources(h, COSTS.settlement)) {
        for (const vertex of legalSettlementVertices(state, playerId)) out.push({ type: "BUILD_SETTLEMENT", playerId, vertex });
      }
      if (player.pieces.cities > 0 && hasResources(h, COSTS.city)) {
        for (const vertex of player.settlements) out.push({ type: "BUILD_CITY", playerId, vertex });
      }
      if (state.devDeck.length > 0 && hasResources(h, COSTS.devCard)) out.push({ type: "BUY_DEV_CARD", playerId });
      out.push({ type: "SPECIAL_BUILD_DONE", playerId });
      break;
    }

    case "steal": {
      if (!isCurrent) return [];
      for (const targetPlayerId of phase.targets) out.push({ type: "STEAL", playerId, targetPlayerId });
      break;
    }

    case "roadBuilding": {
      if (!isCurrent) return [];
      if (player.pieces.roads > 0) {
        for (const edge of legalRoadEdges(state, playerId)) out.push({ type: "BUILD_ROAD", playerId, edge });
      }
      if (player.pieces.ships > 0) {
        for (const edge of legalShipEdges(state, playerId)) out.push({ type: "BUILD_SHIP", playerId, edge });
      }
      break;
    }

    case "action": {
      const trade = state.pendingTrade;
      if (!isCurrent) {
        if (trade && trade.from !== playerId && !trade.rejectedBy.includes(playerId)) {
          if (hasResources(player.hand, trade.receive)) out.push({ type: "ACCEPT_TRADE", playerId });
          out.push({ type: "REJECT_TRADE", playerId });
        }
        break; // modules may add answers for a non-current player (the boot on an acceptance, docs/phase10.md §2)
      }

      const h = player.hand;
      if (player.pieces.roads > 0 && hasResources(h, COSTS.road)) {
        for (const edge of legalRoadEdges(state, playerId)) if (hasResources(h, roadCostOf(state, edge))) out.push({ type: "BUILD_ROAD", playerId, edge });
      }
      if (player.pieces.ships > 0 && hasResources(h, COSTS.ship)) {
        for (const edge of legalShipEdges(state, playerId)) out.push({ type: "BUILD_SHIP", playerId, edge });
      }
      for (const { from, to } of legalShipMoves(state, playerId)) out.push({ type: "MOVE_SHIP", playerId, from, to });
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
      if (devCardPlayable(state, player, "roadBuilding") === "ok" && canPlaceRoadOrShip(state, player)) {
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
      break;
    }

    default: {
      const exhaustive: never = phase;
      throw new Error(`unknown phase ${JSON.stringify(exhaustive)}`);
    }
  }

  // Module actions for the acting player (docs/phase10.md, docs/phase11.md §9).
  for (const h of hooks) h.extraActions?.(state, playerId, out);
  return out;
}

/** §5.1 plus module surcharges (a bridge over a river, docs/phase10.md §3). */
export function roadCostOf(state: GameState, edge: EdgeId): Hand {
  const cost = { ...COSTS.road };
  for (const h of activeModules(state)) {
    const extra = h.roadCost?.(state, edge);
    if (extra) for (const r of RESOURCES) cost[r] += extra[r];
  }
  return cost;
}
