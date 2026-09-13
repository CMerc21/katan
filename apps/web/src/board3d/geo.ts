"use client";

/**
 * Small geometry helpers for procedural props (docs/props.md §3): paint a
 * primitive with one flat colour (vertex colours), place it, and merge parts
 * into a single geometry so a whole prop kind is one instanced draw call.
 * Everything is flat-shaded primitives; nothing is loaded.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/** Colour every vertex of `g` and transform it in place. */
export function part(g: THREE.BufferGeometry, color: string, p: Placement = {}): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position?.count ?? 0;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.applyMatrix4(placementMatrix(p));
  return g;
}

export function placementMatrix(p: Placement): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)),
    new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1),
  );
}

/** Merge painted parts into one non-indexed geometry (position, normal, colour). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(
    parts.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      n.deleteAttribute("uv");
      return n;
    }),
    false,
  );
  if (!merged) throw new Error("mergeGeometries failed");
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
export const sphere = (r: number, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
export const halfSphere = (r: number, w = 8, h = 4) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
export const octa = (r: number) => new THREE.OctahedronGeometry(r, 0);
export const dodeca = (r: number) => new THREE.DodecahedronGeometry(r, 0);
/** An icosphere: `detail` 1 is the faceted ball of the references. */
export const ico = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
export const torus = (r: number, tube: number, radial = 6, tubular = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, radial, tubular, arc);
/** A thin quad standing in the XY plane (a door, a window, a sign). */
export const quad = (w: number, h: number) => new THREE.PlaneGeometry(w, h);

/** A gabled prism (a roof): triangular cross-section `w` wide and `h` tall, `d` long along Z, base at y = 0. */
export function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

/** A pointy-top hexagon outline in the XY plane (rotate the extrusion −90° about X to stand it up). */
export function hexShape(radius: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let k = 0; k < 6; k++) {
    const a = (-(30 + 60 * k) * Math.PI) / 180;
    const x = radius * Math.cos(a);
    const y = -radius * Math.sin(a);
    if (k === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/**
 * A faceted cone with jittered rings (a mountain peak, docs/props.md §3):
 * `segments` radial faces, `rings` height steps, each ring vertex pushed in or
 * out by `jitter(ring, segment)` (a fraction), and each face coloured by
 * `colorAt(centroidHeightFraction)`. Base at y = 0.
 */
export function facetedCone(radius: number, height: number, segments: number, rings: number, jitter: (ring: number, segment: number) => number, colorAt: (t: number) => string): THREE.BufferGeometry {
  const ringPts: THREE.Vector3[][] = [];
  for (let r = 0; r < rings; r++) {
    const t = r / rings;
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2 + (r % 2) * (Math.PI / segments);
      const rad = radius * (1 - t) * (1 + jitter(r, s));
      pts.push(new THREE.Vector3(Math.cos(a) * rad, t * height, Math.sin(a) * rad));
    }
    ringPts.push(pts);
  }
  const apex = new THREE.Vector3(0, height, 0);
  const positions: number[] = [];
  const colors: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const col = new THREE.Color(colorAt((a.y + b.y + c.y) / 3 / height));
    for (let i = 0; i < 3; i++) colors.push(col.r, col.g, col.b);
  };
  for (let r = 0; r < rings; r++) {
    const lo = ringPts[r]!;
    const hi = r + 1 < rings ? ringPts[r + 1]! : null;
    for (let s = 0; s < segments; s++) {
      const a = lo[s]!;
      const b = lo[(s + 1) % segments]!;
      if (!hi) {
        tri(a, apex, b);
      } else {
        const c = hi[s]!;
        const d = hi[(s + 1) % segments]!;
        tri(a, c, b);
        tri(b, c, d);
      }
    }
  }
  // Base cap so the peak is closed when it sits on a slope.
  const base = ringPts[0]!;
  const centre = new THREE.Vector3(0, 0, 0);
  for (let s = 0; s < segments; s++) tri(base[(s + 1) % segments]!, centre, base[s]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** A tween from 0 to 1 over `ms` starting at `start` (performance.now based). */
export function progress(start: number, ms: number, now: number): number {
  if (ms <= 0) return 1;
  return Math.min(1, Math.max(0, (now - start) / ms));
}

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
