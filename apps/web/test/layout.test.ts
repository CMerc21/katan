import { describe, expect, it } from "vitest";
import { GEOMETRY, hexCorner } from "@katan/engine";
import { createLayout, hexPoints } from "@/board/layout";

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

describe("layout", () => {
  it("gives every shared vertex one coordinate, matching each hex's geometric corner", () => {
    const layout = createLayout(50);
    for (const hex of GEOMETRY.hexes) {
      for (let k = 0; k < 6; k++) {
        const id = hexCorner(
          (() => {
            const [q, r] = hex.split(",").map(Number) as [number, number];
            return { q, r };
          })(),
          k,
        );
        const fromId = layout.vertex(id);
        const fromCorner = layout.corner(hex, k);
        expect(close(fromId.x, fromCorner.x)).toBe(true);
        expect(close(fromId.y, fromCorner.y)).toBe(true);
      }
    }
  });

  it("two hexes sharing a vertex produce the same point for that vertex id", () => {
    const layout = createLayout(40);
    for (const v of GEOMETRY.vertices) {
      const hexes = GEOMETRY.vertexHexes[v]!;
      if (hexes.length < 2) continue;
      const points = hexes.map((h) => {
        const k = GEOMETRY.hexVertices[h]!.indexOf(v);
        return layout.corner(h, k);
      });
      for (const p of points) {
        expect(close(p.x, points[0]!.x)).toBe(true);
        expect(close(p.y, points[0]!.y)).toBe(true);
      }
    }
  });

  it("edges join their two vertices and midpoints sit between them", () => {
    const layout = createLayout(30);
    for (const e of GEOMETRY.edges) {
      const [a, b] = layout.edge(e);
      const m = layout.edgeMid(e);
      expect(close((a.x + b.x) / 2, m.x)).toBe(true);
      expect(close((a.y + b.y) / 2, m.y)).toBe(true);
      // Edge length equals the hex side (R).
      expect(close(Math.hypot(a.x - b.x, a.y - b.y), 30)).toBe(true);
    }
  });

  it("viewBox contains every vertex with a margin, centred on the origin", () => {
    const layout = createLayout(20);
    const [x, y, w, h] = layout.viewBox.split(" ").map(Number) as [number, number, number, number];
    for (const v of GEOMETRY.vertices) {
      const p = layout.vertex(v);
      expect(p.x).toBeGreaterThan(x);
      expect(p.x).toBeLessThan(x + w);
      expect(p.y).toBeGreaterThan(y);
      expect(p.y).toBeLessThan(y + h);
    }
    expect(close(x + w / 2, 0, 0.01)).toBe(true);
    expect(close(y + h / 2, 0, 0.01)).toBe(true);
    expect(w).toBeGreaterThan(h); // pointy-top boards are wider than tall
  });

  it("hexPoints emits six points and an inset shrinks towards the centre", () => {
    const layout = createLayout(10);
    expect(hexPoints(layout, "0,0").split(" ")).toHaveLength(6);
    const inset = hexPoints(layout, "0,0", 2).split(" ").map((s) => s.split(",").map(Number) as [number, number]);
    for (const [px, py] of inset) expect(close(Math.hypot(px, py), 8, 0.01)).toBe(true);
  });

  it("outward vectors on boundary edges point away from the board", () => {
    const layout = createLayout(10);
    for (const e of GEOMETRY.boundaryEdges) {
      const o = layout.outward(e);
      const m = layout.edgeMid(e);
      // Moving outward increases distance from the origin.
      expect(Math.hypot(m.x + o.x, m.y + o.y)).toBeGreaterThan(Math.hypot(m.x, m.y));
    }
  });
});
