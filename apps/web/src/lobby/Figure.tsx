"use client";

import { renderFigure, type AvatarSpec } from "@katan/avatars";
import type { PlayerColor } from "@katan/engine";
import { useMemo } from "react";
import { PLAYER_FILL } from "@/game/theme";

/**
 * A standing character (docs/phase13.md §2). `pop` replays a short bounce
 * whenever the outfit changes, so an equip reads as an equip.
 */
export function Figure({ spec, color, height, idle = false, pop = false, className = "", label }: { spec: AvatarSpec; color: PlayerColor; height?: number; idle?: boolean; pop?: boolean; className?: string; label?: string }) {
  const html = useMemo(() => renderFigure(spec, { color: PLAYER_FILL[color], ...(height === undefined ? {} : { height }), attrs: 'style="display:block;overflow:visible"' }), [spec, color, height]);
  const key = pop ? `${JSON.stringify(spec)}:${color}` : "still";
  return (
    <span className={`inline-block ${className}`} role="img" aria-label={label ?? "Your character"} data-figure={JSON.stringify(spec)} data-color={color}>
      <span key={key} className={`block ${pop ? "lb-figure-pop" : ""}`}>
        <span className={`block ${idle ? "lb-figure" : ""}`} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      </span>
    </span>
  );
}
