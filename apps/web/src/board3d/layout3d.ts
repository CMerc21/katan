/**
 * World coordinates for the diorama (docs/phase7-5.md §2): hex radius = 1,
 * the engine's unit geometry with y → z, so every vertex and edge ID maps to
 * one point that agrees with the 2D layout (`src/board/layout.ts`).
 */

import { edgeVerticesOf, hexCenter, hexEdge, neighbor, parseEdgeId, parseHexId, vertexPosition, type EdgeId, type HexId, type VertexId } from "@katan/engine";

import { LAND_HEIGHT, SEA_SLAB_HEIGHT, slabJitter } from "./slab";

export const HEX_RADIUS = 1;
/** A hex edge is as long as the circumradius: the distance between two adjacent vertices (pinned in test/board3d.test.ts). */
export const EDGE_LENGTH = HEX_RADIUS;
/** Land slabs are 0.22 R tall (docs/props.md §1); pieces and props stand on this plane. */
export const SLAB_HEIGHT = LAND_HEIGHT;
/** Sea slabs are 0.15 R; ships and the pirate float on this plane. */
export const SEA_HEIGHT = SEA_SLAB_HEIGHT;

export interface World {
  readonly x: number;
  readonly z: number;
}

export function hexWorld(hex: HexId): World {
  const c = hexCenter(parseHexId(hex));
  return { x: c.x, z: c.y };
}

export function vertexWorld(v: VertexId): World {
  const p = vertexPosition(v);
  return { x: p.x, z: p.y };
}

export function edgeWorld(e: EdgeId): { a: World; b: World; mid: World; angle: number } {
  const [va, vb] = edgeVerticesOf(e);
  const a = vertexWorld(va);
  const b = vertexWorld(vb);
  return { a, b, mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, angle: Math.atan2(b.z - a.z, b.x - a.x) };
}

/** Corner k of a hex (same numbering as the engine and the 2D layout). */
export function hexCornerWorld(hex: HexId, k: number): World {
  const c = hexWorld(hex);
  const angle = (-(30 + 60 * k) * Math.PI) / 180;
  return { x: c.x + HEX_RADIUS * Math.cos(angle), z: c.z + HEX_RADIUS * Math.sin(angle) };
}

/** Unit vector pointing away from the land through an edge midpoint (for piers). */
export function outwardWorld(e: EdgeId, centre: World = { x: 0, z: 0 }, land: ReadonlySet<HexId> | null = null): World {
  const { mid } = edgeWorld(e);
  const hexes = parseEdgeId(e).map((c) => `${c.q},${c.r}`).filter((h) => (land ? land.has(h) : true));
  const from = hexes.length === 1 ? hexWorld(hexes[0] as HexId) : centre;
  const dx = mid.x - from.x;
  const dz = mid.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/**
 * The edges where land meets open sea, sorted and de-duplicated. Both hexes of
 * a shoreline edge see it, so this returns one entry per edge and the foam is
 * drawn once. An edge between two land hexes, or between two sea hexes, is not
 * a shoreline.
 */
export function shorelineEdges(land: ReadonlySet<HexId>, sea: ReadonlySet<HexId>): EdgeId[] {
  const out = new Set<EdgeId>();
  for (const h of land) {
    const c = parseHexId(h);
    for (let k = 0; k < 6; k++) {
      const n = neighbor(c, k);
      if (sea.has(`${n.q},${n.r}` as HexId)) out.add(hexEdge(c, k));
    }
  }
  return [...out].sort();
}

export interface Bounds {
  readonly cx: number;
  readonly cz: number;
  /** Radius of the smallest circle around every hex corner. */
  readonly radius: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export function boardBounds(hexes: readonly HexId[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const h of hexes) {
    for (let k = 0; k < 6; k++) {
      const p = hexCornerWorld(h, k);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) return { cx: 0, cz: 0, radius: 1, minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (const h of hexes) for (let k = 0; k < 6; k++) {
    const p = hexCornerWorld(h, k);
    radius = Math.max(radius, Math.hypot(p.x - cx, p.z - cz));
  }
  return { cx, cz, radius, minX, maxX, minZ, maxZ };
}

/** Camera distance that frames a circle of `radius` with `margin` (fraction) at a vertical fov (deg) and aspect. */
export function framingDistance(radius: number, fovDeg: number, aspect: number, margin = 0.1): number {
  const vfov = (fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fov = Math.min(vfov, hfov);
  return (radius * (1 + margin)) / Math.sin(fov / 2);
}

/** Seeded per-tile jitter (docs/props.md §1): rotation ±0.4° about the vertical and height ±1.5%. */
export function tileJitter(hex: HexId): { rotation: number; height: number } {
  return slabJitter(hex);
}

/**
 * What the default camera frames. The whole board's bounds include the sea
 * ring (and the frame), which put the land in the middle 60% of the frame
 * with water and table around it. The camera now frames the land plus the
 * first ring of sea and the props that stand just off it, and never more than
 * the whole board.
 */
export const CAMERA_SEA_MARGIN = 2.4;

export function cameraBounds(bounds: Bounds, landBounds: Bounds): Bounds {
  const radius = Math.min(bounds.radius, landBounds.radius + CAMERA_SEA_MARGIN);
  return { ...landBounds, radius };
}
