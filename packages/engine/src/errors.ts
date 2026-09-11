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
  | "WRONG_STEP"
  | "INVALID_VERTEX"
  | "VERTEX_OCCUPIED"
  | "DISTANCE_RULE"
  | "INVALID_EDGE"
  | "EDGE_OCCUPIED"
  | "ROAD_NOT_CONNECTED"
  | "NO_PIECES_LEFT"
  | "NOT_IMPLEMENTED";

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
