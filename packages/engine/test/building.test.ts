import { describe, expect, it } from "vitest";
import { GEOMETRY } from "../src/geometry";
import { applyAction } from "../src/actions";
import { legalActions, legalRoadEdges, legalSettlementVertices } from "../src/legal";
import { COSTS, getPlayer, hand } from "../src/state";
import { ACTION_PHASE, centerCorner, edgeBetween, expectRule, give, inPhase, newGame, place } from "./helpers";

/** a owns corner 0 of the centre hex with a road towards corner 1; it is a's action phase. */
function base() {
  const v0 = centerCorner(0);
  const v1 = centerCorner(1);
  const v2 = centerCorner(2);
  let state = inPhase(newGame(), ACTION_PHASE, "a");
  state = place(state, "a", { settlements: [v0], roads: [edgeBetween(v0, v1)] });
  return { state, v0, v1, v2 };
}

describe("§5 building", () => {
  it("§5.1 road costs wood + clay and refunds nothing", () => {
    const { state, v1, v2 } = base();
    const edge = edgeBetween(v1, v2);
    expectRule(() => applyAction(state, { type: "BUILD_ROAD", playerId: "a", edge }), "INSUFFICIENT_RESOURCES");
    const rich = give(state, "a", { wood: 1, clay: 1, ore: 1 });
    const after = applyAction(rich, { type: "BUILD_ROAD", playerId: "a", edge });
    expect(getPlayer(after, "a").hand).toEqual(hand({ ore: 1 }));
    expect(after.bank.wood).toBe(rich.bank.wood + 1);
    expect(getPlayer(after, "a").roads).toContain(edge);
    expect(getPlayer(after, "a").pieces.roads).toBe(13);
  });

  it("§5.1 settlement costs wood + clay + wool + grain", () => {
    const { state, v2 } = base();
    // Extend the road to v2 so v2 is connected and at distance 2 from v0.
    const s = place(state, "a", { roads: [edgeBetween(centerCorner(1), v2)] });
    expectRule(() => applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v2 }), "INSUFFICIENT_RESOURCES");
    const after = applyAction(give(s, "a", COSTS.settlement), { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v2 });
    expect(getPlayer(after, "a").hand).toEqual(hand({}));
    expect(getPlayer(after, "a").settlements).toContain(v2);
    expect(getPlayer(after, "a").pieces.settlements).toBe(3);
  });

  it("§5.1 §5.4 city costs 2 grain + 3 ore and returns the settlement piece", () => {
    const { state, v0 } = base();
    expectRule(() => applyAction(state, { type: "BUILD_CITY", playerId: "a", vertex: v0 }), "INSUFFICIENT_RESOURCES");
    const after = applyAction(give(state, "a", { grain: 2, ore: 3 }), { type: "BUILD_CITY", playerId: "a", vertex: v0 });
    const a = getPlayer(after, "a");
    expect(a.hand).toEqual(hand({}));
    expect(a.settlements).toEqual([]);
    expect(a.cities).toEqual([v0]);
    expect(a.pieces).toEqual({ roads: 14, settlements: 5, cities: 3 });
  });

  it("§5.1 development card costs ore + wool + grain", () => {
    const { state } = base();
    expectRule(() => applyAction(state, { type: "BUY_DEV_CARD", playerId: "a" }), "INSUFFICIENT_RESOURCES");
    const after = applyAction(give(state, "a", COSTS.devCard), { type: "BUY_DEV_CARD", playerId: "a" });
    expect(getPlayer(after, "a").hand).toEqual(hand({}));
    expect(getPlayer(after, "a").devCards).toHaveLength(1);
    expect(after.devDeck).toHaveLength(24);
  });

  it("§5.2 road must connect to own road or building, not through an opponent's building", () => {
    const { state, v1, v2 } = base();
    const s = give(state, "a", { wood: 5, clay: 5 });
    // Far edge: not connected.
    const far = GEOMETRY.edges.find((e) => !legalRoadEdges(s, "a").includes(e) && GEOMETRY.edgeVertices[e]!.every((v) => v !== v1))!;
    expectRule(() => applyAction(s, { type: "BUILD_ROAD", playerId: "a", edge: far }), "ROAD_NOT_CONNECTED");
    // Connected via the road end at v1.
    const next = edgeBetween(v1, v2);
    expect(legalRoadEdges(s, "a")).toContain(next);
    // Opponent settlement at v1 blocks extension beyond it.
    const blocked = place(s, "b", { settlements: [v1] });
    expect(legalRoadEdges(blocked, "a")).not.toContain(next);
    expectRule(() => applyAction(blocked, { type: "BUILD_ROAD", playerId: "a", edge: next }), "ROAD_NOT_CONNECTED");
    // But a road touching a's own settlement is fine even with no road there.
    const v5 = centerCorner(5);
    const fromSettlement = edgeBetween(centerCorner(0), v5);
    expect(legalRoadEdges(blocked, "a")).toContain(fromSettlement);
    const ok = applyAction(blocked, { type: "BUILD_ROAD", playerId: "a", edge: fromSettlement });
    expect(getPlayer(ok, "a").roads).toContain(fromSettlement);
    // Occupied edge.
    expectRule(() => applyAction(ok, { type: "BUILD_ROAD", playerId: "a", edge: fromSettlement }), "EDGE_OCCUPIED");
    expectRule(() => applyAction(ok, { type: "BUILD_ROAD", playerId: "a", edge: "3,0|4,0" }), "INVALID_EDGE");
  });

  it("§5.3 settlement needs a road connection and the distance rule", () => {
    const { state, v1, v2 } = base();
    const s = give(state, "a", COSTS.settlement);
    // v1 is adjacent to a's own settlement at v0: distance rule.
    expectRule(() => applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v1 }), "DISTANCE_RULE");
    // v2 satisfies distance but a has no road touching it.
    expectRule(() => applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v2 }), "NOT_CONNECTED_TO_ROAD");
    expect(legalSettlementVertices(s, "a")).toEqual([]);
    const connected = place(s, "a", { roads: [edgeBetween(v1, v2)] });
    expect(legalSettlementVertices(connected, "a")).toEqual([v2]);
    // Opponent settlement next to v2 breaks the distance rule.
    const v3 = centerCorner(3);
    const crowded = place(connected, "b", { settlements: [v3] });
    expectRule(() => applyAction(crowded, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v2 }), "DISTANCE_RULE");
    expectRule(() => applyAction(crowded, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v3 }), "VERTEX_OCCUPIED");
    expectRule(() => applyAction(crowded, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: "nope" }), "INVALID_VERTEX");
  });

  it("§5.4 a city must replace one of your own settlements", () => {
    const { state, v0, v2 } = base();
    const s = give(place(state, "b", { settlements: [v2] }), "a", { grain: 2, ore: 3 });
    expectRule(() => applyAction(s, { type: "BUILD_CITY", playerId: "a", vertex: v2 }), "NOT_YOUR_SETTLEMENT");
    const upgraded = applyAction(s, { type: "BUILD_CITY", playerId: "a", vertex: v0 });
    expectRule(() => applyAction(give(upgraded, "a", { grain: 2, ore: 3 }), { type: "BUILD_CITY", playerId: "a", vertex: v0 }), "NOT_YOUR_SETTLEMENT");
  });

  it("§5.5 building is refused when the supply of that piece is exhausted", () => {
    const { state, v0, v1, v2 } = base();
    const rich = give(state, "a", { wood: 5, clay: 5, wool: 5, grain: 5, ore: 5 });
    const noRoads = place(rich, "a", { roads: [] });
    noRoads.players[0]!.pieces.roads = 0;
    expectRule(() => applyAction(noRoads, { type: "BUILD_ROAD", playerId: "a", edge: edgeBetween(v1, v2) }), "NO_PIECES_LEFT");
    expect(legalActions(noRoads, "a").some((a) => a.type === "BUILD_ROAD")).toBe(false);

    const noSettlements = place(rich, "a", { roads: [edgeBetween(v1, v2)] });
    noSettlements.players[0]!.pieces.settlements = 0;
    expectRule(() => applyAction(noSettlements, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v2 }), "NO_PIECES_LEFT");

    const noCities = place(rich, "a", {});
    noCities.players[0]!.pieces.cities = 0;
    expectRule(() => applyAction(noCities, { type: "BUILD_CITY", playerId: "a", vertex: v0 }), "NO_PIECES_LEFT");
    expect(legalActions(noCities, "a").some((a) => a.type === "BUILD_CITY")).toBe(false);
  });

  it("§5.1 building is only allowed in the action phase on your own turn", () => {
    const { state, v1, v2 } = base();
    const rich = give(state, "a", { wood: 5, clay: 5, wool: 5, grain: 5, ore: 5 });
    const edge = edgeBetween(v1, v2);
    expectRule(() => applyAction(inPhase(rich, { kind: "roll" }), { type: "BUILD_ROAD", playerId: "a", edge }), "WRONG_PHASE");
    expectRule(() => applyAction(inPhase(rich, ACTION_PHASE, "b"), { type: "BUILD_ROAD", playerId: "a", edge }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(inPhase(rich, { kind: "moveRobber", via: "seven", returnTo: "action" }), { type: "BUY_DEV_CARD", playerId: "a" }), "WRONG_PHASE");
  });
});
