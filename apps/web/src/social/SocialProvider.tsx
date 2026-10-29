"use client";

/**
 * Friends and invites for the whole app (docs/phase13.md §3–§4). Mounted once
 * in the root layout: while signed in it beats the profile heartbeat, loads
 * friendships, profiles and invites, listens to all three on Realtime, keeps
 * the invite toast queue and renders the toasts. Every write goes through an
 * Edge Function; the tables are read-only to the client (RLS).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AvatarSpec } from "@katan/avatars";
import type { PlayerColor } from "@katan/engine";
import { errorText } from "@/game/labels";
import { useSession } from "@/hooks/useSession";
import { callFunction, supabase } from "@/lib/supabase";
import { InviteToasts } from "./InviteToasts";
import {
  EMPTY_TOASTS,
  HEARTBEAT_MS,
  friendshipFromRow,
  groupFriends,
  inviteFromRow,
  openInvites,
  profileFromRow,
  toastReducer,
  type Activity,
  type FriendGroups,
  type Friendship,
  type Invite,
  type Profile,
} from "./model";

type Result = { ok: true } | { ok: false; message: string };

export interface Social {
  /** False when Supabase is not configured or nobody is signed in: the panels explain instead. */
  readonly available: boolean;
  readonly me: Profile | null;
  readonly groups: FriendGroups;
  readonly invites: readonly Invite[];
  /** Invites waiting on me (the panel's list; toasts are the brief version). */
  readonly incomingInvites: readonly Invite[];
  readonly now: number;
  sendFriendRequest(code: string): Promise<Result & { status?: "pending" | "accepted" }>;
  respondFriendRequest(fromUserId: string, accept: boolean): Promise<Result>;
  removeFriend(userId: string): Promise<Result>;
  invite(gameId: string, toUserId: string): Promise<Result>;
  respondInvite(invite: Invite, accept: boolean): Promise<Result>;
  saveProfile(patch: { name?: string; avatar?: AvatarSpec; color?: PlayerColor }): Promise<Result>;
}

const EMPTY_GROUPS: FriendGroups = { online: [], offline: [], incoming: [], outgoing: [] };
const unavailable = async (): Promise<Result> => ({ ok: false, message: "Sign in to play with friends" });

const DEFAULTS: Social = {
  available: false,
  me: null,
  groups: EMPTY_GROUPS,
  invites: [],
  incomingInvites: [],
  now: 0,
  sendFriendRequest: unavailable,
  respondFriendRequest: unavailable,
  removeFriend: unavailable,
  invite: unavailable,
  respondInvite: unavailable,
  saveProfile: unavailable,
};

const SocialContext = createContext<Social>(DEFAULTS);

export function useSocial(): Social {
  return useContext(SocialContext);
}

function activityFor(pathname: string): Activity {
  if (pathname.startsWith("/lobby/") || pathname.startsWith("/join/")) return "lobby";
  if (pathname.startsWith("/play")) return "game";
  return "menu";
}

async function reply<T extends Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<Result & Partial<T>> {
  const r = await callFunction<T>(name, body);
  return (r.ok ? r : { ok: false, message: errorText(r.code) }) as Result & Partial<T>;
}

export function SocialProvider({ children }: { children: ReactNode }) {
  const { session, configured } = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const userId = session?.user.id ?? null;
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [toasts, dispatchToast] = useReducer(toastReducer, EMPTY_TOASTS);
  const activity = activityFor(pathname);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const load = useCallback(async () => {
    if (!userId) return;
    const client = supabase();
    const [p, f, i] = await Promise.all([
      client.from("profiles").select("*"),
      client.from("friendships").select("*"),
      client.from("game_invites").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    const rows = ((p.data ?? []) as Record<string, unknown>[]).map(profileFromRow);
    setProfiles(new Map(rows.map((r) => [r.userId, r])));
    const mine = rows.find((r) => r.userId === userId);
    if (mine) setMe(mine);
    setFriendships(((f.data ?? []) as Record<string, unknown>[]).map(friendshipFromRow));
    const list = ((i.data ?? []) as Record<string, unknown>[]).map(inviteFromRow);
    setInvites(list);
    dispatchToast({ type: "sync", invites: list });
  }, [userId]);

  const touch = useCallback(async () => {
    if (!userId) return;
    const r = await callFunction<{ profile: Record<string, unknown> }>("touch-profile", { activity: activityRef.current });
    if (r.ok) setMe(profileFromRow(r.profile));
  }, [userId]);

  // Heartbeat: on arrival, every HEARTBEAT_MS, on tab wake and when the activity changes.
  useEffect(() => {
    if (!configured || !userId) {
      setMe(null);
      setProfiles(new Map());
      setFriendships([]);
      setInvites([]);
      return;
    }
    void touch().then(load);
    const beat = setInterval(() => void touch(), HEARTBEAT_MS);
    const wake = () => {
      if (document.visibilityState === "visible") void touch().then(load);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [configured, userId, touch, load]);

  useEffect(() => {
    if (configured && userId) void touch();
  }, [activity, configured, userId, touch]);

  // Realtime: any change to my friendships, invites or a visible profile refreshes the lists; a new invite toasts at once.
  useEffect(() => {
    if (!configured || !userId) return;
    const client = supabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 150);
    };
    const channel = client
      .channel(`social:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `requester=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `addressee=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_invites", filter: `from_user=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_invites", filter: `to_user=eq.${userId}` }, (payload) => {
        if (payload.eventType === "INSERT") dispatchToast({ type: "receive", invite: inviteFromRow(payload.new as Record<string, unknown>), me: userId, now: Date.now() });
        refresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh(); // catch up after (re)connect
      });
    return () => {
      if (timer) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [configured, userId, load]);

  // Invites that were already waiting when I arrived toast too, once.
  useEffect(() => {
    if (!userId) return;
    for (const invite of openInvites(invites, userId, Date.now())) dispatchToast({ type: "receive", invite, me: userId, now: Date.now() });
  }, [invites, userId]);

  // Clocks: toasts fold away (checked every second; the reducer keeps its state when nothing lapses)
  // and online dots go stale without a refetch (every 15 s, so consumers do not re-render each second).
  useEffect(() => {
    const toastClock = setInterval(() => dispatchToast({ type: "tick", now: Date.now() }), 1000);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(toastClock);
      clearInterval(clock);
    };
  }, []);

  const groups = useMemo(() => (userId ? groupFriends(userId, friendships, profiles, now) : EMPTY_GROUPS), [userId, friendships, profiles, now]);
  const incomingInvites = useMemo(() => (userId ? openInvites(invites, userId, now) : []), [invites, userId, now]);

  const after = useCallback(
    async <R extends Result>(r: R): Promise<R> => {
      if (r.ok) await load();
      return r;
    },
    [load],
  );

  const available = configured && userId !== null;
  const value = useMemo<Social>(
    () =>
      available
        ? {
            available,
            me,
            groups,
            invites,
            incomingInvites,
            now,
            sendFriendRequest: async (code) => after(await reply<{ status: "pending" | "accepted" }>("send-friend-request", { code })),
            respondFriendRequest: async (fromUserId, accept) => after(await reply("respond-friend-request", { fromUserId, accept })),
            removeFriend: async (other) => after(await reply("remove-friend", { userId: other })),
            invite: async (gameId, toUserId) => after(await reply("send-invite", { gameId, toUserId })),
            respondInvite: async (invite, accept) => {
              dispatchToast({ type: "dismiss", id: invite.id });
              const r = await reply<{ joinCode: string }>("respond-invite", { inviteId: invite.id, accept });
              await load();
              if (r.ok && accept) router.push(`/lobby/${r.joinCode ?? invite.joinCode}`);
              return r;
            },
            saveProfile: async (patch) => {
              const r = await callFunction<{ profile: Record<string, unknown> }>("save-profile", patch);
              if (!r.ok) return { ok: false, message: errorText(r.code) };
              setMe(profileFromRow(r.profile));
              return { ok: true };
            },
          }
        : { ...DEFAULTS, now },
    [available, me, groups, invites, incomingInvites, now, after, load, router],
  );

  return (
    <SocialContext.Provider value={value}>
      {children}
      {available && <InviteToasts toasts={toasts.toasts} onRespond={(invite, accept) => void value.respondInvite(invite, accept)} onDismiss={(id) => dispatchToast({ type: "dismiss", id })} colorOf={(id) => profiles.get(id)?.color ?? null} />}
    </SocialContext.Provider>
  );
}

