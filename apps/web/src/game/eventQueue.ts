/**
 * The animation queue's pure core (docs/phase7.md §2–§3). No React, no DOM:
 * given a view and its events it plans timed steps (with synthetic bot
 * "thinking" pauses), and applies events one at a time to a rendered view so
 * the screen advances in step with the animation rather than snapping.
 */

import {
  COSTS,
  RESOURCES,
  TRACKS,
  VP_PROGRESS_CARDS,
  WAGON_GOODS,
  describeEvent,
  edgeVerticesOf,
  eventPlayer,
  isHiddenCount,
  isHiddenProgress,
  trackOfCard,
  type Commodity,
  type CommodityHand,
  type DevCard,
  type GameEvent,
  type GameEventKind,
  type Hand,
  type Knight,
  type KnightLevel,
  type ProgressCard,
  type RedactedCrown,
  type RedactedCrownPlayer,
  type RedactedWayfarers,
  type Resource,
  type WagonGood,
} from "@katan/engine";
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
  buildUndone: 300,
  devCardBought: 400,
  devCardPlayed: 900,
  inventionTaken: 400,
  monopolised: 500,
  tradeOffered: 300,
  tradeAccepted: 500,
  tradeDeclined: 200,
  tradeCountered: 300,
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
  // Wayfarers (docs/phase10.md)
  deckReshuffled: 400,
  neighborlyGave: 400,
  taxCollected: 350,
  fishDrawn: 450,
  fishSpent: 400,
  bootPassed: 500,
  bridgeBuilt: 300,
  coinsAwarded: 350,
  chipMoved: 600,
  castleBuilt: 400,
  raidersAdvanced: 500,
  guardPlaced: 300,
  raid: 1200,
  hexRebuilt: 400,
  spiceProduced: 400,
  caravanExtended: 500,
  wagonMoved: 600,
  goodLoaded: 300,
  delivered: 600,
  goodsStocked: 200,
  // Crown & Castle (docs/phase11.md)
  commoditiesProduced: 400,
  progressDrawn: 450,
  progressPlayed: 800,
  progressDiscarded: 300,
  improvementBuilt: 600,
  metropolisPlaced: 900,
  knightBuilt: 350,
  knightActivated: 300,
  knightPromoted: 350,
  knightMoved: 450,
  knightDisplaced: 600,
  knightRetreated: 450,
  knightRemoved: 400,
  knightsDeactivated: 400,
  robberChased: 450,
  wallBuilt: 350,
  fleetAdvanced: 500,
  fleetAttacked: 1500,
  cityDowngraded: 700,
  defenderAwarded: 700,
  merchantPlaced: 450,
  cardsTaken: 500,
  commodityMonopolised: 500,
  resourceMonopolised: 500,
  tokensSwapped: 600,
  roadRemoved: 450,
  alchemistSet: 300,
  commercialSwap: 400,
  resourcesTaken: 400,
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

function asResource(x: string | null | undefined): Resource | null {
  return x === "wood" || x === "clay" || x === "wool" || x === "grain" || x === "ore" ? x : null;
}

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


// --- Wayfarers (docs/phase10.md): keep the variant state in step with its events -----------------

/** The event deck's size (docs/rules.md §15.1); the rendered count resets to it on a reshuffle. */
export const EVENT_DECK_SIZE = 36;
/** A guard and a rebuild both cost one ore and one wool (docs/rules.md §15.5). */
export const GUARD_COST: Hand = { wood: 0, clay: 0, wool: 1, grain: 0, ore: 1 };

type W = NonNullable<RedactedWayfarers>;

/**
 * Fish buy a free road, card or city (docs/rules.md §15.2) whose `built` /
 * `devCardBought` event looks like a paid one: the rendered view carries a
 * one-event marker so the next event charges nothing (and a free bridge skips
 * its surcharge). The marker never survives the event after it.
 */
type FreeBuild = "road" | "bridge" | "devCard" | "city";
type Rendered = RedactedState & { readonly freeBuild?: FreeBuild; readonly crownPending?: CrownPending };

function withWayfarers(view: RedactedState, fn: (w: W) => W): RedactedState {
  if (!view.wayfarers) throw new Error("event needs a Wayfarers variant that is not on");
  return { ...view, wayfarers: fn(view.wayfarers) };
}

function withVP(view: RedactedState, id: string | null, delta: number): RedactedState {
  return id === null ? view : withPlayer(view, id, (p) => ({ ...p, publicVP: p.publicVP + delta }));
}

/** Pay `cost` from a player's hand into the bank in the rendered view. */
function pay(view: RedactedState, id: string, cost: Hand): RedactedState {
  const next = withPlayer(view, id, (p) => ({ ...p, hand: adjustHandBy(p.hand, cost, -1) }));
  return { ...next, bank: adjustBank(next.bank, cost, 1) };
}

function bump(record: Record<string, number>, id: string, delta: number): Record<string, number> {
  return { ...record, [id]: (record[id] ?? 0) + delta };
}

/** Bridge Builder's count: the holder's roads on river edges (docs/rules.md §15.3). */
function riverRoads(view: RedactedState, id: string | null): number {
  if (id === null) return 0;
  const p = view.players.find((x) => x.id === id);
  return p ? p.roads.filter((e) => view.board.rivers.includes(e)).length : 0;
}

/** Harbormaster's points: 1 per settlement and 2 per city on a harbour vertex (docs/rules.md §15.4). */
function harborPoints(view: RedactedState, id: string | null): number {
  if (id === null) return 0;
  const p = view.players.find((x) => x.id === id);
  if (!p) return 0;
  const harbour = new Set(view.board.ports.flatMap((port) => [...port.vertices]));
  return p.settlements.filter((v) => harbour.has(v)).length + 2 * p.cities.filter((v) => harbour.has(v)).length;
}

/** Recount the chips whose holder just built something (their counts are not in the events). */
function recountChips(view: RedactedState, id: string): RedactedState {
  const w = view.wayfarers;
  if (!w) return view;
  let out = w;
  if (out.rivers && out.rivers.bridgeBuilder.playerId === id) out = { ...out, rivers: { ...out.rivers, bridgeBuilder: { playerId: id, count: riverRoads(view, id) } } };
  if (out.harbormaster && out.harbormaster.playerId === id) out = { ...out, harbormaster: { playerId: id, points: harborPoints(view, id) } };
  if (out.wagons) {
    const p = view.players.find((x) => x.id === id);
    const stock = { ...out.wagons.stock };
    for (const v of p?.cities ?? []) stock[v] ??= [];
    // docs/rules.md §15.7: the wagon appears on the second setup settlement (no event of its own).
    const start = p && !out.wagons.wagons[id] && p.settlements.length === 2 ? p.settlements[1] : undefined;
    const wagons = start ? { ...out.wagons.wagons, [id]: { at: start, cargo: [], cargoFrom: [], stepsUsed: 0 } } : out.wagons.wagons;
    out = { ...out, wagons: { ...out.wagons, stock, wagons } };
  }
  return out === w ? view : { ...view, wayfarers: out };
}

function nextGood(good: WagonGood): WagonGood {
  return WAGON_GOODS[(WAGON_GOODS.indexOf(good) + 1) % WAGON_GOODS.length] as WagonGood;
}

function applyWayfarersEvent(view: RedactedState, event: GameEvent, free: FreeBuild | undefined): RedactedState {
  let next = view;
  switch (event.kind) {
    case "deckReshuffled":
      return withWayfarers(next, (w) => ({ ...w, eventDeck: w.eventDeck ? { count: EVENT_DECK_SIZE, shuffles: w.eventDeck.shuffles + 1 } : null }));
    case "neighborlyGave": {
      if (!event.gave) return next;
      const r = asResource(event.resource);
      next = withPlayer(next, event.from, (p) => ({ ...p, hand: adjustHand(p.hand, r, -1) }));
      return withPlayer(next, event.to, (p) => ({ ...p, hand: adjustHand(p.hand, r, 1) }));
    }
    case "taxCollected":
      return next; // the card itself arrives as a `discarded` event
    case "fishDrawn":
      next = withWayfarers(next, (w) => {
        if (!w.fishing) throw new Error("fish without the Fishing variant");
        const bag = w.fishing.bag.length > 0 ? w.fishing.bag.slice(1) : w.fishing.bag;
        return event.boot
          ? { ...w, fishing: { ...w.fishing, bag, boot: event.playerId } }
          : { ...w, fishing: { ...w.fishing, bag, fish: bump(w.fishing.fish, event.playerId, event.fish) } };
      });
      return event.boot ? withVP(next, event.playerId, -1) : next;
    case "fishSpent": {
      next = withWayfarers(next, (w) => {
        if (!w.fishing) throw new Error("fish without the Fishing variant");
        return { ...w, fishing: { ...w.fishing, fish: bump(w.fishing.fish, event.playerId, -event.fish), spent: w.fishing.spent + event.fish } };
      });
      // The free road, card or city arrives as the next `built` / `devCardBought` event: mark it as paid for.
      if (event.option === "freeRoad") return { ...next, freeBuild: "road" } as Rendered;
      if (event.option === "freeDevCard") return { ...next, freeBuild: next.devDeck.count > 0 ? "devCard" : "city" } as Rendered;
      return next;
    }
    case "bootPassed":
      next = withWayfarers(next, (w) => (w.fishing ? { ...w, fishing: { ...w.fishing, boot: event.to } } : w));
      return withVP(withVP(next, event.from, 1), event.to, -1);
    case "bridgeBuilt":
      // The surcharge is paid in the action and special build phases only, like the road itself (never for a fish road).
      return costOf(next, "road") && free !== "bridge" ? pay(next, event.playerId, { wood: 0, clay: 1, wool: 0, grain: 0, ore: 0 }) : next;
    case "coinsAwarded":
      return withWayfarers(next, (w) => (w.rivers ? { ...w, rivers: { ...w.rivers, coins: { ...w.rivers.coins, [event.playerId]: event.total } } } : w));
    case "chipMoved": {
      const vp = event.chip === "bridgeBuilder" ? 1 : event.chip === "poorSettler" ? -2 : 2;
      next = withVP(withVP(next, event.from, -vp), event.to, vp);
      return withWayfarers(next, (w) => {
        switch (event.chip) {
          case "bridgeBuilder":
            return w.rivers ? { ...w, rivers: { ...w.rivers, bridgeBuilder: { playerId: event.to, count: riverRoads(next, event.to) } } } : w;
          case "poorSettler":
            return w.rivers ? { ...w, rivers: { ...w.rivers, poorSettler: event.to } } : w;
          case "harbormaster":
            return w.harbormaster ? { ...w, harbormaster: { playerId: event.to, points: harborPoints(next, event.to) } } : w;
          default:
            return w;
        }
      });
    }
    case "castleBuilt":
      next = withWayfarers(next, (w) => (w.raiders ? { ...w, raiders: { ...w.raiders, castles: { ...w.raiders.castles, [event.playerId]: event.vertex } } } : w));
      return withVP(next, event.playerId, 1);
    case "raidersAdvanced":
      return withWayfarers(next, (w) => (w.raiders ? { ...w, raiders: { ...w.raiders, counter: event.counter } } : w));
    case "guardPlaced":
      next = pay(next, event.playerId, GUARD_COST);
      return withWayfarers(next, (w) => (w.raiders ? { ...w, raiders: { ...w.raiders, guards: { ...w.raiders.guards, [event.playerId]: [...(w.raiders.guards[event.playerId] ?? []), event.hex] } } } : w));
    case "raid":
      return withWayfarers(next, (w) => {
        if (!w.raiders) return w;
        const guards = { ...w.raiders.guards };
        for (const lost of event.guardsLost) {
          const list = [...(guards[lost.playerId] ?? [])];
          const i = list.indexOf(lost.hex);
          if (i >= 0) list.splice(i, 1);
          guards[lost.playerId] = list;
        }
        const raided = [...w.raiders.raided];
        for (const h of event.raided) if (!raided.includes(h)) raided.push(h);
        return { ...w, raiders: { ...w.raiders, guards, raided, counter: 0, landings: w.raiders.landings + 1 } };
      });
    case "hexRebuilt":
      next = pay(next, event.playerId, GUARD_COST);
      next = withWayfarers(next, (w) => (w.raiders ? { ...w, raiders: { ...w.raiders, raided: w.raiders.raided.filter((h) => h !== event.hex), rebuilt: bump(w.raiders.rebuilt, event.playerId, 1) } } : w));
      return withVP(next, event.playerId, 1);
    case "spiceProduced":
      return withWayfarers(next, (w) => {
        if (!w.caravans) return w;
        let spice = w.caravans.spice;
        let bank = w.caravans.spiceBank;
        for (const g of event.gains) {
          spice = bump(spice, g.playerId, g.count);
          bank -= g.count;
        }
        return { ...w, caravans: { ...w.caravans, spice, spiceBank: Math.max(0, bank) } };
      });
    case "caravanExtended":
      return withWayfarers(next, (w) => {
        if (!w.caravans) return w;
        const tracks = w.caravans.tracks.map((t, i) => (i === event.caravan ? { ...t, edges: [...t.edges, event.edge] } : t));
        return { ...w, caravans: { ...w.caravans, tracks, spice: bump(w.caravans.spice, event.playerId, -1), spiceBank: w.caravans.spiceBank + 1 } };
      });
    case "wagonMoved": {
      const grain: Hand = { wood: 0, clay: 0, wool: 0, grain: event.grain, ore: 0 };
      if (event.grain > 0) next = pay(next, event.playerId, grain);
      if (event.toll !== null) {
        // The toll's resource is not in the event: hidden counts move, a known hand waits for the snap.
        next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHand(p.hand, null, -1) }));
        next = withPlayer(next, event.toll, (p) => ({ ...p, hand: adjustHand(p.hand, null, 1) }));
      }
      return withWayfarers(next, (w) => {
        if (!w.wagons) throw new Error("no wagon to move");
        const wagon = w.wagons.wagons[event.playerId] ?? { at: event.path[0] as string, cargo: [], cargoFrom: [], stepsUsed: 0 };
        const at = event.path[event.path.length - 1] as string;
        return { ...w, wagons: { ...w.wagons, wagons: { ...w.wagons.wagons, [event.playerId]: { ...wagon, at, stepsUsed: wagon.stepsUsed + event.path.length - 1 } } } };
      });
    }
    case "goodLoaded":
      return withWayfarers(next, (w) => {
        const wagon = w.wagons?.wagons[event.playerId];
        if (!w.wagons || !wagon) throw new Error("no wagon to load");
        const shelf = [...(w.wagons.stock[event.vertex] ?? [])];
        const i = shelf.indexOf(event.good);
        if (i >= 0) shelf.splice(i, 1);
        return {
          ...w,
          wagons: {
            ...w.wagons,
            stock: { ...w.wagons.stock, [event.vertex]: shelf },
            wagons: { ...w.wagons.wagons, [event.playerId]: { ...wagon, cargo: [...wagon.cargo, event.good], cargoFrom: [...wagon.cargoFrom, event.vertex] } },
          },
        };
      });
    case "delivered":
      next = withWayfarers(next, (w) => {
        const wagon = w.wagons?.wagons[event.playerId];
        if (!w.wagons || !wagon) throw new Error("no wagon to deliver from");
        const i = wagon.cargo.findIndex((g, k) => g === event.good && wagon.cargoFrom[k] !== event.vertex);
        const cargo = wagon.cargo.filter((_, k) => k !== i);
        const cargoFrom = wagon.cargoFrom.filter((_, k) => k !== i);
        const held = w.wagons.demand[event.vertex];
        const demand = held ? { ...w.wagons.demand, [event.vertex]: nextGood(held) } : w.wagons.demand;
        return { ...w, wagons: { ...w.wagons, demand, points: bump(w.wagons.points, event.playerId, event.points), wagons: { ...w.wagons.wagons, [event.playerId]: { ...wagon, cargo, cargoFrom } } } };
      });
      return withVP(next, event.playerId, event.points);
    case "goodsStocked":
      return withWayfarers(next, (w) => {
        if (!w.wagons) return w;
        const stock = { ...w.wagons.stock };
        for (const s of event.stocked) stock[s.vertex] = [...(stock[s.vertex] ?? []), s.good];
        return { ...w, wagons: { ...w.wagons, stock } };
      });
    default:
      return next;
  }
}

// --- Crown & Castle (docs/phase11.md §11): keep the module state in step with its events -----------

/** docs/rules.md §16.5, §16.7, §16.4: the costs the events do not carry. */
export const KNIGHT_COST: Hand = { wood: 0, clay: 0, wool: 1, grain: 0, ore: 1 };
export const ACTIVATE_COST: Hand = { wood: 0, clay: 0, wool: 0, grain: 1, ore: 0 };
export const WALL_COST: Hand = { wood: 0, clay: 2, wool: 0, grain: 0, ore: 0 };
export const MEDICINE_COST: Hand = { wood: 0, clay: 0, wool: 0, grain: 1, ore: 2 };

/**
 * Things a later crown event needs to know about an earlier one (the events
 * themselves do not say whether a knight was free, or which knight is
 * retreating). Transient markers live exactly as long as the events they
 * bridge; `settlePending` drops them when something else happens.
 */
export interface CrownPending {
  /** Deserter: `by` places a free knight of this level next (their next `knightBuilt`). */
  readonly freeKnight?: { readonly by: string; readonly level: KnightLevel };
  /** Displaced knights waiting for their owner's retreat, by owner. */
  readonly retreating?: Readonly<Record<string, { readonly level: KnightLevel; readonly active: boolean }>>;
  /** Smith: the next `knightPromoted` events are free. */
  readonly freePromotions?: boolean;
  /** Medicine: the next `built` city is paid with two ore and one grain. */
  readonly medicine?: boolean;
  /** Master Merchant: its `stole` events carry the cards; the closing `cardsTaken` is a summary. */
  readonly masterMerchant?: boolean;
}

function settlePending(p: CrownPending, kind: GameEventKind): CrownPending | undefined {
  const out: { -readonly [K in keyof CrownPending]: CrownPending[K] } = { ...p };
  if (kind !== "knightPromoted") delete out.freePromotions;
  if (kind !== "built") delete out.medicine;
  if (kind !== "stole" && kind !== "cardsTaken") delete out.masterMerchant;
  return Object.keys(out).length === 0 ? undefined : out;
}

function withPending(view: RedactedState, pending: CrownPending | undefined): RedactedState {
  const { crownPending: _drop, ...rest } = view as Rendered;
  void _drop;
  return pending ? ({ ...rest, crownPending: pending } as Rendered) : rest;
}

function addPending(view: RedactedState, patch: CrownPending): RedactedState {
  const current = (view as Rendered).crownPending ?? {};
  return withPending(view, { ...current, ...patch });
}

type C = NonNullable<RedactedCrown>;

function asCommodity(x: string | null | undefined): Commodity | null {
  return x === "cloth" || x === "coin" || x === "paper" ? x : null;
}

function emptyCommodities(): CommodityHand {
  return { cloth: 0, coin: 0, paper: 0 };
}

function oneCommodity(c: Commodity): CommodityHand {
  return { ...emptyCommodities(), [c]: 1 };
}

function withCrown(view: RedactedState, fn: (c: C) => C): RedactedState {
  if (!view.crown) throw new Error("event needs Crown & Castle, which is not on");
  return { ...view, crown: fn(view.crown) };
}

function withCrownPlayer(view: RedactedState, id: string, fn: (p: RedactedCrownPlayer) => RedactedCrownPlayer): RedactedState {
  return withCrown(view, (c) => {
    const p = c.players[id];
    if (!p) throw new Error(`event names unknown player ${id}`);
    return { ...c, players: { ...c.players, [id]: fn(p) } };
  });
}

/** Move commodities from one purse to another; `null` on either side is the commodity bank. */
function moveCommodities(view: RedactedState, from: string | null, to: string | null, cards: CommodityHand): RedactedState {
  const sub = (h: CommodityHand): CommodityHand => ({ cloth: Math.max(0, h.cloth - cards.cloth), coin: Math.max(0, h.coin - cards.coin), paper: Math.max(0, h.paper - cards.paper) });
  const add = (h: CommodityHand): CommodityHand => ({ cloth: h.cloth + cards.cloth, coin: h.coin + cards.coin, paper: h.paper + cards.paper });
  let next = view;
  next = from === null ? withCrown(next, (c) => ({ ...c, bank: sub(c.bank) })) : withCrownPlayer(next, from, (p) => ({ ...p, commodities: sub(p.commodities) }));
  next = to === null ? withCrown(next, (c) => ({ ...c, bank: add(c.bank) })) : withCrownPlayer(next, to, (p) => ({ ...p, commodities: add(p.commodities) }));
  return next;
}

/** A card enters a progress hand: the viewer's own list, or another player's count (VP cards are face up for everyone). */
function gainProgress(hand: RedactedCrownPlayer["progress"], card: ProgressCard | null): RedactedCrownPlayer["progress"] {
  const revealed = card !== null && VP_PROGRESS_CARDS.includes(card);
  if (isHiddenProgress(hand)) return { count: hand.count + 1, revealed: revealed && card ? [...hand.revealed, card] : hand.revealed };
  if (card === null) throw new Error("the viewer's own draw must name the card");
  return [...hand, { card, revealed }];
}

/** A face-down card leaves a progress hand (the first match, as the engine does); `null` when the card is unknown. */
function loseProgress(hand: RedactedCrownPlayer["progress"], card: ProgressCard | null): RedactedCrownPlayer["progress"] {
  if (isHiddenProgress(hand)) return { ...hand, count: Math.max(0, hand.count - 1) };
  if (card === null) return hand; // an unknown card cannot leave a known hand; the snap fixes it
  const i = hand.findIndex((h) => h.card === card && !h.revealed);
  return i < 0 ? hand : [...hand.slice(0, i), ...hand.slice(i + 1)];
}

function knightAt(c: C, vertex: string): Knight | undefined {
  return c.knights.find((k) => k.at === vertex);
}

function withKnight(view: RedactedState, vertex: string, fn: (k: Knight) => Knight): RedactedState {
  return withCrown(view, (c) => {
    if (!knightAt(c, vertex)) throw new Error(`no knight at ${vertex}`);
    return { ...c, knights: c.knights.map((k) => (k.at === vertex ? fn(k) : k)) };
  });
}

function removeKnight(view: RedactedState, vertex: string): RedactedState {
  return withCrown(view, (c) => ({ ...c, knights: c.knights.filter((k) => k.at !== vertex) }));
}

function placeKnight(view: RedactedState, owner: string, at: string, level: KnightLevel, active: boolean, actedThisTurn: boolean): RedactedState {
  return withCrown(view, (c) => {
    if (knightAt(c, at)) throw new Error(`a knight already stands at ${at}`);
    return { ...c, knights: [...c.knights, { owner, at, level, active, actedThisTurn, builtOnTurn: view.turn }] };
  });
}

/** docs/rules.md §16.4 (Deserter): may `playerId` place a knight of `level` — a piece in supply and a free vertex on their roads? */
function canPlaceFreeKnight(view: RedactedState, playerId: string, level: KnightLevel): boolean {
  const c = view.crown;
  const p = view.players.find((x) => x.id === playerId);
  if (!c || !p) return false;
  if (c.knights.filter((k) => k.owner === playerId && k.level === level).length >= 2) return false;
  const taken = new Set<string>([...c.knights.map((k) => k.at), ...view.players.flatMap((x) => [...x.settlements, ...x.cities])]);
  return [...p.roads, ...p.ships].some((e) => edgeVerticesOf(e).some((v) => !taken.has(v)));
}

/** docs/rules.md §16.5, §16.4: per-turn flags reset (knights, progress cards, the Merchant Fleet). */
function crownTurnStarted(view: RedactedState): RedactedState {
  const next = withCrown(view, (c) => {
    const players: Record<string, RedactedCrownPlayer> = {};
    for (const [id, p] of Object.entries(c.players)) players[id] = { ...p, progressPlayedThisTurn: 0, progressPlayedBeforeRoll: false, merchantFleet: null };
    return { ...c, players, knights: c.knights.map((k) => (k.actedThisTurn ? { ...k, actedThisTurn: false } : k)) };
  });
  const p = (next as Rendered).crownPending;
  if (!p?.freeKnight) return next;
  const { freeKnight: _gone, ...rest } = p;
  void _gone;
  return withPending(next, Object.keys(rest).length ? rest : undefined);
}

function applyCrownEvent(view: RedactedState, event: GameEvent, pending: CrownPending | undefined): RedactedState {
  let next = view;
  switch (event.kind) {
    case "commoditiesProduced":
      for (const g of event.gains) next = moveCommodities(next, null, g.playerId, { ...emptyCommodities(), [g.commodity]: g.count });
      return next;
    case "progressDrawn":
      next = withCrown(next, (c) => ({ ...c, decks: { ...c.decks, [event.track]: Math.max(0, c.decks[event.track] - 1) } }));
      next = withCrownPlayer(next, event.playerId, (p) => ({ ...p, progress: gainProgress(p.progress, event.card) }));
      return event.card !== null && VP_PROGRESS_CARDS.includes(event.card) ? withVP(next, event.playerId, 1) : next;
    case "progressPlayed": {
      const track = trackOfCard(event.card);
      const beforeRoll = next.phase.kind === "roll";
      next = withCrown(next, (c) => ({ ...c, decks: { ...c.decks, [track]: c.decks[track] + 1 } }));
      next = withCrownPlayer(next, event.playerId, (p) => ({
        ...p,
        progress: loseProgress(p.progress, event.card),
        progressPlayedThisTurn: p.progressPlayedThisTurn + 1,
        progressPlayedBeforeRoll: p.progressPlayedBeforeRoll || beforeRoll,
        crane: event.card === "crane" ? true : p.crane,
      }));
      switch (event.card) {
        case "roadBuilding": {
          const p = next.players.find((x) => x.id === event.playerId);
          const pieces = (p?.pieces.roads ?? 0) + (next.scenario?.tides ? (p?.pieces.ships ?? 0) : 0);
          return { ...next, phase: { kind: "roadBuilding", remaining: pieces >= 2 ? 2 : 1 } };
        }
        case "smith":
          return addPending(next, { freePromotions: true });
        case "medicine":
          return addPending(next, { medicine: true });
        case "masterMerchant":
          return addPending(next, { masterMerchant: true });
        default:
          return next;
      }
    }
    case "progressDiscarded": {
      next = withCrownPlayer(next, event.playerId, (p) => ({ ...p, progress: loseProgress(p.progress, event.card) }));
      // The card goes under its deck; a third party does not learn which.
      if (event.card === null) return next;
      const track = trackOfCard(event.card);
      return withCrown(next, (c) => ({ ...c, decks: { ...c.decks, [track]: c.decks[track] + 1 } }));
    }
    case "improvementBuilt": {
      const commodity = TRACKS.includes(event.track) ? ({ trade: "cloth", politics: "coin", science: "paper" } as const)[event.track] : null;
      if (!commodity) throw new Error(`unknown track ${event.track}`);
      const cp = next.crown?.players[event.playerId];
      if (!cp) throw new Error(`event names unknown player ${event.playerId}`);
      const cost = cp.crane ? Math.max(1, event.level - 1) : event.level;
      next = moveCommodities(next, event.playerId, null, { ...emptyCommodities(), [commodity]: cost });
      return withCrownPlayer(next, event.playerId, (p) => ({ ...p, crane: false, tracks: { ...p.tracks, [event.track]: event.level } }));
    }
    case "metropolisPlaced":
      if (event.from !== null) {
        next = withCrownPlayer(next, event.from, (p) => ({ ...p, metropolises: { ...p.metropolises, [event.track]: null } }));
        next = withVP(next, event.from, -2);
      }
      next = withCrownPlayer(next, event.playerId, (p) => ({ ...p, metropolises: { ...p.metropolises, [event.track]: event.vertex } }));
      next = withCrown(next, (c) => ({ ...c, metropolis: { ...c.metropolis, [event.track]: event.playerId } }));
      return withVP(next, event.playerId, 2);
    case "knightBuilt": {
      const free = pending?.freeKnight?.by === event.playerId ? pending.freeKnight : undefined;
      if (free && pending) {
        const { freeKnight: _used, ...rest } = pending;
        void _used;
        next = withPending(next, Object.keys(rest).length ? rest : undefined);
        return placeKnight(next, event.playerId, event.vertex, free.level, false, true);
      }
      if (next.phase.kind === "action") next = pay(next, event.playerId, KNIGHT_COST);
      return placeKnight(next, event.playerId, event.vertex, 1, false, true);
    }
    case "knightActivated":
      if (!event.free) next = pay(next, event.playerId, ACTIVATE_COST);
      return withKnight(next, event.vertex, (k) => ({ ...k, active: true, actedThisTurn: true }));
    case "knightPromoted":
      if (!pending?.freePromotions) next = pay(next, event.playerId, KNIGHT_COST);
      return withKnight(next, event.vertex, (k) => ({ ...k, level: event.level }));
    case "knightMoved":
      next = withKnight(next, event.from, (k) => ({ ...k, at: event.to, active: false, actedThisTurn: true }));
      return next;
    case "knightDisplaced": {
      const victim = next.crown ? knightAt(next.crown, event.to) : undefined;
      if (!victim) throw new Error(`no knight to displace at ${event.to}`);
      next = removeKnight(next, event.to);
      next = withKnight(next, event.from, (k) => ({ ...k, at: event.to, active: false, actedThisTurn: true }));
      return addPending(next, { retreating: { ...(pending?.retreating ?? {}), [victim.owner]: { level: victim.level, active: victim.active } } });
    }
    case "knightRetreated": {
      const spec = pending?.retreating?.[event.playerId];
      if (spec) {
        const { [event.playerId]: _done, ...others } = pending?.retreating ?? {};
        void _done;
        const { retreating: _r, ...rest } = pending ?? {};
        void _r;
        next = withPending(next, Object.keys(others).length ? { ...rest, retreating: others } : Object.keys(rest).length ? rest : undefined);
      }
      if (event.to === null) return next;
      return placeKnight(next, event.playerId, event.to, spec?.level ?? 1, spec?.active ?? false, false);
    }
    case "knightRemoved": {
      const gone = next.crown ? knightAt(next.crown, event.vertex) : undefined;
      if (gone && gone.owner === event.playerId) next = removeKnight(next, event.vertex);
      if (event.reason === "deserter") {
        // The card's player (the current one) places a free knight next, unless they have no piece or no spot for it.
        const by = next.players[next.currentPlayer]?.id;
        const level = gone?.level ?? 1;
        return by !== undefined && canPlaceFreeKnight(next, by, level) ? addPending(next, { freeKnight: { by, level } }) : next;
      }
      if (event.reason === "noRetreat" && pending?.retreating?.[event.playerId]) {
        const { [event.playerId]: _done, ...others } = pending.retreating;
        void _done;
        const { retreating: _r, ...rest } = pending;
        void _r;
        next = withPending(next, Object.keys(others).length ? { ...rest, retreating: others } : Object.keys(rest).length ? rest : undefined);
      }
      return next;
    }
    case "knightsDeactivated":
      // docs/rules.md §16.6: after any attack every knight stands down and the track resets.
      return withCrown(next, (c) => ({ ...c, fleet: 0, attacks: c.attacks + 1, knights: c.knights.map((k) => (k.active ? { ...k, active: false } : k)) }));
    case "robberChased":
      // The rendered phase stays "action" (as after a seven): the robber's move and steal arrive as their own events.
      return withKnight(next, event.vertex, (k) => ({ ...k, active: false, actedThisTurn: true }));
    case "wallBuilt":
      if (!event.free) next = pay(next, event.playerId, WALL_COST);
      return withCrownPlayer(next, event.playerId, (p) => ({ ...p, walls: [...p.walls, event.vertex] }));
    case "fleetAdvanced":
      return withCrown(next, (c) => ({ ...c, fleet: event.position }));
    case "fleetAttacked":
      return next; // the awards, downgrades and `knightsDeactivated` follow as their own events
    case "cityDowngraded":
      next = withPlayer(next, event.playerId, (p) => {
        if (!p.cities.includes(event.vertex)) throw new Error("no city to downgrade");
        const cities = p.cities.filter((v) => v !== event.vertex);
        // docs/rules.md §16.6: with no settlement piece left the city is razed instead.
        if (event.removed) return { ...p, cities, pieces: { ...p.pieces, cities: p.pieces.cities + 1 }, publicVP: p.publicVP - 2 };
        return { ...p, cities, settlements: [...p.settlements, event.vertex], pieces: { ...p.pieces, cities: p.pieces.cities + 1, settlements: p.pieces.settlements - 1 }, publicVP: p.publicVP - 1 };
      });
      return withCrownPlayer(next, event.playerId, (p) => ({ ...p, walls: p.walls.filter((v) => v !== event.vertex) }));
    case "defenderAwarded":
      if (!event.chip) return next; // the honour is a progress card, drawn as its own event
      next = withCrown(next, (c) => ({ ...c, defenderSupply: Math.max(0, c.defenderSupply - 1) }));
      next = withCrownPlayer(next, event.playerId, (p) => ({ ...p, defenderChips: p.defenderChips + 1 }));
      return withVP(next, event.playerId, 1);
    case "merchantPlaced": {
      const held = next.crown?.merchant?.playerId ?? null;
      if (event.from !== null) next = withVP(next, event.from, -1);
      if (held !== event.playerId) next = withVP(next, event.playerId, 1);
      return withCrown(next, (c) => ({ ...c, merchant: { playerId: event.playerId, hex: event.hex } }));
    }
    case "cardsTaken":
      if (event.what === "progress") {
        // Spy: the card itself is private; the counts move, a known hand waits for the snap.
        next = withCrownPlayer(next, event.from, (p) => ({ ...p, progress: loseProgress(p.progress, null) }));
        return withCrownPlayer(next, event.to, (p) => ({ ...p, progress: isHiddenProgress(p.progress) ? { ...p.progress, count: p.progress.count + event.count } : p.progress }));
      }
      if (pending?.masterMerchant) return next; // the `stole` events before it already moved the cards
      // Wedding: hidden hands move by the count; the cards (resources or commodities) are not in the event.
      next = withPlayer(next, event.from, (p) => ({ ...p, hand: adjustHand(p.hand, null, -event.count) }));
      return withPlayer(next, event.to, (p) => ({ ...p, hand: adjustHand(p.hand, null, event.count) }));
    case "commodityMonopolised":
      for (const [id, n] of Object.entries(event.taken)) if (n > 0) next = moveCommodities(next, id, event.playerId, { ...emptyCommodities(), [event.commodity]: n });
      return next;
    case "resourceMonopolised": {
      let total = 0;
      for (const [id, n] of Object.entries(event.taken)) {
        total += n;
        next = withPlayer(next, id, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, -n) }));
      }
      return withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, total) }));
    }
    case "tokensSwapped": {
      const a = next.board.hexes[event.a];
      const b = next.board.hexes[event.b];
      if (!a || !b) throw new Error("token swap on an unknown hex");
      return { ...next, board: { ...next.board, hexes: { ...next.board.hexes, [event.a]: { ...a, token: b.token }, [event.b]: { ...b, token: a.token } } } };
    }
    case "roadRemoved":
      next = withPlayer(next, event.owner, (p) => {
        if (!p.roads.includes(event.edge)) throw new Error("no road to remove");
        return { ...p, roads: p.roads.filter((e) => e !== event.edge), pieces: { ...p.pieces, roads: p.pieces.roads + 1 } };
      });
      if (event.relocatedTo !== null) {
        const to = event.relocatedTo;
        next = withPlayer(next, event.playerId, (p) => ({ ...p, roads: [...p.roads, to], pieces: { ...p.pieces, roads: p.pieces.roads - 1 } }));
      }
      return next;
    case "alchemistSet":
      return next; // the chosen dice are not in the event; the view learns them at the snap
    case "commercialSwap":
      next = withPlayer(next, event.by, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, -1) }));
      next = withPlayer(next, event.with, (p) => ({ ...p, hand: adjustHand(p.hand, event.resource, 1) }));
      return moveCommodities(next, event.with, event.by, oneCommodity(event.commodity));
    default:
      return next;
  }
}

/** Test seam: the pending markers a rendered view carries (never read by components). */
export function crownPendingOf(view: RedactedState): CrownPending | undefined {
  return (view as Rendered).crownPending;
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
  const { freeBuild: free, crownPending, ...rest } = view as Rendered;
  const pending = crownPending ? settlePending(crownPending, event.kind) : undefined;
  let next: RedactedState = withPending({ ...rest, eventSeq: event.seq + 1 }, pending);
  switch (event.kind) {
    case "turnStarted":
      next = { ...next, currentPlayer: playerIndex(next, event.playerId), turn: event.turn, phase: { kind: "roll" } };
      if (next.crown) next = crownTurnStarted(next);
      // Wagons (docs/rules.md §15.7): every wagon's free steps come back at the start of a turn.
      if (next.wayfarers?.wagons) {
        const wagons = Object.fromEntries(Object.entries(next.wayfarers.wagons.wagons).map(([id, w]) => [id, { ...w, stepsUsed: 0 }]));
        next = { ...next, wayfarers: { ...next.wayfarers, wagons: { ...next.wayfarers.wagons, wagons } } };
      }
      break;
    case "diceRolled":
      // The phase follows the events far enough for costs to be right (a seven's sub-phases never build).
      next = { ...next, lastRoll: event.dice, phase: { kind: "action" } };
      // Crown & Castle (docs/phase11.md §2): the red die and the event die; the Alchemist's dice are spent.
      if (next.crown && event.red !== undefined && event.event !== undefined) next = withCrown(next, (c) => ({ ...c, lastRed: event.red ?? null, lastEvent: event.event ?? null, alchemist: null }));
      // The event deck (docs/rules.md §15.1) drew its top card.
      if (event.card && next.wayfarers?.eventDeck) next = { ...next, wayfarers: { ...next.wayfarers, eventDeck: { ...next.wayfarers.eventDeck, count: Math.max(0, next.wayfarers.eventDeck.count - 1) } } };
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
      // Crown & Castle (docs/phase11.md §1): commodities discarded go back to the commodity bank.
      if (event.commodities && next.crown) next = moveCommodities(next, event.playerId, null, event.commodities);
      break;
    case "robberMoved":
      next = { ...next, robberHex: event.to };
      break;
    case "stole": {
      const c = asCommodity(event.resource);
      if (c !== null && next.crown) {
        // Crown & Castle (docs/phase11.md §1): a stolen commodity moves between the (public) commodity purses.
        next = moveCommodities(next, event.from, event.to, oneCommodity(c));
        break;
      }
      const r = asResource(event.resource);
      next = withPlayer(next, event.from, (p) => ({ ...p, hand: adjustHand(p.hand, r, -1) }));
      next = withPlayer(next, event.to, (p) => ({ ...p, hand: adjustHand(p.hand, r, 1) }));
      break;
    }
    case "buildUndone":
      // §5.6: the piece goes back to the pile and the cost back to the hand.
      next = withPlayer(next, event.playerId, (p) => {
        const hand = adjustHandBy(p.hand, event.cost, 1);
        switch (event.piece) {
          case "road":
            return { ...p, hand, roads: p.roads.filter((e) => e !== event.at), pieces: { ...p.pieces, roads: p.pieces.roads + 1 } };
          case "settlement":
            return { ...p, hand, settlements: p.settlements.filter((v) => v !== event.at), pieces: { ...p.pieces, settlements: p.pieces.settlements + 1 }, publicVP: p.publicVP - 1 };
          case "city":
            return { ...p, hand, cities: p.cities.filter((v) => v !== event.at), settlements: [...p.settlements, event.at], pieces: { ...p.pieces, cities: p.pieces.cities + 1, settlements: p.pieces.settlements - 1 }, publicVP: p.publicVP - 1 };
          default: {
            const exhaustive: never = event.piece;
            throw new Error(String(exhaustive));
          }
        }
      });
      next = { ...next, bank: adjustBank(next.bank, event.cost, -1) };
      break;
    case "built": {
      // Crown & Castle: Medicine upgrades a settlement for two ore and one grain (docs/rules.md §16.4).
      const medicine = pending?.medicine === true && event.piece === "city";
      const cost = (free === "road" && event.piece === "road") || (free === "city" && event.piece === "city") ? null : medicine ? MEDICINE_COST : costOf(next, event.piece);
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
      if (next.phase.kind === "roadBuilding" && event.piece === "road") next = { ...next, phase: next.phase.remaining === 2 ? { kind: "roadBuilding", remaining: 1 } : { kind: "action" } };
      next = recountChips(next, event.playerId);
      if (free === "road" && event.piece === "road") next = { ...next, freeBuild: "bridge" } as Rendered;
      break;
    }
    case "devCardBought": {
      const paid = free !== "devCard";
      next = withPlayer(next, event.playerId, (p) => ({
        ...p,
        hand: paid ? adjustHandBy(p.hand, COSTS.devCard, -1) : p.hand,
        devCards: withDev(p.devCards, (list) => (event.card ? [...list, { type: event.card, boughtOnTurn: next.turn }] : list), 1),
      }));
      next = { ...next, bank: paid ? adjustBank(next.bank, COSTS.devCard, 1) : next.bank, devDeck: { count: Math.max(0, next.devDeck.count - 1) } };
      break;
    }
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
      if (event.card === "roadBuilding") next = { ...next, phase: { kind: "roadBuilding", remaining: 2 } };
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
      next = { ...next, pendingTrade: { from: event.playerId, give: event.give, receive: event.receive, rejectedBy: [], counters: [] } };
      break;
    case "tradeCountered":
      if (next.pendingTrade) next = { ...next, pendingTrade: { ...next.pendingTrade, counters: [...next.pendingTrade.counters.filter((c) => c.from !== event.playerId), { from: event.playerId, give: event.give, receive: event.receive }] } };
      break;
    case "tradeAccepted":
      next = withPlayer(next, event.from, (p) => ({ ...p, hand: adjustHandBy(adjustHandBy(p.hand, event.give, -1), event.receive, 1) }));
      next = withPlayer(next, event.to, (p) => ({ ...p, hand: adjustHandBy(adjustHandBy(p.hand, event.receive, -1), event.give, 1) }));
      next = { ...next, pendingTrade: null };
      break;
    case "tradeDeclined":
      if (next.pendingTrade) next = { ...next, pendingTrade: { ...next.pendingTrade, rejectedBy: [...next.pendingTrade.rejectedBy, event.playerId], counters: next.pendingTrade.counters.filter((c) => c.from !== event.playerId) } };
      break;
    case "tradeCancelled":
      next = { ...next, pendingTrade: null };
      break;
    case "maritimeTrade": {
      const give: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      const giveR = asResource(event.give);
      if (giveR) give[giveR] = event.count;
      const get: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      const getR = asResource(event.receive);
      if (getR) get[getR] = 1;
      next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHandBy(adjustHandBy(p.hand, give, -1), get, 1) }));
      next = { ...next, bank: adjustBank(adjustBank(next.bank, give, 1), get, -1) };
      // Crown & Castle (docs/phase11.md §1): the commodity side of the trade.
      const giveC = asCommodity(event.give);
      const getC = asCommodity(event.receive);
      if (giveC !== null && next.crown) next = moveCommodities(next, event.playerId, null, { ...emptyCommodities(), [giveC]: event.count });
      if (getC !== null && next.crown) next = moveCommodities(next, null, event.playerId, oneCommodity(getC));
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
    case "resourcesTaken":
      next = withPlayer(next, event.playerId, (p) => ({ ...p, hand: adjustHandBy(p.hand, event.cards, 1) }));
      next = { ...next, bank: adjustBank(next.bank, event.cards, -1) };
      break;
    case "specialBuildTurn":
      next = { ...next, phase: { kind: "specialBuild", order: [event.playerId], index: 0 } };
      break;
    case "setupCompleted":
      next = { ...next, phase: { kind: "roll" } };
      break;
    case "turnEnded":
    case "productionBlocked":
    case "bankShort":
    case "note":
    // Wayfarers (docs/phase10.md): applied in `applyWayfarersEvent` so counters move with their events.
    case "deckReshuffled":
    case "neighborlyGave":
    case "taxCollected":
    case "fishDrawn":
    case "fishSpent":
    case "bootPassed":
    case "bridgeBuilt":
    case "coinsAwarded":
    case "chipMoved":
    case "castleBuilt":
    case "raidersAdvanced":
    case "guardPlaced":
    case "raid":
    case "hexRebuilt":
    case "spiceProduced":
    case "caravanExtended":
    case "wagonMoved":
    case "goodLoaded":
    case "delivered":
    case "goodsStocked":
      next = applyWayfarersEvent(next, event, free);
      break;
    // Crown & Castle (docs/phase11.md): applied in `applyCrownEvent` so purses, tracks, knights and the fleet move with their events.
    case "commoditiesProduced":
    case "progressDrawn":
    case "progressPlayed":
    case "progressDiscarded":
    case "improvementBuilt":
    case "metropolisPlaced":
    case "knightBuilt":
    case "knightActivated":
    case "knightPromoted":
    case "knightMoved":
    case "knightDisplaced":
    case "knightRetreated":
    case "knightRemoved":
    case "knightsDeactivated":
    case "robberChased":
    case "wallBuilt":
    case "fleetAdvanced":
    case "fleetAttacked":
    case "cityDowngraded":
    case "defenderAwarded":
    case "merchantPlaced":
    case "cardsTaken":
    case "commodityMonopolised":
    case "resourceMonopolised":
    case "tokensSwapped":
    case "roadRemoved":
    case "alchemistSet":
    case "commercialSwap":
      next = applyCrownEvent(next, event, pending);
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
