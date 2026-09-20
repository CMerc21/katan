/**
 * Graphics quality (docs/phase7-5.md §6): presets, auto-detection from GL
 * limits and the device, and a frame-time watchdog that steps down one
 * level only after sustained slow frames (never a single hitch, never the
 * first seconds of load).
 */

import type { Quality } from "@/game/settings";

export type { Quality };

export interface QualityPreset {
  readonly shadows: boolean;
  readonly postfx: boolean;
  readonly propDensity: number;
  /** Cap on the canvas pixel ratio; the canvas renders at `min(devicePixelRatio, dpr)` (see `resolveDpr`). */
  readonly dpr: number;
  readonly idleMotion: boolean;
  /** Shadow map size (docs/props.md §6: 2048 on High); 0 when shadows are off. */
  readonly shadowMap: number;
  /**
   * `scene.environmentIntensity` for the image-based light (`environment.ts`).
   * Zero skips the environment altogether: sampling it costs a lookup per
   * fragment on every standard material, which a software rasterizer cannot
   * afford (it measured 2.3x the frame time on SwiftShader).
   */
  readonly envIntensity: number;
  /** Contact shadows under the pieces and props: a second pass over the scene, so High only. */
  readonly contactShadows: boolean;
  /** Bloom on the lit openings. A separate blur chain, so High only. */
  readonly bloom: boolean;
}

/** The hard cap on the render pixel ratio, whatever the display reports. */
export const MAX_DPR = 2;

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  high: { shadows: true, postfx: true, propDensity: 1, dpr: MAX_DPR, idleMotion: true, shadowMap: 2048, envIntensity: 0.22, contactShadows: true, bloom: true },
  // Post-FX moved to Medium: the vignette is cheap next to the shadow pass.
  medium: { shadows: true, postfx: true, propDensity: 0.7, dpr: MAX_DPR, idleMotion: true, shadowMap: 1024, envIntensity: 0.22, contactShadows: false, bloom: false },
  // No environment on Low: it is the preset auto-detection picks for software
  // renderers and weak mobile, which is exactly where the per-fragment cost
  // hurts. `Lights` raises the hemisphere fill to make up the ambient.
  low: { shadows: false, postfx: false, propDensity: 0.4, dpr: 1, idleMotion: false, shadowMap: 0, envIntensity: 0, contactShadows: false, bloom: false },
};

/** Where the active preset came from: the user's setting, auto-detection, or a watchdog step-down. */
export type QualitySource = "manual" | "auto" | "watchdog";

export const QUALITY_ORDER: readonly Quality[] = ["high", "medium", "low"];

/** The pixel ratio the canvas actually renders at: the true device ratio, capped by the preset (and never below 1). */
export function resolveDpr(quality: Quality, deviceDpr: number): number {
  const d = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.max(1, Math.min(d, QUALITY_PRESETS[quality].dpr));
}

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

export interface WatchdogOptions {
  /** A frame longer than this is "slow". */
  readonly thresholdMs?: number;
  /** The sliding window the verdict is taken over. */
  readonly windowMs?: number;
  /** Samples in this long after start (and after each firing) are ignored: shader compiles and texture uploads. */
  readonly warmupMs?: number;
  /** The share of frames in the window that must be slow before it fires. */
  readonly slowFraction?: number;
  /** A frame longer than this is a stall (hidden tab, breakpoint), not a signal; it clears the window. */
  readonly stallMs?: number;
  /** Never judge fewer frames than this. */
  readonly minFrames?: number;
}

/**
 * Tracks frame times and asks for one step down when frames have been
 * slow for most of a sustained window. `sample` returns true once when,
 * after the warm-up, at least `slowFraction` of the frames spanning a
 * full `windowMs` were over `thresholdMs`. A single hitch never fires it,
 * a fast frame never resets it, and a stall (a hidden tab) discards the
 * window instead of counting as one giant slow frame. After firing it
 * clears and warms up again so the new preset's own compiles are ignored.
 */
export class FrameWatchdog {
  private readonly thresholdMs: number;
  private readonly windowMs: number;
  private readonly warmupMs: number;
  private readonly slowFraction: number;
  private readonly stallMs: number;
  private readonly minFrames: number;
  private armedAt: number | null = null;
  private frames: { at: number; slow: boolean }[] = [];

  constructor(opts: WatchdogOptions = {}) {
    this.thresholdMs = opts.thresholdMs ?? 33;
    this.windowMs = opts.windowMs ?? 5000;
    this.warmupMs = opts.warmupMs ?? 5000;
    this.slowFraction = opts.slowFraction ?? 0.75;
    this.stallMs = opts.stallMs ?? 1000;
    this.minFrames = opts.minFrames ?? 10;
  }

  sample(frameMs: number, now: number): boolean {
    if (this.armedAt === null) this.armedAt = now + this.warmupMs;
    if (frameMs > this.stallMs) {
      this.frames = [];
      return false;
    }
    if (now < this.armedAt) return false;
    this.frames.push({ at: now, slow: frameMs > this.thresholdMs });
    const from = now - this.windowMs;
    while (this.frames.length > 0 && this.frames[0]!.at < from) this.frames.shift();
    const first = this.frames[0]!;
    if (this.frames.length < this.minFrames || now - first.at < this.windowMs * 0.9) return false;
    const slow = this.frames.reduce((n, f) => n + (f.slow ? 1 : 0), 0);
    if (slow / this.frames.length < this.slowFraction) return false;
    this.frames = [];
    this.armedAt = now + this.warmupMs;
    return true;
  }
}
