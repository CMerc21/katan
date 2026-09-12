import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtInBoard, builtInScenario, type GameState } from "@katan/engine";
import { createLobby, deleteBoard, deleteScenario, forkBoard, forkScenario, joinGame, saveBoard, saveScenario, setReady, startGame, type Db } from "../src/index";
import { asUser, connectTestDb, createUser, resetDatabase } from "./harness";

let sql: Db;
let host: string;
let bob: string;
let carol: string;

beforeAll(async () => {
  sql = connectTestDb();
  await resetDatabase(sql);
  host = await createUser(sql, "host-b@example.com", "Host");
  bob = await createUser(sql, "bob-b@example.com", "Bob");
  carol = await createUser(sql, "carol-b@example.com", "Carol");
});

afterAll(async () => {
  await sql.end();
});

async function stateOf(gameId: string): Promise<GameState> {
  const [row] = await sql<{ state: GameState }[]>`select state from games where id = ${gameId}`;
  return row!.state;
}

describe("docs/phase8.md §4.3 saved boards", () => {
  it("saves, updates, forks and deletes with ownership; RLS shows own and public boards only", async () => {
    const def = builtInBoard("large");
    const { boardId } = await saveBoard(sql, { userId: host, definition: { ...def, name: "My large" } });
    await expect(saveBoard(sql, { userId: bob, boardId, definition: def })).rejects.toMatchObject({ code: "NOT_OWNER" });
    await expect(saveBoard(sql, { userId: host, boardId: "00000000-0000-0000-0000-000000000000", definition: def })).rejects.toMatchObject({ code: "BOARD_NOT_FOUND" });
    await expect(saveBoard(sql, { userId: host, definition: { ...def, hexes: def.hexes.slice(0, 3) } })).rejects.toMatchObject({ code: "INVALID_BOARD" });
    await expect(saveBoard(sql, { userId: host, definition: { nope: true } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Private: bob cannot see it; public: he can, and can fork but not delete.
    expect(await asUser(sql, bob, (tx) => tx`select id from boards where id = ${boardId}`)).toHaveLength(0);
    await expect(forkBoard(sql, { userId: bob, boardId })).rejects.toMatchObject({ code: "BOARD_NOT_FOUND" });
    await saveBoard(sql, { userId: host, boardId, definition: def, name: "Shared large", isPublic: true });
    expect(await asUser(sql, bob, (tx) => tx<{ name: string }[]>`select name from boards where id = ${boardId}`)).toEqual([{ name: "Shared large" }]);
    const fork = await forkBoard(sql, { userId: bob, boardId });
    const [forked] = await sql<{ owner_id: string; name: string; forked_from: string; is_public: boolean }[]>`select owner_id, name, forked_from, is_public from boards where id = ${fork.boardId}`;
    expect(forked).toEqual({ owner_id: bob, name: "Shared large (copy)", forked_from: boardId, is_public: false });
    await expect(deleteBoard(sql, { userId: bob, boardId })).rejects.toMatchObject({ code: "NOT_OWNER" });
    await deleteBoard(sql, { userId: host, boardId });
    expect(await sql`select id from boards where id = ${boardId}`).toHaveLength(0);
    // The fork survives with its origin cleared.
    const [after] = await sql<{ forked_from: string | null }[]>`select forked_from from boards where id = ${fork.boardId}`;
    expect(after).toEqual({ forked_from: null });
  });

  it("a lobby on a saved board, a built-in frame or an inline draft snapshots the definition and caps the seats", async () => {
    const { boardId } = await saveBoard(sql, { userId: host, definition: { ...builtInBoard("ring"), name: "Ring of mine" } });
    const lobby = await createLobby(sql, { hostUserId: host, name: "Host", board: { boardId }, maxPlayers: 5 });
    const [row] = await sql<{ board: string; board_definition: { name: string } | null; board_name: string }[]>`select g.board, g.board_definition, l.board_name from games g join lobbies l on l.game_id = g.id where g.id = ${lobby.gameId}`;
    expect(row).toMatchObject({ board: "custom", board_name: "Ring of mine" });
    expect(row!.board_definition?.name).toBe("Ring of mine");
    await expect(createLobby(sql, { hostUserId: host, name: "Host", board: "large", maxPlayers: 6 })).resolves.toBeTruthy();
    await expect(createLobby(sql, { hostUserId: host, name: "Host", board: "random", maxPlayers: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(createLobby(sql, { hostUserId: bob, name: "Bob", board: { boardId }, maxPlayers: 4 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // private
    await expect(createLobby(sql, { hostUserId: host, name: "Host", board: { definition: { ...builtInBoard("random"), hexes: [] } }, maxPlayers: 4 })).rejects.toMatchObject({ code: "INVALID_BOARD" });
    const draft = await createLobby(sql, { hostUserId: host, name: "Host", board: { definition: { ...builtInBoard("longStrip"), name: "Draft strip" } }, maxPlayers: 4 });
    await joinGame(sql, { code: draft.joinCode, userId: bob, name: "Bob" });
    await joinGame(sql, { code: draft.joinCode, userId: carol, name: "Carol" });
    for (const u of [host, bob, carol]) await setReady(sql, { gameId: draft.gameId, userId: u, ready: true });
    await startGame(sql, { gameId: draft.gameId, userId: host });
    const state = await stateOf(draft.gameId);
    expect(state.boardKind).toBe("custom");
    expect(state.board.name).toBe("Draft strip");
    expect(Object.keys(state.board.hexes)).toHaveLength(21);
  });
});

describe("docs/phase9.md §5 saved scenarios", () => {
  it("saves, forks and deletes scenarios with ownership and validation", async () => {
    const scenario = builtInScenario("archipelago");
    const { scenarioId } = await saveScenario(sql, { userId: host, definition: { ...scenario, name: "My isles" } });
    const [row] = await sql<{ definition: { id: string; name: string; modules: { tides: boolean } } }[]>`select definition from scenarios where id = ${scenarioId}`;
    expect(row!.definition.id).toBe(scenarioId);
    expect(row!.definition.name).toBe("My isles");
    expect(row!.definition.modules.tides).toBe(true);
    await expect(saveScenario(sql, { userId: host, definition: { ...scenario, victoryPoints: 99 } })).rejects.toMatchObject({ code: "INVALID_SCENARIO" });
    await expect(saveScenario(sql, { userId: host, definition: { ...scenario, setup: "mainIslandOnly", mainIsland: 9 } })).rejects.toMatchObject({ code: "INVALID_SCENARIO" });
    await expect(saveScenario(sql, { userId: host, definition: { id: "x" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(saveScenario(sql, { userId: bob, scenarioId, definition: scenario })).rejects.toMatchObject({ code: "NOT_OWNER" });
    await expect(forkScenario(sql, { userId: bob, scenarioId })).rejects.toMatchObject({ code: "SCENARIO_NOT_FOUND" });
    await saveScenario(sql, { userId: host, scenarioId, definition: scenario, name: "Public isles", isPublic: true });
    expect(await asUser(sql, bob, (tx) => tx<{ name: string }[]>`select name from scenarios where id = ${scenarioId}`)).toEqual([{ name: "Public isles" }]);
    const fork = await forkScenario(sql, { userId: bob, scenarioId });
    const [forked] = await sql<{ owner_id: string; name: string; forked_from: string; definition: { id: string } }[]>`select owner_id, name, forked_from, definition from scenarios where id = ${fork.scenarioId}`;
    expect(forked).toMatchObject({ owner_id: bob, name: "Public isles (copy)", forked_from: scenarioId });
    expect(forked!.definition.id).toBe(fork.scenarioId);
    await expect(deleteScenario(sql, { userId: bob, scenarioId })).rejects.toMatchObject({ code: "NOT_OWNER" });
    await deleteScenario(sql, { userId: host, scenarioId });
    expect(await sql`select id from scenarios where id = ${scenarioId}`).toHaveLength(0);
  });

  it("a lobby on a built-in, saved or inline scenario starts a Tides game with the scenario snapshotted", async () => {
    const lobby = await createLobby(sql, { hostUserId: host, name: "Host", board: "goldCoast", maxPlayers: 4 });
    const [row] = await sql<{ board: string; scenario: { id: string } | null; board_name: string }[]>`select g.board, g.scenario, l.board_name from games g join lobbies l on l.game_id = g.id where g.id = ${lobby.gameId}`;
    expect(row).toMatchObject({ board: "custom", board_name: "Gold Coast" });
    expect(row!.scenario?.id).toBe("goldCoast");
    await joinGame(sql, { code: lobby.joinCode, userId: bob, name: "Bob" });
    await joinGame(sql, { code: lobby.joinCode, userId: carol, name: "Carol" });
    for (const u of [host, bob, carol]) await setReady(sql, { gameId: lobby.gameId, userId: u, ready: true });
    await startGame(sql, { gameId: lobby.gameId, userId: host });
    const state = await stateOf(lobby.gameId);
    expect(state.scenario).toMatchObject({ id: "goldCoast", tides: true, pirate: true, victoryPoints: 11 });
    expect(state.board.seaPlayable).toBe(true);
    expect(state.pirateHex).not.toBeNull();
    // Saved scenario by id; inline scenario; bad ones refused.
    const { scenarioId } = await saveScenario(sql, { userId: host, definition: builtInScenario("archipelago"), isPublic: true });
    const saved = await createLobby(sql, { hostUserId: bob, name: "Bob", board: { scenarioId }, maxPlayers: 4 });
    const [savedRow] = await sql<{ scenario: { id: string; name: string } }[]>`select scenario from games where id = ${saved.gameId}`;
    expect(savedRow!.scenario.id).toBe(scenarioId);
    await expect(createLobby(sql, { hostUserId: host, name: "Host", board: { scenario: { ...builtInScenario("acrossTheStrait"), victoryPoints: 1 } }, maxPlayers: 4 })).rejects.toMatchObject({ code: "INVALID_SCENARIO" });
    await expect(createLobby(sql, { hostUserId: host, name: "Host", board: { scenarioId: "00000000-0000-0000-0000-000000000000" }, maxPlayers: 4 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const inline = await createLobby(sql, { hostUserId: host, name: "Host", board: { scenario: builtInScenario("acrossTheStrait") }, maxPlayers: 4 });
    const [inlineRow] = await sql<{ scenario: { id: string }; board_definition: { name: string } }[]>`select scenario, board_definition from games where id = ${inline.gameId}`;
    expect(inlineRow!.scenario.id).toBe("acrossTheStrait");
    expect(inlineRow!.board_definition.name).toBe("Across the Strait");
  });
});
