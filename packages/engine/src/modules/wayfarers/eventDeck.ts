/**
 * Wayfarers: the event deck (docs/phase10.md §1).
 *
 * Thirty-six cards replace the dice: one card per outcome of two dice, so a
 * full deck has exactly the 2d6 distribution. Five cards also carry an
 * event. The deck is shuffled from the seed (`eventDeck:<shuffles>`), the
 * reshuffle marker sits fifth from the bottom, and the deck is rebuilt once
 * the roll that drew the marker has resolved.
 */

import { RESOURCES, type Resource } from "../../board";
import { RuleError } from "../../errors";
import { requirePrompted } from "../../guards";
import { createRng } from "../../rng";
import { cardCount, emit, getPlayer, handSize, variantOn, victoryPoints } from "../../state";
import type { GameState, NeighborlyGiveAction, Player, PlayerId } from "../../types";
import { registerModule, type RollOutcome } from "../hooks";
import { finishPrompt, parkPrompt } from "../prompt";
import type { EventCard, EventCardKind, EventDeckState } from "../types";

export const EVENT_DECK_SIZE = 36;
/** The reshuffle marker's position, counted from the bottom of the deck. */
export const RESHUFFLE_FROM_BOTTOM = 5;
/** Tax collector: players holding this many cards or more pay one. */
export const TAX_THRESHOLD = 8;

/** One card of each of these totals carries the event. */
const EVENT_CARDS: readonly (readonly [number, EventCardKind])[] = [
  [12, "plentifulHarvest"],
  [2, "bounty"],
  [7, "robbersRest"],
  [3, "neighborlyHelp"],
  [11, "taxCollector"],
];

/** The 36 totals of two dice, ascending. */
export function eventDeckTotals(): number[] {
  const out: number[] = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push(a + b);
  return out.sort((x, y) => x - y);
}

/** Deck number `shuffles` for `seed`: shuffled, with the reshuffle marker fifth from the bottom. */
export function buildEventDeck(seed: string, shuffles: number): EventCard[] {
  const eventOf = new Map<number, EventCardKind>(EVENT_CARDS);
  const cards: EventCard[] = eventDeckTotals().map((total) => {
    const event = eventOf.get(total) ?? null;
    if (event !== null) eventOf.delete(total); // only one card of that total carries it
    return { total, event, reshuffle: false };
  });
  const shuffled = createRng(seed, `eventDeck:${shuffles}`).shuffle(cards);
  const marker = shuffled.length - RESHUFFLE_FROM_BOTTOM;
  return shuffled.map((card, i) => (i === marker ? { ...card, reshuffle: true } : card));
}

function deckOf(state: GameState): EventDeckState {
  const deck = state.wayfarers?.eventDeck;
  if (!deck) throw new Error("event deck state missing");
  return deck;
}

function rebuild(state: GameState, deck: EventDeckState): void {
  deck.shuffles += 1;
  deck.cards = buildEventDeck(state.seed, deck.shuffles);
  deck.reshufflePending = false;
  emit(state, { kind: "deckReshuffled" });
}

/** Players in seat order starting with the current one. */
function seatOrder(state: GameState): Player[] {
  const n = state.players.length;
  return state.players.map((_, i) => state.players[(state.currentPlayer + i) % n] as Player);
}

/** A resource of each owing player's choice through the gold phase; nothing when the bank is empty. */
function offerChoice(state: GameState, owed: Record<PlayerId, number>): void {
  if (handSize(state.bank) === 0) return;
  state.phase = { kind: "chooseGold", owed, returnTo: state.phase };
}

/** Neighborly help: the fewest-VP player (ties by seat order from the current player) may get one card from each other player holding one. */
function startNeighborlyHelp(state: GameState): void {
  const order = seatOrder(state);
  let poorest = order[0] as Player;
  let fewest = Infinity;
  for (const p of order) {
    const total = victoryPoints(state, p).total;
    if (total < fewest) {
      fewest = total;
      poorest = p;
    }
  }
  const [first, ...pending] = order.filter((p) => p.id !== poorest.id && handSize(p.hand) >= 1).map((p) => p.id);
  if (first === undefined) return;
  parkPrompt(state, { kind: "neighborlyHelp", playerId: first, pending, to: poorest.id });
}

/** Tax collector: everyone at the threshold owes one card; the core's DISCARD collects it. */
function collectTax(state: GameState): void {
  const pending: Record<PlayerId, number> = {};
  for (const p of state.players) {
    if (cardCount(state, p) < TAX_THRESHOLD) continue;
    pending[p.id] = 1;
    emit(state, { kind: "taxCollected", playerId: p.id, resource: null });
  }
  if (Object.keys(pending).length === 0) return;
  state.pendingDiscards = pending;
  state.phase = { kind: "discard", returnTo: state.phase };
}

function applyNeighborlyGive(state: GameState, action: NeighborlyGiveAction): void {
  const prompt = requirePrompted(state, "neighborlyHelp", action.playerId);
  const giver = getPlayer(state, action.playerId);
  const receiver = getPlayer(state, prompt.to);
  const resource: unknown = action.resource;
  let gave: Resource | null = null;
  if (resource !== null) {
    if (!(RESOURCES as readonly unknown[]).includes(resource)) throw new RuleError("INVALID_CHOICE", "unknown resource");
    gave = resource as Resource;
    if (giver.hand[gave] < 1) throw new RuleError("INSUFFICIENT_RESOURCES", `you hold no ${gave}`);
    giver.hand[gave] -= 1;
    receiver.hand[gave] += 1;
  }
  emit(state, { kind: "neighborlyGave", from: giver.id, to: receiver.id, gave: gave !== null, resource: gave });
  const [next, ...pending] = prompt.pending;
  finishPrompt(state, next === undefined ? null : { kind: "neighborlyHelp", playerId: next, pending, to: prompt.to });
}

registerModule({
  id: "eventDeck",
  enabled: (state: GameState) => variantOn(state, "eventDeck"),

  init(state) {
    if (!state.wayfarers) state.wayfarers = { eventDeck: null, fishing: null, rivers: null, harbormaster: null, caravans: null, raiders: null, wagons: null };
    state.wayfarers.eventDeck = { cards: buildEventDeck(state.seed, 0), shuffles: 0, lastEvent: null, reshufflePending: false };
  },

  roll(state, _player, outcome): RollOutcome {
    const deck = deckOf(state);
    if (deck.cards.length === 0) rebuild(state, deck); // never with the marker in play; keeps a damaged state playable
    const card = deck.cards.shift() as EventCard;
    deck.lastEvent = card.event;
    deck.reshufflePending = card.reshuffle;
    const low = Math.floor(card.total / 2);
    return { ...outcome, dice: [low, card.total - low], total: card.total, card: { total: card.total, event: card.event } };
  },

  onSeven(state) {
    if (deckOf(state).lastEvent === "robbersRest") return "noRobber";
  },

  afterRoll(state, player, roll) {
    const deck = deckOf(state);
    const event = roll.card?.event ?? deck.lastEvent ?? null;
    switch (event) {
      case "plentifulHarvest": {
        const owed: Record<PlayerId, number> = {};
        for (const p of state.players) owed[p.id] = 1;
        offerChoice(state, owed);
        break;
      }
      case "bounty":
        offerChoice(state, { [player.id]: 1 });
        break;
      case "robbersRest":
        break; // handled in onSeven
      case "neighborlyHelp":
        startNeighborlyHelp(state);
        break;
      case "taxCollector":
        collectTax(state);
        break;
      case null:
        break;
      default: {
        const exhaustive: never = event;
        throw new Error(`unknown event card ${String(exhaustive)}`);
      }
    }
    if (deck.reshufflePending) rebuild(state, deck);
  },

  promptActions(state, prompt, playerId, out) {
    if (prompt.kind !== "neighborlyHelp" || prompt.playerId !== playerId) return;
    const player = getPlayer(state, playerId);
    for (const resource of RESOURCES) if (player.hand[resource] > 0) out.push({ type: "NEIGHBORLY_GIVE", playerId, resource });
    out.push({ type: "NEIGHBORLY_GIVE", playerId, resource: null });
  },

  apply(state, action) {
    if (action.type !== "NEIGHBORLY_GIVE") return false;
    applyNeighborlyGive(state, action);
    return true;
  },
});
