"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useSettings, type AnimationSpeed, type Quality } from "@/game/settings";
import { Button } from "./ui";

/** Animation speed, sound, graphics quality and follow-turns (docs/phase7.md §2.1, §7; docs/phase7-5.md §3, §7). */
export function SettingsMenu({ showGraphics = false }: { showGraphics?: boolean }) {
  const [settings, update] = useSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const reduced = prefersReducedMotion();
  return (
    <div ref={box} className="relative">
      <Button size="sm" variant="quiet" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="settings" title="Settings">
        ⚙ <span className="sr-only">Settings</span>
      </Button>
      {open && (
        <div role="dialog" aria-label="Settings" className="parchment absolute bottom-full right-0 z-40 mb-2 w-64 rounded-md p-3 text-sm">
          <fieldset>
            <legend className="font-semibold">Animation speed</legend>
            <div className="mt-1 flex gap-1" role="radiogroup">
              {(["normal", "fast", "off"] as AnimationSpeed[]).map((s) => (
                <Button key={s} size="sm" role="radio" aria-checked={settings.animation === s} variant={settings.animation === s ? "primary" : "secondary"} onClick={() => update({ animation: s })} data-testid={`speed-${s}`}>
                  {s === "normal" ? "Normal" : s === "fast" ? "Fast" : "Off"}
                </Button>
              ))}
            </div>
            {reduced && <p className="mt-1 text-xs text-ink-soft">Your system prefers reduced motion, so animations are off.</p>}
          </fieldset>
          <label className="mt-3 flex items-center gap-2">
            <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} data-testid="sound-toggle" />
            Sound
          </label>
          {showGraphics && (
            <>
              <fieldset className="mt-3">
                <legend className="font-semibold">Graphics</legend>
                <div className="mt-1 flex gap-1" role="radiogroup">
                  {(["auto", "high", "medium", "low"] as (Quality | "auto")[]).map((q) => (
                    <Button key={q} size="sm" role="radio" aria-checked={settings.quality === q} variant={settings.quality === q ? "primary" : "secondary"} onClick={() => update({ quality: q })} data-testid={`quality-${q}`}>
                      {q[0]!.toUpperCase() + q.slice(1)}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <label className="mt-3 flex items-center gap-2">
                <input type="checkbox" checked={settings.followTurns} onChange={(e) => update({ followTurns: e.target.checked })} data-testid="follow-turns" />
                Follow turns with the camera
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
