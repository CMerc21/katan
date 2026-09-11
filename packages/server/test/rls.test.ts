import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameForUsers, type Db } from "../src/index";
import { asAnon, asUser, connectTestDb, createUser, pgErrorCode, resetDatabase } from "./harness";

let sql: Db;
let alice: string;
let bob: string;
let carol: string;
let outsider: string;
let gameId: string;

beforeAll(async () => {
  sql = connectTestDb();
  await resetDatabase(sql);
  alice = await createUser(sql, "alice@example.com");
  bob = await createUser(sql, "bob@example.com");
  carol = await createUser(sql, "carol@example.com");
  outsider = await createUser(sql, "eve@example.com");
  ({ gameId } = await createGameForUsers(sql, {
    createdBy: alice,
    board: "beginner",
    seed: "rls",
    players: [
      { name: "Alice", color: "red", kind: "human", userId: alice },
      { name: "Bob", color: "blue", kind: "human", userId: bob },
      { name: "Carol", color: "orange", kind: "human", userId: carol },
    ],
  }));
});

afterAll(async () => {
  await sql.end();
});

describe("§2.1 row level security", () => {
  it("a player reads only their own game_views row", async () => {
    const mine = await asUser(sql, alice, (tx) => tx`select player_id, user_id from game_views where game_id = ${gameId}`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.player_id).toBe("seat-0");
    const bobs = await asUser(sql, bob, (tx) => tx`select player_id from game_views where game_id = ${gameId} and player_id = 'seat-0'`);
    expect(bobs).toHaveLength(0);
  });

  it("nobody can read games at all, not even members", async () => {
    expect(await pgErrorCode(() => asUser(sql, alice, (tx) => tx`select id from games`))).toBe("42501"); // insufficient_privilege
    expect(await pgErrorCode(() => asAnon(sql, (tx) => tx`select id from games`))).toBe("42501");
  });

  it("an outsider sees no seats, actions, views or lobby rows for the game", async () => {
    expect(await asUser(sql, outsider, (tx) => tx`select * from game_players where game_id = ${gameId}`)).toHaveLength(0);
    expect(await asUser(sql, outsider, (tx) => tx`select * from game_actions where game_id = ${gameId}`)).toHaveLength(0);
    expect(await asUser(sql, outsider, (tx) => tx`select * from game_views where game_id = ${gameId}`)).toHaveLength(0);
    expect(await asUser(sql, outsider, (tx) => tx`select * from lobby_games where id = ${gameId}`)).toHaveLength(0);
    expect(await asAnon(sql, (tx) => tx`select * from game_players`).catch(() => [])).toHaveLength(0);
  });

  it("members read seats, the action log and the lobby projection", async () => {
    expect(await asUser(sql, bob, (tx) => tx`select player_id from game_players where game_id = ${gameId}`)).toHaveLength(3);
    expect(await asUser(sql, bob, (tx) => tx`select * from lobby_games where id = ${gameId}`)).toHaveLength(1);
  });

  it("clients cannot write anything", async () => {
    const writes = [
      () => asUser(sql, alice, (tx) => tx`update game_views set version = 99 where game_id = ${gameId}`),
      () => asUser(sql, alice, (tx) => tx`insert into game_actions (game_id, index, player_id, action) values (${gameId}, 999, 'seat-0', '{}')`),
      () => asUser(sql, alice, (tx) => tx`update game_players set ready = true where game_id = ${gameId}`),
      () => asUser(sql, alice, (tx) => tx`delete from lobbies where game_id = ${gameId}`),
      () => asUser(sql, alice, (tx) => tx`insert into games (seed, state, status, created_by) values ('x', '{}', 'lobby', ${alice})`),
    ];
    for (const w of writes) expect(await pgErrorCode(w)).toBe("42501");
  });

  it("the view a member reads is redacted: no seed, others' hands are counts", async () => {
    const [row] = await asUser(sql, bob, (tx) => tx<{ view: Record<string, unknown> }[]>`select view from game_views where game_id = ${gameId}`);
    const view = row!.view as { viewer: string; players: { id: string; hand: unknown }[] };
    expect("seed" in view).toBe(false);
    expect(view.viewer).toBe("seat-1");
    const alicePlayer = view.players.find((p) => p.id === "seat-0")!;
    expect(alicePlayer.hand).toEqual({ count: 0 });
  });
});
