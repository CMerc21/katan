"use client";

/**
 * Per-user settings (docs/phase7.md §2.1, §7; docs/phase7-5.md §7): animation
 * speed, sound, graphics quality, follow-turns camera. Stored in localStorage
 * and, when signed in, mirrored to the auth user's metadata so they follow
 * the player across devices. `prefers-reduced-motion` forces animations off.
 */

import { useCallback, useEffect, useState } from "react";

export type AnimationSpeed = "normal" | "fast" | "off";
export type Quality = "high" | "medium" | "low";

export interface Settings {
  readonly animation: AnimationSpeed;
  readonly sound: boolean;
  readonly quality: Quality | "auto";
  readonly followTurns: boolean;
}

export const DEFAULT_SETTINGS: Settings = { animation: "normal", sound: false, quality: "auto", followTurns: false };

const KEY = "katan.settings";
const listeners = new Set<(s: Settings) => void>();
let remoteSync: ((s: Settings) => void) | null = null;

function isSpeed(v: unknown): v is AnimationSpeed {
  return v === "normal" || v === "fast" || v === "off";
}
function isQuality(v: unknown): v is Quality | "auto" {
  return v === "high" || v === "medium" || v === "low" || v === "auto";
}

export function parseSettings(raw: unknown): Settings {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    animation: isSpeed(obj.animation) ? obj.animation : DEFAULT_SETTINGS.animation,
    sound: typeof obj.sound === "boolean" ? obj.sound : DEFAULT_SETTINGS.sound,
    quality: isQuality(obj.quality) ? obj.quality : DEFAULT_SETTINGS.quality,
    followTurns: typeof obj.followTurns === "boolean" ? obj.followTurns : DEFAULT_SETTINGS.followTurns,
  };
}

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parseSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(next: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode; keep in memory */
  }
  for (const cb of listeners) cb(next);
  remoteSync?.(next);
}

/** Install the "mirror to profile" hook (the online client does this once a session exists). */
export function setRemoteSettingsSync(fn: ((s: Settings) => void) | null): void {
  remoteSync = fn;
}

/** Merge settings that arrived from the profile (remote wins only when local storage is empty). */
export function adoptRemoteSettings(raw: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(KEY)) return;
  } catch {
    return;
  }
  const parsed = parseSettings(raw);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
  for (const cb of listeners) cb(parsed);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The animation speed actually used: reduced motion forces "off" (docs/phase7.md §2.1). */
export function effectiveSpeed(s: Settings): AnimationSpeed {
  return prefersReducedMotion() ? "off" : s.animation;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    setSettings(loadSettings());
    listeners.add(setSettings);
    return () => void listeners.delete(setSettings);
  }, []);
  const update = useCallback((patch: Partial<Settings>) => saveSettings({ ...loadSettings(), ...patch }), []);
  return [settings, update];
}
