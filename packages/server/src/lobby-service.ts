/**
 * Lobby, presence and escape-hatch transactions (docs/phase5.md §1, §4).
 */

import { isAvatarSpec, type AvatarSpec } from "@katan/avatars";
import { isBotLevel, type BotLevel } from "@katan/bots";
import { PLAYER_COLORS, appendNote, builtInBoard, cloneJson, hasErrors, isBoardDefinition, isBuiltInBoardId, nextActor, validateBoard, type BoardDefinition, type BoardKind, type GameState, type PlayerColor } from "@katan/engine";
import type { JSONValue } from "postgres";
import { ServiceError } from "./errors";
import {
  activateGame,
  appendEvents,
  defaultAvatar,
  defaultBotName,
  lockGame,
  playerIdForSeat,
  randomSeed,
  refreshViews,
  runBotLoop,
  seatOfUser,
  seatsOf,
  type Db,
  type GameRow,
  type SeatRow,
  type Tx,
} from "./game-service";

/** Uppercase letters and digits without 0/O/1/I (docs/phase5.md §1). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const ABSENT_AFTER_MS = 10 * 60 * 1000;

function requireHost(game: GameRow, userId: string): void {
  if (game.host_user_id !== userId) throw new ServiceError("NOT_HOST", "only the host can do that", 403);
}

function requireLobby(game: GameRow): void {
  if (game.status !== "lobby") throw new ServiceError("GAME_NOT_ACTIVE", `game is ${game.status}`, 409);
}

function requireActive(game: GameRow): void {
  if (game.status !== "active") throw new ServiceError("GAME_NOT_ACTIVE", `game is ${game.status}`, 409);
}

function freeSeat(seats: SeatRow[], max: number): number {
  for (let s = 0; s < max; s++) if (!seats.some((x) => x.seat === s)) return s;
  throw new ServiceError("LOBBY_FULL", "no free seat", 409);
}

function freeColor(seats: SeatRow[], wanted?: PlayerColor): PlayerColor {
  const taken = new Set(seats.map((s) => s.color));
  if (wanted) {
    if (!PLAYER_COLORS.includes(wanted)) throw new ServiceError("BAD_REQUEST", "unknown colour");
    if (taken.has(wanted)) throw new ServiceError("COLOR_TAKEN", "that colour is taken", 409);
    return wanted;
  }
  const free = PLAYER_COLORS.find((c) => !taken.has(c));
  if (!free) throw new ServiceError("LOBBY_FULL", "no colour left", 409);
  return free;
}

function cleanName(name: unknown, fallback: string): string {
  const n = typeof name === "string" ? name.trim().slice(0, 20) : "";
  return n.length > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------

export interface CreateLobbyInput {
  hostUserId: string;
  name: string;
  /**
   * A built-in kind, a built-in frame id (`large`, `longStrip`, `ring`), a saved
   * board id (`{ boardId }`), or an inline definition (docs/phase8.md §4.3).
   */
  board: BoardKind | string | { boardId: string } | { definition: BoardDefinition };
  maxPlayers: 3 | 4 | 5 | 6;
  random?: () => number;
}

/** Resolve the lobby's board choice to what the games row stores. */
async function resolveLobbyBoard(sql: Db, board: CreateLobbyInput["board"], userId: string): Promise<{ kind: BoardKind | "custom"; definition: BoardDefinition | null; name: string }> {
  if (board === "beginner") return { kind: "beginner", definition: null, name: "Beginner" };
  if (board === "random") return { kind: "random", definition: null, name: "Random" };
  if (typeof board === "string") {
    if (!isBuiltInBoardId(board)) throw new ServiceError("BAD_REQUEST", "unknown board");
    const def = builtInBoard(board);
    return { kind: "custom", definition: def, name: def.name };
  }
  if ("boardId" in board) {
    const [row] = await sql<{ definition: unknown; is_public: boolean; owner_id: string; name: string }[]>`select definition, is_public, owner_id, name from boards where id = ${board.boardId}`;
    if (!row || (!row.is_public && row.owner_id !== userId)) throw new ServiceError("BAD_REQUEST", "no such board");
    if (!isBoardDefinition(row.definition)) throw new ServiceError("BAD_REQUEST", "stored board is malformed");
    return { kind: "custom", definition: { ...row.definition, id: board.boardId, name: row.name }, name: row.name };
  }
  if (!isBoardDefinition(board.definition)) throw new ServiceError("BAD_REQUEST", "malformed board definition");
  if (hasErrors(validateBoard(board.definition))) throw new ServiceError("INVALID_BOARD", "the board has errors");
  return { kind: "custom", definition: board.definition, name: board.definition.name };
}

export async function createLobby(sql: Db, input: CreateLobbyInput): Promise<{ gameId: string; joinCode: string }> {
  if (![3, 4, 5, 6].includes(input.maxPlayers)) throw new ServiceError("BAD_REQUEST", "3 to 6 players");
  const chosen = await resolveLobbyBoard(sql, input.board, input.hostUserId);
  const seatCap = chosen.definition ? chosen.definition.seats.max : 4;
  if (input.maxPlayers > seatCap) throw new ServiceError("BAD_REQUEST", `that board seats at most ${seatCap}`);
  const random = input.random ?? Math.random;
  for (let attempt = 0; attempt < 20; attempt++) {
    const joinCode = generateJoinCode(random);
    try {
      return await sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into games (seed, state, version, status, created_by, join_code, host_user_id, max_players, board, board_definition)
          values (${randomSeed(random)}, '{}'::jsonb, 0, 'lobby', ${input.hostUserId}, ${joinCode}, ${input.hostUserId}, ${input.maxPlayers}, ${chosen.kind}, ${chosen.definition ? tx.json(chosen.definition as unknown as JSONValue) : null})
          returning id`;
        const gameId = row!.id;
        await tx`insert into lobbies (game_id, join_code, status, host_user_id, max_players, board, board_name)
                 values (${gameId}, ${joinCode}, 'lobby', ${input.hostUserId}, ${input.maxPlayers}, ${chosen.kind}, ${chosen.name})`;
        await tx`insert into game_players (game_id, user_id, player_id, seat, name, color, kind, ready, last_seen_at, avatar)
                 values (${gameId}, ${input.hostUserId}, ${playerIdForSeat(0)}, 0, ${cleanName(input.name, "Host")}, 'red', 'human', false, now(), ${tx.json(defaultAvatar(gameId, 0) as unknown as JSONValue)})`;
        return { gameId, joinCode };
      });
    } catch (err) {
      if (isUniqueViolation(err)) continue; // code collided with a live game; try another
      throw err;
    }
  }
  throw new ServiceError("BAD_REQUEST", "could not allocate a join code", 500);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function joinGame(sql: Db, input: { code: string; userId: string; name: string }): Promise<{ gameId: string; playerId: string }> {
  const code = normalizeCode(input.code);
  if (code.length !== 6) throw new ServiceError("INVALID_CODE", "join codes are 6 characters", 404);
  return sql.begin(async (tx) => {
    const rows = await tx<GameRow[]>`select * from games where join_code = ${code} and status <> 'ended' for update`;
    const game = rows[0];
    if (!game) throw new ServiceError("INVALID_CODE", "no open game with that code", 404);
    const seats = await seatsOf(tx as Tx, game.id);
    const mine = seats.find((s) => s.user_id === input.userId);
    if (mine) return { gameId: game.id, playerId: mine.player_id }; // idempotent: reopening the link
    requireLobby(game);
    if (seats.length >= game.max_players) throw new ServiceError("LOBBY_FULL", "that game is full", 409);
    const seat = freeSeat(seats, game.max_players);
    const color = freeColor(seats);
    const playerId = playerIdForSeat(seat);
    await tx`insert into game_players (game_id, user_id, player_id, seat, name, color, kind, ready, last_seen_at, avatar)
             values (${game.id}, ${input.userId}, ${playerId}, ${seat}, ${cleanName(input.name, `Player ${seat + 1}`)}, ${color}, 'human', false, now(), ${tx.json(defaultAvatar(game.id, seat) as unknown as JSONValue)})`;
    return { gameId: game.id, playerId };
  });
}

export async function setReady(sql: Db, input: { gameId: string; userId: string; ready: boolean }): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireLobby(game);
    const seat = seatOfUser(await seatsOf(tx as Tx, game.id), input.userId);
    await tx`update game_players set ready = ${input.ready} where game_id = ${game.id} and player_id = ${seat.player_id}`;
  });
}

export async function setSeat(
  sql: Db,
  input: { gameId: string; userId: string; color?: PlayerColor; name?: string; avatar?: AvatarSpec; playerId?: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireLobby(game);
    const seats = await seatsOf(tx as Tx, game.id);
    const mine = seatOfUser(seats, input.userId);
    // The host may rename a bot (docs/phase7.md §5); everything else is your own seat only.
    let seat = mine;
    if (input.playerId !== undefined && input.playerId !== mine.player_id) {
      requireHost(game, input.userId);
      const target = seats.find((s) => s.player_id === input.playerId);
      if (!target || target.kind !== "bot") throw new ServiceError("BAD_REQUEST", "only bots can be edited by the host");
      seat = target;
    }
    const color = input.color ? freeColor(seats.filter((s) => s.player_id !== seat.player_id), input.color) : seat.color;
    const name = input.name !== undefined ? cleanName(input.name, seat.name) : seat.name;
    if (input.avatar !== undefined && !isAvatarSpec(input.avatar)) throw new ServiceError("BAD_REQUEST", "malformed avatar");
    const avatar = input.avatar ?? seat.avatar ?? defaultAvatar(game.id, seat.seat);
    await tx`update game_players set color = ${color}, name = ${name}, avatar = ${tx.json(avatar as unknown as JSONValue)} where game_id = ${game.id} and player_id = ${seat.player_id}`;
  });
}

export async function addBot(sql: Db, input: { gameId: string; userId: string; level: BotLevel; name?: string }): Promise<{ playerId: string }> {
  if (!isBotLevel(input.level)) throw new ServiceError("BAD_REQUEST", "unknown bot level");
  return sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireLobby(game);
    requireHost(game, input.userId);
    const seats = await seatsOf(tx as Tx, game.id);
    if (seats.length >= game.max_players) throw new ServiceError("LOBBY_FULL", "no free seat", 409);
    const seat = freeSeat(seats, game.max_players);
    const playerId = playerIdForSeat(seat);
    const name = cleanName(input.name, defaultBotName(game.id, seat, seats.map((s) => s.name)));
    await tx`insert into game_players (game_id, user_id, player_id, seat, name, color, kind, bot_level, ready, avatar)
             values (${game.id}, null, ${playerId}, ${seat}, ${name}, ${freeColor(seats)}, 'bot', ${input.level}, true, ${tx.json(defaultAvatar(game.id, seat) as unknown as JSONValue)})`;
    return { playerId };
  });
}

export async function removePlayer(sql: Db, input: { gameId: string; userId: string; playerId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireLobby(game);
    requireHost(game, input.userId);
    const seats = await seatsOf(tx as Tx, game.id);
    const target = seats.find((s) => s.player_id === input.playerId);
    if (!target) throw new ServiceError("BAD_REQUEST", "no such seat");
    if (target.user_id === input.userId) throw new ServiceError("BAD_REQUEST", "use leave-game to leave your own seat");
    await tx`delete from game_players where game_id = ${game.id} and player_id = ${input.playerId}`;
  });
}

export async function leaveGame(sql: Db, input: { gameId: string; userId: string }): Promise<{ closed: boolean }> {
  return sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireLobby(game);
    const seats = await seatsOf(tx as Tx, game.id);
    const seat = seatOfUser(seats, input.userId);
    await tx`delete from game_players where game_id = ${game.id} and player_id = ${seat.player_id}`;
    const remaining = seats.filter((s) => s.player_id !== seat.player_id);
    const humans = remaining.filter((s) => s.kind === "human").sort((a, b) => a.joined_at.getTime() - b.joined_at.getTime());
    if (humans.length === 0) {
      await tx`update games set status = 'ended', updated_at = now() where id = ${game.id}`;
      await tx`update lobbies set status = 'ended', updated_at = now() where game_id = ${game.id}`;
      return { closed: true };
    }
    if (game.host_user_id === input.userId) {
      const next = humans[0]!.user_id;
      await tx`update games set host_user_id = ${next}, updated_at = now() where id = ${game.id}`;
      await tx`update lobbies set host_user_id = ${next}, updated_at = now() where game_id = ${game.id}`;
    }
    return { closed: false };
  });
}

export async function startGame(sql: Db, input: { gameId: string; userId: string }): Promise<{ version: number }> {
  return sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireLobby(game);
    requireHost(game, input.userId);
    const seats = await seatsOf(tx as Tx, game.id);
    if (seats.length < 3) throw new ServiceError("TOO_FEW_PLAYERS", "a game needs at least 3 seats", 409);
    const unready = seats.filter((s) => s.kind === "human" && !s.ready);
    if (unready.length > 0) throw new ServiceError("NOT_READY", `${unready.map((s) => s.name).join(", ")} not ready`, 409);
    const version = await activateGame(tx as Tx, game, seats);
    return { version };
  });
}

// ---------------------------------------------------------------------------
// Escape hatches (docs/phase5.md §4)

async function convertSeatToBot(tx: Tx, game: GameRow, seats: SeatRow[], playerId: string, level: BotLevel, note: string): Promise<number> {
  await tx`update game_players set kind = 'bot', bot_level = ${level} where game_id = ${game.id} and player_id = ${playerId}`;
  const updated = seats.map((s) => (s.player_id === playerId ? { ...s, kind: "bot" as const, bot_level: level } : s));
  const state: GameState = cloneJson(game.state);
  appendNote(state, playerId, note);
  const loop = runBotLoop(state, updated);
  const version = game.version + loop.actions.length;
  for (let i = 0; i < loop.actions.length; i++) {
    const a = loop.actions[i]!;
    await tx`insert into game_actions (game_id, index, player_id, action) values (${game.id}, ${game.version + i}, ${a.playerId}, ${tx.json(a as unknown as JSONValue)})`;
  }
  await appendEvents(tx, game.id, loop.events);
  const status = loop.state.phase.kind === "ended" ? "ended" : "active";
  await tx`update games set state = ${tx.json(loop.state as unknown as JSONValue)}, version = ${version}, status = ${status}, updated_at = now() where id = ${game.id}`;
  await tx`update lobbies set status = ${status}, winner = ${loop.state.winner}, updated_at = now() where game_id = ${game.id}`;
  await refreshViews(tx, game.id, loop.state, updated, version, loop.events);
  return version;
}

/** Let a bot play for me (default medium) for the rest of the game, or until I reclaim. */
export async function handToBot(sql: Db, input: { gameId: string; userId: string; level?: BotLevel }): Promise<{ version: number }> {
  const level = input.level ?? "medium";
  if (!isBotLevel(level)) throw new ServiceError("BAD_REQUEST", "unknown bot level");
  return sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireActive(game);
    const seats = await seatsOf(tx as Tx, game.id);
    const seat = seatOfUser(seats, input.userId);
    if (seat.kind === "bot") return { version: game.version };
    const version = await convertSeatToBot(tx as Tx, game, seats, seat.player_id, level, `${seat.name} handed their seat to a bot (${level})`);
    return { version };
  });
}

export async function reclaimSeat(sql: Db, input: { gameId: string; userId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireActive(game);
    const seats = await seatsOf(tx as Tx, game.id);
    const seat = seatOfUser(seats, input.userId);
    if (seat.kind === "human") return;
    await tx`update game_players set kind = 'human', bot_level = null, last_seen_at = now() where game_id = ${game.id} and player_id = ${seat.player_id}`;
    const state: GameState = cloneJson(game.state);
    appendNote(state, seat.player_id, `${seat.name} is back at the table`);
    await tx`update games set state = ${tx.json(state as unknown as JSONValue)}, updated_at = now() where id = ${game.id}`;
    await refreshViews(tx as Tx, game.id, state, seats, game.version);
  });
}

/** Host may bot-ify a human who has been absent 10+ minutes and is the one being waited on. */
export async function botifyAbsent(
  sql: Db,
  input: { gameId: string; userId: string; playerId: string; level?: BotLevel; now?: Date },
): Promise<{ version: number }> {
  const level = input.level ?? "medium";
  const now = input.now ?? new Date();
  return sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireActive(game);
    requireHost(game, input.userId);
    const seats = await seatsOf(tx as Tx, game.id);
    const target = seats.find((s) => s.player_id === input.playerId);
    if (!target || target.kind !== "human") throw new ServiceError("BAD_REQUEST", "that seat is not a human");
    const lastSeen = target.last_seen_at ?? target.joined_at;
    if (now.getTime() - lastSeen.getTime() < ABSENT_AFTER_MS) throw new ServiceError("NOT_ABSENT", "that player was seen less than 10 minutes ago", 409);
    if (nextActor(game.state) !== target.player_id) throw new ServiceError("NOT_ABSENT", "the game is not waiting on that player", 409);
    const version = await convertSeatToBot(tx as Tx, game, seats, target.player_id, level, `${target.name} was absent; a bot (${level}) plays their seat`);
    return { version };
  });
}

export async function abandonGame(sql: Db, input: { gameId: string; userId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx as Tx, input.gameId);
    requireHost(game, input.userId);
    if (game.status === "ended") return;
    const seats = await seatsOf(tx as Tx, game.id);
    if (game.status === "active") {
      const state: GameState = cloneJson(game.state);
      state.phase = { kind: "ended" };
      appendNote(state, null, "The host ended the game");
      await tx`update games set state = ${tx.json(state as unknown as JSONValue)}, status = 'ended', updated_at = now() where id = ${game.id}`;
      await refreshViews(tx as Tx, game.id, state, seats, game.version);
    } else {
      await tx`update games set status = 'ended', updated_at = now() where id = ${game.id}`;
    }
    await tx`update lobbies set status = 'ended', updated_at = now() where game_id = ${game.id}`;
  });
}

export async function heartbeat(sql: Db, input: { gameId: string; userId: string }): Promise<void> {
  await sql`update game_players set last_seen_at = now() where game_id = ${input.gameId} and user_id = ${input.userId}`;
}
