/**
 * HotseatDriver: every player shares one screen (docs/phase3.md §2).
 *
 * Holds the full GameState in memory, applies actions through the engine,
 * and after each action points `me()` at whoever must act next (the engine's
 * `nextActor`). The device handoff lives here too: hidden information is
 * only shown once the acting player has taken the device. Seats may be
 * bots (docs/phase5.md §6.2), which play immediately after each human action.
 */

import { avatarFromSeed, type AvatarSpec } from "@katan/avatars";
import { botStep, createBot, type BotLevel } from "@katan/bots";
import {
  applyActionWithEvents,
  createGame,
  isRuleError,
  legalActions,
  nextActor,
  redact,
  type Action,
  type CreateGameOptions,
  type GameEvent,
  type GameState,
  type PlayerId,
} from "@katan/engine";
import type { DriverError, GameDriver, RedactedState, Result, SeatInfo } from "./types";

/** Who must act next (docs/phase3.md §2); the rule lives in the engine. */
export const actingPlayer = nextActor;

export interface HotseatOptions extends CreateGameOptions {
  /** Player id → bot level for seats played by the computer. */
  readonly bots?: Readonly<Record<PlayerId, BotLevel>>;
  /** Player id → portrait; missing seats get one from the seed (docs/phase7.md §4). */
  readonly avatars?: Readonly<Record<PlayerId, AvatarSpec>>;
}

const BOT_CAP = 200;

export class HotseatDriver implements GameDriver {
  private state: GameState;
  private acting: PlayerId;
  private acknowledged: PlayerId | null = null;
  private readonly bots: Map<PlayerId, BotLevel>;
  private readonly avatars: Map<PlayerId, AvatarSpec>;
  private readonly listeners = new Set<(view: RedactedState) => void>();
  /** Events since the previous emitted view (docs/phase7.md §1.2). */
  private pending: GameEvent[] = [];

  constructor(initial: GameState, bots: Readonly<Record<PlayerId, BotLevel>> = {}, avatars: Readonly<Record<PlayerId, AvatarSpec>> = {}) {
    this.bots = new Map(Object.entries(bots));
    this.avatars = new Map(Object.entries(avatars));
    for (const p of initial.players) if (!this.avatars.has(p.id)) this.avatars.set(p.id, avatarFromSeed(`${initial.seed}:${p.id}`));
    this.state = this.playBots(initial);
    this.acting = nextActor(this.state);
  }

  static create(options: HotseatOptions): HotseatDriver {
    return new HotseatDriver(createGame(options), options.bots ?? {}, options.avatars ?? {});
  }

  /** Seat metadata for the panels: who is a bot, and every portrait. Fires once; seats never change in hotseat. */
  subscribeSeats(cb: (seats: SeatInfo[]) => void): () => void {
    cb(
      this.state.players.map((p, seat) => ({
        playerId: p.id,
        userId: null,
        seat,
        name: p.name,
        color: p.color,
        kind: this.bots.has(p.id) ? "bot" : "human",
        botLevel: this.bots.get(p.id) ?? null,
        ready: true,
        lastSeenAt: null,
        avatar: this.avatars.get(p.id) ?? null,
      })),
    );
    return () => undefined;
  }

  subscribe(cb: (view: RedactedState) => void): () => void {
    this.listeners.add(cb);
    cb(this.view([]));
    return () => void this.listeners.delete(cb);
  }

  legalActions(): Action[] {
    return legalActions(this.state, this.acting);
  }

  async dispatch(action: Action): Promise<Result<void, DriverError>> {
    try {
      const applied = applyActionWithEvents(this.state, action);
      this.state = applied.state;
      this.pending.push(...applied.events);
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

  /** Player ids played by the computer, with their levels. */
  botSeats(): ReadonlyMap<PlayerId, BotLevel> {
    return this.bots;
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
      const applied = applyActionWithEvents(state, botStep(state, actor, createBot(level)));
      state = applied.state;
      this.pending.push(...applied.events);
      steps++;
    }
    return state;
  }

  private emit(): void {
    const events = this.pending;
    this.pending = [];
    const view = this.view(events);
    for (const cb of this.listeners) cb(view);
  }

  private view(events: GameEvent[]): RedactedState {
    return redact(this.state, this.acting, events);
  }
}
