/**
 * HotseatDriver: every player shares one screen (docs/phase3.md §2).
 *
 * Holds the full GameState in memory, applies actions through the engine,
 * and after each action points `me()` at whoever must act next: the current
 * player, or a player who owes a discard or a trade response.
 */

import {
  applyAction,
  createGame,
  isRuleError,
  legalActions,
  redact,
  RuleError,
  type Action,
  type CreateGameOptions,
  type GameState,
  type PlayerId,
} from "@katan/engine";
import type { GameDriver, RedactedState, Result } from "./types";

/** Who must act next in `state` (docs/phase3.md §2). */
export function actingPlayer(state: GameState): PlayerId {
  const current = state.players[state.currentPlayer]!.id;
  const phase = state.phase;
  if (phase.kind === "discard") {
    const owing = state.players.find((p) => state.pendingDiscards[p.id] !== undefined);
    return owing ? owing.id : current;
  }
  if (phase.kind === "action" && state.pendingTrade) {
    const trade = state.pendingTrade;
    const n = state.players.length;
    for (let step = 1; step < n; step++) {
      const p = state.players[(state.currentPlayer + step) % n]!;
      if (p.id !== trade.from && !trade.rejectedBy.includes(p.id)) return p.id;
    }
  }
  return current;
}

export class HotseatDriver implements GameDriver {
  private state: GameState;
  private acting: PlayerId;
  private readonly listeners = new Set<(view: RedactedState) => void>();

  constructor(initial: GameState) {
    this.state = initial;
    this.acting = actingPlayer(initial);
  }

  static create(options: CreateGameOptions): HotseatDriver {
    return new HotseatDriver(createGame(options));
  }

  subscribe(cb: (view: RedactedState) => void): () => void {
    this.listeners.add(cb);
    cb(this.view());
    return () => void this.listeners.delete(cb);
  }

  legalActions(): Action[] {
    return legalActions(this.state, this.acting);
  }

  async dispatch(action: Action): Promise<Result<void, RuleError>> {
    try {
      this.state = applyAction(this.state, action);
    } catch (err) {
      if (isRuleError(err)) return { ok: false, error: err };
      throw err;
    }
    this.acting = actingPlayer(this.state);
    const view = this.view();
    for (const cb of this.listeners) cb(view);
    return { ok: true, value: undefined };
  }

  me(): string {
    return this.acting;
  }

  /** Full state, for tests and debugging only. Components must never call this. */
  snapshot(): GameState {
    return this.state;
  }

  private view(): RedactedState {
    return redact(this.state, this.acting);
  }
}
