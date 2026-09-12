"use client";

/**
 * Canvas-baked textures (docs/phase7-5.md §1): token discs with an embossed
 * numeral and pips, harbour signs, a subtle wood grain for the table and a
 * paper grain for cards. All drawn at runtime; nothing is fetched.
 */

import * as THREE from "three";
import type { PortKind, Resource } from "@katan/engine";
import { RESOURCE_SHORT, portLabel } from "@/game/labels";
import { HOT_TOKEN, INK, PARCHMENT, RESOURCE_COLOR } from "@/game/theme";

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { c, ctx };
}

function finish(key: string, c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

/** The top face of a number token. */
export function tokenTexture(n: number): THREE.Texture {
  const key = `token:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(256, 256);
  const hot = n === 6 || n === 8;
  ctx.fillStyle = "#d9b58a";
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  // Paper grain
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(90,60,30,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ctx.strokeStyle = hot ? "#c9a227" : "#c19d70";
  ctx.lineWidth = hot ? 8 : 4;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "bold 118px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f6ead3";
  ctx.fillText(String(n), 131, 118);
  ctx.fillStyle = hot ? HOT_TOKEN : INK;
  ctx.fillText(String(n), 128, 114);
  const pips = PIPS[n] ?? 0;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(128 + (i - (pips - 1) / 2) * 22, 196, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(key, c);
}

/** A hanging harbour sign: ratio and resource abbreviation. */
export function signTexture(kind: PortKind): THREE.Texture {
  const key = `sign:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(256, 160);
  ctx.fillStyle = kind === "any" ? PARCHMENT : RESOURCE_COLOR[kind];
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 244, 148);
  ctx.fillStyle = kind === "any" ? INK : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 78px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillText(portLabel(kind), 128, 62);
  ctx.font = "bold 46px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillText(kind === "any" ? "any" : RESOURCE_SHORT[kind as Resource], 128, 122);
  return finish(key, c);
}

/** Dark walnut with a faint grain, tiled across the table. */
export function woodTexture(): THREE.Texture {
  const key = "wood";
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = "#3b2a1e";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 512;
    ctx.strokeStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 20},${35 + Math.random() * 15},${0.12 + Math.random() * 0.18})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin((x / 512) * Math.PI * 2 + i) * 6);
    ctx.stroke();
  }
  const t = finish(key, c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

/** Pips for one die face (1–6) on bone. */
export function dieFaceTexture(n: number): THREE.Texture {
  const key = `die:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(128, 128);
  ctx.fillStyle = "#f2ead6";
  ctx.fillRect(0, 0, 128, 128);
  const spots: Record<number, [number, number][]> = {
    1: [[64, 64]],
    2: [
      [36, 36],
      [92, 92],
    ],
    3: [
      [36, 36],
      [64, 64],
      [92, 92],
    ],
    4: [
      [36, 36],
      [92, 36],
      [36, 92],
      [92, 92],
    ],
    5: [
      [36, 36],
      [92, 36],
      [64, 64],
      [36, 92],
      [92, 92],
    ],
    6: [
      [36, 32],
      [92, 32],
      [36, 64],
      [92, 64],
      [36, 96],
      [92, 96],
    ],
  };
  ctx.fillStyle = "#2a2622";
  for (const [x, y] of spots[n] ?? []) {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(key, c);
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
