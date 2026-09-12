import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions";
import { PLAYER_COLORS } from "../src/types";
import { beginnerBoard, boardGeometry, honorsSixEightRule, type Board } from "../src/board";
import { type BoardDefinition, type HexDef } from "../src/definition";
import { beginnerDefinition, builtInBoard, largeFrame, longStripFrame, randomDefinition, ringFrame, standardFrame } from "../src/frames";
import { createGame } from "../src/game";
import { autoHarborEdges, definitionFromBoard, resolveBoard, violations } from "../src/generation";
import { GEOMETRY, edgeVerticesOf, geometryFor, hexId, parseEdgeId, vertexEdgesOf, type HexCoord } from "../src/geometry";
import { legalActions, legalSetupSettlementVertices } from "../src/legal";
import { apportion, harborCount, harborPool, terrainPool, tokenPool } from "../src/pools";
import { rng } from "../src/rng";
import { currentPlayerId, getPlayer, nextActor } from "../src/state";
import { coastalEdges, coastalLand, landComponents, seatsSupported, validateBoard } from "../src/validation";
import { expectRule, finishSetup, give, inPhase } from "./helpers";

const land = (q: number, r: number, terrain?: HexDef["terrain"], token?: number): HexDef =>
  terrain === undefined ? { at: { q, r }, kind: "land" } : token === undefined ? { at: { q, r }, kind: "land", terrain } : { at: { q, r }, kind: "land", terrain, token };

/** A 12-hex island: a 3×4 blob. */
function island(): BoardDefinition {
  const hexes: HexDef[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) hexes.push(land(c - Math.floor(r / 2), r));
  return { name: "Island", hexes, harbors: [], seats: { min: 3, max: 4 }, generation: { terrain: "shuffle", tokens: "balanced", harbors: "shuffle" } };
}

describe("docs/phase8.md §1 geometry on any shape", () => {
  it("builds canonical IDs for an irregular shape, agreeing with the standard tables where they overlap", () => {
    const shape: HexCoord[] = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: -1 },
      { q: 0, r: 1 },
      { q: -2, r: 3 },
    ];
    const geo = geometryFor(shape.map(hexId));
    expect(geo.hexes).toHaveLength(6);
    // 6 hexes, 4 in a chain sharing edges: vertices = 6·6 − shared.
    expect(geo.vertices.length).toBeGreaterThan(24);
    for (const e of geo.edges) expect(geo.edgeVertices[e]).toEqual(edgeVerticesOf(e));
    for (const v of geo.vertices) for (const e of geo.vertexEdges[v]!) expect(vertexEdgesOf(v)).toContain(e);
    // The standard board's tables agree for hexes both contain.
    for (const h of ["0,0", "1,0", "0,1"]) expect(geo.hexVertices[h]).toEqual(GEOMETRY.hexVertices[h]);
    // Isolated hex: 6 vertices and 6 boundary edges of its own.
    expect(geo.hexNeighbors["-2,3"]).toEqual([]);
    expect(geo.hexEdges["-2,3"]!.every((e) => geo.boundaryEdges.includes(e))).toBe(true);
    // Memoised.
    expect(geometryFor(shape.map(hexId))).toBe(geo);
  });

  it("coast detection: a hex is coastal when any neighbour is missing, sea or frame; harbours only on coastal edges", () => {
    const def = island();
    const coast = coastalLand(def);
    // In a 3×4 blob the two central hexes of the middle row are landlocked.
    expect(coast.size).toBe(10);
    const ring: BoardDefinition = { ...standardFrame(), hexes: [...standardFrame().hexes, ...[{ q: 3, r: 0 }].map((c) => ({ at: c, kind: "sea" as const }))] };
    const ringCoast = coastalLand(ring);
    expect(ringCoast.has("0,0")).toBe(false);
    expect(ringCoast.has("2,0")).toBe(true);
    expect(ringCoast.size).toBe(12);
    const edges = coastalEdges(def);
    for (const e of edges) {
      const [a, b] = parseEdgeId(e);
      const landIds = new Set(def.hexes.map((h) => hexId(h.at)));
      expect(landIds.has(hexId(a)) !== landIds.has(hexId(b))).toBe(true);
    }
  });

  it("harbour vertex ownership works on non-standard edges", () => {
    const def = island();
    const edge = coastalEdges(def)[0]!;
    const withHarbor: BoardDefinition = { ...def, harbors: [{ edge, ratio: 2, resource: "ore" }], generation: { terrain: "shuffle", tokens: "balanced", harbors: "fixed" } };
    const board = resolveBoard(withHarbor, rng("h", 1));
    expect(board.ports).toHaveLength(1);
    expect(board.ports[0]!.vertices).toEqual(edgeVerticesOf(edge));
    const state = createGame({ seed: "harbor", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], board: withHarbor });
    expect(state.board.ports[0]!.vertices.every((v) => boardGeometry(state.board).vertexHexes[v] !== undefined)).toBe(true);
  });
});

describe("docs/phase8.md §2 pools", () => {
  it("terrain pool keeps the standard proportions and exact totals", () => {
    expect(terrainPool(19).sort()).toEqual(["claypit", "claypit", "claypit", "farmland", "farmland", "farmland", "farmland", "forest", "forest", "forest", "forest", "meadow", "meadow", "meadow", "meadow", "mountain", "mountain", "mountain", "wasteland"]);
    for (const n of [7, 12, 21, 24, 30, 37]) {
      const pool = terrainPool(n);
      expect(pool).toHaveLength(n);
      expect(pool.filter((t) => t === "wasteland").length).toBe(Math.round(n / 19) || 1);
    }
    expect(apportion([["a", 1], ["b", 1], ["c", 1]], 4).map(([, c]) => c).reduce((x, y) => x + y, 0)).toBe(4);
  });

  it("token pool keeps the pip distribution; harbours scale with land ≈ 4:5 generic:specific", () => {
    expect(tokenPool(18).sort((a, b) => a - b)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    const big = tokenPool(28);
    expect(big).toHaveLength(28);
    expect(big.filter((t) => t === 6).length).toBe(3);
    expect(big.filter((t) => t === 2).length).toBeLessThanOrEqual(2);
    expect(harborCount(19)).toBe(9);
    expect(harborCount(30)).toBe(14);
    expect(harborCount(21)).toBe(10);
    const pool = harborPool(9);
    expect(pool.filter((k) => k === "any")).toHaveLength(4);
    expect(pool.filter((k) => k !== "any")).toHaveLength(5);
    expect(harborPool(11).filter((k) => k === "any")).toHaveLength(5);
  });
});

describe("docs/phase8.md §2 generation", () => {
  it("balanced tokens: no 6/8 adjacency, no same-number adjacency, no vertex over 12 pips; deterministic", () => {
    for (const [name, def] of [
      ["large", largeFrame()],
      ["strip", longStripFrame()],
      ["ring", ringFrame()],
      ["island", island()],
    ] as const) {
      const a = resolveBoard(def, rng(`${name}-1`, -2));
      const b = resolveBoard(def, rng(`${name}-1`, -2));
      expect(b).toEqual(a);
      const geo = geometryFor(Object.keys(a.hexes));
      const tokens = new Map<string, number>();
      for (const [h, t] of Object.entries(a.hexes)) if (t.token !== null) tokens.set(h, t.token);
      const v = violations(tokens, geo);
      expect(v.hot).toBe(0);
      expect(v.same).toBe(0);
      expect(v.heavy).toBe(0);
      expect(honorsSixEightRule(a.hexes)).toBe(true);
    }
  });

  it("shuffle terrain fills unassigned hexes from the scaled pool and keeps painted ones in the multiset", () => {
    const def: BoardDefinition = { ...island(), hexes: island().hexes.map((h, i) => (i < 3 ? { ...h, terrain: "mountain" } : h)) };
    const board = resolveBoard(def, rng("fill", 1));
    const counts = Object.values(board.hexes).reduce<Record<string, number>>((m, t) => ({ ...m, [t.terrain]: (m[t.terrain] ?? 0) + 1 }), {});
    expect(counts.mountain).toBeGreaterThanOrEqual(3);
    expect(Object.keys(board.hexes)).toHaveLength(12);
    expect(counts.wasteland).toBe(1);
  });

  it("harbours are auto-placed evenly around the coast sharing no vertex when none are painted", () => {
    const def = island();
    const edges = autoHarborEdges(def, harborCount(12));
    expect(edges).toHaveLength(harborCount(12));
    const verts = edges.flatMap(edgeVerticesOf);
    expect(new Set(verts).size).toBe(verts.length);
    const board = resolveBoard(def, rng("auto", 1));
    expect(board.ports).toHaveLength(harborCount(12));
    for (const p of board.ports) expect(coastalEdges(def)).toContain(p.edge);
  });

  it("the beginner and random boards are definitions on the standard frame; a resolved board round-trips through definitionFromBoard", () => {
    const beginner = resolveBoard(beginnerDefinition(), rng("x", 1));
    expect(beginner).toEqual(beginnerBoard());
    const random = resolveBoard(randomDefinition(), rng("seed-3", -2));
    expect(Object.keys(random.hexes)).toHaveLength(19);
    expect(random.ports).toHaveLength(9);
    const again = resolveBoard(definitionFromBoard(random), rng("other", 9));
    expect(again.hexes).toEqual(random.hexes);
    expect(again.ports).toEqual(random.ports);
  });

  it("every built-in frame resolves and matches its table", () => {
    const table: Record<string, [number, number, number]> = { beginner: [19, 4, 9], random: [19, 4, 9], large: [30, 6, 14], longStrip: [21, 4, 10], ring: [24, 5, 11] };
    for (const [id, [landN, seats, harbors]] of Object.entries(table)) {
      const def = builtInBoard(id as never);
      expect(validateBoard(def).filter((i) => i.severity === "error")).toEqual([]);
      const board = resolveBoard(def, rng(id, -2));
      expect(Object.keys(board.hexes)).toHaveLength(landN);
      expect(board.seats.max).toBe(seats);
      expect(board.ports).toHaveLength(harbors);
    }
    expect(resolveBoard(ringFrame(), rng("r", 1)).sea).toHaveLength(7);
  });
});

describe("docs/phase8.md §3 validation", () => {
  const base = island();
  const errorsOf = (def: BoardDefinition) => validateBoard(def).filter((i) => i.severity === "error").map((i) => i.code);
  const warningsOf = (def: BoardDefinition) => validateBoard(def).filter((i) => i.severity === "warning").map((i) => i.code);

  it("a valid frame has no errors; createGame refuses errors", () => {
    expect(errorsOf(base)).toEqual([]);
    const broken: BoardDefinition = { ...base, hexes: base.hexes.slice(0, 5) };
    expectRule(() => createGame({ seed: "s", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], board: broken }), "INVALID_BOARD");
  });
  it("overlapping hexes", () => expect(errorsOf({ ...base, hexes: [...base.hexes, land(0, 0)] })).toContain("OVERLAP"));
  it("fewer than 7 land hexes", () => expect(errorsOf({ ...base, hexes: base.hexes.slice(0, 6) })).toContain("TOO_SMALL"));
  it("fixed terrain with unassigned hexes; a missing wasteland is a warning", () => {
    expect(errorsOf({ ...base, generation: { ...base.generation, terrain: "fixed" } })).toContain("UNASSIGNED_TERRAIN");
    const painted: BoardDefinition = { ...base, hexes: base.hexes.map((h) => ({ ...h, terrain: "forest" as const })), generation: { ...base.generation, terrain: "fixed" } };
    expect(errorsOf(painted)).toEqual([]);
    expect(warningsOf(painted)).toContain("NO_WASTELAND");
    expect(warningsOf(painted)).toContain("MISSING_TERRAIN");
  });
  it("token on a wasteland", () => expect(errorsOf({ ...base, hexes: [land(0, 0, "wasteland", 8), ...base.hexes.slice(1)] })).toContain("TOKEN_ON_WASTELAND"));
  it("fixed tokens must cover every producing hex; 7 and out-of-range tokens are refused", () => {
    const fixed: BoardDefinition = { ...base, hexes: base.hexes.map((h) => ({ ...h, terrain: "forest" as const, token: 8 })), generation: { terrain: "fixed", tokens: "fixed", harbors: "shuffle" } };
    expect(errorsOf(fixed)).toEqual([]);
    expect(errorsOf({ ...fixed, hexes: fixed.hexes.map((h, i) => (i === 0 ? { at: h.at, kind: "land" as const, terrain: "forest" as const } : h)) })).toContain("TOKEN_COUNT");
    expect(errorsOf({ ...fixed, hexes: fixed.hexes.map((h, i) => (i === 0 ? { ...h, token: 7 } : h)) })).toContain("BAD_TOKEN");
    expect(warningsOf(fixed)).toContain("HOT_ADJACENT");
    expect(warningsOf({ ...fixed, hexes: fixed.hexes.map((h) => ({ ...h, token: 9 })) })).toContain("SAME_ADJACENT");
  });
  it("harbours: inland edge, shared vertex, ratio/resource mismatch, fewer than 2", () => {
    const coast = coastalEdges(base);
    const inland = geometryFor(base.hexes.map((h) => hexId(h.at))).edges.find((e) => !coast.includes(e))!;
    expect(errorsOf({ ...base, harbors: [{ edge: inland, ratio: 3 }] })).toContain("HARBOR_INLAND");
    const e1 = coast[0]!;
    const shared = coast.find((e) => e !== e1 && edgeVerticesOf(e).some((v) => edgeVerticesOf(e1).includes(v)))!;
    expect(errorsOf({ ...base, harbors: [{ edge: e1, ratio: 3 }, { edge: shared, ratio: 3 }] })).toContain("HARBOR_SHARED_VERTEX");
    expect(errorsOf({ ...base, harbors: [{ edge: e1, ratio: 2 }] })).toContain("BAD_RATIO");
    expect(errorsOf({ ...base, harbors: [{ edge: e1, ratio: 3, resource: "ore" }] })).toContain("BAD_RATIO");
    expect(warningsOf({ ...base, harbors: [{ edge: e1, ratio: 3 }], generation: { ...base.generation, harbors: "fixed" } })).toContain("FEW_HARBORS");
  });
  it("land must be connected unless islands are allowed", () => {
    const split: BoardDefinition = { ...base, hexes: [...base.hexes, land(10, 10), land(11, 10)] };
    expect(errorsOf(split)).toContain("LAND_SPLIT");
    expect(validateBoard(split, { allowIslands: true }).filter((i) => i.code === "LAND_SPLIT")).toEqual([]);
    expect(landComponents(split)).toHaveLength(2);
  });
  it("seats.max must be supported by the starting capacity", () => {
    expect(seatsSupported(standardFrame())).toBeGreaterThanOrEqual(4);
    expect(seatsSupported(largeFrame())).toBeGreaterThanOrEqual(6);
    const tiny: BoardDefinition = { ...base, hexes: base.hexes.slice(0, 7), seats: { min: 3, max: 6 } };
    expect(errorsOf(tiny)).toContain("TOO_MANY_SEATS");
  });
  it("sea and frame hexes carry nothing", () => {
    expect(errorsOf({ ...base, hexes: [...base.hexes, { at: { q: 9, r: 9 }, kind: "sea", terrain: "forest" }] })).toContain("SEA_CONTENT");
  });
});

describe("docs/phase8.md §5 five and six players", () => {
  const six = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id.toUpperCase() }));

  it("seats up to the board's max with green and brown colours; a 4-seat board refuses 5", () => {
    const state = createGame({ seed: "six", players: six, board: largeFrame() });
    expect(state.players.map((p) => p.color)).toEqual([...PLAYER_COLORS]);
    expect(state.boardKind).toBe("custom");
    expectRule(() => createGame({ seed: "five", players: six.slice(0, 5), board: "beginner" }), "BAD_PLAYER_COUNT");
    expectRule(() => createGame({ seed: "seven", players: [...six, { id: "g", name: "G" }], board: largeFrame() }), "BAD_PLAYER_COUNT");
  });

  it("after END_TURN every other player gets a special build in seat order, may only build/buy, then the next roll", () => {
    let state = finishSetup(createGame({ seed: "sb", players: six, board: largeFrame() }));
    state = inPhase(state, { kind: "action" }, "b");
    state = give(state, "d", { wood: 1, clay: 1, grain: 3, ore: 3 });
    const after = applyAction(state, { type: "END_TURN", playerId: "b" });
    expect(after.phase).toEqual({ kind: "specialBuild", order: ["c", "d", "e", "f", "a"], index: 0 });
    expect(currentPlayerId(after)).toBe("b");
    expect(nextActor(after)).toBe("c");
    expect(after.turn).toBe(state.turn); // the turn counter moves when the next roll starts
    // c may only build/buy or pass; nobody else acts.
    const cLegal = legalActions(after, "c");
    expect(cLegal.every((a) => ["BUILD_ROAD", "BUILD_SETTLEMENT", "BUILD_CITY", "BUY_DEV_CARD", "SPECIAL_BUILD_DONE"].includes(a.type))).toBe(true);
    expect(cLegal.some((a) => a.type === "SPECIAL_BUILD_DONE")).toBe(true);
    expect(legalActions(after, "d")).toEqual([]);
    expect(legalActions(after, "b")).toEqual([]);
    expectRule(() => applyAction(after, { type: "END_TURN", playerId: "b" }), "WRONG_PHASE");
    expectRule(() => applyAction(after, { type: "SPECIAL_BUILD_DONE", playerId: "d" }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(after, { type: "OFFER_TRADE", playerId: "c", give: { wood: 1, clay: 0, wool: 0, grain: 0, ore: 0 }, receive: { wood: 0, clay: 1, wool: 0, grain: 0, ore: 0 } }), "WRONG_PHASE");
    // d builds a city during their special build and pays for it.
    let s = applyAction(after, { type: "SPECIAL_BUILD_DONE", playerId: "c" });
    expect(nextActor(s)).toBe("d");
    const dCity = legalActions(s, "d").find((a) => a.type === "BUILD_CITY");
    expect(dCity).toBeDefined();
    s = applyAction(s, dCity!);
    expect(getPlayer(s, "d").cities).toHaveLength(1);
    expect(getPlayer(s, "d").hand.ore).toBe(0);
    for (const id of ["d", "e", "f", "a"]) s = applyAction(s, { type: "SPECIAL_BUILD_DONE", playerId: id });
    expect(s.phase).toEqual({ kind: "roll" });
    expect(currentPlayerId(s)).toBe("c");
    expect(s.turn).toBe(state.turn + 1);
  });

  it("with four or fewer players END_TURN goes straight to the next roll", () => {
    let state = finishSetup(createGame({ seed: "four", players: six.slice(0, 4), board: "beginner" }));
    state = inPhase(state, { kind: "action" }, "a");
    const after = applyAction(state, { type: "END_TURN", playerId: "a" });
    expect(after.phase).toEqual({ kind: "roll" });
    expect(currentPlayerId(after)).toBe("b");
  });

  it("a setup round with six players on the large frame places 24 pieces and everyone gets starting resources", () => {
    const state = finishSetup(createGame({ seed: "setup6", players: six, board: largeFrame() }));
    expect(state.players.every((p) => p.settlements.length === 2 && p.roads.length === 2)).toBe(true);
    expect(legalSetupSettlementVertices(createGame({ seed: "x", players: six, board: largeFrame() })).length).toBeGreaterThan(54);
    expect(state.phase).toEqual({ kind: "roll" });
  });
});

describe("docs/phase8.md §8 no 3-4-5-4-3 assumptions", () => {
  it("a game on the long strip plays through setup and production with the robber on the wasteland or first hex", () => {
    const def = longStripFrame();
    const state = finishSetup(createGame({ seed: "strip", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], board: def }));
    expect(Object.keys(state.board.hexes)).toHaveLength(21);
    const robberTile = state.board.hexes[state.robberHex]!;
    expect(robberTile.terrain === "wasteland" || state.robberHex === Object.keys(state.board.hexes).sort()[0]).toBe(true);
    const moves = legalActions({ ...state, phase: { kind: "moveRobber", via: "seven", returnTo: "action" } }, "a");
    expect(moves).toHaveLength(20);
    const b: Board = state.board;
    expect(b.seats.max).toBe(4);
  });
});
