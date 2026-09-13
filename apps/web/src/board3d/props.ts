/**
 * Seeded prop layouts per tile (docs/phase7-5.md §4). Pure: given a hex id,
 * its terrain and a density, returns where each prop stands so no two forest
 * tiles look alike and every client draws the same scene.
 */

import { createRng, type HexId, type Terrain } from "@katan/engine";

export type PropKind =
  | "pine"
  | "oak"
  | "stump"
  | "hut"
  | "sheep"
  | "fence"
  | "wheat"
  | "windmill"
  | "mound"
  | "kiln"
  | "brickPile"
  | "cart"
  | "peak"
  | "mine"
  | "dune"
  | "cactus"
  | "ribcage"
  | "nugget"
  | "sluice";

export interface PropInstance {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly scale: number;
  /** Per-instance seed in [0, 1) for idle motion phase and colour variation. */
  readonly seed: number;
}

/** Props that are drawn with one instanced mesh per kind (static primitives). */
export const INSTANCED_KINDS: readonly PropKind[] = ["pine", "oak", "stump", "hut", "sheep", "fence", "wheat", "mound", "kiln", "brickPile", "cart", "peak", "mine", "dune", "cactus", "ribcage", "nugget", "sluice"];

interface Recipe {
  readonly kind: PropKind;
  readonly min: number;
  readonly max: number;
  readonly scale: [number, number];
  /** Radial band from the tile centre (token sits inside 0.36). */
  readonly band?: [number, number];
}

const RECIPES: Record<Terrain | "gold", readonly Recipe[]> = {
  lake: [],
  forest: [
    { kind: "pine", min: 5, max: 8, scale: [0.8, 1.2] },
    { kind: "oak", min: 1, max: 2, scale: [0.85, 1.1] },
    { kind: "stump", min: 1, max: 1, scale: [1, 1] },
    { kind: "hut", min: 0, max: 1, scale: [1, 1], band: [0.55, 0.72] },
  ],
  meadow: [
    { kind: "mound", min: 1, max: 1, scale: [1, 1.3], band: [0.45, 0.6] },
    { kind: "sheep", min: 3, max: 5, scale: [0.9, 1.1] },
    { kind: "fence", min: 1, max: 2, scale: [1, 1], band: [0.55, 0.75] },
  ],
  farmland: [
    { kind: "wheat", min: 4, max: 6, scale: [0.9, 1.1] },
    { kind: "windmill", min: 1, max: 1, scale: [1, 1], band: [0.5, 0.65] },
  ],
  claypit: [
    { kind: "mound", min: 2, max: 3, scale: [0.7, 1] },
    { kind: "kiln", min: 1, max: 1, scale: [1, 1], band: [0.45, 0.62] },
    { kind: "brickPile", min: 1, max: 2, scale: [0.9, 1.1] },
    { kind: "cart", min: 0, max: 1, scale: [1, 1], band: [0.55, 0.72] },
  ],
  mountain: [
    { kind: "peak", min: 2, max: 3, scale: [0.8, 1.25] },
    { kind: "mine", min: 1, max: 1, scale: [1, 1], band: [0.55, 0.72] },
  ],
  wasteland: [
    { kind: "dune", min: 2, max: 3, scale: [0.8, 1.2] },
    { kind: "cactus", min: 1, max: 1, scale: [0.9, 1.1] },
    { kind: "ribcage", min: 1, max: 1, scale: [1, 1] },
  ],
  gold: [
    { kind: "sluice", min: 1, max: 1, scale: [1, 1], band: [0.5, 0.65] },
    { kind: "nugget", min: 4, max: 6, scale: [0.8, 1.2] },
  ],
};

/** Approximate footprint radius per kind, to keep props from overlapping. */
const FOOTPRINT: Record<PropKind, number> = {
  pine: 0.16,
  oak: 0.16,
  stump: 0.08,
  hut: 0.18,
  sheep: 0.09,
  fence: 0.2,
  wheat: 0.18,
  windmill: 0.2,
  mound: 0.22,
  kiln: 0.16,
  brickPile: 0.12,
  cart: 0.16,
  peak: 0.24,
  mine: 0.16,
  dune: 0.24,
  cactus: 0.08,
  ribcage: 0.14,
  nugget: 0.06,
  sluice: 0.2,
};

export function propsForHex(hex: HexId, terrain: Terrain | "gold", density = 1): PropInstance[] {
  const rng = createRng(hex, "props");
  const out: PropInstance[] = [];
  const recipes = RECIPES[terrain] ?? [];
  for (const r of recipes) {
    const wanted = r.min + rng.int(r.max - r.min + 1);
    const count = Math.max(r.min > 0 ? 1 : 0, Math.round(wanted * density));
    for (let i = 0; i < count; i++) {
      const [lo, hi] = r.band ?? [0.4, 0.78];
      let placed = false;
      for (let attempt = 0; attempt < 12 && !placed; attempt++) {
        const angle = rng.next() * Math.PI * 2;
        const radius = lo + rng.next() * (hi - lo);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const foot = FOOTPRINT[r.kind];
        const clash = out.some((p) => Math.hypot(p.x - x, p.z - z) < foot + FOOTPRINT[p.kind]);
        if (clash) continue;
        out.push({ kind: r.kind, x, z, rot: rng.next() * Math.PI * 2, scale: r.scale[0] + rng.next() * (r.scale[1] - r.scale[0]), seed: rng.next() });
        placed = true;
      }
    }
  }
  return out;
}
