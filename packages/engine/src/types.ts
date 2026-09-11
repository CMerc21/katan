/**
 * Game state and action shapes. The state is a plain JSON-serialisable
 * object: it is stored as-is in `games.state` and replayed from the log.
 */

import type { Board, BoardKind, Resource } from "./board";
import type { EdgeId, HexId, VertexId } from "./geometry";

export type PlayerId = string;

export type ResourceHand = Record<Resource, number>;

export interface PieceSupply {
  roads: number;
  settlements: number;
  cities: number;
}

/** §2.4 */
export const STARTING_PIECES: Readonly<PieceSupply> = { roads: 15, settlements: 5, cities: 4 };

/** §2.3 */
export const BANK_PER_RESOURCE = 19;

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  /** Seat index, 0-based; play order (§1). */
  readonly seat: number;
  resources: ResourceHand;
  pieces: PieceSupply;
}

export type BuildingKind = "settlement" | "city";

export interface Building {
  readonly owner: PlayerId;
  readonly kind: BuildingKind;
}

export type Phase = "setup" | "main";

/** §4.1: progress through the snake-order setup. */
export interface SetupState {
  /** Player ids in placement order (2n entries). */
  readonly order: readonly PlayerId[];
  /** Index into `order` of the placement in progress. */
  index: number;
  step: "settlement" | "road";
  /** Vertex of the settlement placed in the current placement (road must touch it). */
  lastSettlement: VertexId | null;
}

export interface TurnState {
  readonly player: PlayerId;
  /** 1-based turn counter across the whole game. */
  readonly number: number;
  rolled: boolean;
}

export interface GameState {
  readonly version: 1;
  readonly seed: string;
  readonly boardKind: BoardKind;
  readonly board: Board;
  readonly players: readonly Player[];
  bank: ResourceHand;
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, PlayerId>;
  robber: HexId;
  phase: Phase;
  setup: SetupState | null;
  turn: TurnState | null;
  /** Number of actions applied so far; the next action has this index (§12). */
  actionCount: number;
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
// Actions. Every action names the acting player so the server can verify it
// against the authenticated caller before calling `applyAction`.

export interface PlaceSetupSettlementAction {
  readonly type: "placeSetupSettlement";
  readonly player: PlayerId;
  readonly vertex: VertexId;
}

export interface PlaceSetupRoadAction {
  readonly type: "placeSetupRoad";
  readonly player: PlayerId;
  readonly edge: EdgeId;
}

/** §6.1 — implemented in Phase 2. */
export interface RollDiceAction {
  readonly type: "rollDice";
  readonly player: PlayerId;
}

/** §6.3 — implemented in Phase 2. */
export interface EndTurnAction {
  readonly type: "endTurn";
  readonly player: PlayerId;
}

export type Action = PlaceSetupSettlementAction | PlaceSetupRoadAction | RollDiceAction | EndTurnAction;

export type ActionType = Action["type"];
