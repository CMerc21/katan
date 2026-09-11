"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GameScreen } from "@/components/GameScreen";
import type { GameDriver } from "@/driver/types";
import { currentDriver } from "@/game/store";

/** The game (docs/phase3.md §3.2). Redirects to `/` when no game is in memory. */
export default function PlayPage() {
  const router = useRouter();
  const [driver, setDriver] = useState<GameDriver | null>(null);

  useEffect(() => {
    const d = currentDriver();
    if (!d) router.replace("/");
    else setDriver(d);
  }, [router]);

  if (!driver) return null;
  return <GameScreen driver={driver} />;
}
