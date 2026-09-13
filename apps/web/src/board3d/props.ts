/**
 * Seeded prop layouts per tile (docs/props.md §3). Pure: given a hex id,
 * its terrain and a density, returns where each prop stands so no two forest
 * tiles look alike and every client draws the same scene. Props keep clear
 * of the centre recess and a 0.06 R margin at the slab edge; the counts are
 * the High defaults, scaled by the quality density with the hero prop of
 * every terrain always present.
 */

import { createRng, type HexId, type Terrain } from "@katan/engine";
import { LAKE_RADIUS, RECESS_RADIUS, propBoundary } from "./slab";

export type PropTerrain = Terrain | "sea";

export type PropKind =
  | "pine"
  | "oak"
  | "cabin"
  | "logPile"
  | "stump"
  | "fallenLog"
  | "sheep"
  | "shepherdHut"
  | "fence"
  | "rope"
  | "crook"
  | "wheat"
  | "windmill"
  | "mound"
  | "kiln"
  | "brickStack"
  | "cart"
  | "peak"
  | "mine"
  | "goldNugget"
  | "silverNugget"
  | "cactus"
  | "rock"
  | "bonePile"
  | "coin"
  | "crest"
  | "gull"
  | "sluice"
  | "reed";

export interface PropInstance {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly scale: number;
  /** Per-instance seed in [0, 1) for idle motion phase and colour variation. */
  readonly seed: number;
}

/** Props drawn with one instanced mesh per kind (static primitives). Windmills and gulls animate on their own. */
export const INSTANCED_KINDS: readonly PropKind[] = [
  "pine",
  "oak",
  "cabin",
  "logPile",
  "stump",
  "fallenLog",
  "sheep",
  "shepherdHut",
  "fence",
  "rope",
  "crook",
  "wheat",
  "mound",
  "kiln",
  "brickStack",
  "cart",
  "peak",
  "mine",
  "goldNugget",
  "silverNugget",
  "cactus",
  "rock",
  "bonePile",
  "coin",
  "crest",
  "sluice",
  "reed",
];

interface Recipe {
  readonly kind: PropKind;
  readonly min: number;
  readonly max: number;
  readonly scale: [number, number];
  /** Radial band from the tile centre (absolute, in R). */
  readonly band?: [number, number];
  /** The terrain's hero prop: always at least one, whatever the density. */
  readonly hero?: boolean;
  /** Evenly spaced around the recess, rotated tangentially (wheat rows). */
  readonly arrange?: "ring";
  /** Only laid out at this density or above (the gull at Medium+). */
  readonly minDensity?: number;
}

/** Heroes first so they always find room. */
const RECIPES: Record<PropTerrain, readonly Recipe[]> = {
  forest: [
    { kind: "cabin", min: 1, max: 1, scale: [1, 1], band: [0.5, 0.7], hero: true },
    { kind: "pine", min: 6, max: 8, scale: [0.85, 1.15] },
    { kind: "oak", min: 2, max: 3, scale: [0.9, 1.1] },
    { kind: "logPile", min: 2, max: 2, scale: [0.9, 1.1] },
    { kind: "stump", min: 1, max: 2, scale: [0.9, 1.2] },
    { kind: "fallenLog", min: 1, max: 1, scale: [1, 1] },
  ],
  meadow: [
    { kind: "shepherdHut", min: 1, max: 1, scale: [1, 1], band: [0.52, 0.7], hero: true },
    { kind: "sheep", min: 5, max: 6, scale: [0.9, 1.1] },
    { kind: "fence", min: 2, max: 2, scale: [0.9, 1.1], band: [0.52, 0.68] },
    { kind: "rope", min: 0, max: 1, scale: [1, 1] },
    { kind: "crook", min: 0, max: 1, scale: [1, 1] },
  ],
  farmland: [
    { kind: "windmill", min: 1, max: 1, scale: [1, 1], band: [0.66, 0.74], hero: true },
    { kind: "wheat", min: 4, max: 4, scale: [1, 1], band: [0.5, 0.54], arrange: "ring" },
  ],
  claypit: [
    { kind: "kiln", min: 1, max: 1, scale: [1, 1], band: [0.52, 0.68], hero: true },
    { kind: "mound", min: 3, max: 3, scale: [0.8, 1.1] },
    { kind: "brickStack", min: 1, max: 1, scale: [0.9, 1.1] },
    { kind: "cart", min: 1, max: 1, scale: [1, 1] },
  ],
  mountain: [
    { kind: "mine", min: 1, max: 1, scale: [1, 1], band: [0.52, 0.68], hero: true },
    { kind: "peak", min: 3, max: 3, scale: [0.8, 1.1] },
    { kind: "goldNugget", min: 2, max: 2, scale: [0.7, 1.2] },
    { kind: "silverNugget", min: 2, max: 3, scale: [0.7, 1.2] },
  ],
  wasteland: [
    { kind: "cactus", min: 1, max: 1, scale: [1, 1.1], band: [0.5, 0.72], hero: true },
    { kind: "rock", min: 4, max: 6, scale: [0.7, 1.3] },
    { kind: "bonePile", min: 1, max: 1, scale: [1, 1] },
    { kind: "coin", min: 0, max: 2, scale: [1, 1] },
  ],
  gold: [
    { kind: "sluice", min: 1, max: 1, scale: [1, 1], band: [0.52, 0.68], hero: true },
    { kind: "peak", min: 2, max: 2, scale: [0.75, 1] },
    { kind: "goldNugget", min: 6, max: 6, scale: [0.7, 1.2] },
  ],
  lake: [{ kind: "reed", min: 4, max: 6, scale: [0.9, 1.2], band: [0.66, 0.8] }],
  sea: [
    { kind: "crest", min: 2, max: 2, scale: [0.9, 1.1], band: [0.2, 0.6] },
    { kind: "gull", min: 0, max: 1, scale: [1, 1], band: [0.2, 0.5], minDensity: 0.7 },
  ],
};

/** The hero prop of each terrain (docs/props.md §3). */
export const HERO_PROP: Partial<Record<PropTerrain, PropKind>> = Object.fromEntries(
  Object.entries(RECIPES).flatMap(([t, rs]) => {
    const hero = rs.find((r) => r.hero);
    return hero ? [[t, hero.kind]] : [];
  }),
);

/** Approximate footprint radius per kind: keeps props off each other, the recess and the edge margin. */
export const FOOTPRINT: Record<PropKind, number> = {
  pine: 0.12,
  oak: 0.16,
  cabin: 0.19,
  logPile: 0.11,
  stump: 0.06,
  fallenLog: 0.13,
  sheep: 0.1,
  shepherdHut: 0.17,
  fence: 0.15,
  rope: 0.05,
  crook: 0.04,
  wheat: 0.2,
  windmill: 0.13,
  mound: 0.2,
  kiln: 0.17,
  brickStack: 0.1,
  cart: 0.14,
  peak: 0.2,
  mine: 0.2,
  goldNugget: 0.06,
  silverNugget: 0.06,
  cactus: 0.06,
  rock: 0.05,
  bonePile: 0.09,
  coin: 0.03,
  crest: 0.1,
  gull: 0.05,
  sluice: 0.2,
  reed: 0.04,
};

/** Radius inside which nothing stands: the recess (plus a hair), the lake's water, or nothing on the sea. */
export function innerLimit(terrain: PropTerrain): number {
  if (terrain === "sea") return 0;
  if (terrain === "lake") return LAKE_RADIUS + 0.02;
  return RECESS_RADIUS + 0.02;
}

export function propsForHex(hex: HexId, terrain: PropTerrain, density = 1): PropInstance[] {
  const rng = createRng(hex, "props");
  const out: PropInstance[] = [];
  const inner = innerLimit(terrain);
  for (const r of RECIPES[terrain] ?? []) {
    const wanted = r.min + rng.int(r.max - r.min + 1);
    let count = Math.round(wanted * density);
    if (r.minDensity !== undefined && density < r.minDensity) count = 0;
    if (r.hero) count = Math.max(1, count);
    const foot = FOOTPRINT[r.kind];
    if (r.arrange === "ring") {
      const [lo, hi] = r.band ?? [0.5, 0.56];
      const radius = lo + rng.next() * (hi - lo);
      const theta0 = rng.next() * Math.PI * 2;
      for (let k = 0; k < count; k++) {
        const theta = theta0 + (k / Math.max(1, count)) * Math.PI * 2;
        out.push({ kind: r.kind, x: Math.cos(theta) * radius, z: Math.sin(theta) * radius, rot: -theta - Math.PI / 2, scale: r.scale[0] + rng.next() * (r.scale[1] - r.scale[0]), seed: rng.next() });
      }
      continue;
    }
    for (let i = 0; i < count; i++) {
      const [lo, hi] = r.band ?? [Math.max(inner + foot, 0.42), 0.82];
      for (let attempt = 0; attempt < 60; attempt++) {
        const theta = rng.next() * Math.PI * 2;
        const radius = lo + rng.next() * (hi - lo);
        if (radius < inner + foot) continue;
        if (radius + foot > propBoundary(theta)) continue;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        const clash = out.some((p) => Math.hypot(p.x - x, p.z - z) < foot + FOOTPRINT[p.kind]);
        if (clash) continue;
        out.push({ kind: r.kind, x, z, rot: rng.next() * Math.PI * 2, scale: r.scale[0] + rng.next() * (r.scale[1] - r.scale[0]), seed: rng.next() });
        break;
      }
    }
  }
  return out;
}
