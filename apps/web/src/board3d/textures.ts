"use client";

/**
 * Canvas-baked textures (docs/props.md §5, §6): the recessed face of a
 * number token (numeral and pips), harbour signs, the barbarian ship glyph on
 * the event die's black faces and a walnut grain for the table. All drawn at
 * runtime; nothing is fetched.
 */

import * as THREE from "three";
import { MAX_LEVEL, TRACKS, type PortKind, type Resource, type Track } from "@katan/engine";
import { RESOURCE_SHORT, TRACK_LABEL, portLabel } from "@/game/labels";
import { INK, PARCHMENT, RESOURCE_COLOR, TRACK_COLOR } from "@/game/theme";
import { EVENT_FLEET, TABLE_WALNUT, TOKEN_CLAY, TOKEN_FACE, TOKEN_HOT } from "./palette";

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

/**
 * The recessed face of a number token: a clay rim (red for 6 and 8) around a
 * pale bone face, the numeral in ink (wax red on 6 and 8), pips below it. The
 * face used to be a darker clay under an ink numeral, which is about 3:1 and
 * unreadable at the token's on-screen size; bone under ink is 12:1.
 */
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
  ctx.fillStyle = TOKEN_FACE;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.fill();
  // A soft shadow along the upper rim so the face still reads as recessed.
  const shade = ctx.createLinearGradient(0, 18, 0, 90);
  shade.addColorStop(0, "rgba(40,20,10,0.22)");
  shade.addColorStop(1, "rgba(40,20,10,0)");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 150px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = hot ? TOKEN_HOT : INK;
  ctx.fillText(String(n), 128, 116);
  const pips = PIPS[n] ?? 0;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(128 + (i - (pips - 1) / 2) * 20, 204, 6.5, 0, Math.PI * 2);
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

/**
 * The face of a port disc (docs/props.md §5): the resource's colour as a
 * broad ring (ink on parchment for a 3:1 port) around a bone face with the
 * ratio large and the resource's short name under it. It sits on the sea
 * beside the pier, where the hanging sign was too small to read from the
 * table view, and turns to face the camera like a number token.
 */
export function portTokenTexture(kind: PortKind): THREE.Texture {
  const key = `portToken:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = canvas(256, 256);
  const ring = kind === "any" ? INK : RESOURCE_COLOR[kind];
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TOKEN_FACE;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 96px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillText(portLabel(kind), 128, 110);
  ctx.font = "bold 44px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillStyle = kind === "any" ? INK : ring;
  ctx.fillText(kind === "any" ? "ANY" : RESOURCE_SHORT[kind as Resource].toUpperCase(), 128, 178);
  return finish(key, c);
}

/**
 * A player's city improvement card (docs/phase12.md §4): a band in the
 * player's colour with their name, then one column per track, five cells
 * from level 1 at the bottom, filled in the track's colour to the level
 * reached, the third cell (the ability level) ringed in gold and a gold
 * crown over a track whose metropolis the player holds. Portrait, 256 × 324,
 * the card's own aspect.
 */
export function improvementCardTexture(name: string, color: string, tracks: Record<Track, number>, metropolises: Record<Track, boolean>): THREE.Texture {
  const key = `card:${color}:${name}:${TRACKS.map((t) => `${tracks[t]}${metropolises[t] ? "m" : ""}`).join("")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 256;
  const H = 324;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = PARCHMENT;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  // The name band.
  ctx.fillStyle = color;
  ctx.fillRect(4, 4, W - 8, 46);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 28px 'Palatino Linotype', Palatino, Georgia, serif";
  ctx.fillText(name.length > 12 ? `${name.slice(0, 11)}…` : name, W / 2, 28);
  // Three columns.
  const colW = (W - 24) / 3;
  const cellH = 34;
  const cellW = colW - 18;
  const top = 96;
  TRACKS.forEach((t, i) => {
    const x0 = 12 + i * colW;
    ctx.fillStyle = TRACK_COLOR[t];
    ctx.font = "bold 20px 'Palatino Linotype', Palatino, Georgia, serif";
    ctx.fillText(TRACK_LABEL[t], x0 + colW / 2, 74);
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const y = top + (MAX_LEVEL - level) * (cellH + 6);
      const x = x0 + (colW - cellW) / 2;
      ctx.fillStyle = level <= tracks[t] ? TRACK_COLOR[t] : "rgba(33,29,25,0.12)";
      ctx.fillRect(x, y, cellW, cellH);
      ctx.strokeStyle = level === 3 ? "#d9a437" : "rgba(33,29,25,0.45)";
      ctx.lineWidth = level === 3 ? 4 : 2;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.fillStyle = level <= tracks[t] ? "#ffffff" : "rgba(33,29,25,0.5)";
      ctx.font = "bold 18px 'Palatino Linotype', Palatino, Georgia, serif";
      ctx.fillText(String(level), x + cellW / 2, y + cellH / 2 + 1);
    }
    if (metropolises[t]) {
      // A gold crown over the column.
      const cx = x0 + colW / 2;
      const cy = top - 10;
      ctx.fillStyle = "#d9a437";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 20, cy + 8);
      ctx.lineTo(cx - 20, cy - 8);
      ctx.lineTo(cx - 9, cy);
      ctx.lineTo(cx, cy - 12);
      ctx.lineTo(cx + 9, cy);
      ctx.lineTo(cx + 20, cy - 8);
      ctx.lineTo(cx + 20, cy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  });
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
