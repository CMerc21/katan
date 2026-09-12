"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HotseatStart } from "@/components/HotseatStart";
import { Button } from "@/components/ui";
import { errorText } from "@/game/labels";
import { useSession } from "@/hooks/useSession";
import { callFunction, displayNameOf, signOut, supabase } from "@/lib/supabase";

interface MyGame {
  id: string;
  join_code: string;
  status: "lobby" | "active" | "ended";
  created_at: string;
}

/** Home: create or join an online game, see your games, or play hotseat (docs/phase5.md §1–§2). */
export default function HomePage() {
  const router = useRouter();
  const { session, loading, configured } = useSession();
  const [board, setBoard] = useState<"beginner" | "random">("beginner");
  const [maxPlayers, setMaxPlayers] = useState<3 | 4>(4);
  const [code, setCode] = useState("");
  const [games, setGames] = useState<MyGame[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!configured || !session) return;
    void supabase()
      .from("lobby_games")
      .select("id, join_code, status, created_at")
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .then(({ data }) => setGames((data ?? []) as MyGame[]));
  }, [configured, session]);

  const create = async () => {
    if (!session) return;
    setBusy(true);
    setProblem(null);
    const reply = await callFunction<{ gameId: string; joinCode: string }>("create-lobby", { board, maxPlayers, name: displayNameOf(session) });
    setBusy(false);
    if (!reply.ok) return setProblem(errorText(reply.code));
    router.push(`/lobby/${reply.joinCode}`);
  };

  return (
    <main className="parchment mx-auto my-8 max-w-lg rounded-lg px-6 py-8">
      <h1 className="font-display text-4xl font-semibold">Katan</h1>
      <p className="mt-1 text-ink-soft">A hex settlement game for friends.</p>

      {configured && (
        <section className="ink-rule mt-8 pb-6" aria-label="Play online">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl font-semibold">Play online</h2>
            {session ? (
              <span className="text-sm text-ink-soft">
                {displayNameOf(session)} ·{" "}
                <button type="button" className="underline" onClick={() => void signOut()}>
                  sign out
                </button>
              </span>
            ) : (
              !loading && (
                <Link className="text-sm underline" href="/login?next=/">
                  Sign in
                </Link>
              )
            )}
          </div>

          {session ? (
            <>
              {games.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Your games</h3>
                  <ul className="mt-1 divide-y divide-line" data-testid="my-games">
                    {games.map((g) => (
                      <li key={g.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span>
                          <span className="font-mono">{g.join_code}</span> · {g.status === "lobby" ? "in lobby" : "in play"}
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
                className="mt-4 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Create a game</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant={board === "beginner" ? "primary" : "secondary"} onClick={() => setBoard("beginner")} size="sm">
                    Beginner board
                  </Button>
                  <Button variant={board === "random" ? "primary" : "secondary"} onClick={() => setBoard("random")} size="sm">
                    Random board
                  </Button>
                  <Button variant={maxPlayers === 3 ? "primary" : "secondary"} onClick={() => setMaxPlayers(3)} size="sm">
                    3 players
                  </Button>
                  <Button variant={maxPlayers === 4 ? "primary" : "secondary"} onClick={() => setMaxPlayers(4)} size="sm">
                    4 players
                  </Button>
                </div>
                <Button type="submit" variant="primary" disabled={busy} data-testid="create-lobby">
                  Create game
                </Button>
              </form>

              <form
                className="mt-4 flex items-end gap-2"
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
                <p className="mt-3 text-sm text-clay" role="alert">
                  {problem}
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">Sign in with your email to create a game or join with a code.</p>
          )}
        </section>
      )}

      <section className="mt-8" aria-label="Hotseat">
        <h2 className="font-display text-xl font-semibold">Hotseat on this device</h2>
        <p className="mb-4 text-sm text-ink-soft">Everyone shares this screen. Seats can be bots.</p>
        <HotseatStart />
      </section>
    </main>
  );
}
