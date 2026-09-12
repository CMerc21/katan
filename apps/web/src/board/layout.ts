/**
 * Screen geometry for the SVG board (docs/phase3.md §4.1).
 *
 * The engine defines hex centres and vertex positions in unit hex size with
 * pointy-top orientation. This module scales them by `R` and adds the
 * viewBox, so every vertex/edge ID maps to exactly one screen point.
 */

import {
  GEOMETRY,
  edgeMidpoint,
  edgeVerticesOf,
  geometryFor,
  hexCenter,
  parseEdgeId,
  parseHexId,
  vertexPosition,
  type EdgeId,
  type HexId,
  type Point,
  type VertexId,
} from "@katan/engine";

export interface Layout {
  readonly R: number;
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  hex(id: HexId): Point;
  /** Corner k (0..5) of a hex as a screen point, matching the engine's corner numbering. */
  corner(id: HexId, k: number): Point;
  vertex(id: VertexId): Point;
  edge(id: EdgeId): readonly [Point, Point];
  edgeMid(id: EdgeId): Point;
  /** Unit vector from the board centre through the edge midpoint (for harbor markers). */
  outward(id: EdgeId): Point;
}

const WATER_MARGIN = 1.5; // in hex radii beyond the outermost vertices

/** Screen geometry for a board of any shape (docs/phase8.md §1); defaults to the standard 19 hexes. */
export function createLayout(R: number, hexIds: readonly HexId[] = GEOMETRY.hexes): Layout {
  const scale = (p: Point): Point => ({ x: p.x * R, y: p.y * R });
  const geo = geometryFor(hexIds);
  const centre = (() => {
    if (hexIds.length === 0) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (const h of hexIds) {
      const c = hexCenter(parseHexId(h));
      sx += c.x;
      sy += c.y;
    }
    return { x: sx / hexIds.length, y: sy / hexIds.length };
  })();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of geo.vertices) {
    const p = scale(vertexPosition(v));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const margin = WATER_MARGIN * R;
  const x0 = minX - margin;
  const y0 = minY - margin;
  const width = maxX - minX + 2 * margin;
  const height = maxY - minY + 2 * margin;

  return {
    R,
    viewBox: `${round(x0)} ${round(y0)} ${round(width)} ${round(height)}`,
    width,
    height,
    hex: (id) => scale(hexCenter(parseHexId(id))),
    corner: (id, k) => {
      const c = scale(hexCenter(parseHexId(id)));
      // Corner k sits between neighbour directions k and k+1; direction k is
      // at angle -60k degrees in screen space (y down), so the corner is at -(30 + 60k).
      const angle = (-(30 + 60 * k) * Math.PI) / 180;
      return { x: c.x + R * Math.cos(angle), y: c.y + R * Math.sin(angle) };
    },
    vertex: (id) => scale(vertexPosition(id)),
    edge: (id) => {
      const [a, b] = geo.edgeVertices[id] ?? edgeVerticesOf(id);
      return [scale(vertexPosition(a)), scale(vertexPosition(b))];
    },
    edgeMid: (id) => scale(edgeMidpoint(id)),
    outward: (id) => {
      const [a, b] = parseEdgeId(id);
      const m = edgeMidpoint(id);
      const onBoard = geo.edgeHexes[id] ?? [];
      // Point away from the real hex when there is exactly one; else from the centre.
      const from = onBoard.length === 1 ? hexCenter(parseHexId(onBoard[0]!)) : centre;
      void a;
      void b;
      const dx = m.x - from.x;
      const dy = m.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The six corners of a hex as an SVG points string. */
export function hexPoints(layout: Layout, id: HexId, inset = 0): string {
  const c = layout.hex(id);
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const p = layout.corner(id, k);
    const x = c.x + (p.x - c.x) * (1 - inset / layout.R);
    const y = c.y + (p.y - c.y) * (1 - inset / layout.R);
    pts.push(`${round(x)},${round(y)}`);
  }
  return pts.join(" ");
}

/** A large hexagon around the whole board for the water, sized from the viewBox. */
export function waterPoints(layout: Layout): string {
  const [x0, y0, w, h] = layout.viewBox.split(" ").map(Number) as [number, number, number, number];
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const radius = Math.hypot(w, h) / 2 - 0.4 * layout.R;
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (-(60 * k) * Math.PI) / 180;
    pts.push(`${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`);
  }
  return pts.join(" ");
}
