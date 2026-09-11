import { describe, expect, it } from "vitest";
import { GEOMETRY, type VertexId } from "../src/geometry";
import { applyAction } from "../src/actions";
import { legalActions } from "../src/legal";
import { getPlayer, victoryPoints } from "../src/state";
import type { GameState } from "../src/types";
import { ACTION_PHASE, centerCorner, edgeBetween, expectRule, give, inPhase, mut, newGame, pathEdges, place, vertexPath } from "./helpers";

/** Greedily pick `n` vertices that are pairwise non-adjacent and away from `avoid`. */
function pickSpread(n: number, avoid: VertexId[]): VertexId[] {
  const chosen: VertexId[] = [];
  const banned = new Set<VertexId>(avoid);
  for (const v of avoid) for (const x of GEOMETRY.vertexNeighbors[v]!) banned.add(x);
  for (const v of GEOMETRY.vertices) {
    if (chosen.length === n) break;
    if (banned.has(v)) continue;
    chosen.push(v);
    banned.add(v);
    for (const x of GEOMETRY.vertexNeighbors[v]!) banned.add(x);
  }
  if (chosen.length < n) throw new Error("not enough room");
  return chosen;
}

/** a at 9 VP (3 cities + 3 settlements) with a road ending at `target`, a free legal spot. */
function nineVP(): { state: GameState; target: VertexId } {
  const target = centerCorner(1);
  const anchor = centerCorner(0);
  const spots = pickSpread(6, [target, anchor]);
  const state = place(inPhase(newGame(), ACTION_PHASE, "a"), "a", {
    cities: spots.slice(0, 3),
    settlements: spots.slice(3),
    roads: [edgeBetween(anchor, target)],
  });
  expect(victoryPoints(state, getPlayer(state, "a")).total).toBe(9);
  return { state, target };
}

/** b at exactly 10 VP (3 cities, 2 settlements, Longest Road) while it is a's turn; a has a settlement and cards for a road. */
function tenOnOpponentsTurn(): { state: GameState; aVertex: VertexId } {
  const path = vertexPath("2,-2|2,-1|3,-2", 5);
  const spots = pickSpread(6, path);
  const aVertex = spots[5]!;
  let s = inPhase(newGame(), ACTION_PHASE, "a");
  s = place(s, "b", { cities: spots.slice(0, 3), settlements: spots.slice(3, 5), roads: pathEdges(path) });
  s = place(s, "a", { settlements: [aVertex] });
  s = give(s, "a", { wood: 1, clay: 1 });
  expect(s.longestRoad.playerId).toBe("b");
  expect(victoryPoints(s, getPlayer(s, "b")).total).toBe(10);
  return { state: s, aVertex };
}

describe("§11 winning", () => {
  it("§11 reaching exactly 10 VP on your own turn ends the game immediately", () => {
    const { state, target } = nineVP();
    const s = give(state, "a", { wood: 1, clay: 1, wool: 1, grain: 1 });
    const after = applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: target });
    expect(victoryPoints(after, getPlayer(after, "a")).total).toBe(10);
    expect(after.phase).toEqual({ kind: "ended" });
    expect(after.winner).toBe("a");
    expect(after.log.at(-1)!.text).toContain("wins");
    expect(legalActions(after, "a")).toEqual([]);
    expectRule(() => applyAction(after, { type: "END_TURN", playerId: "a" }), "GAME_OVER");
  });

  it("§11 hidden victory point cards count towards the win", () => {
    const { state } = nineVP();
    const s = give(state, "a", { ore: 1, wool: 1, grain: 1 });
    const vpOnTop = mut(s, (x) => void (x.devDeck = ["victoryPoint", ...x.devDeck.filter((c) => c !== "victoryPoint")]));
    const after = applyAction(vpOnTop, { type: "BUY_DEV_CARD", playerId: "a" });
    expect(after.phase).toEqual({ kind: "ended" });
    expect(after.winner).toBe("a");
    expect(victoryPoints(after, getPlayer(after, "a"))).toEqual({ publicVP: 9, hiddenVP: 1, total: 10 });
  });

  it("§11 the win check runs for the current player only; a player at 10 wins when their turn comes", () => {
    const { state, aVertex } = tenOnOpponentsTurn();
    const edge = GEOMETRY.vertexEdges[aVertex]![0]!;
    const stillGoing = applyAction(state, { type: "BUILD_ROAD", playerId: "a", edge });
    expect(stillGoing.phase).toEqual({ kind: "action" });
    expect(stillGoing.winner).toBeNull();
    const bTurn = applyAction(stillGoing, { type: "END_TURN", playerId: "a" });
    expect(bTurn.currentPlayer).toBe(1);
    expect(bTurn.winner).toBe("b");
    expect(bTurn.phase).toEqual({ kind: "ended" });
  });

  it("§11 §10.1 losing Longest Road on an opponent's turn can drop a player back below 10", () => {
    const { state } = tenOnOpponentsTurn();
    // a cuts b's road with a settlement in the middle of it (test-only direct placement).
    const path = vertexPath("2,-2|2,-1|3,-2", 5);
    const cut = place(state, "a", { settlements: [path[2]!] });
    expect(cut.longestRoad.playerId).toBeNull();
    expect(victoryPoints(cut, getPlayer(cut, "b")).total).toBe(8);
    const bTurn = applyAction(cut, { type: "END_TURN", playerId: "a" });
    expect(bTurn.winner).toBeNull();
  });
});
