/**
 * Longest Road (§10.1) and Largest Army (§10.2).
 */

import { boardGeometry } from "./board";
import { type EdgeId, type VertexId } from "./geometry";
import { buildingsMap, emit } from "./state";
import type { GameState, PlayerId } from "./types";

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

/**
 * Length of the longest trail through `playerId`'s roads: no edge reused,
 * vertices may repeat, and a vertex holding an opponent's building cannot
 * be passed through (a trail may still end there or start from it).
 */
export function longestRoadLength(state: GameState, playerId: PlayerId): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.roads.length === 0) return 0;

  const geo = boardGeometry(state.board);
  const buildings = buildingsMap(state);
  const blocked = new Set<VertexId>();
  for (const [v, b] of buildings) if (b.owner !== playerId) blocked.add(v);

  const edgesAt = new Map<VertexId, EdgeId[]>();
  for (const e of player.roads) {
    for (const v of geo.edgeVertices[e] ?? []) {
      const list = edgesAt.get(v);
      if (list) list.push(e);
      else edgesAt.set(v, [e]);
    }
  }

  const used = new Set<EdgeId>();
  const walk = (v: VertexId): number => {
    let best = 0;
    for (const e of edgesAt.get(v) ?? []) {
      if (used.has(e)) continue;
      const [a, b] = geo.edgeVertices[e] as readonly [VertexId, VertexId];
      const next = a === v ? b : a;
      used.add(e);
      const len = 1 + (blocked.has(next) ? 0 : walk(next));
      used.delete(e);
      if (len > best) best = len;
    }
    return best;
  };

  let best = 0;
  for (const v of edgesAt.keys()) {
    const len = walk(v);
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
