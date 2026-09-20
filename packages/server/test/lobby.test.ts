import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legalActions, nextActor, type GameState } from "@katan/engine";
import {
  CODE_ALPHABET,
  abandonGame,
  addBot,
  applyActionForUser,
  botifyAbsent,
  createLobby,
  generateJoinCode,
  handToBot,
  joinGame,
  leaveGame,
  reclaimSeat,
  removePlayer,
  sendChat,
  setReady,
  setSeat,
  startGame,
  type Db,
} from "../src/index";
import { asUser, connectTestDb, createUser, pgErrorCode, resetDatabase } from "./harness";

let sql: Db;
let host: string;
let bob: string;
let carol: string;
let dave: string;

beforeAll(async () => {
  sql = connectTestDb();
  await resetDatabase(sql);
  host = await createUser(sql, "host@example.com", "Host");
  bob = await createUser(sql, "bob@example.com", "Bob");
  carol = await createUser(sql, "carol@example.com", "Carol");
  dave = await createUser(sql, "dave@example.com", "Dave");
});

afterAll(async () => {
  await sql.end();
});

async function lobbyWith(...joiners: string[]): Promise<{ gameId: string; joinCode: string }> {
  const lobby = await createLobby(sql, { hostUserId: host, name: "Host", board: "beginner", maxPlayers: 4 });
  for (const u of joiners) await joinGame(sql, { code: lobby.joinCode, userId: u, name: u.slice(0, 4) });
  return lobby;
}

async function game(gameId: string): Promise<{ status: string; state: GameState; version: number; host_user_id: string | null; join_code: string | null }> {
  const [row] = await sql<{ status: string; state: GameState; version: number; host_user_id: string | null; join_code: string | null }[]>`select status, state, version, host_user_id, join_code from games where id = ${gameId}`;
  return row!;
}

describe("docs/phase7.md §4 §5 seats carry portraits and bots get medieval names", () => {
  it("every seat gets an avatar, bots a generated name, and the host can rename a bot", async () => {
    const { gameId } = await lobbyWith(bob);
    await addBot(sql, { gameId, userId: host, level: "easy" });
    await addBot(sql, { gameId, userId: host, level: "hard" });
    const seats = await sql<{ player_id: string; name: string; kind: string; avatar: Record<string, number> | null }[]>`select player_id, name, kind, avatar from game_players where game_id = ${gameId} order by seat`;
    expect(seats).toHaveLength(4);
    for (const s of seats) {
      expect(s.avatar).not.toBeNull();
      expect(typeof s.avatar!.hair).toBe("number");
    }
    const bots = seats.filter((s) => s.kind === "bot");
    expect(bots.map((b) => b.name)).not.toContain("Bot (easy)");
    for (const b of bots) expect(b.name).not.toMatch(/easy|hard|bot/i);
    expect(new Set(bots.map((b) => b.name)).size).toBe(2);
    // Distinct portraits per seat.
    expect(new Set(seats.map((s) => JSON.stringify(s.avatar))).size).toBe(4);
    // Own avatar can be changed; a malformed one is refused; the host renames a bot.
    const spec = { skin: 1, face: 2, eyes: 3, brows: 0, mouth: 1, hair: 4, hairColor: 5, facialHair: 0, headwear: 6, garment: 2, accessory: 3 };
    await setSeat(sql, { gameId, userId: bob, avatar: spec });
    const [bobRow] = await sql<{ avatar: unknown }[]>`select avatar from game_players where game_id = ${gameId} and user_id = ${bob}`;
    expect(bobRow!.avatar).toEqual(spec);
    await expect(setSeat(sql, { gameId, userId: bob, avatar: { skin: 99 } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await setSeat(sql, { gameId, userId: host, playerId: bots[0]!.player_id, name: "Sir Reginald" });
    const [renamed] = await sql<{ name: string }[]>`select name from game_players where game_id = ${gameId} and player_id = ${bots[0]!.player_id}`;
    expect(renamed!.name).toBe("Sir Reginald");
    await expect(setSeat(sql, { gameId, userId: bob, playerId: bots[0]!.player_id, name: "Nope" })).rejects.toMatchObject({ code: "NOT_HOST" });
  });
});

describe("§1 lobby", () => {
  it("join codes use the safe alphabet and are unique among non-ended games", async () => {
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[01OI]/);
    }
    const a = await createLobby(sql, { hostUserId: host, name: "Host", board: "random", maxPlayers: 3 });
    // A live game with the same code is refused by the partial unique index...
    expect(await pgErrorCode(() => sql`insert into games (seed, state, status, created_by, join_code) values ('s', '{}', 'lobby', ${host}, ${a.joinCode})`)).toBe("23505");
    // ...but once the game has ended the code may be reused.
    await sql`update games set status = 'ended' where id = ${a.gameId}`;
    expect(await pgErrorCode(() => sql`insert into games (seed, state, status, created_by, join_code) values ('s', '{}', 'lobby', ${host}, ${a.joinCode})`)).toBeNull();
    // createLobby retries on a collision: force the generator to repeat a live code first.
    const b = await createLobby(sql, { hostUserId: host, name: "Host", board: "random", maxPlayers: 3 });
    let calls = 0;
    const fixed = b.joinCode.split("").map((ch) => CODE_ALPHABET.indexOf(ch) / CODE_ALPHABET.length + 1e-9);
    const c = await createLobby(sql, {
      hostUserId: bob,
      name: "Bob",
      board: "random",
      maxPlayers: 3,
      random: () => {
        // First 6 draws reproduce b's code (collision), later draws differ.
        const v = calls < 6 ? fixed[calls]! : ((calls * 7919) % 97) / 97;
        calls++;
        return v;
      },
    });
    expect(c.joinCode).not.toBe(b.joinCode);
    expect(calls).toBeGreaterThan(6);
  });

  it("joining seats the next free seat with a free colour; the host is seat 0", async () => {
    const { gameId, joinCode } = await lobbyWith(bob, carol);
    const seats = await sql<{ player_id: string; seat: number; color: string; kind: string; ready: boolean }[]>`select player_id, seat, color, kind, ready from game_players where game_id = ${gameId} order by seat`;
    expect(seats.map((s) => [s.seat, s.color, s.ready])).toEqual([
      [0, "red", false],
      [1, "blue", false],
      [2, "orange", false],
    ]);
    // Rejoining with the same code is idempotent.
    const again = await joinGame(sql, { code: joinCode.toLowerCase(), userId: bob, name: "Bob" });
    expect(again.playerId).toBe("seat-1");
    // Members see the lobby projection; a stranger with the code gets in via join, not via select.
    expect(await asUser(sql, dave, (tx) => tx`select * from lobby_games where id = ${gameId}`)).toHaveLength(0);
    await expect(joinGame(sql, { code: "ZZZZZZ", userId: dave, name: "Dave" })).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("cannot join a full or an active game", async () => {
    const { gameId, joinCode } = await lobbyWith(bob, carol, dave);
    const eve = await createUser(sql, "eve@example.com");
    await expect(joinGame(sql, { code: joinCode, userId: eve, name: "Eve" })).rejects.toMatchObject({ code: "LOBBY_FULL" });
    for (const u of [host, bob, carol, dave]) await setReady(sql, { gameId, userId: u, ready: true });
    await startGame(sql, { gameId, userId: host });
    const three = await createLobby(sql, { hostUserId: host, name: "Host", board: "beginner", maxPlayers: 3 });
    await joinGame(sql, { code: three.joinCode, userId: bob, name: "Bob" });
    await joinGame(sql, { code: three.joinCode, userId: carol, name: "Carol" });
    for (const u of [host, bob, carol]) await setReady(sql, { gameId: three.gameId, userId: u, ready: true });
    await startGame(sql, { gameId: three.gameId, userId: host });
    await expect(joinGame(sql, { code: three.joinCode, userId: dave, name: "Dave" })).rejects.toMatchObject({ code: "GAME_NOT_ACTIVE" });
    expect((await game(three.gameId)).status).toBe("active");
  });

  it("start needs 3+ seats, every human ready, and the host", async () => {
    const { gameId } = await lobbyWith(bob);
    await expect(startGame(sql, { gameId, userId: host })).rejects.toMatchObject({ code: "TOO_FEW_PLAYERS" });
    await addBot(sql, { gameId, userId: host, level: "easy" });
    await expect(startGame(sql, { gameId, userId: host })).rejects.toMatchObject({ code: "NOT_READY" });
    await expect(addBot(sql, { gameId, userId: bob, level: "easy" })).rejects.toMatchObject({ code: "NOT_HOST" });
    await setReady(sql, { gameId, userId: host, ready: true });
    await setReady(sql, { gameId, userId: bob, ready: true });
    await expect(startGame(sql, { gameId, userId: bob })).rejects.toMatchObject({ code: "NOT_HOST" });
    const { version } = await startGame(sql, { gameId, userId: host });
    const g = await game(gameId);
    expect(g.status).toBe("active");
    expect(g.state.players.slice(0, 2).map((p) => p.name)).toEqual(["Host", bob.slice(0, 4)]);
    expect(g.state.players[2]!.name).not.toMatch(/bot/i); // docs/phase7.md §5: generated medieval name
    expect(g.state.players.map((p) => p.color)).toEqual(["red", "blue", "orange"]);
    expect(version).toBe(0); // seat 0 is human, so no bot moved yet
    const views = await sql`select player_id from game_views where game_id = ${gameId}`;
    expect(views).toHaveLength(3);
    await expect(startGame(sql, { gameId, userId: host })).rejects.toMatchObject({ code: "GAME_NOT_ACTIVE" });
  });

  it("seat edits: colour must be free, names are trimmed, bots can be removed by the host only", async () => {
    const { gameId } = await lobbyWith(bob);
    await setSeat(sql, { gameId, userId: bob, color: "white", name: "  Bobby  " });
    await expect(setSeat(sql, { gameId, userId: bob, color: "red" })).rejects.toMatchObject({ code: "COLOR_TAKEN" });
    const { playerId } = await addBot(sql, { gameId, userId: host, level: "hard", name: "Deep Blue" });
    await expect(removePlayer(sql, { gameId, userId: bob, playerId })).rejects.toMatchObject({ code: "NOT_HOST" });
    await removePlayer(sql, { gameId, userId: host, playerId });
    const seats = await sql<{ name: string; color: string }[]>`select name, color from game_players where game_id = ${gameId} order by seat`;
    expect(seats).toEqual([
      { name: "Host", color: "red" },
      { name: "Bobby", color: "white" },
    ]);
  });

  it("leaving frees the seat; the earliest-joined human becomes host; an empty lobby ends", async () => {
    const { gameId } = await lobbyWith(bob, carol);
    await leaveGame(sql, { gameId, userId: host });
    expect((await game(gameId)).host_user_id).toBe(bob);
    const seats = await sql<{ seat: number }[]>`select seat from game_players where game_id = ${gameId} order by seat`;
    expect(seats.map((s) => s.seat)).toEqual([1, 2]);
    // Seat 0 is free again for the next joiner.
    const { joinCode } = { joinCode: (await game(gameId)).join_code! };
    const back = await joinGame(sql, { code: joinCode, userId: host, name: "Host" });
    expect(back.playerId).toBe("seat-0");
    await leaveGame(sql, { gameId, userId: host });
    await leaveGame(sql, { gameId, userId: bob });
    expect((await game(gameId)).host_user_id).toBe(carol);
    const { closed } = await leaveGame(sql, { gameId, userId: carol });
    expect(closed).toBe(true);
    expect((await game(gameId)).status).toBe("ended");
  });
});

describe("§4 escape hatches", () => {
  async function activeGame(): Promise<string> {
    const { gameId } = await lobbyWith(bob, carol);
    for (const u of [host, bob, carol]) await setReady(sql, { gameId, userId: u, ready: true });
    await startGame(sql, { gameId, userId: host });
    return gameId;
  }

  it("docs/phase12.md §3 chat: a member posts a line that every member can read and an outsider cannot; blanks and novels are refused", async () => {
    const gameId = await activeGame();
    const line = await sendChat(sql, { gameId, userId: bob, text: "  good   luck  " });
    expect(line).toMatchObject({ game_id: gameId, player_id: "seat-1", text: "good luck" });
    expect(await asUser(sql, carol, (tx) => tx`select player_id, text from game_chat where game_id = ${gameId}`)).toEqual([{ player_id: "seat-1", text: "good luck" }]);
    expect(await asUser(sql, dave, (tx) => tx`select id from game_chat where game_id = ${gameId}`)).toHaveLength(0);
    await expect(sendChat(sql, { gameId, userId: dave, text: "hi" })).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
    await expect(sendChat(sql, { gameId, userId: bob, text: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(sendChat(sql, { gameId, userId: bob, text: "x".repeat(401) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // No client writes: an authenticated member cannot insert directly.
    expect(await pgErrorCode(() => asUser(sql, bob, (tx) => tx`insert into game_chat (game_id, player_id, text) values (${gameId}, 'seat-1', 'sneaky')`))).toBe("42501");
  });

  it("a player can hand their seat to a bot, which plays immediately, and reclaim it later", async () => {
    const gameId = await activeGame();
    const before = await game(gameId);
    expect(nextActor(before.state)).toBe("seat-0");
    const { version } = await handToBot(sql, { gameId, userId: host, level: "easy" });
    // The bot placed the host's settlement and road: two actions, now waiting on Bob.
    expect(version).toBe(2);
    const mid = await game(gameId);
    expect(nextActor(mid.state)).toBe("seat-1");
    expect(mid.state.log.some((l) => l.text.includes("handed their seat to a bot"))).toBe(true);
    const seat = await sql<{ kind: string; bot_level: string | null; user_id: string | null }[]>`select kind, bot_level, user_id from game_players where game_id = ${gameId} and player_id = 'seat-0'`;
    expect(seat[0]).toEqual({ kind: "bot", bot_level: "easy", user_id: host });
    // While a bot holds the seat, the human cannot act for it.
    const bobAction = legalActions(mid.state, "seat-1")[0]!;
    await applyActionForUser(sql, { gameId, userId: bob, action: bobAction, expectedVersion: 2 });
    await reclaimSeat(sql, { gameId, userId: host });
    const after = await sql<{ kind: string; bot_level: string | null }[]>`select kind, bot_level from game_players where game_id = ${gameId} and player_id = 'seat-0'`;
    expect(after[0]).toEqual({ kind: "human", bot_level: null });
    // The host still reads their own view through RLS.
    expect(await asUser(sql, host, (tx) => tx`select player_id from game_views where game_id = ${gameId}`)).toHaveLength(1);
  });

  it("the host can bot-ify an absent player only when they are absent 10+ minutes and being waited on", async () => {
    const gameId = await activeGame();
    const now = new Date("2030-01-01T12:00:00Z");
    // Seat 0 (host) is being waited on, but bob is not.
    await expect(botifyAbsent(sql, { gameId, userId: host, playerId: "seat-1", now })).rejects.toMatchObject({ code: "NOT_ABSENT" });
    await expect(botifyAbsent(sql, { gameId, userId: bob, playerId: "seat-0", now })).rejects.toMatchObject({ code: "NOT_HOST" });
    // Host places, so Bob is next; Bob was seen just now.
    const s = (await game(gameId)).state;
    await applyActionForUser(sql, { gameId, userId: host, action: legalActions(s, "seat-0")[0]!, expectedVersion: 0 });
    const s2 = (await game(gameId)).state;
    await applyActionForUser(sql, { gameId, userId: host, action: legalActions(s2, "seat-0")[0]!, expectedVersion: 1 });
    expect(nextActor((await game(gameId)).state)).toBe("seat-1");
    await sql`update game_players set last_seen_at = now() where game_id = ${gameId} and player_id = 'seat-1'`;
    await expect(botifyAbsent(sql, { gameId, userId: host, playerId: "seat-1" })).rejects.toMatchObject({ code: "NOT_ABSENT" });
    await sql`update game_players set last_seen_at = now() - interval '11 minutes' where game_id = ${gameId} and player_id = 'seat-1'`;
    const { version } = await botifyAbsent(sql, { gameId, userId: host, playerId: "seat-1" });
    expect(version).toBeGreaterThan(2);
  });

  it("docs/phase5.md §4 the host picks the absent threshold per lobby (2–30 minutes), and the lobby projection exposes it", async () => {
    await expect(createLobby(sql, { hostUserId: host, name: "Host", board: "beginner", maxPlayers: 4, absentMinutes: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const lobby = await createLobby(sql, { hostUserId: host, name: "Host", board: "beginner", maxPlayers: 4, absentMinutes: 2 });
    for (const u of [bob, carol]) await joinGame(sql, { code: lobby.joinCode, userId: u, name: u.slice(0, 4) });
    const gameId = lobby.gameId;
    expect(await asUser(sql, bob, (tx) => tx`select absent_after_ms from lobby_games where id = ${gameId}`)).toEqual([{ absent_after_ms: 120000 }]);
    for (const u of [host, bob, carol]) await setReady(sql, { gameId, userId: u, ready: true });
    await startGame(sql, { gameId, userId: host });
    const s = (await game(gameId)).state;
    await applyActionForUser(sql, { gameId, userId: host, action: legalActions(s, "seat-0")[0]!, expectedVersion: 0 });
    const s2 = (await game(gameId)).state;
    await applyActionForUser(sql, { gameId, userId: host, action: legalActions(s2, "seat-0")[0]!, expectedVersion: 1 });
    expect(nextActor((await game(gameId)).state)).toBe("seat-1");
    await sql`update game_players set last_seen_at = now() - interval '3 minutes' where game_id = ${gameId} and player_id = 'seat-1'`;
    const { version } = await botifyAbsent(sql, { gameId, userId: host, playerId: "seat-1" });
    expect(version).toBeGreaterThan(2);
    const g = await game(gameId);
    expect(g.state.log.some((l) => l.text.includes("was absent"))).toBe(true);
    expect(nextActor(g.state)).not.toBe("seat-1");
  });

  it("the host can abandon a game: it ends with no winner and everyone's view says so", async () => {
    const gameId = await activeGame();
    await expect(abandonGame(sql, { gameId, userId: bob })).rejects.toMatchObject({ code: "NOT_HOST" });
    await abandonGame(sql, { gameId, userId: host });
    const g = await game(gameId);
    expect(g.status).toBe("ended");
    expect(g.state.phase).toEqual({ kind: "ended" });
    expect(g.state.winner).toBeNull();
    const [v] = await asUser(sql, carol, (tx) => tx<{ view: { phase: { kind: string }; winner: string | null } }[]>`select view from game_views where game_id = ${gameId}`);
    expect(v!.view.phase.kind).toBe("ended");
    expect(v!.view.winner).toBeNull();
    const [lobby] = await asUser(sql, carol, (tx) => tx<{ status: string }[]>`select status from lobby_games where id = ${gameId}`);
    expect(lobby!.status).toBe("ended");
  });
});
