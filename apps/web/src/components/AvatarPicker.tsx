"use client";

import { useState } from "react";
import { AVATAR_LAYERS, cycleLayer, randomAvatar, type AvatarSpec } from "@katan/avatars";
import type { PlayerColor } from "@katan/engine";
import { Avatar } from "./Avatar";
import { Button } from "./ui";

/** Shuffle plus a small per-layer picker (docs/phase7.md §4). */
export function AvatarPicker({ spec, color, name, onChange, size = 56, compact = false }: { spec: AvatarSpec; color: PlayerColor; name: string; onChange: (spec: AvatarSpec) => void; size?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Avatar spec={spec} color={color} name={name} size={size} />
      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <Button size="sm" onClick={() => onChange(randomAvatar(Math.random))} data-testid="avatar-shuffle">
            Shuffle
          </Button>
          {!compact && (
            <Button size="sm" variant="quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="avatar-customise">
              {open ? "Done" : "Customise"}
            </Button>
          )}
        </div>
        {open && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs" data-testid="avatar-layers">
            {AVATAR_LAYERS.map((l) => (
              <span key={l.key} className="flex items-center justify-between gap-1">
                <span className="text-ink-soft">{l.label}</span>
                <span className="flex items-center gap-0.5">
                  <button type="button" className="rounded px-1 hover:bg-parchment-deep" aria-label={`Previous ${l.label}`} onClick={() => onChange(cycleLayer(spec, l.key, -1))}>
                    ‹
                  </button>
                  <span className="w-16 truncate text-center">{l.options[spec[l.key]]}</span>
                  <button type="button" className="rounded px-1 hover:bg-parchment-deep" aria-label={`Next ${l.label}`} onClick={() => onChange(cycleLayer(spec, l.key))}>
                    ›
                  </button>
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
