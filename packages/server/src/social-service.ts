/**
 * Profiles, friends and game invites (docs/phase13.md §3–§4).
 *
 * A profile is created on first contact (`touchProfile`) with a shareable
 * 8-character friend code. Friend requests go by code, never by email, so a
 * stranger's account cannot be probed. An invite asks an accepted friend into
 * a lobby you sit in; accepting it takes a seat through `joinGame`.
 */

import { isAvatarSpec, type AvatarSpec } from "@katan/avatars";
import { PLAYER_COLORS, type PlayerColor } from "@katan/engine";
import type { JSONValue } from "postgres";
import { ServiceError } from "./errors";
import { seatsOf, type Db, type GameRow, type Tx } from "./game-service";
import { CODE_ALPHABET, joinGame, normalizeCode } from "./lobby-service";

export const FRIEND_CODE_LENGTH = 8;
/** A heartbeat this recent counts as online (the client beats every 45 s). */
export const ONLINE_WINDOW_MS = 120_000;
/** A pending invite lapses after this long. */
export const INVITE_TTL_MS = 15 * 60_000;
/** Open friend requests one player may have outstanding. */
export const MAX_OUTGOING_REQUESTS = 50;

export type Activity = "menu" | "lobby" | "game";
const ACTIVITIES: readonly Activity[] = ["menu", "lobby", "game"];

export interface ProfileRow {
  user_id: string;
  display_name: string;
  friend_code: string;
  avatar: AvatarSpec | null;
  color: PlayerColor | null;
  activity: Activity;
  last_seen_at: Date;
}

export interface InviteRow {
  id: string;
  game_id: string;
  from_user: string;
  to_user: string;
  from_name: string;
  join_code: string;
  board_name: string | null;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  created_at: Date;
}

export function generateFriendCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

/** Display form, `ABCD-EFGH`; input accepts either. */
export function formatFriendCode(code: string): string {
  return code.length === FRIEND_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function cleanDisplayName(name: unknown): string | null {
  const n = typeof name === "string" ? name.trim().slice(0, 24) : "";
  return n.length > 0 ? n : null;
}

function cleanColor(color: unknown): PlayerColor | null {
  return typeof color === "string" && (PLAYER_COLORS as readonly string[]).includes(color) ? (color as PlayerColor) : null;
}

async function nameFromAuth(tx: Tx, userId: string): Promise<string> {
  const [row] = await tx<{ email: string | null; meta: { display_name?: unknown } | null }[]>`select email, raw_user_meta_data as meta from auth.users where id = ${userId}`;
  if (!row) throw new ServiceError("UNAUTHORIZED", "no such user", 401);
  return cleanDisplayName(row.meta?.display_name) ?? cleanDisplayName(row.email?.split("@")[0]) ?? "Player";
}

/** The caller's profile, created with a fresh friend code if this is their first visit. */
export async function ensureProfile(tx: Tx, userId: string, random: () => number = Math.random): Promise<ProfileRow> {
  const [existing] = await tx<ProfileRow[]>`select * from profiles where user_id = ${userId}`;
  if (existing) return existing;
  const name = await nameFromAuth(tx, userId);
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await tx<ProfileRow[]>`
      insert into profiles (user_id, display_name, friend_code)
      values (${userId}, ${name}, ${generateFriendCode(random)})
      on conflict do nothing
      returning *`;
    if (rows[0]) return rows[0];
    const [raced] = await tx<ProfileRow[]>`select * from profiles where user_id = ${userId}`;
    if (raced) return raced; // a parallel first visit won; the conflict was on user_id, not the code
  }
  throw new ServiceError("BAD_REQUEST", "could not allocate a friend code", 500);
}

/** Heartbeat: marks the caller online and says where they are (menu, lobby, game). */
export async function touchProfile(sql: Db, input: { userId: string; activity?: unknown; random?: () => number }): Promise<ProfileRow> {
  const activity = ACTIVITIES.includes(input.activity as Activity) ? (input.activity as Activity) : "menu";
  return sql.begin(async (tx) => {
    await ensureProfile(tx as Tx, input.userId, input.random);
    const [row] = await tx<ProfileRow[]>`update profiles set last_seen_at = now(), activity = ${activity} where user_id = ${input.userId} returning *`;
    return row!;
  });
}

/** Save the name and wardrobe other players see (docs/phase13.md §2). */
export async function saveProfile(sql: Db, input: { userId: string; name?: unknown; avatar?: unknown; color?: unknown }): Promise<ProfileRow> {
  if (input.avatar !== undefined && input.avatar !== null && !isAvatarSpec(input.avatar)) throw new ServiceError("BAD_REQUEST", "malformed avatar");
  if (input.color !== undefined && input.color !== null && !cleanColor(input.color)) throw new ServiceError("BAD_REQUEST", "unknown colour");
  return sql.begin(async (tx) => {
    const current = await ensureProfile(tx as Tx, input.userId);
    const name = input.name === undefined ? current.display_name : (cleanDisplayName(input.name) ?? current.display_name);
    const avatar = input.avatar === undefined ? current.avatar : (input.avatar as AvatarSpec | null);
    const color = input.color === undefined ? current.color : cleanColor(input.color);
    const [row] = await tx<ProfileRow[]>`
      update profiles set display_name = ${name}, avatar = ${avatar ? tx.json(avatar as unknown as JSONValue) : null}, color = ${color}, last_seen_at = now()
      where user_id = ${input.userId} returning *`;
    return row!;
  });
}

// ---------------------------------------------------------------------------
// Friends

interface FriendshipRow {
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
}

async function pairOf(tx: Tx, a: string, b: string): Promise<FriendshipRow | undefined> {
  const [row] = await tx<FriendshipRow[]>`
    select requester, addressee, status from friendships
    where (requester = ${a} and addressee = ${b}) or (requester = ${b} and addressee = ${a})
    for update`;
  return row;
}

/**
 * Ask someone to be friends by their code. If they already asked you, this
 * accepts their request instead of opening a second one.
 */
export async function sendFriendRequest(sql: Db, input: { userId: string; code: string }): Promise<{ friendId: string; status: "pending" | "accepted" }> {
  const code = normalizeCode(input.code);
  if (code.length !== FRIEND_CODE_LENGTH) throw new ServiceError("FRIEND_NOT_FOUND", "friend codes are 8 characters", 404);
  return sql.begin(async (tx) => {
    await ensureProfile(tx as Tx, input.userId);
    const [target] = await tx<{ user_id: string }[]>`select user_id from profiles where friend_code = ${code}`;
    if (!target) throw new ServiceError("FRIEND_NOT_FOUND", "no player has that code", 404);
    if (target.user_id === input.userId) throw new ServiceError("BAD_REQUEST", "that is your own code");
    const existing = await pairOf(tx as Tx, input.userId, target.user_id);
    if (existing?.status === "accepted") throw new ServiceError("ALREADY_FRIENDS", "you are already friends", 409);
    if (existing && existing.requester === input.userId) return { friendId: target.user_id, status: "pending" as const }; // asked already: idempotent
    if (existing) {
      await tx`update friendships set status = 'accepted', responded_at = now() where requester = ${target.user_id} and addressee = ${input.userId}`;
      return { friendId: target.user_id, status: "accepted" as const };
    }
    const [{ n }] = (await tx<{ n: number }[]>`select count(*)::int as n from friendships where requester = ${input.userId} and status = 'pending'`) as [{ n: number }];
    if (n >= MAX_OUTGOING_REQUESTS) throw new ServiceError("BAD_REQUEST", "too many open requests");
    await tx`insert into friendships (requester, addressee) values (${input.userId}, ${target.user_id})`;
    return { friendId: target.user_id, status: "pending" as const };
  });
}

/** Accept or decline a request someone sent you; declining deletes it. */
export async function respondFriendRequest(sql: Db, input: { userId: string; fromUserId: string; accept: boolean }): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await pairOf(tx as Tx, input.userId, input.fromUserId);
    if (!row || row.status !== "pending" || row.addressee !== input.userId) throw new ServiceError("FRIEND_NOT_FOUND", "no request from that player", 404);
    if (input.accept) await tx`update friendships set status = 'accepted', responded_at = now() where requester = ${input.fromUserId} and addressee = ${input.userId}`;
    else await tx`delete from friendships where requester = ${input.fromUserId} and addressee = ${input.userId}`;
  });
}

/** Unfriend, or withdraw a request you sent. Pending invites between the two are cancelled. */
export async function removeFriend(sql: Db, input: { userId: string; otherUserId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await pairOf(tx as Tx, input.userId, input.otherUserId);
    if (!row) throw new ServiceError("NOT_FRIENDS", "you are not connected to that player", 404);
    if (row.status === "pending" && row.requester !== input.userId) throw new ServiceError("BAD_REQUEST", "decline the request instead");
    await tx`delete from friendships where requester = ${row.requester} and addressee = ${row.addressee}`;
    await tx`update game_invites set status = 'cancelled', responded_at = now()
             where status = 'pending' and ((from_user = ${input.userId} and to_user = ${input.otherUserId}) or (from_user = ${input.otherUserId} and to_user = ${input.userId}))`;
  });
}

// ---------------------------------------------------------------------------
// Invites

/** Invite an accepted friend into a lobby you sit in. Re-inviting refreshes the pending invite. */
export async function sendInvite(sql: Db, input: { userId: string; gameId: string; toUserId: string }): Promise<{ inviteId: string }> {
  return sql.begin(async (tx) => {
    const [game] = await tx<GameRow[]>`select * from games where id = ${input.gameId} for update`;
    if (!game) throw new ServiceError("GAME_NOT_FOUND", "no such game", 404);
    if (game.status !== "lobby" || !game.join_code) throw new ServiceError("GAME_NOT_ACTIVE", "that game has started", 409);
    const seats = await seatsOf(tx as Tx, game.id);
    if (!seats.some((s) => s.user_id === input.userId)) throw new ServiceError("NOT_A_MEMBER", "you are not in this lobby", 403);
    if (seats.some((s) => s.user_id === input.toUserId)) throw new ServiceError("ALREADY_JOINED", "they are already seated", 409);
    if (seats.length >= game.max_players) throw new ServiceError("LOBBY_FULL", "the lobby is full", 409);
    const pair = await pairOf(tx as Tx, input.userId, input.toUserId);
    if (pair?.status !== "accepted") throw new ServiceError("NOT_FRIENDS", "you can only invite friends", 403);
    const me = await ensureProfile(tx as Tx, input.userId);
    const [lobby] = await tx<{ board_name: string | null }[]>`select board_name from lobbies where game_id = ${game.id}`;
    // One pending invite per (game, invitee): re-sending replaces it, so the toast shows again.
    await tx`update game_invites set status = 'cancelled', responded_at = now() where game_id = ${game.id} and to_user = ${input.toUserId} and status = 'pending'`;
    const [row] = await tx<{ id: string }[]>`
      insert into game_invites (game_id, from_user, to_user, from_name, from_avatar, join_code, board_name)
      values (${game.id}, ${input.userId}, ${input.toUserId}, ${me.display_name}, ${me.avatar ? tx.json(me.avatar as unknown as JSONValue) : null}, ${game.join_code}, ${lobby?.board_name ?? null})
      returning id`;
    return { inviteId: row!.id };
  });
}

/**
 * Accept (take a seat through `joinGame`) or decline an invite. A lapsed
 * invite, a started game or a full lobby marks it expired and says so.
 */
export async function respondInvite(
  sql: Db,
  input: { userId: string; inviteId: string; accept: boolean; now?: Date },
): Promise<{ gameId: string; joinCode: string } | Record<string, never>> {
  const [invite] = await sql<InviteRow[]>`select * from game_invites where id = ${input.inviteId} and to_user = ${input.userId}`;
  if (!invite || invite.status !== "pending") throw new ServiceError("INVITE_NOT_FOUND", "that invite is no longer open", 404);
  const settle = (status: InviteRow["status"]) => sql`update game_invites set status = ${status}, responded_at = now() where id = ${invite.id} and status = 'pending'`;
  if (!input.accept) {
    await settle("declined");
    return {};
  }
  const now = input.now ?? new Date();
  if (now.getTime() - new Date(invite.created_at).getTime() > INVITE_TTL_MS) {
    await settle("expired");
    throw new ServiceError("INVITE_EXPIRED", "that invite has lapsed", 410);
  }
  const profile = await sql.begin((tx) => ensureProfile(tx as Tx, input.userId));
  try {
    await joinGame(sql, { code: invite.join_code, userId: input.userId, name: profile.display_name, avatar: profile.avatar, color: profile.color });
  } catch (err) {
    if (err instanceof ServiceError && ["LOBBY_FULL", "GAME_NOT_ACTIVE", "INVALID_CODE"].includes(err.code)) await settle("expired");
    throw err;
  }
  await settle("accepted");
  return { gameId: invite.game_id, joinCode: invite.join_code };
}
