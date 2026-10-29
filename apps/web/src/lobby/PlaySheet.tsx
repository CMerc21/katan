"use client";

/**
 * What Play opens (docs/phase13.md §1): Solo sets up a hotseat table on this
 * device (seats may be bots); Online returns you to your party's lobby or
 * your games, creates a new lobby, or joins one by code. The forms are the
 * Phase 5 ones on a parchment card, so their test ids are unchanged.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { BoardPicker, choiceDefinition, choiceForLobby, type BoardChoice } from "@/components/BoardPicker";
import { HotseatStart } from "@/components/HotseatStart";
import { Button } from "@/components/ui";
import { errorText } from "@/game/labels";
import { callFunction, displayNameOf } from "@/lib/supabase";
import type { MyGame, Party } from "./useParty";
import type { Wardrobe } from "./wardrobe";

export type Mode = "solo" | "online";

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <section className="lb-plaque lb-sheet lb-sheet-right w-[min(32rem,calc(100vw-1.5rem))] p-3" aria-label={title} data-testid="play-sheet">
      <header className="flex items-center justify-between px-1 pb-2">
        <h2 className="font-display text-xl text-[#ffe9a8]">{title}</h2>
        <button type="button" className="rounded px-2 text-2xl leading-none text-bone/70 hover:text-bone" aria-label="Close" onClick={onClose} data-testid="play-sheet-close">
          ×
        </button>
      </header>
      <div className="parchment parchment-card rounded-md px-4 py-4 text-ink">{children}</div>
    </section>
  );
}

function OnlineForms({ session, wardrobe, games, party }: { session: Session; wardrobe: Wardrobe; games: readonly MyGame[]; party: Party | null }) {
  const router = useRouter();
  const [board, setBoard] = useState<BoardChoice>({ kind: "builtin", id: "beginner" });
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  // How long a waited-on player may be away before the host can hand their seat to a bot (docs/phase5.md §4).
  const [absentMinutes, setAbsentMinutes] = useState<number>(10);
  const seatCap = choiceDefinition(board).seats.max;
  const players = Math.min(maxPlayers, seatCap);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    const reply = await callFunction<{ gameId: string; joinCode: string }>("create-lobby", {
      board: choiceForLobby(board),
      maxPlayers: players,
      name: displayNameOf(session),
      absentMinutes,
      avatar: wardrobe.avatar,
      color: wardrobe.color,
    });
    setBusy(false);
    if (!reply.ok) return setProblem(errorText(reply.code));
    router.push(`/lobby/${reply.joinCode}`);
  };

  return (
    <div className="space-y-5">
      {party && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-wax/40 bg-white/40 px-3 py-2">
          <span className="text-sm">
            Your party is in lobby <span className="font-mono font-semibold">{party.game.join_code}</span> · {party.seats.length}/{party.game.max_players} seated
          </span>
          <Button variant="primary" size="sm" onClick={() => router.push(`/lobby/${party.game.join_code}`)} data-testid="party-open">
            Open lobby
          </Button>
        </div>
      )}
      {games.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Your games</h3>
          <ul className="mt-1 divide-y divide-line" data-testid="my-games">
            {games.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>
                  <span className="font-mono">{g.join_code}</span> · {g.status === "lobby" ? "in lobby" : "in play"}
                  {g.board_name ? ` · ${g.board_name}` : ""}
                </span>
                <Link className="underline" href={g.status === "lobby" ? `/lobby/${g.join_code}` : `/play/${g.id}`}>
                  {g.status === "lobby" ? "Open lobby" : "Rejoin"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Create a game</h3>
        <BoardPicker value={board} onChange={setBoard} signedIn />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Player count">
          {Array.from({ length: seatCap - 2 }, (_, i) => i + 3).map((n) => (
            <Button key={n} role="radio" aria-checked={players === n} variant={players === n ? "primary" : "secondary"} onClick={() => setMaxPlayers(n)} size="sm" data-testid={`lobby-count-${n}`}>
              {n} players
            </Button>
          ))}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span>Hand an absent player to a bot after</span>
          <select className="rounded border border-line bg-white/60 px-2 py-1 text-sm" value={absentMinutes} onChange={(e) => setAbsentMinutes(Number(e.target.value))} aria-label="Absent threshold" data-testid="absent-minutes">
            {[2, 5, 10, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={busy} data-testid="create-lobby">
          Create game
        </Button>
      </form>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/join/${code.trim().toUpperCase()}`);
        }}
      >
        <label className="block text-sm">
          Join with a code
          <input className="mt-1 block w-36 rounded-md border border-line bg-white/60 px-3 py-1.5 font-mono uppercase tracking-widest" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} data-testid="join-code-input" />
        </label>
        <Button type="submit" disabled={code.trim().length !== 6} reason="Codes are 6 characters" data-testid="join">
          Join
        </Button>
      </form>
      {problem && (
        <p className="text-sm text-clay" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

export function PlaySheet({
  mode,
  session,
  configured,
  wardrobe,
  games,
  party,
  onClose,
}: {
  mode: Mode;
  session: Session | null;
  configured: boolean;
  wardrobe: Wardrobe;
  games: readonly MyGame[];
  party: Party | null;
  onClose: () => void;
}) {
  if (mode === "solo") {
    return (
      <Sheet title="Hotseat on this device" onClose={onClose}>
        <p className="mb-4 text-sm text-ink-soft">Everyone shares this screen. Seats can be bots.</p>
        <HotseatStart you={{ avatar: wardrobe.avatar }} />
      </Sheet>
    );
  }
  return (
    <Sheet title="Play online" onClose={onClose}>
      {!configured ? (
        <p className="text-sm text-ink-soft">Online play is not set up on this server. Hotseat games work: switch to Solo.</p>
      ) : session ? (
        <OnlineForms session={session} wardrobe={wardrobe} games={games} party={party} />
      ) : (
        <div className="text-sm">
          <p className="text-ink-soft">Sign in with your email to create a game, join with a code or invite friends.</p>
          <Link className="btn-wax mt-3 inline-block rounded-md px-3.5 py-2 font-medium" href="/login?next=/" data-testid="play-sign-in">
            Sign in
          </Link>
        </div>
      )}
    </Sheet>
  );
}
