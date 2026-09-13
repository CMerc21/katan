import { describe, expect, it } from "vitest";
import { GEOMETRY } from "../src/geometry";
import { applyAction } from "../src/actions";
import { discardOwed, legalActions, representativeDiscard, stealTargets } from "../src/legal";
import { getPlayer, hand, handSize } from "../src/state";
import { ROLL_PHASE, expectRule, give, hexWith, inPhase, mut, newGame, place, withNextRoll } from "./helpers";

function sevenScenario() {
  const state = withNextRoll(inPhase(newGame(), ROLL_PHASE, "a"), 7);
  const hex = hexWith(state, "forest", 11);
  const verts = GEOMETRY.hexVertices[hex]!;
  return { state, hex, v0: verts[0]!, v3: verts[3]! };
}

describe("§7 rolling a seven", () => {
  it("§7.1 discard math: 8 -> 4, 9 -> 4, 15 -> 7, 7 -> 0", () => {
    expect(discardOwed(7)).toBe(0);
    expect(discardOwed(8)).toBe(4);
    expect(discardOwed(9)).toBe(4);
    expect(discardOwed(15)).toBe(7);
  });

  it("§7.1 a seven with nobody over 7 cards goes straight to moving the robber", () => {
    const { state } = sevenScenario();
    const s = give(state, "a", { wood: 7 });
    const after = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(after.lastRoll![0] + after.lastRoll![1]).toBe(7);
    expect(after.pendingDiscards).toEqual({});
    expect(after.phase).toEqual({ kind: "moveRobber", via: "seven", returnTo: "action" });
  });

  it("§7.1 every player over 7 cards discards half, then the robber moves", () => {
    const { state } = sevenScenario();
    const s = give(give(state, "b", { wood: 5, ore: 4 }), "d", { grain: 15 });
    const rolled = applyAction(s, { type: "ROLL", playerId: "a" });
    expect(rolled.phase).toEqual({ kind: "discard", returnTo: { kind: "moveRobber", via: "seven", returnTo: "action" } });
    expect(rolled.pendingDiscards).toEqual({ b: 4, d: 7 });

    // Only owing players have legal actions, and a representative discard is offered.
    expect(legalActions(rolled, "a")).toEqual([]);
    expect(legalActions(rolled, "b")).toEqual([{ type: "DISCARD", playerId: "b", cards: hand({ wood: 3, ore: 1 }) }]);
    expect(handSize(representativeDiscard(hand({ wood: 5, ore: 4 }), 4))).toBe(4);

    expectRule(() => applyAction(rolled, { type: "DISCARD", playerId: "a", cards: hand({}) }), "NO_DISCARD_OWED");
    expectRule(() => applyAction(rolled, { type: "DISCARD", playerId: "b", cards: hand({ wood: 3 }) }), "WRONG_DISCARD_COUNT");
    expectRule(() => applyAction(rolled, { type: "DISCARD", playerId: "b", cards: hand({ wood: 5 }) }), "WRONG_DISCARD_COUNT");
    expectRule(() => applyAction(rolled, { type: "DISCARD", playerId: "b", cards: hand({ grain: 4 }) }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(rolled, { type: "DISCARD", playerId: "b", cards: { wood: -1 } as never }), "INVALID_TRADE");
    expectRule(() => applyAction(rolled, { type: "MOVE_ROBBER", playerId: "a", hex: "1,0" }), "WRONG_PHASE");

    const bDone = applyAction(rolled, { type: "DISCARD", playerId: "b", cards: hand({ wood: 2, ore: 2 }) });
    expect(getPlayer(bDone, "b").hand).toEqual(hand({ wood: 3, ore: 2 }));
    expect(bDone.bank.wood).toBe(rolled.bank.wood + 2);
    expect(bDone.phase).toEqual({ kind: "discard", returnTo: { kind: "moveRobber", via: "seven", returnTo: "action" } });
    expect(bDone.pendingDiscards).toEqual({ d: 7 });

    const dDone = applyAction(bDone, { type: "DISCARD", playerId: "d", cards: hand({ grain: 7 }) });
    expect(dDone.pendingDiscards).toEqual({});
    expect(dDone.phase).toEqual({ kind: "moveRobber", via: "seven", returnTo: "action" });
  });

  it("§7.2 the robber must move to a different, valid hex", () => {
    const { state, hex } = sevenScenario();
    const rolled = applyAction(state, { type: "ROLL", playerId: "a" });
    expectRule(() => applyAction(rolled, { type: "MOVE_ROBBER", playerId: "a", hex: rolled.robberHex }), "ROBBER_MUST_MOVE");
    expectRule(() => applyAction(rolled, { type: "MOVE_ROBBER", playerId: "a", hex: "9,9" }), "INVALID_HEX");
    expectRule(() => applyAction(rolled, { type: "MOVE_ROBBER", playerId: "b", hex }), "NOT_YOUR_TURN");
    const moves = legalActions(rolled, "a");
    expect(moves).toHaveLength(18);
    expect(moves.every((m) => m.type === "MOVE_ROBBER" && m.hex !== rolled.robberHex)).toBe(true);
    const moved = applyAction(rolled, { type: "MOVE_ROBBER", playerId: "a", hex });
    expect(moved.robberHex).toBe(hex);
    // No opponent buildings on the hex: steal is skipped.
    expect(moved.phase).toEqual({ kind: "action" });
  });

  it("§7.3 steal targets are opponents with a building on the hex and at least one card", () => {
    const { state, hex, v0, v3 } = sevenScenario();
    let s = place(place(place(state, "a", { settlements: [v0] }), "b", { settlements: [v3] }), "c", { cities: [GEOMETRY.hexVertices[hex]![5]!] });
    s = give(s, "b", { ore: 2 }); // c has no cards; a is the thief
    expect(stealTargets(s, hex, "a")).toEqual(["b"]);
    const rolled = applyAction(s, { type: "ROLL", playerId: "a" });
    const moved = applyAction(rolled, { type: "MOVE_ROBBER", playerId: "a", hex });
    expect(moved.phase).toEqual({ kind: "steal", hex, targets: ["b"], returnTo: "action" });
    expect(legalActions(moved, "a")).toEqual([{ type: "STEAL", playerId: "a", targetPlayerId: "b" }]);
    expectRule(() => applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "c" }), "INVALID_STEAL_TARGET");
    expectRule(() => applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "a" }), "INVALID_STEAL_TARGET");
    expectRule(() => applyAction(moved, { type: "END_TURN", playerId: "a" }), "WRONG_PHASE");

    const stolen = applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "b" });
    expect(getPlayer(stolen, "a").hand).toEqual(hand({ ore: 1 }));
    expect(getPlayer(stolen, "b").hand).toEqual(hand({ ore: 1 }));
    expect(stolen.phase).toEqual({ kind: "action" });
    // Seeded: the same steal picks the same card.
    expect(applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "b" })).toEqual(stolen);
  });

  it("§7.3 a stolen card is drawn uniformly from the victim's hand", () => {
    const { state, hex, v3 } = sevenScenario();
    let s = give(place(state, "b", { settlements: [v3] }), "b", { wood: 1, ore: 1 });
    s = mut(s, (x) => void (x.phase = { kind: "steal", hex, targets: ["b"], returnTo: "action" }));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const variant = mut(s, (x) => void (x.actionIndex = i));
      const after = applyAction(variant, { type: "STEAL", playerId: "a", targetPlayerId: "b" });
      seen.add(JSON.stringify(getPlayer(after, "a").hand));
    }
    expect(seen.size).toBe(2);
  });

  it("§7.3 a seven with two targets lets the roller choose", () => {
    const { state, hex, v0, v3 } = sevenScenario();
    let s = place(place(state, "b", { settlements: [v0] }), "c", { settlements: [v3] });
    s = give(give(s, "b", { wood: 1 }), "c", { ore: 1 });
    const moved = applyAction(applyAction(s, { type: "ROLL", playerId: "a" }), { type: "MOVE_ROBBER", playerId: "a", hex });
    expect(moved.phase).toMatchObject({ kind: "steal", targets: ["b", "c"] });
    const fromC = applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "c" });
    expect(getPlayer(fromC, "a").hand.ore).toBe(1);
  });
});
