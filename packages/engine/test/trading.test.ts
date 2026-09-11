import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions";
import { legalActions } from "../src/legal";
import { bestRatio, getPlayer, hand } from "../src/state";
import { ACTION_PHASE, expectRule, give, inPhase, mut, newGame } from "./helpers";

function ready() {
  let s = inPhase(newGame(), ACTION_PHASE, "a");
  s = give(give(s, "a", { wood: 2, clay: 1 }), "b", { ore: 2 });
  s = give(s, "c", { ore: 1 });
  return s;
}

describe("§9 trading", () => {
  it("§9.1 an offer needs cards on both sides, no gifting, no overlap, and the offerer must hold them", () => {
    const s = ready();
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({}), receive: hand({ ore: 1 }) }), "EMPTY_TRADE");
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({}) }), "EMPTY_TRADE");
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ wood: 1 }) }), "INVALID_TRADE");
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ ore: 1 }), receive: hand({ wood: 1 }) }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: { wood: 1 } as never, receive: hand({ ore: 1 }) }), "INVALID_TRADE");
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "b", give: hand({ ore: 1 }), receive: hand({ wood: 1 }) }), "NOT_YOUR_TURN");
    const offered = applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) });
    expect(offered.pendingTrade).toEqual({ from: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }), rejectedBy: [] });
    expectRule(() => applyAction(offered, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) }), "TRADE_ALREADY_PENDING");
    expect(legalActions(offered, "a").some((a) => a.type === "OFFER_TRADE")).toBe(false);
    expect(legalActions(offered, "a").some((a) => a.type === "CANCEL_TRADE")).toBe(true);
  });

  it("§9.1 the first acceptor wins, must hold the cards, and the trade executes atomically", () => {
    const s = ready();
    const offered = applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 2 }) });
    expect(legalActions(offered, "b").map((a) => a.type)).toEqual(["ACCEPT_TRADE", "REJECT_TRADE"]);
    expect(legalActions(offered, "c").map((a) => a.type)).toEqual(["REJECT_TRADE"]); // c has only 1 ore
    expectRule(() => applyAction(offered, { type: "ACCEPT_TRADE", playerId: "c" }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(offered, { type: "ACCEPT_TRADE", playerId: "a" }), "INVALID_TRADE");
    expectRule(() => applyAction(s, { type: "ACCEPT_TRADE", playerId: "b" }), "NO_PENDING_TRADE");
    const done = applyAction(offered, { type: "ACCEPT_TRADE", playerId: "b" });
    expect(getPlayer(done, "a").hand).toEqual(hand({ wood: 1, clay: 1, ore: 2 }));
    expect(getPlayer(done, "b").hand).toEqual(hand({ wood: 1 }));
    expect(done.pendingTrade).toBeNull();
    expect(done.phase).toEqual({ kind: "action" });
    expectRule(() => applyAction(done, { type: "ACCEPT_TRADE", playerId: "c" }), "NO_PENDING_TRADE");
  });

  it("§9.1 rejecting removes that player; once everyone declines the offer clears", () => {
    const s = ready();
    const offered = applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) });
    expectRule(() => applyAction(offered, { type: "REJECT_TRADE", playerId: "a" }), "INVALID_TRADE");
    const r1 = applyAction(offered, { type: "REJECT_TRADE", playerId: "b" });
    expect(r1.pendingTrade!.rejectedBy).toEqual(["b"]);
    expect(legalActions(r1, "b")).toEqual([]);
    expectRule(() => applyAction(r1, { type: "ACCEPT_TRADE", playerId: "b" }), "NO_PENDING_TRADE");
    expectRule(() => applyAction(r1, { type: "REJECT_TRADE", playerId: "b" }), "NO_PENDING_TRADE");
    const r2 = applyAction(r1, { type: "REJECT_TRADE", playerId: "c" });
    const r3 = applyAction(r2, { type: "REJECT_TRADE", playerId: "d" });
    expect(r3.pendingTrade).toBeNull();
    expectRule(() => applyAction(r3, { type: "REJECT_TRADE", playerId: "b" }), "NO_PENDING_TRADE");
  });

  it("§9.1 the offerer may cancel; ending the turn clears a pending offer", () => {
    const s = ready();
    expectRule(() => applyAction(s, { type: "CANCEL_TRADE", playerId: "a" }), "NO_PENDING_TRADE");
    const offered = applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) });
    expect(applyAction(offered, { type: "CANCEL_TRADE", playerId: "a" }).pendingTrade).toBeNull();
    expectRule(() => applyAction(offered, { type: "CANCEL_TRADE", playerId: "b" }), "NOT_YOUR_TURN");
    const ended = applyAction(offered, { type: "END_TURN", playerId: "a" });
    expect(ended.pendingTrade).toBeNull();
    expect(ended.currentPlayer).toBe(1);
  });

  it("§9.1 an offer the offerer can no longer pay is withdrawn automatically", () => {
    const s = give(ready(), "a", { grain: 2, ore: 3 });
    const withSettlement = mut(s, (x) => {
      x.players[0]!.settlements.push("0,0|0,1|1,0");
      x.players[0]!.pieces.settlements -= 1;
    });
    const offered = applyAction(withSettlement, { type: "OFFER_TRADE", playerId: "a", give: hand({ ore: 3 }), receive: hand({ wool: 1 }) });
    const spent = applyAction(offered, { type: "BUILD_CITY", playerId: "a", vertex: "0,0|0,1|1,0" });
    expect(spent.pendingTrade).toBeNull();
  });

  it("§9.1 trading is only possible in the action phase", () => {
    const s = inPhase(ready(), { kind: "roll" });
    expectRule(() => applyAction(s, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) }), "WRONG_PHASE");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 4, receive: "ore" }), "WRONG_PHASE");
  });

  it("§9.2 maritime 4:1 is always available; 3:1 and 2:1 need the matching port", () => {
    const s = give(inPhase(newGame(), ACTION_PHASE, "a"), "a", { wood: 4, wool: 4 });
    expect(bestRatio(s, getPlayer(s, "a"), "wood")).toBe(4);
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 3, receive: "ore" }), "BAD_TRADE_RATIO");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 2, receive: "ore" }), "BAD_TRADE_RATIO");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 5 as never, receive: "ore" }), "BAD_TRADE_RATIO");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 4, receive: "wood" }), "INVALID_TRADE");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "clay", giveCount: 4, receive: "ore" }), "INSUFFICIENT_RESOURCES");
    const four = applyAction(s, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 4, receive: "ore" });
    expect(getPlayer(four, "a").hand).toEqual(hand({ wool: 4, ore: 1 }));
    expect(four.bank.wood).toBe(s.bank.wood + 4);
    expect(four.bank.ore).toBe(s.bank.ore - 1);

    // Generic port: 3:1 for anything.
    const anyPort = s.board.ports.find((p) => p.kind === "any")!;
    const withAny = mut(s, (x) => void x.players[0]!.settlements.push(anyPort.vertices[0]));
    expect(bestRatio(withAny, getPlayer(withAny, "a"), "wood")).toBe(3);
    const three = applyAction(withAny, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 3, receive: "ore" });
    expect(getPlayer(three, "a").hand).toEqual(hand({ wood: 1, wool: 4, ore: 1 }));
    expectRule(() => applyAction(withAny, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 2, receive: "ore" }), "BAD_TRADE_RATIO");
    // 4:1 remains allowed even with a better port.
    expect(() => applyAction(withAny, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 4, receive: "ore" })).not.toThrow();

    // Resource port: 2:1 for that resource only.
    const woolPort = s.board.ports.find((p) => p.kind === "wool")!;
    const withWool = mut(s, (x) => void x.players[0]!.cities.push(woolPort.vertices[1]));
    expect(bestRatio(withWool, getPlayer(withWool, "a"), "wool")).toBe(2);
    expect(bestRatio(withWool, getPlayer(withWool, "a"), "wood")).toBe(4);
    const two = applyAction(withWool, { type: "MARITIME_TRADE", playerId: "a", give: "wool", giveCount: 2, receive: "clay" });
    expect(getPlayer(two, "a").hand).toEqual(hand({ wood: 4, wool: 2, clay: 1 }));
    expectRule(() => applyAction(withWool, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 2, receive: "clay" }), "BAD_TRADE_RATIO");
    expectRule(() => applyAction(withWool, { type: "MARITIME_TRADE", playerId: "a", give: "wool", giveCount: 3, receive: "clay" }), "BAD_TRADE_RATIO");

    // Bank must hold the requested resource.
    const dry = mut(s, (x) => void (x.bank.ore = 0));
    expectRule(() => applyAction(dry, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 4, receive: "ore" }), "BANK_EMPTY");
    expect(legalActions(dry, "a").some((a) => a.type === "MARITIME_TRADE" && a.receive === "ore")).toBe(false);
    const legal = legalActions(withWool, "a").filter((a) => a.type === "MARITIME_TRADE");
    expect(legal.some((a) => a.type === "MARITIME_TRADE" && a.give === "wool" && a.giveCount === 2)).toBe(true);
    expect(legal.some((a) => a.type === "MARITIME_TRADE" && a.give === "wood" && a.giveCount === 2)).toBe(false);
  });
});
