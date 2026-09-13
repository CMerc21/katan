/**
 * Game state and action shapes (docs/phase2.md §1–§2).
 *
 * The state is plain JSON: no classes, no Date, no `undefined` (use null).
 * It is stored as-is in `games.state` and replayed from the action log.
 */

import type { Board, BoardKind, Resource } from "./board";
import type { BoardDefinition } from "./definition";
import type { EdgeId, HexId, VertexId } from "./geometry";
import type { Scenario, ScenarioRules } from "./scenario";
import type { Commodity, CommodityHand, CrownState, FishOption, KnightLevel, ModulePrompt, ProgressCard, Track, WagonGood, WayfarersState } from "./modules/types";

export type PlayerId = string;

export type Hand = Record<Resource, number>;

export const DEV_CARD_TYPES = ["knight", "victoryPoint", "roadBuilding", "invention", "monopoly"] as const;
export type DevCardType = (typeof DEV_CARD_TYPES)[number];

/** §2.5 */
export const DEV_DECK_COMPOSITION: Readonly<Record<DevCardType, number>> = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  invention: 2,
  monopoly: 2,
};

/** Seat colours in seat order; green and brown seat the fifth and sixth players (docs/phase8.md §5). */
export const PLAYER_COLORS = ["red", "blue", "orange", "white", "green", "brown"] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export interface PieceSupply {
  roads: number;
  settlements: number;
  cities: number;
  /** Tides (docs/rules.md §14.2): 15 ships per player; unused in base games. */
  ships: number;
}

/** §2.4, §14.2 */
export const STARTING_PIECES: Readonly<PieceSupply> = { roads: 15, settlements: 5, cities: 4, ships: 15 };

/** §2.3 */
export const BANK_PER_RESOURCE = 19;

/** §11 */
export const WINNING_VP = 10;

export interface DevCard {
  readonly type: DevCardType;
  /** `GameState.turn` when bought; cards cannot be played that turn (§8.2). */
  readonly boughtOnTurn: number;
}

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: PlayerColor;
  hand: Hand;
  devCards: DevCard[];
  playedKnights: number;
  devCardPlayedThisTurn: boolean;
  /** Pieces remaining in supply. */
  pieces: PieceSupply;
  roads: EdgeId[];
  settlements: VertexId[];
  cities: VertexId[];
  /** Tides (§14.2): ships on sea edges. */
  ships: EdgeId[];
  /** Ships built this turn may not be moved (§14.2). Cleared when the next turn starts. */
  shipsBuiltThisTurn: EdgeId[];
  /** One ship move per turn (§14.2). */
  shipMovedThisTurn: boolean;
  /** Island ids the player's setup settlements touch (§14.4). */
  startIslands: number[];
  /** Island ids that earned the island bonus, in order (§14.4). */
  islandChips: number[];
}

export type Phase =
  | { kind: "setup"; round: 1 | 2; step: "settlement" | "road"; lastSettlement: VertexId | null }
  | { kind: "roll" }
  /** §7.1, and any module rule that makes players discard: play resumes in `returnTo` once everyone has. */
  | { kind: "discard"; returnTo: Phase }
  | { kind: "moveRobber"; via: "seven" | "knight"; returnTo: "roll" | "action" }
  | { kind: "steal"; hex: HexId; targets: PlayerId[]; returnTo: "roll" | "action" }
  | { kind: "action" }
  | { kind: "roadBuilding"; remaining: 1 | 2 }
  /** Tides (§14.3): gold hexes produced; each owing player picks resources, then play resumes in `returnTo`. */
  | { kind: "chooseGold"; owed: Record<PlayerId, number>; returnTo: Phase }
  /** 5–6 players (docs/phase8.md §5): after a turn ends, every other player may build in seat order. */
  | { kind: "specialBuild"; order: PlayerId[]; index: number }
  /** A module needs a decision from `prompt.playerId` before play resumes in `returnTo` (docs/phase10.md, docs/phase11.md). */
  | { kind: "modulePrompt"; prompt: ModulePrompt; returnTo: Phase }
  | { kind: "ended" };

export type PhaseKind = Phase["kind"];

export interface TradeOffer {
  readonly from: PlayerId;
  readonly give: Hand;
  readonly receive: Hand;
  /** Players who declined; the offer clears once every other player has. */
  rejectedBy: PlayerId[];
  /** Fishing (docs/phase10.md §2): the old boot rides along with the offer. */
  boot?: boolean;
}

export interface LogEntry {
  readonly turn: number;
  readonly playerId: PlayerId | null;
  readonly text: string;
}

export interface GameState {
  readonly version: 1;
  readonly seed: string;
  readonly boardKind: BoardKind | "custom";
  /** The resolved board; a custom definition is snapshotted here so later edits never touch a running game. */
  readonly board: Board;
  /** Count of applied actions; the next action has this index (§12). */
  actionIndex: number;
  /** Count of events emitted so far; the next event has this `seq` (docs/phase7.md §1). */
  eventSeq: number;
  /** Number of END_TURN actions applied so far (docs/phase2.md §1.2). */
  turn: number;
  phase: Phase;
  readonly players: Player[];
  /** Index into `players`. */
  currentPlayer: number;
  bank: Hand;
  /** Hidden; top card is index 0. */
  devDeck: DevCardType[];
  robberHex: HexId;
  /** Tides (§14.5): the pirate's sea hex, or null when the module or the pirate is off. */
  pirateHex: HexId | null;
  /** Scenario rules in force (docs/phase9.md §5), or null for a base game. */
  scenario: ScenarioRules | null;
  /** Wayfarers variant state (docs/phase10.md), or null when no variant is on. */
  wayfarers: WayfarersState | null;
  /** Crown & Castle state (docs/phase11.md §9), or null when the module is off. */
  crown: CrownState | null;
  lastRoll: [number, number] | null;
  longestRoad: { playerId: PlayerId | null; length: number };
  largestArmy: { playerId: PlayerId | null; count: number };
  pendingTrade: TradeOffer | null;
  /** playerId -> number of cards still owed (§7.1). */
  pendingDiscards: Record<PlayerId, number>;
  winner: PlayerId | null;
  log: LogEntry[];
}

export interface PlayerSetup {
  readonly id: PlayerId;
  readonly name: string;
  /** Defaults to the seat's colour (red, blue, orange, white). */
  readonly color?: PlayerColor;
}

export interface CreateGameOptions {
  readonly seed: string;
  /** In seat order. 3 to `board.seats.max` players. */
  readonly players: readonly PlayerSetup[];
  /** A built-in kind or a full definition (docs/phase8.md §1). Defaults to `random`. Ignored when `scenario` is given. */
  readonly board?: BoardKind | BoardDefinition;
  /** A scenario bundles a board with module rules and a goal (docs/phase9.md §5). */
  readonly scenario?: Scenario;
}

// ---------------------------------------------------------------------------
// Actions (docs/phase2.md §2). Every action names the acting player so the
// server can verify it against the authenticated caller.

interface Base<T extends string> {
  readonly type: T;
  readonly playerId: PlayerId;
}

export type RollAction = Base<"ROLL">;
export interface DiscardAction extends Base<"DISCARD"> {
  readonly cards: Hand;
  /** Crown & Castle: commodities count toward the hand limit (docs/phase11.md §1). */
  readonly commodities?: CommodityHand;
}
export interface MoveRobberAction extends Base<"MOVE_ROBBER"> {
  readonly hex: HexId;
  /** Tides (§14.5): move the pirate to a sea hex instead of the robber. Defaults to `robber`. */
  readonly target?: "robber" | "pirate";
}
export interface StealAction extends Base<"STEAL"> {
  readonly targetPlayerId: PlayerId;
}
export interface BuildRoadAction extends Base<"BUILD_ROAD"> {
  readonly edge: EdgeId;
}
export interface BuildSettlementAction extends Base<"BUILD_SETTLEMENT"> {
  readonly vertex: VertexId;
}
export interface BuildCityAction extends Base<"BUILD_CITY"> {
  readonly vertex: VertexId;
}
export type BuyDevCardAction = Base<"BUY_DEV_CARD">;
export type PlayKnightAction = Base<"PLAY_KNIGHT">;
export type PlayRoadBuildingAction = Base<"PLAY_ROAD_BUILDING">;
export interface PlayInventionAction extends Base<"PLAY_INVENTION"> {
  readonly resources: readonly [Resource, Resource];
}
export interface PlayMonopolyAction extends Base<"PLAY_MONOPOLY"> {
  readonly resource: Resource;
}
export interface OfferTradeAction extends Base<"OFFER_TRADE"> {
  readonly give: Hand;
  readonly receive: Hand;
  /** Fishing (docs/phase10.md §2): the offerer passes the old boot along with the trade. */
  readonly boot?: boolean;
}
export interface AcceptTradeAction extends Base<"ACCEPT_TRADE"> {
  /** Fishing: the acceptor passes the old boot along with the trade. */
  readonly boot?: boolean;
}
export type RejectTradeAction = Base<"REJECT_TRADE">;
export type CancelTradeAction = Base<"CANCEL_TRADE">;
export interface MaritimeTradeAction extends Base<"MARITIME_TRADE"> {
  /** A commodity only under Crown & Castle (docs/phase11.md §1). */
  readonly give: Resource | Commodity;
  readonly giveCount: 4 | 3 | 2;
  readonly receive: Resource | Commodity;
}
export type EndTurnAction = Base<"END_TURN">;
/** docs/phase8.md §5: the special builder is finished. */
export type SpecialBuildDoneAction = Base<"SPECIAL_BUILD_DONE">;
/** Tides (§14.2). */
export interface BuildShipAction extends Base<"BUILD_SHIP"> {
  readonly edge: EdgeId;
}
/** Tides (§14.2): move the ship at the open end of a route. */
export interface MoveShipAction extends Base<"MOVE_SHIP"> {
  readonly from: EdgeId;
  readonly to: EdgeId;
}
/** Tides (§14.3): the resources a gold hex produced, one per card owed. */
export interface ChooseGoldAction extends Base<"CHOOSE_GOLD"> {
  readonly resources: readonly Resource[];
}

// --- Wayfarers (docs/phase10.md) ---------------------------------------------

/** Event deck, Neighborly help: give one card (or nothing) to the poorest player. */
export interface NeighborlyGiveAction extends Base<"NEIGHBORLY_GIVE"> {
  readonly resource: Resource | null;
}
/** Fishing: spend fish on one of the five options. */
export interface SpendFishAction extends Base<"SPEND_FISH"> {
  readonly option: FishOption;
  /** moveRobber: the destination hex (the lake / wasteland, or any hex). */
  readonly hex?: HexId;
  /** steal: the victim. */
  readonly targetPlayerId?: PlayerId;
  /** bankResource: the resource taken. */
  readonly resource?: Resource;
  /** freeRoad: the edge. */
  readonly edge?: EdgeId;
  /** freeDevCard with an empty deck: the settlement to upgrade. */
  readonly vertex?: VertexId;
}
/** Raiders: a guard on a hex the player touches; Crown & Castle: a knight at a vertex on the player's road network. */
export interface BuildKnightAction extends Base<"BUILD_KNIGHT"> {
  readonly hex?: HexId;
  readonly vertex?: VertexId;
}
/** Raiders: upgrade one setup settlement to a castle (setup only). */
export interface BuildCastleAction extends Base<"BUILD_CASTLE"> {
  readonly vertex: VertexId;
}
/** Raiders: pay 1 ore + 1 wool to rebuild a raided hex. */
export interface RebuildHexAction extends Base<"REBUILD_HEX"> {
  readonly hex: HexId;
}
/** Caravans: pay 1 spice to pull a caravan one step along `edge`. */
export interface ExtendCaravanAction extends Base<"EXTEND_CARAVAN"> {
  readonly caravan: number;
  readonly edge: EdgeId;
}
/** Wagons: move along roads; `grain` buys extra steps, `toll` pays a blocking wagon's owner. */
export interface MoveWagonAction extends Base<"MOVE_WAGON"> {
  readonly path: VertexId[];
  readonly grain?: number;
  readonly toll?: Resource;
}
export interface LoadCommodityAction extends Base<"LOAD_COMMODITY"> {
  readonly good: WagonGood;
}
export interface DeliverAction extends Base<"DELIVER"> {
  readonly good: WagonGood;
}

// --- Crown & Castle (docs/phase11.md) -----------------------------------------

export interface ActivateKnightAction extends Base<"ACTIVATE_KNIGHT"> {
  readonly vertex: VertexId;
}
export interface PromoteKnightAction extends Base<"PROMOTE_KNIGHT"> {
  readonly vertex: VertexId;
}
export interface KnightMoveAction extends Base<"KNIGHT_MOVE"> {
  readonly from: VertexId;
  readonly to: VertexId;
}
export interface KnightDisplaceAction extends Base<"KNIGHT_DISPLACE"> {
  readonly from: VertexId;
  readonly to: VertexId;
}
export interface KnightChaseRobberAction extends Base<"KNIGHT_CHASE_ROBBER"> {
  readonly vertex: VertexId;
}
export interface BuildImprovementAction extends Base<"BUILD_IMPROVEMENT"> {
  readonly track: Track;
}
export interface BuildWallAction extends Base<"BUILD_WALL"> {
  readonly vertex: VertexId;
}
/** Progress card payloads are per card (docs/phase11.md §4); unused fields stay undefined. */
export interface ProgressPayload {
  readonly hex?: HexId;
  readonly vertex?: VertexId;
  readonly edge?: EdgeId;
  readonly relocateTo?: EdgeId;
  readonly resource?: Resource;
  readonly commodity?: Commodity;
  readonly card?: Resource | Commodity;
  readonly targetPlayerId?: PlayerId;
  readonly dice?: [number, number];
  readonly hexes?: [HexId, HexId];
  readonly vertices?: VertexId[];
}
export interface PlayProgressAction extends Base<"PLAY_PROGRESS"> {
  readonly card: ProgressCard;
  readonly payload?: ProgressPayload;
}
export interface DiscardProgressAction extends Base<"DISCARD_PROGRESS"> {
  readonly card: ProgressCard;
}
export interface ChooseDowngradeAction extends Base<"CHOOSE_DOWNGRADE"> {
  readonly vertex: VertexId;
}
export interface PlaceMetropolisAction extends Base<"PLACE_METROPOLIS"> {
  readonly vertex: VertexId;
}
export interface ChooseDeserterAction extends Base<"CHOOSE_DESERTER"> {
  readonly vertex: VertexId;
}
export interface PlaceFreeKnightAction extends Base<"PLACE_FREE_KNIGHT"> {
  /** null when nowhere legal (the knight is lost). */
  readonly vertex: VertexId | null;
}
export interface RetreatKnightAction extends Base<"RETREAT_KNIGHT"> {
  readonly vertex: VertexId | null;
}
export interface SpyTakeAction extends Base<"SPY_TAKE"> {
  readonly card: ProgressCard;
}
export interface CommercialSwapAction extends Base<"COMMERCIAL_SWAP"> {
  readonly commodity: Commodity;
}
export interface GiveCardsAction extends Base<"GIVE_CARDS"> {
  readonly cards: Hand;
  readonly commodities?: CommodityHand;
}

export type Action =
  | RollAction
  | DiscardAction
  | MoveRobberAction
  | StealAction
  | BuildRoadAction
  | BuildSettlementAction
  | BuildCityAction
  | BuyDevCardAction
  | PlayKnightAction
  | PlayRoadBuildingAction
  | PlayInventionAction
  | PlayMonopolyAction
  | OfferTradeAction
  | AcceptTradeAction
  | RejectTradeAction
  | CancelTradeAction
  | MaritimeTradeAction
  | EndTurnAction
  | SpecialBuildDoneAction
  | BuildShipAction
  | MoveShipAction
  | ChooseGoldAction
  | NeighborlyGiveAction
  | SpendFishAction
  | BuildKnightAction
  | BuildCastleAction
  | RebuildHexAction
  | ExtendCaravanAction
  | MoveWagonAction
  | LoadCommodityAction
  | DeliverAction
  | ActivateKnightAction
  | PromoteKnightAction
  | KnightMoveAction
  | KnightDisplaceAction
  | KnightChaseRobberAction
  | BuildImprovementAction
  | BuildWallAction
  | PlayProgressAction
  | DiscardProgressAction
  | ChooseDowngradeAction
  | PlaceMetropolisAction
  | ChooseDeserterAction
  | PlaceFreeKnightAction
  | RetreatKnightAction
  | SpyTakeAction
  | CommercialSwapAction
  | GiveCardsAction;

export type ActionType = Action["type"];

export const ACTION_TYPES: readonly ActionType[] = [
  "ROLL",
  "DISCARD",
  "MOVE_ROBBER",
  "STEAL",
  "BUILD_ROAD",
  "BUILD_SETTLEMENT",
  "BUILD_CITY",
  "BUY_DEV_CARD",
  "PLAY_KNIGHT",
  "PLAY_ROAD_BUILDING",
  "PLAY_INVENTION",
  "PLAY_MONOPOLY",
  "OFFER_TRADE",
  "ACCEPT_TRADE",
  "REJECT_TRADE",
  "CANCEL_TRADE",
  "MARITIME_TRADE",
  "END_TURN",
  "SPECIAL_BUILD_DONE",
  "BUILD_SHIP",
  "MOVE_SHIP",
  "CHOOSE_GOLD",
  "NEIGHBORLY_GIVE",
  "SPEND_FISH",
  "BUILD_KNIGHT",
  "BUILD_CASTLE",
  "REBUILD_HEX",
  "EXTEND_CARAVAN",
  "MOVE_WAGON",
  "LOAD_COMMODITY",
  "DELIVER",
  "ACTIVATE_KNIGHT",
  "PROMOTE_KNIGHT",
  "KNIGHT_MOVE",
  "KNIGHT_DISPLACE",
  "KNIGHT_CHASE_ROBBER",
  "BUILD_IMPROVEMENT",
  "BUILD_WALL",
  "PLAY_PROGRESS",
  "DISCARD_PROGRESS",
  "CHOOSE_DOWNGRADE",
  "PLACE_METROPOLIS",
  "CHOOSE_DESERTER",
  "PLACE_FREE_KNIGHT",
  "RETREAT_KNIGHT",
  "SPY_TAKE",
  "COMMERCIAL_SWAP",
  "GIVE_CARDS",
];

/** Action types that belong to a module; the core dispatches them through the hook list. */
export const MODULE_ACTION_TYPES: readonly ActionType[] = ACTION_TYPES.slice(ACTION_TYPES.indexOf("NEIGHBORLY_GIVE"));

export type { KnightLevel };
