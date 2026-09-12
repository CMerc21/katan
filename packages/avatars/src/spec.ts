/**
 * Avatar specification (docs/phase7.md §4): a handful of small integers, one
 * per layer, so a portrait is cheap to store (`game_players.avatar`) and
 * deterministic to draw.
 */

export interface AvatarSpec {
  readonly skin: number;
  readonly face: number;
  readonly eyes: number;
  readonly brows: number;
  readonly mouth: number;
  readonly hair: number;
  readonly hairColor: number;
  readonly facialHair: number;
  readonly headwear: number;
  readonly garment: number;
  readonly accessory: number;
}

export type AvatarLayer = keyof AvatarSpec;

export interface LayerInfo {
  readonly key: AvatarLayer;
  readonly label: string;
  readonly count: number;
  /** Names for each option, for the picker. */
  readonly options: readonly string[];
}

export const AVATAR_LAYERS: readonly LayerInfo[] = [
  { key: "skin", label: "Skin", count: 6, options: ["Pale", "Fair", "Olive", "Tan", "Brown", "Dark"] },
  { key: "face", label: "Face", count: 3, options: ["Round", "Long", "Square"] },
  { key: "eyes", label: "Eyes", count: 4, options: ["Dots", "Wide", "Narrow", "Sleepy"] },
  { key: "brows", label: "Brows", count: 3, options: ["Straight", "Arched", "Heavy"] },
  { key: "mouth", label: "Mouth", count: 4, options: ["Smile", "Neutral", "Grin", "Frown"] },
  { key: "hair", label: "Hair", count: 10, options: ["Crop", "Bowl", "Long", "Curly", "Braids", "Bun", "Tonsure", "Receding", "Wild", "None"] },
  { key: "hairColor", label: "Hair colour", count: 6, options: ["Black", "Brown", "Chestnut", "Blond", "Red", "Grey"] },
  { key: "facialHair", label: "Facial hair", count: 6, options: ["None", "Moustache", "Goatee", "Full beard", "Stubble", "Long beard"] },
  { key: "headwear", label: "Headwear", count: 9, options: ["Hood", "Coif", "Cap", "Circlet", "Kettle helm", "Wimple", "Crown", "Straw hat", "None"] },
  { key: "garment", label: "Garment", count: 5, options: ["Tunic", "Robe", "Gambeson", "Cloak", "Apron"] },
  { key: "accessory", label: "Accessory", count: 5, options: ["Quill", "Tankard", "Lantern", "Hawk", "None"] },
];

export const HAIR_NONE = 9;
export const FACIAL_HAIR_NONE = 0;
export const HEADWEAR_NONE = 8;
export const ACCESSORY_NONE = 4;

export function isAvatarSpec(value: unknown): value is AvatarSpec {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return AVATAR_LAYERS.every((l) => {
    const v = obj[l.key];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < l.count;
  });
}

/** Clamp every layer into range (for specs from untrusted storage). */
export function normalizeAvatar(value: unknown): AvatarSpec {
  const obj = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const l of AVATAR_LAYERS) {
    const v = obj[l.key];
    const n = typeof v === "number" && Number.isInteger(v) ? ((v % l.count) + l.count) % l.count : 0;
    out[l.key] = n;
  }
  return out as unknown as AvatarSpec;
}

/** Uniform float in [0, 1). */
export type Rng = () => number;

export function randomAvatar(rng: Rng): AvatarSpec {
  const out: Record<string, number> = {};
  for (const l of AVATAR_LAYERS) out[l.key] = Math.floor(rng() * l.count);
  return out as unknown as AvatarSpec;
}

/** Cycle one layer forward (or back) for the picker. */
export function cycleLayer(spec: AvatarSpec, layer: AvatarLayer, delta: 1 | -1 = 1): AvatarSpec {
  const info = AVATAR_LAYERS.find((l) => l.key === layer);
  if (!info) return spec;
  return { ...spec, [layer]: (spec[layer] + delta + info.count) % info.count };
}

// ---------------------------------------------------------------------------
// Small seeded generator (FNV-1a + mulberry32) so the package stays pure and
// dependency-free; the engine has its own identical stream helpers.

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function seededRng(seed: string): Rng {
  let a = hashString(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function avatarFromSeed(seed: string): AvatarSpec {
  return randomAvatar(seededRng(seed));
}
