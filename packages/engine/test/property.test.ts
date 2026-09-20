import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RESOURCES } from "../src/board";
import { GEOMETRY, type EdgeId, type VertexId } from "../src/geometry";
import { buildingsMap } from "../src/state";
import { longestRoadLength } from "../src/specialCards";
import { BANK_PER_RESOURCE, type Action, type GameState } from "../src/types";
import { playRandomGame } from "./helpers";

/** Independent brute force: enumerate trails via BFS over (vertex, used-edge bitmask). */
function bruteForceLongestRoad(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId)!;
  const roads = player.roads;
  if (roads.length === 0) return 0;
  const buildings = buildingsMap(state);
  const blocked = (v: VertexId): boolean => {
    const b = buildings.get(v);
    return b !== undefined && b.owner !== playerId;
  };
  const index = new Map<EdgeId, number>(roads.map((e, i) => [e, i]));
  let best = 0;
  const starts = new Set<VertexId>();
  for (const e of roads) for (const v of GEOMETRY.edgeVertices[e]!) starts.add(v);
  for (const start of starts) {
    const queue: [VertexId, number, number][] = [[start, 0, 0]];
    while (queue.length) {
      const [v, mask, len] = queue.pop()!;
      if (len > best) best = len;
      if (len > 0 && blocked(v)) continue;
      for (const e of GEOMETRY.vertexEdges[v]!) {
        const i = index.get(e);
        if (i === undefined || mask & (1 << i)) continue;
        const [x, y] = GEOMETRY.edgeVertices[e]!;
        queue.push([x === v ? y : x, mask | (1 << i), len + 1]);
      }
    }
  }
  return best;
}

function assertEq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) throw new Error(`invariant: ${what} expected ${String(expected)} got ${String(actual)}`);
}

/** Cheap invariant checks (no vitest `expect`: this runs hundreds of thousands of times). */
export function checkInvariants(state: GameState, action?: Action): void {
  const roadsChanged = action === undefined || action.type === "BUILD_ROAD" || action.type === "BUILD_SETTLEMENT" || action.type === "UNDO_BUILD";

  // Conservation: bank + hands = 95, nothing negative.
  let total = 0;
  for (const r of RESOURCES) {
    let n = state.bank[r];
    if (n < 0) throw new Error(`invariant: bank ${r} negative`);
    for (const p of state.players) {
      if (p.hand[r] < 0) throw new Error(`invariant: ${p.id} ${r} negative`);
      n += p.hand[r];
    }
    assertEq(n, BANK_PER_RESOURCE, `total ${r}`);
    total += n;
  }
  assertEq(total, 95, "total cards");

  // Piece supplies.
  for (const p of state.players) {
    assertEq(p.roads.length + p.pieces.roads, 15, `${p.id} roads`);
    assertEq(p.settlements.length + p.pieces.settlements, 5, `${p.id} settlements`);
    assertEq(p.cities.length + p.pieces.cities, 4, `${p.id} cities`);
  }

  // Dev cards: deck + held + played knights <= 25 (non-knight plays leave the game).
  const played = state.players.reduce((n, p) => n + p.playedKnights, 0);
  const held = state.players.reduce((n, p) => n + p.devCards.length, 0);
  if (state.devDeck.length + held + played > 25) throw new Error("invariant: too many dev cards");

  // Distance rule and no double occupancy.
  const buildings = buildingsMap(state);
  const occupied = state.players.flatMap((p) => [...p.settlements, ...p.cities]);
  assertEq(new Set(occupied).size, occupied.length, "distinct buildings");
  for (const v of buildings.keys()) {
    for (const n of GEOMETRY.vertexNeighbors[v]!) {
      if (buildings.has(n)) throw new Error(`invariant: distance rule broken at ${v}`);
    }
  }
  const roads = state.players.flatMap((p) => p.roads);
  assertEq(new Set(roads).size, roads.length, "distinct roads");

  // Longest road bookkeeping matches brute force (re-checked when roads can change).
  if (roadsChanged) {
    for (const p of state.players) {
      assertEq(longestRoadLength(state, p.id), bruteForceLongestRoad(state, p.id), `${p.id} longest road`);
    }
  }
  if (state.longestRoad.playerId !== null) {
    assertEq(state.longestRoad.length, longestRoadLength(state, state.longestRoad.playerId), "longestRoad.length");
    if (state.longestRoad.length < 5) throw new Error("invariant: longest road holder below 5");
  }
  if (state.largestArmy.playerId !== null) {
    const holder = state.players.find((p) => p.id === state.largestArmy.playerId)!;
    assertEq(holder.playedKnights, state.largestArmy.count, "largestArmy.count");
    if (holder.playedKnights < 3) throw new Error("invariant: largest army holder below 3");
  }

  // Phase/turn sanity.
  if (state.phase.kind === "ended" && state.winner === null) throw new Error("invariant: ended without winner");
  if (state.phase.kind !== "ended" && state.winner !== null) throw new Error("invariant: winner while playing");
}

describe("§12 property-based random play", () => {
  it("200 random legal-action games end within 600 turns with all invariants intact", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => {
        const game = playRandomGame(`prop-${n}`, { onStep: checkInvariants });
        expect(game.final.phase.kind).toBe("ended");
        expect(game.final.winner).not.toBeNull();
        expect(game.turnsPlayed).toBeLessThan(600);
      }),
      { numRuns: 200, seed: 42 },
    );
  }, 60_000);
});
