/**
 * World coordinates for the diorama (docs/phase7-5.md §2): hex radius = 1,
 * the engine's unit geometry with y → z, so every vertex and edge ID maps to
 * one point that agrees with the 2D layout (`src/board/layout.ts`).
 */

import { GEOMETRY, edgeMidpoint, hexCenter, parseEdgeId, parseHexId, vertexPosition, type EdgeId, type HexId, type VertexId } from "@katan/engine";

export const HEX_RADIUS = 1;
export const SLAB_HEIGHT = 0.18;
export const SEA_HEIGHT = 0.1;

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
  const [va, vb] = GEOMETRY.edgeVertices[e] ?? [];
  if (!va || !vb) {
    // An edge outside the precomputed geometry: still well-defined from its ID.
    const [h1, h2] = parseEdgeId(e).map(hexCenter);
    const mid = edgeMidpoint(e);
    return { a: { x: h1!.x, z: h1!.y }, b: { x: h2!.x, z: h2!.y }, mid: { x: mid.x, z: mid.y }, angle: 0 };
  }
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

/** Unit vector pointing away from the board centre through an edge midpoint (for piers). */
export function outwardWorld(e: EdgeId, centre: World = { x: 0, z: 0 }): World {
  const { mid } = edgeWorld(e);
  const hexes = GEOMETRY.edgeHexes[e] ?? [];
  const from = hexes.length === 1 ? hexWorld(hexes[0] as HexId) : centre;
  const dx = mid.x - from.x;
  const dz = mid.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
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

/** Seeded per-tile jitter so the board feels hand-placed (docs/phase7-5.md §1). */
export function tileJitter(hex: HexId): { tiltX: number; tiltZ: number; height: number; rotation: number } {
  let h = 2166136261;
  for (let i = 0; i < hex.length; i++) {
    h ^= hex.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (k: number) => {
    h = (h + 0x6d2b79f5 * (k + 1)) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const deg = 0.5 * (Math.PI / 180);
  return { tiltX: (u(1) * 2 - 1) * deg, tiltZ: (u(2) * 2 - 1) * deg, height: 1 + (u(3) * 2 - 1) * 0.02, rotation: 0 };
}
