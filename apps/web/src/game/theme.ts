/**
 * Visual tokens (docs/art-direction.md §1). Colours come from the materials
 * of the game: timber, clay, fleece, grain, stone, water, ink and parchment,
 * with heraldic tinctures for the seats.
 */

import type { Commodity, PlayerColor, Resource, Terrain, Track, WagonGood } from "@katan/engine";

export const INK = "#211d19";
export const INK_SOFT = "#4a433c";
export const PARCHMENT = "#efe8d8";
export const PARCHMENT_DEEP = "#e3dac6";
export const WALNUT = "#3b2a1e";
export const WALNUT_LIGHT = "#5a4030";
export const WAX = "#9b2226";
export const GILT = "#c9a227";
export const WATER = "#4a7d8c";
export const WATER_DEEP = "#3b6674";
export const SAND = "#d9c9a0";
export const BONE = "#f2ead6";
export const LEATHER = "#4a2f1c";

export const TERRAIN_FILL: Record<Terrain, string> = {
  forest: "#3e6b46",
  claypit: "#b25a3d",
  meadow: "#a5b95e",
  farmland: "#d9a642",
  mountain: "#7d8089",
  wasteland: "#cfbd8e",
  gold: "#e0b43a",
  lake: "#5f9db0",
};

/** A darker mark colour used for the hand-drawn detail on each terrain. */
export const TERRAIN_MARK: Record<Terrain, string> = {
  forest: "#2b4d32",
  claypit: "#8a4330",
  meadow: "#7d9143",
  farmland: "#b0812c",
  mountain: "#5b5e66",
  lake: "#3f7688",
  wasteland: "#b9a677",
  gold: "#b98a1d",
};

export const RESOURCE_COLOR: Record<Resource, string> = {
  wood: TERRAIN_FILL.forest,
  clay: TERRAIN_FILL.claypit,
  wool: TERRAIN_FILL.meadow,
  grain: TERRAIN_FILL.farmland,
  ore: TERRAIN_FILL.mountain,
};

/** Heraldic tinctures: gules, azure, or, argent (and vert, tenné for 5–6 players). */
export const PLAYER_FILL: Record<PlayerColor, string> = {
  red: "#a12a1e",
  blue: "#2a4d8f",
  orange: "#d9a21b",
  white: "#e8e4d8",
  green: "#2f6b3a",
  brown: "#7a4a1f",
};

/** Text colour that reads on each player colour. */
export const PLAYER_TEXT: Record<PlayerColor, string> = {
  red: "#ffffff",
  blue: "#ffffff",
  orange: INK,
  white: INK,
  green: "#ffffff",
  brown: "#ffffff",
};

export const HOT_TOKEN = "#c8412b";

/** Wagon goods (docs/phase10.md §7): marble, glass, sand, tools. */
export const GOOD_COLOR: Record<WagonGood, string> = { marble: "#e9e5dc", glass: "#9fd3dd", sand: "#dcc48f", tools: "#6b6e75" };

// Crown & Castle (docs/phase11.md §11)

/** Commodity cards: undyed cloth, struck coin, ruled paper. */
export const COMMODITY_COLOR: Record<Commodity, string> = { cloth: "#8c5a8e", coin: "#c98a1e", paper: "#5a8ea1" };

/** Improvement tracks take the colour of the commodity they are paid in. */
export const TRACK_COLOR: Record<Track, string> = { trade: COMMODITY_COLOR.cloth, politics: COMMODITY_COLOR.coin, science: COMMODITY_COLOR.paper };

/** The barbarian fleet's black sail and the event die's faces. */
export const FLEET_COLOR = "#1f1a17";
