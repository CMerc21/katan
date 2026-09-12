"use client";

/**
 * Small geometry helpers for procedural props (docs/phase7-5.md §4): paint a
 * primitive with one flat colour (vertex colours), place it, and merge parts
 * into a single geometry so a whole prop kind is one instanced draw call.
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
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)),
    new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1),
  );
  g.applyMatrix4(m);
  return g;
}

/** Merge painted parts into one geometry (all primitives here are indexed with position/normal/uv). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(
    parts.map((g) => g.toNonIndexed()),
    false,
  );
  if (!merged) throw new Error("mergeGeometries failed");
  for (const g of parts) g.dispose();
  return merged;
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
export const sphere = (r: number, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
export const halfSphere = (r: number, w = 10) => new THREE.SphereGeometry(r, w, 6, 0, Math.PI * 2, 0, Math.PI / 2);
export const octa = (r: number) => new THREE.OctahedronGeometry(r, 0);

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
