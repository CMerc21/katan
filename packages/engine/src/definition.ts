/**
 * Board definitions (docs/phase8.md §1): the editable, storable description
 * of a board of any shape. `createGame` resolves a definition into a
 * concrete `Board` with the seeded RNG (see `generation.ts`).
 */

import type { PortKind, Resource, Terrain } from "./board";
import type { EdgeId, HexCoord } from "./geometry";

export type Axial = HexCoord;

/** `frame` is the wooden edge of the table: drawn, never playable. Sea is playable with the Tides module (Phase 9). */
export type HexKind = "land" | "sea" | "frame";

export interface HexDef {
  readonly at: Axial;
  readonly kind: HexKind;
  /** Land only; missing means "fill at game start" when terrain generation is `shuffle`. */
  readonly terrain?: Terrain;
  /** 2–12 (never 7), land only, never on a wasteland. */
  readonly token?: number;
  /** Reserved for later modules (fish, river, fog). */
  readonly extras?: Record<string, unknown>;
}

export interface HarborDef {
  /** Must be a coastal edge: between a land hex and a sea/frame/missing hex. */
  readonly edge: EdgeId;
  readonly ratio: 3 | 2;
  /** Present iff ratio === 2. */
  readonly resource?: Resource;
}

export type TerrainGeneration = "fixed" | "shuffle";
export type TokenGeneration = "fixed" | "shuffle" | "balanced";
export type HarborGeneration = "fixed" | "shuffle";

export interface BoardDefinition {
  readonly id?: string;
  readonly name: string;
  readonly hexes: readonly HexDef[];
  readonly harbors: readonly HarborDef[];
  readonly seats: { readonly min: 3; readonly max: 4 | 5 | 6 };
  /** How unresolved parts are filled at game start. */
  readonly generation: {
    readonly terrain: TerrainGeneration;
    readonly tokens: TokenGeneration;
    readonly harbors: HarborGeneration;
  };
  readonly presets?: {
    readonly terrainPool?: readonly Terrain[];
    readonly tokenPool?: readonly number[];
    readonly harborPool?: readonly PortKind[];
  };
}

export function harborKind(h: HarborDef): PortKind {
  return h.ratio === 2 && h.resource ? h.resource : "any";
}

export function landHexes(def: BoardDefinition): HexDef[] {
  return def.hexes.filter((h) => h.kind === "land");
}

export function seaHexes(def: BoardDefinition): HexDef[] {
  return def.hexes.filter((h) => h.kind === "sea");
}

export function frameHexes(def: BoardDefinition): HexDef[] {
  return def.hexes.filter((h) => h.kind === "frame");
}

/** Structural check of untrusted JSON (shape only; rules live in `validateBoard`). */
export function isBoardDefinition(value: unknown): value is BoardDefinition {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  if (typeof d.name !== "string" || !Array.isArray(d.hexes) || !Array.isArray(d.harbors)) return false;
  const seats = d.seats as Record<string, unknown> | undefined;
  if (!seats || seats.min !== 3 || ![4, 5, 6].includes(seats.max as number)) return false;
  const g = d.generation as Record<string, unknown> | undefined;
  if (!g || !["fixed", "shuffle"].includes(String(g.terrain)) || !["fixed", "shuffle", "balanced"].includes(String(g.tokens)) || !["fixed", "shuffle"].includes(String(g.harbors))) return false;
  return d.hexes.every((h: unknown) => {
    if (typeof h !== "object" || h === null) return false;
    const x = h as Record<string, unknown>;
    const at = x.at as Record<string, unknown> | undefined;
    return !!at && Number.isInteger(at.q) && Number.isInteger(at.r) && ["land", "sea", "frame"].includes(String(x.kind));
  }) && d.harbors.every((h: unknown) => typeof h === "object" && h !== null && typeof (h as Record<string, unknown>).edge === "string");
}
