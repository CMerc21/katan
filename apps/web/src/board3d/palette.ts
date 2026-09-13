/**
 * The diorama's palette (docs/props.md §1–§6): slab layers, terrain tops,
 * prop and piece colours from the tile and prop brief. The DOM and the 2D
 * thumbnails keep `src/game/theme.ts`; this file is only for the 3D scene.
 */

import type { Terrain } from "@katan/engine";

// §1 Slab
export const EARTH = "#8A5A3C";
export const EARTH_BAND = "#C9976A";
export const RECESS_FLOOR = "#B8865A";
export const SEA_SIDE = "#3FA8C4";
export const SEA_TOP = "#5FC8DC";
export const FRAME_WOOD = "#4a3323";

// §2 Terrain tops
export const TERRAIN_TOP: Record<Terrain, string> = {
  forest: "#6FA35C",
  meadow: "#7DBF4E",
  farmland: "#E8B84A",
  claypit: "#D97A4D",
  mountain: "#8E97A3",
  wasteland: "#E6C889",
  gold: "#8E97A3",
  lake: "#E6C889",
};
export const HILLS_APRON = "#E8C48A";

// §3 Props
export const PINE_LIGHT = "#8DBF5A";
export const PINE_DARK = "#4F7A48";
export const TRUNK = "#7A5233";
export const OAK = "#7DB45A";
export const OAK_DARK = "#6FA35C";
export const CABIN = "#8B4A2B";
export const CABIN_GROOVE = "#6E3A22";
export const CABIN_ROOF = "#6FA35C";
export const LOG_END = "#C9976A";
export const WOOL = "#F4EFE6";
export const SHEEP_FACE = "#2B2118";
export const STONE_WALL = "#9A9A94";
export const THATCH = "#D9B25C";
export const TIMBER = "#A67C4F";
export const WHEAT = "#E3B04B";
export const TERRACE_LOW = "#D97A4D";
export const TERRACE_HIGH = "#E8955E";
export const KILN = "#B84E3A";
export const BRICK = "#C8553D";
export const BRICK_DARK = "#A9432E";
export const ROCK_GREY = "#8E97A3";
export const SNOW = "#F4EFE6";
export const MINE_FRAME = "#C9976A";
export const GOLD = "#E8B84A";
export const SILVER = "#C9CFD6";
export const CACTUS = "#6FA35C";
export const DESERT_ROCK = "#B8A58A";
export const BONE = "#F4EFE6";
export const CREST = "#F4EFE6";
export const REED = "#6FA35C";
export const DARK = "#2B2118";
export const SOOT = "#3A3532";
export const SMOKE = "#d8d3c8";

// §4–§5 Pieces
export const WALL_PLASTER = "#F4EFE6";
export const KEEP_STONE = "#7A8798";
export const ROAD_TOP = "#C9976A";
export const ROBBER = "#2B2118";
export const ROBBER_SACK = "#E8B84A";
export const ROBBER_BASE = "#4a4a48";
/** The GLB robber (models/robber.glb): near-black, rough. */
export const ROBBER_MODEL = "#1a1a1a";
export const HULL = "#8B4A2B";
export const PIRATE_HULL = "#3A3532";
export const PIRATE_SAIL = "#1f1a17";
export const INACTIVE = "#9A9A94";
export const TOKEN_CLAY = "#C9976A";
export const TOKEN_HOT = "#C8553D";
export const DIE_BONE = "#F4EFE6";
export const DIE_RED = "#C8553D";
export const TRAY_LEATHER = "#6B3E2E";
export const MERCHANT_GREEN = "#4E8A4A";
export const LONGSHIP_HULL = "#3A3532";
export const LONGSHIP_SAIL = "#8A857D";
export const EVENT_FLEET = "#1f1a17";
export const EVENT_POLITICS = "#3d6fc4";
export const EVENT_TRADE = "#4aa64a";
export const EVENT_SCIENCE = "#e8c33a";

// §6 Lighting and table
export const KEY_LIGHT = "#FFE7C2";
export const FILL_SKY = "#CFE3F0";
export const FILL_GROUND = "#6B4A33";
export const TABLE_WALNUT = "#5B3A24";
