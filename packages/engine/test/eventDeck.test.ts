import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { RESOURCES } from "../src/board";
import type { GameEvent } from "../src/events";
import { standardFrame } from "../src/frames";
import { createGame } from "../src/game";
import { GEOMETRY } from "../src/geometry";
import { legalActions } from "../src/legal";
import type { EventCard, EventCardKind, EventDeckState } from "../src/modules/types";
import { EVENT_DECK_SIZE, buildEventDeck, eventDeckTotals } from "../src/modules/wayfarers/eventDeck";
import { rng } from "../src/rng";
import type { Scenario } from "../src/scenario";
import { getPlayer, hand, handSize, nextActor, victoryPoints } from "../src/state";
import type { GameState, Player, PlayerId } from "../src/types";
import { ACTION_PHASE, FOUR, ROLL_PHASE, expectRule, finishSetup, give, inPhase, mut, place, playRandomGame } from "./helpers";

const MODULE_EVENT_KINDS: readonly GameEvent["kind"][] = ["deckReshuffled", "neighborlyGave", "taxCollected", "chipMoved", "bridgeBuilt", "coinsAwarded"];

function scenario(eventDeck: boolean): Scenario {
  return { id: "t", name: "t", board: standardFrame(), modules: {}, variants: { eventDeck }, victoryPoints: 10 };
}

function game(seed = "deck"): GameState {
  return createGame({ seed, players: FOUR, scenario: scenario(true) });
}

function deckOf(state: GameState): EventDeckState {
  return state.wayfarers!.eventDeck!;
}

/** Move the first card matching `pick` to the top of the deck (test setup only). */
function withTopCard(state: GameState, pick: (card: EventCard) => boolean): GameState {
  return mut(state, (s) => {
    const deck = deckOf(s);
    const i = deck.cards.findIndex(pick);
    if (i < 0) throw new Error("no such card");
    const [card] = deck.cards.splice(i, 1);
    deck.cards.unshift(card!);
  });
}

const withEvent = (event: EventCardKind) => (c: EventCard) => c.event === event;

/** Back to the roll phase as `id`, dropping whatever the previous roll left behind. */
function rollPhase(state: GameState, id: PlayerId): GameState {
  return inPhase(
    mut(state, (s) => {
      s.pendingDiscards = {};
      s.pendingTrade = null;
    }),
    ROLL_PHASE,
    id,
  );
}

/** Set every hand exactly (test setup only; the bank is not adjusted). */
function withHands(state: GameState, hands: Record<PlayerId, Partial<Record<(typeof RESOURCES)[number], number>>>): GameState {
  return mut(state, (s) => {
    for (const p of s.players) p.hand = hand(hands[p.id] ?? {});
  });
}

/** A vertex none of whose hexes carries `token`. */
function vertexAwayFrom(state: GameState, token: number) {
  const v = GEOMETRY.vertices.find((x) => (GEOMETRY.vertexHexes[x] ?? []).every((h) => state.board.hexes[h]?.token !== token));
  if (!v) throw new Error("no quiet vertex");
  return v;
}

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

/** Independent VP recount: buildings, special cards and VP cards (the event deck adds no VP). */
function recount(state: GameState, p: Player): number {
  let vp = p.settlements.length + 2 * p.cities.length;
  if (state.longestRoad.playerId === p.id) vp += 2;
  if (state.largestArmy.playerId === p.id) vp += 2;
  return vp + p.devCards.filter((c) => c.type === "victoryPoint").length;
}

function totalCards(state: GameState): number {
  return handSize(state.bank) + state.players.reduce((n, p) => n + handSize(p.hand), 0);
}

describe("docs/phase10.md §1 Event deck", () => {
  it("docs/phase10.md §1 the deck holds 36 cards in the 2d6 distribution, five events on pinned totals and one reshuffle marker fifth from the bottom", () => {
    const state = game();
    const deck = deckOf(state);
    expect(deck.shuffles).toBe(0);
    expect(deck.cards).toHaveLength(EVENT_DECK_SIZE);
    const counts: Record<number, number> = {};
    for (const c of deck.cards) counts[c.total] = (counts[c.total] ?? 0) + 1;
    expect(counts).toEqual({ 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 });
    expect(eventDeckTotals()).toHaveLength(36);
    const events = deck.cards.filter((c) => c.event !== null).map((c) => [c.total, c.event] as const);
    expect([...events].sort((x, y) => x[0] - y[0])).toEqual([
      [2, "bounty"],
      [3, "neighborlyHelp"],
      [7, "robbersRest"],
      [11, "taxCollector"],
      [12, "plentifulHarvest"],
    ]);
    expect(deck.cards.filter((c) => c.reshuffle)).toHaveLength(1);
    expect(deck.cards[EVENT_DECK_SIZE - 5]!.reshuffle).toBe(true);
    // Seeded: the same seed deals the same deck, another seed or the next shuffle a different order.
    expect(deck.cards).toEqual(buildEventDeck("deck", 0));
    expect(deckOf(game("deck")).cards).toEqual(deck.cards);
    const totals = deck.cards.map((c) => c.total);
    expect(totals).not.toEqual([...totals].sort((x, y) => x - y));
    expect(deckOf(game("other-seed")).cards.map((c) => c.total)).not.toEqual(totals);
    expect(buildEventDeck("deck", 1).map((c) => c.total)).not.toEqual(totals);
    expect(state.wayfarers).toEqual({ eventDeck: deck, fishing: null, rivers: null, harbormaster: null, raiders: null, caravans: null, wagons: null });
  });

  it("docs/phase10.md §1 ROLL draws the top card: the total is the card's, the dice sum to it and diceRolled carries the card", () => {
    const start = finishSetup(game());
    const top = deckOf(start).cards[0]!;
    const { state, events } = applyActionWithEvents(start, { type: "ROLL", playerId: "a" });
    expect(deckOf(state).cards).toEqual(deckOf(start).cards.slice(1));
    const rolled = events.find((e) => e.kind === "diceRolled");
    expect(rolled?.kind).toBe("diceRolled");
    if (rolled?.kind !== "diceRolled") return;
    expect(rolled.card).toEqual({ total: top.total, event: top.event });
    expect(rolled.dice[0] + rolled.dice[1]).toBe(top.total);
    for (const d of rolled.dice) expect(d >= 1 && d <= 6).toBe(true);
    expect(state.lastRoll![0] + state.lastRoll![1]).toBe(top.total);
    expect(state.log.some((l) => l.text.includes(`${top.total}`))).toBe(true);
  });

  it("docs/phase10.md §1 the rolls follow the deck in order; drawing the marker rebuilds the deck after that roll, and the sequence replays exactly", () => {
    const run = (seed: string): { totals: number[]; reshuffledAt: number[]; final: GameState } => {
      let state = finishSetup(game(seed));
      const totals: number[] = [];
      const reshuffledAt: number[] = [];
      for (let i = 0; i < 40; i++) {
        state = rollPhase(state, "a");
        const { state: next, events } = applyActionWithEvents(state, { type: "ROLL", playerId: "a" });
        const kinds = events.map((e) => e.kind);
        if (kinds.includes("deckReshuffled")) {
          reshuffledAt.push(i);
          expect(kinds.indexOf("deckReshuffled")).toBeGreaterThan(kinds.indexOf("diceRolled"));
        }
        totals.push(next.lastRoll![0] + next.lastRoll![1]);
        state = next;
      }
      return { totals, reshuffledAt, final: state };
    };
    const first = buildEventDeck("order", 0);
    const second = buildEventDeck("order", 1);
    const { totals, reshuffledAt, final } = run("order");
    // The marker is card 32 (index 31): the deck is rebuilt in that roll, so roll 33 draws from the new deck.
    expect(reshuffledAt).toEqual([31]);
    expect(totals.slice(0, 32)).toEqual(first.slice(0, 32).map((c) => c.total));
    expect(totals.slice(32)).toEqual(second.slice(0, 8).map((c) => c.total));
    expect(deckOf(final).shuffles).toBe(1);
    expect(deckOf(final).cards).toEqual(second.slice(8));
    expect(deckOf(final).cards).toHaveLength(28);
    // Determinism: the same seed gives the same sequence.
    expect(run("order").totals).toEqual(totals);
    expect(run("order-2").totals).not.toEqual(totals);
  });

  it("docs/phase10.md §1 Plentiful harvest: every player takes one resource of their choice in seat order; skipped when the bank is empty", () => {
    const start = withTopCard(finishSetup(game()), withEvent("plentifulHarvest"));
    const before = totalCards(start);
    const { state: s1, events } = applyActionWithEvents(start, { type: "ROLL", playerId: "a" });
    expect(events.find((e) => e.kind === "diceRolled")).toMatchObject({ card: { total: 12, event: "plentifulHarvest" } });
    expect(s1.phase).toEqual({ kind: "chooseGold", owed: { a: 1, b: 1, c: 1, d: 1 }, returnTo: ACTION_PHASE });
    let s = s1;
    for (const id of ["a", "b", "c", "d"]) {
      expect(nextActor(s)).toBe(id);
      expect(legalActions(s, id).every((x) => x.type === "CHOOSE_GOLD" && x.resources.length === 1)).toBe(true);
      expectRule(() => applyAction(s, { type: "CHOOSE_GOLD", playerId: id, resources: ["ore", "ore"] }), "WRONG_GOLD_COUNT");
      const ore = getPlayer(s, id).hand.ore;
      s = applyAction(s, { type: "CHOOSE_GOLD", playerId: id, resources: ["ore"] });
      expect(getPlayer(s, id).hand.ore).toBe(ore + 1);
    }
    expect(s.phase).toEqual(ACTION_PHASE);
    expect(totalCards(s)).toBe(before);
    expect(s.bank.ore).toBe(s1.bank.ore - 4);
    // An empty bank: nothing to take, play goes straight on.
    const dry = mut(start, (x) => {
      x.bank = hand({});
    });
    expect(applyAction(dry, { type: "ROLL", playerId: "a" }).phase).toEqual(ACTION_PHASE);
  });

  it("docs/phase10.md §1 Bounty: the current player alone takes one resource of their choice; skipped when the bank is empty", () => {
    const start = withTopCard(finishSetup(game()), withEvent("bounty"));
    const { state: s1, events } = applyActionWithEvents(start, { type: "ROLL", playerId: "a" });
    expect(events.find((e) => e.kind === "diceRolled")).toMatchObject({ card: { total: 2, event: "bounty" }, dice: [1, 1] });
    expect(s1.phase).toEqual({ kind: "chooseGold", owed: { a: 1 }, returnTo: ACTION_PHASE });
    expect(nextActor(s1)).toBe("a");
    expect(legalActions(s1, "b")).toEqual([]);
    expectRule(() => applyAction(s1, { type: "CHOOSE_GOLD", playerId: "b", resources: ["wood"] }), "NO_GOLD_OWED");
    const wood = getPlayer(s1, "a").hand.wood;
    const s2 = applyAction(s1, { type: "CHOOSE_GOLD", playerId: "a", resources: ["wood"] });
    expect(getPlayer(s2, "a").hand.wood).toBe(wood + 1);
    expect(s2.phase).toEqual(ACTION_PHASE);
    expect(totalCards(s2)).toBe(totalCards(start));
    const dry = mut(start, (x) => {
      x.bank = hand({});
    });
    expect(applyAction(dry, { type: "ROLL", playerId: "a" }).phase).toEqual(ACTION_PHASE);
  });

  it("docs/phase10.md §1 Robber's rest: a seven without a robber move, but discards still happen; a plain seven moves the robber", () => {
    const base = finishSetup(game());
    const rest = give(withTopCard(base, withEvent("robbersRest")), "b", { wood: 9 });
    const owed = Math.floor(handSize(getPlayer(rest, "b").hand) / 2);
    const { state: s1, events } = applyActionWithEvents(rest, { type: "ROLL", playerId: "a" });
    expect(events.find((e) => e.kind === "diceRolled")).toMatchObject({ card: { total: 7, event: "robbersRest" }, dice: [3, 4] });
    expect(s1.phase).toEqual({ kind: "discard", returnTo: ACTION_PHASE });
    expect(s1.pendingDiscards).toEqual({ b: owed });
    expect(nextActor(s1)).toBe("b");
    expect(s1.robberHex).toBe(rest.robberHex);
    const s2 = applyAction(s1, { type: "DISCARD", playerId: "b", cards: hand({ wood: owed }) });
    expect(s2.phase).toEqual(ACTION_PHASE);
    expect(s2.robberHex).toBe(rest.robberHex);
    expect(legalActions(s2, "a").some((x) => x.type === "MOVE_ROBBER")).toBe(false);
    expect(totalCards(s2)).toBe(totalCards(rest));
    // Nobody over the limit: straight to the action phase, robber untouched.
    const quiet = applyAction(withTopCard(base, withEvent("robbersRest")), { type: "ROLL", playerId: "a" });
    expect(quiet.phase).toEqual(ACTION_PHASE);
    expect(quiet.robberHex).toBe(base.robberHex);
    // A seven without the event is the ordinary seven.
    const plain = applyAction(withTopCard(base, (c) => c.total === 7 && c.event === null), { type: "ROLL", playerId: "a" });
    expect(plain.phase).toEqual({ kind: "moveRobber", via: "seven", returnTo: "action" });
    const plainOver = applyAction(give(withTopCard(base, (c) => c.total === 7 && c.event === null), "b", { wood: 9 }), { type: "ROLL", playerId: "a" });
    expect(plainOver.phase).toEqual({ kind: "discard", returnTo: { kind: "moveRobber", via: "seven", returnTo: "action" } });
  });

  it("docs/phase10.md §1 Neighborly help: each other player with a card may give one to the poorest (ties by seat order from the current player), in turn", () => {
    // No setup: everyone at 0 VP except c, who gets a settlement away from any 3-token hex so the roll produces nothing.
    const quiet = vertexAwayFrom(game(), 3);
    let base = place(inPhase(game(), ROLL_PHASE, "b"), "c", { settlements: [quiet] });
    base = withHands(base, { a: { ore: 2 }, b: { wool: 1 }, c: { wood: 1 }, d: {} });
    const start = withTopCard(base, withEvent("neighborlyHelp"));
    expect(victoryPoints(start, getPlayer(start, "c")).total).toBe(1);
    const { state: s1, events } = applyActionWithEvents(start, { type: "ROLL", playerId: "b" });
    expect(events.find((e) => e.kind === "diceRolled")).toMatchObject({ card: { total: 3, event: "neighborlyHelp" } });
    // b (current) is poorest by seat order among a, b, d at 0 VP; givers from b's seat: c, then a (d holds nothing).
    expect(s1.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "neighborlyHelp", playerId: "c", pending: ["a"], to: "b" }, returnTo: ACTION_PHASE });
    expect(nextActor(s1)).toBe("c");
    expect(legalActions(s1, "a")).toEqual([]);
    expect(legalActions(s1, "b")).toEqual([]);
    expect(legalActions(s1, "c")).toEqual([
      { type: "NEIGHBORLY_GIVE", playerId: "c", resource: "wood" },
      { type: "NEIGHBORLY_GIVE", playerId: "c", resource: null },
    ]);
    expectRule(() => applyAction(s1, { type: "NEIGHBORLY_GIVE", playerId: "a", resource: "ore" }), "NOT_YOUR_PROMPT");
    expectRule(() => applyAction(s1, { type: "NEIGHBORLY_GIVE", playerId: "c", resource: "ore" }), "INSUFFICIENT_RESOURCES");
    expectRule(() => applyAction(s1, { type: "NEIGHBORLY_GIVE", playerId: "c", resource: "spice" as never }), "INVALID_CHOICE");
    expectRule(() => applyAction(s1, { type: "END_TURN", playerId: "b" }), "WRONG_PHASE");
    const { state: s2, events: e2 } = applyActionWithEvents(s1, { type: "NEIGHBORLY_GIVE", playerId: "c", resource: "wood" });
    expect(getPlayer(s2, "c").hand.wood).toBe(0);
    expect(getPlayer(s2, "b").hand.wood).toBe(1);
    expect(e2).toContainEqual(expect.objectContaining({ kind: "neighborlyGave", from: "c", to: "b", gave: true, resource: "wood" }));
    expect(s2.log.at(-1)?.text).toBe("Cy gave a card to Bo");
    expect(s2.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "neighborlyHelp", playerId: "a", pending: [], to: "b" }, returnTo: ACTION_PHASE });
    const { state: s3, events: e3 } = applyActionWithEvents(s2, { type: "NEIGHBORLY_GIVE", playerId: "a", resource: null });
    expect(getPlayer(s3, "a").hand.ore).toBe(2);
    expect(e3).toContainEqual(expect.objectContaining({ kind: "neighborlyGave", from: "a", to: "b", gave: false, resource: null }));
    expect(s3.log.at(-1)?.text).toBe("Ada gave nothing");
    expect(s3.phase).toEqual(ACTION_PHASE);
    expect(totalCards(s3)).toBe(totalCards(start));
    expectRule(() => applyAction(s3, { type: "NEIGHBORLY_GIVE", playerId: "c", resource: null }), "WRONG_PHASE");
    // Another current player: the tie among a, b, d now goes to d, and the givers are a, b, c in seat order from d.
    const fromD = applyAction(inPhase(start, ROLL_PHASE, "d"), { type: "ROLL", playerId: "d" });
    expect(fromD.phase).toEqual({ kind: "modulePrompt", prompt: { kind: "neighborlyHelp", playerId: "a", pending: ["b", "c"], to: "d" }, returnTo: ACTION_PHASE });
    // Nobody else holds a card: no prompt at all.
    const broke = withHands(start, { b: { wool: 3 } });
    expect(applyAction(broke, { type: "ROLL", playerId: "b" }).phase).toEqual(ACTION_PHASE);
  });

  it("docs/phase10.md §1 Tax collector: every player holding 8 or more cards discards exactly one; nobody at the limit means nothing happens", () => {
    const base = inPhase(game(), ROLL_PHASE, "a");
    const heavy = withTopCard(withHands(base, { a: { wood: 8 }, b: { wood: 5, ore: 4 }, c: { wood: 7 }, d: {} }), withEvent("taxCollector"));
    const { state: s1, events } = applyActionWithEvents(heavy, { type: "ROLL", playerId: "a" });
    expect(events.find((e) => e.kind === "diceRolled")).toMatchObject({ card: { total: 11, event: "taxCollector" } });
    expect(s1.phase).toEqual({ kind: "discard", returnTo: ACTION_PHASE });
    expect(s1.pendingDiscards).toEqual({ a: 1, b: 1 });
    expect(events.filter((e) => e.kind === "taxCollected").map((e) => (e.kind === "taxCollected" ? e.playerId : ""))).toEqual(["a", "b"]);
    expect(s1.log.some((l) => l.text === "Bo paid a card to the tax collector")).toBe(true);
    expect(nextActor(s1)).toBe("a");
    expect(legalActions(s1, "a")).toEqual([{ type: "DISCARD", playerId: "a", cards: hand({ wood: 1 }) }]);
    expectRule(() => applyAction(s1, { type: "DISCARD", playerId: "a", cards: hand({ wood: 2 }) }), "WRONG_DISCARD_COUNT");
    expectRule(() => applyAction(s1, { type: "DISCARD", playerId: "c", cards: hand({ wood: 1 }) }), "NO_DISCARD_OWED");
    const s2 = applyAction(s1, { type: "DISCARD", playerId: "a", cards: hand({ wood: 1 }) });
    expect(getPlayer(s2, "a").hand.wood).toBe(7);
    expect(s2.bank.wood).toBe(heavy.bank.wood + 1);
    expect(s2.phase.kind).toBe("discard");
    expect(nextActor(s2)).toBe("b");
    const s3 = applyAction(s2, { type: "DISCARD", playerId: "b", cards: hand({ ore: 1 }) });
    expect(s3.phase).toEqual(ACTION_PHASE);
    expect(getPlayer(s3, "b").hand).toEqual(hand({ wood: 5, ore: 3 }));
    expect(getPlayer(s3, "c").hand.wood).toBe(7);
    // Nobody at 8+.
    const light = withTopCard(withHands(base, { a: { wood: 7 } }), withEvent("taxCollector"));
    const { state: s4, events: e4 } = applyActionWithEvents(light, { type: "ROLL", playerId: "a" });
    expect(s4.phase).toEqual(ACTION_PHASE);
    expect(e4.some((e) => e.kind === "taxCollected")).toBe(false);
    expect(s4.pendingDiscards).toEqual({});
  });

  it("docs/phase10.md §1 random play: 20 games end, conserve resources, keep the VP math, replay exactly and exercise every event", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const seed = `deck-${i}`;
      const played = playRandomGame(seed, {
        scenario: scenario(true),
        onStep: (s) => {
          check(totalCards(s) === 95, `resources not conserved (${seed})`);
          const n = deckOf(s).cards.length;
          check(n >= 4 && n <= EVENT_DECK_SIZE, `deck size ${n} (${seed})`);
          for (const p of s.players) check(victoryPoints(s, p).total === recount(s, p), `VP mismatch for ${p.id} (${seed})`);
        },
      });
      expect(played.final.phase.kind).toBe("ended");
      expect(played.final.winner).not.toBeNull();
      // Exact replay, collecting the events on the way.
      let state = played.initial;
      for (const action of played.actions) {
        const { state: next, events } = applyActionWithEvents(state, action);
        for (const e of events) {
          if (e.kind === "diceRolled" && e.card?.event) seen.add(e.card.event);
          if (e.kind === "deckReshuffled") seen.add("reshuffle");
          if (e.kind === "neighborlyGave") seen.add(e.gave ? "gave" : "declined");
          if (e.kind === "taxCollected") seen.add("taxed");
        }
        state = next;
      }
      expect(state).toEqual(played.final);
    }
    expect([...seen].sort()).toEqual(["bounty", "declined", "gave", "neighborlyHelp", "plentifulHarvest", "reshuffle", "robbersRest", "taxCollector", "taxed"]);
  }, 60_000);

  it("docs/phase10.md §1 with the variant off the base game is untouched: no deck state, seeded dice and no module events", () => {
    const off = scenario(false);
    expect(createGame({ seed: "x", players: FOUR, scenario: off }).wayfarers).toBeNull();
    const played = playRandomGame("deck-off", { scenario: off, maxTurns: 80 });
    let state = played.initial;
    let rolls = 0;
    for (const action of played.actions) {
      const { state: next, events } = applyActionWithEvents(state, action);
      for (const e of events) {
        expect(MODULE_EVENT_KINDS).not.toContain(e.kind);
        if (e.kind === "diceRolled") {
          rolls += 1;
          expect(e.card).toBeUndefined();
          const d = rng(state.seed, state.actionIndex);
          expect(e.dice).toEqual([d.int(6) + 1, d.int(6) + 1]);
        }
      }
      state = next;
    }
    expect(rolls).toBeGreaterThan(10);
    expect(state.wayfarers).toBeNull();
    expect(state).toEqual(played.final);
  });
});
