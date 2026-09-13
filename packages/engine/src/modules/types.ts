/**
 * Module state shapes (docs/phase10.md, docs/phase11.md).
 *
 * Everything a module keeps lives under `GameState.wayfarers` (Phase 10
 * variants) or `GameState.crown` (Phase 11), keyed by player id where it is
 * per player. Plain JSON: no classes, no `undefined`, no `Date`.
 */

import type { Resource } from "../board";
import type { EdgeId, HexId, VertexId } from "../geometry";
import type { PlayerId } from "../types";

// ---------------------------------------------------------------------------
// Wayfarers (Phase 10)

export const VARIANT_NAMES = ["eventDeck", "fishing", "rivers", "harbormaster", "raiders", "caravans", "wagons"] as const;
export type VariantName = (typeof VARIANT_NAMES)[number];
export type VariantFlags = Readonly<Record<VariantName, boolean>>;

/** docs/phase10.md §1: the five special cards of the event deck. */
export const EVENT_CARD_KINDS = ["plentifulHarvest", "robbersRest", "neighborlyHelp", "taxCollector", "bounty"] as const;
export type EventCardKind = (typeof EVENT_CARD_KINDS)[number];

export interface EventCard {
  readonly total: number;
  readonly event: EventCardKind | null;
  /** The reshuffle marker: after this card is drawn the deck is rebuilt. */
  readonly reshuffle: boolean;
}

export interface EventDeckState {
  /** Hidden; top card is index 0. */
  cards: EventCard[];
  /** How many decks have been dealt (seeds each shuffle). */
  shuffles: number;
}

/** docs/phase10.md §2: fish are fungible points; the old boot is worth -1 VP while held. */
export interface FishingState {
  fish: Record<PlayerId, number>;
  /** Remaining tokens: 1, 2 or 3 fish; 0 is the old boot. */
  bag: number[];
  boot: PlayerId | null;
}

export const FISH_OPTIONS = ["moveRobber", "steal", "bankResource", "freeRoad", "freeDevCard"] as const;
export type FishOption = (typeof FISH_OPTIONS)[number];
export const FISH_COST: Readonly<Record<FishOption, number>> = { moveRobber: 2, steal: 3, bankResource: 4, freeRoad: 5, freeDevCard: 7 };

/** docs/phase10.md §3 */
export interface RiversState {
  bridgeBuilder: { playerId: PlayerId | null; count: number };
  coins: Record<PlayerId, number>;
  poorSettler: PlayerId | null;
}

/** docs/phase10.md §4 */
export interface HarbormasterState {
  playerId: PlayerId | null;
  points: number;
}

/** docs/phase10.md §5 */
export interface RaidersState {
  counter: number;
  castles: Record<PlayerId, VertexId | null>;
  /** Guards (the variant's knights) per player: one entry per guard, the hex it stands on. */
  guards: Record<PlayerId, HexId[]>;
  raided: HexId[];
  /** Rebuilt hexes per player (each is worth 1 VP). */
  rebuilt: Record<PlayerId, number>;
  /** How many times the raiders have landed. */
  landings: number;
}

export const RAIDER_LANDING = 15;
export const MAX_GUARDS = 6;

/** docs/phase10.md §6 */
export interface CaravanTrack {
  readonly oasis: HexId;
  edges: EdgeId[];
}

export interface CaravansState {
  tracks: CaravanTrack[];
  spice: Record<PlayerId, number>;
  spiceBank: number;
}

export const CARAVAN_LENGTH = 3;
export const SPICE_BANK = 19;

/** docs/phase10.md §7 */
export const WAGON_GOODS = ["marble", "glass", "sand", "tools"] as const;
export type WagonGood = (typeof WAGON_GOODS)[number];

export interface Wagon {
  at: VertexId;
  cargo: WagonGood[];
  /** Steps taken this turn (2 free, then 1 per grain). */
  stepsUsed: number;
}

export interface WagonsState {
  wagons: Record<PlayerId, Wagon>;
  /** Goods waiting at each city (at most 2). */
  stock: Record<VertexId, WagonGood[]>;
  /** The good each city currently asks for. */
  demand: Record<VertexId, WagonGood>;
  /** Delivery points per player. */
  points: Record<PlayerId, number>;
}

export const WAGON_FREE_STEPS = 2;
export const WAGON_CAPACITY = 2;
export const CITY_STOCK_CAP = 2;

export interface WayfarersState {
  eventDeck: EventDeckState | null;
  fishing: FishingState | null;
  rivers: RiversState | null;
  harbormaster: HarbormasterState | null;
  raiders: RaidersState | null;
  caravans: CaravansState | null;
  wagons: WagonsState | null;
}

// ---------------------------------------------------------------------------
// Crown & Castle (Phase 11)

export const COMMODITIES = ["cloth", "coin", "paper"] as const;
export type Commodity = (typeof COMMODITIES)[number];
export type CommodityHand = Record<Commodity, number>;

export const TRACKS = ["trade", "politics", "science"] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_COMMODITY: Readonly<Record<Track, Commodity>> = { trade: "cloth", politics: "coin", science: "paper" };
export const COMMODITY_BANK = 12;
export const MAX_LEVEL = 5;
export const METROPOLIS_LEVEL = 4;

export type EventDie = "fleet" | "trade" | "politics" | "science";

export const TRADE_CARDS = ["merchant", "tradeMonopoly", "resourceMonopoly", "masterMerchant", "merchantFleet", "commercialHarbor"] as const;
export const POLITICS_CARDS = ["bishop", "constitution", "deserter", "diplomat", "intrigue", "saboteur", "spy", "warlord", "wedding"] as const;
export const SCIENCE_CARDS = ["alchemist", "crane", "engineer", "inventor", "irrigation", "medicine", "mining", "printer", "roadBuilding", "smith"] as const;
export type TradeCard = (typeof TRADE_CARDS)[number];
export type PoliticsCard = (typeof POLITICS_CARDS)[number];
export type ScienceCard = (typeof SCIENCE_CARDS)[number];
export type ProgressCard = TradeCard | PoliticsCard | ScienceCard;

/** docs/phase11.md §4: 18 cards per track. */
export const PROGRESS_DECKS: Readonly<Record<Track, readonly [ProgressCard, number][]>> = {
  trade: [
    ["merchant", 6],
    ["tradeMonopoly", 2],
    ["resourceMonopoly", 4],
    ["masterMerchant", 2],
    ["merchantFleet", 2],
    ["commercialHarbor", 2],
  ],
  politics: [
    ["bishop", 2],
    ["constitution", 1],
    ["deserter", 2],
    ["diplomat", 2],
    ["intrigue", 2],
    ["saboteur", 2],
    ["spy", 3],
    ["warlord", 2],
    ["wedding", 2],
  ],
  science: [
    ["alchemist", 2],
    ["crane", 2],
    ["engineer", 1],
    ["inventor", 2],
    ["irrigation", 2],
    ["medicine", 2],
    ["mining", 2],
    ["printer", 1],
    ["roadBuilding", 1],
    ["smith", 2],
  ],
};

export const VP_PROGRESS_CARDS: readonly ProgressCard[] = ["constitution", "printer"];
export const PROGRESS_HAND_LIMIT = 4;

export function trackOfCard(card: ProgressCard): Track {
  if ((TRADE_CARDS as readonly string[]).includes(card)) return "trade";
  if ((POLITICS_CARDS as readonly string[]).includes(card)) return "politics";
  return "science";
}

export type KnightLevel = 1 | 2 | 3;
export const KNIGHTS_PER_LEVEL = 2;
export const MAX_WALLS = 3;
export const FLEET_STEPS = 7;
export const DEFENDER_SUPPLY = 6;
export const CROWN_VICTORY_POINTS = 13;

export interface Knight {
  readonly owner: PlayerId;
  at: VertexId;
  level: KnightLevel;
  active: boolean;
  /** Set when the knight moved, displaced, chased or was built this turn; cleared at turn start. */
  actedThisTurn: boolean;
  builtOnTurn: number;
}

export interface HeldProgress {
  readonly card: ProgressCard;
  /** VP cards are revealed the moment they are drawn. */
  readonly revealed: boolean;
}

export interface CrownPlayer {
  commodities: CommodityHand;
  tracks: Record<Track, number>;
  progress: HeldProgress[];
  /** Progress cards played this turn (at most one before the roll). */
  progressPlayedThisTurn: number;
  progressPlayedBeforeRoll: boolean;
  walls: VertexId[];
  metropolises: Record<Track, VertexId | null>;
  defenderChips: number;
  /** Crane: the next improvement costs one less. */
  crane: boolean;
  /** Merchant Fleet: 2:1 for this card type this turn. */
  merchantFleet: Resource | Commodity | null;
}

export interface CrownState {
  players: Record<PlayerId, CrownPlayer>;
  bank: CommodityHand;
  /** Hidden decks, top at index 0. */
  decks: Record<Track, ProgressCard[]>;
  knights: Knight[];
  fleet: number;
  attacks: number;
  defenderSupply: number;
  /** The merchant token: a hex and its owner, or null. */
  merchant: { playerId: PlayerId; hex: HexId } | null;
  /** Alchemist: the number dice chosen for the next roll. */
  alchemist: [number, number] | null;
  lastEvent: EventDie | null;
  lastRed: number | null;
  /** Metropolis holders per track (the player, or null). */
  metropolis: Record<Track, PlayerId | null>;
}

export function emptyCommodities(): CommodityHand {
  return { cloth: 0, coin: 0, paper: 0 };
}

export function commodityTotal(h: CommodityHand): number {
  return h.cloth + h.coin + h.paper;
}

export function isCommodity(value: unknown): value is Commodity {
  return (COMMODITIES as readonly unknown[]).includes(value);
}

export function isWagonGood(value: unknown): value is WagonGood {
  return (WAGON_GOODS as readonly unknown[]).includes(value);
}

export function isProgressCard(value: unknown): value is ProgressCard {
  return (TRADE_CARDS as readonly unknown[]).includes(value) || (POLITICS_CARDS as readonly unknown[]).includes(value) || (SCIENCE_CARDS as readonly unknown[]).includes(value);
}

export function isTrack(value: unknown): value is Track {
  return (TRACKS as readonly unknown[]).includes(value);
}

// ---------------------------------------------------------------------------
// Prompts: decisions a module needs from a player before play resumes. The
// core parks the game in `{ kind: "modulePrompt", prompt, returnTo }` and
// `nextActor` returns `prompt.playerId`.

export type ModulePrompt =
  /** Event deck: each pending player may give one card to `to`. */
  | { kind: "neighborlyHelp"; playerId: PlayerId; pending: PlayerId[]; to: PlayerId }
  /** Fleet attack: each pending player picks a city to lose. */
  | { kind: "downgradeCity"; playerId: PlayerId; pending: PlayerId[] }
  | { kind: "placeMetropolis"; playerId: PlayerId; track: Track; from: PlayerId | null }
  | { kind: "discardProgress"; playerId: PlayerId; count: number }
  /** Deserter: the victim picks the knight to lose; then the player places one of the same level. */
  | { kind: "deserter"; playerId: PlayerId; by: PlayerId }
  | { kind: "placeFreeKnight"; playerId: PlayerId; level: KnightLevel; active: boolean }
  /** A displaced knight retreats to a vertex of its owner's choice (null removes it). */
  | { kind: "knightRetreat"; playerId: PlayerId; level: KnightLevel; active: boolean; from: VertexId; pending: PlayerId[] }
  /** Spy: pick one of the target's progress cards (the legal list carries them). */
  | { kind: "spy"; playerId: PlayerId; target: PlayerId }
  /** Commercial Harbor: each pending player hands over a commodity for `resource`. */
  | { kind: "commercialHarbor"; playerId: PlayerId; by: PlayerId; pending: PlayerId[]; resource: Resource }
  /** Wedding: each pending player gives `count` cards of their choice to `to`. */
  | { kind: "giveCards"; playerId: PlayerId; pending: PlayerId[]; to: PlayerId; count: number };

export type ModulePromptKind = ModulePrompt["kind"];
