/**
 * Board validation (docs/phase8.md §3). Errors stop a board from being
 * saved or played; warnings are shown but allowed.
 */

import { RESOURCES, TERRAINS, type Terrain } from "./board";
import { harborKind, landHexes, seaHexes, type BoardDefinition, type HexDef } from "./definition";
import { edgeVerticesOf, geometryFor, hexId, neighbor, parseEdgeId, type EdgeId, type HexId, type VertexId } from "./geometry";
import { PIPS, terrainPool } from "./pools";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  /** A hex, edge or vertex the issue points at, when there is one. */
  readonly at?: string;
}

export interface ValidateOptions {
  /** Phase 9: islands are allowed, so land need not be connected. */
  readonly allowIslands?: boolean;
}

const VALID_TOKENS = new Set([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);

/** A land hex is coastal when any neighbour is sea, frame or missing. */
export function coastalLand(def: BoardDefinition): Set<HexId> {
  const land = new Set(landHexes(def).map((h) => hexId(h.at)));
  const out = new Set<HexId>();
  for (const h of landHexes(def)) {
    for (let k = 0; k < 6; k++) {
      if (!land.has(hexId(neighbor(h.at, k)))) {
        out.add(hexId(h.at));
        break;
      }
    }
  }
  return out;
}

/** Edges between a land hex and a sea/frame/missing hex, i.e. where a harbour may go. */
export function coastalEdges(def: BoardDefinition): EdgeId[] {
  const land = new Set(landHexes(def).map((h) => hexId(h.at)));
  const geo = geometryFor([...land]);
  return geo.boundaryEdges.slice();
}

/** Connected components of the land (each is an island, docs/phase9.md §1). */
export function landComponents(def: BoardDefinition): HexId[][] {
  const land = landHexes(def).map((h) => hexId(h.at));
  const geo = geometryFor(land);
  const seen = new Set<HexId>();
  const out: HexId[][] = [];
  for (const start of land) {
    if (seen.has(start)) continue;
    const comp: HexId[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const h = stack.pop() as HexId;
      comp.push(h);
      for (const n of geo.hexNeighbors[h] ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push(comp.sort());
  }
  return out.sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
}

/**
 * How many settlements could stand on the board at once under the distance
 * rule (greedy independent set over land vertices); each seat pair needs
 * about five such spots to start.
 */
export function startingCapacity(def: BoardDefinition): number {
  const land = landHexes(def).map((h) => hexId(h.at));
  const geo = geometryFor(land);
  const taken = new Set<VertexId>();
  let count = 0;
  for (const v of geo.vertices) {
    if (taken.has(v)) continue;
    count += 1;
    taken.add(v);
    for (const n of geo.vertexNeighbors[v] ?? []) taken.add(n);
  }
  return count;
}

export function seatsSupported(def: BoardDefinition): number {
  return Math.max(0, Math.floor((startingCapacity(def) * 2) / 5));
}

export function validateBoard(def: BoardDefinition, options: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, at?: string) => issues.push(at === undefined ? { severity: "error", code, message } : { severity: "error", code, message, at });
  const warn = (code: string, message: string, at?: string) => issues.push(at === undefined ? { severity: "warning", code, message } : { severity: "warning", code, message, at });

  // Overlaps.
  const seen = new Map<HexId, HexDef>();
  for (const h of def.hexes) {
    const id = hexId(h.at);
    if (seen.has(id)) error("OVERLAP", `two hexes at ${id}`, id);
    seen.set(id, h);
  }
  const land = landHexes(def);
  const landIds = new Set(land.map((h) => hexId(h.at)));
  if (land.length < 7) error("TOO_SMALL", `a board needs at least 7 land hexes (has ${land.length})`);

  // Sea and frame carry nothing.
  for (const h of def.hexes) {
    if (h.kind !== "land" && (h.terrain !== undefined || h.token !== undefined)) error("SEA_CONTENT", `${h.kind} hex ${hexId(h.at)} cannot have terrain or a token`, hexId(h.at));
  }

  // Terrain.
  const unassigned = land.filter((h) => h.terrain === undefined);
  if (def.generation.terrain === "fixed" && unassigned.length > 0) {
    error("UNASSIGNED_TERRAIN", `${unassigned.length} land hex(es) have no terrain and terrain is fixed`, hexId(unassigned[0]!.at));
  }
  for (const h of land) if (h.terrain !== undefined && !TERRAINS.includes(h.terrain)) error("BAD_TERRAIN", `unknown terrain ${String(h.terrain)}`, hexId(h.at));
  const assigned = land.filter((h) => h.terrain !== undefined);
  if (def.generation.terrain === "fixed" && land.length >= 7) {
    const expectsDesert = terrainPool(land.length).includes("wasteland");
    if (expectsDesert && !assigned.some((h) => h.terrain === "wasteland")) warn("NO_WASTELAND", "no wasteland: the robber will start on the first land hex");
    const present = new Set(assigned.map((h) => h.terrain));
    for (const t of ["forest", "claypit", "meadow", "farmland", "mountain"] as Terrain[]) {
      if (!present.has(t)) warn("MISSING_TERRAIN", `no ${t} hex: its resource can only come from trades`);
    }
  }

  // Tokens.
  const producing = land.filter((h) => h.terrain !== "wasteland");
  for (const h of land) {
    if (h.token === undefined) continue;
    if (!VALID_TOKENS.has(h.token)) error("BAD_TOKEN", `token ${h.token} on ${hexId(h.at)} is not 2–12 (and never 7)`, hexId(h.at));
    if (h.terrain === "wasteland") error("TOKEN_ON_WASTELAND", `wasteland ${hexId(h.at)} cannot carry a token`, hexId(h.at));
  }
  if (def.generation.tokens === "fixed") {
    const withToken = producing.filter((h) => h.token !== undefined).length;
    if (withToken !== producing.length) error("TOKEN_COUNT", `${producing.length} producing hexes but ${withToken} tokens (tokens are fixed)`);
  }
  // Adjacency warnings for whatever tokens are placed.
  const geo = geometryFor([...landIds]);
  const tokenOf = new Map<HexId, number>();
  for (const h of land) if (h.token !== undefined) tokenOf.set(hexId(h.at), h.token);
  const reported = new Set<string>();
  for (const [h, t] of tokenOf) {
    for (const n of geo.hexNeighbors[h] ?? []) {
      const u = tokenOf.get(n);
      if (u === undefined) continue;
      const key = [h, n].sort().join("~");
      if (reported.has(key)) continue;
      if ((t === 6 || t === 8) && (u === 6 || u === 8)) {
        reported.add(key);
        warn("HOT_ADJACENT", `6 and 8 tokens are adjacent at ${h} and ${n}`, h);
      } else if (t === u) {
        reported.add(key);
        warn("SAME_ADJACENT", `two ${t}s are adjacent at ${h} and ${n}`, h);
      }
    }
  }

  // Harbours.
  const coast = new Set(coastalEdges(def));
  const harborVertices = new Map<VertexId, EdgeId>();
  for (const h of def.harbors) {
    let ok = true;
    try {
      parseEdgeId(h.edge);
    } catch {
      ok = false;
    }
    if (!ok) {
      error("BAD_EDGE", `harbour edge ${h.edge} is malformed`, h.edge);
      continue;
    }
    if (!coast.has(h.edge)) error("HARBOR_INLAND", `harbour on ${h.edge} is not on the coast`, h.edge);
    if (h.ratio !== 2 && h.ratio !== 3) error("BAD_RATIO", `harbour ratio must be 2 or 3`, h.edge);
    if (h.ratio === 2 && (!h.resource || !RESOURCES.includes(h.resource))) error("BAD_RATIO", `a 2:1 harbour needs a resource`, h.edge);
    if (h.ratio === 3 && h.resource) error("BAD_RATIO", `a 3:1 harbour has no resource`, h.edge);
    void harborKind(h);
    if (coast.has(h.edge)) {
      for (const v of edgeVerticesOf(h.edge)) {
        const other = harborVertices.get(v);
        if (other && other !== h.edge) error("HARBOR_SHARED_VERTEX", `harbours on ${other} and ${h.edge} share a vertex`, v);
        harborVertices.set(v, h.edge);
      }
    }
  }
  if (def.generation.harbors === "fixed" && def.harbors.length < 2) warn("FEW_HARBORS", "fewer than 2 harbours");

  // Connectivity.
  const comps = landComponents(def);
  if (comps.length > 1 && !options.allowIslands) error("LAND_SPLIT", `land is split into ${comps.length} islands; join them (or enable Tides for islands)`);

  // Seats.
  const supported = seatsSupported(def);
  if (def.seats.max > supported) error("TOO_MANY_SEATS", `this board supports ${supported} seats (needs about 5 starting spots per pair of seats); seats.max is ${def.seats.max}`);
  if (![4, 5, 6].includes(def.seats.max)) error("BAD_SEATS", "seats.max must be 4, 5 or 6");

  // Sea hexes that are neither adjacent to land nor to other sea are fine; nothing to check.
  void seaHexes;
  void PIPS;
  return issues;
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
