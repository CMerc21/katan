/**
 * Game lifecycle: `createGame`, `legalActions`, `applyAction`.
 *
 * `applyAction` never mutates its input; it returns a new state or throws a
 * `RuleError`. The server persists the returned state and appends the
 * action to the log. Phase 1 implements the setup phase (§4); main-phase
 * actions are scaffolded and throw NOT_IMPLEMENTED until Phase 2.
 */

import { RESOURCES, TERRAIN_RESOURCE, makeBoard, wastelandHex, type Resource } from "./board";
import { RuleError } from "./errors";
import { GEOMETRY, isBoardEdge, isBoardVertex, type EdgeId, type VertexId } from "./geometry";
import {
  BANK_PER_RESOURCE,
  STARTING_PIECES,
  type Action,
  type CreateGameOptions,
  type GameState,
  type Player,
  type PlayerId,
  type ResourceHand,
} from "./types";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;

function emptyHand(): ResourceHand {
  return { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
}

function fullBank(): ResourceHand {
  const bank = emptyHand();
  for (const r of RESOURCES) bank[r] = BANK_PER_RESOURCE;
  return bank;
}

/** §4.1 snake order: 0..n-1 then n-1..0. */
export function setupOrder(playerIds: readonly PlayerId[]): PlayerId[] {
  return [...playerIds, ...playerIds.slice().reverse()];
}

export function createGame(options: CreateGameOptions): GameState {
  const { seed, players } = options;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RuleError("BAD_PLAYER_COUNT", `expected ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${players.length}`);
  }
  const ids = new Set<PlayerId>();
  for (const p of players) {
    if (ids.has(p.id)) throw new RuleError("DUPLICATE_PLAYER", `duplicate player id ${p.id}`);
    ids.add(p.id);
  }
  const boardKind = options.board ?? "random";
  const board = makeBoard(boardKind, seed);
  const seated: Player[] = players.map((p, seat) => ({
    id: p.id,
    name: p.name,
    seat,
    resources: emptyHand(),
    pieces: { ...STARTING_PIECES },
  }));

  return {
    version: 1,
    seed,
    boardKind,
    board,
    players: seated,
    bank: fullBank(),
    buildings: {},
    roads: {},
    robber: wastelandHex(board),
    phase: "setup",
    setup: {
      order: setupOrder(seated.map((p) => p.id)),
      index: 0,
      step: "settlement",
      lastSettlement: null,
    },
    turn: null,
    actionCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries

export function getPlayer(state: GameState, id: PlayerId): Player {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new RuleError("UNKNOWN_PLAYER", `unknown player ${id}`);
  return player;
}

/** The player whose action is expected right now, or null if the game is over. */
export function currentPlayerId(state: GameState): PlayerId | null {
  if (state.phase === "setup" && state.setup) {
    return state.setup.order[state.setup.index] ?? null;
  }
  return state.turn?.player ?? null;
}

/** §5.3 distance rule: no building on the vertex or any neighbour. */
export function satisfiesDistanceRule(state: GameState, vertex: VertexId): boolean {
  if (state.buildings[vertex]) return false;
  return (GEOMETRY.vertexNeighbors[vertex] ?? []).every((n) => !state.buildings[n]);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** §4.2: vertices where a setup settlement may go. */
export function legalSetupSettlementVertices(state: GameState): VertexId[] {
  return GEOMETRY.vertices.filter((v) => satisfiesDistanceRule(state, v));
}

/** §4.2: empty edges touching the just-placed settlement. */
export function legalSetupRoadEdges(state: GameState, settlement: VertexId): EdgeId[] {
  return (GEOMETRY.vertexEdges[settlement] ?? []).filter((e) => !hasOwn(state.roads, e));
}

/**
 * Every action `playerId` may legally take right now. Used by the client
 * for highlighting and by tests to drive random play. Returns [] when it
 * is not that player's move.
 */
export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  if (currentPlayerId(state) !== playerId) return [];
  if (state.phase === "setup" && state.setup) {
    if (state.setup.step === "settlement") {
      return legalSetupSettlementVertices(state).map((vertex) => ({
        type: "placeSetupSettlement",
        player: playerId,
        vertex,
      }));
    }
    const at = state.setup.lastSettlement;
    if (at === null) return [];
    return legalSetupRoadEdges(state, at).map((edge) => ({ type: "placeSetupRoad", player: playerId, edge }));
  }
  // Main-phase actions arrive in Phase 2.
  return [];
}

// ---------------------------------------------------------------------------
// Mutation

function assertCurrentPlayer(state: GameState, playerId: PlayerId): Player {
  const player = getPlayer(state, playerId);
  if (currentPlayerId(state) !== playerId) {
    throw new RuleError("NOT_YOUR_TURN", `it is not ${playerId}'s move`);
  }
  return player;
}

function requireSetup(state: GameState, step: "settlement" | "road"): NonNullable<GameState["setup"]> {
  if (state.phase !== "setup" || !state.setup) throw new RuleError("WRONG_PHASE", "not in setup");
  if (state.setup.step !== step) throw new RuleError("WRONG_STEP", `expected setup ${state.setup.step}`);
  return state.setup;
}

/** §4.3: one of each producing resource adjacent to the vertex, limited by the bank. */
function grantStartingResources(state: GameState, player: Player, vertex: VertexId): void {
  for (const h of GEOMETRY.vertexHexes[vertex] ?? []) {
    const tile = state.board.hexes[h];
    if (!tile) continue;
    const resource: Resource | null = TERRAIN_RESOURCE[tile.terrain];
    if (resource === null) continue;
    if (state.bank[resource] <= 0) continue;
    state.bank[resource] -= 1;
    player.resources[resource] += 1;
  }
}

function applyPlaceSetupSettlement(state: GameState, playerId: PlayerId, vertex: VertexId): void {
  const setup = requireSetup(state, "settlement");
  const player = assertCurrentPlayer(state, playerId);
  if (!isBoardVertex(vertex)) throw new RuleError("INVALID_VERTEX", `no such vertex ${vertex}`);
  if (hasOwn(state.buildings, vertex)) throw new RuleError("VERTEX_OCCUPIED", `vertex ${vertex} is occupied`);
  if (!satisfiesDistanceRule(state, vertex)) throw new RuleError("DISTANCE_RULE", `vertex ${vertex} is too close`);
  if (player.pieces.settlements <= 0) throw new RuleError("NO_PIECES_LEFT", "no settlements left");

  state.buildings[vertex] = { owner: playerId, kind: "settlement" };
  player.pieces.settlements -= 1;

  const isSecondPlacement = setup.index >= state.players.length;
  if (isSecondPlacement) grantStartingResources(state, player, vertex);

  setup.step = "road";
  setup.lastSettlement = vertex;
}

function applyPlaceSetupRoad(state: GameState, playerId: PlayerId, edge: EdgeId): void {
  const setup = requireSetup(state, "road");
  const player = assertCurrentPlayer(state, playerId);
  if (!isBoardEdge(edge)) throw new RuleError("INVALID_EDGE", `no such edge ${edge}`);
  if (hasOwn(state.roads, edge)) throw new RuleError("EDGE_OCCUPIED", `edge ${edge} is occupied`);
  const at = setup.lastSettlement;
  if (at === null || !(GEOMETRY.vertexEdges[at] ?? []).includes(edge)) {
    throw new RuleError("ROAD_NOT_CONNECTED", `edge ${edge} does not touch the new settlement`);
  }
  if (player.pieces.roads <= 0) throw new RuleError("NO_PIECES_LEFT", "no roads left");

  state.roads[edge] = playerId;
  player.pieces.roads -= 1;

  setup.index += 1;
  setup.step = "settlement";
  setup.lastSettlement = null;

  if (setup.index >= setup.order.length) {
    // §4.5: setup complete; seat 0 starts the main phase.
    const first = state.players[0];
    if (!first) throw new Error("no players");
    state.phase = "main";
    state.setup = null;
    state.turn = { player: first.id, number: 1, rolled: false };
  }
}

/**
 * Deep-clone a JSON-shaped value (plain objects, arrays, primitives). The
 * state is exactly that, and this keeps the engine free of host APIs.
 */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => cloneJson(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneJson(v);
    return out as T;
  }
  return value;
}

/**
 * Apply `action` to `state` and return the new state. Throws `RuleError`
 * if the action is illegal; the input state is never modified.
 */
export function applyAction(state: GameState, action: Action): GameState {
  const next = cloneJson(state);
  switch (action.type) {
    case "placeSetupSettlement":
      applyPlaceSetupSettlement(next, action.player, action.vertex);
      break;
    case "placeSetupRoad":
      applyPlaceSetupRoad(next, action.player, action.edge);
      break;
    case "rollDice":
    case "endTurn":
      assertCurrentPlayer(next, action.player);
      if (next.phase !== "main") throw new RuleError("WRONG_PHASE", `${action.type} is not allowed during setup`);
      throw new RuleError("NOT_IMPLEMENTED", `${action.type} arrives in Phase 2`);
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
  next.actionCount += 1;
  return next;
}
