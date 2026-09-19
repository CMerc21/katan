/**
 * The diorama's palette ladder (docs/props.md §1–§3).
 *
 * These pin the rule the palette used to break rather than the exact hexes,
 * so the colours stay free to be retuned. The bug class they exist to catch:
 * one hex serving two roles, which had the forest tile, the oak, the cabin
 * roof, the cactus and the reeds all on `#6FA35C` — so trees were painted the
 * same colour as the ground under them — and left `gold` byte-identical to
 * `mountain` and `lake` byte-identical to `wasteland`.
 */

import { describe, expect, it } from "vitest";
import type { Terrain } from "@katan/engine";
import * as P from "@/board3d/palette";

/** WCAG relative luminance: the value axis these rules are stated on. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** A hero prop has to separate from the tile it stands on. */
const HERO_GAP = 0.1;
/** Detail inside a prop only has to separate from that prop. */
const DETAIL_GAP = 0.08;
/** Neighbours on the terrain ladder. */
const LADDER_GAP = 0.04;

describe("docs/props.md §2 terrain ladder", () => {
  it("gives every terrain its own colour", () => {
    const entries = Object.entries(P.TERRAIN_TOP) as [Terrain, string][];
    const seen = new Map<string, Terrain>();
    for (const [terrain, hex] of entries) {
      const clash = seen.get(hex.toUpperCase());
      expect(clash, `${terrain} and ${clash} share ${hex}`).toBeUndefined();
      seen.set(hex.toUpperCase(), terrain);
    }
    expect(seen.size).toBe(entries.length);
  });

  it("spreads the terrains over a readable luminance range", () => {
    const values = Object.values(P.TERRAIN_TOP).map(luminance).sort((a, b) => a - b);
    const lightest = values[values.length - 1]!;
    // The board used to sit inside a 0.31 band with three terrains within 0.02
    // of each other; in greyscale they were the same tile.
    expect(lightest - values[0]!).toBeGreaterThan(0.45);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]! - values[i - 1]!, `terrains ${i - 1} and ${i} are too close in value`).toBeGreaterThanOrEqual(LADDER_GAP);
    }
  });
});

describe("docs/props.md §3 props read against their tile", () => {
  const heroes: [Terrain, string, string][] = [
    ["forest", "PINE_LIGHT", P.PINE_LIGHT],
    ["forest", "OAK", P.OAK],
    ["forest", "CABIN", P.CABIN],
    ["claypit", "TERRACE_LOW", P.TERRACE_LOW],
    ["claypit", "KILN", P.KILN],
    ["mountain", "ROCK_GREY", P.ROCK_GREY],
    ["mountain", "SNOW", P.SNOW],
    ["meadow", "WOOL", P.WOOL],
    ["meadow", "STONE_WALL", P.STONE_WALL],
    ["farmland", "WHEAT", P.WHEAT],
    ["wasteland", "CACTUS", P.CACTUS],
    ["wasteland", "DESERT_ROCK", P.DESERT_ROCK],
    ["lake", "REED", P.REED],
  ];

  it.each(heroes)("%s: %s separates from the tile", (terrain, _name, hex) => {
    expect(Math.abs(luminance(hex) - luminance(P.TERRAIN_TOP[terrain]))).toBeGreaterThanOrEqual(HERO_GAP);
  });

  const details: [string, string, string, string][] = [
    ["PINE_LIGHT", P.PINE_LIGHT, "PINE_DARK", P.PINE_DARK],
    ["OAK", P.OAK, "OAK_DARK", P.OAK_DARK],
    ["CABIN", P.CABIN, "CABIN_ROOF", P.CABIN_ROOF],
    ["CABIN", P.CABIN, "CABIN_GROOVE", P.CABIN_GROOVE],
    ["CABIN", P.CABIN, "TRUNK", P.TRUNK],
    ["TERRACE_LOW", P.TERRACE_LOW, "TERRACE_HIGH", P.TERRACE_HIGH],
    ["claypit", P.TERRAIN_TOP.claypit, "HILLS_APRON", P.HILLS_APRON],
  ];

  it.each(details)("%s: %s separates from it", (_parent, parentHex, _name, hex) => {
    expect(Math.abs(luminance(hex) - luminance(parentHex))).toBeGreaterThanOrEqual(DETAIL_GAP);
  });
});

describe("docs/props.md §1 water sits under the land", () => {
  it("keeps the sea in the dark end of the range, so the background never outshines the board", () => {
    const land = Object.values(P.TERRAIN_TOP).map(luminance).sort((a, b) => a - b);
    const median = land[Math.floor(land.length / 2)]!;
    // It used to be #5FC8DC at 0.49 — brighter than forest, hills and mountains,
    // which made the sea the loudest thing on screen. Forest is allowed to be
    // darker than the water; nothing else should be.
    expect(luminance(P.SEA_TOP)).toBeLessThan(median);
    expect(land.filter((l) => l < luminance(P.SEA_TOP))).toHaveLength(1);
    expect(luminance(P.SEA_SIDE)).toBeLessThan(luminance(P.SEA_TOP));
  });

  it("keeps wave crests as foam rather than snow", () => {
    // Crests shared #F4EFE6 with SNOW, WOOL and BONE. Against the darkened sea
    // that read as white dust scattered over the water.
    expect(Math.abs(luminance(P.CREST) - luminance(P.SEA_TOP))).toBeGreaterThanOrEqual(HERO_GAP);
    expect(luminance(P.CREST)).toBeLessThan(luminance(P.SNOW) - 0.2);
  });
});
