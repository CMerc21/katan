/**
 * Seeded prop layouts per tile (docs/props.md §3). Pure: given a hex id, its
 * terrain and the quality density, returns where each prop stands, so no two
 * forest tiles look alike and every client draws the same scene on every
 * reload. Each terrain follows its own placement rule rather than a random
 * scatter: tree clusters, a fence run along one edge, wheat in parallel rows
 * on a hex axis, a mountain range at the tile's back. Props keep a clear
 * circle of `PROP_INNER` around the number token and `PROP_EDGE_CLEARANCE`
 * inside the slab edge, so nothing overhangs a neighbour or collides with a
 * road or settlement.
 *
 * Reduced detail (the Low preset): clusters halve and every scale is 1, so
 * fewer instances and no jitter variants — but every terrain keeps its props.
 */

import { createRng, type HexId, type Terrain } from "@katan/engine";
import { BACK } from "./layout3d";
import { LAKE_RADIUS, roundedHexRadius } from "./slab";

export type PropTerrain = Terrain | "sea";

export type PropKind =
  // forest
  | "tree"
  | "tree2"
  | "pine"
  | "logPile"
  // pasture
  | "sheep"
  | "fence"
  | "bush"
  // fields
  | "wheat"
  | "wheat2"
  | "windmill"
  | "hayBale"
  // hills
  | "moundTall"
  | "moundWide"
  | "moundLow"
  | "moundTerraced"
  | "kiln"
  | "brickStack"
  // mountains
  | "peak"
  | "ridge"
  | "boulder"
  | "rubble"
  // desert
  | "cactus"
  | "dryBush"
  | "skull"
  | "flatRock"
  // gold and lake (Phase 9/10, still procedural)
  | "goldNugget"
  | "sluice"
  | "reed";

export interface PropInstance {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  /** Yaw; a long prop's length runs along its local Z, so `rot = atan2(dx, dz)` lays it along (dx, dz). */
  readonly rot: number;
  readonly scale: number;
  /** Per-instance seed in [0, 1) for idle motion phase. */
  readonly seed: number;
}

/** Every kind draws as one InstancedMesh across the whole board. */
export const ALL_KINDS: readonly PropKind[] = ["tree", "tree2", "pine", "logPile", "sheep", "fence", "bush", "wheat", "wheat2", "windmill", "hayBale", "moundTall", "moundWide", "moundLow", "moundTerraced", "kiln", "brickStack", "peak", "ridge", "boulder", "rubble", "cactus", "dryBush", "skull", "flatRock", "goldNugget", "sluice", "reed"];

export type PropDetail = "full" | "reduced";

/** The Low preset (density 0.4) draws reduced detail; Medium and High draw everything. */
export function detailFor(density: number): PropDetail {
  return density < 0.55 ? "reduced" : "full";
}

/**
 * The clear circle around the number token: exactly the 0.30 asked for. The
 * recess rim is at 0.32, so a prop's foot may overlap the rim by 0.02, which
 * the sink hides; anything wider would leave no room for the mountain peak.
 */
export const TOKEN_CLEARANCE = 0.3;
export const PROP_INNER = TOKEN_CLEARANCE;
/** Nothing reaches closer than this to the slab edge. */
export const PROP_EDGE_CLEARANCE = 0.08;

/** The farthest radius a prop may reach in direction `theta`. */
export function propLimit(theta: number): number {
  return roundedHexRadius(theta) - PROP_EDGE_CLEARANCE;
}

/** Approximate half-width per kind (world units, at scale 1): keeps props off each other, the token and the edge. */
export const FOOTPRINT: Record<PropKind, number> = {
  tree: 0.14,
  tree2: 0.13,
  pine: 0.12,
  logPile: 0.09,
  sheep: 0.1,
  fence: 0.03,
  bush: 0.09,
  wheat: 0.09,
  wheat2: 0.09,
  windmill: 0.21,
  hayBale: 0.09,
  moundTall: 0.1,
  moundWide: 0.15,
  moundLow: 0.1,
  moundTerraced: 0.09,
  kiln: 0.17,
  brickStack: 0.08,
  peak: 0.22,
  ridge: 0.2,
  boulder: 0.075,
  rubble: 0.07,
  cactus: 0.08,
  dryBush: 0.08,
  skull: 0.08,
  flatRock: 0.1,
  goldNugget: 0.06,
  sluice: 0.2,
  reed: 0.04,
};

/** Long props: half their length along local Z, so the edge check looks at both ends rather than one wide circle. */
export const BAR_HALF_LENGTH: Partial<Record<PropKind, number>> = { fence: 0.18, logPile: 0.15, hayBale: 0.11, moundLow: 0.18, brickStack: 0.12, rubble: 0.13 };

/** The circles a prop occupies: its centre, or for a long prop its two ends, each of radius `FOOTPRINT × scale`. */
export function propBounds(p: PropInstance): { x: number; z: number; r: number }[] {
  const r = FOOTPRINT[p.kind] * p.scale;
  const half = BAR_HALF_LENGTH[p.kind];
  if (half === undefined) return [{ x: p.x, z: p.z, r }];
  // local +Z points along (sin rot, cos rot).
  const dx = Math.sin(p.rot) * half * p.scale;
  const dz = Math.cos(p.rot) * half * p.scale;
  return [
    { x: p.x - dx, z: p.z - dz, r },
    { x: p.x + dx, z: p.z + dz, r },
  ];
}

/** Radius inside which nothing stands: the token clearance, the lake's water, or nothing on the sea. */
export function innerLimit(terrain: PropTerrain): number {
  if (terrain === "sea") return 0;
  if (terrain === "lake") return LAKE_RADIUS + 0.02;
  return PROP_INNER;
}

/** Yaw that lays a long prop's local Z (or a windmill's face) along the unit direction (dx, dz). */
export function facing(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** The three axes of a pointy-topped hex through opposite edge midpoints. */
export const HEX_AXES: readonly number[] = [0, Math.PI / 3, (2 * Math.PI) / 3];
/** Direction of edge `k`'s midpoint (corners sit at −30° − 60k°, so edges face −60k°). */
export function edgeDirection(k: number): number {
  return (-k * Math.PI) / 3;
}
/** The edge midpoints' radius: cos 30° for a unit hex. */
export const EDGE_MID_RADIUS = Math.cos(Math.PI / 6);
/** Where a pasture's fence run stands, measured along the edge's direction. */
export const FENCE_RADIUS = 0.64;

export function propsForHex(hex: HexId, terrain: PropTerrain, density = 1): PropInstance[] {
  const detail = detailFor(density);
  const full = detail === "full";
  const rng = createRng(hex, "props");
  const out: PropInstance[] = [];
  const inner = innerLimit(terrain);

  const jitter = (a: number) => (rng.next() * 2 - 1) * a;
  const spin = () => rng.next() * Math.PI * 2;
  const scaleIn = (lo: number, hi: number) => (full ? lo + rng.next() * (hi - lo) : 1);
  const pick = <T>(list: readonly T[]): T => list[rng.int(list.length)]!;

  type Misfit = "inner" | "outer" | "clash" | null;
  const misfit = (p: PropInstance, overlap: number): Misfit => {
    for (const b of propBounds(p)) {
      const r = Math.hypot(b.x, b.z);
      if (r < inner + b.r) return "inner";
      if (r + b.r > propLimit(Math.atan2(b.z, b.x))) return "outer";
    }
    const mine = FOOTPRINT[p.kind] * p.scale;
    return out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < (mine + FOOTPRINT[q.kind] * q.scale) * overlap) ? "clash" : null;
  };
  /**
   * Stand a prop at (x, z). When it does not fit, nudge it up to `nudge`
   * times before giving up: outward when it breaches the token clearance,
   * inward when it reaches past the edge, and a swing around the tile centre
   * (alternating sides) when it collides with a neighbour. `overlap` below 1
   * lets neighbours interpenetrate slightly (a clay pile, a mountain range).
   */
  const put = (kind: PropKind, x: number, z: number, rot: number, scale: number, overlap = 1, nudge = 0): PropInstance | null => {
    const seed = rng.next();
    let px = x;
    let pz = z;
    let swing = 0;
    for (let i = 0; i <= nudge; i++) {
      const p: PropInstance = { kind, x: px, z: pz, rot, scale, seed };
      const why = misfit(p, overlap);
      if (!why) {
        out.push(p);
        return p;
      }
      const reach = (FOOTPRINT[kind] + (BAR_HALF_LENGTH[kind] ?? 0)) * scale;
      const r = Math.hypot(px, pz) || 1e-6;
      if (why === "inner") {
        // Jump straight out to the first radius that clears the token.
        const k = (inner + reach + 0.02) / r;
        px *= k;
        pz *= k;
      } else if (why === "outer") {
        // Jump straight in to the last radius that clears the edge.
        const k = (propLimit(Math.atan2(pz, px)) - reach - 0.02) / r;
        px *= k;
        pz *= k;
      } else {
        swing = swing <= 0 ? -swing + 0.18 : -swing;
        const a = Math.atan2(z, x) + swing;
        px = Math.cos(a) * r;
        pz = Math.sin(a) * r;
      }
    }
    return null;
  };
  const polar = (a: number, r: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

  switch (terrain) {
    case "forest": {
      // Two clusters of 3–5 trees on opposite sides, mixing round and pine, with a log pile at one cluster's edge.
      const a0 = spin();
      const centres = [a0, a0 + Math.PI + jitter(0.6)];
      centres.forEach((a, ci) => {
        const c = polar(a, 0.55 + jitter(0.05));
        const count = full ? 3 + rng.int(3) : 2;
        for (let i = 0; i < count; i++) {
          const kind: PropKind = rng.next() < 0.45 ? "pine" : rng.next() < 0.5 ? "tree" : "tree2";
          const d = i === 0 ? 0 : 0.14 + rng.next() * 0.14;
          const o = polar(spin(), d);
          put(kind, c.x + o.x, c.z + o.z, spin(), scaleIn(0.85, 1.15), 0.8, 8);
        }
        if (ci === 0) {
          // At the cluster's edge: beside it along the ring at the same radius, its logs lying along the ring too.
          const t = { x: -Math.sin(a), z: Math.cos(a) };
          const rot = facing(t.x, t.z);
          if (!put("logPile", c.x + t.x * 0.42, c.z + t.z * 0.42, rot, 1, 1, 8)) put("logPile", c.x - t.x * 0.42, c.z - t.z * 0.42, rot, 1, 1, 8);
        }
      });
      break;
    }
    case "meadow": {
      // 2–3 fence sections along one tile edge, then a loose group of 4–6 sheep and a bush or two.
      const k = rng.int(6);
      const phi = edgeDirection(k);
      const t = { x: -Math.sin(phi), z: Math.cos(phi) };
      // At 0.65 three 0.36 sections just clear the corners; the third simply fails to fit on a tile where rounding bites.
      const mid = polar(phi, FENCE_RADIUS);
      const sections = full ? 2 + rng.int(2) : 2;
      // Three sections close ranks a little so the outer two still clear the corners.
      const spacing = sections === 3 ? 0.3 : 0.34;
      for (let i = 0; i < sections; i++) {
        const off = (i - (sections - 1) / 2) * spacing;
        put("fence", mid.x + t.x * off, mid.z + t.z * off, facing(t.x, t.z), 1);
      }
      const g = polar(phi + Math.PI + jitter(0.9), 0.56 + jitter(0.06));
      const sheep = full ? 4 + rng.int(3) : 2 + rng.int(2);
      for (let i = 0; i < sheep; i++) put("sheep", g.x + jitter(0.3), g.z + jitter(0.3), spin(), scaleIn(0.9, 1.1), 1, 8);
      // A bush or two flank the flock, well clear of the fence.
      const bushes = full ? 1 + rng.int(2) : 1;
      const ga = Math.atan2(g.z, g.x);
      for (let i = 0; i < bushes; i++) {
        const b = polar(ga + (i === 0 ? 1 : -1) * (0.75 + jitter(0.2)), 0.58 + jitter(0.06));
        put("bush", b.x, b.z, spin(), scaleIn(0.9, 1.1), 1, 8);
      }
      break;
    }
    case "farmland": {
      // Wheat in 3–4 parallel rows along one hex axis; the windmill off-centre to one side, a hay bale past a row end.
      const axis = pick(HEX_AXES) + jitter(0.06);
      const u = { x: Math.cos(axis), z: Math.sin(axis) };
      const n = { x: -Math.sin(axis), z: Math.cos(axis) };
      const side = rng.next() < 0.5 ? 1 : -1;
      const w = { x: n.x * side * 0.6 + u.x * jitter(0.15), z: n.z * side * 0.6 + u.z * jitter(0.15) };
      put("windmill", w.x, w.z, facing(-w.x, -w.z), 1, 1, 4);
      const offsets = full ? (rng.next() < 0.5 ? [-0.45, -0.15, 0.15, 0.45] : [-0.34, 0, 0.34]) : [-0.34, 0, 0.34];
      const step = full ? 0.17 : 0.24;
      let rowEnd: { s: number; o: number } | null = null;
      offsets.forEach((o, ri) => {
        for (let s = -0.78; s <= 0.78 + 1e-9; s += step) {
          const kind: PropKind = rng.next() < 0.7 ? "wheat" : "wheat2";
          const placed = put(kind, u.x * s + n.x * o, u.z * s + n.z * o, facing(u.x, u.z) + jitter(0.25), scaleIn(0.9, 1.1), 0.9);
          if (placed && ri === 0) rowEnd = { s, o };
        }
      });
      if (rowEnd) {
        const { s, o } = rowEnd as { s: number; o: number };
        const e = { x: u.x * (s + 0.22) + n.x * o, z: u.z * (s + 0.22) + n.z * o };
        put("hayBale", e.x, e.z, facing(u.x, u.z) + jitter(0.4), 1, 1, 2);
      }
      break;
    }
    case "claypit": {
      // 2–3 clay mounds mixing tall and wide, overlapping slightly; the kiln on one side with a brick stack beside it.
      const a = spin();
      const g = polar(a, 0.56);
      const tall = pick(["moundTall", "moundTerraced"] as const);
      const wide = pick(["moundWide", "moundLow"] as const);
      // The pile runs along the ring: the other mounds sit beside the first at the same radius, and the
      // long low mound lies along the ring too, so nothing is pushed into the token or past the edge.
      const along = facing(-Math.sin(a), Math.cos(a));
      put(wide, g.x, g.z, along + jitter(0.3), 1, 0.7, 4);
      const o1 = polar(a + Math.PI / 2, 0.24);
      put(tall, g.x + o1.x, g.z + o1.z, along + jitter(0.3), 1, 0.7, 8);
      if (full) {
        const o2 = polar(a - Math.PI / 2, 0.24);
        put(pick(["moundTall", "moundWide", "moundLow", "moundTerraced"] as const), g.x + o2.x, g.z + o2.z, along + jitter(0.3), 1, 0.7, 8);
      }
      const ka = a + Math.PI * 0.6 + jitter(0.2);
      const kiln = put("kiln", ...(({ x, z }) => [x, z] as const)(polar(ka, 0.58)), spin(), 1, 1, 4);
      if (kiln) {
        const t = { x: -Math.sin(ka), z: Math.cos(ka) };
        put("brickStack", kiln.x + t.x * 0.24, kiln.z + t.z * 0.24, facing(t.x, t.z) + jitter(0.3), 1, 1, 3);
      }
      break;
    }
    case "mountain": {
      // One tall peak centre-back, two ridges flanking it at different turns and 0.8–1.0 scale, overlapping into one range; boulders at the feet in front.
      const beta = Math.atan2(BACK.z, BACK.x);
      // The peak is 0.44 wide: the widest thing that fits between the token clearance and the edge margin in one direction.
      const p = polar(beta, 0.535);
      put("peak", p.x, p.z, spin(), 1, 0.9, 4);
      for (const sgn of [-1, 1]) {
        const r = polar(beta + sgn * (0.95 + jitter(0.12)), 0.5);
        put("ridge", r.x, r.z, spin(), full ? 0.8 + rng.next() * 0.2 : 0.9, 0.55, 4);
      }
      const feet: PropKind[] = full ? ["boulder", "boulder", "rubble"] : ["boulder"];
      for (const kind of feet) {
        const f = polar(beta + Math.PI + jitter(0.9), 0.6 + rng.next() * 0.1);
        put(kind, f.x, f.z, spin(), scaleIn(0.85, 1.15), 1, 3);
      }
      break;
    }
    case "wasteland": {
      // One of each, sparse and spread out around the tile.
      const kinds: PropKind[] = full ? ["cactus", "dryBush", "skull", "flatRock"] : ["cactus", "skull"];
      const a0 = spin();
      kinds.forEach((kind, i) => {
        const f = polar(a0 + (i / kinds.length) * Math.PI * 2 + jitter(0.35), 0.52 + rng.next() * 0.2);
        put(kind, f.x, f.z, spin(), scaleIn(0.9, 1.1), 1, 3);
      });
      break;
    }
    case "gold": {
      // Phase 9: a couple of peaks, a sluice and nuggets (still procedural props).
      const a0 = spin();
      const peaks = full ? 2 : 1;
      for (let i = 0; i < peaks; i++) {
        const p = polar(a0 + i * Math.PI * 0.7, 0.55);
        put("peak", p.x, p.z, spin(), full ? 0.75 + rng.next() * 0.25 : 0.85, 0.7, 4);
      }
      const s = polar(a0 + Math.PI * 1.4, 0.58);
      put("sluice", s.x, s.z, spin(), 1, 1, 4);
      const nuggets = full ? 6 : 3;
      for (let i = 0; i < nuggets; i++) {
        const g = polar(spin(), 0.45 + rng.next() * 0.27);
        put("goldNugget", g.x, g.z, spin(), scaleIn(0.7, 1.2), 1, 2);
      }
      break;
    }
    case "lake": {
      // Phase 10: reeds around the water.
      const reeds = full ? 4 + rng.int(3) : 2 + rng.int(2);
      for (let i = 0; i < reeds; i++) {
        const r = polar(spin(), 0.66 + rng.next() * 0.14);
        put("reed", r.x, r.z, spin(), scaleIn(0.9, 1.2), 1, 2);
      }
      break;
    }
    case "sea":
      break;
    default: {
      const exhaustive: never = terrain;
      throw new Error(String(exhaustive));
    }
  }
  return out;
}
