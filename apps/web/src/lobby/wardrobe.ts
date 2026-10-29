/**
 * The wardrobe (docs/phase13.md §2): what the player wears in the home lobby
 * and brings into every seat. Pure: categories over the avatar layers, equip
 * and cycle, a title from what is worn, and parsing from untrusted storage.
 * The spec itself is the Phase 7 AvatarSpec, so a seat stores it unchanged.
 */

import { AVATAR_LAYERS, avatarFromSeed, cycleLayer, isAvatarSpec, normalizeAvatar, randomAvatar, type AvatarLayer, type AvatarSpec, type Rng } from "@katan/avatars";
import { PLAYER_COLORS, type PlayerColor } from "@katan/engine";

export interface Wardrobe {
  readonly avatar: AvatarSpec;
  readonly color: PlayerColor;
  /** The name a guest plays under; signed-in players use their account name. */
  readonly name: string;
}

export type CategoryKey = "outfit" | "headwear" | "accessory" | "hair" | "look";

export interface WardrobeCategory {
  readonly key: CategoryKey;
  readonly label: string;
  readonly layers: readonly AvatarLayer[];
  /** The outfit tab also offers the colour. */
  readonly colour?: boolean;
}

export const CATEGORIES: readonly WardrobeCategory[] = [
  { key: "outfit", label: "Outfit", layers: ["garment"], colour: true },
  { key: "headwear", label: "Headwear", layers: ["headwear"] },
  { key: "accessory", label: "Accessory", layers: ["accessory"] },
  { key: "hair", label: "Hair", layers: ["hair", "hairColor", "facialHair"] },
  { key: "look", label: "Face", layers: ["skin", "face", "eyes", "brows", "mouth"] },
];

export const WARDROBE_KEY = "katan.wardrobe";
export const GUEST_NAME = "Settler";

export function layerInfo(layer: AvatarLayer) {
  return AVATAR_LAYERS.find((l) => l.key === layer)!;
}

export function defaultWardrobe(seed = "home"): Wardrobe {
  return { avatar: avatarFromSeed(`wardrobe:${seed}`), color: "blue", name: GUEST_NAME };
}

function cleanName(name: unknown): string | null {
  const n = typeof name === "string" ? name.trim().slice(0, 24) : "";
  return n.length > 0 ? n : null;
}

/** Read a wardrobe from storage or profile metadata; anything malformed falls back field by field. */
export function parseWardrobe(raw: unknown, fallback: Wardrobe = defaultWardrobe()): Wardrobe {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const avatar = isAvatarSpec(obj.avatar) ? obj.avatar : obj.avatar && typeof obj.avatar === "object" ? normalizeAvatar(obj.avatar) : fallback.avatar;
  const color = typeof obj.color === "string" && (PLAYER_COLORS as readonly string[]).includes(obj.color) ? (obj.color as PlayerColor) : fallback.color;
  return { avatar, color, name: cleanName(obj.name) ?? fallback.name };
}

export function equip(w: Wardrobe, layer: AvatarLayer, option: number): Wardrobe {
  const count = layerInfo(layer).count;
  const value = ((Math.trunc(option) % count) + count) % count;
  return w.avatar[layer] === value ? w : { ...w, avatar: { ...w.avatar, [layer]: value } };
}

export function cycle(w: Wardrobe, layer: AvatarLayer, delta: 1 | -1): Wardrobe {
  return { ...w, avatar: cycleLayer(w.avatar, layer, delta) };
}

export function withColor(w: Wardrobe, color: PlayerColor): Wardrobe {
  return w.color === color ? w : { ...w, color };
}

export function withName(w: Wardrobe, name: string): Wardrobe {
  return { ...w, name: cleanName(name) ?? GUEST_NAME };
}

export function shuffle(w: Wardrobe, rng: Rng): Wardrobe {
  return { ...w, avatar: randomAvatar(rng), color: PLAYER_COLORS[Math.floor(rng() * PLAYER_COLORS.length)] ?? w.color };
}

export function sameWardrobe(a: Wardrobe, b: Wardrobe): boolean {
  return a.color === b.color && a.name === b.name && AVATAR_LAYERS.every((l) => a.avatar[l.key] === b.avatar[l.key]);
}

/** The first layer of a category, which the showcase arrows step through. */
export function primaryLayer(category: CategoryKey): AvatarLayer {
  return CATEGORIES.find((c) => c.key === category)!.layers[0]!;
}

/** "Outfit: Cloak" style summary of what is worn, for the nameplate's title and screen readers. */
export function wornSummary(spec: AvatarSpec): string {
  return (["garment", "headwear", "accessory"] as const)
    .map((l) => layerInfo(l).options[spec[l]])
    .filter((o) => o !== "None")
    .join(", ");
}

/** An epithet from the most striking thing worn: the showcase nameplate reads "Ana the Falconer". */
export function titleFor(spec: AvatarSpec): string {
  const headwear = layerInfo("headwear").options[spec.headwear];
  const accessory = layerInfo("accessory").options[spec.accessory];
  const garment = layerInfo("garment").options[spec.garment];
  if (headwear === "Crown") return "the Crowned";
  if (accessory === "Hawk") return "the Falconer";
  if (accessory === "Lantern") return "the Lamplighter";
  if (accessory === "Quill") return "the Scribe";
  if (headwear === "Kettle helm") return "the Stalwart";
  if (accessory === "Tankard") return "the Merry";
  if (headwear === "Straw hat") return "the Harvester";
  if (headwear === "Circlet") return "the Fair";
  if (garment === "Apron") return "the Artisan";
  if (garment === "Cloak") return "the Wanderer";
  if (garment === "Robe") return "the Learned";
  if (garment === "Gambeson") return "the Steadfast";
  return "the Settler";
}
