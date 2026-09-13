import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import type { GameEvent } from "../src/events";
import { GEOMETRY, type EdgeId, type VertexId } from "../src/geometry";
import { legalActions } from "../src/legal";
import { improvementCost } from "../src/modules/crown/improvements";
import { knightAt } from "../src/modules/crown/knights";
import { inventorPairs, openRoads } from "../src/modules/crown/progressCards";
import { PROGRESS_DECKS, TRACKS, VP_PROGRESS_CARDS, trackOfCard, type ProgressCard } from "../src/modules/types";
import { getPlayer, handSize, nextActor, victoryPoints } from "../src/state";
import type { Action, GameState, PlayerId, ProgressPayload } from "../src/types";
import { ACTION_PHASE, ROLL_PHASE, clearStart, edgeBetween, expectRule, give, inPhase, mut, pathEdges, place, vertexPath, withNextRoll } from "./helpers";
import { A, B, C, D, addKnight, crownGame, crownOf, giveCommodities, setTrack, withNextCrownRoll } from "./crown-helpers";

// Beginner board corners (see the fixed layout in src/board.ts):
/** meadow 4 (1,0), mountain 8 (1,1), claypit 4 (2,0). */
const V1 = "1,0|1,1|2,0";
/** mountain 9 (1,-1), meadow 6 (2,-2), forest 9 (2,-1). */
const V3 = "1,-1|2,-2|2,-1";
/** farmland 5 (-1,0), farmland 3 (-1,1), wasteland. */
const V4 = "-1,0|-1,1|0,0";
/** forest 5 (-2,0) only; far from the others. */
const V6 = "-3,0|-2,-1|-2,0";
const FULL = { wood: 6, clay: 6, wool: 6, grain: 6, ore: 6 };

/** Deal cards from their decks into a hand (test setup only; conservation holds). */
function giveProgress(state: GameState, playerId: PlayerId, ...cards: ProgressCard[]): GameState {
  return mut(state, (s) => {
    const crown = crownOf(s);
    for (const card of cards) {
      const deck = crown.decks[trackOfCard(card)];
      const idx = deck.indexOf(card);
      if (idx < 0) throw new Error(`no ${card} left in the deck`);
      deck.splice(idx, 1);
      crown.players[playerId]!.progress.push({ card, revealed: VP_PROGRESS_CARDS.includes(card) });
    }
  });
}

/** A game in `phase` with `playerId` current and holding `cards`. */
function holding(playerId: PlayerId, phase: GameState["phase"], ...cards: ProgressCard[]): GameState {
  return giveProgress(inPhase(crownGame(), phase, playerId), playerId, ...cards);
}

function play(state: GameState, playerId: PlayerId, card: ProgressCard, payload?: ProgressPayload): { state: GameState; events: GameEvent[] } {
  return applyActionWithEvents(state, payload === undefined ? { type: "PLAY_PROGRESS", playerId, card } : { type: "PLAY_PROGRESS", playerId, card, payload });
}

function listed(state: GameState, playerId: PlayerId, card: ProgressCard): (ProgressPayload | undefined)[] {
  return legalActions(state, playerId)
    .filter((a): a is Extract<Action, { type: "PLAY_PROGRESS" }> => a.type === "PLAY_PROGRESS" && a.card === card)
    .map((a) => a.payload);
}

function held(state: GameState, playerId: PlayerId): ProgressCard[] {
  return crownOf(state).players[playerId]!.progress.map((c) => c.card);
}

function deckBottom(state: GameState, card: ProgressCard): ProgressCard {
  const deck = crownOf(state).decks[trackOfCard(card)];
  return deck[deck.length - 1]!;
}

/** A with a settlement at V1 and roads along the first `roads` steps of a path from it. */
function network(roads: number, phase: GameState["phase"] = ACTION_PHASE, playerId: PlayerId = A): { state: GameState; path: VertexId[] } {
  const path = vertexPath(V1, roads + 1);
  const state = place(inPhase(crownGame(), phase, playerId), playerId, { settlements: [V1], roads: pathEdges(path.slice(0, roads + 1)) });
  return { state, path };
}

function offPath(v: VertexId, path: readonly VertexId[]): VertexId {
  const m = GEOMETRY.vertexNeighbors[v]!.find((n) => !path.includes(n));
  if (!m) throw new Error("no side vertex");
  return m;
}

function totalCards(state: GameState, playerId: PlayerId): number {
  const cp = crownOf(state).players[playerId]!;
  return handSize(getPlayer(state, playerId).hand) + cp.commodities.cloth + cp.commodities.coin + cp.commodities.paper;
}

describe("docs/phase11.md §4 progress cards", () => {
  it("docs/phase11.md §4 timing: the card must be held, VP cards are never played, one card before the roll and any number after; a played card goes under its deck", () => {
    let s = holding(A, ROLL_PHASE, "warlord", "warlord", "constitution");
    expect(listed(s, A, "warlord")).toEqual([undefined]);
    expect(listed(s, A, "constitution")).toEqual([]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "constitution" }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "spy", payload: { targetPlayerId: B } }), "NO_PROGRESS_CARD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: B, card: "warlord" }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "nonsense" as ProgressCard }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(inPhase(s, { kind: "discard", returnTo: ACTION_PHASE }), { type: "PLAY_PROGRESS", playerId: A, card: "warlord" }), "WRONG_PHASE");
    const { state: one, events } = play(s, A, "warlord");
    expect(events[0]).toMatchObject({ kind: "progressPlayed", playerId: A, card: "warlord" });
    expect(held(one, A)).toEqual(["warlord", "constitution"]);
    expect(deckBottom(one, "warlord")).toBe("warlord");
    expect(crownOf(one).players[A]).toMatchObject({ progressPlayedThisTurn: 1, progressPlayedBeforeRoll: true });
    expectRule(() => applyAction(one, { type: "PLAY_PROGRESS", playerId: A, card: "warlord" }), "PROGRESS_BEFORE_ROLL");
    expect(legalActions(one, A).some((a) => a.type === "PLAY_PROGRESS")).toBe(false);
    // After the roll any number may follow.
    s = applyAction(withNextRoll(giveProgress(one, A, "warlord"), 6), { type: "ROLL", playerId: A });
    expect(s.phase).toEqual(ACTION_PHASE);
    s = play(play(s, A, "warlord").state, A, "warlord").state;
    expect(crownOf(s).players[A]!.progressPlayedThisTurn).toBe(3);
    expect(held(s, A)).toEqual(["constitution"]);
    const next = applyAction(s, { type: "END_TURN", playerId: A });
    expect(crownOf(next).players[A]).toMatchObject({ progressPlayedThisTurn: 0, progressPlayedBeforeRoll: false });
    // Cards that build or trade wait for the action phase; the alchemist only works before the roll.
    expectRule(() => applyAction(holding(A, ROLL_PHASE, "roadBuilding"), { type: "PLAY_PROGRESS", playerId: A, card: "roadBuilding" }), "WRONG_PHASE");
    expectRule(() => applyAction(holding(A, ROLL_PHASE, "crane"), { type: "PLAY_PROGRESS", playerId: A, card: "crane" }), "WRONG_PHASE");
    expect(listed(holding(A, ROLL_PHASE, "crane"), A, "crane")).toEqual([]);
    expectRule(() => applyAction(holding(A, ACTION_PHASE, "alchemist"), { type: "PLAY_PROGRESS", playerId: A, card: "alchemist", payload: { dice: [1, 2] } }), "WRONG_PHASE");
  });

  // --- Trade -------------------------------------------------------------------

  it("docs/phase11.md §4 Merchant goes on a hex the player has a building on, grants 2:1 for its resource and 1 VP, and changes hands", () => {
    let s = place(holding(A, ACTION_PHASE, "merchant"), A, { settlements: [V1] });
    s = give(s, A, { wool: 2 });
    expect(listed(s, A, "merchant")).toEqual([{ hex: "1,0" }, { hex: "1,1" }, { hex: "2,0" }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "merchant", payload: { hex: "0,1" } }), "HEX_NOT_TOUCHED");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "merchant", payload: { hex: "9,9" } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "merchant" }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(inPhase(s, ROLL_PHASE), { type: "PLAY_PROGRESS", playerId: A, card: "merchant", payload: { hex: "1,0" } }), "WRONG_PHASE");
    const before = victoryPoints(s, getPlayer(s, A)).total;
    const { state: placed, events } = play(s, A, "merchant", { hex: "1,0" });
    expect(crownOf(placed).merchant).toEqual({ playerId: A, hex: "1,0" });
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed", "merchantPlaced"]);
    expect(events[1]).toMatchObject({ kind: "merchantPlaced", playerId: A, hex: "1,0", from: null });
    expect(victoryPoints(placed, getPlayer(placed, A)).total).toBe(before + 1);
    expect(legalActions(placed, A).some((a) => a.type === "MARITIME_TRADE" && a.give === "wool" && a.giveCount === 2 && a.receive === "ore")).toBe(true);
    const traded = applyAction(placed, { type: "MARITIME_TRADE", playerId: A, give: "wool", giveCount: 2, receive: "ore" });
    expect(getPlayer(traded, A).hand).toMatchObject({ wool: 0, ore: 1 });
    // B takes the merchant away.
    let b = place(inPhase(giveProgress(placed, B, "merchant"), ACTION_PHASE, B), B, { settlements: [V4] });
    const { state: taken, events: takeEvents } = play(b, B, "merchant", { hex: "-1,0" });
    expect(crownOf(taken).merchant).toEqual({ playerId: B, hex: "-1,0" });
    expect(takeEvents[1]).toMatchObject({ kind: "merchantPlaced", playerId: B, from: A });
    expect(victoryPoints(taken, getPlayer(taken, A)).total).toBe(before);
    b = taken;
  });

  it("docs/phase11.md §4 Trade Monopoly takes one of a named commodity from every other player who has it", () => {
    let s = giveCommodities(giveCommodities(holding(A, ACTION_PHASE, "tradeMonopoly"), B, { cloth: 2 }), C, { cloth: 1, coin: 3 });
    expect(listed(s, A, "tradeMonopoly")).toEqual([{ commodity: "cloth" }, { commodity: "coin" }, { commodity: "paper" }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "tradeMonopoly", payload: { commodity: "wood" as never } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(inPhase(s, ROLL_PHASE), { type: "PLAY_PROGRESS", playerId: A, card: "tradeMonopoly", payload: { commodity: "cloth" } }), "WRONG_PHASE");
    const { state: after, events } = play(s, A, "tradeMonopoly", { commodity: "cloth" });
    expect(crownOf(after).players[A]!.commodities).toEqual({ cloth: 2, coin: 0, paper: 0 });
    expect(crownOf(after).players[B]!.commodities.cloth).toBe(1);
    expect(crownOf(after).players[C]!.commodities).toEqual({ cloth: 0, coin: 3, paper: 0 });
    expect(events[1]).toEqual({ seq: expect.any(Number), kind: "commodityMonopolised", playerId: A, commodity: "cloth", taken: { [B]: 1, [C]: 1, [D]: 0 } });
    s = after;
  });

  it("docs/phase11.md §4 Resource Monopoly takes up to two of a named resource from every other player", () => {
    const s = give(give(holding(A, ACTION_PHASE, "resourceMonopoly"), B, { wood: 3 }), C, { wood: 1 });
    expect(listed(s, A, "resourceMonopoly")).toHaveLength(5);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "resourceMonopoly", payload: { resource: "cloth" as never } }), "INVALID_PAYLOAD");
    const { state: after, events } = play(s, A, "resourceMonopoly", { resource: "wood" });
    expect(getPlayer(after, A).hand.wood).toBe(3);
    expect(getPlayer(after, B).hand.wood).toBe(1);
    expect(getPlayer(after, C).hand.wood).toBe(0);
    expect(events[1]).toMatchObject({ kind: "resourceMonopolised", playerId: A, resource: "wood", taken: { [B]: 2, [C]: 1, [D]: 0 } });
  });

  it("docs/phase11.md §4 Master Merchant takes two random cards (resources or commodities) from a player with more victory points", () => {
    let s = place(holding(A, ACTION_PHASE, "masterMerchant", "masterMerchant"), B, { settlements: [V4, V6] });
    s = giveCommodities(give(s, B, { wood: 3 }), B, { cloth: 1 });
    s = place(give(s, C, { ore: 5 }), C, { settlements: [V3] });
    s = place(s, A, { settlements: [V1] }); // A 1 VP, B 2, C 1
    expect(listed(s, A, "masterMerchant")).toEqual([{ targetPlayerId: B }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "masterMerchant", payload: { targetPlayerId: C } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "masterMerchant", payload: { targetPlayerId: A } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "masterMerchant", payload: { targetPlayerId: "zz" } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "masterMerchant" }), "INVALID_PAYLOAD");
    const { state: after, events } = play(s, A, "masterMerchant", { targetPlayerId: B });
    expect(totalCards(after, A)).toBe(2);
    expect(totalCards(after, B)).toBe(2);
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed", "stole", "stole", "cardsTaken"]);
    expect(events[3]).toMatchObject({ kind: "cardsTaken", from: B, to: A, count: 2, what: "cards" });
    // Only one card to take: one is taken.
    const poor = mut(s, (x) => {
      getPlayer(x, B).hand.wood = 0;
      x.bank.wood += 3;
    });
    const { state: one, events: oneEvents } = play(poor, A, "masterMerchant", { targetPlayerId: B });
    expect(crownOf(one).players[A]!.commodities.cloth).toBe(1);
    expect(oneEvents.find((e) => e.kind === "cardsTaken")).toMatchObject({ count: 1 });
    // A richer player with no cards is not a target.
    const empty = mut(poor, (x) => void (crownOf(x).players[B]!.commodities.cloth = 0));
    expect(listed(empty, A, "masterMerchant")).toEqual([]);
    expectRule(() => applyAction(empty, { type: "PLAY_PROGRESS", playerId: A, card: "masterMerchant", payload: { targetPlayerId: B } }), "INVALID_CHOICE");
  });

  it("docs/phase11.md §4 Merchant Fleet trades one named resource or commodity at 2:1 for the rest of the turn", () => {
    const s = giveCommodities(give(holding(A, ACTION_PHASE, "merchantFleet", "merchantFleet"), A, { wool: 2 }), A, { paper: 2 });
    expect(listed(s, A, "merchantFleet")).toHaveLength(8);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "merchantFleet", payload: { card: "gold" as never } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "MARITIME_TRADE", playerId: A, give: "wool", giveCount: 2, receive: "ore" }), "BAD_TRADE_RATIO");
    const { state: fleet } = play(s, A, "merchantFleet", { card: "wool" });
    expect(crownOf(fleet).players[A]!.merchantFleet).toBe("wool");
    expect(legalActions(fleet, A).some((a) => a.type === "MARITIME_TRADE" && a.give === "wool" && a.giveCount === 2)).toBe(true);
    expect(getPlayer(applyAction(fleet, { type: "MARITIME_TRADE", playerId: A, give: "wool", giveCount: 2, receive: "ore" }), A).hand).toMatchObject({ wool: 0, ore: 1 });
    const { state: paper } = play(s, A, "merchantFleet", { card: "paper" });
    const swapped = applyAction(paper, { type: "MARITIME_TRADE", playerId: A, give: "paper", giveCount: 2, receive: "grain" });
    expect(crownOf(swapped).players[A]!.commodities.paper).toBe(0);
    expect(getPlayer(swapped, A).hand.grain).toBe(1);
    expect(crownOf(applyAction(fleet, { type: "END_TURN", playerId: A })).players[A]!.merchantFleet).toBeNull();
  });

  it("docs/phase11.md §4 Commercial Harbor: every other player holding a commodity swaps one of their choice for one of the player's resources, in seat order, while the resources last", () => {
    let s = give(holding(A, ACTION_PHASE, "commercialHarbor", "commercialHarbor"), A, { grain: 2 });
    s = giveCommodities(giveCommodities(s, B, { cloth: 1 }), D, { coin: 1, paper: 1 });
    expect(listed(s, A, "commercialHarbor")).toEqual([{ resource: "grain" }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "commercialHarbor", payload: { resource: "wood" } }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "commercialHarbor", payload: { resource: "cloth" as never } }), "INVALID_PAYLOAD");
    const { state: asked, events } = play(s, A, "commercialHarbor", { resource: "grain" });
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(asked.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "commercialHarbor", playerId: B, by: A, pending: [D], resource: "grain" }, returnTo: ACTION_PHASE });
    expect(nextActor(asked)).toBe(B);
    expect(legalActions(asked, B)).toEqual([{ type: "COMMERCIAL_SWAP", playerId: B, commodity: "cloth" }]);
    expect(legalActions(asked, A)).toEqual([]);
    expectRule(() => applyAction(asked, { type: "COMMERCIAL_SWAP", playerId: B, commodity: "coin" }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(asked, { type: "COMMERCIAL_SWAP", playerId: D, commodity: "coin" }), "NOT_YOUR_PROMPT");
    const { state: first, events: swap } = applyActionWithEvents(asked, { type: "COMMERCIAL_SWAP", playerId: B, commodity: "cloth" });
    expect(swap).toEqual([{ seq: expect.any(Number), kind: "commercialSwap", by: A, with: B, resource: "grain", commodity: "cloth" }]);
    expect(getPlayer(first, B).hand.grain).toBe(1);
    expect(crownOf(first).players[B]!.commodities.cloth).toBe(0);
    expect(crownOf(first).players[A]!.commodities.cloth).toBe(1);
    expect(getPlayer(first, A).hand.grain).toBe(1);
    expect(first.phase).toMatchObject({ kind: "modulePrompt", prompt: { kind: "commercialHarbor", playerId: D, pending: [] } });
    expect(legalActions(first, D)).toEqual([
      { type: "COMMERCIAL_SWAP", playerId: D, commodity: "coin" },
      { type: "COMMERCIAL_SWAP", playerId: D, commodity: "paper" },
    ]);
    const done = applyAction(first, { type: "COMMERCIAL_SWAP", playerId: D, commodity: "paper" });
    expect(done.phase).toEqual(ACTION_PHASE);
    expect(getPlayer(done, A).hand.grain).toBe(0);
    expect(crownOf(done).players[A]!.commodities).toEqual({ cloth: 1, coin: 0, paper: 1 });
    // Out of grain after the first swap: the chain ends early.
    const oneGrain = mut(s, (x) => {
      getPlayer(x, A).hand.grain = 1;
      x.bank.grain += 1;
    });
    const short = applyAction(play(oneGrain, A, "commercialHarbor", { resource: "grain" }).state, { type: "COMMERCIAL_SWAP", playerId: B, commodity: "cloth" });
    expect(short.phase).toEqual(ACTION_PHASE);
    // Nobody holds a commodity: the card is spent for nothing.
    const nobody = mut(s, (x) => {
      for (const id of [B, C, D]) {
        const cp = crownOf(x).players[id]!;
        for (const c of ["cloth", "coin", "paper"] as const) {
          crownOf(x).bank[c] += cp.commodities[c];
          cp.commodities[c] = 0;
        }
      }
    });
    expect(play(nobody, A, "commercialHarbor", { resource: "grain" }).state.phase).toEqual(ACTION_PHASE);
  });

  // --- Politics ----------------------------------------------------------------

  it("docs/phase11.md §4 Bishop moves the robber (once the fleet has attacked) and takes a random card from every player with a building there", () => {
    let s = place(give(holding(A, ACTION_PHASE, "bishop"), B, { wood: 2 }), B, { settlements: [V1] });
    s = place(s, C, { settlements: [V3] });
    expect(listed(s, A, "bishop")).toEqual([]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "bishop", payload: { hex: "1,0" } }), "ROBBER_LOCKED");
    s = mut(s, (x) => void (crownOf(x).attacks = 1));
    expect(listed(s, A, "bishop")).toHaveLength(18);
    expect(listed(s, A, "bishop")).not.toContainEqual({ hex: "0,0" });
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "bishop", payload: { hex: "0,0" } }), "ROBBER_MUST_MOVE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "bishop", payload: { hex: "3,3" } }), "INVALID_PAYLOAD");
    const { state: after, events } = play(s, A, "bishop", { hex: "1,0" });
    expect(after.robberHex).toBe("1,0");
    expect(after.phase).toEqual(ACTION_PHASE);
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed", "robberMoved", "stole"]);
    expect(events[1]).toMatchObject({ kind: "robberMoved", from: "0,0", to: "1,0", by: A });
    expect(events[2]).toMatchObject({ kind: "stole", from: B, to: A, resource: "wood" });
    expect(getPlayer(after, A).hand.wood).toBe(1);
    expect(getPlayer(after, B).hand.wood).toBe(1);
    // A hex nobody with cards touches: the robber still moves.
    const { state: quiet, events: quietEvents } = play(s, A, "bishop", { hex: "1,-1" });
    expect(quiet.robberHex).toBe("1,-1");
    expect(quietEvents.map((e) => e.kind)).toEqual(["progressPlayed", "robberMoved"]);
    // Before the roll too.
    const early = play(inPhase(s, ROLL_PHASE), A, "bishop", { hex: "1,0" }).state;
    expect(early.phase).toEqual(ROLL_PHASE);
  });

  it("docs/phase11.md §4 Deserter: the chosen player removes a knight of theirs, and the player places one of the same level for free (if a piece and a place exist)", () => {
    const { state: base, path } = network(2);
    const [, n1, n2] = path as [VertexId, VertexId, VertexId];
    let s = giveProgress(base, A, "deserter", "deserter", "deserter");
    s = addKnight(addKnight(s, B, V4, 2, true), B, V6, 1, false);
    expect(listed(s, A, "deserter")).toEqual([{ targetPlayerId: B }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "deserter", payload: { targetPlayerId: C } }), "NO_KNIGHT");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "deserter", payload: { targetPlayerId: A } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "deserter" }), "INVALID_PAYLOAD");
    const { state: asked, events } = play(s, A, "deserter", { targetPlayerId: B });
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(asked.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "deserter", playerId: B, by: A }, returnTo: ACTION_PHASE });
    expect(nextActor(asked)).toBe(B);
    expect(legalActions(asked, B)).toEqual([
      { type: "CHOOSE_DESERTER", playerId: B, vertex: V4 },
      { type: "CHOOSE_DESERTER", playerId: B, vertex: V6 },
    ]);
    expectRule(() => applyAction(asked, { type: "CHOOSE_DESERTER", playerId: A, vertex: V4 }), "NOT_YOUR_PROMPT");
    expectRule(() => applyAction(asked, { type: "CHOOSE_DESERTER", playerId: B, vertex: n1 }), "NO_KNIGHT");
    const { state: chosen, events: chooseEvents } = applyActionWithEvents(asked, { type: "CHOOSE_DESERTER", playerId: B, vertex: V4 });
    expect(chooseEvents).toEqual([{ seq: expect.any(Number), kind: "knightRemoved", playerId: B, vertex: V4, reason: "deserter" }]);
    expect(knightAt(chosen, V4)).toBeNull();
    expect(chosen.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "placeFreeKnight", playerId: A, level: 2, active: false }, returnTo: ACTION_PHASE });
    expect(legalActions(chosen, A)).toEqual([
      { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: n1 },
      { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: n2 },
      { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: null },
    ]);
    expectRule(() => applyAction(chosen, { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: V4 }), "INVALID_CHOICE");
    const { state: placed, events: placeEvents } = applyActionWithEvents(chosen, { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: n1 });
    expect(placeEvents).toEqual([{ seq: expect.any(Number), kind: "knightBuilt", playerId: A, vertex: n1 }]);
    expect(knightAt(placed, n1)).toMatchObject({ owner: A, level: 2, active: false, actedThisTurn: true });
    expect(placed.phase).toEqual(ACTION_PHASE);
    expect(getPlayer(placed, A).hand).toEqual(getPlayer(s, A).hand);
    // Declining leaves nothing on the board.
    const declined = applyAction(chosen, { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: null });
    expect(declined.phase).toEqual(ACTION_PHASE);
    expect(crownOf(declined).knights.filter((k) => k.owner === A)).toHaveLength(0);
    // No strong piece left for A: the victim's choice ends the card.
    const full = addKnight(addKnight(s, A, n1, 2), A, n2, 2);
    const noPiece = applyAction(play(full, A, "deserter", { targetPlayerId: B }).state, { type: "CHOOSE_DESERTER", playerId: B, vertex: V4 });
    expect(noPiece.phase).toEqual(ACTION_PHASE);
    // Before the roll: the prompt chain wraps the roll phase and play returns there.
    const early = play(inPhase(s, ROLL_PHASE), A, "deserter", { targetPlayerId: B }).state;
    const back = applyAction(applyAction(early, { type: "CHOOSE_DESERTER", playerId: B, vertex: V6 }), { type: "PLACE_FREE_KNIGHT", playerId: A, vertex: n2 });
    expect(back.phase).toEqual(ROLL_PHASE);
    expect(knightAt(back, n2)).toMatchObject({ owner: A, level: 1 });
    expect(legalActions(back, A).some((a) => a.type === "ROLL")).toBe(true);
  });

  it("docs/phase11.md §4 Diplomat removes an open road of any player; the player's own road may be placed again for free", () => {
    const { state: base, path } = network(2);
    const [, n1, n2] = path as [VertexId, VertexId, VertexId];
    const e1 = edgeBetween(V1, n1);
    const e2 = edgeBetween(n1, n2);
    const side = offPath(n1, path);
    const e3 = edgeBetween(n1, side);
    let s = giveProgress(base, A, "diplomat", "diplomat");
    const bRoad = edgeBetween(V4, GEOMETRY.vertexNeighbors[V4]![0]!);
    s = place(s, B, { settlements: [V4], roads: [bRoad] });
    expect(openRoads(s)).toEqual([
      { edge: e2, owner: A },
      { edge: bRoad, owner: B },
    ]);
    const options = listed(s, A, "diplomat");
    expect(options).toContainEqual({ edge: e2 });
    expect(options).toContainEqual({ edge: e2, relocateTo: e3 });
    expect(options).toContainEqual({ edge: bRoad });
    expect(options.some((p) => p?.edge === bRoad && p.relocateTo !== undefined)).toBe(false);
    expect(options.some((p) => p?.edge === e1)).toBe(false);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "diplomat", payload: { edge: e1 } }), "NOT_OPEN_END");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "diplomat", payload: { edge: e3 } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "diplomat", payload: { edge: "nope" } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "diplomat", payload: { edge: bRoad, relocateTo: e3 } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "diplomat", payload: { edge: e2, relocateTo: bRoad } }), "ROAD_NOT_CONNECTED");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "diplomat", payload: { edge: e2, relocateTo: e2 } }), "INVALID_CHOICE");
    // Remove B's road: it returns to B's supply.
    const { state: removed, events } = play(s, A, "diplomat", { edge: bRoad });
    expect(getPlayer(removed, B).roads).toEqual([]);
    expect(getPlayer(removed, B).pieces.roads).toBe(15);
    expect(events[1]).toMatchObject({ kind: "roadRemoved", playerId: A, owner: B, edge: bRoad, relocatedTo: null });
    // Move an own road.
    const { state: moved, events: moveEvents } = play(s, A, "diplomat", { edge: e2, relocateTo: e3 });
    expect(getPlayer(moved, A).roads.sort()).toEqual([e1, e3].sort());
    expect(getPlayer(moved, A).pieces.roads).toBe(13);
    expect(getPlayer(moved, A).hand).toEqual(getPlayer(s, A).hand);
    expect(moveEvents[1]).toMatchObject({ kind: "roadRemoved", owner: A, edge: e2, relocatedTo: e3 });
    // Longest Road is re-evaluated: cutting the end of a five-road trail loses the card.
    const start = clearStart(5, [V1, n1, n2, side]);
    const trail = vertexPath(start, 5);
    let long = place(inPhase(giveProgress(crownGame(), B, "diplomat"), ACTION_PHASE, B), A, { roads: pathEdges(trail) });
    expect(long.longestRoad).toEqual({ playerId: A, length: 5 });
    const { state: cut, events: cutEvents } = play(long, B, "diplomat", { edge: edgeBetween(trail[4]!, trail[5]!) });
    expect(cut.longestRoad).toEqual({ playerId: null, length: 0 });
    expect(cutEvents.some((e) => e.kind === "specialCardMoved" && e.from === A && e.to === null)).toBe(true);
    long = cut;
  });

  it("docs/phase11.md §4 Intrigue removes an opposing knight standing on a vertex the player's roads touch", () => {
    const { state: base, path } = network(2);
    const [, n1, n2, n3] = path as [VertexId, VertexId, VertexId, VertexId];
    let s = giveProgress(base, A, "intrigue", "intrigue");
    s = addKnight(addKnight(addKnight(s, B, n1, 2, true), B, n3, 1), A, n2, 1);
    expect(listed(s, A, "intrigue")).toEqual([{ vertex: n1 }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "intrigue", payload: { vertex: n3 } }), "KNIGHT_NOT_CONNECTED");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "intrigue", payload: { vertex: n2 } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "intrigue", payload: { vertex: V1 } }), "NO_KNIGHT");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "intrigue", payload: { vertex: "x" } }), "INVALID_PAYLOAD");
    const { state: after, events } = play(s, A, "intrigue", { vertex: n1 });
    expect(knightAt(after, n1)).toBeNull();
    expect(crownOf(after).knights).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: "knightRemoved", playerId: B, vertex: n1, reason: "intrigue" });
    // Removing the knight restores the broken road for Longest Road.
    const start = clearStart(5, [V1, n1, n2, n3]);
    const trail = vertexPath(start, 5);
    let long = place(inPhase(giveProgress(crownGame(), A, "intrigue"), ACTION_PHASE, A), A, { roads: pathEdges(trail) });
    long = addKnight(long, B, trail[2]!);
    long = mut(long, (x) => void (x.longestRoad = { playerId: null, length: 0 }));
    const { state: healed } = play(long, A, "intrigue", { vertex: trail[2]! });
    expect(healed.longestRoad).toEqual({ playerId: A, length: 5 });
  });

  it("docs/phase11.md §4 Saboteur: every player with more victory points discards half their cards (rounded down)", () => {
    let s = place(holding(A, ACTION_PHASE, "saboteur", "saboteur"), B, { settlements: [V4, V6] });
    s = giveCommodities(give(s, B, { wood: 3 }), B, { cloth: 2 }); // 5 cards -> 2
    s = place(give(s, C, { ore: 1 }), C, { settlements: [V3] }); // 1 card -> 0
    s = give(s, D, { wool: 8 }); // no more VP than A
    expect(listed(s, A, "saboteur")).toEqual([undefined]);
    const { state: after, events } = play(s, A, "saboteur");
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(after.phase).toEqual({ kind: "discard", returnTo: ACTION_PHASE });
    expect(after.pendingDiscards).toEqual({ [B]: 2 });
    expect(nextActor(after)).toBe(B);
    const discarded = applyAction(after, { type: "DISCARD", playerId: B, cards: { wood: 1, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 1, coin: 0, paper: 0 } });
    expect(discarded.phase).toEqual(ACTION_PHASE);
    expect(totalCards(discarded, B)).toBe(3);
    // Before the roll: the discards wrap the roll phase.
    const early = play(inPhase(s, ROLL_PHASE), A, "saboteur").state;
    expect(early.phase).toEqual({ kind: "discard", returnTo: ROLL_PHASE });
    // Nobody richer: nothing happens.
    const rich = place(s, A, { settlements: [V1], cities: ["-2,2|-1,1|-1,2"] });
    expect(play(rich, A, "saboteur").state.phase).toEqual(ACTION_PHASE);
  });

  it("docs/phase11.md §4 Spy looks at a player's progress cards and takes one; the hand limit still applies afterwards", () => {
    let s = holding(A, ACTION_PHASE, "spy", "spy");
    s = giveProgress(s, B, "merchant", "constitution", "warlord");
    expect(listed(s, A, "spy")).toEqual([{ targetPlayerId: B }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "spy", payload: { targetPlayerId: C } }), "NO_PROGRESS_CARD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "spy", payload: { targetPlayerId: A } }), "INVALID_CHOICE");
    const { state: asked, events } = play(s, A, "spy", { targetPlayerId: B });
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(asked.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "spy", playerId: A, target: B }, returnTo: ACTION_PHASE });
    expect(legalActions(asked, A)).toEqual([
      { type: "SPY_TAKE", playerId: A, card: "merchant" },
      { type: "SPY_TAKE", playerId: A, card: "warlord" },
    ]);
    expectRule(() => applyAction(asked, { type: "SPY_TAKE", playerId: A, card: "constitution" }), "INVALID_CHOICE");
    expectRule(() => applyAction(asked, { type: "SPY_TAKE", playerId: A, card: "bishop" }), "INVALID_CHOICE");
    expectRule(() => applyAction(asked, { type: "SPY_TAKE", playerId: B, card: "merchant" }), "NOT_YOUR_PROMPT");
    const { state: taken, events: takeEvents } = applyActionWithEvents(asked, { type: "SPY_TAKE", playerId: A, card: "warlord" });
    expect(takeEvents).toEqual([{ seq: expect.any(Number), kind: "cardsTaken", from: B, to: A, count: 1, what: "progress" }]);
    expect(held(taken, A)).toEqual(["spy", "warlord"]);
    expect(held(taken, B)).toEqual(["merchant", "constitution"]);
    expect(taken.phase).toEqual(ACTION_PHASE);
    // A full hand after the take must discard at once.
    const full = giveProgress(s, A, "crane", "mining", "irrigation");
    const over = applyAction(play(full, A, "spy", { targetPlayerId: B }).state, { type: "SPY_TAKE", playerId: A, card: "merchant" });
    expect(over.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "discardProgress", playerId: A, count: 1 }, returnTo: ACTION_PHASE });
    expect(applyAction(over, { type: "DISCARD_PROGRESS", playerId: A, card: "merchant" }).phase).toEqual(ACTION_PHASE);
    // A player with only face-up VP cards has nothing to spy on.
    const bare = giveProgress(holding(A, ACTION_PHASE, "spy"), C, "printer");
    expect(listed(bare, A, "spy")).toEqual([]);
  });

  it("docs/phase11.md §4 Warlord activates every inactive knight of the player for free; they act from the next turn", () => {
    const { state: base, path } = network(3);
    const [, n1, n2, n3] = path as [VertexId, VertexId, VertexId, VertexId];
    let s = giveProgress(base, A, "warlord", "warlord");
    s = addKnight(addKnight(addKnight(s, A, n1, 1, false), A, n2, 2, true), B, n3, 1, false);
    const { state: after, events } = play(s, A, "warlord");
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed", "knightActivated"]);
    expect(events[1]).toMatchObject({ kind: "knightActivated", playerId: A, vertex: n1, free: true });
    expect(knightAt(after, n1)).toMatchObject({ active: true, actedThisTurn: true });
    expect(knightAt(after, n2)).toMatchObject({ active: true, actedThisTurn: false });
    expect(knightAt(after, n3)).toMatchObject({ active: false });
    expect(getPlayer(after, A).hand).toEqual(getPlayer(s, A).hand);
    expect(legalActions(after, A).some((a) => a.type === "KNIGHT_MOVE" && a.from === n1)).toBe(false);
    // Before the roll (the classic use: before the event die may bring the fleet).
    const early = play(inPhase(s, ROLL_PHASE), A, "warlord").state;
    expect(early.phase).toEqual(ROLL_PHASE);
    expect(knightAt(early, n1)).toMatchObject({ active: true });
    expectRule(() => applyAction(early, { type: "PLAY_PROGRESS", playerId: A, card: "warlord" }), "PROGRESS_BEFORE_ROLL");
  });

  it("docs/phase11.md §4 Wedding: every player with more victory points gives two cards of their choice (one if that is all they hold)", () => {
    let s = place(holding(A, ACTION_PHASE, "wedding", "wedding"), B, { settlements: [V4, V6] });
    s = giveCommodities(give(s, B, { wood: 1 }), B, { cloth: 2 });
    s = place(give(s, C, { ore: 1 }), C, { settlements: [V3] });
    s = give(s, D, { wool: 8 });
    expect(listed(s, A, "wedding")).toEqual([undefined]);
    const { state: asked, events } = play(s, A, "wedding");
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(asked.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "giveCards", playerId: B, pending: [C], to: A, count: 2 }, returnTo: ACTION_PHASE });
    expect(legalActions(asked, B)).toEqual([
      { type: "GIVE_CARDS", playerId: B, cards: { wood: 1, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 1, coin: 0, paper: 0 } },
      { type: "GIVE_CARDS", playerId: B, cards: { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 2, coin: 0, paper: 0 } },
    ]);
    expectRule(() => applyAction(asked, { type: "GIVE_CARDS", playerId: B, cards: { wood: 1, clay: 0, wool: 0, grain: 0, ore: 0 } }), "WRONG_DISCARD_COUNT");
    expectRule(() => applyAction(asked, { type: "GIVE_CARDS", playerId: B, cards: { wood: 2, clay: 0, wool: 0, grain: 0, ore: 0 } }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(asked, { type: "GIVE_CARDS", playerId: B, cards: { wood: 1, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 0, coin: 1, paper: 0 } }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(asked, { type: "GIVE_CARDS", playerId: C, cards: { wood: 0, clay: 0, wool: 0, grain: 0, ore: 1 } }), "NOT_YOUR_PROMPT");
    const { state: first, events: giveEvents } = applyActionWithEvents(asked, { type: "GIVE_CARDS", playerId: B, cards: { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 }, commodities: { cloth: 2, coin: 0, paper: 0 } });
    expect(giveEvents).toEqual([{ seq: expect.any(Number), kind: "cardsTaken", from: B, to: A, count: 2, what: "cards" }]);
    expect(crownOf(first).players[A]!.commodities.cloth).toBe(2);
    expect(crownOf(first).players[B]!.commodities.cloth).toBe(0);
    expect(first.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "giveCards", playerId: C, pending: [], to: A, count: 1 }, returnTo: ACTION_PHASE });
    expect(legalActions(first, C)).toEqual([{ type: "GIVE_CARDS", playerId: C, cards: { wood: 0, clay: 0, wool: 0, grain: 0, ore: 1 } }]);
    const done = applyAction(first, { type: "GIVE_CARDS", playerId: C, cards: { wood: 0, clay: 0, wool: 0, grain: 0, ore: 1 } });
    expect(done.phase).toEqual(ACTION_PHASE);
    expect(getPlayer(done, A).hand.ore).toBe(1);
    expect(getPlayer(done, D).hand.wool).toBe(8);
    // Nobody richer: nothing happens.
    const rich = place(s, A, { settlements: [V1], cities: ["-2,2|-1,1|-1,2"] });
    expect(play(rich, A, "wedding").state.phase).toEqual(ACTION_PHASE);
  });

  // --- Science -----------------------------------------------------------------

  it("docs/phase11.md §4 Alchemist chooses both number dice before the roll; the event die stays random", () => {
    const s = holding(A, ROLL_PHASE, "alchemist");
    expect(listed(s, A, "alchemist")).toHaveLength(36);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "alchemist", payload: { dice: [0, 3] } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "alchemist", payload: { dice: [2] as never } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "alchemist" }), "INVALID_PAYLOAD");
    expect(listed(inPhase(s, ACTION_PHASE), A, "alchemist")).toEqual([]);
    const { state: set, events } = play(s, A, "alchemist", { dice: [2, 4] });
    expect(crownOf(set).alchemist).toEqual([2, 4]);
    expect(events[1]).toMatchObject({ kind: "alchemistSet", playerId: A });
    expect(set.phase).toEqual(ROLL_PHASE);
    const { state: rolled, events: rollEvents } = applyActionWithEvents(withNextCrownRoll(set, 8, "trade"), { type: "ROLL", playerId: A });
    expect(rolled.lastRoll).toEqual([2, 4]);
    expect(rollEvents[0]).toMatchObject({ kind: "diceRolled", dice: [2, 4], red: 2, event: "trade" });
    expect(crownOf(rolled).alchemist).toBeNull();
  });

  it("docs/phase11.md §4 Crane makes the next improvement cost one commodity less", () => {
    let s = setTrack(giveCommodities(place(holding(A, ACTION_PHASE, "crane"), A, { cities: [V1] }), A, { cloth: 1 }), A, "trade", 1);
    expect(improvementCost(s, A, "trade")).toBe(2);
    expect(legalActions(s, A).some((a) => a.type === "BUILD_IMPROVEMENT")).toBe(false);
    const { state: craned, events } = play(s, A, "crane");
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(crownOf(craned).players[A]!.crane).toBe(true);
    expect(improvementCost(craned, A, "trade")).toBe(1);
    const built = applyAction(craned, { type: "BUILD_IMPROVEMENT", playerId: A, track: "trade" });
    expect(crownOf(built).players[A]).toMatchObject({ crane: false, tracks: { trade: 2 }, commodities: { cloth: 0 } });
    expect(improvementCost(built, A, "trade")).toBe(3);
    s = built;
  });

  it("docs/phase11.md §4 Engineer builds a city wall for free (the limit of three still applies)", () => {
    let s = place(holding(A, ACTION_PHASE, "engineer", "engineer"), A, { cities: [V1, V3], settlements: [V4] });
    expect(listed(s, A, "engineer")).toEqual([{ vertex: V1 }, { vertex: V3 }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "engineer", payload: { vertex: V4 } }), "NOT_A_CITY");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "engineer", payload: { vertex: "x" } }), "INVALID_PAYLOAD");
    const { state: walled, events } = play(s, A, "engineer", { vertex: V1 });
    expect(crownOf(walled).players[A]!.walls).toEqual([V1]);
    expect(events[1]).toMatchObject({ kind: "wallBuilt", playerId: A, vertex: V1, free: true });
    expect(getPlayer(walled, A).hand).toEqual(getPlayer(s, A).hand);
    expectRule(() => applyAction(walled, { type: "PLAY_PROGRESS", playerId: A, card: "engineer", payload: { vertex: V1 } }), "VERTEX_OCCUPIED");
    expect(listed(walled, A, "engineer")).toEqual([{ vertex: V3 }]);
    s = mut(place(walled, A, { cities: [V6, "-2,2|-1,1|-1,2"] }), (x) => void (crownOf(x).players[A]!.walls = [V1, V3, V6]));
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "engineer", payload: { vertex: "-2,2|-1,1|-1,2" } }), "WALL_LIMIT");
    expect(listed(s, A, "engineer")).toEqual([]);
  });

  it("docs/phase11.md §4 Inventor swaps the number tokens of two hexes numbered 3, 4, 5, 9, 10 or 11", () => {
    const s = holding(A, ACTION_PHASE, "inventor");
    expect(inventorPairs(s)).toHaveLength(60); // 12 hexes, 6 pairs share a token
    expect(listed(s, A, "inventor")).toHaveLength(60);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "inventor", payload: { hexes: ["1,0", "2,0"] } }), "INVALID_CHOICE"); // both 4
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "inventor", payload: { hexes: ["1,0", "-2,2"] } }), "INVALID_CHOICE"); // a 6
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "inventor", payload: { hexes: ["1,0", "0,0"] } }), "INVALID_CHOICE"); // the wasteland
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "inventor", payload: { hexes: ["1,0", "1,0"] } }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "inventor", payload: { hexes: ["1,0"] as never } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "inventor", payload: { hexes: ["1,0", "7,7"] } }), "INVALID_PAYLOAD");
    const { state: swapped, events } = play(s, A, "inventor", { hexes: ["1,0", "1,-1"] });
    expect(swapped.board.hexes["1,0"]).toEqual({ terrain: "meadow", token: 9 });
    expect(swapped.board.hexes["1,-1"]).toEqual({ terrain: "mountain", token: 4 });
    expect(events[1]).toMatchObject({ kind: "tokensSwapped", playerId: A, a: "1,0", b: "1,-1" });
    expect(s.board.hexes["1,0"]!.token).toBe(4);
    // Production follows the new tokens.
    const withCity = place(inPhase(swapped, ROLL_PHASE, B), A, { settlements: [V1] });
    expect(getPlayer(applyAction(withNextRoll(withCity, 9), { type: "ROLL", playerId: B }), A).hand.wool).toBe(1);
  });

  it("docs/phase11.md §4 Irrigation gives two grain per farmland hex the player has a building on, as far as the bank goes", () => {
    let s = place(holding(A, ACTION_PHASE, "irrigation", "irrigation"), A, { settlements: [V4], cities: [V1] });
    expect(listed(s, A, "irrigation")).toEqual([undefined]);
    const { state: after, events } = play(s, A, "irrigation");
    expect(getPlayer(after, A).hand.grain).toBe(4);
    expect(events[1]).toEqual({ seq: expect.any(Number), kind: "resourcesTaken", playerId: A, cards: { wood: 0, clay: 0, wool: 0, grain: 4, ore: 0 }, reason: "irrigation" });
    const short = mut(s, (x) => void (x.bank.grain = 3));
    expect(getPlayer(play(short, A, "irrigation").state, A).hand.grain).toBe(3);
    // No farmland: nothing.
    const dry = place(holding(A, ACTION_PHASE, "irrigation"), A, { settlements: [V1] });
    const { state: nothing, events: dryEvents } = play(dry, A, "irrigation");
    expect(getPlayer(nothing, A).hand.grain).toBe(0);
    expect(dryEvents.map((e) => e.kind)).toEqual(["progressPlayed"]);
    s = nothing;
  });

  it("docs/phase11.md §4 Medicine upgrades a settlement to a city for two ore and one grain", () => {
    let s = give(place(holding(A, ACTION_PHASE, "medicine", "medicine"), A, { settlements: [V1, V4] }), A, { ore: 2, grain: 1 });
    expect(listed(s, A, "medicine")).toEqual([{ vertex: V1 }, { vertex: V4 }]);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "medicine", payload: { vertex: V3 } }), "NOT_YOUR_SETTLEMENT");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "medicine" }), "INVALID_PAYLOAD");
    const { state: city, events } = play(s, A, "medicine", { vertex: V1 });
    expect(getPlayer(city, A).cities).toEqual([V1]);
    expect(getPlayer(city, A).settlements).toEqual([V4]);
    expect(getPlayer(city, A).hand).toEqual({ wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 });
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed", "built"]);
    expectRule(() => applyAction(city, { type: "PLAY_PROGRESS", playerId: A, card: "medicine", payload: { vertex: V4 } }), "INSUFFICIENT_RESOURCES");
    expect(listed(city, A, "medicine")).toEqual([]);
    const noPieces = mut(s, (x) => void (getPlayer(x, A).pieces.cities = 0));
    expectRule(() => applyAction(noPieces, { type: "PLAY_PROGRESS", playerId: A, card: "medicine", payload: { vertex: V1 } }), "NO_PIECES_LEFT");
    expect(listed(noPieces, A, "medicine")).toEqual([]);
    s = city;
  });

  it("docs/phase11.md §4 Mining gives two ore per mountain hex the player has a building on", () => {
    const s = place(holding(A, ACTION_PHASE, "mining"), A, { settlements: [V1, V3], cities: [V4] });
    const { state: after, events } = play(s, A, "mining");
    expect(getPlayer(after, A).hand.ore).toBe(4);
    expect(events[1]).toMatchObject({ kind: "resourcesTaken", playerId: A, cards: { ore: 4 }, reason: "mining" });
    expectRule(() => applyAction(inPhase(giveProgress(s, A, "mining"), ROLL_PHASE), { type: "PLAY_PROGRESS", playerId: B, card: "mining" }), "NOT_YOUR_TURN");
  });

  it("docs/phase11.md §4 Road Building places two free roads", () => {
    const { state: base, path } = network(1);
    const [, n1, n2] = path as [VertexId, VertexId, VertexId];
    const s = giveProgress(base, A, "roadBuilding", "roadBuilding");
    expect(listed(s, A, "roadBuilding")).toEqual([undefined]);
    const { state: building, events } = play(s, A, "roadBuilding");
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed"]);
    expect(building.phase).toEqual({ kind: "roadBuilding", remaining: 2 });
    const one = applyAction(building, { type: "BUILD_ROAD", playerId: A, edge: edgeBetween(n1, n2) });
    expect(one.phase).toEqual({ kind: "roadBuilding", remaining: 1 });
    const two = applyAction(one, { type: "BUILD_ROAD", playerId: A, edge: edgeBetween(n2, path[3]!) });
    expect(two.phase).toEqual(ACTION_PHASE);
    expect(getPlayer(two, A).roads).toHaveLength(3);
    expect(getPlayer(two, A).hand).toEqual(getPlayer(s, A).hand);
    const noRoads = mut(s, (x) => void (getPlayer(x, A).pieces.roads = 0));
    expectRule(() => applyAction(noRoads, { type: "PLAY_PROGRESS", playerId: A, card: "roadBuilding" }), "NO_LEGAL_ROAD");
    expect(listed(noRoads, A, "roadBuilding")).toEqual([]);
    expectRule(() => applyAction(inPhase(s, ROLL_PHASE), { type: "PLAY_PROGRESS", playerId: A, card: "roadBuilding" }), "WRONG_PHASE");
  });

  it("docs/phase11.md §4 Smith promotes one or two knights a level for free; level 3 still needs politics 3 and a piece in supply", () => {
    const { state: base, path } = network(3);
    const [, n1, n2, n3] = path as [VertexId, VertexId, VertexId, VertexId];
    let s = giveProgress(base, A, "smith", "smith");
    s = addKnight(addKnight(s, A, n1, 1, true), A, n2, 1);
    expect(listed(s, A, "smith")).toEqual([{ vertices: [n1, n2].sort() }, ...[n1, n2].sort().map((v) => ({ vertices: [v] }))].sort((x, y) => x.vertices.length - y.vertices.length));
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [] } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n1, n1] } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n1, n2, n3] } }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n3] } }), "NO_KNIGHT");
    expectRule(() => applyAction(addKnight(s, B, n3), { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n3] } }), "NOT_YOUR_KNIGHT");
    const { state: two, events } = play(s, A, "smith", { vertices: [n1, n2] });
    expect(knightAt(two, n1)).toMatchObject({ level: 2, active: true });
    expect(knightAt(two, n2)).toMatchObject({ level: 2, active: false });
    expect(events.map((e) => e.kind)).toEqual(["progressPlayed", "knightPromoted", "knightPromoted"]);
    expect(getPlayer(two, A).hand).toEqual(getPlayer(s, A).hand);
    expectRule(() => applyAction(two, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n1] } }), "NEEDS_POLITICS");
    expect(listed(two, A, "smith")).toEqual([]);
    const politics = setTrack(two, A, "politics", 3);
    expect(knightAt(play(politics, A, "smith", { vertices: [n1] }).state, n1)!.level).toBe(3);
    expectRule(() => applyAction(play(politics, A, "smith", { vertices: [n1] }).state, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n1] } }), "NO_PROGRESS_CARD");
    // Supply is tracked promotion by promotion: with both strong pieces out, a basic knight can only follow a strong one that moves up.
    let tight = addKnight(setTrack(giveProgress(base, A, "smith"), A, "politics", 3), A, n1, 2);
    tight = addKnight(addKnight(tight, A, n2, 2), A, n3, 1);
    expectRule(() => applyAction(tight, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n3] } }), "NO_KNIGHTS_LEFT");
    expectRule(() => applyAction(tight, { type: "PLAY_PROGRESS", playerId: A, card: "smith", payload: { vertices: [n3, n1] } }), "NO_KNIGHTS_LEFT");
    const chained = play(tight, A, "smith", { vertices: [n1, n3] }).state;
    expect(knightAt(chained, n1)!.level).toBe(3);
    expect(knightAt(chained, n3)!.level).toBe(2);
    expect(listed(tight, A, "smith")).toContainEqual({ vertices: [n1, n3] });
    expect(listed(tight, A, "smith")).not.toContainEqual({ vertices: [n3, n1] });
    expect(listed(tight, A, "smith")).not.toContainEqual({ vertices: [n3] });
  });

  it("docs/phase11.md §4 Constitution and Printer are revealed on draw, worth a point each, and never played", () => {
    const s = holding(A, ACTION_PHASE, "constitution", "printer");
    expect(crownOf(s).players[A]!.progress.every((c) => c.revealed)).toBe(true);
    expect(victoryPoints(s, getPlayer(s, A)).total).toBe(2);
    expect(legalActions(s, A).some((a) => a.type === "PLAY_PROGRESS")).toBe(false);
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "printer" }), "INVALID_CHOICE");
    expectRule(() => applyAction(s, { type: "PLAY_PROGRESS", playerId: A, card: "constitution" }), "INVALID_CHOICE");
  });

  it("docs/phase11.md §4 every PLAY_PROGRESS instance legalActions lists is accepted by applyAction", () => {
    const all = TRACKS.flatMap((t) => PROGRESS_DECKS[t].map(([card]) => card));
    const { state: base, path } = network(3);
    const [, n1, n2, n3] = path as [VertexId, VertexId, VertexId, VertexId];
    // A rich position: cities, walls to build, knights of every level around, the fleet has attacked, richer opponents with cards.
    let s = place(give(base, A, FULL), A, { cities: [V4], settlements: [V6] });
    s = giveCommodities(s, A, { cloth: 2, coin: 2, paper: 2 });
    s = addKnight(addKnight(addKnight(s, A, n1, 1, false), A, n2, 2, true), B, n3, 1, true);
    s = place(give(giveCommodities(s, B, { cloth: 1, paper: 1 }), B, { wood: 2, ore: 1 }), B, { settlements: ["-2,2|-1,1|-1,2", "0,-2|1,-2|1,-1"], roads: [edgeBetween(V3, GEOMETRY.vertexNeighbors[V3]![0]!)] });
    s = place(give(s, C, { grain: 3 }), C, { cities: [V3] });
    s = giveProgress(s, C, "merchant", "bishop");
    s = mut(s, (x) => void (crownOf(x).attacks = 1));
    s = setTrack(s, A, "politics", 3);
    for (const phase of [ACTION_PHASE, ROLL_PHASE]) {
      // The hand limit is a draw-time rule; a test hand may hold every card at once.
      const loaded = giveProgress(inPhase(s, phase), A, ...all);
      const instances = legalActions(loaded, A).filter((a) => a.type === "PLAY_PROGRESS");
      expect(instances.length).toBeGreaterThan(phase.kind === "roll" ? 60 : 100);
      const cards = new Set(instances.map((a) => a.type === "PLAY_PROGRESS" && a.card));
      const expected = phase.kind === "roll" ? ["alchemist", "bishop", "deserter", "diplomat", "intrigue", "saboteur", "spy", "warlord", "wedding", "inventor", "irrigation", "mining"] : all.filter((c) => !VP_PROGRESS_CARDS.includes(c) && c !== "alchemist");
      expect([...cards].sort()).toEqual([...new Set(expected)].sort());
      for (const action of instances) expect(() => applyAction(loaded, action)).not.toThrow();
    }
  });
});
