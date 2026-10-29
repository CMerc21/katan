import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  INVITE_TTL_MS,
  createLobby,
  formatFriendCode,
  generateFriendCode,
  removeFriend,
  respondFriendRequest,
  respondInvite,
  saveProfile,
  sendFriendRequest,
  sendInvite,
  startGame,
  addBot,
  setReady,
  touchProfile,
  type Db,
  type ProfileRow,
} from "../src/index";
import { asUser, connectTestDb, createUser, pgErrorCode, resetDatabase } from "./harness";

let sql: Db;
let ana: string;
let ben: string;
let cal: string;
let dot: string;
const profiles: Record<string, ProfileRow> = {};

beforeAll(async () => {
  sql = connectTestDb();
  await resetDatabase(sql);
  ana = await createUser(sql, "ana@example.com", "Ana");
  ben = await createUser(sql, "ben@example.com", "Ben");
  cal = await createUser(sql, "cal@example.com", "Cal");
  dot = await createUser(sql, "dot@example.com", "Dot");
  for (const u of [ana, ben, cal, dot]) profiles[u] = await touchProfile(sql, { userId: u });
});

afterAll(async () => {
  await sql.end();
});

const AVATAR = { skin: 2, face: 1, eyes: 0, brows: 2, mouth: 0, hair: 3, hairColor: 4, facialHair: 1, headwear: 6, garment: 3, accessory: 2 };

async function friends(a: string, b: string): Promise<void> {
  await sendFriendRequest(sql, { userId: a, code: profiles[b]!.friend_code });
  await respondFriendRequest(sql, { userId: b, fromUserId: a, accept: true });
}

describe("docs/phase13.md §3 profiles", () => {
  it("first contact creates a profile with an 8-character code from the join-code alphabet and the auth name", async () => {
    const p = profiles[ana]!;
    expect(p.display_name).toBe("Ana");
    expect(p.friend_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(new Set(Object.values(profiles).map((x) => x.friend_code)).size).toBe(4);
    expect(formatFriendCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(generateFriendCode(() => 0)).toBe("AAAAAAAA");
    const again = await touchProfile(sql, { userId: ana, activity: "lobby" });
    expect(again.friend_code).toBe(p.friend_code);
    expect(again.activity).toBe("lobby");
    expect((await touchProfile(sql, { userId: ana, activity: "nonsense" })).activity).toBe("menu");
  });

  it("saves the wardrobe and name, and refuses a malformed avatar or colour", async () => {
    const saved = await saveProfile(sql, { userId: ana, name: "  Ana of the Vale  ", avatar: AVATAR, color: "green" });
    expect(saved.display_name).toBe("Ana of the Vale");
    expect(saved.avatar).toEqual(AVATAR);
    expect(saved.color).toBe("green");
    await expect(saveProfile(sql, { userId: ana, avatar: { skin: 40 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(saveProfile(sql, { userId: ana, color: "pink" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await saveProfile(sql, { userId: ana, name: "   " })).display_name).toBe("Ana of the Vale");
  });
});

describe("docs/phase13.md §3 friends", () => {
  it("requests go by code; a request back accepts; repeats are idempotent; bad codes and self are refused", async () => {
    await expect(sendFriendRequest(sql, { userId: ana, code: "ZZZZ-ZZZZ" })).rejects.toMatchObject({ code: "FRIEND_NOT_FOUND" });
    await expect(sendFriendRequest(sql, { userId: ana, code: "short" })).rejects.toMatchObject({ code: "FRIEND_NOT_FOUND" });
    await expect(sendFriendRequest(sql, { userId: ana, code: profiles[ana]!.friend_code })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const code = profiles[ben]!.friend_code.toLowerCase();
    expect(await sendFriendRequest(sql, { userId: ana, code: `${code.slice(0, 4)}-${code.slice(4)}` })).toEqual({ friendId: ben, status: "pending" });
    expect(await sendFriendRequest(sql, { userId: ana, code })).toEqual({ friendId: ben, status: "pending" });
    const [{ n }] = (await sql<{ n: number }[]>`select count(*)::int as n from friendships`) as [{ n: number }];
    expect(n).toBe(1);
    expect(await sendFriendRequest(sql, { userId: ben, code: profiles[ana]!.friend_code })).toEqual({ friendId: ana, status: "accepted" });
    await expect(sendFriendRequest(sql, { userId: ana, code })).rejects.toMatchObject({ code: "ALREADY_FRIENDS" });
  });

  it("only the addressee answers a request; declining deletes it; the sender may withdraw it", async () => {
    await sendFriendRequest(sql, { userId: cal, code: profiles[ana]!.friend_code });
    await expect(respondFriendRequest(sql, { userId: cal, fromUserId: ana, accept: true })).rejects.toMatchObject({ code: "FRIEND_NOT_FOUND" });
    await respondFriendRequest(sql, { userId: ana, fromUserId: cal, accept: false });
    expect(await sql`select 1 from friendships where requester = ${cal}`).toHaveLength(0);
    await sendFriendRequest(sql, { userId: cal, code: profiles[dot]!.friend_code });
    await expect(removeFriend(sql, { userId: dot, otherUserId: cal })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await removeFriend(sql, { userId: cal, otherUserId: dot });
    expect(await sql`select 1 from friendships where requester = ${cal}`).toHaveLength(0);
    await expect(removeFriend(sql, { userId: cal, otherUserId: dot })).rejects.toMatchObject({ code: "NOT_FRIENDS" });
  });

  it("row level security: you read your own friendships and the profiles of people you are connected to, never a stranger's", async () => {
    await sendFriendRequest(sql, { userId: dot, code: profiles[ana]!.friend_code }); // pending dot → ana
    const anaSees = await asUser(sql, ana, (tx) => tx<{ user_id: string }[]>`select user_id from profiles order by display_name`);
    expect(anaSees.map((r) => r.user_id).sort()).toEqual([ana, ben, dot].sort());
    const calSees = await asUser(sql, cal, (tx) => tx<{ user_id: string; friend_code: string }[]>`select user_id, friend_code from profiles`);
    expect(calSees.map((r) => r.user_id)).toEqual([cal]);
    const calFriendships = await asUser(sql, cal, (tx) => tx`select * from friendships`);
    expect(calFriendships).toHaveLength(0);
    const anaFriendships = await asUser(sql, ana, (tx) => tx`select * from friendships`);
    expect(anaFriendships).toHaveLength(2);
    expect(await pgErrorCode(() => asUser(sql, ana, (tx) => tx`insert into friendships (requester, addressee) values (${ana}, ${cal})`))).toBe("42501");
    expect(await pgErrorCode(() => asUser(sql, ana, (tx) => tx`update profiles set display_name = 'x' where user_id = ${ana}`))).toBe("42501");
    await respondFriendRequest(sql, { userId: ana, fromUserId: dot, accept: false });
  });
});

describe("docs/phase13.md §4 invites", () => {
  it("invites go to accepted friends in a lobby you sit in; accepting seats them with their wardrobe", async () => {
    await saveProfile(sql, { userId: ben, avatar: AVATAR, color: "blue" });
    const { gameId, joinCode } = await createLobby(sql, { hostUserId: ana, name: "Ana", board: "beginner", maxPlayers: 4, avatar: AVATAR, color: "green" });
    const [host] = await sql<{ color: string; avatar: unknown }[]>`select color, avatar from game_players where game_id = ${gameId} and seat = 0`;
    expect(host).toEqual({ color: "green", avatar: AVATAR });

    await expect(sendInvite(sql, { userId: ana, gameId, toUserId: cal })).rejects.toMatchObject({ code: "NOT_FRIENDS" });
    await expect(sendInvite(sql, { userId: ben, gameId, toUserId: ana })).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
    const first = await sendInvite(sql, { userId: ana, gameId, toUserId: ben });
    const second = await sendInvite(sql, { userId: ana, gameId, toUserId: ben });
    expect(second.inviteId).not.toBe(first.inviteId);
    const rows = await sql<{ id: string; status: string; from_name: string; join_code: string; board_name: string | null }[]>`select id, status, from_name, join_code, board_name from game_invites where game_id = ${gameId} order by created_at`;
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "pending"]);
    expect(rows[1]).toMatchObject({ from_name: "Ana of the Vale", join_code: joinCode, board_name: "Beginner" });

    // RLS: the invitee and the sender see it, nobody else.
    expect(await asUser(sql, ben, (tx) => tx`select id from game_invites where status = 'pending'`)).toHaveLength(1);
    expect(await asUser(sql, cal, (tx) => tx`select id from game_invites`)).toHaveLength(0);

    await expect(respondInvite(sql, { userId: cal, inviteId: second.inviteId, accept: true })).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
    expect(await respondInvite(sql, { userId: ben, inviteId: second.inviteId, accept: true })).toEqual({ gameId, joinCode });
    const [seat] = await sql<{ name: string; color: string; avatar: unknown }[]>`select name, color, avatar from game_players where game_id = ${gameId} and user_id = ${ben}`;
    expect(seat).toEqual({ name: "Ben", color: "blue", avatar: AVATAR });
    await expect(respondInvite(sql, { userId: ben, inviteId: second.inviteId, accept: true })).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
    await expect(sendInvite(sql, { userId: ana, gameId, toUserId: ben })).rejects.toMatchObject({ code: "ALREADY_JOINED" });
  });

  it("declines, lapses after the TTL, expires when the game starts first, and unfriending cancels", async () => {
    await friends(ana, cal);
    await friends(ana, dot);
    const { gameId } = await createLobby(sql, { hostUserId: ana, name: "Ana", board: "beginner", maxPlayers: 3 });
    const { inviteId: toCal } = await sendInvite(sql, { userId: ana, gameId, toUserId: cal });
    expect(await respondInvite(sql, { userId: cal, inviteId: toCal, accept: false })).toEqual({});

    const { inviteId: lapsed } = await sendInvite(sql, { userId: ana, gameId, toUserId: cal });
    await expect(respondInvite(sql, { userId: cal, inviteId: lapsed, accept: true, now: new Date(Date.now() + INVITE_TTL_MS + 60_000) })).rejects.toMatchObject({ code: "INVITE_EXPIRED" });

    const { inviteId: toDot } = await sendInvite(sql, { userId: ana, gameId, toUserId: dot });
    await addBot(sql, { gameId, userId: ana, level: "easy" });
    await addBot(sql, { gameId, userId: ana, level: "easy" });
    await expect(sendInvite(sql, { userId: ana, gameId, toUserId: cal })).rejects.toMatchObject({ code: "LOBBY_FULL" });
    await setReady(sql, { gameId, userId: ana, ready: true });
    await startGame(sql, { gameId, userId: ana });
    await expect(respondInvite(sql, { userId: dot, inviteId: toDot, accept: true })).rejects.toMatchObject({ code: "GAME_NOT_ACTIVE" });
    await expect(sendInvite(sql, { userId: ana, gameId, toUserId: dot })).rejects.toMatchObject({ code: "GAME_NOT_ACTIVE" });
    const statuses = await sql<{ id: string; status: string }[]>`select id, status from game_invites where game_id = ${gameId}`;
    expect(Object.fromEntries(statuses.map((r) => [r.id, r.status]))).toEqual({ [toCal]: "declined", [lapsed]: "expired", [toDot]: "expired" });

    const { gameId: other } = await createLobby(sql, { hostUserId: ana, name: "Ana", board: "beginner", maxPlayers: 4 });
    const { inviteId } = await sendInvite(sql, { userId: ana, gameId: other, toUserId: cal });
    await removeFriend(sql, { userId: cal, otherUserId: ana });
    const [row] = await sql<{ status: string }[]>`select status from game_invites where id = ${inviteId}`;
    expect(row!.status).toBe("cancelled");
  });
});
