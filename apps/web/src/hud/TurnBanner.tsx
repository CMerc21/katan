"use client";

/**
 * The turn ribbon (docs/phase12.md §6): a dark panel with gold display text
 * and the player's colour as a left bar. It appears at 22 % from the top,
 * shrinks to 60 % after 1.5 s and docks under the top banners before fading.
 */

import { useEffect, useState, type CSSProperties } from "react";
import type { RedactedState, SeatInfo } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { Avatar } from "@/components/Avatar";
import { HUD_PLAYER_COLOR } from "./PlayerBanner";

const SHOW_MS = 2600;

export function TurnBanner({ step, view, seats }: { step: Step | null; view: RedactedState; seats: SeatInfo[] | undefined }) {
  const event = step?.kind === "event" && step.event.kind === "turnStarted" ? step.event : null;
  const [shown, setShown] = useState<{ id: string; key: number } | null>(null);
  useEffect(() => {
    if (!event) return;
    // An instant queue (animations off) skips the ribbon altogether.
    if ((step?.duration ?? 0) === 0) return;
    setShown({ id: event.playerId, key: event.seq });
    const t = setTimeout(() => setShown(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [event, step?.duration]);
  if (!shown) return null;
  const p = view.players.find((x) => x.id === shown.id);
  if (!p) return null;
  const seat = seats?.find((s) => s.playerId === p.id);
  return (
    <div key={shown.key} className="hud-turn-banner hud-panel" style={{ "--player": HUD_PLAYER_COLOR[p.color] } as CSSProperties} data-testid="turn-banner" role="status">
      <Avatar spec={seat?.avatar} color={p.color} name={p.name} size={36} />
      <span>{p.id === view.viewer ? "Your turn" : `${p.name}'s turn`}</span>
    </div>
  );
}
