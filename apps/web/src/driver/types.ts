/**
 * The only seam between the UI and the rules (docs/phase3.md §2, phase4 §5).
 *
 * Components never import the engine's `applyAction`; they talk to a
 * GameDriver. `HotseatDriver` runs the engine in memory; `SupabaseDriver`
 * submits actions to the server and receives redacted views. Optional
 * capabilities let a driver expose what it can (hotseat handoff, seats,
 * presence, escape hatches) without components knowing which driver is live.
 */

import type { AvatarSpec } from "@katan/avatars";
import type { BotLevel } from "@katan/bots";
import type { Action, PlayerColor, RedactedGameState } from "@katan/engine";

export type RedactedState = RedactedGameState;

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** One chat line as the transport carries it; the HUD adds the name and colour from the view. */
export interface ChatLine {
  readonly id: number;
  readonly playerId: string;
  readonly text: string;
  readonly at: string;
}

/** Engine RuleError codes, server transport codes, or the client's own NETWORK code. */
export interface DriverError {
  readonly code: string;
  readonly message: string;
}

export interface SeatInfo {
  readonly playerId: string;
  readonly userId: string | null;
  readonly seat: number;
  readonly name: string;
  readonly color: PlayerColor;
  readonly kind: "human" | "bot";
  readonly botLevel: BotLevel | null;
  readonly ready: boolean;
  readonly lastSeenAt: string | null;
  /** Portrait (docs/phase7.md §4); null for a legacy seat. */
  readonly avatar: AvatarSpec | null;
}

export interface GameDriver {
  /** Subscribe to view updates; the callback fires as soon as a view is available. */
  subscribe(cb: (view: RedactedState) => void): () => void;
  /** Legal actions for the acting player (`me()`), derived from the authoritative state. */
  legalActions(): Action[];
  dispatch(action: Action): Promise<Result<void, DriverError>>;
  /** The player id this client currently acts as. */
  me(): string;

  // --- optional capabilities --------------------------------------------

  /** Hotseat only: the player who must take the device before hidden info is shown. */
  pendingHandoff?(): string | null;
  acknowledgeHandoff?(): void;

  /** Seat metadata (names, bots, portraits, readiness, presence timestamps). Hotseat provides it too. */
  subscribeSeats?(cb: (seats: SeatInfo[]) => void): () => void;
  /** Online: player ids currently connected. */
  subscribePresence?(cb: (connected: ReadonlySet<string>) => void): () => void;
  /** Online: connection state for the "reconnecting" banner. */
  subscribeConnection?(cb: (state: ConnectionState) => void): () => void;
  /** Online: the logged-in user's id (to decide host-only controls). */
  userId?(): string;
  hostUserId?(): string | null;

  /** Online escape hatches (docs/phase5.md §4). */
  handToBot?(level: BotLevel): Promise<Result<void, DriverError>>;
  reclaimSeat?(): Promise<Result<void, DriverError>>;
  botifyAbsent?(playerId: string, level: BotLevel): Promise<Result<void, DriverError>>;

  /** Online: how long a waited-on player must be unseen before the host may hand their seat to a bot (docs/phase5.md §4). */
  absentAfterMs?(): number | null;
  /** Online: post a chat line; the line comes back through `subscribeChat` for everyone. */
  sendChat?(text: string): Promise<Result<void, DriverError>>;
  /** Online: the chat so far, then every new line. Absent on hotseat (chat stays on the screen). */
  subscribeChat?(cb: (messages: readonly ChatLine[]) => void): () => void;
  abandonGame?(): Promise<Result<void, DriverError>>;

  /** Release sockets and timers. */
  close?(): void;
}

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";
