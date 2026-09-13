/**
 * Longest Road (§10.1) and Largest Army (§10.2).
 */

import { boardGeometry } from "./board";
import { type EdgeId, type VertexId } from "./geometry";
import { activeModules } from "./modules/hooks";
import { buildingsMap, emit } from "./state";
import type { GameState, PlayerId } from "./types";

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

type Link = "road" | "ship";

/**
 * Length of the longest trail through `playerId`'s roads and ships (§10.1,
 * §14.2 longest route): no edge reused, vertices may repeat, a vertex
 * holding an opponent's building cannot be passed through (a trail may
 * still end there or start from it), and a road continues into a ship (or
 * back) only through one of the player's own settlements or cities.
 */
export function longestRoadLength(state: GameState, playerId: PlayerId): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || (player.roads.length === 0 && player.ships.length === 0)) return 0;

  const geo = boardGeometry(state.board);
  const buildings = buildingsMap(state);
  const blocked = new Set<VertexId>();
  const own = new Set<VertexId>();
  for (const [v, b] of buildings) {
    if (b.owner !== playerId) blocked.add(v);
    else own.add(v);
  }
  // Opposing knights break a road at their vertex (docs/phase11.md §5); caravans double adjacent roads (docs/phase10.md §6).
  const hooks = activeModules(state);
  for (const h of hooks) for (const v of h.blockedVertices?.(state, playerId) ?? []) blocked.add(v);
  const weightOf = (e: EdgeId): number => {
    let w = 1;
    for (const h of hooks) w = Math.max(w, h.edgeWeight?.(state, playerId, e) ?? 1);
    return w;
  };

  const kindOf = new Map<EdgeId, Link>();
  for (const e of player.roads) kindOf.set(e, "road");
  for (const e of player.ships) kindOf.set(e, "ship");
  const edgesAt = new Map<VertexId, EdgeId[]>();
  for (const e of kindOf.keys()) {
    for (const v of geo.edgeVertices[e] ?? []) {
      const list = edgesAt.get(v);
      if (list) list.push(e);
      else edgesAt.set(v, [e]);
    }
  }

  const used = new Set<EdgeId>();
  const walk = (v: VertexId, via: Link | null): number => {
    let best = 0;
    for (const e of edgesAt.get(v) ?? []) {
      if (used.has(e)) continue;
      const kind = kindOf.get(e) as Link;
      if (via !== null && kind !== via && !own.has(v)) continue; // road ↔ ship only at an own building
      const [a, b] = geo.edgeVertices[e] as readonly [VertexId, VertexId];
      const next = a === v ? b : a;
      used.add(e);
      const len = weightOf(e) + (blocked.has(next) ? 0 : walk(next, kind));
      used.delete(e);
      if (len > best) best = len;
    }
    return best;
  };

  let best = 0;
  for (const v of edgesAt.keys()) {
    const len = walk(v, null);
    if (len > best) best = len;
  }
  return best;
}

/**
 * Re-evaluate Longest Road after any road or settlement (§10.1).
 *
 * - Nobody holds it: the unique player with the longest road of at least 5
 *   takes it; a tie leaves it unclaimed.
 * - Holder drops below 5: the card is lost and reassigned as above.
 * - Another player strictly exceeds the holder: that player takes it; if
 *   two or more players exceed the holder and tie, nobody holds it.
 * - Otherwise the holder keeps it (ties never transfer).
 */
export function updateLongestRoad(state: GameState): void {
  const lengths = new Map<PlayerId, number>();
  for (const p of state.players) lengths.set(p.id, longestRoadLength(state, p.id));

  const holder = state.longestRoad.playerId;
  const holderLength = holder === null ? 0 : (lengths.get(holder) ?? 0);

  const uniqueMaxAtLeast = (min: number): PlayerId | null => {
    let best = min - 1;
    let who: PlayerId | null = null;
    let tied = false;
    for (const [id, len] of lengths) {
      if (len > best) {
        best = len;
        who = id;
        tied = false;
      } else if (len === best && len >= min) {
        tied = true;
      }
    }
    return tied ? null : who;
  };

  let next: PlayerId | null;
  if (holder === null || holderLength < LONGEST_ROAD_MIN) {
    next = uniqueMaxAtLeast(LONGEST_ROAD_MIN);
  } else {
    const challenger = uniqueMaxAtLeast(holderLength + 1);
    const anyoneExceeds = [...lengths.values()].some((len) => len > holderLength);
    next = anyoneExceeds ? challenger : holder;
  }

  state.longestRoad = { playerId: next, length: next === null ? 0 : (lengths.get(next) ?? 0) };
  if (next !== holder) emit(state, { kind: "specialCardMoved", card: "longestRoad", from: holder, to: next });
}

/** Re-evaluate Largest Army after a knight is played (§10.2). */
export function updateLargestArmy(state: GameState): void {
  const holder = state.largestArmy.playerId;
  const holderCount = holder === null ? 0 : (state.players.find((p) => p.id === holder)?.playedKnights ?? 0);
  const threshold = holder === null ? LARGEST_ARMY_MIN : holderCount + 1;

  let next = holder;
  let best = holderCount;
  for (const p of state.players) {
    if (p.playedKnights >= threshold && p.playedKnights > best) {
      next = p.id;
      best = p.playedKnights;
    }
  }
  state.largestArmy = { playerId: next, count: next === null ? 0 : best };
  if (next !== holder) emit(state, { kind: "specialCardMoved", card: "largestArmy", from: holder, to: next });
}
