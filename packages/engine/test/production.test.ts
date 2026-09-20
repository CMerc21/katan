import { describe, expect, it } from "vitest";
import { RESOURCES, TERRAIN_RESOURCE } from "../src/board";
import { GEOMETRY } from "../src/geometry";
import { applyAction } from "../src/actions";
import { getPlayer, hand } from "../src/state";
import { ROLL_PHASE, expectRule, expectedProduction, hexWith, inPhase, mut, newGame, place, withNextRoll } from "./helpers";

/** Beginner board: forest with token 11 is on the inner ring. */
function forestScenario() {
  const state = inPhase(newGame(), ROLL_PHASE, "a");
  const hex = hexWith(state, "forest", 11);
  const [v0, , , v3] = GEOMETRY.hexVertices[hex]!;
  return { state, hex, v0: v0!, v3: v3! };
}

describe("§6 turn and production", () => {
  it("§6.1 ROLL is seeded by action index and moves to the action phase", () => {
    const { state } = forestScenario();
    const s = withNextRoll(state, 11);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(after.lastRoll![0] + after.lastRoll![1]).toBe(11);
    expect(after.phase).toEqual({ kind: "action" });
    expect(applyAction(s, { type: "ROLL", playerId: "a" })).toEqual(after);
    expectRule(() => applyAction(s, { type: "ROLL", playerId: "b" }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(after, { type: "ROLL", playerId: "a" }), "WRONG_PHASE");
  });

  it("§6.2 a settlement yields 1 and a city yields 2 of the hex resource", () => {
    const { state, v0, v3 } = forestScenario();
    const s = withNextRoll(place(place(state, "a", { settlements: [v0] }), "b", { cities: [v3] }), 11);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand).toEqual(expectedProduction(s, 11).a);
    expect(getPlayer(after, "b").hand).toEqual(expectedProduction(s, 11).b);
    expect(getPlayer(after, "a").hand.wood).toBeGreaterThanOrEqual(1);
    expect(getPlayer(after, "b").hand.wood).toBeGreaterThanOrEqual(2);
    for (const r of RESOURCES) {
      const inHands = after.players.reduce((n, p) => n + p.hand[r], 0);
      expect(after.bank[r] + inHands).toBe(19);
    }
  });

  it("§6.2 hexes not matching the roll produce nothing", () => {
    const { state, v0 } = forestScenario();
    const s = withNextRoll(place(state, "a", { settlements: [v0] }), 2);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand).toEqual(expectedProduction(s, 2).a);
  });

  it("§6.2 the robber blocks production on its hex", () => {
    const { state, hex, v0 } = forestScenario();
    const s = withNextRoll(mut(place(state, "a", { settlements: [v0] }), (x) => void (x.robberHex = hex)), 11);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand.wood).toBe(0);
  });

  it("§6.2 bank shortage with a single recipient pays what is left", () => {
    const { state, v0, v3 } = forestScenario();
    let s = place(state, "a", { cities: [v0, v3] }); // owed 4 wood
    s = mut(s, (x) => void (x.bank.wood = 3));
    s = withNextRoll(s, 11);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand.wood).toBe(3);
    expect(after.bank.wood).toBe(0);
  });

  it("§6.2 bank shortage with several recipients pays nobody for that resource", () => {
    const { state, v0, v3 } = forestScenario();
    let s = place(place(state, "a", { cities: [v0] }), "b", { settlements: [v3] }); // owed 2 + 1 wood
    s = mut(s, (x) => void (x.bank.wood = 2));
    s = withNextRoll(s, 11);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand.wood).toBe(0);
    expect(getPlayer(after, "b").hand.wood).toBe(0);
    expect(after.bank.wood).toBe(2);
    expect(after.log.some((l) => l.text.includes("nobody"))).toBe(true);
  });

  it("§6.2 a shortage in one resource does not affect other resources", () => {
    const { state, v0 } = forestScenario();
    // Find a vertex on the forest(11) that also touches a different terrain hex with token 11? Not
    // guaranteed, so use two players on different 11 hexes if present; otherwise use ore/grain via hand math.
    const otherHex = GEOMETRY.hexes.find((h) => state.board.hexes[h]!.token === 11 && h !== hexWith(state, "forest", 11));
    if (!otherHex) return; // beginner board has two 11s; guard anyway
    const otherRes = TERRAIN_RESOURCE[state.board.hexes[otherHex]!.terrain]!;
    const ov = GEOMETRY.hexVertices[otherHex]![0]!;
    let s = place(place(state, "a", { settlements: [v0] }), "b", { settlements: [ov] });
    s = place(s, "c", { settlements: [GEOMETRY.hexVertices[hexWith(state, "forest", 11)]![3]!] });
    s = mut(s, (x) => void (x.bank.wood = 1)); // a and c both owed wood: nobody gets it
    s = withNextRoll(s, 11);
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand.wood).toBe(0);
    expect(getPlayer(after, "c").hand.wood).toBe(0);
    expect(getPlayer(after, "b").hand[otherRes]).toBe(expectedProduction(s, 11).b![otherRes]);
    expect(getPlayer(after, "b").hand[otherRes]).toBeGreaterThanOrEqual(1);
  });

  it("§6.3 END_TURN passes play to the next seat, wraps, and resets per-turn flags", () => {
    let s = inPhase(newGame(), { kind: "action" }, "d");
    s = mut(s, (x) => {
      x.players[3]!.devCardPlayedThisTurn = true;
      x.pendingTrade = { from: "d", give: hand({ wood: 1 }), receive: hand({ ore: 1 }), rejectedBy: [], counters: [] };
    });
    const after = applyAction(s, { type: "END_TURN", playerId: "d" });
    expect(after.currentPlayer).toBe(0);
    expect(after.turn).toBe(s.turn + 1);
    expect(after.phase).toEqual({ kind: "roll" });
    expect(after.pendingTrade).toBeNull();
    expect(after.players.every((p) => !p.devCardPlayedThisTurn)).toBe(true);
    expectRule(() => applyAction(s, { type: "END_TURN", playerId: "a" }), "NOT_YOUR_TURN");
  });
});
