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

export interface HexExtras {
  /** docs/phase10.md §6: an oasis produces spice under the Caravans variant (and nothing otherwise). */
  readonly oasis?: boolean;
}

export interface HexDef {
  readonly at: Axial;
  readonly kind: HexKind;
  /** Land only; missing means "fill at game start" when terrain generation is `shuffle`. */
  readonly terrain?: Terrain;
  /** 2–12 (never 7), land only, never on a wasteland or a lake. */
  readonly token?: number;
  /** Module markers (docs/phase10.md §8). */
  readonly extras?: HexExtras;
}

/** docs/phase10.md §8: edge attributes for the Rivers and Fishing variants. */
export type EdgeDef =
  | { readonly edge: EdgeId; readonly kind: "river" }
  | { readonly edge: EdgeId; readonly kind: "fishingGround"; readonly token: number };

export type EdgeKind = EdgeDef["kind"];

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
  /** River segments and fishing grounds (docs/phase10.md §8); absent means none. */
  readonly edges?: readonly EdgeDef[];
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

export function riverEdges(def: BoardDefinition): EdgeId[] {
  return (def.edges ?? []).filter((e) => e.kind === "river").map((e) => e.edge);
}

export function fishingGroundDefs(def: BoardDefinition): { edge: EdgeId; token: number }[] {
  return (def.edges ?? []).flatMap((e) => (e.kind === "fishingGround" ? [{ edge: e.edge, token: e.token }] : []));
}

export function oasisHexes(def: BoardDefinition): HexDef[] {
  return def.hexes.filter((h) => h.kind === "land" && h.extras?.oasis === true);
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
  if (d.edges !== undefined) {
    if (!Array.isArray(d.edges)) return false;
    const ok = d.edges.every((e: unknown) => {
      if (typeof e !== "object" || e === null) return false;
      const x = e as Record<string, unknown>;
      if (typeof x.edge !== "string") return false;
      if (x.kind === "river") return true;
      return x.kind === "fishingGround" && Number.isInteger(x.token);
    });
    if (!ok) return false;
  }
  return d.hexes.every((h: unknown) => {
    if (typeof h !== "object" || h === null) return false;
    const x = h as Record<string, unknown>;
    const at = x.at as Record<string, unknown> | undefined;
    return !!at && Number.isInteger(at.q) && Number.isInteger(at.r) && ["land", "sea", "frame"].includes(String(x.kind));
  }) && d.harbors.every((h: unknown) => typeof h === "object" && h !== null && typeof (h as Record<string, unknown>).edge === "string");
}
