import { describe, expect, it } from "vitest";
import { RESOURCES, TERRAIN_RESOURCE } from "../src/board";
import { GEOMETRY, hexCorner } from "../src/geometry";
import { applyAction } from "../src/actions";
import { createGame, shuffledDevDeck } from "../src/game";
import { legalActions, legalSetupRoadEdges, legalSetupSettlementVertices } from "../src/legal";
import { currentPlayerId, getPlayer, hand } from "../src/state";
import { BANK_PER_RESOURCE, DEV_DECK_COMPOSITION, type Action, type GameState } from "../src/types";
import { FOUR, expectRule, finishSetup, newGame } from "./helpers";

function runSetup(start: GameState): { state: GameState; log: Action[] } {
  let state = start;
  const log: Action[] = [];
  while (state.phase.kind === "setup") {
    const action = legalActions(state, currentPlayerId(state))[0]!;
    log.push(action);
    state = applyAction(state, action);
  }
  return { state, log };
}

describe("§1 §2 createGame", () => {
  it("§1 accepts 3 or 4 players in seat order with colours", () => {
    const four = newGame();
    expect(four.players.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(four.players.map((p) => p.color)).toEqual(["red", "blue", "orange", "white"]);
    expect(four.phase).toEqual({ kind: "setup", round: 1, step: "settlement", lastSettlement: null });
    expect(four.currentPlayer).toBe(0);
    expect(four.turn).toBe(0);
    expect(four.actionIndex).toBe(0);
    expect(newGame(FOUR.slice(0, 3)).players).toHaveLength(3);
  });

  it("§1 rejects wrong player counts and duplicate ids", () => {
    expectRule(() => newGame(FOUR.slice(0, 2)), "BAD_PLAYER_COUNT");
    expectRule(() => newGame([...FOUR, { id: "e", name: "Ev" }]), "BAD_PLAYER_COUNT");
    expectRule(() => newGame([FOUR[0]!, FOUR[1]!, FOUR[0]!]), "DUPLICATE_PLAYER");
  });

  it("§2.3 §2.4 §2.5 bank, pieces and deck start full", () => {
    const state = newGame();
    for (const r of RESOURCES) expect(state.bank[r]).toBe(BANK_PER_RESOURCE);
    for (const p of state.players) {
      expect(p.pieces).toEqual({ roads: 15, settlements: 5, cities: 4 });
      expect(p.hand).toEqual(hand({}));
      expect(p.devCards).toEqual([]);
    }
    expect(state.devDeck).toHaveLength(25);
    const counts: Record<string, number> = {};
    for (const c of state.devDeck) counts[c] = (counts[c] ?? 0) + 1;
    expect(counts).toEqual(DEV_DECK_COMPOSITION);
    expect(shuffledDevDeck("x")).toEqual(shuffledDevDeck("x"));
    expect(shuffledDevDeck("x")).not.toEqual(shuffledDevDeck("y"));
  });

  it("§4.4 §12 robber starts on the wasteland; the default board is seeded random", () => {
    const state = newGame();
    expect(state.board.hexes[state.robberHex]!.terrain).toBe("wasteland");
    const rnd = createGame({ seed: "s1", players: FOUR });
    expect(rnd.boardKind).toBe("random");
    expect(createGame({ seed: "s1", players: FOUR })).toEqual(rnd);
  });
});

describe("§4 setup", () => {
  it("§4.1 placements go forward then reverse (snake)", () => {
    const { state, log } = runSetup(newGame());
    expect(log.map((a) => a.playerId)).toEqual([
      "a", "a", "b", "b", "c", "c", "d", "d",
      "d", "d", "c", "c", "b", "b", "a", "a",
    ]);
    expect(log.map((a) => a.type)).toEqual(Array(8).fill(["BUILD_SETTLEMENT", "BUILD_ROAD"]).flat());
    expect(state.phase).toEqual({ kind: "roll" });
    expect(state.currentPlayer).toBe(0);
    expect(state.actionIndex).toBe(16);
    expect(state.turn).toBe(0);
  });

  it("§4.1 three players make six placements", () => {
    const { state, log } = runSetup(newGame(FOUR.slice(0, 3)));
    expect(log).toHaveLength(12);
    expect(log.map((a) => a.playerId).join("")).toBe("aabbccccbbaa");
    expect(state.phase.kind).toBe("roll");
  });

  it("§4.1 only the current player may act; others get no legal actions", () => {
    const state = newGame();
    const vertex = legalSetupSettlementVertices(state)[0]!;
    expectRule(() => applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "b", vertex }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "zz", vertex }), "UNKNOWN_PLAYER");
    expect(legalActions(state, "b")).toEqual([]);
    expect(legalActions(state, "a")).toHaveLength(54);
  });

  it("§4.2 setup settlement needs an empty board vertex satisfying the distance rule", () => {
    const state = newGame();
    const vertex = hexCorner({ q: 0, r: 0 }, 0);
    expectRule(
      () => applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: "3,0|3,1|4,0" }),
      "INVALID_VERTEX",
    );
    const after = applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "a", vertex });
    expect(getPlayer(after, "a").settlements).toEqual([vertex]);
    expect(getPlayer(after, "a").pieces.settlements).toBe(4);
    expect(after.phase).toEqual({ kind: "setup", round: 1, step: "road", lastSettlement: vertex });
    expect(state.players[0]!.settlements).toEqual([]); // input untouched

    const road = legalSetupRoadEdges(after, vertex)[0]!;
    const bTurn = applyAction(after, { type: "BUILD_ROAD", playerId: "a", edge: road });
    expect(currentPlayerId(bTurn)).toBe("b");
    expectRule(() => applyAction(bTurn, { type: "BUILD_SETTLEMENT", playerId: "b", vertex }), "VERTEX_OCCUPIED");
    const neighbour = GEOMETRY.vertexNeighbors[vertex]![0]!;
    expectRule(() => applyAction(bTurn, { type: "BUILD_SETTLEMENT", playerId: "b", vertex: neighbour }), "DISTANCE_RULE");
    const legalForB = legalSetupSettlementVertices(bTurn);
    expect(legalForB).not.toContain(vertex);
    for (const n of GEOMETRY.vertexNeighbors[vertex]!) expect(legalForB).not.toContain(n);
    expect(legalForB).toHaveLength(54 - 1 - GEOMETRY.vertexNeighbors[vertex]!.length);
  });

  it("§4.2 setup road must touch the just-placed settlement", () => {
    const state = newGame();
    const vertex = hexCorner({ q: 0, r: 0 }, 0);
    expectRule(() => applyAction(state, { type: "BUILD_ROAD", playerId: "a", edge: GEOMETRY.edges[0]! }), "WRONG_PHASE");
    const settled = applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "a", vertex });
    expectRule(
      () => applyAction(settled, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: GEOMETRY.vertices[0]! }),
      "WRONG_PHASE",
    );
    expectRule(() => applyAction(settled, { type: "BUILD_ROAD", playerId: "a", edge: "3,0|4,0" }), "INVALID_EDGE");
    const far = GEOMETRY.edges.find((e) => !GEOMETRY.vertexEdges[vertex]!.includes(e))!;
    expectRule(() => applyAction(settled, { type: "BUILD_ROAD", playerId: "a", edge: far }), "ROAD_NOT_CONNECTED");

    const edges = legalSetupRoadEdges(settled, vertex);
    expect(edges).toHaveLength(3);
    expect(legalActions(settled, "a")).toEqual(edges.map((edge) => ({ type: "BUILD_ROAD", playerId: "a", edge })));
    const roaded = applyAction(settled, { type: "BUILD_ROAD", playerId: "a", edge: edges[0]! });
    expect(getPlayer(roaded, "a").roads).toEqual([edges[0]]);
    expect(getPlayer(roaded, "a").pieces.roads).toBe(14);
    expect(roaded.phase).toEqual({ kind: "setup", round: 1, step: "settlement", lastSettlement: null });
    expect(roaded.currentPlayer).toBe(1);
  });

  it("§4.2 setup pieces cost nothing and an occupied edge is refused", () => {
    const state = newGame();
    const vertex = legalSetupSettlementVertices(state)[0]!;
    const s1 = applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "a", vertex });
    const edge = legalSetupRoadEdges(s1, vertex)[0]!;
    const s2 = applyAction(s1, { type: "BUILD_ROAD", playerId: "a", edge });
    for (const r of RESOURCES) expect(s2.bank[r]).toBe(BANK_PER_RESOURCE);

    // b settles at distance two along a's road and tries to reuse a's edge.
    const other = GEOMETRY.edgeVertices[edge]!.find((v) => v !== vertex)!;
    const bVertex = GEOMETRY.vertexNeighbors[other]!.find((v) => legalSetupSettlementVertices(s2).includes(v))!;
    const s3 = applyAction(s2, { type: "BUILD_SETTLEMENT", playerId: "b", vertex: bVertex });
    expectRule(() => applyAction(s3, { type: "BUILD_ROAD", playerId: "b", edge }), "EDGE_OCCUPIED");
  });

  it("§4.3 first settlement pays nothing; second pays one per adjacent producing hex", () => {
    const { state, log } = runSetup(newGame());
    const settlements = log.filter((a) => a.type === "BUILD_SETTLEMENT");
    for (const p of state.players) {
      const second = settlements.filter((a) => a.playerId === p.id)[1]!;
      if (second.type !== "BUILD_SETTLEMENT") throw new Error("unreachable");
      const expected = hand({});
      for (const h of GEOMETRY.vertexHexes[second.vertex]!) {
        const r = TERRAIN_RESOURCE[state.board.hexes[h]!.terrain];
        if (r) expected[r] += 1;
      }
      expect(p.hand).toEqual(expected);
    }
    for (const r of RESOURCES) {
      const inHands = state.players.reduce((n, p) => n + p.hand[r], 0);
      expect(state.bank[r] + inHands).toBe(BANK_PER_RESOURCE);
    }
  });

  it("§4.3 a second settlement beside the wasteland gets nothing for it", () => {
    // Beginner board: the wasteland is the centre hex. Corner 0 touches two producing hexes.
    const target = hexCorner({ q: 0, r: 0 }, 0);
    let state = newGame();
    while (state.phase.kind === "setup") {
      const who = currentPlayerId(state);
      const isLastPlacement = state.phase.round === 2 && who === "a";
      const options = legalActions(state, who);
      let action = options[0]!;
      if (state.phase.step === "settlement") {
        action = isLastPlacement
          ? { type: "BUILD_SETTLEMENT", playerId: who, vertex: target }
          : options.find(
              (o) => o.type === "BUILD_SETTLEMENT" && o.vertex !== target && !GEOMETRY.vertexNeighbors[target]!.includes(o.vertex),
            )!;
      }
      state = applyAction(state, action);
    }
    const a = getPlayer(state, "a");
    expect(RESOURCES.reduce((n, r) => n + a.hand[r], 0)).toBe(2);
  });

  it("§4.5 after setup the main phase starts with seat 0 in the roll phase", () => {
    const state = finishSetup(newGame());
    expect(state.phase).toEqual({ kind: "roll" });
    expect(currentPlayerId(state)).toBe("a");
    expect(legalActions(state, "a")).toEqual([{ type: "ROLL", playerId: "a" }]);
    expect(legalActions(state, "b")).toEqual([]);
    expectRule(() => applyAction(state, { type: "END_TURN", playerId: "a" }), "WRONG_PHASE");
    expectRule(() => applyAction(newGame(), { type: "ROLL", playerId: "a" }), "WRONG_PHASE");
  });
});
