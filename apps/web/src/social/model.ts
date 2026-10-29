/**
 * Friends and invites, client side (docs/phase13.md §3–§4). Pure: row shapes
 * from the Supabase tables, online status from the heartbeat, the friend list
 * split into its sections, who in it can be invited, and the invite toast
 * queue. The hook and components hold no rules of their own.
 */

import { isAvatarSpec, type AvatarSpec } from "@katan/avatars";
import { PLAYER_COLORS, type PlayerColor } from "@katan/engine";

/** Same windows as packages/server/src/social-service.ts. */
export const ONLINE_WINDOW_MS = 120_000;
export const INVITE_TTL_MS = 15 * 60_000;
export const HEARTBEAT_MS = 45_000;
/** A toast stays this long, then folds into the Friends panel's invite list. */
export const TOAST_VISIBLE_MS = 12_000;
export const MAX_TOASTS = 3;

export type Activity = "menu" | "lobby" | "game";

export interface Profile {
  readonly userId: string;
  readonly name: string;
  readonly friendCode: string;
  readonly avatar: AvatarSpec | null;
  readonly color: PlayerColor | null;
  readonly activity: Activity;
  readonly lastSeenAt: number;
}

export interface Friendship {
  readonly requester: string;
  readonly addressee: string;
  readonly status: "pending" | "accepted";
  readonly createdAt: number;
}

export type InviteStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

export interface Invite {
  readonly id: string;
  readonly gameId: string;
  readonly fromUser: string;
  readonly toUser: string;
  readonly fromName: string;
  readonly fromAvatar: AvatarSpec | null;
  readonly joinCode: string;
  readonly boardName: string | null;
  readonly status: InviteStatus;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Rows

function time(v: unknown): number {
  const t = typeof v === "string" || v instanceof Date ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function profileFromRow(row: Record<string, unknown>): Profile {
  const activity = row.activity === "lobby" || row.activity === "game" ? row.activity : "menu";
  const color = typeof row.color === "string" && (PLAYER_COLORS as readonly string[]).includes(row.color) ? (row.color as PlayerColor) : null;
  return {
    userId: str(row.user_id),
    name: str(row.display_name) || "Player",
    friendCode: str(row.friend_code),
    avatar: isAvatarSpec(row.avatar) ? row.avatar : null,
    color,
    activity,
    lastSeenAt: time(row.last_seen_at),
  };
}

export function friendshipFromRow(row: Record<string, unknown>): Friendship {
  return { requester: str(row.requester), addressee: str(row.addressee), status: row.status === "accepted" ? "accepted" : "pending", createdAt: time(row.created_at) };
}

export function inviteFromRow(row: Record<string, unknown>): Invite {
  const statuses: readonly InviteStatus[] = ["pending", "accepted", "declined", "expired", "cancelled"];
  return {
    id: str(row.id),
    gameId: str(row.game_id),
    fromUser: str(row.from_user),
    toUser: str(row.to_user),
    fromName: str(row.from_name) || "A friend",
    fromAvatar: isAvatarSpec(row.from_avatar) ? row.from_avatar : null,
    joinCode: str(row.join_code),
    boardName: typeof row.board_name === "string" ? row.board_name : null,
    status: statuses.includes(row.status as InviteStatus) ? (row.status as InviteStatus) : "pending",
    createdAt: time(row.created_at),
  };
}

/** `ABCD-EFGH` for display; the server accepts either form. */
export function formatFriendCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Friend list

export function isOnline(profile: Profile | null | undefined, now: number): boolean {
  return profile !== null && profile !== undefined && now - profile.lastSeenAt <= ONLINE_WINDOW_MS;
}

export interface FriendEntry {
  readonly userId: string;
  readonly profile: Profile | null;
  readonly name: string;
  readonly online: boolean;
}

export interface FriendGroups {
  readonly online: readonly FriendEntry[];
  readonly offline: readonly FriendEntry[];
  /** Requests others sent you, waiting on your answer. */
  readonly incoming: readonly FriendEntry[];
  /** Requests you sent, waiting on theirs. */
  readonly outgoing: readonly FriendEntry[];
}

const ACTIVITY_ORDER: Record<Activity, number> = { menu: 0, lobby: 1, game: 2 };

/** Split the caller's friendships into Online, Offline and the two pending lists. */
export function groupFriends(me: string, friendships: readonly Friendship[], profiles: ReadonlyMap<string, Profile>, now: number): FriendGroups {
  const online: FriendEntry[] = [];
  const offline: FriendEntry[] = [];
  const incoming: FriendEntry[] = [];
  const outgoing: FriendEntry[] = [];
  for (const f of friendships) {
    if (f.requester !== me && f.addressee !== me) continue;
    const other = f.requester === me ? f.addressee : f.requester;
    const profile = profiles.get(other) ?? null;
    const entry: FriendEntry = { userId: other, profile, name: profile?.name ?? "Player", online: isOnline(profile, now) };
    if (f.status === "pending") (f.requester === me ? outgoing : incoming).push(entry);
    else (entry.online ? online : offline).push(entry);
  }
  const byName = (a: FriendEntry, b: FriendEntry) => a.name.localeCompare(b.name);
  online.sort((a, b) => ACTIVITY_ORDER[a.profile!.activity] - ACTIVITY_ORDER[b.profile!.activity] || byName(a, b));
  offline.sort((a, b) => (b.profile?.lastSeenAt ?? 0) - (a.profile?.lastSeenAt ?? 0) || byName(a, b));
  incoming.sort(byName);
  outgoing.sort(byName);
  return { online, offline, incoming, outgoing };
}

export function lastSeenText(lastSeenAt: number, now: number): string {
  if (lastSeenAt <= 0) return "Not seen yet";
  const minutes = Math.floor((now - lastSeenAt) / 60_000);
  if (minutes < 60) return `Seen ${Math.max(1, minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Seen ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Seen ${days} day${days === 1 ? "" : "s"} ago`;
}

export function statusText(entry: FriendEntry, now: number): string {
  if (!entry.online || !entry.profile) return lastSeenText(entry.profile?.lastSeenAt ?? 0, now);
  return entry.profile.activity === "game" ? "In a game" : entry.profile.activity === "lobby" ? "In a lobby" : "In the village";
}

export type InviteState = "invite" | "invited" | "seated" | "full";

export interface InvitableFriend {
  readonly entry: FriendEntry;
  readonly state: InviteState;
}

/**
 * Online friends with what the Invite button should do for each: invite,
 * already invited (a pending invite of mine to this party), already seated,
 * or no seat left. Friends in a game are listed after the free ones.
 */
export function invitableFriends(
  groups: FriendGroups,
  party: { readonly gameId: string; readonly seatedUserIds: readonly string[]; readonly openSeats: number } | null,
  invites: readonly Invite[],
  me: string,
  now: number,
): InvitableFriend[] {
  const pendingTo = new Set(invites.filter((i) => i.fromUser === me && i.status === "pending" && (!party || i.gameId === party.gameId) && now - i.createdAt <= INVITE_TTL_MS).map((i) => i.toUser));
  return groups.online.map((entry) => {
    if (party?.seatedUserIds.includes(entry.userId)) return { entry, state: "seated" as const };
    if (party && pendingTo.has(entry.userId)) return { entry, state: "invited" as const };
    if (party && party.openSeats <= 0) return { entry, state: "full" as const };
    return { entry, state: "invite" as const };
  });
}

/** Invites waiting on me, newest first, without the lapsed ones. */
export function openInvites(invites: readonly Invite[], me: string, now: number): Invite[] {
  return invites.filter((i) => i.toUser === me && i.status === "pending" && now - i.createdAt <= INVITE_TTL_MS).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------
// Toast queue

export interface InviteToast {
  readonly invite: Invite;
  readonly shownAt: number;
}

export interface ToastState {
  readonly toasts: readonly InviteToast[];
  /** Invite ids already toasted, so a reload or a repeated event does not toast twice. */
  readonly seen: readonly string[];
}

export type ToastAction =
  | { readonly type: "receive"; readonly invite: Invite; readonly me: string; readonly now: number }
  | { readonly type: "dismiss"; readonly id: string }
  /** Invite rows changed (accepted elsewhere, declined, cancelled): drop toasts for anything no longer pending. */
  | { readonly type: "sync"; readonly invites: readonly Invite[] }
  | { readonly type: "tick"; readonly now: number };

export const EMPTY_TOASTS: ToastState = { toasts: [], seen: [] };

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case "receive": {
      const { invite } = action;
      if (invite.toUser !== action.me || invite.status !== "pending" || state.seen.includes(invite.id)) return state;
      if (action.now - invite.createdAt > INVITE_TTL_MS) return { ...state, seen: [...state.seen, invite.id] };
      // A newer invite to the same game replaces the old toast.
      const kept = state.toasts.filter((t) => t.invite.gameId !== invite.gameId);
      const toasts = [...kept, { invite, shownAt: action.now }].slice(-MAX_TOASTS);
      return { toasts, seen: [...state.seen, invite.id].slice(-200) };
    }
    case "dismiss":
      return state.toasts.some((t) => t.invite.id === action.id) ? { ...state, toasts: state.toasts.filter((t) => t.invite.id !== action.id) } : state;
    case "sync": {
      const pending = new Set(action.invites.filter((i) => i.status === "pending").map((i) => i.id));
      const toasts = state.toasts.filter((t) => pending.has(t.invite.id));
      return toasts.length === state.toasts.length ? state : { ...state, toasts };
    }
    case "tick": {
      const toasts = state.toasts.filter((t) => action.now - t.shownAt < TOAST_VISIBLE_MS);
      return toasts.length === state.toasts.length ? state : { ...state, toasts };
    }
    default: {
      const never: never = action;
      return never;
    }
  }
}

