"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { errorText } from "@/game/labels";
import { useRequireSession } from "@/hooks/useSession";
import { callFunction, displayNameOf } from "@/lib/supabase";

/** Invite link: join by code then go to the lobby (docs/phase5.md §1). */
export default function JoinPage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const { session, loading } = useRequireSession();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !session) return;
    void (async () => {
      const reply = await callFunction<{ gameId: string; playerId: string }>("join-game", { code, name: displayNameOf(session) });
      if (!reply.ok) return setProblem(errorText(reply.code));
      router.replace(`/lobby/${code.toUpperCase()}`);
    })();
  }, [code, session, loading, router]);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      {problem ? (
        <>
          <h1 className="text-2xl font-semibold">Couldn&apos;t join</h1>
          <p className="mt-2 text-ink-soft" role="alert">
            {problem}
          </p>
          <Button className="mt-6" onClick={() => router.push("/")}>
            Home
          </Button>
        </>
      ) : (
        <p className="text-ink-soft" aria-busy="true">
          Joining game {code.toUpperCase()}…
        </p>
      )}
    </main>
  );
}
