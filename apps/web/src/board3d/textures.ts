"use client";

/**
 * Canvas-baked textures (docs/props.md §5, §6): the recessed face of a
 * number token (numeral and pips), harbour signs, the barbarian ship glyph on
 * the event die's black faces and a walnut grain for the table. All drawn at
 * runtime; nothing is fetched.
 */

import * as THREE from "three";
import type { PortKind, Resource } from "@katan/engine";
import { RESOURCE_SHORT, portLabel } from "@/game/labels";
import { INK, PARCHMENT, RESOURCE_COLOR } from "@/game/theme";
import { EVENT_FLEET, TABLE_WALNUT, TOKEN_CLAY, TOKEN_HOT } from "./palette";

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

/** The recessed face of a number token: clay (red for 6 and 8), the numeral, pips below it. */
export function tokenTexture(n: number): THREE.Texture {
  const key = `token:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(256, 256);
  const hot = n === 6 || n === 8;
  ctx.fillStyle = hot ? TOKEN_HOT : TOKEN_CLAY;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  // The recessed face: a slightly darker disc with a soft shadow along its upper rim.
  ctx.fillStyle = hot ? "#b64b36" : "#b98a5f";
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.fill();
  const shade = ctx.createLinearGradient(0, 16, 0, 96);
  shade.addColorStop(0, "rgba(40,20,10,0.28)");
  shade.addColorStop(1, "rgba(40,20,10,0)");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 124px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = hot ? "#f6ead3" : INK;
  ctx.fillText(String(n), 128, 112);
  const pips = PIPS[n] ?? 0;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(128 + (i - (pips - 1) / 2) * 22, 196, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(key, c);
}

/** A hanging harbour sign: the resource colour and its name, or "3:1" on parchment. */
export function signTexture(kind: PortKind): THREE.Texture {
  const key = `sign:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(256, 176);
  ctx.fillStyle = kind === "any" ? PARCHMENT : RESOURCE_COLOR[kind];
  ctx.fillRect(0, 0, 256, 176);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 244, 164);
  ctx.fillStyle = kind === "any" ? INK : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 84px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillText(portLabel(kind), 128, 66);
  ctx.font = "bold 48px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillText(kind === "any" ? "any" : RESOURCE_SHORT[kind as Resource], 128, 132);
  return finish(key, c);
}

/** Walnut with a faint grain, tiled across the table (docs/props.md §6). */
export function woodTexture(): THREE.Texture {
  const key = "wood";
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = TABLE_WALNUT;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 110; i++) {
    const y = Math.random() * 512;
    const light = Math.random() > 0.5;
    ctx.strokeStyle = light ? `rgba(${120 + Math.random() * 40},${80 + Math.random() * 25},${50 + Math.random() * 15},${0.1 + Math.random() * 0.16})` : `rgba(40,22,12,${0.1 + Math.random() * 0.18})`;
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

/** The event die's fleet face (docs/props.md §5): black with a small ship glyph. */
export function fleetFaceTexture(): THREE.Texture {
  const key = "eventDie:fleet";
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(128, 128);
  ctx.fillStyle = EVENT_FLEET;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#8a857d";
  ctx.beginPath();
  ctx.moveTo(66, 26);
  ctx.lineTo(66, 80);
  ctx.lineTo(98, 72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c9c4bb";
  ctx.beginPath();
  ctx.moveTo(28, 84);
  ctx.lineTo(102, 84);
  ctx.lineTo(90, 102);
  ctx.lineTo(40, 102);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#c9c4bb";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 20);
  ctx.lineTo(64, 86);
  ctx.stroke();
  return finish(key, c);
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
