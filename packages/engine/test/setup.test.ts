import { describe, expect, it } from "vitest";
import { RESOURCES, TERRAIN_RESOURCE, type Resource } from "../src/board";
import { RuleError, isRuleError } from "../src/errors";
import { GEOMETRY, hexCorner, type VertexId } from "../src/geometry";
import {
  applyAction,
  cloneJson,
  createGame,
  currentPlayerId,
  getPlayer,
  legalActions,
  legalSetupRoadEdges,
  legalSetupSettlementVertices,
  satisfiesDistanceRule,
  setupOrder,
} from "../src/game";
import { createRng } from "../src/rng";
import { BANK_PER_RESOURCE, type Action, type GameState, type PlayerId } from "../src/types";

const FOUR = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
  { id: "d", name: "Di" },
];

function newGame(players = FOUR, seed = "test-seed"): GameState {
  return createGame({ seed, players, board: "beginner" });
}

function expectRule(fn: () => unknown, code: RuleError["code"]): void {
  try {
    fn();
  } catch (err) {
    expect(isRuleError(err)).toBe(true);
    expect((err as RuleError).code).toBe(code);
    return;
  }
  throw new Error(`expected RuleError ${code}`);
}

/** Drive the whole setup phase, choosing among legal actions with `pick`. */
function runSetup(
  start: GameState,
  pick: (actions: Action[], state: GameState) => Action,
): { state: GameState; log: Action[] } {
  let state = start;
  const log: Action[] = [];
  while (state.phase === "setup") {
    const who = currentPlayerId(state);
    if (who === null) throw new Error("no current player during setup");
    const actions = legalActions(state, who);
    expect(actions.length).toBeGreaterThan(0);
    const action = pick(actions, state);
    log.push(action);
    state = applyAction(state, action);
  }
  return { state, log };
}

function expectedStartingResources(state: GameState, vertex: VertexId): Record<Resource, number> {
  const out: Record<Resource, number> = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
  for (const h of GEOMETRY.vertexHexes[vertex]!) {
    const r = TERRAIN_RESOURCE[state.board.hexes[h]!.terrain];
    if (r) out[r] += 1;
  }
  return out;
}

describe("§1 createGame", () => {
  it("§1 accepts 3 or 4 players in seat order", () => {
    const three = newGame(FOUR.slice(0, 3));
    expect(three.players.map((p) => p.seat)).toEqual([0, 1, 2]);
    const four = newGame();
    expect(four.players.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(four.phase).toBe("setup");
    expect(four.turn).toBeNull();
    expect(four.actionCount).toBe(0);
  });

  it("§1 rejects wrong player counts and duplicate ids", () => {
    expectRule(() => newGame(FOUR.slice(0, 2)), "BAD_PLAYER_COUNT");
    expectRule(() => newGame([...FOUR, { id: "e", name: "Ev" }]), "BAD_PLAYER_COUNT");
    expectRule(() => newGame([FOUR[0]!, FOUR[1]!, FOUR[0]!]), "DUPLICATE_PLAYER");
  });

  it("§2.3 §2.4 bank and piece supplies start full", () => {
    const state = newGame();
    for (const r of RESOURCES) expect(state.bank[r]).toBe(BANK_PER_RESOURCE);
    for (const p of state.players) {
      expect(p.pieces).toEqual({ roads: 15, settlements: 5, cities: 4 });
      expect(Object.values(p.resources).every((n) => n === 0)).toBe(true);
    }
  });

  it("§4.4 robber starts on the wasteland; default board is seeded random", () => {
    const state = newGame();
    expect(state.board.hexes[state.robber]!.terrain).toBe("wasteland");
    const rnd = createGame({ seed: "s1", players: FOUR });
    expect(rnd.boardKind).toBe("random");
    expect(rnd.board.hexes[rnd.robber]!.terrain).toBe("wasteland");
    expect(createGame({ seed: "s1", players: FOUR })).toEqual(rnd);
  });

  it("getPlayer throws for unknown ids", () => {
    const state = newGame();
    expect(getPlayer(state, "a").name).toBe("Ada");
    expectRule(() => getPlayer(state, "zz"), "UNKNOWN_PLAYER");
  });
});

describe("§4 setup", () => {
  it("§4.1 placements follow snake order", () => {
    expect(setupOrder(["a", "b", "c"])).toEqual(["a", "b", "c", "c", "b", "a"]);
    const state = newGame();
    expect(state.setup!.order).toEqual(["a", "b", "c", "d", "d", "c", "b", "a"]);
    expect(currentPlayerId(state)).toBe("a");
  });

  it("§4.1 only the current player may act", () => {
    const state = newGame();
    const vertex = legalSetupSettlementVertices(state)[0]!;
    expectRule(() => applyAction(state, { type: "placeSetupSettlement", player: "b", vertex }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(state, { type: "placeSetupSettlement", player: "zz", vertex }), "UNKNOWN_PLAYER");
    expect(legalActions(state, "b")).toEqual([]);
    expect(legalActions(state, "a").length).toBe(54);
  });

  it("§4.2 settlement must be on an empty board vertex that satisfies the distance rule", () => {
    const state = newGame();
    const vertex = hexCorner({ q: 0, r: 0 }, 0);
    expectRule(
      () => applyAction(state, { type: "placeSetupSettlement", player: "a", vertex: "3,0|3,1|4,0" }),
      "INVALID_VERTEX",
    );
    const after = applyAction(state, { type: "placeSetupSettlement", player: "a", vertex });
    expect(after.buildings[vertex]).toEqual({ owner: "a", kind: "settlement" });
    expect(getPlayer(after, "a").pieces.settlements).toBe(4);
    expect(after.setup!.step).toBe("road");
    expect(after.setup!.lastSettlement).toBe(vertex);
    expect(after.actionCount).toBe(1);
    // Input is untouched.
    expect(state.buildings).toEqual({});
    expect(state.actionCount).toBe(0);

    // Finish a's road so b is up, then test occupancy and distance.
    const roadEdge = legalSetupRoadEdges(after, vertex)[0]!;
    const bTurn = applyAction(after, { type: "placeSetupRoad", player: "a", edge: roadEdge });
    expect(currentPlayerId(bTurn)).toBe("b");
    expectRule(() => applyAction(bTurn, { type: "placeSetupSettlement", player: "b", vertex }), "VERTEX_OCCUPIED");
    const neighbour = GEOMETRY.vertexNeighbors[vertex]![0]!;
    expect(satisfiesDistanceRule(bTurn, neighbour)).toBe(false);
    expectRule(
      () => applyAction(bTurn, { type: "placeSetupSettlement", player: "b", vertex: neighbour }),
      "DISTANCE_RULE",
    );
    const legalForB = legalSetupSettlementVertices(bTurn);
    expect(legalForB).not.toContain(vertex);
    for (const n of GEOMETRY.vertexNeighbors[vertex]!) expect(legalForB).not.toContain(n);
    expect(legalForB.length).toBe(54 - 1 - GEOMETRY.vertexNeighbors[vertex]!.length);
  });

  it("§4.2 road must be an empty board edge touching the new settlement", () => {
    const state = newGame();
    const vertex = hexCorner({ q: 0, r: 0 }, 0);
    // Wrong step: road before settlement.
    expectRule(
      () => applyAction(state, { type: "placeSetupRoad", player: "a", edge: GEOMETRY.edges[0]! }),
      "WRONG_STEP",
    );
    const afterSettle = applyAction(state, { type: "placeSetupSettlement", player: "a", vertex });
    // Wrong step: second settlement before the road.
    expectRule(
      () => applyAction(afterSettle, { type: "placeSetupSettlement", player: "a", vertex: GEOMETRY.vertices[0]! }),
      "WRONG_STEP",
    );
    expectRule(() => applyAction(afterSettle, { type: "placeSetupRoad", player: "a", edge: "3,0|4,0" }), "INVALID_EDGE");
    const farEdge = GEOMETRY.edges.find((e) => !GEOMETRY.vertexEdges[vertex]!.includes(e))!;
    expectRule(() => applyAction(afterSettle, { type: "placeSetupRoad", player: "a", edge: farEdge }), "ROAD_NOT_CONNECTED");

    const edges = legalSetupRoadEdges(afterSettle, vertex);
    expect(edges).toHaveLength(3);
    expect(legalActions(afterSettle, "a")).toEqual(edges.map((edge) => ({ type: "placeSetupRoad", player: "a", edge })));
    const edge = edges[0]!;
    const afterRoad = applyAction(afterSettle, { type: "placeSetupRoad", player: "a", edge });
    expect(afterRoad.roads[edge]).toBe("a");
    expect(getPlayer(afterRoad, "a").pieces.roads).toBe(14);
    expect(afterRoad.setup!.index).toBe(1);
    expect(afterRoad.setup!.step).toBe("settlement");
    expect(afterRoad.setup!.lastSettlement).toBeNull();

    // b settles two steps away from a's settlement and tries to reuse a's edge.
    const [v1, v2] = GEOMETRY.edgeVertices[edge]!;
    const other = v1 === vertex ? v2 : v1;
    const bVertex = GEOMETRY.vertexNeighbors[other]!.find((v) => satisfiesDistanceRule(afterRoad, v))!;
    const bSettled = applyAction(afterRoad, { type: "placeSetupSettlement", player: "b", vertex: bVertex });
    const sharedEdge = GEOMETRY.vertexEdges[bVertex]!.find((e) => GEOMETRY.edgeVertices[e]!.includes(other))!;
    expect(sharedEdge).not.toBe(edge);
    // a's edge is both occupied and unconnected; occupancy is reported first.
    expectRule(() => applyAction(bSettled, { type: "placeSetupRoad", player: "b", edge }), "EDGE_OCCUPIED");
    // An occupied edge that *is* connected is excluded from the legal list.
    const occupied = { ...bSettled, roads: { ...bSettled.roads, [sharedEdge]: "a" as PlayerId } };
    expect(legalSetupRoadEdges(occupied, bVertex)).not.toContain(sharedEdge);
    expectRule(() => applyAction(occupied, { type: "placeSetupRoad", player: "b", edge: sharedEdge }), "EDGE_OCCUPIED");
  });

  it("§4.2 setup pieces cost nothing", () => {
    const state = newGame();
    const vertex = legalSetupSettlementVertices(state)[0]!;
    const s1 = applyAction(state, { type: "placeSetupSettlement", player: "a", vertex });
    const s2 = applyAction(s1, { type: "placeSetupRoad", player: "a", edge: legalSetupRoadEdges(s1, vertex)[0]! });
    for (const r of RESOURCES) expect(s2.bank[r]).toBe(BANK_PER_RESOURCE);
  });

  it("§4.3 first settlement gives nothing; second gives one per adjacent producing hex", () => {
    const { state, log } = runSetup(newGame(), (actions) => actions[0]!);
    const settlements = log.filter((a) => a.type === "placeSetupSettlement");
    expect(settlements).toHaveLength(8);
    for (const p of state.players) {
      const mine = settlements.filter((a) => a.player === p.id);
      expect(mine).toHaveLength(2);
      const second = mine[1]!;
      if (second.type !== "placeSetupSettlement") throw new Error("unreachable");
      expect(p.resources).toEqual(expectedStartingResources(state, second.vertex));
    }
  });

  it("§4.3 a second settlement next to the wasteland gets nothing for it", () => {
    // Beginner board: wasteland at the centre. Corner 0 of the centre touches
    // (0,0), (1,0), (1,-1): only two producing hexes.
    const target = hexCorner({ q: 0, r: 0 }, 0);
    let state = newGame();
    const order = state.setup!.order;
    for (let i = 0; i < order.length; i++) {
      const who = order[i]!;
      const isLastForA = i === order.length - 1;
      const vertex = isLastForA
        ? target
        : legalSetupSettlementVertices(state).find(
            (v) => v !== target && !GEOMETRY.vertexNeighbors[target]!.includes(v),
          )!;
      state = applyAction(state, { type: "placeSetupSettlement", player: who, vertex });
      state = applyAction(state, { type: "placeSetupRoad", player: who, edge: legalSetupRoadEdges(state, vertex)[0]! });
    }
    const a = getPlayer(state, "a");
    const total = RESOURCES.reduce((n, r) => n + a.resources[r], 0);
    expect(total).toBe(2);
    expect(a.resources).toEqual(expectedStartingResources(state, target));
  });

  it("§4.5 after the last road the main phase starts with seat 0 and no roll", () => {
    const { state } = runSetup(newGame(), (actions) => actions[0]!);
    expect(state.phase).toBe("main");
    expect(state.setup).toBeNull();
    expect(state.turn).toEqual({ player: "a", number: 1, rolled: false });
    expect(currentPlayerId(state)).toBe("a");
    expect(state.actionCount).toBe(16);
    // Main-phase actions are scaffolded for Phase 2.
    expect(legalActions(state, "a")).toEqual([]);
    expectRule(() => applyAction(state, { type: "rollDice", player: "a" }), "NOT_IMPLEMENTED");
    expectRule(() => applyAction(state, { type: "endTurn", player: "a" }), "NOT_IMPLEMENTED");
    expectRule(() => applyAction(state, { type: "rollDice", player: "b" }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(state, { type: "placeSetupSettlement", player: "a", vertex: GEOMETRY.vertices[0]! }), "WRONG_PHASE");
    expectRule(() => applyAction(newGame(), { type: "rollDice", player: "a" }), "WRONG_PHASE");
  });

  it("§4 full 4-player setup with seeded random choices keeps every invariant", () => {
    for (const seed of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
      const rng = createRng(seed, "choices");
      const start = createGame({ seed, players: FOUR, board: "random" });
      const { state, log } = runSetup(start, (actions) => actions[rng.int(actions.length)]!);

      expect(log).toHaveLength(16);
      expect(log.map((a) => a.player)).toEqual(["a", "a", "b", "b", "c", "c", "d", "d", "d", "d", "c", "c", "b", "b", "a", "a"]);
      expect(Object.keys(state.buildings)).toHaveLength(8);
      expect(Object.keys(state.roads)).toHaveLength(8);

      for (const p of state.players) {
        expect(p.pieces).toEqual({ roads: 13, settlements: 3, cities: 4 });
      }

      // Every road touches a settlement of its owner (§4.2).
      for (const [edge, owner] of Object.entries(state.roads)) {
        const touches = GEOMETRY.edgeVertices[edge]!.some((v) => state.buildings[v]?.owner === owner);
        expect(touches).toBe(true);
      }

      // Distance rule holds everywhere (§5.3).
      for (const v of Object.keys(state.buildings)) {
        for (const n of GEOMETRY.vertexNeighbors[v]!) expect(state.buildings[n]).toBeUndefined();
      }

      // Conservation: bank + hands == 19 of each (§2.3).
      for (const r of RESOURCES) {
        const inHands = state.players.reduce((n, p) => n + p.resources[r], 0);
        expect(state.bank[r] + inHands).toBe(BANK_PER_RESOURCE);
      }
      expect(state.phase).toBe("main");
    }
  });

  it("§4 three-player setup has six placements", () => {
    const { state, log } = runSetup(newGame(FOUR.slice(0, 3)), (actions) => actions[0]!);
    expect(log).toHaveLength(12);
    expect(state.turn!.player).toBe("a");
    expect(Object.keys(state.buildings)).toHaveLength(6);
  });
});

describe("cloneJson", () => {
  it("deep-copies nested objects and arrays without sharing references", () => {
    const state = newGame();
    const copy = cloneJson(state);
    expect(copy).toEqual(state);
    expect(copy).not.toBe(state);
    expect(copy.players).not.toBe(state.players);
    expect(copy.players[0]).not.toBe(state.players[0]);
    expect(copy.board.hexes).not.toBe(state.board.hexes);
    expect(cloneJson(null)).toBeNull();
    expect(cloneJson([1, [2, 3]])).toEqual([1, [2, 3]]);
  });
});
