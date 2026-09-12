/**
 * Graphics quality (docs/phase7-5.md §7): presets, auto-detection from GL
 * limits and the device, and a frame-time watchdog that steps down one
 * level after 3 s over 33 ms per frame.
 */

import type { Quality } from "@/game/settings";

export type { Quality };

export interface QualityPreset {
  readonly shadows: boolean;
  readonly postfx: boolean;
  readonly propDensity: number;
  readonly dpr: number;
  readonly idleMotion: boolean;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  high: { shadows: true, postfx: true, propDensity: 1, dpr: 2, idleMotion: true },
  medium: { shadows: true, postfx: false, propDensity: 0.7, dpr: 1.5, idleMotion: true },
  low: { shadows: false, postfx: false, propDensity: 0.4, dpr: 1, idleMotion: false },
};

export const QUALITY_ORDER: readonly Quality[] = ["high", "medium", "low"];

export function stepDown(q: Quality): Quality | null {
  const i = QUALITY_ORDER.indexOf(q);
  return i < 0 || i === QUALITY_ORDER.length - 1 ? null : (QUALITY_ORDER[i + 1] as Quality);
}

export interface DeviceInfo {
  readonly maxTextureSize: number;
  readonly maxRenderbufferSize: number;
  readonly dpr: number;
  readonly cores: number;
  readonly mobile: boolean;
  readonly software: boolean;
}

/** A conservative guess on first load; the watchdog corrects it. */
export function detectQuality(info: DeviceInfo): Quality {
  if (info.software) return "low";
  if (info.maxTextureSize < 4096 || info.maxRenderbufferSize < 4096) return "low";
  if (info.mobile) return info.cores >= 6 && info.dpr <= 3 ? "medium" : "low";
  if (info.cores >= 8 && info.maxTextureSize >= 8192) return "high";
  return "medium";
}

export function readDeviceInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): DeviceInfo {
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  const nav = typeof navigator === "undefined" ? null : navigator;
  return {
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
    maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0,
    dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    cores: nav?.hardwareConcurrency ?? 4,
    mobile: nav ? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent) : false,
    software: /SwiftShader|llvmpipe|Software/i.test(renderer),
  };
}

/**
 * Tracks frame times; `sample` returns true once when frames have exceeded
 * `thresholdMs` continuously for `windowMs`. Resets after firing.
 */
export class FrameWatchdog {
  private slowSince: number | null = null;

  constructor(
    private readonly thresholdMs = 33,
    private readonly windowMs = 3000,
  ) {}

  sample(frameMs: number, now: number): boolean {
    if (frameMs <= this.thresholdMs) {
      this.slowSince = null;
      return false;
    }
    if (this.slowSince === null) {
      this.slowSince = now;
      return false;
    }
    if (now - this.slowSince >= this.windowMs) {
      this.slowSince = null;
      return true;
    }
    return false;
  }
}
