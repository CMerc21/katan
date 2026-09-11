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
  | "BAD_TRADE_RATIO";

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
