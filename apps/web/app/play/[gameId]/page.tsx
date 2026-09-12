"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { GameScreen } from "@/components/GameScreen";
import { Button } from "@/components/ui";
import { SupabaseDriver, createSupabaseApi } from "@/driver/supabase";
import { errorText } from "@/game/labels";
import { adoptRemoteSettings, setRemoteSettingsSync } from "@/game/settings";
import { useRequireSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";

/** The online game (docs/phase4.md §7), driven by SupabaseDriver. */
export default function OnlinePlayPage() {
  const router = useRouter();
  const { gameId } = useParams<{ gameId: string }>();
  const { session, loading } = useRequireSession();
  const [driver, setDriver] = useState<SupabaseDriver | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !session) return;
    let active = true;
    let created: SupabaseDriver | null = null;
    void (async () => {
      try {
        const client = supabase();
        // Settings follow the player across devices (docs/phase7.md §2.1): profile metadata mirrors localStorage.
        adoptRemoteSettings((session.user.user_metadata as { settings?: unknown }).settings);
        setRemoteSettingsSync((s) => void client.auth.updateUser({ data: { settings: s } }).catch(() => undefined));
        const api = createSupabaseApi(client, session.user.id);
        const d = await SupabaseDriver.connect(api, gameId, session.user.id);
        const { data: lobby } = await client.from("lobby_games").select("host_user_id, status").eq("id", gameId).maybeSingle();
        d.host = (lobby?.host_user_id as string | null) ?? null;
        if (lobby?.status === "lobby") {
          const { data: code } = await client.from("lobby_games").select("join_code").eq("id", gameId).maybeSingle();
          if (code?.join_code) router.replace(`/lobby/${code.join_code}`);
          return;
        }
        if (!active) {
          d.close();
          return;
        }
        created = d;
        setDriver(d);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "NETWORK";
        if (active) setProblem(errorText(code));
      }
    })();
    return () => {
      active = false;
      setRemoteSettingsSync(null);
      created?.close();
    };
  }, [gameId, session, loading, router]);

  if (problem) {
    return (
      <main className="parchment mx-auto my-8 max-w-md rounded-lg px-6 py-8">
        <h1 className="text-2xl font-semibold">Can&apos;t open this game</h1>
        <p className="mt-2 text-ink-soft">{problem}</p>
        <Button className="mt-6" onClick={() => router.push("/")}>
          Back to your games
        </Button>
      </main>
    );
  }
  if (!driver) {
    return (
      <main className="grid h-dvh place-items-center text-ink-soft" aria-busy="true">
        Joining the table…
      </main>
    );
  }
  return <GameScreen driver={driver} onExit={() => router.push("/")} />;
}
