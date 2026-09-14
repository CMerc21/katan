"use client";

/**
 * The Settings panel body (docs/phase7.md §2.1, §7; docs/phase7-5.md §3, §6):
 * animation speed, sound, graphics quality and follow-turns. Rendered inside
 * the left rail's Settings SidePanel (docs/phase12.md §3). The preset is the
 * player's outright: there is no auto tier and nothing changes it mid-game.
 */

import { prefersReducedMotion, useSettings, type AnimationSpeed, type Quality } from "@/game/settings";
import { Button } from "@/components/ui";

function label(q: string): string {
  return q[0]!.toUpperCase() + q.slice(1);
}

export function SettingsBody({ showGraphics = false }: { showGraphics?: boolean }) {
  const [settings, update] = useSettings();
  const reduced = prefersReducedMotion();
  return (
    <div className="text-sm">
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
            <div className="mt-1 flex flex-wrap gap-1" role="radiogroup">
              {(["high", "medium", "low"] as Quality[]).map((q) => (
                <Button key={q} size="sm" role="radio" aria-checked={settings.quality === q} variant={settings.quality === q ? "primary" : "secondary"} onClick={() => update({ quality: q })} data-testid={`quality-${q}`}>
                  {label(q)}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-soft" data-testid="quality-active" data-quality={settings.quality}>
              High adds a sharper shadow map and a rim light.
            </p>
          </fieldset>
          <label className="mt-3 flex items-center gap-2">
            <input type="checkbox" checked={settings.followTurns} onChange={(e) => update({ followTurns: e.target.checked })} data-testid="follow-turns" />
            Follow turns with the camera
          </label>
        </>
      )}
      <p className="mt-4 text-xs text-ink-soft">
        Keys: <kbd>E</kbd> end turn · <kbd>T</kbd> trade · <kbd>L</kbd> log · <kbd>Space</kbd> skip · <kbd>Esc</kbd> close
      </p>
    </div>
  );
}
