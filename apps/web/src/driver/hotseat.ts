/**
 * HotseatDriver: every player shares one screen (docs/phase3.md §2).
 *
 * Holds the full GameState in memory, applies actions through the engine,
 * and after each action points `me()` at whoever must act next (the engine's
 * `nextActor`). The device handoff lives here too: hidden information is
 * only shown once the acting player has taken the device. Seats may be
 * bots (docs/phase5.md §6.2), which play immediately after each human action.
 */

import { botStep, createBot, type BotLevel } from "@katan/bots";
import {
  applyAction,
  createGame,
  isRuleError,
  legalActions,
  nextActor,
  redact,
  type Action,
  type CreateGameOptions,
  type GameState,
  type PlayerId,
} from "@katan/engine";
import type { DriverError, GameDriver, RedactedState, Result } from "./types";

/** Who must act next (docs/phase3.md §2); the rule lives in the engine. */
export const actingPlayer = nextActor;

export interface HotseatOptions extends CreateGameOptions {
  /** Player id → bot level for seats played by the computer. */
  readonly bots?: Readonly<Record<PlayerId, BotLevel>>;
}

const BOT_CAP = 200;

export class HotseatDriver implements GameDriver {
  private state: GameState;
  private acting: PlayerId;
  private acknowledged: PlayerId | null = null;
  private readonly bots: Map<PlayerId, BotLevel>;
  private readonly listeners = new Set<(view: RedactedState) => void>();

  constructor(initial: GameState, bots: Readonly<Record<PlayerId, BotLevel>> = {}) {
    this.bots = new Map(Object.entries(bots));
    this.state = this.playBots(initial);
    this.acting = nextActor(this.state);
  }

  static create(options: HotseatOptions): HotseatDriver {
    return new HotseatDriver(createGame(options), options.bots ?? {});
  }

  subscribe(cb: (view: RedactedState) => void): () => void {
    this.listeners.add(cb);
    cb(this.view());
    return () => void this.listeners.delete(cb);
  }

  legalActions(): Action[] {
    return legalActions(this.state, this.acting);
  }

  async dispatch(action: Action): Promise<Result<void, DriverError>> {
    try {
      this.state = applyAction(this.state, action);
    } catch (err) {
      if (isRuleError(err)) return { ok: false, error: err };
      throw err;
    }
    this.state = this.playBots(this.state);
    this.acting = nextActor(this.state);
    this.emit();
    return { ok: true, value: undefined };
  }

  me(): string {
    return this.acting;
  }

  /** The human who must take the device before hidden information is rendered. */
  pendingHandoff(): string | null {
    if (this.state.phase.kind === "ended") return null;
    return this.acknowledged === this.acting ? null : this.acting;
  }

  acknowledgeHandoff(): void {
    this.acknowledged = this.acting;
    this.emit();
  }

  /** Full state, for tests and debugging only. Components must never call this. */
  snapshot(): GameState {
    return this.state;
  }

  private playBots(state: GameState): GameState {
    let steps = 0;
    while (state.phase.kind !== "ended" && steps < BOT_CAP) {
      const actor = nextActor(state);
      const level = this.bots.get(actor);
      if (!level) break;
      state = applyAction(state, botStep(state, actor, createBot(level)));
      steps++;
    }
    return state;
  }

  private emit(): void {
    const view = this.view();
    for (const cb of this.listeners) cb(view);
  }

  private view(): RedactedState {
    return redact(this.state, this.acting);
  }
}
