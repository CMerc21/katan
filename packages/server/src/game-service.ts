/**
 * Game transactions (docs/phase4.md §3). Every entry point runs one
 * Postgres transaction over a `postgres` client (`sql.begin`), locks the
 * game row, applies the engine, runs the bot loop, appends the action log,
 * and rewrites every player's redacted view.
 *
 * This module is imported by the Deno Edge Functions and by the Node tests;
 * it never imports the Postgres library itself.
 */

import { botStep, isBotLevel, type BotLevel } from "@katan/bots";
import {
  applyAction,
  createGame as engineCreateGame,
  isRuleError,
  nextActor,
  redact,
  replay,
  type Action,
  type BoardKind,
  type GameState,
  type PlayerColor,
  type PlayerId,
} from "@katan/engine";
import { createBot } from "@katan/bots";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import { ServiceError } from "./errors";

export type Tx = TransactionSql<Record<string, unknown>>;
export type Db = Sql<Record<string, unknown>>;

export const BOT_ACTION_CAP = 200;

export interface SeatRow {
  game_id: string;
  user_id: string | null;
  player_id: string;
  seat: number;
  name: string;
  color: PlayerColor;
  kind: "human" | "bot";
  ready: boolean;
  bot_level: BotLevel | null;
  last_seen_at: Date | null;
  joined_at: Date;
}

export interface GameRow {
  id: string;
  seed: string;
  state: GameState;
  version: number;
  status: "lobby" | "active" | "ended";
  created_by: string;
  join_code: string | null;
  host_user_id: string | null;
  max_players: number;
  board: BoardKind;
}

// ---------------------------------------------------------------------------
// Shared pieces

export async function lockGame(tx: Tx, gameId: string): Promise<GameRow> {
  const rows = await tx<GameRow[]>`select * from games where id = ${gameId} for update`;
  const game = rows[0];
  if (!game) throw new ServiceError("GAME_NOT_FOUND", `no game ${gameId}`, 404);
  return game;
}

export async function seatsOf(tx: Tx, gameId: string): Promise<SeatRow[]> {
  return tx<SeatRow[]>`select * from game_players where game_id = ${gameId} order by seat`;
}

export function seatOfUser(seats: SeatRow[], userId: string): SeatRow {
  const seat = seats.find((s) => s.user_id === userId);
  if (!seat) throw new ServiceError("NOT_A_MEMBER", "you are not in this game", 403);
  return seat;
}

/** Rewrite every player's redacted view (§3.1: recomputed on every action; cheap). */
export async function refreshViews(tx: Tx, gameId: string, state: GameState, seats: SeatRow[], version: number): Promise<void> {
  for (const seat of seats) {
    const view = redact(state, seat.player_id);
    await tx`
      insert into game_views (game_id, player_id, user_id, view, version)
      values (${gameId}, ${seat.player_id}, ${seat.user_id}, ${tx.json(view as unknown as JSONValue)}, ${version})
      on conflict (game_id, player_id) do update
        set view = excluded.view, user_id = excluded.user_id, version = excluded.version`;
  }
}

export interface BotLoopResult {
  state: GameState;
  actions: Action[];
  hitCap: boolean;
}

/**
 * §3.1 / docs/phase5.md §6.2: while the next required actor is a bot, let
 * it play. Capped so a stalled bot cannot hang the request.
 */
export function runBotLoop(state: GameState, seats: SeatRow[], cap = BOT_ACTION_CAP): BotLoopResult {
  const levels = new Map<PlayerId, BotLevel>();
  for (const s of seats) if (s.kind === "bot" && s.bot_level) levels.set(s.player_id, s.bot_level);
  const actions: Action[] = [];
  let hitCap = false;
  while (state.phase.kind !== "ended") {
    const actor = nextActor(state);
    const level = levels.get(actor);
    if (!level) break;
    if (actions.length >= cap) {
      hitCap = true;
      break;
    }
    const action = botStep(state, actor, createBot(level));
    state = applyAction(state, action);
    actions.push(action);
  }
  return { state, actions, hitCap };
}

async function appendActions(tx: Tx, gameId: string, fromIndex: number, actions: Action[]): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] as Action;
    await tx`insert into game_actions (game_id, index, player_id, action)
             values (${gameId}, ${fromIndex + i}, ${a.playerId}, ${tx.json(a as unknown as JSONValue)})`;
  }
}

async function persist(tx: Tx, game: GameRow, seats: SeatRow[], state: GameState, applied: Action[]): Promise<number> {
  const version = game.version + applied.length;
  const status = state.phase.kind === "ended" ? "ended" : game.status;
  await appendActions(tx, game.id, game.version, applied);
  await tx`update games set state = ${tx.json(state as unknown as JSONValue)}, version = ${version},
           status = ${status}, updated_at = now() where id = ${game.id}`;
  await tx`update lobbies set status = ${status}, winner = ${state.winner}, updated_at = now() where game_id = ${game.id}`;
  await refreshViews(tx, game.id, state, seats, version);
  return version;
}

// ---------------------------------------------------------------------------
// apply-action (§3.1)

export interface ApplyInput {
  gameId: string;
  userId: string;
  action: Action;
  expectedVersion: number;
}

export interface ApplyResult {
  version: number;
  /** Number of actions applied (the caller's plus any bot actions). */
  applied: number;
  botCapHit: boolean;
}

export async function applyActionForUser(sql: Db, input: ApplyInput): Promise<ApplyResult> {
  return sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    const seats = await seatsOf(tx as Tx, game.id);
    const seat = seatOfUser(seats, input.userId);
    if (game.status !== "active") throw new ServiceError("GAME_NOT_ACTIVE", `game is ${game.status}`, 409);
    if (game.version !== input.expectedVersion) {
      throw new ServiceError("VERSION_CONFLICT", `expected version ${input.expectedVersion}, game is at ${game.version}`, 409);
    }
    if (!input.action || typeof input.action !== "object" || typeof input.action.type !== "string") {
      throw new ServiceError("BAD_REQUEST", "malformed action");
    }
    if (input.action.playerId !== seat.player_id) throw new ServiceError("NOT_YOUR_SEAT", "that is not your seat", 403);
    if (seat.kind === "bot") throw new ServiceError("NOT_YOUR_SEAT", "a bot is playing your seat; reclaim it first", 403);

    let state: GameState;
    try {
      state = applyAction(game.state, input.action);
    } catch (err) {
      if (isRuleError(err)) throw err; // surfaces as { ok: false, code }
      throw err;
    }
    const loop = runBotLoop(state, seats);
    const applied = [input.action, ...loop.actions];
    const version = await persist(tx as Tx, game, seats, loop.state, applied);
    return { version, applied: applied.length, botCapHit: loop.hitCap };
  });
}

// ---------------------------------------------------------------------------
// create-game (§3.2; also used by start-game and the seed script)

export interface CreatePlayer {
  name: string;
  color: PlayerColor;
  kind: "human" | "bot";
  userId?: string;
  level?: BotLevel;
}

export interface CreateGameInput {
  createdBy: string;
  players: CreatePlayer[];
  board: BoardKind;
  seed?: string;
}

export function playerIdForSeat(seat: number): PlayerId {
  return `seat-${seat}`;
}

export async function createGameForUsers(sql: Db, input: CreateGameInput): Promise<{ gameId: string; version: number }> {
  if (input.players.length < 3 || input.players.length > 4) throw new ServiceError("BAD_REQUEST", "3 or 4 players");
  for (const p of input.players) {
    if (p.kind === "bot" && !isBotLevel(p.level)) throw new ServiceError("BAD_REQUEST", "bots need a level");
    if (p.kind === "human" && !p.userId) throw new ServiceError("BAD_REQUEST", "humans need a user id");
  }
  const seed = input.seed ?? randomSeed();
  return sql.begin(async (tx) => {
    const players = input.players.map((p, seat) => ({ id: playerIdForSeat(seat), name: p.name, color: p.color }));
    const initial = engineCreateGame({ seed, players, board: input.board });
    const [row] = await tx<{ id: string }[]>`
      insert into games (seed, state, version, status, created_by, board, max_players)
      values (${seed}, ${tx.json(initial as unknown as JSONValue)}, 0, 'active', ${input.createdBy}, ${input.board}, ${input.players.length})
      returning id`;
    const gameId = row!.id;
    await tx`insert into lobbies (game_id, join_code, status, host_user_id, max_players, board)
             values (${gameId}, ${"DEVGME"}, 'active', ${input.createdBy}, ${input.players.length}, ${input.board})`;
    for (let seat = 0; seat < input.players.length; seat++) {
      const p = input.players[seat] as CreatePlayer;
      await tx`insert into game_players (game_id, user_id, player_id, seat, name, color, kind, bot_level, ready)
               values (${gameId}, ${p.userId ?? null}, ${playerIdForSeat(seat)}, ${seat}, ${p.name}, ${p.color}, ${p.kind}, ${p.kind === "bot" ? p.level! : null}, true)`;
    }
    const seats = await seatsOf(tx as Tx, gameId);
    const loop = runBotLoop(initial, seats);
    const game: GameRow = { id: gameId, seed, state: initial, version: 0, status: "active", created_by: input.createdBy, join_code: null, host_user_id: input.createdBy, max_players: input.players.length, board: input.board };
    const version = await persist(tx as Tx, game, seats, loop.state, loop.actions);
    return { gameId, version };
  });
}

/** Start an active game from an existing lobby's seats (Phase 5 start-game). */
export async function activateGame(tx: Tx, game: GameRow, seats: SeatRow[]): Promise<number> {
  const players = seats.map((s) => ({ id: s.player_id, name: s.name, color: s.color }));
  const initial = engineCreateGame({ seed: game.seed, players, board: game.board });
  await tx`update games set state = ${tx.json(initial as unknown as JSONValue)}, status = 'active', updated_at = now() where id = ${game.id}`;
  await tx`update lobbies set status = 'active', updated_at = now() where game_id = ${game.id}`;
  const loop = runBotLoop(initial, seats);
  return persist(tx as Tx, { ...game, status: "active", state: initial }, seats, loop.state, loop.actions);
}

// ---------------------------------------------------------------------------
// replay-check (§3.3)

export interface ReplayResult {
  equal: boolean;
  version: number;
  actions: number;
  difference: string | null;
}

export async function replayCheck(sql: Db, gameId: string): Promise<ReplayResult> {
  const [game] = await sql<GameRow[]>`select * from games where id = ${gameId}`;
  if (!game) throw new ServiceError("GAME_NOT_FOUND", `no game ${gameId}`, 404);
  const rows = await sql<{ index: number; action: Action }[]>`select index, action from game_actions where game_id = ${gameId} order by index`;
  const seats = await sql<SeatRow[]>`select * from game_players where game_id = ${gameId} order by seat`;
  const players = seats.map((s) => ({ id: s.player_id, name: s.name, color: s.color }));
  const initial = engineCreateGame({ seed: game.seed, players, board: game.board });
  const rebuilt = replay(initial, rows.map((r) => r.action));
  // jsonb does not preserve key order, so compare canonical encodings.
  const a = canonicalJson(rebuilt);
  const b = canonicalJson(game.state);
  return { equal: a === b, version: game.version, actions: rows.length, difference: a === b ? null : firstDifference(a, b) };
}

/** JSON with object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 24);
  return `at char ${i}: rebuilt "${a.slice(from, i + 24)}" vs stored "${b.slice(from, i + 24)}"`;
}

// ---------------------------------------------------------------------------

const SEED_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Seeds only need to be unpredictable, not cryptographic; callers may pass their own. */
export function randomSeed(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 12; i++) out += SEED_ALPHABET[Math.floor(random() * SEED_ALPHABET.length)];
  return out;
}
