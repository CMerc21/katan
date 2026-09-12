/**
 * Shared evaluation helpers (docs/phase5.md §6.3). Everything here reads
 * only public information plus the bot's own hand.
 */

import {
  COSTS,
  RESOURCES,
  TERRAIN_RESOURCE,
  boardGeometry,
  hexCenter,
  isHiddenCount,
  legalSettlementVertices,
  parseHexId,
  satisfiesDistanceRule,
  viewToState,
  vertexPosition,
  type Geometry,
  type Hand,
  type HexId,
  type EdgeId,
  type Resource,
  type VertexId,
} from "@katan/engine";
import type { RedactedState } from "./types";

export type RedactedPlayer = RedactedState["players"][number];

export const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

export function emptyHand(): Hand {
  return { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
}

export function handTotal(h: Hand): number {
  return RESOURCES.reduce((n, r) => n + h[r], 0);
}

export function player(view: RedactedState, id: string): RedactedPlayer {
  const p = view.players.find((x) => x.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

export function me(view: RedactedState): RedactedPlayer {
  return player(view, view.viewer);
}

/** The bot's own hand (always visible to itself). */
export function myHand(view: RedactedState): Hand {
  const h = me(view).hand;
  return isHiddenCount(h) ? emptyHand() : h;
}

export function cardCount(p: RedactedPlayer): number {
  return isHiddenCount(p.hand) ? p.hand.count : handTotal(p.hand);
}

export function afford(h: Hand, cost: Hand): boolean {
  return RESOURCES.every((r) => h[r] >= cost[r]);
}

/** Expected pips per resource for a player's current buildings. */
/** The board's adjacency tables (any shape, docs/phase8.md §6). */
export function geo(view: RedactedState): Geometry {
  return boardGeometry(view.board);
}

export function productionOf(view: RedactedState, playerId: string): Hand {
  const p = player(view, playerId);
  const out = emptyHand();
  const g = geo(view);
  const add = (v: VertexId, mult: number) => {
    for (const h of g.vertexHexes[v] ?? []) {
      const tile = view.board.hexes[h];
      if (!tile || tile.token === null) continue;
      const r = TERRAIN_RESOURCE[tile.terrain];
      if (r) out[r] += (PIPS[tile.token] ?? 0) * mult;
    }
  };
  for (const v of p.settlements) add(v, 1);
  for (const v of p.cities) add(v, 2);
  return out;
}

/** Fewer hexes of a type on this board → higher weight (mean count / count). */
export function scarcity(view: RedactedState): Record<Resource, number> {
  const counts = emptyHand();
  for (const h of Object.keys(view.board.hexes)) {
    const r = TERRAIN_RESOURCE[view.board.hexes[h]!.terrain];
    if (r) counts[r] += 1;
  }
  const mean = RESOURCES.reduce((n, r) => n + counts[r], 0) / RESOURCES.length;
  const out = emptyHand();
  for (const r of RESOURCES) out[r] = counts[r] === 0 ? 2 : mean / counts[r];
  return out;
}

/** Pips on the producing hexes touching a vertex, per resource. */
export function vertexPips(view: RedactedState, vertex: VertexId): Hand {
  const out = emptyHand();
  for (const h of geo(view).vertexHexes[vertex] ?? []) {
    const tile = view.board.hexes[h];
    if (!tile || tile.token === null) continue;
    const r = TERRAIN_RESOURCE[tile.terrain];
    if (r) out[r] += PIPS[tile.token] ?? 0;
  }
  return out;
}

export function rawPipCount(view: RedactedState, vertex: VertexId): number {
  return handTotal(vertexPips(view, vertex));
}

/**
 * §6.3 vertexScore: scarcity-weighted pips, plus a bonus for resources the
 * player does not yet produce, plus harbor value when the harbor matches
 * what the player produces most.
 */
export type BoardShape = "small" | "standard" | "long" | "ring" | "large";

/** A rough classification of the board (docs/phase8.md §6): drives the spread and harbour heuristics. */
export function boardShape(view: RedactedState): BoardShape {
  const ids = Object.keys(view.board.hexes);
  if (ids.length < 16) return "small";
  const pts = ids.map((h) => hexCenter(parseHexId(h)));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  const aspect = Math.max(w, h) / Math.min(w, h);
  if (aspect > 1.8) return "long";
  if (view.board.sea.length >= 3 && ids.length >= 20) return "ring";
  return ids.length > 24 ? "large" : "standard";
}

export function vertexScore(view: RedactedState, vertex: VertexId, playerId: string): number {
  const weights = scarcity(view);
  const pips = vertexPips(view, vertex);
  const production = productionOf(view, playerId);
  const shape = boardShape(view);
  let score = 0;
  for (const r of RESOURCES) {
    score += pips[r] * weights[r];
    if (pips[r] > 0 && production[r] === 0) score += 1.5; // diversity
  }
  const port = view.board.ports.find((p) => p.vertices.includes(vertex));
  if (port) {
    const most = RESOURCES.reduce((b, r) => (production[r] + pips[r] > production[b] + pips[b] ? r : b), RESOURCES[0]);
    // Small boards run out of good spots quickly, so harbours are worth more early (docs/phase8.md §6).
    const early = shape === "small" ? 1.6 : 1;
    if (port.kind === "any") score += 1 * early;
    else if (port.kind === most) score += 2.5 * early;
    else score += 0.5 * early;
  }
  // Long and ring boards reward spreading out: distance from the player's nearest building.
  if (shape === "long" || shape === "ring") {
    const p = player(view, playerId);
    const mine = [...p.settlements, ...p.cities].map(vertexPosition);
    if (mine.length > 0) {
      const here = vertexPosition(vertex);
      const nearest = Math.min(...mine.map((m) => Math.hypot(m.x - here.x, m.y - here.y)));
      score += Math.min(2, nearest * 0.4);
    }
  }
  return score;
}

/** Vertices the player could settle on after building roads (legal now = 0 roads away). */
export function settlementCandidates(view: RedactedState, playerId: string): VertexId[] {
  return legalSettlementVertices(viewToState(view), playerId);
}

function occupied(view: RedactedState): Set<VertexId> {
  const s = new Set<VertexId>();
  for (const p of view.players) for (const v of [...p.settlements, ...p.cities]) s.add(v);
  return s;
}

export const EDGE_BFS_DEPTH = 4;

/**
 * §6.3 edgeTowardScore (docs/phase8.md §6): how much a road on `edge`
 * improves access to settlement spots not reachable yet, by BFS over the
 * hex graph's vertices from the road's far end up to depth 4 (each step is
 * one more road), discounted by distance and blocked by opponents' pieces.
 */
export function edgeTowardScore(view: RedactedState, edge: EdgeId, playerId: string): number {
  const state = viewToState(view);
  const g = geo(view);
  const p = player(view, playerId);
  const mine = new Set(p.roads);
  const myVerts = new Set<VertexId>();
  for (const e of p.roads) for (const v of g.edgeVertices[e] ?? []) myVerts.add(v);
  for (const v of [...p.settlements, ...p.cities]) myVerts.add(v);
  const taken = occupied(view);
  const blocked = new Set(view.players.filter((x) => x.id !== playerId).flatMap((x) => [...x.settlements, ...x.cities]));
  const roads = new Set(view.players.flatMap((x) => x.roads));
  const [a, b] = g.edgeVertices[edge] as [VertexId, VertexId];
  const far = myVerts.has(a) && !myVerts.has(b) ? b : myVerts.has(b) && !myVerts.has(a) ? a : null;
  if (far === null) return 0.2; // fills a gap in the network; low value
  if (blocked.has(far)) return 0;
  const reachable = new Set(settlementCandidates(view, playerId));
  const landOk = (v: VertexId) => (g.vertexHexes[v] ?? []).some((h) => view.board.hexes[h] !== undefined);
  // BFS: depth 0 = the far end (one road: this one), each edge = one more road.
  const dist = new Map<VertexId, number>([[far, 0]]);
  const queue: VertexId[] = [far];
  let score = 0;
  while (queue.length) {
    const v = queue.shift() as VertexId;
    const d = dist.get(v) as number;
    if (!taken.has(v) && landOk(v) && satisfiesDistanceRule(state, v) && !reachable.has(v)) {
      score = Math.max(score, vertexScore(view, v, playerId) * Math.pow(0.6, d));
    }
    if (d >= EDGE_BFS_DEPTH - 1 || (blocked.has(v) && v !== far)) continue;
    for (const e2 of g.vertexEdges[v] ?? []) {
      if (e2 === edge || (roads.has(e2) && !mine.has(e2))) continue;
      const [x, y] = g.edgeVertices[e2] as [VertexId, VertexId];
      const next = x === v ? y : x;
      if (myVerts.has(next) || dist.has(next)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return score;
}

export type BuildTarget = "city" | "settlement" | "road" | "devCard";

export interface Need {
  readonly target: BuildTarget;
  readonly cost: Hand;
  /** Cards still missing for the target. */
  readonly missing: Hand;
}

/** §6.3 resourceNeed: what the player is short of for its next planned build. */
export function resourceNeed(view: RedactedState, playerId: string): Need {
  const p = player(view, playerId);
  const h = playerId === view.viewer ? myHand(view) : emptyHand();
  const spots = settlementCandidates(view, playerId);
  let target: BuildTarget;
  if (p.settlements.length > 0 && p.pieces.cities > 0 && (spots.length === 0 || handTotal(h) >= 4)) target = "city";
  else if (spots.length > 0 && p.pieces.settlements > 0) target = "settlement";
  else if (p.pieces.roads > 0) target = "road";
  else target = "devCard";
  const cost = COSTS[target];
  const missing = emptyHand();
  for (const r of RESOURCES) missing[r] = Math.max(0, cost[r] - h[r]);
  return { target, cost, missing };
}

export function publicVP(p: RedactedPlayer): number {
  return p.publicVP + (p.privateVP ?? 0);
}

/** §6.3 threat: the strongest opponent and how close they are to special cards. */
export function threat(view: RedactedState): { leader: RedactedPlayer | null; leaderVP: number; roadThreat: string | null; armyThreat: string | null } {
  const opponents = view.players.filter((p) => p.id !== view.viewer);
  let leader: RedactedPlayer | null = null;
  for (const p of opponents) if (!leader || publicVP(p) > publicVP(leader)) leader = p;
  let roadThreat: string | null = null;
  let armyThreat: string | null = null;
  for (const p of opponents) {
    if (p.playedKnights >= Math.max(2, view.largestArmy.count)) armyThreat = p.id;
    if (p.roads.length >= Math.max(4, view.longestRoad.length)) roadThreat = p.id;
  }
  return { leader, leaderVP: leader ? publicVP(leader) : 0, roadThreat, armyThreat };
}

/** Hexes touching any of a player's buildings. */
export function hexesOf(view: RedactedState, playerId: string): Set<HexId> {
  const out = new Set<HexId>();
  const p = player(view, playerId);
  const g = geo(view);
  for (const v of [...p.settlements, ...p.cities]) for (const h of g.vertexHexes[v] ?? []) out.add(h);
  return out;
}

/** Pip value of a hex for a player: pips × (1 per settlement, 2 per city). */
export function hexValueFor(view: RedactedState, hex: HexId, playerId: string): number {
  const tile = view.board.hexes[hex];
  if (!tile || tile.token === null) return 0;
  const p = player(view, playerId);
  let mult = 0;
  for (const v of geo(view).hexVertices[hex] ?? []) {
    if (p.settlements.includes(v)) mult += 1;
    if (p.cities.includes(v)) mult += 2;
  }
  return (PIPS[tile.token] ?? 0) * mult;
}

/** Sum over opponents of the value a hex has for them. */
export function hexValueForOpponents(view: RedactedState, hex: HexId): number {
  return view.players.filter((p) => p.id !== view.viewer).reduce((n, p) => n + hexValueFor(view, hex, p.id), 0);
}

/** Estimate which resource opponents hold most of: card counts weighted by their production. */
export function opponentsLikelyResource(view: RedactedState): Resource {
  const score = emptyHand();
  for (const p of view.players) {
    if (p.id === view.viewer) continue;
    const prod = productionOf(view, p.id);
    const total = handTotal(prod) || 1;
    for (const r of RESOURCES) score[r] += (cardCount(p) * prod[r]) / total;
  }
  return RESOURCES.reduce((b, r) => (score[r] > score[b] ? r : b), RESOURCES[0]);
}
