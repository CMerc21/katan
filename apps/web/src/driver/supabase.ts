/**
 * SupabaseDriver (docs/phase4.md §4–§5, docs/phase5.md §2).
 *
 * The driver talks to a small `GameApi` so tests can mock the transport.
 * `createSupabaseApi` implements it over supabase-js: the client only ever
 * reads its own `game_views` row and the `game_players` rows of games it
 * belongs to (Row Level Security enforces both), and submits actions to the
 * `apply-action` Edge Function.
 */

import { isAvatarSpec } from "@katan/avatars";
import type { BotLevel } from "@katan/bots";
import { legalActionsForView, type Action } from "@katan/engine";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatLine, ConnectionState, DriverError, GameDriver, RedactedState, Result, SeatInfo } from "./types";

export type Reply = ({ ok: true } & Record<string, unknown>) | { ok: false; code: string; message: string };

export interface ViewRow {
  view: RedactedState;
  version: number;
  /**
   * The server's legal list for this player, when the row carries one.
   * Crown & Castle's Spy prompt lists the target's cards only here
   * (docs/phase11.md §13); a client computing legal actions from its
   * redacted view never sees them.
   */
  legal?: Action[];
}

export interface GameApi {
  fetchView(gameId: string): Promise<ViewRow | null>;
  fetchSeats(gameId: string): Promise<SeatInfo[]>;
  /** The game's chat so far, oldest first (the transport may not offer chat: tests mock without it). */
  fetchChat?(gameId: string): Promise<ChatLine[]>;
  invoke(fn: string, body: Record<string, unknown>): Promise<Reply>;
  /**
   * Realtime: `onView` for my own game_views row changes, `onSeats` for
   * game_players changes, `onStatus` on (re)subscription and loss, `onChat`
   * for each new chat line.
   */
  subscribeGame(
    gameId: string,
    playerId: string,
    handlers: { onView(row: ViewRow): void; onSeats(): void; onStatus(state: ConnectionState): void; onPresence(ids: string[]): void; onChat?(line: ChatLine): void },
  ): () => void;
}

const HEARTBEAT_MS = 60_000;

export class SupabaseDriver implements GameDriver {
  private view: RedactedState | null = null;
  private serverLegal: Action[] | null = null;
  private version = -1;
  private seats: SeatInfo[] = [];
  private connected = new Set<string>();
  private connection: ConnectionState = "connecting";
  private readonly viewListeners = new Set<(view: RedactedState) => void>();
  private readonly seatListeners = new Set<(seats: SeatInfo[]) => void>();
  private readonly presenceListeners = new Set<(ids: ReadonlySet<string>) => void>();
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>();
  private chat: ChatLine[] = [];
  private chatLoaded = false;
  private readonly chatListeners = new Set<(messages: readonly ChatLine[]) => void>();
  private unsubscribeRealtime: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private wake: (() => void) | null = null;

  constructor(
    private readonly api: GameApi,
    readonly gameId: string,
    private readonly playerId: string,
    private readonly user: string,
    initial: ViewRow | null,
    seats: SeatInfo[],
  ) {
    if (initial) this.accept(initial);
    this.seats = seats;
  }

  /** Resolve my seat, fetch the first view, and open the Realtime channel. */
  static async connect(api: GameApi, gameId: string, userId: string): Promise<SupabaseDriver> {
    const seats = await api.fetchSeats(gameId);
    const mine = seats.find((s) => s.userId === userId);
    if (!mine) throw Object.assign(new Error("you are not in this game"), { code: "NOT_A_MEMBER" });
    const initial = await api.fetchView(gameId);
    const driver = new SupabaseDriver(api, gameId, mine.playerId, userId, initial, seats);
    driver.open();
    return driver;
  }

  private open(): void {
    this.unsubscribeRealtime = this.api.subscribeGame(this.gameId, this.playerId, {
      onView: (row) => this.accept(row),
      onSeats: () => void this.refreshSeats(),
      onStatus: (state) => {
        this.setConnection(state);
        // §4: on subscribe and on every reconnect, fetch directly in case an event was missed.
        if (state === "live") void this.refetch();
      },
      onPresence: (ids) => {
        this.connected = new Set(ids);
        for (const cb of this.presenceListeners) cb(this.connected);
      },
      onChat: (line) => this.acceptChat([line]),
    });
    this.heartbeat = setInterval(() => void this.api.invoke("heartbeat", { gameId: this.gameId }).catch(() => undefined), HEARTBEAT_MS);
    if (typeof window !== "undefined") {
      this.wake = () => {
        if (document.visibilityState === "visible") void this.refetch();
      };
      window.addEventListener("online", this.wake);
      document.addEventListener("visibilitychange", this.wake);
    }
  }

  private accept(row: ViewRow): void {
    // Views only ever move forward; a late event for an older version is dropped.
    if (row.version < this.version) return;
    this.version = row.version;
    this.view = row.view;
    this.serverLegal = row.legal ?? null;
    for (const cb of this.viewListeners) cb(row.view);
  }

  private setConnection(state: ConnectionState): void {
    this.connection = state;
    for (const cb of this.connectionListeners) cb(state);
  }

  /** Replace local state with the server's (§4: never trust local optimistic state). */
  async refetch(): Promise<void> {
    try {
      const row = await this.api.fetchView(this.gameId);
      if (row) this.accept(row);
      if (this.connection !== "live") this.setConnection("live");
    } catch {
      this.setConnection("reconnecting");
    }
  }

  private async refreshSeats(): Promise<void> {
    try {
      this.seats = await this.api.fetchSeats(this.gameId);
      for (const cb of this.seatListeners) cb(this.seats);
    } catch {
      /* the next event will retry */
    }
  }

  // --- GameDriver ---------------------------------------------------------

  subscribe(cb: (view: RedactedState) => void): () => void {
    this.viewListeners.add(cb);
    if (this.view) cb(this.view);
    return () => void this.viewListeners.delete(cb);
  }

  legalActions(): Action[] {
    if (!this.view) return [];
    // The server's list wins when the row carries one (hidden-information prompts such as the Spy); otherwise the view's.
    return this.serverLegal ?? legalActionsForView(this.view);
  }

  async dispatch(action: Action): Promise<Result<void, DriverError>> {
    let reply: Reply;
    try {
      reply = await this.api.invoke("apply-action", { gameId: this.gameId, action, expectedVersion: this.version });
    } catch (err) {
      // §5: never leave the board half-applied; refetch and report.
      this.setConnection("reconnecting");
      void this.refetch();
      return { ok: false, error: { code: "NETWORK", message: err instanceof Error ? err.message : String(err) } };
    }
    if (!reply.ok) {
      if (reply.code === "VERSION_CONFLICT") await this.refetch(); // §5: refetch, do not retry automatically
      return { ok: false, error: { code: reply.code, message: reply.message } };
    }
    // The Realtime event carries the new view; if it beats us here, `accept` already ran.
    return { ok: true, value: undefined };
  }

  me(): string {
    return this.playerId;
  }

  currentVersion(): number {
    return this.version;
  }

  // --- capabilities -------------------------------------------------------

  subscribeSeats(cb: (seats: SeatInfo[]) => void): () => void {
    this.seatListeners.add(cb);
    cb(this.seats);
    return () => void this.seatListeners.delete(cb);
  }

  subscribePresence(cb: (connected: ReadonlySet<string>) => void): () => void {
    this.presenceListeners.add(cb);
    cb(this.connected);
    return () => void this.presenceListeners.delete(cb);
  }

  subscribeConnection(cb: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(cb);
    cb(this.connection);
    return () => void this.connectionListeners.delete(cb);
  }

  userId(): string {
    return this.user;
  }

  hostUserId(): string | null {
    // The host is exposed on the lobby projection; seats carry it via the first human when unknown.
    return this.host ?? null;
  }

  host: string | null = null;

  private async call(fn: string, body: Record<string, unknown>): Promise<Result<void, DriverError>> {
    try {
      const reply = await this.api.invoke(fn, { gameId: this.gameId, ...body });
      if (!reply.ok) return { ok: false, error: { code: reply.code, message: reply.message } };
      await this.refetch();
      await this.refreshSeats();
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: { code: "NETWORK", message: err instanceof Error ? err.message : String(err) } };
    }
  }

  handToBot(level: BotLevel): Promise<Result<void, DriverError>> {
    return this.call("hand-to-bot", { level });
  }

  reclaimSeat(): Promise<Result<void, DriverError>> {
    return this.call("hand-to-bot", { reclaim: true });
  }

  botifyAbsent(playerId: string, level: BotLevel): Promise<Result<void, DriverError>> {
    return this.call("botify-absent", { playerId, level });
  }

  // --- Chat (docs/phase12.md §3) -------------------------------------------

  sendChat(text: string): Promise<Result<void, DriverError>> {
    return this.call("send-chat", { text });
  }

  subscribeChat(cb: (messages: readonly ChatLine[]) => void): () => void {
    this.chatListeners.add(cb);
    cb(this.chat);
    if (!this.chatLoaded && this.api.fetchChat) {
      this.chatLoaded = true;
      void this.api
        .fetchChat(this.gameId)
        .then((lines) => this.acceptChat(lines))
        .catch(() => void (this.chatLoaded = false));
    }
    return () => void this.chatListeners.delete(cb);
  }

  /** Merge lines by id (a Realtime insert can arrive before or after the initial fetch) and keep them in order. */
  private acceptChat(lines: readonly ChatLine[]): void {
    const seen = new Set(this.chat.map((l) => l.id));
    const fresh = lines.filter((l) => !seen.has(l.id));
    if (fresh.length === 0) return;
    this.chat = [...this.chat, ...fresh].sort((a, b) => a.id - b.id);
    for (const cb of this.chatListeners) cb(this.chat);
  }

  abandonGame(): Promise<Result<void, DriverError>> {
    return this.call("abandon-game", {});
  }

  close(): void {
    this.unsubscribeRealtime?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.wake && typeof window !== "undefined") {
      window.removeEventListener("online", this.wake);
      document.removeEventListener("visibilitychange", this.wake);
    }
  }
}

// ---------------------------------------------------------------------------
// supabase-js implementation of GameApi

interface SeatRow {
  player_id: string;
  user_id: string | null;
  seat: number;
  name: string;
  color: SeatInfo["color"];
  kind: "human" | "bot";
  bot_level: BotLevel | null;
  ready: boolean;
  last_seen_at: string | null;
  avatar?: unknown;
}

interface ChatRow {
  id: number;
  player_id: string;
  text: string;
  created_at: string;
}

function chatFromRow(r: ChatRow): ChatLine {
  return { id: r.id, playerId: r.player_id, text: r.text, at: r.created_at };
}

export function seatFromRow(r: SeatRow): SeatInfo {
  return {
    playerId: r.player_id,
    userId: r.user_id,
    seat: r.seat,
    name: r.name,
    color: r.color,
    kind: r.kind,
    botLevel: r.bot_level,
    ready: r.ready,
    lastSeenAt: r.last_seen_at,
    avatar: isAvatarSpec(r.avatar) ? r.avatar : null,
  };
}

export function createSupabaseApi(client: SupabaseClient, userId: string): GameApi {
  return {
    async fetchView(gameId) {
      const { data, error } = await client.from("game_views").select("*").eq("game_id", gameId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const legal = (data as { legal?: unknown }).legal;
      return { view: data.view as RedactedState, version: data.version as number, ...(Array.isArray(legal) ? { legal: legal as Action[] } : {}) };
    },
    async fetchSeats(gameId) {
      const { data, error } = await client.from("game_players").select("*").eq("game_id", gameId).order("seat");
      if (error) throw error;
      return (data as SeatRow[]).map(seatFromRow);
    },
    async fetchChat(gameId) {
      const { data, error } = await client.from("game_chat").select("id, player_id, text, created_at").eq("game_id", gameId).order("id").limit(200);
      if (error) throw error;
      return (data as ChatRow[]).map(chatFromRow);
    },
    async invoke(fn, body) {
      const { data, error } = await client.functions.invoke(fn, { body });
      if (error) {
        // Non-2xx replies still carry our JSON envelope.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          const parsed = (await ctx.json().catch(() => null)) as Reply | null;
          if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
        }
        throw error;
      }
      return data as Reply;
    },
    subscribeGame(gameId, playerId, handlers) {
      const channel = client
        .channel(`game:${gameId}`, { config: { presence: { key: playerId } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "game_views", filter: `game_id=eq.${gameId}` }, (payload) => {
          const row = payload.new as { player_id?: string; view?: RedactedState; version?: number; legal?: unknown };
          if (row.player_id === playerId && row.view && typeof row.version === "number") handlers.onView({ view: row.view, version: row.version, ...(Array.isArray(row.legal) ? { legal: row.legal as Action[] } : {}) });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${gameId}` }, () => handlers.onSeats())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat", filter: `game_id=eq.${gameId}` }, (payload) => {
          const row = payload.new as Partial<ChatRow>;
          if (typeof row.id === "number" && typeof row.player_id === "string" && typeof row.text === "string") handlers.onChat?.(chatFromRow({ id: row.id, player_id: row.player_id, text: row.text, created_at: row.created_at ?? new Date().toISOString() }));
        })
        .on("presence", { event: "sync" }, () => {
          handlers.onPresence(Object.keys(channel.presenceState()));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            handlers.onStatus("live");
            void channel.track({ playerId, userId, connectedAt: new Date().toISOString() });
          } else if (status === "CLOSED") handlers.onStatus("offline");
          else handlers.onStatus("reconnecting");
        });
      return () => void client.removeChannel(channel);
    },
  };
}
