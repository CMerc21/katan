import type { Rng } from "./types";

/**
 * Seeded medieval bot names (docs/phase7.md §5): `first + (epithet | "of " + place)`.
 * Difficulty is never part of the name; the UI shows it as a badge.
 */

export const FIRST_NAMES: readonly string[] = [
  "Aldric", "Beatrix", "Cedric", "Dagny", "Edmund", "Elswyth", "Fulk", "Gisela", "Godfrey", "Hawise",
  "Ivo", "Isolde", "Jocelin", "Katrin", "Leofric", "Maud", "Nicolaus", "Orm", "Philippa", "Ranulf",
  "Rohese", "Sigrid", "Tancred", "Ulrica", "Wulfric", "Ysolt", "Alard", "Amice", "Bertram", "Brunhild",
  "Clement", "Constance", "Drogo", "Emma", "Eustace", "Frida", "Gerbert", "Gunnhild", "Hamo", "Helewise",
  "Ingram", "Idonea", "Jordan", "Juliana", "Lambert", "Lettice", "Miles", "Mabel", "Odo", "Osanna",
  "Piers", "Petronilla", "Roger", "Sibyl", "Simon", "Thora", "Walter", "Wymarc", "Yves", "Ymma",
];

export const EPITHETS: readonly string[] = [
  "the Bold", "the Quiet", "the Unlucky", "Ironhand", "of the Marsh", "the Pious", "Longshanks", "the Fair",
  "Sheepshearer", "Nine-Fingers", "the Wanderer", "Oakenshield", "the Red", "the Ferryman", "Stonecutter",
  "the Younger", "the Elder", "Greycloak", "the Miller", "Halfpenny", "the Stout", "Barefoot", "the Tall",
  "Woodward", "the Wise", "Saltbeard", "the Bald", "Thatcher", "the Lucky", "Brewer", "the Silent",
  "Goosefoot", "the Hasty", "Cartwright", "the Kind", "Blackthorn", "the Restless", "Fletcher", "the Grim", "Wainwright",
];

export const PLACES: readonly string[] = [
  "Ashford", "Brackenmoor", "Coldharbour", "Dunmere", "Elsmere", "Fenwick", "Greyholm", "Hollowby", "Kestrelmoor",
  "Lindenford", "Marlowe", "Northwick", "Oldcastle", "Ravensbeck", "Saltmarsh", "Thornwood", "Wexley",
  "Aldwyke", "Barrowdale", "Cranbourne", "Dovecote", "Eastmere", "Foxhollow", "Glenmoor", "Harrowgate",
  "Ivybridge", "Kingsreach", "Longmeadow", "Millhaven", "Oxcombe",
];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

/** One name, avoiding any in `taken` (case-insensitive). Never repeats within a game when used with `taken`. */
export function generateBotName(rng: Rng, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let attempt = 0; attempt < 200; attempt++) {
    const first = pick(rng, FIRST_NAMES);
    const suffix = rng() < 0.55 ? pick(rng, EPITHETS) : `of ${pick(rng, PLACES)}`;
    const name = `${first} ${suffix}`;
    if (!used.has(name.toLowerCase()) && ![...used].some((n) => n.startsWith(`${first.toLowerCase()} `))) return name;
  }
  // Astronomically unlikely; fall back to a numbered name rather than loop forever.
  return `${pick(rng, FIRST_NAMES)} ${Math.floor(rng() * 1000)}`;
}

/** `count` distinct names from one stream. */
export function generateBotNames(rng: Rng, count: number, taken: Iterable<string> = []): string[] {
  const out: string[] = [];
  const used = new Set(taken);
  for (let i = 0; i < count; i++) {
    const name = generateBotName(rng, used);
    out.push(name);
    used.add(name);
  }
  return out;
}

/** True when a name looks like one of ours (for "rename" defaults). */
export function isGeneratedBotName(name: string): boolean {
  const [first, ...rest] = name.split(" ");
  if (!first || rest.length === 0) return false;
  const suffix = rest.join(" ");
  return FIRST_NAMES.includes(first) && (EPITHETS.includes(suffix) || (suffix.startsWith("of ") && PLACES.includes(suffix.slice(3))));
}
