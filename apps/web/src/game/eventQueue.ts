/**
 * The animation queue's pure core (docs/phase7.md §2–§3). No React, no DOM:
 * given a view and its events it plans timed steps (with synthetic bot
 * "thinking" pauses), and applies events one at a time to a rendered view so
 * the screen advances in step with the animation rather than snapping.
 */

import { COSTS, RESOURCES, describeEvent, eventPlayer, isHiddenCount, type DevCard, type GameEvent, type GameEventKind, type Hand, type Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { AnimationSpeed } from "./settings";

export type Step =
  | { readonly kind: "event"; readonly event: GameEvent; readonly duration: number }
  | { readonly kind: "thinking"; readonly playerId: string; readonly duration: number }
  | { readonly kind: "pause"; readonly duration: number };

/** Normal-speed durations in ms (docs/phase7.md §2.2). */
export const BASE_DURATION: Record<GameEventKind, number> = {
  turnStarted: 700,
  diceRolled: 900,
  produced: 400,
  productionBlocked: 300,
  bankShort: 250,
  discarded: 350,
  robberMoved: 450,
  stole: 500,
  built: 300,
  devCardBought: 400,
  devCardPlayed: 900,
  inventionTaken: 400,
  monopolised: 500,
  tradeOffered: 300,
  tradeAccepted: 500,
  tradeDeclined: 200,
  tradeCancelled: 150,
  maritimeTrade: 500,
  specialCardMoved: 600,
  turnEnded: 250,
  specialBuildTurn: 400,
  setupCompleted: 300,
  gameEnded: 1500,
  note: 300,
  shipBuilt: 300,
  shipMoved: 450,
  pirateMoved: 450,
  goldChosen: 400,
  islandSettled: 700,
};

export const PRODUCED_STAGGER = 80;
export const OWN_TURN_BANNER = 300;
export const FAST_DIVISOR = 3;
export const SKIP_DIVISOR = 5;

/** Duration of one event at normal speed for `viewer`. */
export function eventDuration(event: GameEvent, viewer: string): number {
  switch (event.kind) {
    case "turnStarted":
      return event.playerId === viewer ? OWN_TURN_BANNER : BASE_DURATION.turnStarted;
    case "produced":
      return BASE_DURATION.produced + Math.max(0, event.gains.length - 1) * PRODUCED_STAGGER;
    default:
      return BASE_DURATION[event.kind];
  }
}

/** Scale a normal-speed duration by the speed setting and the skip fast-forward. */
export function scaleDuration(ms: number, speed: AnimationSpeed, skipping: boolean): number {
  if (speed === "off") return 0;
  let out = speed === "fast" ? ms / FAST_DIVISOR : ms;
  if (skipping) out /= SKIP_DIVISOR;
  return Math.round(out);
}

/** A small seeded value in [0, 1) from an event's seq, identical on every client (docs/phase7.md §3). */
export function seqNoise(seq: number): number {
  let h = (seq + 1) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Turn a batch of events into steps. Bots get a "thinking" pause before their
 * first event of each turn, a short pause before a build or a trade offer,
 * and a beat before ending their turn. Humans' actions animate unpadded.
 */
export function planSteps(events: readonly GameEvent[], viewer: string, isBot: (playerId: string) => boolean): Step[] {
  const steps: Step[] = [];
  const thought = new Set<string>();
  const push = (s: Step) => steps.push(s);
  const last = (): Step | undefined => steps[steps.length - 1];
  for (const event of events) {
    if (event.kind === "turnStarted") thought.clear();
    const actor = eventPlayer(event);
    const botActor = actor !== null && isBot(actor) && actor !== viewer;
    if (botActor && actor && event.kind !== "turnStarted") {
      if (!thought.has(actor)) {
        thought.add(actor);
        push({ kind: "thinking", playerId: actor, duration: 600 + Math.round(seqNoise(event.seq) * 600) });
      } else if ((event.kind === "built" || event.kind === "tradeOffered") && last()?.kind !== "thinking") {
        push({ kind: "pause", duration: 300 + Math.round(seqNoise(event.seq) * 200) });
      } else if (event.kind === "turnEnded") {
        push({ kind: "pause", duration: 300 });
      }
    }
    push({ kind: "event", event, duration: eventDuration(event, viewer) });
  }
  return steps;
}

export function totalDuration(steps: readonly Step[]): number {
  return steps.reduce((n, s) => n + s.duration, 0);
}

// ---------------------------------------------------------------------------
// Applying events to a rendered view

type P = RedactedState["players"][number];

function playerIndex(view: RedactedState, id: string): number {
  const i = view.players.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`event names unknown player ${id}`);
  return i;
}

function withPlayer(view: RedactedState, id: string, fn: (p: P) => P): RedactedState {
  const i = playerIndex(view, id);
  const players = view.players.slice();
  players[i] = fn(players[i] as P);
  return { ...view, players };
}

function adjustHand(hand: P["hand"], resource: Resource | null, delta: number): P["hand"] {
  if (isHiddenCount(hand)) return { count: Math.max(0, hand.count + delta) };
  if (resource === null) return hand; // an unknown card cannot change a known hand; the snap fixes it
  return { ...hand, [resource]: Math.max(0, hand[resource] + delta) };
}

function adjustHandBy(hand: P["hand"], cards: Hand, sign: 1 | -1): P["hand"] {
  let out = hand;
  for (const r of RESOURCES) if (cards[r] > 0) out = adjustHand(out, r, sign * cards[r]);
  return out;
}

function adjustBank(bank: Hand, cards: Hand, sign: 1 | -1): Hand {
  const out = { ...bank };
  for (const r of RESOURCES) out[r] = Math.max(0, out[r] + sign * cards[r]);
  return out;
}

function costOf(view: RedactedState, piece: "road" | "settlement" | "city" | "ship"): Hand | null {
  // Setup and road-building placements are free; the action and special build phases pay.
  return view.phase.kind === "action" || view.phase.kind === "specialBuild" ? COSTS[piece] : null;
}

function withDev(cards: P["devCards"], fn: (list: DevCard[]) => DevCard[], countDelta: number): P["devCards"] {
  return isHiddenCount(cards) ? { count: Math.max(0, cards.count + countDelta) } : fn(cards);
}

function appendLog(view: RedactedState, event: GameEvent): RedactedState {
  const text = describeEvent(event, (id) => view.players.find((p) => p.id === id)?.name ?? id);
  if (text === null) return view;
  const log = [...view.log, { turn: view.turn, playerId: eventPlayer(event), text }];
  return { ...view, log: log.length > 100 ? log.slice(log.length - 100) : log };
}

/**
 * The view after `event`. Throws when the event cannot be applied to this
 * view (unknown player, impossible piece), which the queue treats as "snap
 * to the server view" (docs/phase7.md §2.1).
 */
export function applyEventToView(view: RedactedState, event: GameEvent): RedactedState {
  let next: RedactedState = { ...view, eventSeq: event.seq + 1 };
  switch (event.kind) {
    case "turnStarted":
      next = { ...next, currentPlayer: playerIndex(next, event.playerId), turn: event.turn };
      break;
    case "diceRolled":
      next = { ...next, lastRoll: event.dice };
      break;
    case "produced": {
      let bank = next.bank;
      for (const g of event.gains) {
        next = withPlayer(next, g.playerId, (p) => ({ ...p, hand: adjustHand(p.hand, g.resource, g.count) }));
        bank = { ...bank, [g.resource]: Math.max(0, bank[g.resource] - g.count) };
      }
      next = { ...next, bank };
      break;
    }
    case "discarded":
      next = withPlayer(next, event.playerId, (p) => ({
        ...p,
        hand: event.cards ? adjustHandBy(p.hand, event.cards, -1) : adjustHand(p.hand, null, -event.count),
      }));
      if (event.cards) next = { ...next, bank: adjustBank(next.bank, event.cards, 1) };
      break;
    case "robberMoved":
      next = { ...next, robberHex: event.to };
      break;
    case "stole":
      next = withPlayer(next, event.from, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, -1) }));
      next = withPlayer(next, event.to, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, 1) }));
      break;
    case "built": {
      const cost = costOf(next, event.piece);
      next = withPlayer(next, event.playerId, (p) => {
        const hand = cost ? adjustHandBy(p.hand, cost, -1) : p.hand;
        switch (event.piece) {
          case "road":
            if (p.roads.includes(event.at)) throw new Error("road already placed");
            return { ...p, hand, roads: [...p.roads, event.at], pieces: { ...p.pieces, roads: p.pieces.roads - 1 } };
          case "settlement":
            if (p.settlements.includes(event.at)) throw new Error("settlement already placed");
            return { ...p, hand, settlements: [...p.settlements, event.at], pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 }, publicVP: p.publicVP + 1 };
          case "city": {
            const idx = p.settlements.indexOf(event.at);
            if (idx < 0) throw new Error("no settlement to upgrade");
            const settlements = p.settlements.filter((v) => v !== event.at);
            return {
              ...p,
              hand,
              settlements,
              cities: [...p.cities, event.at],
              pieces: { ...p.pieces, cities: p.pieces.cities - 1, settlements: p.pieces.settlements + 1 },
              publicVP: p.publicVP + 1,
            };
          }
          default: {
            const exhaustive: never = event.piece;
            throw new Error(String(exhaustive));
          }
        }
      });
      if (cost) next = { ...next, bank: adjustBank(next.bank, cost, 1) };
      break;
    }
    case "devCardBought":
      next = withPlayer(next, event.playerId, (p) => ({
        ...p,
        hand: adjustHandBy(p.hand, COSTS.devCard, -1),
        devCards: withDev(p.devCards, (list) => (event.card ? [...list, { type: event.card, boughtOnTurn: next.turn }] : list), 1),
      }));
      next = { ...next, bank: adjustBank(next.bank, COSTS.devCard, 1), devDeck: { count: Math.max(0, next.devDeck.count - 1) } };
      break;
    case "devCardPlayed":
      next = withPlayer(next, event.playerId, (p) => {
        const devCards = withDev(
          p.devCards,
          (list) => {
            const i = list.findIndex((c) => c.type === event.card);
            return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
          },
          -1,
        );
        return { ...p, devCards, devCardPlayedThisTurn: true, playedKnights: p.playedKnights + (event.card === "knight" ? 1 : 0) };
      });
      break;
    case "inventionTaken": {
      const want: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      want[event.resources[0]] += 1;
      want[event.resources[1]] += 1;
      next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHandBy(p.hand, want, 1) }));
      next = { ...next, bank: adjustBank(next.bank, want, -1) };
      break;
    }
    case "monopolised": {
      let total = 0;
      for (const [id, n] of Object.entries(event.taken)) {
        total += n;
        next = withPlayer(next, id, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, -n) }));
      }
      next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, total) }));
      break;
    }
    case "tradeOffered":
      next = { ...next, pendingTrade: { from: event.playerId, give: event.give, receive: event.receive, rejectedBy: [] } };
      break;
    case "tradeAccepted":
      next = withPlayer(next, event.from, (p) => ({ ...p, hand: adjustHandBy(adjustHandBy(p.hand, event.give, -1), event.receive, 1) }));
      next = withPlayer(next, event.to, (p) => ({ ...p, hand: adjustHandBy(adjustHandBy(p.hand, event.receive, -1), event.give, 1) }));
      next = { ...next, pendingTrade: null };
      break;
    case "tradeDeclined":
      if (next.pendingTrade) next = { ...next, pendingTrade: { ...next.pendingTrade, rejectedBy: [...next.pendingTrade.rejectedBy, event.playerId] } };
      break;
    case "tradeCancelled":
      next = { ...next, pendingTrade: null };
      break;
    case "maritimeTrade": {
      const give: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      give[event.give] = event.count;
      const get: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      get[event.receive] = 1;
      next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHandBy(adjustHandBy(p.hand, give, -1), get, 1) }));
      next = { ...next, bank: adjustBank(adjustBank(next.bank, give, 1), get, -1) };
      break;
    }
    case "specialCardMoved": {
      if (event.from) next = withPlayer(next, event.from, (p) => ({ ...p, publicVP: p.publicVP - 2 }));
      if (event.to) next = withPlayer(next, event.to, (p) => ({ ...p, publicVP: p.publicVP + 2 }));
      if (event.card === "longestRoad") next = { ...next, longestRoad: { ...next.longestRoad, playerId: event.to } };
      else next = { ...next, largestArmy: { ...next.largestArmy, playerId: event.to } };
      break;
    }
    case "gameEnded":
      next = { ...next, winner: event.winner, phase: { kind: "ended" } };
      break;
    case "shipBuilt": {
      const cost = costOf(next, "ship");
      next = withPlayer(next, event.playerId, (p) => {
        if (p.ships.includes(event.at)) throw new Error("ship already placed");
        return { ...p, hand: cost ? adjustHandBy(p.hand, cost, -1) : p.hand, ships: [...p.ships, event.at], shipsBuiltThisTurn: [...p.shipsBuiltThisTurn, event.at], pieces: { ...p.pieces, ships: p.pieces.ships - 1 } };
      });
      if (cost) next = { ...next, bank: adjustBank(next.bank, cost, 1) };
      break;
    }
    case "shipMoved":
      next = withPlayer(next, event.playerId, (p) => {
        if (!p.ships.includes(event.from)) throw new Error("no ship to move");
        return { ...p, ships: [...p.ships.filter((e) => e !== event.from), event.to], shipMovedThisTurn: true };
      });
      break;
    case "pirateMoved":
      next = { ...next, pirateHex: event.to };
      break;
    case "goldChosen": {
      const want: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      for (const r of event.resources) want[r] += 1;
      next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHandBy(p.hand, want, 1) }));
      next = { ...next, bank: adjustBank(next.bank, want, -1) };
      break;
    }
    case "islandSettled":
      next = withPlayer(next, event.playerId, (p) => ({ ...p, islandChips: [...p.islandChips, event.island], publicVP: p.publicVP + event.bonus }));
      break;
    case "turnEnded":
    case "specialBuildTurn":
    case "productionBlocked":
    case "bankShort":
    case "setupCompleted":
    case "note":
      break;
    default: {
      const exhaustive: never = event;
      throw new Error(`unknown event ${JSON.stringify(exhaustive)}`);
    }
  }
  return appendLog(next, event);
}

// ---------------------------------------------------------------------------
// The queue itself: a small state machine driven by an injectable clock so it
// is unit-testable without timers.

export interface Batch {
  readonly steps: Step[];
  /** The authoritative view at the end of the batch; the queue snaps to it. */
  readonly target: RedactedState;
}

export interface QueueState {
  readonly rendered: RedactedState;
  readonly current: Step | null;
  readonly draining: boolean;
  readonly skipping: boolean;
}

export interface QueueOptions {
  speed: () => AnimationSpeed;
  isBot: (playerId: string) => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onChange: (state: QueueState) => void;
  /** Called when a step starts (sound, focus moves). */
  onStep?: (step: Step, rendered: RedactedState) => void;
}

export class EventQueue {
  private rendered: RedactedState;
  private batches: Batch[] = [];
  private steps: Step[] = [];
  private target: RedactedState | null = null;
  private current: Step | null = null;
  private timer: unknown = null;
  private skipping = false;

  constructor(
    initial: RedactedState,
    private readonly opts: QueueOptions,
  ) {
    this.rendered = initial;
  }

  state(): QueueState {
    return { rendered: this.rendered, current: this.current, draining: this.current !== null, skipping: this.skipping };
  }

  /** A new server view arrived. */
  push(view: RedactedState): void {
    const events = view.events;
    const tail = this.batches.length ? (this.batches[this.batches.length - 1] as Batch).target : this.target;
    const expectedSeq = tail ? tail.eventSeq : this.rendered.eventSeq;
    const contiguous = events.length > 0 && events[0]!.seq === expectedSeq;
    if (this.opts.speed() === "off" || events.length === 0 || !contiguous) {
      // Nothing to animate, or a gap: never desync — snap and drop the queue.
      if (events.length > 0 && !contiguous) this.snap(view);
      else if (this.current === null) this.snap(view);
      else this.batches.push({ steps: [], target: view }); // zero-length batch keeps ordering
      return;
    }
    this.batches.push({ steps: planSteps(events, view.viewer, this.opts.isBot), target: view });
    if (this.current === null) this.next();
  }

  /** Fast-forward everything queued (docs/phase7.md §2.1). */
  skip(): void {
    if (this.current === null) return;
    this.skipping = true;
    // Re-arm the running step with the shortened remainder: simplest is to end it now.
    this.opts.clearTimer(this.timer);
    this.next();
  }

  private snap(view: RedactedState): void {
    this.opts.clearTimer(this.timer);
    this.timer = null;
    this.batches = [];
    this.steps = [];
    this.target = null;
    this.current = null;
    this.skipping = false;
    this.rendered = view;
    this.opts.onChange(this.state());
  }

  private next(): void {
    if (this.steps.length === 0) {
      if (this.target) {
        // End of a batch: the server view is the truth.
        this.rendered = this.target;
        this.target = null;
      }
      const batch = this.batches.shift();
      if (!batch) {
        this.current = null;
        this.skipping = false;
        this.opts.onChange(this.state());
        return;
      }
      this.steps = batch.steps.slice();
      this.target = batch.target;
      if (this.steps.length === 0) {
        this.next();
        return;
      }
    }
    const step = this.steps.shift() as Step;
    if (step.kind === "event") {
      try {
        this.rendered = applyEventToView(this.rendered, step.event);
      } catch {
        // Inconsistent reconstruction: snap to the latest server view (docs/phase7.md §2.1).
        const latest = this.batches.length ? (this.batches[this.batches.length - 1] as Batch).target : (this.target as RedactedState);
        this.snap(latest);
        return;
      }
    }
    this.current = step;
    this.opts.onStep?.(step, this.rendered);
    this.opts.onChange(this.state());
    const ms = scaleDuration(step.duration, this.opts.speed(), this.skipping);
    this.timer = this.opts.setTimer(() => this.next(), ms);
  }

  dispose(): void {
    this.opts.clearTimer(this.timer);
  }
}
