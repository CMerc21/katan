/**
 * Slab geometry (docs/props.md §1): an extruded hexagon with crisp edges and
 * a 0.03 R corner radius, built as one non-indexed, face-coloured geometry.
 * Land slabs are two layers (terrain colour over earth brown, mountains with
 * a mid band), carry a circular centre recess for the token and a gentle
 * seeded low-poly relief on the top face; sea slabs are a single colour with
 * a lighter faceted top; frame slabs are plain walnut. Pure: the same hex id
 * always gives the same facets, so every client draws the same board.
 */

import * as THREE from "three";
import { hashString, type Terrain } from "@katan/engine";
import { EARTH, EARTH_BAND, FRAME_WOOD, HILLS_APRON, RECESS_FLOOR, RIM_TINT, SEA_SIDE, SEA_TOP, TERRAIN_TOP } from "./palette";

export const HEX_RADIUS = 1;
/** The slab is drawn a hair smaller than the cell so neighbours never touch. */
export const SLAB_RADIUS = 0.985;
export const CORNER_RADIUS = 0.03;
export const LAND_LOWER = 0.1;
export const LAND_UPPER = 0.12;
export const LAND_HEIGHT = LAND_LOWER + LAND_UPPER;
export const SEA_SLAB_HEIGHT = 0.15;
export const FRAME_SLAB_HEIGHT = 0.15;
/*
 * Relief was 0.02 R across facets spaced ~0.13 apart -- a 9 degree tilt, which
 * flat shading renders as barely any value change, so every tile read as one
 * flat colour. 0.05 gives the facets a slope worth lighting.
 */
export const LAND_RELIEF = 0.05;
export const SEA_RELIEF = 0.05;
/**
 * Per-face lightness variation on the slab faces. The slab geometry is
 * non-indexed and already carries one colour per triangle, so this is what
 * turns a flat top face into readable low-poly facets: coherent patches from
 * the value noise, plus a small per-face step so neighbouring facets never
 * blend into a smooth gradient.
 */
export const FACET_SHADE = 0.14;

/**
 * The cell edge (docs/props.md §1). Land tiles are drawn a hair inside their
 * cell so neighbours never touch, which left a dark gap between them reading
 * as a seam rather than a border. Lightening the outer band of the top face
 * turns that into a lit bevel with a dark line between two of them, so the
 * grid looks deliberate.
 *
 * Land only: the sea should read as continuous water, and a rim on every sea
 * tile would draw a grid across it.
 */
export const RIM_BAND = 0.1;
export const RIM_MIX = 0.22;

/**
 * Per-terrain centre lift (docs/props.md §1): how far a tile's interior rises
 * above, or dips below, the nominal top face.
 *
 * It is a dome anchored at the slab rim, not a change of slab height. Pieces
 * sit on a single flat plane -- settlements and cities at the hex vertices
 * (radius 1, just outside `SLAB_RADIUS`), roads at the edge midpoints -- and
 * every one of them is placed at the constant `SLAB_HEIGHT`. Raising whole
 * slabs would need all of that to become per-tile, and a road spanning two
 * tiles of different heights has no correct answer, so the rim stays put and
 * only the interior moves. That reads as elevation from above without giving
 * the board cliffs.
 */
export const TERRAIN_LIFT: Record<Terrain, number> = {
  mountain: 0.1,
  gold: 0.07,
  claypit: 0.055,
  forest: 0.025,
  meadow: 0,
  farmland: 0,
  wasteland: -0.02,
  lake: -0.03,
};

export const MAX_TERRAIN_LIFT = Math.max(...Object.values(TERRAIN_LIFT));
export const MIN_TERRAIN_LIFT = Math.min(...Object.values(TERRAIN_LIFT));

/** The centre lift for a slab; only land tiles carry one. */
export function centreLift(spec: SlabSpec): number {
  return spec.kind === "land" && spec.terrain ? TERRAIN_LIFT[spec.terrain] : 0;
}
export const RECESS_RADIUS = 0.32;
export const LAKE_RADIUS = 0.6;
export const RECESS_DEPTH = 0.03;
export const EDGE_MARGIN = 0.06;
/** Water in the lake's recess: fresh water, kept lighter than the sea so a lake never reads as ocean. */
const LAKE_FLOOR = "#57B0BE";

export type SlabKind = "land" | "sea" | "frame";

export interface SlabSpec {
  readonly kind: SlabKind;
  /** Land only; `null` draws an unassigned (editor) slab in desert colour. */
  readonly terrain: Terrain | null;
  /** Seed for the relief; the hex id in play. */
  readonly seed: string;
}

interface Pt {
  x: number;
  z: number;
  y: number;
  /** Angle parameter in [0, 1) for the ring walk. */
  t: number;
  /** Colour of the faces this ring closes toward the centre. */
  color: THREE.Color;
}

const TWO_PI = Math.PI * 2;

/** Distance from the centre to the rounded-hex outline along `theta` (pointy-top hex; corners at 30° + 60°k). */
export function roundedHexRadius(theta: number, radius = SLAB_RADIUS, corner = CORNER_RADIUS): number {
  const step = Math.PI / 3;
  const phi = Math.round(theta / step) * step; // nearest edge normal
  const d = theta - phi; // [-30°, 30°]
  const inner = radius - corner / Math.sin(Math.PI / 3);
  const apothem = inner * Math.cos(Math.PI / 6) + corner;
  const rho = apothem / Math.cos(d);
  const tangential = apothem * Math.tan(d);
  if (Math.abs(tangential) <= inner / 2) return rho;
  // Corner arc: centre at the inner hex corner, radius `corner`.
  const cx = inner * Math.cos(Math.PI / 6);
  const cz = Math.sign(tangential) * (inner / 2);
  const ux = Math.cos(d);
  const uz = Math.sin(d);
  const cu = cx * ux + cz * uz;
  const disc = cu * cu - (cx * cx + cz * cz) + corner * corner;
  return cu + Math.sqrt(Math.max(0, disc));
}

/** Smooth seeded value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const h = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz);
  const b = h(ix + 1, iz);
  const c = h(ix, iz + 1);
  const d = h(ix + 1, iz + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

function angleOf(x: number, z: number): number {
  const a = Math.atan2(z, x);
  return (a < 0 ? a + TWO_PI : a) / TWO_PI;
}

/** The rounded outline sampled by arc length: straight runs plus `arcSteps` per corner. */
export function roundedHexOutline(radius = SLAB_RADIUS, corner = CORNER_RADIUS, straightSteps = 6, arcSteps = 3): { x: number; z: number }[] {
  const inner = radius - corner / Math.sin(Math.PI / 3);
  const out: { x: number; z: number }[] = [];
  const arcs: { x: number; z: number }[][] = [];
  for (let k = 0; k < 6; k++) {
    const ck = Math.PI / 6 + (k * Math.PI) / 3;
    const cx = inner * Math.cos(ck);
    const cz = inner * Math.sin(ck);
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i <= arcSteps; i++) {
      const phi = ck - Math.PI / 6 + (i / arcSteps) * (Math.PI / 3);
      pts.push({ x: cx + corner * Math.cos(phi), z: cz + corner * Math.sin(phi) });
    }
    arcs.push(pts);
  }
  for (let k = 0; k < 6; k++) {
    const arc = arcs[k]!;
    const next = arcs[(k + 1) % 6]![0]!;
    out.push(...arc);
    const last = arc[arc.length - 1]!;
    for (let i = 1; i < straightSteps; i++) {
      const u = i / straightSteps;
      out.push({ x: last.x + (next.x - last.x) * u, z: last.z + (next.z - last.z) * u });
    }
  }
  return out;
}

function ringWalk(inner: Pt[], outer: Pt[], tri: (a: Pt, b: Pt, c: Pt, color: THREE.Color) => void): void {
  if (inner.length === 1) {
    const c = inner[0]!;
    for (let j = 0; j < outer.length; j++) {
      const cur = outer[j]!;
      const nxt = outer[(j + 1) % outer.length]!;
      tri(c, nxt, cur, nxt.color);
    }
    return;
  }
  let i = 0;
  let j = 0;
  const n = inner.length;
  const m = outer.length;
  // Start both rings at their smallest angle; walk whichever ring's next vertex comes first.
  while (i < n || j < m) {
    const nextA = i + 1 < n ? inner[i + 1]!.t : inner[0]!.t + 1;
    const nextB = j + 1 < m ? outer[j + 1]!.t : outer[0]!.t + 1;
    const a = inner[i % n]!;
    const b = outer[j % m]!;
    if (i < n && (j >= m || nextA <= nextB)) {
      const a2 = inner[(i + 1) % n]!;
      tri(a, a2, b, b.color);
      i++;
    } else {
      const b2 = outer[(j + 1) % m]!;
      tri(a, b2, b, b2.color);
      j++;
    }
  }
}

function ring(count: number, rho: (theta: number) => number, y: (x: number, z: number, theta: number) => number, color: (theta: number, r: number) => THREE.Color): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < count; k++) {
    const theta = (k / count) * TWO_PI;
    const r = rho(theta);
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    out.push({ x, z, y: y(x, z, theta), t: k / count, color: color(theta, r) });
  }
  return out;
}

/** Per-face shade multiplier offset in [-1, 1] for the face at a centroid. */
function facetShade(x: number, z: number, seed: number, index: number): number {
  const patch = valueNoise(x * 4.5 + 3.1, z * 4.5 + 7.9, seed);
  let n = Math.imul(seed ^ (index + 0x9e3779b9), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  const step = (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  return patch * 0.55 + step * 0.45;
}

export interface SlabBuild {
  readonly geometry: THREE.BufferGeometry;
  /** Total height (base at y = 0, nominal top at y = height). */
  readonly height: number;
}

interface Layer {
  readonly from: number;
  readonly to: number;
  readonly color: string;
}

function layersFor(spec: SlabSpec): Layer[] {
  if (spec.kind === "sea") return [{ from: 0, to: -SEA_SLAB_HEIGHT, color: SEA_SIDE }];
  if (spec.kind === "frame") return [{ from: 0, to: -FRAME_SLAB_HEIGHT, color: FRAME_WOOD }];
  const top = TERRAIN_TOP[spec.terrain ?? "wasteland"];
  if (spec.terrain === "mountain" || spec.terrain === "gold") {
    return [
      { from: 0, to: -LAND_UPPER, color: top },
      { from: -LAND_UPPER, to: -LAND_UPPER - 0.04, color: EARTH_BAND },
      { from: -LAND_UPPER - 0.04, to: -LAND_HEIGHT, color: EARTH },
    ];
  }
  return [
    { from: 0, to: -LAND_UPPER, color: top },
    { from: -LAND_UPPER, to: -LAND_HEIGHT, color: EARTH },
  ];
}

function reliefAmplitude(kind: SlabKind): number {
  return kind === "land" ? LAND_RELIEF : kind === "sea" ? SEA_RELIEF : 0;
}

function recessRadius(spec: SlabSpec): number {
  return spec.kind === "land" ? (spec.terrain === "lake" ? LAKE_RADIUS : RECESS_RADIUS) : 0;
}

/**
 * The top face's relief as a field over the tile: seeded value noise of
 * ±relief, flat inside the recess and tapering to it. Props sample this to
 * stand on the facets (docs/props.md §3).
 */
export function reliefField(spec: SlabSpec): (x: number, z: number) => number {
  const seed = hashString(`${spec.seed}:slab`);
  const relief = reliefAmplitude(spec.kind);
  const recess = recessRadius(spec);
  if (relief === 0) return () => 0;
  const ox = ((seed & 0xffff) / 0xffff) * 10;
  const oz = (((seed >>> 16) & 0xffff) / 0xffff) * 10;
  const lift = centreLift(spec);
  return (x, z) => {
    const r = Math.hypot(x, z);
    const taper = recess > 0 ? Math.min(1, Math.max(0, (r - recess - 0.04) / 0.12)) : 1;
    // Fade the relief out at the rim as well. Roads lie at the edge midpoints
    // and settlements at the corners; at ±0.05 R of relief right up to the
    // edge they visibly sat proud of, or sunk into, the tile.
    const rim = Math.min(1, Math.max(0, (SLAB_RADIUS - r) / 0.18));
    const n = valueNoise(x * 2.4 + ox, z * 2.4 + oz, seed) * 0.7 + valueNoise(x * 6 + oz, z * 6 + ox, seed ^ 0x9e37) * 0.3;
    return n * relief * taper * rim + domeAt(r, lift, recess);
  };
}

/** The centre dome: `lift` at the recess and inside it, easing to 0 at the rim. */
export function domeAt(r: number, lift: number, recess: number): number {
  if (lift === 0) return 0;
  const inner = Math.max(recess, 0);
  const t = Math.min(1, Math.max(0, (SLAB_RADIUS - r) / (SLAB_RADIUS - inner)));
  return lift * t * t * (3 - 2 * t);
}

/** Build the slab for `spec`. Base at y = 0; the nominal top face at y = height, relief around it. */
export function buildSlab(spec: SlabSpec): SlabBuild {
  const height = spec.kind === "land" ? LAND_HEIGHT : spec.kind === "sea" ? SEA_SLAB_HEIGHT : FRAME_SLAB_HEIGHT;
  const recess = recessRadius(spec);
  const topColor = new THREE.Color(spec.kind === "sea" ? SEA_TOP : spec.kind === "frame" ? FRAME_WOOD : TERRAIN_TOP[spec.terrain ?? "wasteland"]);
  const apron = spec.kind === "land" && spec.terrain === "claypit" ? new THREE.Color(HILLS_APRON) : null;
  const floor = new THREE.Color(spec.terrain === "lake" ? LAKE_FLOOR : RECESS_FLOOR);
  const topAt = reliefField(spec);
  const rimTint = spec.kind === "land" ? new THREE.Color(RIM_TINT) : null;
  /**
   * The band is measured in from the tile's *outline*, not from its centre. A
   * hexagon's outline sits at 0.853 R along the flat edges and 0.985 R at the
   * corners, so banding on the raw radius put the rim on the six corners only
   * and left the edges bare.
   */
  const colorAt = (r: number, theta: number): THREE.Color => {
    const base = apron && r < 0.52 ? apron : topColor;
    if (!rimTint) return base;
    const edge = roundedHexRadius(theta);
    const t = Math.min(1, Math.max(0, (r - (edge - RIM_BAND)) / RIM_BAND));
    return t > 0 ? base.clone().lerp(rimTint, t * RIM_MIX) : base;
  };

  const lift = centreLift(spec);
  const rings: Pt[][] = [];
  if (recess > 0) {
    rings.push([{ x: 0, z: 0, y: lift - RECESS_DEPTH, t: 0, color: floor }]);
    rings.push(ring(8, () => recess * 0.5, () => lift - RECESS_DEPTH, () => floor));
    rings.push(ring(18, () => recess, () => lift - RECESS_DEPTH, () => floor));
    rings.push(ring(18, () => recess + 0.004, () => domeAt(recess, lift, recess), (theta) => colorAt(recess, theta)));
  } else {
    rings.push([{ x: 0, z: 0, y: topAt(0, 0), t: 0, color: topColor }]);
  }
  const f0 = recess > 0 ? (recess + 0.004) / SLAB_RADIUS : 0;
  const steps = spec.kind === "frame" ? 1 : recess > 0.5 ? 2 : recess > 0 ? 4 : 6;
  for (let k = 1; k < steps; k++) {
    const s = k / steps;
    const f = f0 + (1 - f0) * s;
    const w = s * s;
    const rho = (theta: number) => f * ((1 - w) * SLAB_RADIUS + w * roundedHexRadius(theta));
    const count = Math.max(8, Math.round((TWO_PI * f * SLAB_RADIUS) / 0.13));
    rings.push(ring(count, rho, (x, z) => topAt(x, z), (theta, r) => colorAt(r, theta)));
  }
  const outline = roundedHexOutline();
  const boundary: Pt[] = outline.map((p) => ({ x: p.x, z: p.z, y: topAt(p.x, p.z), t: angleOf(p.x, p.z), color: colorAt(Math.hypot(p.x, p.z), angleOf(p.x, p.z)) }));
  boundary.sort((a, b) => a.t - b.t);
  rings.push(boundary);

  const positions: number[] = [];
  const colors: number[] = [];
  const push = (p: Pt) => positions.push(p.x, p.y + height, p.z);
  const facetSeed = hashString(`${spec.seed}:facet`);
  let face = 0;
  const tri = (a: Pt, b: Pt, c: Pt, color: THREE.Color) => {
    push(a);
    push(b);
    push(c);
    const shade = 1 + facetShade((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, facetSeed, face++) * FACET_SHADE;
    const r = color.r * shade;
    const g = color.g * shade;
    const bl = color.b * shade;
    for (let i = 0; i < 3; i++) colors.push(r, g, bl);
  };
  for (let i = 0; i + 1 < rings.length; i++) ringWalk(rings[i]!, rings[i + 1]!, tri);

  // Side walls, one band of faces per layer.
  for (const layer of layersFor(spec)) {
    const color = new THREE.Color(layer.color);
    for (let j = 0; j < boundary.length; j++) {
      const p = boundary[j]!;
      const q = boundary[(j + 1) % boundary.length]!;
      const pTop = { ...p, y: layer.from === 0 ? p.y : layer.from };
      const qTop = { ...q, y: layer.from === 0 ? q.y : layer.from };
      const pBot = { ...p, y: layer.to };
      const qBot = { ...q, y: layer.to };
      tri(pTop, qTop, pBot, color);
      tri(qTop, qBot, pBot, color);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, height };
}

/** The sea's three seeded facet variants; a tile picks one and a 60° multiple so neighbours differ. */
export const SEA_VARIANTS = 3;

export function seaVariant(hex: string): { variant: number; turns: number } {
  const h = hashString(`${hex}:sea`);
  return { variant: h % SEA_VARIANTS, turns: Math.floor(h / SEA_VARIANTS) % 6 };
}

/** Per-tile jitter (docs/props.md §1): rotation ±0.4°, height ±1.5%, by seed. */
export function slabJitter(hex: string): { rotation: number; height: number } {
  const h = hashString(`${hex}:jitter`);
  const u1 = (h & 0xffff) / 0xffff;
  const u2 = ((h >>> 16) & 0xffff) / 0xffff;
  return { rotation: (u1 * 2 - 1) * ((0.4 * Math.PI) / 180), height: 1 + (u2 * 2 - 1) * 0.015 };
}

/** Distance from the tile centre to the prop-free margin at `theta` (docs/props.md §3). */
export function propBoundary(theta: number): number {
  return roundedHexRadius(theta) - EDGE_MARGIN;
}
