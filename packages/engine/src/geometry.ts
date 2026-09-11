/**
 * Hex / vertex / edge geometry (docs/rules.md §3).
 *
 * Axial coordinates (q, r), pointy-top. The board is the radius-2 hexagon
 * of 19 hexes. Vertices and edges are identified by the (real or virtual)
 * hexes that meet there, which gives every vertex and edge a canonical ID
 * without any numbering scheme.
 */

export interface HexCoord {
  readonly q: number;
  readonly r: number;
}

/** `"q,r"` */
export type HexId = string;
/** Three sorted hex IDs joined by `|`. */
export type VertexId = string;
/** Two sorted hex IDs joined by `|`. */
export type EdgeId = string;

export const BOARD_RADIUS = 2;

/** Neighbour directions in counter-clockwise angular order (§3.1). */
export const DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexId(c: HexCoord): HexId {
  return `${c.q},${c.r}`;
}

export function parseHexId(id: HexId): HexCoord {
  const parts = id.split(",");
  if (parts.length !== 2) throw new Error(`Bad hex id: ${id}`);
  const q = Number(parts[0]);
  const r = Number(parts[1]);
  if (!Number.isInteger(q) || !Number.isInteger(r)) throw new Error(`Bad hex id: ${id}`);
  return { q, r };
}

export function hexDistanceFromCenter(c: HexCoord): number {
  const s = -c.q - c.r;
  return Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(s));
}

export function isOnBoard(c: HexCoord): boolean {
  return hexDistanceFromCenter(c) <= BOARD_RADIUS;
}

export function neighbor(c: HexCoord, direction: number): HexCoord {
  const d = DIRECTIONS[((direction % 6) + 6) % 6] as HexCoord;
  return { q: c.q + d.q, r: c.r + d.r };
}

export function areNeighbors(a: HexCoord, b: HexCoord): boolean {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  return DIRECTIONS.some((d) => d.q === dq && d.r === dr);
}

function compareHex(a: HexCoord, b: HexCoord): number {
  return a.q - b.q || a.r - b.r;
}

function canonicalKey(hexes: HexCoord[]): string {
  return hexes.slice().sort(compareHex).map(hexId).join("|");
}

/** Vertex shared by three mutually adjacent hexes. */
export function vertexId(a: HexCoord, b: HexCoord, c: HexCoord): VertexId {
  return canonicalKey([a, b, c]);
}

/** Edge between two adjacent hexes. */
export function edgeId(a: HexCoord, b: HexCoord): EdgeId {
  return canonicalKey([a, b]);
}

export function parseVertexId(id: VertexId): [HexCoord, HexCoord, HexCoord] {
  const parts = id.split("|");
  if (parts.length !== 3) throw new Error(`Bad vertex id: ${id}`);
  return [parseHexId(parts[0] as string), parseHexId(parts[1] as string), parseHexId(parts[2] as string)];
}

export function parseEdgeId(id: EdgeId): [HexCoord, HexCoord] {
  const parts = id.split("|");
  if (parts.length !== 2) throw new Error(`Bad edge id: ${id}`);
  return [parseHexId(parts[0] as string), parseHexId(parts[1] as string)];
}

/** Corner k of hex `c` (§3.2): shared with neighbours k and k+1. */
export function hexCorner(c: HexCoord, k: number): VertexId {
  return vertexId(c, neighbor(c, k), neighbor(c, k + 1));
}

/** Edge k of hex `c`: the edge shared with neighbour k. */
export function hexEdge(c: HexCoord, k: number): EdgeId {
  return edgeId(c, neighbor(c, k));
}

/** The 19 board hexes in sorted (q, r) order. */
export function allBoardHexes(): HexCoord[] {
  const out: HexCoord[] = [];
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
    for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
      const c = { q, r };
      if (isOnBoard(c)) out.push(c);
    }
  }
  return out.sort(compareHex);
}

/** Ring of hexes at `radius` from the centre, starting at (-radius, radius). */
export function hexRing(radius: number): HexCoord[] {
  if (radius === 0) return [{ q: 0, r: 0 }];
  const out: HexCoord[] = [];
  let c: HexCoord = { q: -radius, r: radius };
  for (let dir = 0; dir < 6; dir++) {
    for (let step = 0; step < radius; step++) {
      out.push(c);
      c = neighbor(c, dir);
    }
  }
  return out;
}

/** Spiral order (§3.5): outer ring, inner ring, centre. */
export function spiralOrder(): HexCoord[] {
  return [...hexRing(2), ...hexRing(1), ...hexRing(0)];
}

export interface Geometry {
  readonly hexes: readonly HexId[];
  readonly vertices: readonly VertexId[];
  readonly edges: readonly EdgeId[];
  /** 6 corners per hex in corner order. */
  readonly hexVertices: Readonly<Record<HexId, readonly VertexId[]>>;
  /** 6 edges per hex in direction order. */
  readonly hexEdges: Readonly<Record<HexId, readonly EdgeId[]>>;
  /** On-board neighbours only. */
  readonly hexNeighbors: Readonly<Record<HexId, readonly HexId[]>>;
  /** Real (on-board) hexes touching each vertex. */
  readonly vertexHexes: Readonly<Record<VertexId, readonly HexId[]>>;
  readonly vertexEdges: Readonly<Record<VertexId, readonly EdgeId[]>>;
  readonly vertexNeighbors: Readonly<Record<VertexId, readonly VertexId[]>>;
  readonly edgeVertices: Readonly<Record<EdgeId, readonly [VertexId, VertexId]>>;
  /** Real hexes on each edge (1 for boundary edges, 2 otherwise). */
  readonly edgeHexes: Readonly<Record<EdgeId, readonly HexId[]>>;
  readonly boundaryEdges: readonly EdgeId[];
}

function buildGeometry(): Geometry {
  const hexCoords = allBoardHexes();
  const hexes = hexCoords.map(hexId);
  const hexVertices: Record<HexId, VertexId[]> = {};
  const hexEdges: Record<HexId, EdgeId[]> = {};
  const hexNeighbors: Record<HexId, HexId[]> = {};
  const vertexHexes: Record<VertexId, HexId[]> = {};
  const vertexEdges: Record<VertexId, EdgeId[]> = {};
  const edgeVertices: Record<EdgeId, [VertexId, VertexId]> = {};
  const edgeHexes: Record<EdgeId, HexId[]> = {};

  for (const c of hexCoords) {
    const id = hexId(c);
    const corners: VertexId[] = [];
    const edges: EdgeId[] = [];
    const neighbors: HexId[] = [];
    for (let k = 0; k < 6; k++) {
      const v = hexCorner(c, k);
      corners.push(v);
      (vertexHexes[v] ??= []).push(id);

      const e = hexEdge(c, k);
      edges.push(e);
      (edgeHexes[e] ??= []).push(id);
      // Edge k runs between corner k-1 and corner k.
      edgeVertices[e] = [hexCorner(c, k + 5), v].sort() as [VertexId, VertexId];

      const n = neighbor(c, k);
      if (isOnBoard(n)) neighbors.push(hexId(n));
    }
    hexVertices[id] = corners;
    hexEdges[id] = edges;
    hexNeighbors[id] = neighbors;
  }

  const vertices = Object.keys(vertexHexes).sort();
  const edges = Object.keys(edgeVertices).sort();

  for (const e of edges) {
    const [a, b] = edgeVertices[e] as [VertexId, VertexId];
    (vertexEdges[a] ??= []).push(e);
    (vertexEdges[b] ??= []).push(e);
  }

  const vertexNeighbors: Record<VertexId, VertexId[]> = {};
  for (const v of vertices) {
    const list = (vertexEdges[v] ??= []).sort();
    vertexEdges[v] = list;
    vertexNeighbors[v] = list.map((e) => {
      const [a, b] = edgeVertices[e] as [VertexId, VertexId];
      return a === v ? b : a;
    });
  }

  const boundaryEdges = edges.filter((e) => (edgeHexes[e] as HexId[]).length === 1);

  return {
    hexes,
    vertices,
    edges,
    hexVertices,
    hexEdges,
    hexNeighbors,
    vertexHexes,
    vertexEdges,
    vertexNeighbors,
    edgeVertices,
    edgeHexes,
    boundaryEdges,
  };
}

/** Precomputed geometry for the fixed radius-2 board. */
export const GEOMETRY: Geometry = buildGeometry();

export function isBoardVertex(v: VertexId): boolean {
  return Object.prototype.hasOwnProperty.call(GEOMETRY.vertexHexes, v);
}

export function isBoardEdge(e: EdgeId): boolean {
  return Object.prototype.hasOwnProperty.call(GEOMETRY.edgeVertices, e);
}

// ---------------------------------------------------------------------------
// Pixel helpers (unit hex size, pointy-top). Pure math, used by the SVG board.

export interface Point {
  readonly x: number;
  readonly y: number;
}

const SQRT3 = Math.sqrt(3);

export function hexCenter(c: HexCoord): Point {
  return { x: SQRT3 * (c.q + c.r / 2), y: 1.5 * c.r };
}

export function vertexPosition(v: VertexId): Point {
  const [a, b, c] = parseVertexId(v).map(hexCenter) as [Point, Point, Point];
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

export function edgeMidpoint(e: EdgeId): Point {
  const [a, b] = parseEdgeId(e).map(hexCenter) as [Point, Point];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
