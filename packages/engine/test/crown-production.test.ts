import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { legalActions } from "../src/legal";
import { PROGRESS_DECKS, PROGRESS_HAND_LIMIT, TRACKS } from "../src/modules/types";
import { drawsOnRed } from "../src/modules/crown/progress";
import { getPlayer, handSize, nextActor } from "../src/state";
import { stealRandomCard } from "../src/turnHelpers";
import type { Rng } from "../src/rng";
import { ACTION_PHASE, ROLL_PHASE, expectRule, give, inPhase, mut, place, withNextRoll } from "./helpers";
import { A, B, C, crownGame, crownOf, giveCommodities, setTrack, withForcedRoll, withNextCrownRoll } from "./crown-helpers";

// Beginner board corners (see the fixed layout in src/board.ts):
/** meadow 4 (1,0), mountain 8 (1,1), claypit 4 (2,0). */
const V1 = "1,0|1,1|2,0";
/** mountain 9 (1,-1), meadow 6 (2,-2), forest 9 (2,-1). */
const V3 = "1,-1|2,-2|2,-1";
/** wasteland, forest 11 (0,1), meadow 4 (1,0). */
const V5 = "0,0|0,1|1,0";
/** farmland 5 (-1,0), farmland 3 (-1,1), wasteland. */
const V4 = "-1,0|-1,1|0,0";

describe("docs/phase11.md §1 commodities", () => {
  it("docs/phase11.md §1 init: commodity bank, empty tracks and decks of 18; no development cards", () => {
    const s = crownGame();
    const crown = crownOf(s);
    expect(crown.bank).toEqual({ cloth: 12, coin: 12, paper: 12 });
    for (const p of s.players) {
      expect(crown.players[p.id]!.commodities).toEqual({ cloth: 0, coin: 0, paper: 0 });
      expect(crown.players[p.id]!.tracks).toEqual({ trade: 0, politics: 0, science: 0 });
    }
    // Each deck holds exactly the cards of its list (18 trade, 18 politics; the science list sums to 17).
    for (const t of TRACKS) expect(crown.decks[t]).toHaveLength(PROGRESS_DECKS[t].reduce((n, [, k]) => n + k, 0));
    expect(crown.decks.trade).toHaveLength(18);
    expect(crown.decks.trade.filter((c) => c === "merchant")).toHaveLength(6);
    expect(s.devDeck).toEqual([]);
    expect(crown.fleet).toBe(0);
    expect(crown.defenderSupply).toBe(6);
    expectRule(() => applyAction(give(inPhase(s, ACTION_PHASE, A), A, { ore: 1, wool: 1, grain: 1 }), { type: "BUY_DEV_CARD", playerId: A }), "DECK_EMPTY");
    // Decks are seeded: the same seed deals the same order, another seed differs.
    expect(crownOf(crownGame("crown")).decks).toEqual(crown.decks);
    expect(crownOf(crownGame("other")).decks.trade).not.toEqual(crown.decks.trade);
  });

  it("docs/phase11.md §1 a city on meadow, mountain or forest yields 1 resource + 1 commodity; fields and hills yield 2", () => {
    let s = place(inPhase(crownGame(), ROLL_PHASE, A), A, { cities: [V1] });
    s = place(s, B, { cities: [V4] });
    const on4 = applyAction(withNextRoll(s, 4), { type: "ROLL", playerId: A });
    expect(getPlayer(on4, A).hand).toEqual({ wood: 0, clay: 2, wool: 1, grain: 0, ore: 0 });
    expect(crownOf(on4).players[A]!.commodities).toEqual({ cloth: 1, coin: 0, paper: 0 });
    expect(crownOf(on4).bank.cloth).toBe(11);
    const on8 = applyAction(withNextRoll(s, 8), { type: "ROLL", playerId: A });
    expect(getPlayer(on8, A).hand.ore).toBe(1);
    expect(crownOf(on8).players[A]!.commodities).toEqual({ cloth: 0, coin: 1, paper: 0 });
    const on5 = applyAction(withNextRoll(s, 5), { type: "ROLL", playerId: A });
    expect(getPlayer(on5, B).hand.grain).toBe(2);
    expect(crownOf(on5).players[B]!.commodities).toEqual({ cloth: 0, coin: 0, paper: 0 });
    // Forest: wood + paper.
    const forest = place(inPhase(crownGame(), ROLL_PHASE, A), C, { cities: [V3] });
    const { state: on9, events } = applyActionWithEvents(withNextRoll(forest, 9), { type: "ROLL", playerId: A });
    expect(getPlayer(on9, C).hand).toEqual({ wood: 1, clay: 0, wool: 0, grain: 0, ore: 1 });
    expect(crownOf(on9).players[C]!.commodities).toEqual({ cloth: 0, coin: 1, paper: 1 });
    const produced = events.find((e) => e.kind === "commoditiesProduced");
    expect(produced?.kind === "commoditiesProduced" && produced.gains.map((g) => g.commodity).sort()).toEqual(["coin", "paper"]);
  });

  it("docs/phase11.md §1 settlements are unchanged and the robber blocks commodities too", () => {
    const s = place(inPhase(crownGame(), ROLL_PHASE, A), B, { settlements: [V3] });
    const on9 = applyAction(withNextRoll(s, 9), { type: "ROLL", playerId: A });
    expect(getPlayer(on9, B).hand).toEqual({ wood: 1, clay: 0, wool: 0, grain: 0, ore: 1 });
    expect(crownOf(on9).players[B]!.commodities).toEqual({ cloth: 0, coin: 0, paper: 0 });
    const robbed = mut(place(inPhase(crownGame(), ROLL_PHASE, A), A, { cities: [V1] }), (x) => void (x.robberHex = "1,0"));
    const on4 = applyAction(withNextRoll(robbed, 4), { type: "ROLL", playerId: A });
    expect(getPlayer(on4, A).hand).toEqual({ wood: 0, clay: 2, wool: 0, grain: 0, ore: 0 });
    expect(crownOf(on4).players[A]!.commodities.cloth).toBe(0);
  });

  it("docs/phase11.md §1 a short commodity bank pays in seat order from the current player", () => {
    let s = place(inPhase(crownGame(), ROLL_PHASE, B), A, { cities: [V1] });
    s = place(s, B, { cities: [V5] });
    s = mut(s, (x) => void (crownOf(x).bank.cloth = 1));
    const on4 = applyAction(withNextRoll(s, 4), { type: "ROLL", playerId: B });
    expect(crownOf(on4).players[B]!.commodities.cloth).toBe(1);
    expect(crownOf(on4).players[A]!.commodities.cloth).toBe(0);
    expect(crownOf(on4).bank.cloth).toBe(0);
    expect(getPlayer(on4, A).hand.wool).toBe(1);
  });

  it("docs/phase11.md §1 commodities count toward the discard limit and are discarded through `commodities`", () => {
    let s = give(inPhase(crownGame(), ROLL_PHASE, A), B, { wood: 2 });
    s = giveCommodities(s, B, { cloth: 5, coin: 3 });
    const seven = applyAction(withNextRoll(s, 7), { type: "ROLL", playerId: A });
    expect(seven.phase.kind).toBe("discard");
    expect(seven.pendingDiscards[B]).toBe(5);
    const legal = legalActions(seven, B);
    expect(legal).toHaveLength(1);
    const discard = legal[0]!;
    expect(discard.type).toBe("DISCARD");
    if (discard.type !== "DISCARD") throw new Error("unreachable");
    expect(handSize(discard.cards)).toBe(2);
    expect(discard.commodities).toEqual({ cloth: 3, coin: 0, paper: 0 });
    const after = applyAction(seven, discard);
    expect(crownOf(after).players[B]!.commodities).toEqual({ cloth: 2, coin: 3, paper: 0 });
    expect(crownOf(after).bank.cloth).toBe(10);
    expect(getPlayer(after, B).hand.wood).toBe(0);
    expectRule(() => applyAction(seven, { type: "DISCARD", playerId: B, cards: { wood: 2, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 0, coin: 0, paper: 3 } }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(seven, { type: "DISCARD", playerId: B, cards: { wood: 2, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 2, coin: 0, paper: 0 } }), "WRONG_DISCARD_COUNT");
    expectRule(() => applyAction(seven, { type: "DISCARD", playerId: B, cards: { wood: 2, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 3 } as never }), "INVALID_TRADE");
    // A seven never moves the robber before the first attack (§5).
    const done = applyAction(seven, discard);
    expect(done.phase.kind).toBe("action");
    expect(nextActor(done)).toBe(A);
  });

  it("docs/phase11.md §1 a stolen card may be a commodity (the i-th in cloth, coin, paper order)", () => {
    let s = give(crownGame(), B, { wood: 1 });
    s = giveCommodities(s, B, { cloth: 1, paper: 1 });
    const pick = (i: number): Rng => ({ next: () => 0, int: () => i, shuffle: (x) => [...x] });
    const stolen = mut(s, (x) => stealRandomCard(x, getPlayer(x, A), getPlayer(x, B), pick(2)));
    expect(crownOf(stolen).players[A]!.commodities).toEqual({ cloth: 0, coin: 0, paper: 1 });
    expect(crownOf(stolen).players[B]!.commodities).toEqual({ cloth: 1, coin: 0, paper: 0 });
    expect(stolen.log[stolen.log.length - 1]?.text).toContain("stole a card");
    const wood = mut(s, (x) => stealRandomCard(x, getPlayer(x, A), getPlayer(x, B), pick(0)));
    expect(getPlayer(wood, A).hand.wood).toBe(1);
    const cloth = mut(s, (x) => stealRandomCard(x, getPlayer(x, A), getPlayer(x, B), pick(1)));
    expect(crownOf(cloth).players[A]!.commodities.cloth).toBe(1);
  });

  it("docs/phase11.md §1 commodities trade 4:1 with the bank for a resource or another commodity", () => {
    const s = giveCommodities(inPhase(crownGame(), ACTION_PHASE, A), A, { cloth: 4, coin: 1 });
    const legal = legalActions(s, A).filter((a) => a.type === "MARITIME_TRADE");
    expect(legal.some((a) => a.type === "MARITIME_TRADE" && a.give === "cloth" && a.giveCount === 4 && a.receive === "wood")).toBe(true);
    expect(legal.some((a) => a.type === "MARITIME_TRADE" && a.give === "cloth" && a.giveCount === 4 && a.receive === "coin")).toBe(true);
    expect(legal.some((a) => a.type === "MARITIME_TRADE" && a.give === "cloth" && a.giveCount === 2)).toBe(false);
    expect(legal.some((a) => a.type === "MARITIME_TRADE" && a.give === "coin")).toBe(false);
    const wood = applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "cloth", giveCount: 4, receive: "wood" });
    expect(crownOf(wood).players[A]!.commodities.cloth).toBe(0);
    expect(crownOf(wood).bank.cloth).toBe(12);
    expect(getPlayer(wood, A).hand.wood).toBe(1);
    const paper = applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "cloth", giveCount: 4, receive: "paper" });
    expect(crownOf(paper).players[A]!.commodities).toEqual({ cloth: 0, coin: 1, paper: 1 });
    expect(crownOf(paper).bank.paper).toBe(11);
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "cloth", giveCount: 2, receive: "wood" }), "BAD_TRADE_RATIO");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "cloth", giveCount: 3, receive: "wood" }), "BAD_TRADE_RATIO");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "coin", giveCount: 4, receive: "wood" }), "INSUFFICIENT_RESOURCES");
    const empty = mut(s, (x) => void (crownOf(x).bank.paper = 0));
    expectRule(() => applyAction(empty, { type: "MARITIME_TRADE", playerId: A, give: "cloth", giveCount: 4, receive: "paper" }), "BANK_EMPTY");
    expect(legalActions(empty, A).some((a) => a.type === "MARITIME_TRADE" && a.receive === "paper")).toBe(false);
  });

  it("docs/phase11.md §1 resources buy commodities at the usual port ratios", () => {
    let s = give(inPhase(crownGame(), ACTION_PHASE, A), A, { wool: 4, grain: 4 });
    const four = applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "wool", giveCount: 4, receive: "coin" });
    expect(crownOf(four).players[A]!.commodities.coin).toBe(1);
    expect(getPlayer(four, A).hand.wool).toBe(0);
    expect(four.bank.wool).toBe(19);
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "wool", giveCount: 2, receive: "coin" }), "BAD_TRADE_RATIO");
    // The wool harbour on the beginner board.
    s = place(s, A, { settlements: ["2,-1|2,0|3,-1"] });
    const two = applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "wool", giveCount: 2, receive: "cloth" });
    expect(crownOf(two).players[A]!.commodities.cloth).toBe(1);
    expect(legalActions(s, A).some((a) => a.type === "MARITIME_TRADE" && a.give === "wool" && a.giveCount === 2 && a.receive === "cloth")).toBe(true);
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "grain", giveCount: 2, receive: "cloth" }), "BAD_TRADE_RATIO");
  });
});

describe("docs/phase11.md §2 third die", () => {
  it("docs/phase11.md §2 every roll adds an event die and a red die; a fleet face advances the fleet", () => {
    const s = inPhase(crownGame(), ROLL_PHASE, A);
    const { state: fleet, events } = applyActionWithEvents(withNextCrownRoll(s, 5, "fleet"), { type: "ROLL", playerId: A });
    const rolled = events.find((e) => e.kind === "diceRolled");
    expect(rolled?.kind === "diceRolled" && rolled.event).toBe("fleet");
    expect(rolled?.kind === "diceRolled" && rolled.red).toBe(fleet.lastRoll![0]);
    expect(crownOf(fleet).fleet).toBe(1);
    expect(crownOf(fleet).lastEvent).toBe("fleet");
    expect(crownOf(fleet).lastRed).toBe(fleet.lastRoll![0]);
    expect(events.some((e) => e.kind === "fleetAdvanced" && e.position === 1)).toBe(true);
    const science = applyAction(withNextCrownRoll(s, 5, "science"), { type: "ROLL", playerId: A });
    expect(crownOf(science).fleet).toBe(0);
    expect(crownOf(science).lastEvent).toBe("science");
  });

  it("docs/phase11.md §2 draw thresholds: red 1 never; red n draws at level >= n - 1; level 5 always", () => {
    const table: Record<number, number[]> = {
      1: [],
      2: [1, 2, 3, 4, 5],
      3: [2, 3, 4, 5],
      4: [3, 4, 5],
      5: [4, 5],
      6: [5],
    };
    for (let red = 1; red <= 6; red++) {
      for (let level = 0; level <= 5; level++) {
        expect(drawsOnRed(level, red), `red ${red} level ${level}`).toBe(table[red]!.includes(level));
      }
    }
  });

  it("docs/phase11.md §2 a track face makes every qualifying player draw from that deck, in seat order; VP cards are revealed at once", () => {
    let s = inPhase(crownGame(), ROLL_PHASE, B);
    s = setTrack(s, A, "politics", 1);
    s = setTrack(s, B, "politics", 2);
    s = setTrack(s, C, "politics", 5);
    // Red 3: level 2 and up draw.
    s = mut(s, (x) => void (crownOf(x).decks.politics = ["constitution", "spy", "bishop", "warlord"]));
    const { state: after, events } = applyActionWithEvents(withForcedRoll(s, [3, 2], "politics"), { type: "ROLL", playerId: B });
    expect(after.lastRoll).toEqual([3, 2]);
    expect(crownOf(after).alchemist).toBeNull();
    expect(crownOf(after).players[B]!.progress).toEqual([{ card: "constitution", revealed: true }]);
    expect(crownOf(after).players[C]!.progress).toEqual([{ card: "spy", revealed: false }]);
    expect(crownOf(after).players[A]!.progress).toEqual([]);
    expect(crownOf(after).decks.politics).toEqual(["bishop", "warlord"]);
    const drawn = events.filter((e) => e.kind === "progressDrawn");
    expect(drawn.map((e) => e.kind === "progressDrawn" && e.playerId)).toEqual([B, C]);
    // Red 1 draws nothing even at level 5; red 6 only level 5.
    const one = applyAction(withForcedRoll(s, [1, 4], "politics"), { type: "ROLL", playerId: B });
    expect(Object.values(crownOf(one).players).every((p) => p.progress.length === 0)).toBe(true);
    const six = applyAction(withForcedRoll(s, [6, 2], "politics"), { type: "ROLL", playerId: B });
    expect(crownOf(six).players[C]!.progress).toHaveLength(1);
    expect(crownOf(six).players[B]!.progress).toHaveLength(0);
    // An empty deck draws nothing.
    const empty = mut(s, (x) => void (crownOf(x).decks.politics = []));
    const none = applyAction(withForcedRoll(empty, [6, 2], "politics"), { type: "ROLL", playerId: B });
    expect(crownOf(none).players[C]!.progress).toHaveLength(0);
  });

  it("docs/phase11.md §4 more than four unrevealed progress cards must be discarded at once; the card goes under its deck", () => {
    let s = inPhase(crownGame(), ROLL_PHASE, A);
    s = setTrack(s, C, "trade", 5);
    s = mut(s, (x) => {
      const cp = crownOf(x).players[C]!;
      cp.progress = [
        { card: "merchant", revealed: false },
        { card: "merchant", revealed: false },
        { card: "spy", revealed: false },
        { card: "wedding", revealed: false },
        { card: "printer", revealed: true },
      ];
      crownOf(x).decks.trade = ["masterMerchant", "merchantFleet"];
    });
    const drawn = applyAction(withForcedRoll(s, [5, 1], "trade"), { type: "ROLL", playerId: A });
    expect(drawn.phase.kind).toBe("modulePrompt");
    if (drawn.phase.kind !== "modulePrompt") throw new Error("unreachable");
    expect(drawn.phase.prompt).toEqual({ kind: "discardProgress", playerId: C, count: 1 });
    expect(drawn.phase.returnTo).toEqual({ kind: "action" });
    expect(nextActor(drawn)).toBe(C);
    const legal = legalActions(drawn, C);
    expect(legal.map((a) => a.type === "DISCARD_PROGRESS" && a.card).sort()).toEqual(["masterMerchant", "merchant", "spy", "wedding"]);
    expect(legalActions(drawn, A)).toEqual([]);
    expectRule(() => applyAction(drawn, { type: "DISCARD_PROGRESS", playerId: A, card: "merchant" }), "NOT_YOUR_PROMPT");
    expectRule(() => applyAction(drawn, { type: "DISCARD_PROGRESS", playerId: C, card: "printer" }), "NO_PROGRESS_CARD");
    expectRule(() => applyAction(drawn, { type: "DISCARD_PROGRESS", playerId: C, card: "bishop" }), "NO_PROGRESS_CARD");
    const { state: after, events } = applyActionWithEvents(drawn, { type: "DISCARD_PROGRESS", playerId: C, card: "spy" });
    expect(after.phase).toEqual({ kind: "action" });
    expect(crownOf(after).players[C]!.progress.filter((c) => !c.revealed)).toHaveLength(PROGRESS_HAND_LIMIT);
    expect(crownOf(after).decks.politics[crownOf(after).decks.politics.length - 1]).toBe("spy");
    expect(events.some((e) => e.kind === "progressDiscarded" && e.playerId === C && e.card === "spy")).toBe(true);
  });
});

describe("docs/phase11.md §3 science aid", () => {
  it("docs/phase11.md §3 at science 3 a roll that produces nothing for the player grants a resource of their choice", () => {
    let s = place(inPhase(crownGame(), ROLL_PHASE, A), A, { cities: [V1] });
    s = setTrack(s, B, "science", 3);
    s = setTrack(s, C, "science", 2);
    const on4 = applyAction(withNextCrownRoll(s, 4, "trade"), { type: "ROLL", playerId: A });
    expect(on4.phase.kind).toBe("chooseGold");
    if (on4.phase.kind !== "chooseGold") throw new Error("unreachable");
    expect(on4.phase.owed).toEqual({ [B]: 1 });
    expect(nextActor(on4)).toBe(B);
    const chosen = applyAction(on4, { type: "CHOOSE_GOLD", playerId: B, resources: ["ore"] });
    expect(getPlayer(chosen, B).hand.ore).toBe(1);
    expect(chosen.phase).toEqual({ kind: "action" });
    // A player at science 3 who did receive something gets no aid.
    const fed = place(setTrack(s, A, "science", 3), B, { settlements: [V4] });
    const on5 = applyAction(withNextCrownRoll(fed, 5, "trade"), { type: "ROLL", playerId: A });
    expect(on5.phase.kind).toBe("chooseGold");
    if (on5.phase.kind !== "chooseGold") throw new Error("unreachable");
    expect(on5.phase.owed).toEqual({ [A]: 1 });
    // A commodity counts as production too.
    const withCoin = setTrack(s, A, "science", 3);
    const on8 = applyAction(withNextCrownRoll(withCoin, 8, "trade"), { type: "ROLL", playerId: A });
    if (on8.phase.kind !== "chooseGold") throw new Error("expected gold for B only");
    expect(on8.phase.owed).toEqual({ [B]: 1 });
  });
});
