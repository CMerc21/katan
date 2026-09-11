/**
 * Game state and action shapes (docs/phase2.md §1–§2).
 *
 * The state is plain JSON: no classes, no Date, no `undefined` (use null).
 * It is stored as-is in `games.state` and replayed from the action log.
 */

import type { Board, BoardKind, Resource } from "./board";
import type { EdgeId, HexId, VertexId } from "./geometry";

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

export const PLAYER_COLORS = ["red", "blue", "orange", "white"] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export interface PieceSupply {
  roads: number;
  settlements: number;
  cities: number;
}

/** §2.4 */
export const STARTING_PIECES: Readonly<PieceSupply> = { roads: 15, settlements: 5, cities: 4 };

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
}

export type Phase =
  | { kind: "setup"; round: 1 | 2; step: "settlement" | "road"; lastSettlement: VertexId | null }
  | { kind: "roll" }
  | { kind: "discard" }
  | { kind: "moveRobber"; via: "seven" | "knight"; returnTo: "roll" | "action" }
  | { kind: "steal"; hex: HexId; targets: PlayerId[]; returnTo: "roll" | "action" }
  | { kind: "action" }
  | { kind: "roadBuilding"; remaining: 1 | 2 }
  | { kind: "ended" };

export type PhaseKind = Phase["kind"];

export interface TradeOffer {
  readonly from: PlayerId;
  readonly give: Hand;
  readonly receive: Hand;
  /** Players who declined; the offer clears once every other player has. */
  rejectedBy: PlayerId[];
}

export interface LogEntry {
  readonly turn: number;
  readonly playerId: PlayerId | null;
  readonly text: string;
}

export interface GameState {
  readonly version: 1;
  readonly seed: string;
  readonly boardKind: BoardKind;
  readonly board: Board;
  /** Count of applied actions; the next action has this index (§12). */
  actionIndex: number;
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
}

export interface CreateGameOptions {
  readonly seed: string;
  /** In seat order. 3 or 4 players. */
  readonly players: readonly PlayerSetup[];
  readonly board?: BoardKind;
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
}
export interface MoveRobberAction extends Base<"MOVE_ROBBER"> {
  readonly hex: HexId;
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
}
export type AcceptTradeAction = Base<"ACCEPT_TRADE">;
export type RejectTradeAction = Base<"REJECT_TRADE">;
export type CancelTradeAction = Base<"CANCEL_TRADE">;
export interface MaritimeTradeAction extends Base<"MARITIME_TRADE"> {
  readonly give: Resource;
  readonly giveCount: 4 | 3 | 2;
  readonly receive: Resource;
}
export type EndTurnAction = Base<"END_TURN">;

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
  | EndTurnAction;

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
];
