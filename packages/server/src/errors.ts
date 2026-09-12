/**
 * Error codes returned by Edge Functions (docs/phase4.md §3): the engine's
 * RuleError codes plus transport codes.
 */

import { isRuleError, type RuleErrorCode } from "@katan/engine";

export type TransportCode =
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "GAME_NOT_FOUND"
  | "NOT_A_MEMBER"
  | "GAME_NOT_ACTIVE"
  | "VERSION_CONFLICT"
  | "NOT_YOUR_SEAT"
  | "NOT_HOST"
  | "INVALID_CODE"
  | "LOBBY_FULL"
  | "ALREADY_JOINED"
  | "COLOR_TAKEN"
  | "TOO_FEW_PLAYERS"
  | "NOT_READY"
  | "NOT_ABSENT"
  | "BOT_CAP"
  | "BOARD_NOT_FOUND"
  | "NOT_OWNER";

export type ServiceCode = RuleErrorCode | TransportCode;

export class ServiceError extends Error {
  readonly code: ServiceCode;
  readonly status: number;

  constructor(code: ServiceCode, message?: string, status = 400) {
    super(message ?? code);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export type Reply<T> = ({ ok: true } & T) | { ok: false; code: ServiceCode; message: string };

/** Turn any thrown error into a reply body; RuleErrors keep their code. */
export function toReply(err: unknown): { ok: false; code: ServiceCode; message: string; status: number } {
  if (err instanceof ServiceError) return { ok: false, code: err.code, message: err.message, status: err.status };
  if (isRuleError(err)) return { ok: false, code: err.code, message: err.message, status: 400 };
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, code: "BAD_REQUEST", message, status: 500 };
}
