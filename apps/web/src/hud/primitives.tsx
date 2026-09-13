"use client";

/**
 * Shared HUD building blocks (docs/phase12.md §6, §8): the animated numeral
 * (bump on change, a floating ±N), the help-tip provider (a dark panel with
 * a white tab anchored to the hovered element), and the `hud:*` window
 * events the sound layer consumes.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export type HudEvent = "hud:tick" | "hud:open";

export function hudEmit(name: HudEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

// ---------------------------------------------------------------------------
// Numeral

/** A number that bumps (1.3 → 1, 250 ms) and floats a ±N whenever it changes. Never jumps. */
export function Numeral({ value, className = "", testId, label }: { value: number; className?: string; testId?: string; label?: string }) {
  const previous = useRef(value);
  const [bump, setBump] = useState(0);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);
  useEffect(() => {
    if (value === previous.current) return;
    const n = value - previous.current;
    previous.current = value;
    setBump((k) => k + 1);
    setDelta({ n, key: Date.now() });
    hudEmit("hud:tick");
    const t = setTimeout(() => setDelta(null), 900);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className={`relative inline-block ${className}`} data-testid={testId} aria-label={label ? `${value} ${label}` : undefined}>
      <span key={bump} className={`hud-num ${bump > 0 ? "hud-bump" : ""}`}>
        {value}
      </span>
      {delta && (
        <span key={delta.key} className="hud-delta" data-sign={delta.n > 0 ? "+" : "-"} aria-hidden>
          {delta.n > 0 ? `+${delta.n}` : delta.n}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits

/** A dark chip with optional keyboard hint. */
export function Chip({ children, testId, role, className = "" }: { children: ReactNode; testId?: string; role?: string; className?: string }) {
  return (
    <span className={`hud-chip hud-panel ${className}`} data-testid={testId} role={role}>
      {children}
    </span>
  );
}

/** Emit `hud:open` once when a panel mounts. */
export function useOpenSound(): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    hudEmit("hud:open");
  }, []);
}
