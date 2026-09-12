import { describe, expect, it } from "vitest";
import {
  NUMBER_TOKENS,
  PORT_KINDS,
  RESOURCES,
  TERRAIN_COUNTS,
  TERRAIN_RESOURCE,
  beginnerBoard,
  honorsSixEightRule,
  makeBoard,
  portEdgesInOrder,
  randomBoard,
  wastelandHex,
  type Board,
  type HexTile,
  type Terrain,
} from "../src/board";
import { GEOMETRY } from "../src/geometry";

function terrainCounts(board: Board): Record<Terrain, number> {
  const counts = { forest: 0, claypit: 0, meadow: 0, farmland: 0, mountain: 0, wasteland: 0, gold: 0 };
  for (const h of GEOMETRY.hexes) counts[board.hexes[h]!.terrain]++;
  return counts;
}

function tokenMultiset(board: Board): number[] {
  return GEOMETRY.hexes
    .map((h) => board.hexes[h]!.token)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
}

function expectValidBoard(board: Board): void {
  expect(Object.keys(board.hexes)).toHaveLength(19);
  expect(terrainCounts(board)).toEqual(TERRAIN_COUNTS);
  expect(tokenMultiset(board)).toEqual([...NUMBER_TOKENS]);
  expect(board.hexes[wastelandHex(board)]!.token).toBeNull();
  expect(honorsSixEightRule(board.hexes)).toBe(true);

  expect(board.ports).toHaveLength(9);
  const kinds = board.ports.map((p) => p.kind).sort();
  expect(kinds).toEqual([...PORT_KINDS].sort());
  const portVertices = board.ports.flatMap((p) => p.vertices);
  expect(new Set(portVertices).size).toBe(18);
  for (const p of board.ports) {
    expect(GEOMETRY.boundaryEdges).toContain(p.edge);
    expect(p.vertices).toEqual(GEOMETRY.edgeVertices[p.edge]);
  }
}

describe("§2 board", () => {
  it("§2.1 every terrain maps to its resource", () => {
    expect(TERRAIN_RESOURCE.forest).toBe("wood");
    expect(TERRAIN_RESOURCE.claypit).toBe("clay");
    expect(TERRAIN_RESOURCE.meadow).toBe("wool");
    expect(TERRAIN_RESOURCE.farmland).toBe("grain");
    expect(TERRAIN_RESOURCE.mountain).toBe("ore");
    expect(TERRAIN_RESOURCE.wasteland).toBeNull();
    expect(RESOURCES).toHaveLength(5);
  });

  it("§2.1 §2.2 §2.6 beginner board is valid and deterministic", () => {
    const board = beginnerBoard();
    expectValidBoard(board);
    expect(beginnerBoard()).toEqual(board);
    expect(makeBoard("beginner", "ignored")).toEqual(board);
    expect(wastelandHex(board)).toBe("0,0");
  });

  it("§2.2 honorsSixEightRule detects adjacent hot tokens", () => {
    const board = beginnerBoard();
    const broken: Record<string, HexTile> = { ...board.hexes, "0,0": { terrain: "farmland", token: 8 } };
    // The centre touches every inner-ring hex; give one of them a 6.
    const inner = GEOMETRY.hexNeighbors["0,0"]![0]!;
    broken[inner] = { terrain: "forest", token: 6 };
    expect(honorsSixEightRule(broken)).toBe(false);
  });

  it("§2.2 §12 random boards are valid, seeded, and vary by seed", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`);
    const boards = seeds.map((s) => randomBoard(s));
    for (const b of boards) expectValidBoard(b);
    expect(randomBoard("seed-3")).toEqual(boards[3]);
    expect(makeBoard("random", "seed-3")).toEqual(boards[3]);
    const distinctWasteland = new Set(boards.map(wastelandHex));
    expect(distinctWasteland.size).toBeGreaterThan(1);
    const distinctPorts = new Set(boards.map((b) => b.ports.map((p) => p.kind).join(",")));
    expect(distinctPorts.size).toBeGreaterThan(1);
  });

  it("§3.6 port edges are boundary edges that share no vertex", () => {
    const edges = portEdgesInOrder();
    expect(edges).toHaveLength(9);
    expect(new Set(edges).size).toBe(9);
    const verts = edges.flatMap((e) => GEOMETRY.edgeVertices[e]!);
    expect(new Set(verts).size).toBe(18);
  });

  it("makeBoard rejects unknown kinds", () => {
    expect(() => makeBoard("nope" as never, "s")).toThrow();
  });

  it("wastelandHex falls back to the first land hex when no wasteland is present (docs/phase8.md §3)", () => {
    const board = beginnerBoard();
    const noWaste: Board = {
      ...board,
      hexes: { ...board.hexes, "0,0": { terrain: "forest", token: 2 } },
    };
    expect(wastelandHex(noWaste)).toBe(Object.keys(noWaste.hexes).sort()[0]);
  });
});
