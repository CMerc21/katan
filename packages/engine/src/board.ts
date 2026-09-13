/**
 * Board contents: terrain, number tokens, ports (docs/rules.md §2, §3.5–§3.6;
 * docs/phase8.md §1). A `Board` is the resolved, concrete board stored in
 * the game state; `BoardDefinition` (definition.ts) is the editable form.
 */

import type { BoardDefinition } from "./definition";
import { GEOMETRY, edgeMidpoint, geometryFor, type EdgeId, type Geometry, type HexId, type VertexId } from "./geometry";
import { RNG_INDEX_BOARD, rng, type Rng } from "./rng";

export const RESOURCES = ["wood", "clay", "wool", "grain", "ore"] as const;
export type Resource = (typeof RESOURCES)[number];

/** `gold` is reserved for the Tides module (docs/phase9.md): it produces a resource of the owner's choice. */
/** `lake` is the Fishing variant's inland water (docs/phase10.md §2): produces nothing, holds no token, fish on 2, 3, 11 and 12. */
export const TERRAINS = ["forest", "claypit", "meadow", "farmland", "mountain", "wasteland", "gold", "lake"] as const;
export type Terrain = (typeof TERRAINS)[number];

/** §2.1 (gold has no fixed resource; see §6.2 in Phase 9). */
export const TERRAIN_RESOURCE: Readonly<Record<Terrain, Resource | null>> = {
  forest: "wood",
  claypit: "clay",
  meadow: "wool",
  farmland: "grain",
  mountain: "ore",
  wasteland: null,
  gold: null,
  lake: null,
};

/** §2.1: the standard 19-hex counts. */
export const TERRAIN_COUNTS: Readonly<Record<Terrain, number>> = {
  forest: 4,
  claypit: 3,
  meadow: 4,
  farmland: 4,
  mountain: 3,
  wasteland: 1,
  gold: 0,
  lake: 0,
};

/** §2.2 */
/** Terrains that never carry a number token. */
export const TOKENLESS_TERRAINS: readonly Terrain[] = ["wasteland", "lake"];

export function producesOnToken(terrain: Terrain): boolean {
  return !TOKENLESS_TERRAINS.includes(terrain);
}

export const NUMBER_TOKENS: readonly number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export type PortKind = "any" | Resource;

/** §2.6: four generic ports plus one per resource. */
export const PORT_KINDS: readonly PortKind[] = ["any", "any", "any", "any", ...RESOURCES];

/** §3.6: indices into the angle-ordered boundary edge list. */
export const PORT_EDGE_INDICES: readonly number[] = [0, 3, 7, 10, 13, 17, 20, 23, 27];

export interface HexTile {
  readonly terrain: Terrain;
  /** null for the wasteland (and for gold hexes without a token). */
  readonly token: number | null;
}

/** docs/phase10.md §2: a fishing ground on a coastal edge with its own number token. */
export interface FishingGround {
  readonly edge: EdgeId;
  readonly token: number;
}

export interface Port {
  readonly edge: EdgeId;
  readonly kind: PortKind;
  readonly vertices: readonly [VertexId, VertexId];
}

/** A connected component of land (docs/rules.md §14.4). */
export interface Island {
  readonly id: number;
  readonly hexes: readonly HexId[];
}

export interface Board {
  readonly name: string;
  /** Land tiles only. */
  readonly hexes: Readonly<Record<HexId, HexTile>>;
  /** Water tiles: playable only when `seaPlayable` (Tides, Phase 9). */
  readonly sea: readonly HexId[];
  /** The wooden edge of the table: drawn, never playable. */
  readonly frame: readonly HexId[];
  readonly ports: readonly Port[];
  readonly seats: { readonly min: number; readonly max: number };
  readonly seaPlayable: boolean;
  /** Islands by id (largest first); a single-island board has one. */
  readonly islands: readonly Island[];
  /** River segments (docs/phase10.md §3): edges bordering at least one land hex. */
  readonly rivers: readonly EdgeId[];
  /** Fishing grounds (docs/phase10.md §2) on coastal edges. */
  readonly fishingGrounds: readonly FishingGround[];
  /** Oases (docs/phase10.md §6): land hexes that produce spice instead of their resource. */
  readonly oases: readonly HexId[];
}

export type BoardKind = "beginner" | "random";

/** The playable geometry of a board: land, plus sea when ships are in play (docs/phase8.md §1, docs/phase9.md §1). */
export function boardGeometry(board: Board): Geometry {
  const ids = Object.keys(board.hexes);
  return geometryFor(board.seaPlayable ? [...ids, ...board.sea] : ids);
}

export function landHexIds(board: Board): HexId[] {
  return Object.keys(board.hexes);
}

/** §3.6: the standard frame's boundary edges ordered by the angle of their midpoint. */
export function portEdgesInOrder(): EdgeId[] {
  const withAngle = GEOMETRY.boundaryEdges.map((e) => {
    const m = edgeMidpoint(e);
    return { e, angle: Math.atan2(m.y, m.x) };
  });
  withAngle.sort((a, b) => a.angle - b.angle || (a.e < b.e ? -1 : 1));
  const ordered = withAngle.map((x) => x.e);
  return PORT_EDGE_INDICES.map((i) => ordered[i] as EdgeId);
}

/** §2.2: true when no two adjacent land hexes both carry a 6 or an 8. */
export function honorsSixEightRule(hexes: Readonly<Record<HexId, HexTile>>): boolean {
  const geo = geometryFor(Object.keys(hexes));
  const hot = (h: HexId): boolean => {
    const tok = hexes[h]?.token;
    return tok === 6 || tok === 8;
  };
  for (const h of geo.hexes) {
    if (!hot(h)) continue;
    for (const n of geo.hexNeighbors[h] ?? []) {
      if (hot(n)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Beginner board: a fixed, original layout specified in spiral order (§3.5).

export const BEGINNER_TERRAINS: readonly Terrain[] = [
  // outer ring (12)
  "forest", "meadow", "farmland", "mountain", "claypit", "forest",
  "meadow", "farmland", "mountain", "claypit", "forest", "meadow",
  // inner ring (6)
  "farmland", "forest", "meadow", "mountain", "claypit", "farmland",
  // centre
  "wasteland",
];

export const BEGINNER_TOKENS: readonly number[] = [
  // outer ring (12)
  6, 3, 11, 8, 4, 9, 6, 2, 10, 8, 5, 12,
  // inner ring (6)
  3, 11, 4, 9, 10, 5,
];

export const BEGINNER_PORTS: readonly PortKind[] = ["any", "wood", "any", "clay", "wool", "any", "grain", "any", "ore"];

// ---------------------------------------------------------------------------
// Resolution entry points (implemented over definitions; see generation.ts).

export function beginnerBoard(): Board {
  return resolveDefinition(beginnerDefinition(), rng("beginner", RNG_INDEX_BOARD));
}

export function randomBoardWithRng(r: Rng): Board {
  return resolveDefinition(randomDefinition(), r);
}

export function randomBoard(seed: string): Board {
  return randomBoardWithRng(rng(seed, RNG_INDEX_BOARD));
}

export function makeBoard(kind: BoardKind, seed: string): Board {
  switch (kind) {
    case "beginner":
      return beginnerBoard();
    case "random":
      return randomBoard(seed);
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown board kind ${String(exhaustive)}`);
    }
  }
}

/** The hex holding the wasteland (where the robber starts, §4.4), else the lake (docs/phase10.md §2), else the first land hex. */
export function wastelandHex(board: Board): HexId {
  for (const h of Object.keys(board.hexes)) {
    if (board.hexes[h]?.terrain === "wasteland") return h;
  }
  for (const h of Object.keys(board.hexes)) {
    if (board.hexes[h]?.terrain === "lake") return h;
  }
  const first = Object.keys(board.hexes).sort()[0];
  if (!first) throw new Error("board has no land");
  return first;
}

// Late-bound to avoid an import cycle at module evaluation (generation → frames → board).
import { resolveBoard as resolveDefinition } from "./generation";
import { beginnerDefinition, randomDefinition } from "./frames";
export type { BoardDefinition };
