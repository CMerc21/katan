import { describe, expect, it } from "vitest";
import { GEOMETRY } from "../src/geometry";
import { applyAction } from "../src/actions";
import { longestRoadLength, updateLargestArmy, updateLongestRoad } from "../src/specialCards";
import { getPlayer, victoryPoints } from "../src/state";
import { ACTION_PHASE, around, centerCorner, clearStart, edgeBetween, give, inPhase, mut, newGame, pathEdges, place, vertexPath } from "./helpers";

const start = centerCorner(0);

describe("§10.1 Longest Road", () => {
  it("§10.1 a straight line of 5 roads takes the card; fewer does not", () => {
    const path = vertexPath(start, 5);
    const edges = pathEdges(path);
    let s = place(inPhase(newGame(), ACTION_PHASE, "a"), "a", { settlements: [start], roads: edges.slice(0, 4) });
    expect(longestRoadLength(s, "a")).toBe(4);
    expect(s.longestRoad).toEqual({ playerId: null, length: 0 });
    s = place(s, "a", { roads: [edges[4]!] });
    expect(longestRoadLength(s, "a")).toBe(5);
    expect(s.longestRoad).toEqual({ playerId: "a", length: 5 });
    expect(victoryPoints(s, getPlayer(s, "a")).publicVP).toBe(3);
  });

  it("§10.1 a fork counts only its longest branch", () => {
    const path = vertexPath(start, 4);
    const edges = pathEdges(path);
    const forkFrom = path[2]!;
    const side = GEOMETRY.vertexNeighbors[forkFrom]!.find((v) => !path.includes(v))!;
    const s = place(newGame(), "a", { roads: [...edges, edgeBetween(forkFrom, side)] });
    // 4 in a line plus a 1-edge spur off the middle: best trail is 2 + 1 (spur) + ... = max(4, 3) = 4
    expect(longestRoadLength(s, "a")).toBe(4);
  });

  it("§10.1 a loop around a hex counts all six edges", () => {
    const loop = GEOMETRY.hexEdges["0,0"]!;
    const s = place(newGame(), "a", { roads: [...loop] });
    expect(longestRoadLength(s, "a")).toBe(6);
    expect(s.longestRoad).toEqual({ playerId: "a", length: 6 });
    // A loop plus a tail: the trail may reuse the vertex but not the edge.
    const v = centerCorner(0);
    const tail = GEOMETRY.vertexEdges[v]!.find((e) => !loop.includes(e))!;
    const s2 = place(newGame(), "a", { roads: [...loop, tail] });
    expect(longestRoadLength(s2, "a")).toBe(7);
  });

  it("§10.1 an opponent's settlement breaks the road at that vertex", () => {
    const path = vertexPath(start, 6);
    const edges = pathEdges(path);
    let s = place(newGame(), "a", { roads: edges });
    expect(longestRoadLength(s, "a")).toBe(6);
    s = place(s, "b", { settlements: [path[3]!] });
    expect(longestRoadLength(s, "a")).toBe(3);
    // Own settlement does not break it.
    const own = place(place(newGame(), "a", { roads: edges }), "a", { settlements: [path[3]!] });
    expect(longestRoadLength(own, "a")).toBe(6);
  });

  it("§10.1 a tie never transfers the card; strictly longer does", () => {
    const pathA = vertexPath(start, 5);
    const avoidA = around(pathA);
    const pathB = vertexPath(clearStart(6, avoidA), 6, avoidA);
    const edgesA = pathEdges(pathA);
    const edgesB = pathEdges(pathB);
    let s = place(newGame(), "a", { roads: edgesA });
    expect(s.longestRoad.playerId).toBe("a");
    s = place(s, "b", { roads: edgesB.slice(0, 5) });
    expect(longestRoadLength(s, "b")).toBe(5);
    expect(s.longestRoad).toEqual({ playerId: "a", length: 5 });
    s = place(s, "b", { roads: [edgesB[5]!] });
    expect(s.longestRoad).toEqual({ playerId: "b", length: 6 });
  });

  it("§10.1 the card returns to the supply when the holder drops below 5 and nobody else qualifies", () => {
    const path = vertexPath(start, 5);
    let s = place(newGame(), "a", { roads: pathEdges(path) });
    expect(s.longestRoad.playerId).toBe("a");
    s = place(s, "b", { settlements: [path[2]!] });
    expect(longestRoadLength(s, "a")).toBe(3);
    expect(s.longestRoad).toEqual({ playerId: null, length: 0 });
  });

  it("§10.1 when the holder is cut, a unique other player with 5+ takes the card; a tie leaves it unclaimed", () => {
    const pathA = vertexPath(start, 6);
    const avoidA = around(pathA);
    const pathB = vertexPath(clearStart(5, avoidA), 5, avoidA);
    const avoidAB = around([...pathA, ...pathB]);
    const pathC = vertexPath(clearStart(5, avoidAB), 5, avoidAB);
    let s = place(newGame(), "a", { roads: pathEdges(pathA) });
    s = place(s, "b", { roads: pathEdges(pathB) });
    expect(s.longestRoad).toEqual({ playerId: "a", length: 6 });
    // d's settlement cuts a's road to 3: b is the unique qualifier.
    const cut = place(s, "d", { settlements: [pathA[3]!] });
    expect(longestRoadLength(cut, "a")).toBe(3);
    expect(cut.longestRoad).toEqual({ playerId: "b", length: 5 });
    // With c also at 5 before the cut, the holder keeps it; after the cut it is a tie: unclaimed.
    let tied = place(s, "c", { roads: pathEdges(pathC) });
    expect(tied.longestRoad).toEqual({ playerId: "a", length: 6 });
    tied = place(tied, "d", { settlements: [pathA[3]!] });
    expect(longestRoadLength(tied, "b")).toBe(5);
    expect(longestRoadLength(tied, "c")).toBe(5);
    expect(tied.longestRoad).toEqual({ playerId: null, length: 0 });
  });

  it("§10.1 two players exceeding the holder while tying each other leaves the card unclaimed", () => {
    const pathA = vertexPath(start, 5);
    const avoidA = around(pathA);
    const pathB = vertexPath(clearStart(6, avoidA), 6, avoidA);
    const avoidAB = around([...pathA, ...pathB]);
    const pathC = vertexPath(clearStart(6, avoidAB), 6, avoidAB);
    const edgesB = pathEdges(pathB);
    const edgesC = pathEdges(pathC);
    let s = place(newGame(), "a", { roads: pathEdges(pathA) });
    s = place(s, "b", { roads: edgesB.slice(0, 5) });
    s = place(s, "c", { roads: edgesC.slice(0, 5) });
    expect(s.longestRoad).toEqual({ playerId: "a", length: 5 });
    // A settlement cut of a's road to 4 would hand it over, but here a keeps 5 while b and c both jump to 6.
    s = mut(s, (x) => {
      x.players[1]!.roads.push(edgesB[5]!);
      x.players[2]!.roads.push(edgesC[5]!);
      updateLongestRoad(x);
    });
    expect(longestRoadLength(s, "b")).toBe(6);
    expect(longestRoadLength(s, "c")).toBe(6);
    expect(s.longestRoad).toEqual({ playerId: null, length: 0 });
  });

  it("§10.1 building a road through applyAction updates the card", () => {
    const path = vertexPath(start, 5);
    const edges = pathEdges(path);
    let s = place(inPhase(newGame(), ACTION_PHASE, "a"), "a", { settlements: [start], roads: edges.slice(0, 4) });
    s = give(s, "a", { wood: 1, clay: 1 });
    const after = applyAction(s, { type: "BUILD_ROAD", playerId: "a", edge: edges[4]! });
    expect(after.longestRoad).toEqual({ playerId: "a", length: 5 });
    expect(victoryPoints(after, getPlayer(after, "a")).total).toBe(3);
  });

  it("§10.1 updateLongestRoad is idempotent on an empty board", () => {
    const s = mut(newGame(), (x) => updateLongestRoad(x));
    expect(s.longestRoad).toEqual({ playerId: null, length: 0 });
  });
});

describe("§10.2 Largest Army", () => {
  it("§10.2 the first player to three knights takes the card; ties do not transfer; more does", () => {
    let s = newGame();
    const setKnights = (id: string, n: number) =>
      mut(s, (x) => {
        x.players.find((p) => p.id === id)!.playedKnights = n;
        updateLargestArmy(x);
      });
    s = setKnights("a", 2);
    expect(s.largestArmy).toEqual({ playerId: null, count: 0 });
    s = setKnights("a", 3);
    expect(s.largestArmy).toEqual({ playerId: "a", count: 3 });
    expect(victoryPoints(s, getPlayer(s, "a")).publicVP).toBe(2);
    s = setKnights("b", 3);
    expect(s.largestArmy).toEqual({ playerId: "a", count: 3 });
    s = setKnights("b", 4);
    expect(s.largestArmy).toEqual({ playerId: "b", count: 4 });
    expect(victoryPoints(s, getPlayer(s, "a")).publicVP).toBe(0);
  });

  it("§10.2 playing the third knight through applyAction awards the card immediately", () => {
    let s = inPhase(newGame(), ACTION_PHASE, "a");
    s = mut(s, (x) => {
      x.turn = 3;
      x.players[0]!.playedKnights = 2;
      x.players[0]!.devCards = [{ type: "knight", boughtOnTurn: 1 }];
    });
    const after = applyAction(s, { type: "PLAY_KNIGHT", playerId: "a" });
    expect(after.largestArmy).toEqual({ playerId: "a", count: 3 });
  });
});
