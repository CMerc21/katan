import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { legalActions } from "../src/legal";
import { improvementCost, metropolisSites } from "../src/modules/crown/improvements";
import { nextActor, victoryPoints, getPlayer } from "../src/state";
import { ACTION_PHASE, expectRule, inPhase, mut, place } from "./helpers";
import { A, B, crownGame, crownOf, giveCommodities, setTrack } from "./crown-helpers";

/** meadow 4, mountain 8, claypit 4. */
const V1 = "1,0|1,1|2,0";
/** mountain 9, meadow 6, forest 9. */
const V3 = "1,-1|2,-2|2,-1";
/** farmland 5, farmland 3, wasteland. */
const V4 = "-1,0|-1,1|0,0";

function withCity(playerId = A, cities: string[] = [V1]) {
  return place(inPhase(crownGame(), ACTION_PHASE, playerId), playerId, { cities });
}

describe("docs/phase11.md §3 city improvements", () => {
  it("docs/phase11.md §3 level n costs n of the track's commodity and needs a city", () => {
    const noCity = giveCommodities(inPhase(crownGame(), ACTION_PHASE, A), A, { cloth: 5 });
    expectRule(() => applyAction(noCity, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" }), "NO_CITY");
    expect(legalActions(noCity, A).some((a) => a.type === "BUILD_IMPROVEMENT")).toBe(false);
    let s = giveCommodities(withCity(), A, { cloth: 3, coin: 1 });
    expect(improvementCost(s, A, "trade")).toBe(1);
    expect(legalActions(s, A).filter((a) => a.type === "BUILD_IMPROVEMENT").map((a) => a.type === "BUILD_IMPROVEMENT" && a.track)).toEqual(["trade", "politics"]);
    const { state: one, events } = applyActionWithEvents(s, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" });
    expect(crownOf(one).players[A]!.tracks.trade).toBe(1);
    expect(crownOf(one).players[A]!.commodities.cloth).toBe(2);
    expect(crownOf(one).bank.cloth).toBe(10);
    expect(events.some((e) => e.kind === "improvementBuilt" && e.track === "trade" && e.level === 1)).toBe(true);
    expect(improvementCost(one, A, "trade")).toBe(2);
    const two = applyAction(one, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" });
    expect(crownOf(two).players[A]!.tracks.trade).toBe(2);
    expect(crownOf(two).players[A]!.commodities.cloth).toBe(0);
    expectRule(() => applyAction(two, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(two, { type: "BUILD_IMPROVEMENT", playerId: A, track: "religion" as never }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(two, { type: "BUILD_IMPROVEMENT", playerId: B, track: "trade" }), "NOT_YOUR_TURN");
    s = setTrack(giveCommodities(withCity(), A, { paper: 12 }), A, "science", 5);
    expectRule(() => applyAction(s, { type: "BUILD_IMPROVEMENT", playerId: A, track: "science" }), "TRACK_MAXED");
    expect(legalActions(s, A).some((a) => a.type === "BUILD_IMPROVEMENT" && a.track === "science")).toBe(false);
  });

  it("docs/phase11.md §4 a crane makes the next improvement one cheaper (never below 1) and is spent", () => {
    let s = mut(giveCommodities(withCity(), A, { coin: 3 }), (x) => void (crownOf(x).players[A]!.crane = true));
    s = setTrack(s, A, "politics", 2);
    expect(improvementCost(s, A, "politics")).toBe(2);
    const three = applyAction(s, { type: "BUILD_IMPROVEMENT", playerId: A, track: "politics" });
    expect(crownOf(three).players[A]!.tracks.politics).toBe(3);
    expect(crownOf(three).players[A]!.commodities.coin).toBe(1);
    expect(crownOf(three).players[A]!.crane).toBe(false);
    expect(improvementCost(three, A, "politics")).toBe(4);
    const first = mut(giveCommodities(withCity(), A, { cloth: 1 }), (x) => void (crownOf(x).players[A]!.crane = true));
    expect(improvementCost(first, A, "trade")).toBe(1);
    expect(crownOf(applyAction(first, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" })).players[A]!.commodities.cloth).toBe(0);
  });

  it("docs/phase11.md §7 reaching level 4 first founds the metropolis: placed at once on the only city, worth 2 VP", () => {
    const s = setTrack(giveCommodities(withCity(), A, { cloth: 4 }), A, "trade", 3);
    const before = victoryPoints(s, getPlayer(s, A)).total;
    const { state: four, events } = applyActionWithEvents(s, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" });
    expect(four.phase).toEqual({ kind: "action" });
    expect(crownOf(four).metropolis.trade).toBe(A);
    expect(crownOf(four).players[A]!.metropolises.trade).toBe(V1);
    expect(events.some((e) => e.kind === "metropolisPlaced" && e.playerId === A && e.vertex === V1 && e.from === null)).toBe(true);
    expect(victoryPoints(four, getPlayer(four, A)).total).toBe(before + 2);
    // A later level 4 by someone else does not take it; level 5 over a level-4 holder does (§7).
    let b = place(setTrack(four, B, "trade", 3), B, { cities: [V4] });
    b = giveCommodities(b, B, { cloth: 9 });
    const bFour = applyAction(inPhase(b, ACTION_PHASE, B), { type: "BUILD_IMPROVEMENT", playerId: B, track: "trade" });
    expect(crownOf(bFour).metropolis.trade).toBe(A);
    expect(crownOf(bFour).players[B]!.metropolises.trade).toBeNull();
    const { state: bFive, events: stealEvents } = applyActionWithEvents(bFour, { type: "BUILD_IMPROVEMENT", playerId: B, track: "trade" });
    expect(crownOf(bFive).players[B]!.tracks.trade).toBe(5);
    expect(crownOf(bFive).metropolis.trade).toBe(B);
    expect(crownOf(bFive).players[B]!.metropolises.trade).toBe(V4);
    expect(crownOf(bFive).players[A]!.metropolises.trade).toBeNull();
    expect(stealEvents.some((e) => e.kind === "metropolisPlaced" && e.playerId === B && e.from === A)).toBe(true);
    expect(victoryPoints(bFive, getPlayer(bFive, A)).total).toBe(before);
    // A level-5 holder is immune: A reaching 5 now does not take it back.
    const aFive = applyAction(giveCommodities(inPhase(bFive, ACTION_PHASE, A), A, { cloth: 5 }), { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" });
    expect(crownOf(aFive).players[A]!.tracks.trade).toBe(5);
    expect(crownOf(aFive).metropolis.trade).toBe(B);
  });

  it("docs/phase11.md §7 with several eligible cities the player chooses where the metropolis goes", () => {
    const s = setTrack(giveCommodities(withCity(A, [V1, V3]), A, { coin: 4 }), A, "politics", 3);
    const four = applyAction(s, { type: "BUILD_IMPROVEMENT", playerId: A, track: "politics" });
    expect(four.phase.kind).toBe("modulePrompt");
    if (four.phase.kind !== "modulePrompt") throw new Error("unreachable");
    expect(four.phase.prompt).toEqual({ kind: "placeMetropolis", playerId: A, track: "politics", from: null });
    expect(nextActor(four)).toBe(A);
    expect(crownOf(four).metropolis.politics).toBeNull();
    expect(legalActions(four, A).map((a) => a.type === "PLACE_METROPOLIS" && a.vertex).sort()).toEqual([V1, V3].sort());
    expectRule(() => applyAction(four, { type: "PLACE_METROPOLIS", playerId: A, vertex: V4 }), "INVALID_CHOICE");
    expectRule(() => applyAction(four, { type: "PLACE_METROPOLIS", playerId: B, vertex: V1 }), "NOT_YOUR_PROMPT");
    expectRule(() => applyAction(four, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" }), "WRONG_PHASE");
    const placed = applyAction(four, { type: "PLACE_METROPOLIS", playerId: A, vertex: V3 });
    expect(placed.phase).toEqual({ kind: "action" });
    expect(crownOf(placed).players[A]!.metropolises.politics).toBe(V3);
    expect(crownOf(placed).metropolis.politics).toBe(A);
    // A city carrying another metropolis is not eligible: the trade one goes to V1 automatically.
    const trade = setTrack(giveCommodities(placed, A, { cloth: 4 }), A, "trade", 3);
    expect(metropolisSites(trade, A, "trade")).toEqual([V1]);
    const both = applyAction(trade, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" });
    expect(both.phase).toEqual({ kind: "action" });
    expect(crownOf(both).players[A]!.metropolises.trade).toBe(V1);
    expect(victoryPoints(both, getPlayer(both, A)).publicVP).toBe(4 + 4);
    // No free city: reaching level 4 on the third track leaves the metropolis unclaimed.
    const science = setTrack(giveCommodities(both, A, { paper: 4 }), A, "science", 3);
    const none = applyAction(science, { type: "BUILD_IMPROVEMENT", playerId: A, track: "science" });
    expect(none.phase).toEqual({ kind: "action" });
    expect(crownOf(none).metropolis.science).toBeNull();
  });
});
