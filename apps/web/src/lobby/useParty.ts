"use client";

/**
 * Your party in the home lobby (docs/phase13.md §1, §4): the newest open
 * lobby you sit in, its seats kept live over Realtime, and your open games.
 * Inviting a friend with no party yet opens one (`ensureParty`).
 */

import { useCallback, useEffect, useState } from "react";
import type { AvatarSpec } from "@katan/avatars";
import type { PlayerColor } from "@katan/engine";
import { seatFromRow } from "@/driver/supabase";
import type { SeatInfo } from "@/driver/types";
import { errorText } from "@/game/labels";
import { useSession } from "@/hooks/useSession";
import { callFunction, displayNameOf, supabase } from "@/lib/supabase";

export interface MyGame {
  readonly id: string;
  readonly join_code: string;
  readonly status: "lobby" | "active" | "ended";
  readonly created_at: string;
  readonly max_players: number;
  readonly board_name: string | null;
}

export interface Party {
  readonly game: MyGame;
  readonly seats: readonly SeatInfo[];
}

export interface PartyState {
  readonly games: readonly MyGame[];
  readonly party: Party | null;
  /** The party's game id, opening a default lobby first if there is none. Returns an error sentence on failure. */
  ensureParty(look: { avatar: AvatarSpec; color: PlayerColor }): Promise<{ gameId: string } | { problem: string }>;
  reload(): Promise<void>;
}

export function useParty(): PartyState {
  const { session, configured } = useSession();
  const [games, setGames] = useState<MyGame[]>([]);
  const [party, setParty] = useState<Party | null>(null);
  const userId = session?.user.id ?? null;

  const reload = useCallback(async () => {
    if (!configured || !userId) return;
    const client = supabase();
    const { data } = await client.from("lobby_games").select("id, join_code, status, created_at, max_players, board_name").neq("status", "ended").order("created_at", { ascending: false });
    const list = (data ?? []) as MyGame[];
    setGames(list);
    const open = list.find((g) => g.status === "lobby");
    if (!open) return setParty(null);
    const { data: rows } = await client.from("game_players").select("*").eq("game_id", open.id).order("seat");
    setParty({ game: open, seats: ((rows ?? []) as Parameters<typeof seatFromRow>[0][]).map(seatFromRow) });
  }, [configured, userId]);

  useEffect(() => {
    if (!configured || !userId) {
      setGames([]);
      setParty(null);
      return;
    }
    void reload();
  }, [configured, userId, reload]);

  const partyId = party?.game.id ?? null;
  useEffect(() => {
    if (!configured || !partyId) return;
    const client = supabase();
    const channel = client
      .channel(`party:${partyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${partyId}` }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "lobbies", filter: `game_id=eq.${partyId}` }, () => void reload())
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [configured, partyId, reload]);

  const ensureParty = useCallback<PartyState["ensureParty"]>(
    async (look) => {
      if (party) return { gameId: party.game.id };
      if (!session) return { problem: "Sign in to invite friends" };
      const reply = await callFunction<{ gameId: string }>("create-lobby", { board: "beginner", maxPlayers: 4, name: displayNameOf(session), avatar: look.avatar, color: look.color });
      if (!reply.ok) return { problem: errorText(reply.code) };
      await reload();
      return { gameId: reply.gameId };
    },
    [party, session, reload],
  );

  return { games, party, ensureParty, reload };
}
