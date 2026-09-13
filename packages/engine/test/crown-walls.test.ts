import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { legalActions } from "../src/legal";
import { MAX_WALLS } from "../src/modules/types";
import { discardThreshold, getPlayer } from "../src/state";
import { ACTION_PHASE, ROLL_PHASE, expectRule, give, inPhase, mut, place, withNextRoll } from "./helpers";
import { A, B, crownGame, crownOf } from "./crown-helpers";

const V1 = "1,0|1,1|2,0";
const V3 = "1,-1|2,-2|2,-1";
const V6 = "-3,0|-2,-1|-2,0";
const V4 = "-1,0|-1,1|0,0";

describe("docs/phase11.md §7 city walls", () => {
  it("docs/phase11.md §7 a wall costs 2 clay, goes on an own city without one, at most three per player", () => {
    let s = place(inPhase(crownGame(), ACTION_PHASE, A), A, { cities: [V1, V3, V6], settlements: [V4] });
    s = give(s, A, { clay: 8 });
    expect(legalActions(s, A).filter((a) => a.type === "BUILD_WALL").map((a) => a.type === "BUILD_WALL" && a.vertex).sort()).toEqual([V1, V3, V6].sort());
    const { state: one, events } = applyActionWithEvents(s, { type: "BUILD_WALL", playerId: A, vertex: V1 });
    expect(getPlayer(one, A).hand.clay).toBe(6);
    expect(crownOf(one).players[A]!.walls).toEqual([V1]);
    expect(events.some((e) => e.kind === "wallBuilt" && e.vertex === V1 && e.free === false)).toBe(true);
    expectRule(() => applyAction(one, { type: "BUILD_WALL", playerId: A, vertex: V1 }), "VERTEX_OCCUPIED");
    expectRule(() => applyAction(one, { type: "BUILD_WALL", playerId: A, vertex: V4 }), "NOT_A_CITY");
    expectRule(() => applyAction(one, { type: "BUILD_WALL", playerId: B, vertex: V3 }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(inPhase(one, ROLL_PHASE), { type: "BUILD_WALL", playerId: A, vertex: V3 }), "WRONG_PHASE");
    expect(legalActions(one, A).filter((a) => a.type === "BUILD_WALL").map((a) => a.type === "BUILD_WALL" && a.vertex).sort()).toEqual([V3, V6].sort());
    const poor = mut(one, (x) => void (getPlayer(x, A).hand.clay = 1));
    expectRule(() => applyAction(poor, { type: "BUILD_WALL", playerId: A, vertex: V3 }), "INSUFFICIENT_RESOURCES");
    expect(legalActions(poor, A).some((a) => a.type === "BUILD_WALL")).toBe(false);
    const three = applyAction(applyAction(one, { type: "BUILD_WALL", playerId: A, vertex: V3 }), { type: "BUILD_WALL", playerId: A, vertex: V6 });
    expect(crownOf(three).players[A]!.walls).toHaveLength(MAX_WALLS);
    const fourth = place(give(three, A, { clay: 2 }), A, { cities: ["-2,2|-1,1|-1,2"] });
    expectRule(() => applyAction(fourth, { type: "BUILD_WALL", playerId: A, vertex: "-2,2|-1,1|-1,2" }), "WALL_LIMIT");
    expect(legalActions(fourth, A).some((a) => a.type === "BUILD_WALL")).toBe(false);
  });

  it("docs/phase11.md §7 each wall raises the discard threshold by two: 7, 9, 11, 13", () => {
    let s = place(inPhase(crownGame(), ROLL_PHASE, B), A, { cities: [V1, V3, V6] });
    const thresholds = [7, 9, 11, 13];
    for (let walls = 0; walls <= 3; walls++) {
      const walled = mut(s, (x) => void (crownOf(x).players[A]!.walls = [V1, V3, V6].slice(0, walls)));
      expect(discardThreshold(walled, getPlayer(walled, A))).toBe(thresholds[walls]);
    }
    // Nine cards with one wall: no discard; ten cards: five go.
    s = mut(give(s, A, { wood: 9 }), (x) => void (crownOf(x).players[A]!.walls = [V1]));
    const nine = applyAction(withNextRoll(s, 7), { type: "ROLL", playerId: B });
    expect(nine.pendingDiscards[A]).toBeUndefined();
    const ten = applyAction(withNextRoll(give(s, A, { ore: 1 }), 7), { type: "ROLL", playerId: B });
    expect(ten.pendingDiscards[A]).toBe(5);
  });
});
