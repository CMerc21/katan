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
export const SEA_SIDE = "#2A6E80";
export const SEA_TOP = "#3A8CA0";
export const FRAME_WOOD = "#4a3323";

// §2 Terrain tops
export const TERRAIN_TOP: Record<Terrain, string> = {
  forest: "#467A40",
  claypit: "#C4713F",
  mountain: "#8E98A6",
  lake: "#93B170",
  farmland: "#DDB053",
  meadow: "#9AD35F",
  gold: "#F3CE4B",
  wasteland: "#EDDAAF",
};
export const HILLS_APRON = "#E0A470";

// §3 Props
export const PINE_LIGHT = "#7FB84E";
export const PINE_DARK = "#2C5230";
export const TRUNK = "#5E3F27";
export const OAK = "#6BA84A";
export const OAK_DARK = "#3F6F37";
export const CABIN = "#CC8552";
export const CABIN_GROOVE = "#9E6238";
export const CABIN_ROOF = "#8E3A28";
export const LOG_END = "#C9976A";
export const WOOL = "#F4EFE6";
export const SHEEP_FACE = "#2B2118";
export const STONE_WALL = "#9A9A94";
export const THATCH = "#D9B25C";
export const TIMBER = "#A67C4F";
export const WHEAT = "#B8822C";
export const TERRACE_LOW = "#E09A5E";
export const TERRACE_HIGH = "#E9B27E";
export const KILN = "#9E3F2E";
export const BRICK = "#C8553D";
export const BRICK_DARK = "#A9432E";
export const ROCK_GREY = "#5E6874";
export const SNOW = "#F4EFE6";
export const MINE_FRAME = "#C9976A";
export const GOLD = "#E8B84A";
export const SILVER = "#C9CFD6";
export const CACTUS = "#3F7A45";
export const DESERT_ROCK = "#A8906E";
export const BONE = "#F4EFE6";
/** Foam, not snow: pale blue and well short of white, or the crests read as dust on the dark water. */
export const CREST = "#9CC3CE";
/** The band where the sea meets a shore: brighter than a crest, short of white. */
export const FOAM = "#CFE4E9";
export const REED = "#4A8A55";
export const DARK = "#2B2118";
export const SOOT = "#3A3532";
export const SMOKE = "#d8d3c8";
/** Lit openings (docs/props.md §3): a window at dusk, and a kiln's fire mouth. */
export const HEARTH_WINDOW = "#FFC96B";
export const HEARTH_FIRE = "#FF7A33";
export const HEARTH_LANTERN = "#FFD79A";

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
export const TOKEN_HOT = "#C0392B";
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
/** The cool rim opposite the key: it only draws the lit edge, it never fills. */
export const RIM_LIGHT = "#A8C8E4";
export const FILL_SKY = "#CFE3F0";
export const FILL_GROUND = "#4A5060";
export const TABLE_WALNUT = "#5B3A24";
/** The canvas backdrop, and the fog colour: the table fades into it rather than running to a hard horizon. */
export const BACKDROP = "#2a1c13";

// §6 Image-based light (`environment.ts`): the equirect sky's ramp and blobs.
export const ENV_ZENITH = "#6E96B8";
export const ENV_HORIZON = "#EFDCBC";
export const ENV_GROUND = "#5A5358";
export const ENV_NADIR = "#2B2A2E";
export const ENV_KEY_GLOW = "#FFF1D6";
export const ENV_RIM_GLOW = "#9FC4DE";
