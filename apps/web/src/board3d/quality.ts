/**
 * Graphics quality (docs/phase7-5.md §6): three presets the player picks
 * outright. There is no auto tier and no frame-time watchdog — the preset is
 * whatever the settings panel says.
 *
 * The tiers are deliberately close together: High is Medium with a 2048
 * shadow map and the rim light, and nothing else. Low is the one that really
 * differs (no shadows, reduced prop detail, one device pixel).
 */

import type { Quality } from "@/game/settings";

export type { Quality };

export interface QualityPreset {
  readonly shadows: boolean;
  /** The back light that separates a piece from the tile behind it; High only. */
  readonly rimLight: boolean;
  readonly propDensity: number;
  /** Cap on the canvas pixel ratio; the canvas renders at `min(devicePixelRatio, dpr)` (see `resolveDpr`). */
  readonly dpr: number;
  readonly idleMotion: boolean;
  /** Shadow map size (docs/props.md §6: 2048 on High); 0 when shadows are off. */
  readonly shadowMap: number;
}

/** The hard cap on the render pixel ratio, whatever the display reports. */
export const MAX_DPR = 2;

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  high: { shadows: true, rimLight: true, propDensity: 0.7, dpr: MAX_DPR, idleMotion: true, shadowMap: 2048 },
  medium: { shadows: true, rimLight: false, propDensity: 0.7, dpr: MAX_DPR, idleMotion: true, shadowMap: 1024 },
  low: { shadows: false, rimLight: false, propDensity: 0.4, dpr: 1, idleMotion: false, shadowMap: 0 },
};

export const QUALITY_ORDER: readonly Quality[] = ["high", "medium", "low"];

/** The pixel ratio the canvas actually renders at: the true device ratio, capped by the preset (and never below 1). */
export function resolveDpr(quality: Quality, deviceDpr: number): number {
  const d = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.max(1, Math.min(d, QUALITY_PRESETS[quality].dpr));
}
