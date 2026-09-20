/**
 * The diorama's image-based light (docs/props.md §6): a procedural
 * equirectangular sky — cool zenith, warm horizon, warm ground bounce, a
 * bright blob where the key stands and a dim cool one opposite — pre-filtered
 * with `PMREMGenerator` and hung on `scene.environment`.
 *
 * Every `MeshStandardMaterial` in the scene is lit by this as well as by the
 * three lights; without it the materials have no ambient specular at all,
 * which is what made the slabs and figurines read as flat card. Nothing is
 * fetched: the gradient is drawn on a canvas at runtime, so the scene has no
 * CDN dependency and the visual baselines stay deterministic.
 */

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { ENV_GROUND, ENV_HORIZON, ENV_KEY_GLOW, ENV_NADIR, ENV_RIM_GLOW, ENV_ZENITH } from "./palette";

export const ENV_WIDTH = 512;
export const ENV_HEIGHT = 256;

/**
 * Where a direction at (`azimuth`, `elevation`) lands on the equirect canvas.
 * Mirrors three's `equirectUv` (u from `atan2(z, x)`, v from `asin(y)`) with
 * the row flipped, since a canvas texture's first row is v = 1.
 */
export function equirectPixel(azimuth: number, elevation: number, width = ENV_WIDTH, height = ENV_HEIGHT): { x: number; y: number } {
  const u = Math.atan2(Math.cos(azimuth), Math.sin(azimuth)) / (Math.PI * 2) + 0.5;
  const v = elevation / Math.PI + 0.5;
  return { x: u * width, y: (1 - v) * height };
}

/** A soft radial blob, drawn three times so it wraps across the seam. */
function blob(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, radius: number, color: string, alpha: number): void {
  const rgb = new THREE.Color(color);
  const r = Math.round(rgb.r * 255);
  const g = Math.round(rgb.g * 255);
  const b = Math.round(rgb.b * 255);
  for (const dx of [-ENV_WIDTH, 0, ENV_WIDTH]) {
    const grad = ctx.createRadialGradient(at.x + dx, at.y, 0, at.x + dx, at.y, radius);
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(at.x + dx - radius, at.y - radius, radius * 2, radius * 2);
  }
}

/**
 * The equirect sky. `keyAzimuth` / `keyElevation` place the bright blob so the
 * specular highlights agree with the directional key; the rim blob sits
 * opposite it.
 */
export function skyCanvas(keyAzimuth: number, keyElevation: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ENV_WIDTH;
  canvas.height = ENV_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  // Vertical ramp: zenith → horizon → ground bounce → nadir. The hard step at
  // the horizon is what gives curved surfaces a readable top-to-bottom shift.
  const ramp = ctx.createLinearGradient(0, 0, 0, ENV_HEIGHT);
  ramp.addColorStop(0, ENV_ZENITH);
  ramp.addColorStop(0.42, ENV_HORIZON);
  ramp.addColorStop(0.5, ENV_HORIZON);
  ramp.addColorStop(0.58, ENV_GROUND);
  ramp.addColorStop(1, ENV_NADIR);
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, ENV_WIDTH, ENV_HEIGHT);

  blob(ctx, equirectPixel(keyAzimuth, keyElevation), ENV_WIDTH * 0.22, ENV_KEY_GLOW, 0.9);
  blob(ctx, equirectPixel(keyAzimuth + Math.PI, keyElevation * 0.7), ENV_WIDTH * 0.26, ENV_RIM_GLOW, 0.45);
  return canvas;
}

/** Build the pre-filtered cube map. The caller owns it and must dispose it. */
export function buildEnvironment(renderer: THREE.WebGLRenderer, keyAzimuth: number, keyElevation: number): THREE.Texture {
  const source = new THREE.CanvasTexture(skyCanvas(keyAzimuth, keyElevation));
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(source);
  pmrem.dispose();
  source.dispose();
  return target.texture;
}

/**
 * Hangs the environment on the scene for as long as it is mounted. The map is
 * built once per renderer; `intensity` is applied separately so changing the
 * quality preset never rebuilds it.
 */
export function DioramaEnvironment({ intensity, keyAzimuth, keyElevation }: { intensity: number; keyAzimuth: number; keyElevation: number }): null {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const on = intensity > 0;
  const texture = useMemo(() => (on ? buildEnvironment(gl, keyAzimuth, keyElevation) : null), [on, gl, keyAzimuth, keyElevation]);

  useEffect(() => {
    if (!texture) return;
    const previous = scene.environment;
    scene.environment = texture;
    return () => {
      scene.environment = previous;
    };
  }, [scene, texture]);

  useEffect(() => () => texture?.dispose(), [texture]);

  useEffect(() => {
    if (!texture) return;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environmentIntensity = 1;
    };
  }, [scene, texture, intensity]);

  return null;
}
