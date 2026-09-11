import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame, legalActions, type Action, type GameState } from "@katan/engine";
import { applyActionForUser, createGameForUsers, replayCheck, runBotLoop, BOT_ACTION_CAP, type Db, type SeatRow } from "../src/index";
import { asUser, connectTestDb, createUser, resetDatabase } from "./harness";

let sql: Db;
let alice: string;
let bob: string;
let carol: string;

async function stateOf(gameId: string): Promise<{ state: GameState; version: number; status: string }> {
  const [row] = await sql<{ state: GameState; version: number; status: string }[]>`select state, version, status from games where id = ${gameId}`;
  return row!;
}

async function humansGame(seed = "apply"): Promise<string> {
  const { gameId } = await createGameForUsers(sql, {
    createdBy: alice,
    board: "beginner",
    seed,
    players: [
      { name: "Alice", color: "red", kind: "human", userId: alice },
      { name: "Bob", color: "blue", kind: "human", userId: bob },
      { name: "Carol", color: "orange", kind: "human", userId: carol },
    ],
  });
  return gameId;
}

beforeAll(async () => {
  sql = connectTestDb();
  await resetDatabase(sql);
  alice = await createUser(sql, "alice@example.com");
  bob = await createUser(sql, "bob@example.com");
  carol = await createUser(sql, "carol@example.com");
});

afterAll(async () => {
  await sql.end();
});

describe("§3.1 apply-action", () => {
  let gameId: string;
  beforeEach(async () => {
    gameId = await humansGame(`apply-${Math.random()}`);
  });

  it("a valid action advances the version, appends the log and rewrites every view", async () => {
    const { state } = await stateOf(gameId);
    const action = legalActions(state, "seat-0")[0]!;
    const result = await applyActionForUser(sql, { gameId, userId: alice, action, expectedVersion: 0 });
    expect(result).toEqual({ version: 1, applied: 1, botCapHit: false });
    const after = await stateOf(gameId);
    expect(after.version).toBe(1);
    expect(after.state.actionIndex).toBe(1);
    const log = await sql`select index, player_id from game_actions where game_id = ${gameId} order by index`;
    expect(log).toEqual([{ index: 0, player_id: "seat-0" }]);
    const views = await sql<{ player_id: string; version: number; view: { viewer: string; actionIndex: number } }[]>`select player_id, version, view from game_views where game_id = ${gameId} order by player_id`;
    expect(views.map((v) => v.version)).toEqual([1, 1, 1]);
    expect(views.map((v) => v.view.actionIndex)).toEqual([1, 1, 1]);
    // Through RLS, Bob sees exactly his own updated view.
    const bobs = await asUser(sql, bob, (tx) => tx<{ view: { viewer: string } }[]>`select view from game_views where game_id = ${gameId}`);
    expect(bobs[0]!.view.viewer).toBe("seat-1");
  });

  it("an illegal action returns the engine's RuleError code and leaves the version unchanged", async () => {
    await expect(
      applyActionForUser(sql, { gameId, userId: alice, action: { type: "ROLL", playerId: "seat-0" }, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "WRONG_PHASE" });
    await expect(
      applyActionForUser(sql, { gameId, userId: bob, action: { type: "BUILD_SETTLEMENT", playerId: "seat-1", vertex: "0,0|0,1|1,0" }, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "NOT_YOUR_TURN" });
    expect((await stateOf(gameId)).version).toBe(0);
    expect(await sql`select 1 from game_actions where game_id = ${gameId}`).toHaveLength(0);
  });

  it("a stale expectedVersion returns VERSION_CONFLICT; acting on another seat returns NOT_YOUR_SEAT", async () => {
    const { state } = await stateOf(gameId);
    const action = legalActions(state, "seat-0")[0]!;
    await expect(applyActionForUser(sql, { gameId, userId: alice, action, expectedVersion: 5 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(applyActionForUser(sql, { gameId, userId: bob, action, expectedVersion: 0 })).rejects.toMatchObject({ code: "NOT_YOUR_SEAT" });
    await expect(applyActionForUser(sql, { gameId, userId: "00000000-0000-0000-0000-000000000000", action, expectedVersion: 0 })).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
  });

  it("two concurrent valid submissions: exactly one succeeds", async () => {
    const { state } = await stateOf(gameId);
    const legal = legalActions(state, "seat-0");
    const results = await Promise.allSettled([
      applyActionForUser(sql, { gameId, userId: alice, action: legal[0]!, expectedVersion: 0 }),
      applyActionForUser(sql, { gameId, userId: alice, action: legal[1]!, expectedVersion: 0 }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as { code: string }).code).toBe("VERSION_CONFLICT");
    expect((await stateOf(gameId)).version).toBe(1);
  });

  it("actions on an ended game are refused", async () => {
    await sql`update games set status = 'ended' where id = ${gameId}`;
    const { state } = await stateOf(gameId);
    await expect(applyActionForUser(sql, { gameId, userId: alice, action: legalActions(state, "seat-0")[0]!, expectedVersion: 0 })).rejects.toMatchObject({ code: "GAME_NOT_ACTIVE" });
  });
});

describe("§3.1 bot loop (docs/phase5.md §6.2)", () => {
  it("bots play until a human must act, and their actions are logged with the human's", async () => {
    const { gameId, version } = await createGameForUsers(sql, {
      createdBy: alice,
      board: "random",
      seed: "bots-in-game",
      players: [
        { name: "Bot A", color: "red", kind: "bot", level: "easy" },
        { name: "Alice", color: "blue", kind: "human", userId: alice },
        { name: "Bot B", color: "orange", kind: "bot", level: "medium" },
        { name: "Bot C", color: "white", kind: "bot", level: "hard" },
      ],
    });
    // Seat 0 is a bot: it has already placed its first settlement and road at creation.
    expect(version).toBe(2);
    const { state } = await stateOf(gameId);
    expect(state.currentPlayer).toBe(1);
    const action = legalActions(state, "seat-1")[0]!;
    const result = await applyActionForUser(sql, { gameId, userId: alice, action, expectedVersion: 2 });
    // Alice's settlement, then bots B and C place twice each (4 actions) plus B/C... until Alice's road? No:
    // after her settlement the next actor is Alice again (her road), so only one action applies.
    expect(result.applied).toBe(1);
    const road = legalActions((await stateOf(gameId)).state, "seat-1")[0]!;
    const r2 = await applyActionForUser(sql, { gameId, userId: alice, action: road, expectedVersion: result.version });
    // Alice's road, then C and D... seats 2 and 3 place (2 actions each), then seat 3 and 2 again (round 2), then Alice.
    expect(r2.applied).toBe(1 + 4 + 4);
    expect(r2.botCapHit).toBe(false);
    const after = await stateOf(gameId);
    expect(after.version).toBe(r2.version);
    expect(after.state.phase).toMatchObject({ kind: "setup", round: 2 });
    expect(after.state.currentPlayer).toBe(1);
    const log = await sql<{ index: number; player_id: string }[]>`select index, player_id from game_actions where game_id = ${gameId} order by index`;
    expect(log.length).toBe(after.version);
    expect(log.map((l) => l.index)).toEqual(log.map((_, i) => i));
  });

  it("the loop is capped and reports it", () => {
    const seats: SeatRow[] = ["seat-0", "seat-1", "seat-2", "seat-3"].map((id, seat) => ({
      game_id: "g",
      user_id: null,
      player_id: id,
      seat,
      name: id,
      color: "red",
      kind: "bot",
      ready: true,
      bot_level: "easy",
      last_seen_at: null,
      joined_at: new Date(),
    }));
    const state = createGame({ seed: "cap", players: seats.map((s) => ({ id: s.player_id, name: s.name })), board: "random" });
    const capped = runBotLoop(state, seats, 10);
    expect(capped.actions).toHaveLength(10);
    expect(capped.hitCap).toBe(true);
    const full = runBotLoop(state, seats, BOT_ACTION_CAP);
    expect(full.hitCap).toBe(full.actions.length >= BOT_ACTION_CAP);
  });
});

describe("§3.3 replay-check", () => {
  it("rebuilding from seed + action log equals the stored state after a scripted 20-action game", async () => {
    const gameId = await humansGame("replay-20");
    const users = { "seat-0": alice, "seat-1": bob, "seat-2": carol } as const;
    for (let i = 0; i < 20; i++) {
      const { state, version } = await stateOf(gameId);
      const actor = state.players[state.currentPlayer]!.id as keyof typeof users;
      const legal = legalActions(state, actor);
      const action: Action = legal.find((a) => a.type !== "END_TURN" && a.type !== "OFFER_TRADE") ?? legal[0]!;
      await applyActionForUser(sql, { gameId, userId: users[actor], action, expectedVersion: version });
    }
    const check = await replayCheck(sql, gameId);
    expect(check).toMatchObject({ equal: true, version: 20, actions: 20, difference: null });
    // Corrupt the stored state: the check notices.
    await sql`update games set state = jsonb_set(state, '{turn}', '99') where id = ${gameId}`;
    const broken = await replayCheck(sql, gameId);
    expect(broken.equal).toBe(false);
    expect(broken.difference).toContain("turn");
  });
});
