"use client";

import { renderAvatar, type AvatarSpec } from "@katan/avatars";
import type { PlayerColor } from "@katan/engine";
import { useMemo } from "react";
import { PARCHMENT_DEEP, PLAYER_FILL } from "@/game/theme";

/** A player's portrait (docs/phase7.md §4); an initial-on-swatch fallback for legacy seats. */
export function Avatar({ spec, color, name, size = 32, className = "" }: { spec: AvatarSpec | null | undefined; color: PlayerColor; name: string; size?: number; className?: string }) {
  const html = useMemo(() => (spec ? renderAvatar(spec, { color: PLAYER_FILL[color], background: PARCHMENT_DEEP, attrs: 'style="display:block"' }) : null), [spec, color]);
  if (!html) {
    return (
      <span
        aria-hidden
        className={`inline-grid shrink-0 place-items-center rounded-full border border-ink/60 text-xs font-bold ${className}`}
        style={{ width: size, height: size, background: PLAYER_FILL[color], color: color === "orange" || color === "white" ? "#211d19" : "#fff" }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 overflow-hidden rounded-full border border-ink/60 ${className}`}
      style={{ width: size, height: size, background: PARCHMENT_DEEP }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
