/**
 * The only seam between the UI and the rules (docs/phase3.md §2).
 *
 * Components never import the engine's `applyAction`; they talk to a
 * GameDriver. Phase 3 ships `HotseatDriver`; Phase 4 adds a network driver
 * with the same interface.
 */

import type { Action, RedactedGameState, RuleError } from "@katan/engine";

export type RedactedState = RedactedGameState;

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface GameDriver {
  /** Subscribe to view updates; the callback fires immediately with the current view. */
  subscribe(cb: (view: RedactedState) => void): () => void;
  /** Legal actions for the acting player (`me()`), derived from the authoritative state. */
  legalActions(): Action[];
  dispatch(action: Action): Promise<Result<void, RuleError>>;
  /** The player id this client currently acts as. */
  me(): string;
}
