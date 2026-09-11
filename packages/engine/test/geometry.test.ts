import { describe, expect, it } from "vitest";
import {
  GEOMETRY,
  allBoardHexes,
  areNeighbors,
  edgeId,
  edgeMidpoint,
  hexCorner,
  hexId,
  hexRing,
  isBoardEdge,
  isBoardVertex,
  neighbor,
  parseEdgeId,
  parseHexId,
  parseVertexId,
  spiralOrder,
  vertexId,
  vertexPosition,
} from "../src/geometry";

describe("§3 geometry", () => {
  it("§3.1 board has 19 hexes and hex ids round-trip", () => {
    const hexes = allBoardHexes();
    expect(hexes).toHaveLength(19);
    expect(GEOMETRY.hexes).toHaveLength(19);
    for (const c of hexes) {
      expect(parseHexId(hexId(c))).toEqual(c);
    }
    expect(() => parseHexId("1")).toThrow();
    expect(() => parseHexId("a,b")).toThrow();
  });

  it("§3.1 consecutive directions are neighbours of each other", () => {
    const c = { q: 0, r: 0 };
    for (let k = 0; k < 6; k++) {
      expect(areNeighbors(neighbor(c, k), neighbor(c, k + 1))).toBe(true);
      expect(areNeighbors(c, neighbor(c, k))).toBe(true);
    }
    expect(areNeighbors(c, { q: 2, r: 0 })).toBe(false);
    expect(neighbor(c, -1)).toEqual(neighbor(c, 5));
  });

  it("§3.2 board has 54 vertices with canonical ids", () => {
    expect(GEOMETRY.vertices).toHaveLength(54);
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const c = { q: 0, r: 1 };
    expect(vertexId(a, b, c)).toBe("0,0|0,1|1,0");
    expect(vertexId(c, a, b)).toBe(vertexId(a, b, c));
    expect(parseVertexId("0,0|0,1|1,0")).toEqual([a, c, b]);
    expect(() => parseVertexId("0,0|0,1")).toThrow();
  });

  it("§3.2 each hex has 6 distinct corners shared with its neighbours", () => {
    for (const h of GEOMETRY.hexes) {
      const corners = GEOMETRY.hexVertices[h]!;
      expect(new Set(corners).size).toBe(6);
      for (const v of corners) expect(GEOMETRY.vertexHexes[v]).toContain(h);
    }
    const c = { q: 0, r: 0 };
    const v = hexCorner(c, 0);
    expect(GEOMETRY.vertexHexes[v]!.slice().sort()).toEqual(
      [hexId(c), hexId(neighbor(c, 0)), hexId(neighbor(c, 1))].sort(),
    );
  });

  it("§3.3 board has 72 edges, 30 of them boundary", () => {
    expect(GEOMETRY.edges).toHaveLength(72);
    expect(GEOMETRY.boundaryEdges).toHaveLength(30);
    expect(edgeId({ q: 1, r: 0 }, { q: 0, r: 0 })).toBe("0,0|1,0");
    expect(parseEdgeId("0,0|1,0")).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
    expect(() => parseEdgeId("0,0")).toThrow();
    for (const e of GEOMETRY.edges) {
      const n = GEOMETRY.edgeHexes[e]!.length;
      expect(n === 1 || n === 2).toBe(true);
    }
  });

  it("§3.3 every edge joins two vertices that both contain the edge's hexes", () => {
    for (const e of GEOMETRY.edges) {
      const [a, b] = GEOMETRY.edgeVertices[e]!;
      expect(a).not.toBe(b);
      expect(GEOMETRY.vertexEdges[a]).toContain(e);
      expect(GEOMETRY.vertexEdges[b]).toContain(e);
      const [ha, hb] = parseEdgeId(e);
      for (const v of [a, b]) {
        const hs = parseVertexId(v).map(hexId);
        expect(hs).toContain(hexId(ha));
        expect(hs).toContain(hexId(hb));
      }
    }
  });

  it("§3.4 vertex adjacency is symmetric with 2 or 3 neighbours", () => {
    for (const v of GEOMETRY.vertices) {
      const ns = GEOMETRY.vertexNeighbors[v]!;
      expect(ns.length === 2 || ns.length === 3).toBe(true);
      expect(ns).not.toContain(v);
      for (const n of ns) expect(GEOMETRY.vertexNeighbors[n]).toContain(v);
    }
    const inner = GEOMETRY.vertices.filter((v) => GEOMETRY.vertexNeighbors[v]!.length === 3);
    expect(inner.length).toBeGreaterThan(0);
  });

  it("§3.4 hexes have 6 edges and on-board neighbours", () => {
    for (const h of GEOMETRY.hexes) {
      expect(GEOMETRY.hexEdges[h]).toHaveLength(6);
      const n = GEOMETRY.hexNeighbors[h]!.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(GEOMETRY.hexNeighbors["0,0"]).toHaveLength(6);
    expect(GEOMETRY.hexNeighbors["2,-2"]).toHaveLength(3);
  });

  it("§3.4 isBoardVertex / isBoardEdge reject off-board ids", () => {
    expect(isBoardVertex(GEOMETRY.vertices[0]!)).toBe(true);
    expect(isBoardVertex("3,0|3,1|4,0")).toBe(false);
    expect(isBoardVertex("toString")).toBe(false);
    expect(isBoardEdge(GEOMETRY.edges[0]!)).toBe(true);
    expect(isBoardEdge("3,0|4,0")).toBe(false);
  });

  it("§3.5 spiral order visits every hex once, outer ring first", () => {
    const spiral = spiralOrder();
    expect(spiral).toHaveLength(19);
    expect(new Set(spiral.map(hexId)).size).toBe(19);
    expect(spiral[0]).toEqual({ q: -2, r: 2 });
    expect(spiral[18]).toEqual({ q: 0, r: 0 });
    expect(hexRing(2)).toHaveLength(12);
    expect(hexRing(1)).toHaveLength(6);
    const ring = hexRing(2);
    for (let i = 0; i < ring.length; i++) {
      expect(areNeighbors(ring[i]!, ring[(i + 1) % ring.length]!)).toBe(true);
    }
  });

  it("pixel helpers place vertices at unit distance from hex centres", () => {
    const v = hexCorner({ q: 0, r: 0 }, 0);
    const p = vertexPosition(v);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 6);
    const m = edgeMidpoint("0,0|1,0");
    expect(m.x).toBeCloseTo(Math.sqrt(3) / 2, 6);
    expect(m.y).toBeCloseTo(0, 6);
  });
});
