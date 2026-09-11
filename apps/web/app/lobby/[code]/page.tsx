"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { BotLevel } from "@katan/bots";
import { PLAYER_COLORS, type PlayerColor } from "@katan/engine";
import { Button, Swatch } from "@/components/ui";
import { seatFromRow } from "@/driver/supabase";
import type { SeatInfo } from "@/driver/types";
import { errorText } from "@/game/labels";
import { useRequireSession } from "@/hooks/useSession";
import { callFunction, displayNameOf, supabase } from "@/lib/supabase";

interface Lobby {
  id: string;
  join_code: string;
  status: "lobby" | "active" | "ended";
  host_user_id: string | null;
  max_players: number;
  board: "beginner" | "random";
}

/** The lobby (docs/phase5.md §1). */
export default function LobbyPage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const { session, loading } = useRequireSession();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [botLevel, setBotLevel] = useState<BotLevel>("medium");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const upper = code.toUpperCase();

  const load = useCallback(async () => {
    const client = supabase();
    const { data, error } = await client.from("lobby_games").select("*").eq("join_code", upper).neq("status", "ended").maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const l = data as Lobby;
    const { data: rows } = await client.from("game_players").select("*").eq("game_id", l.id).order("seat");
    setLobby(l);
    setSeats(((rows ?? []) as Parameters<typeof seatFromRow>[0][]).map(seatFromRow));
    return l;
  }, [upper]);

  useEffect(() => {
    if (loading || !session) return;
    let channel: ReturnType<ReturnType<typeof supabase>["channel"]> | null = null;
    void (async () => {
      try {
        let l = await load();
        if (!l) {
          // Not a member yet (arrived by code): join, then load.
          const reply = await callFunction("join-game", { code: upper, name: displayNameOf(session) });
          if (!reply.ok) return setProblem(errorText(reply.code));
          l = await load();
          if (!l) return setProblem(errorText("INVALID_CODE"));
        }
        channel = supabase()
          .channel(`lobby:${l.id}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${l.id}` }, () => void load())
          .on("postgres_changes", { event: "*", schema: "public", table: "lobbies", filter: `game_id=eq.${l.id}` }, () => void load())
          .subscribe((status) => {
            if (status === "SUBSCRIBED") void load(); // catch up after (re)connect
          });
      } catch (err) {
        setProblem(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      if (channel) void supabase().removeChannel(channel);
    };
  }, [loading, session, load, upper]);

  useEffect(() => {
    if (lobby?.status === "active") router.replace(`/play/${lobby.id}`);
  }, [lobby, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const call = async (fn: string, body: Record<string, unknown>) => {
    const reply = await callFunction(fn, { gameId: lobby?.id, ...body });
    if (!reply.ok) setToast(errorText(reply.code));
    else void load();
    return reply.ok;
  };

  if (problem) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold">Couldn&apos;t open the lobby</h1>
        <p className="mt-2 text-ink-soft" role="alert">
          {problem}
        </p>
        <Button className="mt-6" onClick={() => router.push("/")}>
          Home
        </Button>
      </main>
    );
  }
  if (!lobby || !session) {
    return (
      <main className="grid h-dvh place-items-center text-ink-soft" aria-busy="true">
        Opening lobby {upper}…
      </main>
    );
  }

  const me = seats.find((s) => s.userId === session.user.id);
  const isHost = lobby.host_user_id === session.user.id;
  const humans = seats.filter((s) => s.kind === "human");
  const canStart = seats.length >= 3 && humans.every((s) => s.ready);
  const startReason = seats.length < 3 ? "Needs at least 3 seats" : humans.every((s) => s.ready) ? null : "Everyone must be ready";
  const inviteLink = typeof window !== "undefined" ? `${window.location.origin}/join/${lobby.join_code}` : `/join/${lobby.join_code}`;
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setToast("Copy failed; select the text instead");
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-ink-soft">Join code</p>
          <p className="font-mono text-5xl font-semibold tracking-[0.2em]" data-testid="join-code">
            {lobby.join_code}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void copy(lobby.join_code, "code")}>{copied === "code" ? "Copied" : "Copy code"}</Button>
          <Button onClick={() => void copy(inviteLink, "link")} data-testid="invite-link">
            {copied === "link" ? "Copied" : "Copy invite link"}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {lobby.board === "beginner" ? "Beginner board" : "Random board"} · up to {lobby.max_players} players · {isHost ? "you are the host" : "waiting for the host to start"}
      </p>

      <section className="mt-6" aria-label="Seats">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Seats</h2>
        <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-white/40">
          {seats.map((s) => (
            <li key={s.playerId} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid={`seat-${s.seat}`}>
              <Swatch color={s.color} size={18} />
              {s.userId === session.user.id && nameDraft !== null ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void call("set-seat", { name: nameDraft }).then(() => setNameDraft(null));
                  }}
                >
                  <input className="w-40 rounded-md border border-line bg-white/60 px-2 py-1" value={nameDraft} maxLength={20} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
                  <Button size="sm" type="submit" variant="primary">
                    Save
                  </Button>
                </form>
              ) : (
                <span className="font-medium">{s.name}</span>
              )}
              {s.kind === "bot" ? (
                <span className="rounded border border-line px-1 text-[10px] uppercase tracking-wide text-ink-soft">bot · {s.botLevel}</span>
              ) : (
                <span className={`text-xs ${s.ready ? "text-wood" : "text-ink-soft"}`} data-testid={`ready-${s.seat}`}>
                  {s.ready ? "Ready" : "Not ready"}
                </span>
              )}
              {s.userId === lobby.host_user_id && <span className="text-xs text-ink-soft">host</span>}
              <span className="ml-auto flex flex-wrap gap-1">
                {s.userId === session.user.id && (
                  <>
                    {nameDraft === null && (
                      <Button size="sm" variant="quiet" onClick={() => setNameDraft(s.name)}>
                        Rename
                      </Button>
                    )}
                    {PLAYER_COLORS.filter((c) => !seats.some((x) => x.color === c)).map((c: PlayerColor) => (
                      <button key={c} type="button" aria-label={`Take ${c}`} title={`Take ${c}`} className="rounded-full p-0.5 hover:bg-parchment-deep" onClick={() => void call("set-seat", { color: c })}>
                        <Swatch color={c} size={16} />
                      </button>
                    ))}
                  </>
                )}
                {isHost && s.userId !== session.user.id && (
                  <Button size="sm" variant="quiet" onClick={() => void call("remove-player", { playerId: s.playerId })} data-testid={`remove-${s.seat}`}>
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
          {seats.length < lobby.max_players && <li className="px-3 py-2 text-sm text-ink-soft">Open seat</li>}
        </ul>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {me && (
          <Button variant={me.ready ? "secondary" : "primary"} onClick={() => void call("set-ready", { ready: !me.ready })} data-testid="ready">
            {me.ready ? "Not ready" : "I'm ready"}
          </Button>
        )}
        {isHost && seats.length < lobby.max_players && (
          <span className="flex items-center gap-1">
            <label className="sr-only" htmlFor="bot-level">
              Bot level
            </label>
            <select id="bot-level" className="rounded-md border border-line bg-white/60 px-2 py-2" value={botLevel} onChange={(e) => setBotLevel(e.target.value as BotLevel)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <Button onClick={() => void call("add-bot", { level: botLevel })} data-testid="add-bot">
              Add bot
            </Button>
          </span>
        )}
        {isHost && (
          <Button variant="primary" disabled={!canStart} reason={startReason ?? undefined} onClick={() => void call("start-game", {})} data-testid="start-game">
            Start game
          </Button>
        )}
        <Button
          variant="quiet"
          className="ml-auto"
          onClick={() => void call("leave-game", {}).then((ok) => ok && router.push("/"))}
          data-testid="leave"
        >
          Leave
        </Button>
      </div>
      {toast && (
        <p className="mt-4 text-sm text-clay" role="alert">
          {toast}
        </p>
      )}
    </main>
  );
}
