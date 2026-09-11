import { describe, expect, it } from "vitest";
import { GEOMETRY } from "../src/geometry";
import { applyAction } from "../src/actions";
import { legalActions, legalRoadEdges } from "../src/legal";
import { redact } from "../src/redact";
import { getPlayer, hand } from "../src/state";
import type { DevCardType, GameState } from "../src/types";
import { ACTION_PHASE, ROLL_PHASE, centerCorner, edgeBetween, expectRule, give, hexWith, inPhase, mut, newGame, place } from "./helpers";

/** a in the action phase on turn 5 holding the given cards (bought on turn 1 unless stated). */
function withCards(cards: { type: DevCardType; boughtOnTurn?: number }[], phase = ACTION_PHASE): GameState {
  let state = inPhase(newGame(), phase, "a");
  state = mut(state, (s) => {
    s.turn = 5;
    s.players[0]!.devCards = cards.map((c) => ({ type: c.type, boughtOnTurn: c.boughtOnTurn ?? 1 }));
  });
  const v0 = centerCorner(0);
  return place(state, "a", { settlements: [v0], roads: [edgeBetween(v0, centerCorner(1))] });
}

describe("§8 development cards", () => {
  it("§8.1 buying takes the top card of the seeded deck; an empty deck refuses", () => {
    const s = give(inPhase(newGame(), ACTION_PHASE, "a"), "a", { ore: 2, wool: 2, grain: 2 });
    const top = s.devDeck[0]!;
    const after = applyAction(s, { type: "BUY_DEV_CARD", playerId: "a" });
    expect(getPlayer(after, "a").devCards).toEqual([{ type: top, boughtOnTurn: 0 }]);
    expect(after.devDeck).toEqual(s.devDeck.slice(1));
    const empty = mut(s, (x) => void (x.devDeck = []));
    expectRule(() => applyAction(empty, { type: "BUY_DEV_CARD", playerId: "a" }), "DECK_EMPTY");
    expect(legalActions(empty, "a").some((a) => a.type === "BUY_DEV_CARD")).toBe(false);
  });

  it("§8.2 only one development card per turn", () => {
    const s = withCards([{ type: "monopoly" }, { type: "monopoly" }]);
    const once = applyAction(s, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" });
    expect(getPlayer(once, "a").devCardPlayedThisTurn).toBe(true);
    expectRule(() => applyAction(once, { type: "PLAY_MONOPOLY", playerId: "a", resource: "ore" }), "DEV_CARD_ALREADY_PLAYED");
    expect(legalActions(once, "a").some((a) => a.type === "PLAY_MONOPOLY")).toBe(false);
    // Next turn it is allowed again.
    const nextTurn = mut(once, (x) => {
      x.players[0]!.devCardPlayedThisTurn = false;
      x.turn += 1;
    });
    expect(() => applyAction(nextTurn, { type: "PLAY_MONOPOLY", playerId: "a", resource: "ore" })).not.toThrow();
  });

  it("§8.2 a card cannot be played on the turn it was bought; other copies can", () => {
    const fresh = withCards([{ type: "monopoly", boughtOnTurn: 5 }]);
    expectRule(() => applyAction(fresh, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" }), "CARD_TOO_NEW");
    expect(legalActions(fresh, "a").some((a) => a.type === "PLAY_MONOPOLY")).toBe(false);
    const none = withCards([]);
    expectRule(() => applyAction(none, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" }), "NO_SUCH_CARD");
    const mixed = withCards([{ type: "monopoly", boughtOnTurn: 5 }, { type: "monopoly", boughtOnTurn: 2 }]);
    const after = applyAction(mixed, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" });
    expect(getPlayer(after, "a").devCards).toEqual([{ type: "monopoly", boughtOnTurn: 5 }]);
  });

  it("§8.2 §8.3 a knight may be played before rolling and returns to the roll phase", () => {
    const s = withCards([{ type: "knight" }], ROLL_PHASE);
    expect(legalActions(s, "a").map((a) => a.type)).toEqual(["ROLL", "PLAY_KNIGHT"]);
    const played = applyAction(s, { type: "PLAY_KNIGHT", playerId: "a" });
    expect(played.phase).toEqual({ kind: "moveRobber", via: "knight", returnTo: "roll" });
    expect(getPlayer(played, "a").playedKnights).toBe(1);
    expect(getPlayer(played, "a").devCards).toEqual([]);
    const hex = hexWith(played, "forest");
    const moved = applyAction(played, { type: "MOVE_ROBBER", playerId: "a", hex });
    expect(moved.phase).toEqual({ kind: "roll" });
    expect(moved.robberHex).toBe(hex);
  });

  it("§8.3 a knight after rolling steals like a seven and returns to the action phase", () => {
    let s = withCards([{ type: "knight" }]);
    const hex = hexWith(s, "forest");
    const victimVertex = GEOMETRY.hexVertices[hex]![0]!;
    s = give(place(s, "b", { settlements: [victimVertex] }), "b", { grain: 1 });
    const played = applyAction(s, { type: "PLAY_KNIGHT", playerId: "a" });
    expect(played.phase).toEqual({ kind: "moveRobber", via: "knight", returnTo: "action" });
    const moved = applyAction(played, { type: "MOVE_ROBBER", playerId: "a", hex });
    expect(moved.phase).toEqual({ kind: "steal", hex, targets: ["b"], returnTo: "action" });
    const stolen = applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "b" });
    expect(getPlayer(stolen, "a").hand.grain).toBe(1);
    expect(stolen.phase).toEqual({ kind: "action" });
  });

  it("§8.3 other cards may only be played after rolling", () => {
    const s = withCards([{ type: "monopoly" }, { type: "invention" }, { type: "roadBuilding" }], ROLL_PHASE);
    expectRule(() => applyAction(s, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" }), "WRONG_PHASE");
    expectRule(() => applyAction(s, { type: "PLAY_INVENTION", playerId: "a", resources: ["wood", "ore"] }), "WRONG_PHASE");
    expectRule(() => applyAction(s, { type: "PLAY_ROAD_BUILDING", playerId: "a" }), "WRONG_PHASE");
  });

  it("§8.3 road building places two free roads following §5.2", () => {
    const s = withCards([{ type: "roadBuilding" }]);
    const played = applyAction(s, { type: "PLAY_ROAD_BUILDING", playerId: "a" });
    expect(played.phase).toEqual({ kind: "roadBuilding", remaining: 2 });
    const legal = legalActions(played, "a");
    expect(legal.every((a) => a.type === "BUILD_ROAD")).toBe(true);
    expect(legal.map((a) => (a.type === "BUILD_ROAD" ? a.edge : ""))).toEqual(legalRoadEdges(played, "a"));
    expectRule(() => applyAction(played, { type: "END_TURN", playerId: "a" }), "WRONG_PHASE");
    const far = GEOMETRY.edges.find((e) => !legalRoadEdges(played, "a").includes(e))!;
    expectRule(() => applyAction(played, { type: "BUILD_ROAD", playerId: "a", edge: far }), "ROAD_NOT_CONNECTED");

    const e1 = edgeBetween(centerCorner(1), centerCorner(2));
    const one = applyAction(played, { type: "BUILD_ROAD", playerId: "a", edge: e1 });
    expect(one.phase).toEqual({ kind: "roadBuilding", remaining: 1 });
    expect(one.bank).toEqual(played.bank); // free
    const e2 = edgeBetween(centerCorner(2), centerCorner(3));
    const two = applyAction(one, { type: "BUILD_ROAD", playerId: "a", edge: e2 });
    expect(two.phase).toEqual({ kind: "action" });
    expect(getPlayer(two, "a").roads).toContain(e2);
    expect(getPlayer(two, "a").pieces.roads).toBe(12);
  });

  it("§8.3 road building with one road left places one; with none it is refused", () => {
    const oneLeft = mut(withCards([{ type: "roadBuilding" }]), (x) => void (x.players[0]!.pieces.roads = 1));
    const played = applyAction(oneLeft, { type: "PLAY_ROAD_BUILDING", playerId: "a" });
    expect(played.phase).toEqual({ kind: "roadBuilding", remaining: 1 });
    const done = applyAction(played, { type: "BUILD_ROAD", playerId: "a", edge: legalRoadEdges(played, "a")[0]! });
    expect(done.phase).toEqual({ kind: "action" });
    expect(getPlayer(done, "a").pieces.roads).toBe(0);

    const noneLeft = mut(withCards([{ type: "roadBuilding" }]), (x) => void (x.players[0]!.pieces.roads = 0));
    expectRule(() => applyAction(noneLeft, { type: "PLAY_ROAD_BUILDING", playerId: "a" }), "NO_PIECES_LEFT");
    expect(legalActions(noneLeft, "a").some((a) => a.type === "PLAY_ROAD_BUILDING")).toBe(false);
    expect(getPlayer(noneLeft, "a").devCards).toHaveLength(1); // card not consumed
  });

  it("§8.3 road building ends early when the second road has nowhere legal to go", () => {
    // a: settlement v0, road v0-v1. b sits on v1, d sits on v5, c owns v0's outward edge.
    // a's only legal edge is v0-v5; once built, nothing further is reachable.
    const v0 = centerCorner(0);
    const v1 = centerCorner(1);
    const v5 = centerCorner(5);
    let s = withCards([{ type: "roadBuilding" }]);
    s = place(s, "b", { settlements: [v1] });
    s = place(s, "d", { settlements: [v5] });
    const outward = GEOMETRY.vertexEdges[v0]!.find((e) => e !== edgeBetween(v0, v1) && e !== edgeBetween(v0, v5))!;
    s = place(s, "c", { roads: [outward] });
    expect(legalRoadEdges(s, "a")).toEqual([edgeBetween(v0, v5)]);
    const played = applyAction(s, { type: "PLAY_ROAD_BUILDING", playerId: "a" });
    expect(played.phase).toEqual({ kind: "roadBuilding", remaining: 2 });
    const one = applyAction(played, { type: "BUILD_ROAD", playerId: "a", edge: edgeBetween(v0, v5) });
    expect(legalRoadEdges(one, "a")).toEqual([]);
    expect(one.phase).toEqual({ kind: "action" });
  });

  it("§8.3 invention takes two resources from the bank; a short bank rejects the whole action", () => {
    const s = withCards([{ type: "invention" }]);
    const after = applyAction(s, { type: "PLAY_INVENTION", playerId: "a", resources: ["ore", "ore"] });
    expect(getPlayer(after, "a").hand.ore).toBe(2);
    expect(after.bank.ore).toBe(s.bank.ore - 2);
    const short = mut(s, (x) => void (x.bank.ore = 1));
    expectRule(() => applyAction(short, { type: "PLAY_INVENTION", playerId: "a", resources: ["ore", "ore"] }), "BANK_EMPTY");
    expect(getPlayer(short, "a").devCards).toHaveLength(1);
    expect(legalActions(short, "a").filter((a) => a.type === "PLAY_INVENTION")).toHaveLength(14);
    expectRule(() => applyAction(s, { type: "PLAY_INVENTION", playerId: "a", resources: ["gold", "ore"] as never }), "INVALID_TRADE");
  });

  it("§8.3 monopoly takes every card of the named resource from all other players", () => {
    let s = withCards([{ type: "monopoly" }]);
    s = give(give(give(s, "b", { wood: 3, ore: 1 }), "c", { wood: 2 }), "a", { wood: 1 });
    const after = applyAction(s, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" });
    expect(getPlayer(after, "a").hand.wood).toBe(6);
    expect(getPlayer(after, "b").hand).toEqual(hand({ ore: 1 }));
    expect(getPlayer(after, "c").hand).toEqual(hand({}));
    expectRule(() => applyAction(s, { type: "PLAY_MONOPOLY", playerId: "a", resource: "gold" as never }), "INVALID_TRADE");
  });

  it("§8.3 victory point cards are never played and stay hidden in redact", () => {
    let s = withCards([{ type: "victoryPoint" }, { type: "knight" }]);
    s = give(s, "a", { wood: 2 });
    const mine = redact(s, "a");
    const theirs = redact(s, "b");
    expect(mine.players[0]!.devCards).toEqual(getPlayer(s, "a").devCards);
    expect(mine.players[0]!.privateVP).toBe(1);
    expect(mine.players[0]!.publicVP).toBe(1);
    expect(theirs.players[0]!.devCards).toEqual({ count: 2 });
    expect(theirs.players[0]!.privateVP).toBeNull();
    expect(theirs.players[0]!.publicVP).toBe(1);
    expect(theirs.players[0]!.hand).toEqual({ count: 2 });
    expect(theirs.players[1]!.hand).toEqual(hand({}));
    expect(theirs.devDeck).toEqual({ count: 25 });
    expect("seed" in theirs).toBe(false);
    expect(theirs.viewer).toBe("b");
    expect(legalActions(s, "a").some((a) => a.type.startsWith("PLAY_") && a.type !== "PLAY_KNIGHT")).toBe(false);
  });
});
