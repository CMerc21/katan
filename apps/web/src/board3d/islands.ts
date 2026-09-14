/**
 * Mesh islands: the connected components of a triangle mesh. Vertices are
 * welded by rounded position (Meshy exports duplicate corners per face), then
 * triangles that share a welded vertex are unioned. Islands are numbered in a
 * deterministic order — descending triangle count, then ascending centroid Y —
 * so an id names the same part on every load, and can be mapped to a part by
 * hand with `scripts/inspect-model.ts`.
 *
 * Pure geometry, no React, no `@/` imports: the inspect script runs this under
 * plain Node.
 */

import * as THREE from "three";

export interface Island {
  /** Position in the deterministic order (0 = most triangles). */
  readonly id: number;
  readonly triangles: number;
  readonly minY: number;
  readonly maxY: number;
  /** Distance from the model's vertical axis, over the island's vertices. */
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly centroid: { readonly x: number; readonly y: number; readonly z: number };
}

export interface IslandResult {
  readonly islands: readonly Island[];
  /** For triangle `t`, the id of the island it belongs to. */
  readonly triangleIsland: Int32Array;
}

/** A vertex reader over an indexed or non-indexed geometry, by triangle corner. */
function corners(geometry: THREE.BufferGeometry): { count: number; vertexOf: (corner: number) => number; pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute } {
  const pos = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const vertexOf = index ? (c: number) => index.getX(c) : (c: number) => c;
  return { count, vertexOf, pos };
}

export function findIslands(geometry: THREE.BufferGeometry, weld = 1e-4): IslandResult {
  const { count, vertexOf, pos } = corners(geometry);
  const triangles = Math.floor(count / 3);

  // Weld: every corner gets the id of the first corner at the same rounded position.
  const weldOf = new Int32Array(count);
  const keys = new Map<string, number>();
  for (let c = 0; c < count; c++) {
    const v = vertexOf(c);
    const key = `${Math.round(pos.getX(v) / weld)},${Math.round(pos.getY(v) / weld)},${Math.round(pos.getZ(v) / weld)}`;
    let w = keys.get(key);
    if (w === undefined) {
      w = keys.size;
      keys.set(key, w);
    }
    weldOf[c] = w;
  }

  // Union-find over triangles: two triangles touching one welded vertex are one island.
  const parent = new Int32Array(triangles);
  for (let t = 0; t < triangles; t++) parent[t] = t;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const owner = new Int32Array(keys.size).fill(-1);
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const w = weldOf[t * 3 + k]!;
      if (owner[w] === -1) owner[w] = t;
      else {
        const a = find(owner[w]!);
        const b = find(t);
        if (a !== b) parent[a] = b;
      }
    }
  }

  // Gather per-root statistics.
  interface Acc {
    triangles: number;
    minY: number;
    maxY: number;
    minR: number;
    maxR: number;
    sx: number;
    sy: number;
    sz: number;
  }
  const accs = new Map<number, Acc>();
  const rootOf = new Int32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const r = find(t);
    rootOf[t] = r;
    let a = accs.get(r);
    if (!a) {
      a = { triangles: 0, minY: Infinity, maxY: -Infinity, minR: Infinity, maxR: 0, sx: 0, sy: 0, sz: 0 };
      accs.set(r, a);
    }
    a.triangles++;
    for (let k = 0; k < 3; k++) {
      const v = vertexOf(t * 3 + k);
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      const rad = Math.hypot(x, z);
      if (y < a.minY) a.minY = y;
      if (y > a.maxY) a.maxY = y;
      if (rad < a.minR) a.minR = rad;
      if (rad > a.maxR) a.maxR = rad;
      a.sx += x;
      a.sy += y;
      a.sz += z;
    }
  }

  // Deterministic order: most triangles first, then lowest centroid.
  const ordered = [...accs.entries()]
    .map(([root, a]) => ({ root, a, cy: a.sy / (a.triangles * 3) }))
    .sort((p, q) => q.a.triangles - p.a.triangles || p.cy - q.cy);
  const idOfRoot = new Map<number, number>();
  const islands: Island[] = ordered.map(({ root, a }, id) => {
    idOfRoot.set(root, id);
    const n = a.triangles * 3;
    return { id, triangles: a.triangles, minY: a.minY, maxY: a.maxY, minRadius: a.minR, maxRadius: a.maxR, centroid: { x: a.sx / n, y: a.sy / n, z: a.sz / n } };
  });
  const triangleIsland = new Int32Array(triangles);
  for (let t = 0; t < triangles; t++) triangleIsland[t] = idOfRoot.get(rootOf[t]!)!;
  return { islands, triangleIsland };
}

/**
 * Reorder a non-indexed geometry's triangles into one contiguous run per
 * group and register a draw group for each, so a material array colours the
 * runs apart. Every attribute is carried along (positions, UVs, whatever the
 * export had), so a baked texture survives the shuffle.
 */
export function regroupTriangles(geometry: THREE.BufferGeometry, groupOf: (triangle: number) => number, groupCount: number): THREE.BufferGeometry {
  if (geometry.getIndex()) throw new Error("regroupTriangles needs a non-indexed geometry");
  const triangles = Math.floor(geometry.getAttribute("position").count / 3);
  const buckets: number[][] = Array.from({ length: groupCount }, () => []);
  for (let t = 0; t < triangles; t++) buckets[groupOf(t)]!.push(t);
  const order = buckets.flat();
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) {
    const src = geometry.getAttribute(name) as THREE.BufferAttribute;
    const size = src.itemSize;
    const arr = new (src.array.constructor as new (n: number) => typeof src.array)(triangles * 3 * size);
    let cursor = 0;
    for (const t of order) {
      for (let k = 0; k < 3; k++) {
        const v = t * 3 + k;
        for (let i = 0; i < size; i++) arr[cursor * size + i] = src.array[v * size + i]!;
        cursor++;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, src.normalized));
  }
  let start = 0;
  buckets.forEach((b, g) => {
    out.addGroup(start, b.length * 3, g);
    start += b.length * 3;
  });
  return out;
}
