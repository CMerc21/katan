import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { describeEvent, redactEvents, type GameEvent } from "../src/events";
import { GEOMETRY } from "../src/geometry";
import { legalActions, legalSetupRoadEdges } from "../src/legal";
import { redact } from "../src/redact";
import { getPlayer, hand } from "../src/state";
import type { Action, GameState } from "../src/types";
import { ACTION_PHASE, ROLL_PHASE, centerCorner, edgeBetween, expectRule, finishSetup, give, hexWith, inPhase, mut, newGame, place, withNextRoll } from "./helpers";

const kinds = (events: GameEvent[]) => events.map((e) => e.kind);

function run(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  return applyActionWithEvents(state, action);
}

describe("docs/phase7.md §1 event stream", () => {
  it("§4 setup placements emit built + turnStarted, starting resources as produced, and setupCompleted at the end", () => {
    let state = newGame();
    const all: GameEvent[] = [];
    while (state.phase.kind === "setup") {
      const action = legalActions(state, state.players[state.currentPlayer]!.id)[0]!;
      const r = run(state, action);
      all.push(...r.events);
      state = r.state;
    }
    // Every settlement and road is a built event; the second round also pays resources.
    expect(all.filter((e) => e.kind === "built")).toHaveLength(16);
    expect(all.filter((e) => e.kind === "produced").length).toBeGreaterThanOrEqual(3);
    expect(all.at(-2)!.kind).toBe("setupCompleted");
    expect(all.at(-1)).toMatchObject({ kind: "turnStarted", playerId: "a", turn: 0 });
    // Sequence numbers are contiguous from 0 and match the state counter.
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i));
    expect(state.eventSeq).toBe(all.length);
  });

  it("§6.1 §6.2 a roll emits diceRolled then produced with per-hex gains", () => {
    let state = finishSetup(newGame());
    state = withNextRoll(state, 6);
    const r = run(state, { type: "ROLL", playerId: "a" });
    expect(kinds(r.events)[0]).toBe("diceRolled");
    expect(r.events[0]).toMatchObject({ kind: "diceRolled", playerId: "a" });
    const produced = r.events.find((e) => e.kind === "produced");
    if (produced?.kind === "produced") {
      for (const g of produced.gains) {
        expect(state.board.hexes[g.hex]!.token).toBe(6);
        expect(g.count === 1 || g.count === 2).toBe(true);
      }
      // Gains agree with the actual hand changes.
      for (const p of r.state.players) {
        const before = getPlayer(state, p.id).hand;
        const delta = produced.gains.filter((g) => g.playerId === p.id).reduce((n, g) => n + g.count, 0);
        const got = (["wood", "clay", "wool", "grain", "ore"] as const).reduce((n, x) => n + p.hand[x] - before[x], 0);
        expect(got).toBe(delta);
      }
    }
  });

  it("§6.2 the robber's hex emits productionBlocked instead of gains", () => {
    let state = inPhase(newGame(), ROLL_PHASE, "a");
    const hex = hexWith(state, "forest", 6);
    state = mut(state, (s) => void (s.robberHex = hex));
    state = place(state, "b", { settlements: [GEOMETRY.hexVertices[hex]![0]!] });
    state = withNextRoll(state, 6);
    const r = run(state, { type: "ROLL", playerId: "a" });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "productionBlocked", hex }));
    const produced = r.events.find((e) => e.kind === "produced");
    if (produced?.kind === "produced") expect(produced.gains.every((g) => g.hex !== hex)).toBe(true);
  });

  it("§6.2 a bank shortage emits bankShort after produced", () => {
    let state = inPhase(newGame(), ROLL_PHASE, "a");
    const hex = hexWith(state, "forest", 6);
    const verts = GEOMETRY.hexVertices[hex]!;
    state = place(place(state, "a", { cities: [verts[0]!] }), "b", { cities: [verts[3]!] });
    state = mut(state, (s) => {
      s.players[2]!.hand.wood += s.bank.wood - 1;
      s.bank.wood = 1;
    });
    state = withNextRoll(state, 6);
    const r = run(state, { type: "ROLL", playerId: "a" });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "bankShort", resource: "wood", playerId: null }));
    expect(r.state.log.some((l) => l.text.includes("nobody"))).toBe(true);
  });

  it("§7 a seven: diceRolled, discarded (with cards for the discarder only), robberMoved, stole (resource hidden from third parties)", () => {
    let state = withNextRoll(inPhase(newGame(), ROLL_PHASE, "a"), 7);
    const hex = hexWith(state, "forest", 11);
    const v0 = GEOMETRY.hexVertices[hex]![0]!;
    state = place(state, "b", { settlements: [v0] });
    state = give(state, "b", { wood: 8, ore: 2 });
    const rolled = run(state, { type: "ROLL", playerId: "a" });
    expect(kinds(rolled.events)).toEqual(["diceRolled"]);
    const discarded = run(rolled.state, { type: "DISCARD", playerId: "b", cards: hand({ wood: 5 }) });
    expect(discarded.events).toEqual([{ seq: rolled.state.eventSeq, kind: "discarded", playerId: "b", count: 5, cards: hand({ wood: 5 }) }]);
    expect(redactEvents(discarded.events, "b")[0]).toMatchObject({ cards: hand({ wood: 5 }) });
    expect(redactEvents(discarded.events, "a")[0]).toMatchObject({ cards: null });
    expect(redactEvents(discarded.events, "c")[0]).toMatchObject({ cards: null });

    const moved = run(discarded.state, { type: "MOVE_ROBBER", playerId: "a", hex });
    expect(moved.events).toEqual([{ seq: discarded.state.eventSeq, kind: "robberMoved", from: state.robberHex, to: hex, by: "a" }]);
    const stole = run(moved.state, { type: "STEAL", playerId: "a", targetPlayerId: "b" });
    expect(stole.events).toHaveLength(1);
    const e = stole.events[0]!;
    expect(e).toMatchObject({ kind: "stole", from: "b", to: "a" });
    if (e.kind !== "stole") throw new Error("unreachable");
    expect(e.resource === "wood" || e.resource === "ore").toBe(true);
    expect(redactEvents(stole.events, "a")[0]).toMatchObject({ resource: e.resource });
    expect(redactEvents(stole.events, "b")[0]).toMatchObject({ resource: e.resource });
    expect(redactEvents(stole.events, "c")[0]).toMatchObject({ resource: null });
    expect(redactEvents(stole.events, "d")[0]).toMatchObject({ resource: null });
    // The public log never names the card.
    expect(stole.state.log.at(-1)!.text).toBe("Ada stole a card from Bo");
  });

  it("§5 builds emit built with the piece and position; a city replaces a settlement", () => {
    const v0 = centerCorner(0);
    const edge = edgeBetween(v0, centerCorner(1));
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = place(state, "a", { settlements: [v0] });
    state = give(state, "a", { wood: 3, clay: 3, wool: 1, grain: 3, ore: 3 });
    const road = run(state, { type: "BUILD_ROAD", playerId: "a", edge });
    expect(road.events).toEqual([{ seq: state.eventSeq, kind: "built", playerId: "a", piece: "road", at: edge }]);
    const v1 = centerCorner(2);
    const road2 = run(road.state, { type: "BUILD_ROAD", playerId: "a", edge: edgeBetween(centerCorner(1), v1) });
    const settle = run(road2.state, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v1 });
    expect(kinds(settle.events)).toEqual(["built"]);
    expect(settle.events[0]).toMatchObject({ piece: "settlement", at: v1 });
    const city = run(settle.state, { type: "BUILD_CITY", playerId: "a", vertex: v0 });
    expect(city.events).toEqual([{ seq: settle.state.eventSeq, kind: "built", playerId: "a", piece: "city", at: v0 }]);
  });

  it("§10.1 taking Longest Road emits specialCardMoved right after the road", () => {
    const v0 = centerCorner(0);
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = place(state, "a", { settlements: [v0], roads: [0, 1, 2, 3].map((k) => edgeBetween(centerCorner(k), centerCorner(k + 1))) });
    state = give(state, "a", { wood: 1, clay: 1 });
    const r = run(state, { type: "BUILD_ROAD", playerId: "a", edge: edgeBetween(centerCorner(4), centerCorner(5)) });
    expect(kinds(r.events)).toEqual(["built", "specialCardMoved"]);
    expect(r.events[1]).toMatchObject({ card: "longestRoad", from: null, to: "a" });
    expect(r.state.log.at(-1)!.text).toBe("Ada takes Longest Road");
  });

  it("§8 dev cards: bought (type hidden from others), played knight then robber events, invention, monopoly", () => {
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = give(state, "a", { ore: 1, wool: 1, grain: 1 });
    const bought = run(state, { type: "BUY_DEV_CARD", playerId: "a" });
    expect(bought.events).toHaveLength(1);
    expect(bought.events[0]).toMatchObject({ kind: "devCardBought", playerId: "a", card: state.devDeck[0] });
    expect(redactEvents(bought.events, "b")[0]).toMatchObject({ card: null });
    expect(redactEvents(bought.events, "a")[0]).toMatchObject({ card: state.devDeck[0] });

    const withCards = mut(state, (s) => {
      s.turn = 3;
      s.players[0]!.devCards = [
        { type: "knight", boughtOnTurn: 1 },
        { type: "invention", boughtOnTurn: 1 },
        { type: "monopoly", boughtOnTurn: 1 },
      ];
    });
    const knight = run(withCards, { type: "PLAY_KNIGHT", playerId: "a" });
    expect(kinds(knight.events)).toEqual(["devCardPlayed"]);
    expect(knight.events[0]).toMatchObject({ card: "knight" });
    const invention = run(withCards, { type: "PLAY_INVENTION", playerId: "a", resources: ["wood", "ore"] });
    expect(kinds(invention.events)).toEqual(["devCardPlayed", "inventionTaken"]);
    expect(invention.events[1]).toMatchObject({ resources: ["wood", "ore"] });
    const rich = give(withCards, "b", { wood: 3 });
    const monopoly = run(rich, { type: "PLAY_MONOPOLY", playerId: "a", resource: "wood" });
    expect(kinds(monopoly.events)).toEqual(["devCardPlayed", "monopolised"]);
    expect(monopoly.events[1]).toMatchObject({ resource: "wood", taken: { b: 3, c: 0, d: 0 } });
    expect(monopoly.state.log.at(-1)!.text).toBe("Ada played monopoly on wood and took 3");
  });

  it("§10.2 the third knight emits specialCardMoved for Largest Army", () => {
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = mut(state, (s) => {
      s.turn = 3;
      s.players[0]!.playedKnights = 2;
      s.players[0]!.devCards = [{ type: "knight", boughtOnTurn: 1 }];
    });
    const r = run(state, { type: "PLAY_KNIGHT", playerId: "a" });
    expect(kinds(r.events)).toEqual(["devCardPlayed", "specialCardMoved"]);
    expect(r.events[1]).toMatchObject({ card: "largestArmy", from: null, to: "a" });
  });

  it("§9.1 trades: offered, declined, accepted, withdrawn, and cleared when everyone declines", () => {
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = give(give(state, "a", { wood: 1 }), "c", { ore: 1 });
    const offer = run(state, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) });
    expect(offer.events).toEqual([{ seq: state.eventSeq, kind: "tradeOffered", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) }]);
    const declined = run(offer.state, { type: "REJECT_TRADE", playerId: "b" });
    expect(declined.events).toEqual([{ seq: offer.state.eventSeq, kind: "tradeDeclined", playerId: "b", from: "a" }]);
    const accepted = run(declined.state, { type: "ACCEPT_TRADE", playerId: "c" });
    expect(accepted.events).toEqual([
      { seq: declined.state.eventSeq, kind: "tradeAccepted", from: "a", to: "c", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) },
    ]);
    const withdrawn = run(offer.state, { type: "CANCEL_TRADE", playerId: "a" });
    expect(withdrawn.events).toEqual([{ seq: offer.state.eventSeq, kind: "tradeCancelled", playerId: "a", reason: "withdrawn" }]);
    let s = declined.state;
    s = run(s, { type: "REJECT_TRADE", playerId: "c" }).state;
    const last = run(s, { type: "REJECT_TRADE", playerId: "d" });
    expect(kinds(last.events)).toEqual(["tradeDeclined", "tradeCancelled"]);
    expect(last.events[1]).toMatchObject({ reason: "everyoneDeclined" });
  });

  it("§9.1 an offer the offerer can no longer pay is withdrawn with reason unpayable", () => {
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = give(state, "a", { wood: 4 });
    state = run(state, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 4 }), receive: hand({ ore: 1 }) }).state;
    const r = run(state, { type: "MARITIME_TRADE", playerId: "a", give: "wood", giveCount: 4, receive: "ore" });
    expect(kinds(r.events)).toEqual(["maritimeTrade", "tradeCancelled"]);
    expect(r.events[0]).toMatchObject({ give: "wood", count: 4, receive: "ore" });
    expect(r.events[1]).toMatchObject({ reason: "unpayable" });
  });

  it("§6.3 END_TURN emits turnEnded then turnStarted for the next seat (and cancels an open offer)", () => {
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    state = give(state, "a", { wood: 1 });
    state = run(state, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) }).state;
    const r = run(state, { type: "END_TURN", playerId: "a" });
    expect(kinds(r.events)).toEqual(["tradeCancelled", "turnEnded", "turnStarted"]);
    expect(r.events[2]).toMatchObject({ playerId: "b", turn: 1 });
  });

  it("§11 the winning action ends with gameEnded carrying every player's score", () => {
    let state = inPhase(newGame(), ACTION_PHASE, "a");
    const v0 = centerCorner(0);
    state = place(state, "a", { settlements: [v0], cities: [centerCorner(2), centerCorner(4)] });
    state = mut(state, (s) => {
      s.players[0]!.devCards = Array.from({ length: 4 }, () => ({ type: "victoryPoint" as const, boughtOnTurn: 0 }));
    });
    state = give(state, "a", { grain: 2, ore: 3 });
    const r = run(state, { type: "BUILD_CITY", playerId: "a", vertex: v0 });
    expect(kinds(r.events)).toEqual(["built", "gameEnded"]);
    expect(r.events[1]).toMatchObject({ kind: "gameEnded", winner: "a", scores: { a: 10, b: 0, c: 0, d: 0 } });
    expect(r.state.log.at(-1)!.text).toBe("Ada wins");
  });

  it("§12 an illegal action emits nothing and leaves eventSeq untouched", () => {
    const state = newGame();
    expectRule(() => applyAction(state, { type: "ROLL", playerId: "a" }), "WRONG_PHASE");
    expect(state.eventSeq).toBe(0);
    expect(state.log).toEqual([]);
  });

  it("§12 the log is exactly the described events, and redact attaches redacted events to the view", () => {
    let state = newGame();
    const all: GameEvent[] = [];
    for (let i = 0; i < 8; i++) {
      const action = legalActions(state, state.players[state.currentPlayer]!.id)[0]!;
      const r = run(state, action);
      all.push(...r.events);
      state = r.state;
    }
    const names = (id: string) => getPlayer(state, id).name;
    const expected = all.map((e) => describeEvent(e, names)).filter((t): t is string => t !== null);
    expect(state.log.map((l) => l.text)).toEqual(expected);
    const view = redact(state, "b", all);
    expect(view.events).toEqual(redactEvents(all, "b"));
    expect(redact(state, "b").events).toEqual([]);
    void legalSetupRoadEdges;
  });
});
