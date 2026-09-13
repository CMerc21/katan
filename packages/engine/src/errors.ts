/**
 * Errors thrown by `applyAction` when an action is illegal. The `code` is
 * stable and machine-readable so the server and UI can map it to copy.
 */

export type RuleErrorCode =
  | "BAD_PLAYER_COUNT"
  | "DUPLICATE_PLAYER"
  | "UNKNOWN_PLAYER"
  | "NOT_YOUR_TURN"
  | "WRONG_PHASE"
  | "GAME_OVER"
  | "INVALID_VERTEX"
  | "VERTEX_OCCUPIED"
  | "DISTANCE_RULE"
  | "NOT_CONNECTED_TO_ROAD"
  | "NOT_YOUR_SETTLEMENT"
  | "INVALID_EDGE"
  | "EDGE_OCCUPIED"
  | "ROAD_NOT_CONNECTED"
  | "NO_LEGAL_ROAD"
  | "NO_PIECES_LEFT"
  | "INSUFFICIENT_RESOURCES"
  | "NO_DISCARD_OWED"
  | "WRONG_DISCARD_COUNT"
  | "INVALID_HEX"
  | "ROBBER_MUST_MOVE"
  | "INVALID_STEAL_TARGET"
  | "DECK_EMPTY"
  | "NO_SUCH_CARD"
  | "CARD_TOO_NEW"
  | "DEV_CARD_ALREADY_PLAYED"
  | "BANK_EMPTY"
  | "EMPTY_TRADE"
  | "INVALID_TRADE"
  | "TRADE_ALREADY_PENDING"
  | "NO_PENDING_TRADE"
  | "BAD_TRADE_RATIO"
  | "INVALID_BOARD"
  | "TIDES_OFF"
  | "PIRATE_BLOCKS"
  | "SHIP_NOT_CONNECTED"
  | "NOT_YOUR_SHIP"
  | "NOT_OPEN_END"
  | "SHIP_TOO_NEW"
  | "SHIP_ALREADY_MOVED"
  | "NO_GOLD_OWED"
  | "WRONG_GOLD_COUNT"
  | "INVALID_SCENARIO"
  // Modules (docs/phase10.md, docs/phase11.md)
  | "MODULE_OFF"
  | "NOT_YOUR_PROMPT"
  | "INVALID_CHOICE"
  | "NO_FISH"
  | "NO_BOOT"
  | "BOOT_NOT_ALLOWED"
  | "NOT_COASTAL"
  | "NO_KNIGHTS_LEFT"
  | "HEX_NOT_TOUCHED"
  | "NOT_RAIDED"
  | "ALREADY_HAS_CASTLE"
  | "NO_SPICE"
  | "CARAVAN_NOT_ADJACENT"
  | "CARAVAN_COMPLETE"
  | "WAGON_BAD_PATH"
  | "WAGON_BLOCKED"
  | "WAGON_FULL"
  | "WAGON_NO_STEPS"
  | "NO_CARGO"
  | "NOT_A_CITY"
  | "NO_GOODS"
  | "NO_CITY"
  | "TRACK_MAXED"
  | "NEEDS_POLITICS"
  | "NO_KNIGHT"
  | "NOT_YOUR_KNIGHT"
  | "KNIGHT_INACTIVE"
  | "KNIGHT_ALREADY_ACTIVE"
  | "KNIGHT_ACTED"
  | "KNIGHT_MAX_LEVEL"
  | "VERTEX_HAS_KNIGHT"
  | "KNIGHT_NOT_CONNECTED"
  | "NOT_STRONGER"
  | "NOT_ADJACENT"
  | "WALL_LIMIT"
  | "PROGRESS_LIMIT"
  | "NO_PROGRESS_CARD"
  | "PROGRESS_BEFORE_ROLL"
  | "ROBBER_LOCKED"
  | "NO_TARGET"
  | "NOT_HELD"
  | "INVALID_PAYLOAD";

export class RuleError extends Error {
  readonly code: RuleErrorCode;

  constructor(code: RuleErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RuleError";
    this.code = code;
  }
}

export function isRuleError(err: unknown): err is RuleError {
  return err instanceof RuleError;
}
