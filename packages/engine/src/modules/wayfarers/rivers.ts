/**
 * Wayfarers: Rivers (docs/phase10.md §3).
 *
 * `state.board.rivers` lists the river edges. A road there is a bridge and
 * costs one extra clay. The player with the most river roads (at least 3)
 * holds Bridge Builder (+1 VP) under the Longest Road rules. A building is
 * riverside when one of its vertex's edges is a river: at the end of its
 * owner's turn it earns gold coins (1 per settlement, 2 per city), and the
 * unique player with the fewest coins holds the Poor Settler (-2 VP).
 */

import { boardGeometry } from "../../board";
import type { EdgeId, VertexId } from "../../geometry";
import { emit, hand, variantOn } from "../../state";
import type { GameState, Hand, Player, PlayerId } from "../../types";
import { registerModule } from "../hooks";
import type { RiversState } from "../types";

export const BRIDGE_BUILDER_MIN = 3;
export const BRIDGE_BUILDER_VP = 1;
export const POOR_SETTLER_VP = 2;

/** What a bridge costs on top of a road. */
export function bridgeSurcharge(): Hand {
  return hand({ clay: 1 });
}

function riversOf(state: GameState): RiversState {
  const rivers = state.wayfarers?.rivers;
  if (!rivers) throw new Error("rivers state missing");
  return rivers;
}

export function isRiverEdge(state: GameState, edge: EdgeId): boolean {
  return state.board.rivers.includes(edge);
}

/** A vertex with at least one river edge. */
export function isRiverside(state: GameState, vertex: VertexId): boolean {
  return (boardGeometry(state.board).vertexEdges[vertex] ?? []).some((e) => isRiverEdge(state, e));
}

export function riverRoadCount(state: GameState, player: Player): number {
  return player.roads.filter((e) => isRiverEdge(state, e)).length;
}

/** 1 per riverside settlement, 2 per riverside city. */
export function riversideCoins(state: GameState, player: Player): number {
  let coins = 0;
  for (const v of player.settlements) if (isRiverside(state, v)) coins += 1;
  for (const v of player.cities) if (isRiverside(state, v)) coins += 2;
  return coins;
}

/**
 * Who holds a chip after a change (the Longest Road rule with `min`):
 * nobody, or the holder below `min` → the unique leader at `min` or more;
 * otherwise the holder keeps it unless a unique challenger strictly exceeds.
 */
function chipHolder(counts: ReadonlyMap<PlayerId, number>, holder: PlayerId | null, min: number): PlayerId | null {
  const holderCount = holder === null ? 0 : (counts.get(holder) ?? 0);
  const uniqueMaxAtLeast = (floor: number): PlayerId | null => {
    let best = floor - 1;
    let who: PlayerId | null = null;
    let tied = false;
    for (const [id, n] of counts) {
      if (n > best) {
        best = n;
        who = id;
        tied = false;
      } else if (n === best && n >= floor) {
        tied = true;
      }
    }
    return tied ? null : who;
  };
  if (holder === null || holderCount < min) return uniqueMaxAtLeast(min);
  const anyoneExceeds = [...counts.values()].some((n) => n > holderCount);
  return anyoneExceeds ? uniqueMaxAtLeast(holderCount + 1) : holder;
}

/** Re-evaluate Bridge Builder after a road. */
export function updateBridgeBuilder(state: GameState): void {
  const rivers = riversOf(state);
  const counts = new Map<PlayerId, number>();
  for (const p of state.players) counts.set(p.id, riverRoadCount(state, p));
  const holder = rivers.bridgeBuilder.playerId;
  const next = chipHolder(counts, holder, BRIDGE_BUILDER_MIN);
  rivers.bridgeBuilder = { playerId: next, count: next === null ? 0 : (counts.get(next) ?? 0) };
  if (next !== holder) emit(state, { kind: "chipMoved", chip: "bridgeBuilder", from: holder, to: next });
}

/** Re-evaluate the Poor Settler after coins were awarded: the unique poorest, or nobody on a tie. */
export function updatePoorSettler(state: GameState): void {
  const rivers = riversOf(state);
  let fewest = Infinity;
  let poorest: PlayerId | null = null;
  let tied = false;
  for (const p of state.players) {
    const coins = rivers.coins[p.id] ?? 0;
    if (coins < fewest) {
      fewest = coins;
      poorest = p.id;
      tied = false;
    } else if (coins === fewest) {
      tied = true;
    }
  }
  const next = tied ? null : poorest;
  const holder = rivers.poorSettler;
  if (next === holder) return;
  rivers.poorSettler = next;
  emit(state, { kind: "chipMoved", chip: "poorSettler", from: holder, to: next });
}

registerModule({
  id: "rivers",
  enabled: (state: GameState) => variantOn(state, "rivers"),

  init(state) {
    if (!state.wayfarers) state.wayfarers = { eventDeck: null, fishing: null, rivers: null, harbormaster: null, caravans: null, raiders: null, wagons: null };
    const coins: Record<PlayerId, number> = {};
    for (const p of state.players) coins[p.id] = 0;
    state.wayfarers.rivers = { bridgeBuilder: { playerId: null, count: 0 }, coins, poorSettler: null };
  },

  roadCost(state, edge) {
    return isRiverEdge(state, edge) ? bridgeSurcharge() : null;
  },

  onBuilt(state, playerId, piece, at) {
    if (piece !== "road") return;
    if (isRiverEdge(state, at)) emit(state, { kind: "bridgeBuilt", playerId, edge: at });
    updateBridgeBuilder(state);
  },

  onTurnEnd(state, player) {
    const coins = riversideCoins(state, player);
    if (coins === 0) return;
    const rivers = riversOf(state);
    const total = (rivers.coins[player.id] ?? 0) + coins;
    rivers.coins[player.id] = total;
    emit(state, { kind: "coinsAwarded", playerId: player.id, coins, total });
    updatePoorSettler(state);
  },

  victoryPoints(state, player) {
    const rivers = riversOf(state);
    let publicVP = 0;
    if (rivers.bridgeBuilder.playerId === player.id) publicVP += BRIDGE_BUILDER_VP;
    if (rivers.poorSettler === player.id) publicVP -= POOR_SETTLER_VP;
    return { publicVP, hiddenVP: 0 };
  },
});
