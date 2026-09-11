/**
 * Visual tokens (docs/phase3.md §7). Colours come from the materials of the
 * game: timber, clay, fleece, grain, stone, water, ink and parchment.
 */

import type { PlayerColor, Resource, Terrain } from "@katan/engine";

export const INK = "#211d19";
export const PARCHMENT = "#efe8d8";
export const WATER = "#4a7d8c";
export const WATER_DEEP = "#3b6674";
export const SAND = "#d9c9a0";

export const TERRAIN_FILL: Record<Terrain, string> = {
  forest: "#3e6b46",
  claypit: "#b25a3d",
  meadow: "#a5b95e",
  farmland: "#d9a642",
  mountain: "#7d8089",
  wasteland: "#cfbd8e",
};

/** A darker mark colour used for the hand-drawn pattern on each terrain. */
export const TERRAIN_MARK: Record<Terrain, string> = {
  forest: "#2b4d32",
  claypit: "#8a4330",
  meadow: "#7d9143",
  farmland: "#b0812c",
  mountain: "#5b5e66",
  wasteland: "#cfbd8e",
};

export const RESOURCE_COLOR: Record<Resource, string> = {
  wood: TERRAIN_FILL.forest,
  clay: TERRAIN_FILL.claypit,
  wool: TERRAIN_FILL.meadow,
  grain: TERRAIN_FILL.farmland,
  ore: TERRAIN_FILL.mountain,
};

export const PLAYER_FILL: Record<PlayerColor, string> = {
  red: "#b83a2c",
  blue: "#2f5f9d",
  orange: "#e0862b",
  white: "#f4efe3",
};

/** Text colour that reads on each player colour. */
export const PLAYER_TEXT: Record<PlayerColor, string> = {
  red: "#ffffff",
  blue: "#ffffff",
  orange: INK,
  white: INK,
};

export const HOT_TOKEN = "#c8412b";
