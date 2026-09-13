/**
 * Resolve a BoardDefinition into a concrete Board with the seeded RNG
 * (docs/phase8.md §1–§2): fill terrains, tokens and harbours according to
 * the definition's generation modes, honouring the 6/8 rule (§2.2) and,
 * for `balanced`, the stricter constraints.
 */

import { TERRAIN_RESOURCE, producesOnToken, type Board, type HexTile, type Port, type PortKind, type Terrain } from "./board";
import { fishingGroundDefs, harborKind, landHexes, oasisHexes, riverEdges, type BoardDefinition, type EdgeDef, type HarborDef, type HexDef } from "./definition";
import { RuleError } from "./errors";
import { edgeMidpoint, edgeVerticesOf, geometryFor, hexId, parseEdgeId, type EdgeId, type Geometry, type HexId, type VertexId } from "./geometry";
import { PIPS, harborCount, harborPool, terrainPool, tokenPool, trimPool } from "./pools";
import type { Rng } from "./rng";
import { coastalEdges, hasErrors, landComponents, validateBoard, type ValidateOptions } from "./validation";

export const MAX_TOKEN_ATTEMPTS = 10_000;
export const BALANCED_ATTEMPTS = 400;
export const BALANCED_SWAPS = 4000;

/** Remove `have` from `pool` where possible; returns what is left of the pool. */
function subtract<T>(pool: readonly T[], have: readonly T[]): T[] {
  const left = pool.slice();
  for (const h of have) {
    const i = left.indexOf(h);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

function resolveTerrains(def: BoardDefinition, rng: Rng): Map<HexId, Terrain> {
  const land = landHexes(def);
  const out = new Map<HexId, Terrain>();
  if (def.generation.terrain === "fixed") {
    for (const h of land) out.set(hexId(h.at), h.terrain as Terrain);
    return out;
  }
  // Painted hexes keep their terrain (docs/phase8.md §2); the rest draw from the pool minus what is painted.
  const assigned = land.filter((h) => h.terrain !== undefined).map((h) => h.terrain as Terrain);
  const open = land.filter((h) => h.terrain === undefined);
  const pool = def.presets?.terrainPool ? [...def.presets.terrainPool] : terrainPool(land.length);
  const fill = trimPool(subtract(pool, assigned), open.length);
  while (fill.length < open.length) fill.push(pool[fill.length % pool.length] ?? "meadow");
  const shuffled = rng.shuffle(fill);
  for (const h of land) if (h.terrain !== undefined) out.set(hexId(h.at), h.terrain);
  open.forEach((h, i) => out.set(hexId(h.at), shuffled[i] as Terrain));
  return out;
}

function hot(t: number | undefined): boolean {
  return t === 6 || t === 8;
}

export function violations(tokens: ReadonlyMap<HexId, number>, geo: Geometry): { hot: number; same: number; heavy: number } {
  let hotN = 0;
  let same = 0;
  let heavy = 0;
  for (const [h, t] of tokens) {
    for (const n of geo.hexNeighbors[h] ?? []) {
      if (n < h) continue; // count each pair once
      const u = tokens.get(n);
      if (u === undefined) continue;
      if (hot(t) && hot(u)) hotN += 1;
      if (t === u) same += 1;
    }
  }
  for (const v of geo.vertices) {
    let pips = 0;
    for (const h of geo.vertexHexes[v] ?? []) pips += PIPS[tokens.get(h) ?? 0] ?? 0;
    if (pips > 12) heavy += 1;
  }
  return { hot: hotN, same, heavy };
}

function resolveTokens(def: BoardDefinition, terrains: ReadonlyMap<HexId, Terrain>, rng: Rng): Map<HexId, number> {
  const land = landHexes(def);
  const producing = land.filter((h) => producesOnToken(terrains.get(hexId(h.at)) as Terrain));
  const out = new Map<HexId, number>();
  if (def.generation.tokens === "fixed") {
    for (const h of producing) if (h.token !== undefined) out.set(hexId(h.at), h.token);
    return out;
  }
  const given = producing.filter((h) => h.token !== undefined).map((h) => h.token as number);
  const pool = def.presets?.tokenPool ? [...def.presets.tokenPool] : tokenPool(producing.length);
  const fill = trimPool(subtract(pool, given), Math.max(0, producing.length - given.length));
  const all = [...given, ...fill].slice(0, producing.length);
  while (all.length < producing.length) all.push(pool[all.length % pool.length] ?? 8);
  const geo = geometryFor(land.map((h) => hexId(h.at)));
  const ids = producing.map((h) => hexId(h.at));
  const assign = (order: number[]): Map<HexId, number> => {
    const m = new Map<HexId, number>();
    ids.forEach((id, i) => m.set(id, order[i] as number));
    return m;
  };
  if (def.generation.tokens === "shuffle") {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
      const m = assign(rng.shuffle(all));
      if (violations(m, geo).hot === 0) return m;
    }
    // Extremely dense boards may have no 6/8-free layout; fall through to best effort.
  }
  // Balanced (docs/phase8.md §2): random restarts, then seeded pair swaps that never worsen the score.
  const score = (m: ReadonlyMap<HexId, number>): number => {
    const v = violations(m, geo);
    return v.hot * 10 + v.same * 3 + v.heavy;
  };
  let best: Map<HexId, number> = assign(all);
  let bestScore = score(best);
  for (let attempt = 0; attempt < BALANCED_ATTEMPTS && bestScore > 0; attempt++) {
    const m = assign(rng.shuffle(all));
    const sc = score(m);
    if (sc < bestScore) {
      bestScore = sc;
      best = m;
    }
  }
  for (let swap = 0; swap < BALANCED_SWAPS && bestScore > 0 && ids.length > 1; swap++) {
    const i = ids[rng.int(ids.length)] as HexId;
    const j = ids[rng.int(ids.length)] as HexId;
    if (i === j || best.get(i) === best.get(j)) continue;
    const m = new Map(best);
    const ti = m.get(i) as number;
    m.set(i, m.get(j) as number);
    m.set(j, ti);
    const sc = score(m);
    if (sc <= bestScore) {
      best = m;
      bestScore = sc;
    }
  }
  return best;
}

/** Evenly spaced coastal edges that share no vertex, walking the coast by angle around the centre. */
export function autoHarborEdges(def: BoardDefinition, count: number): EdgeId[] {
  const coast = coastalEdges(def);
  if (coast.length === 0) return [];
  const land = landHexes(def);
  const cx = land.reduce((n, h) => n + h.at.q + h.at.r / 2, 0) / land.length;
  const cz = land.reduce((n, h) => n + h.at.r, 0) / land.length;
  const ordered = coast
    .map((e) => {
      const m = edgeMidpoint(e);
      return { e, angle: Math.atan2(m.y / 1.5 - cz, m.x / Math.sqrt(3) - cx) };
    })
    .sort((a, b) => a.angle - b.angle || (a.e < b.e ? -1 : 1))
    .map((x) => x.e);
  const out: EdgeId[] = [];
  const used = new Set<VertexId>();
  const step = ordered.length / Math.max(1, count);
  let i = 0;
  let cursor = 0;
  while (out.length < count && i < ordered.length * 2) {
    const idx = Math.round(cursor) % ordered.length;
    // Take the first edge at or after the cursor whose vertices are free.
    let picked: EdgeId | null = null;
    for (let k = 0; k < ordered.length; k++) {
      const e = ordered[(idx + k) % ordered.length] as EdgeId;
      const [a, b] = edgeVerticesOf(e);
      if (!used.has(a) && !used.has(b) && !out.includes(e)) {
        picked = e;
        break;
      }
    }
    if (!picked) break;
    out.push(picked);
    for (const v of edgeVerticesOf(picked)) used.add(v);
    cursor += step;
    i += 1;
  }
  return out;
}

function resolveHarbors(def: BoardDefinition, rng: Rng): Port[] {
  const land = landHexes(def).length;
  let edges: EdgeId[];
  let kinds: PortKind[];
  if (def.generation.harbors === "fixed") {
    edges = def.harbors.map((h) => h.edge);
    kinds = def.harbors.map(harborKind);
  } else {
    edges = def.harbors.length > 0 ? def.harbors.map((h) => h.edge) : autoHarborEdges(def, harborCount(land));
    const pool = def.presets?.harborPool ? [...def.presets.harborPool] : def.harbors.length > 0 ? def.harbors.map(harborKind) : harborPool(edges.length);
    while (pool.length < edges.length) pool.push("any");
    kinds = rng.shuffle(pool).slice(0, edges.length);
  }
  return edges.map((edge, i) => ({ edge, kind: kinds[i] as PortKind, vertices: edgeVerticesOf(edge) }));
}

/** Resolve `def` with `rng`; throws `RuleError("INVALID_BOARD")` when validation reports errors. */
export function resolveBoard(def: BoardDefinition, rng: Rng, options: ValidateOptions = {}): Board {
  const issues = validateBoard(def, options);
  if (hasErrors(issues)) {
    const first = issues.find((i) => i.severity === "error");
    throw new RuleError("INVALID_BOARD", first ? `${first.code}: ${first.message}` : "invalid board");
  }
  const terrains = resolveTerrains(def, rng);
  const tokens = resolveTokens(def, terrains, rng);
  const hexes: Record<HexId, HexTile> = {};
  for (const h of landHexes(def)) {
    const id = hexId(h.at);
    const terrain = terrains.get(id) as Terrain;
    hexes[id] = { terrain, token: !producesOnToken(terrain) ? null : (tokens.get(id) ?? null) };
  }
  const ports = resolveHarbors(def, rng);
  return {
    name: def.name,
    hexes,
    sea: def.hexes.filter((h) => h.kind === "sea").map((h) => hexId(h.at)),
    frame: def.hexes.filter((h) => h.kind === "frame").map((h) => hexId(h.at)),
    ports,
    seats: { min: def.seats.min, max: def.seats.max },
    seaPlayable: false,
    islands: landComponents(def).map((hexes, id) => ({ id, hexes })),
    rivers: riverEdges(def),
    fishingGrounds: fishingGroundDefs(def),
    oases: oasisHexes(def).map((h) => hexId(h.at)),
  };
}

/** A definition that pins a resolved board exactly (fixed everything); used to snapshot into a game. */
export function definitionFromBoard(board: Board, name = board.name): BoardDefinition {
  return {
    name,
    hexes: [
      ...Object.entries(board.hexes).map(([id, t]): HexDef => {
        const [q, r] = id.split(",").map(Number) as [number, number];
        const base: HexDef = t.token === null ? { at: { q, r }, kind: "land" as const, terrain: t.terrain } : { at: { q, r }, kind: "land" as const, terrain: t.terrain, token: t.token };
        return board.oases.includes(id) ? { ...base, extras: { oasis: true } } : base;
      }),
      ...board.sea.map((id) => {
        const [q, r] = id.split(",").map(Number) as [number, number];
        return { at: { q, r }, kind: "sea" as const };
      }),
      ...board.frame.map((id) => {
        const [q, r] = id.split(",").map(Number) as [number, number];
        return { at: { q, r }, kind: "frame" as const };
      }),
    ],
    harbors: board.ports.map((p): HarborDef => (p.kind === "any" ? { edge: p.edge, ratio: 3 } : { edge: p.edge, ratio: 2, resource: p.kind })),
    edges: [...board.rivers.map((edge): EdgeDef => ({ edge, kind: "river" })), ...board.fishingGrounds.map((f): EdgeDef => ({ edge: f.edge, kind: "fishingGround", token: f.token }))],
    seats: { min: 3, max: board.seats.max as 4 | 5 | 6 },
    generation: { terrain: "fixed", tokens: "fixed", harbors: "fixed" },
  };
}

export { TERRAIN_RESOURCE, parseEdgeId };
