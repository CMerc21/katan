/**
 * Built-in scenarios (docs/phase9.md §5): Across the Strait, Archipelago
 * and Gold Coast. Each is a `Scenario` over a `BoardDefinition` built here
 * from hex masks; terrain, tokens and harbours are filled at game start
 * with the seeded generator, except the gold fields, which are pinned.
 */

import type { Terrain } from "./board";
import type { BoardDefinition, HexDef } from "./definition";
import { hexId, neighbor, type HexCoord } from "./geometry";
import { standardHexes } from "./frames";
import type { Scenario } from "./scenario";

export type BuiltInScenarioId = "acrossTheStrait" | "archipelago" | "goldCoast";
export const BUILT_IN_SCENARIO_IDS: readonly BuiltInScenarioId[] = ["acrossTheStrait", "archipelago", "goldCoast"];

export function isBuiltInScenarioId(value: unknown): value is BuiltInScenarioId {
  return typeof value === "string" && (BUILT_IN_SCENARIO_IDS as readonly string[]).includes(value);
}

function key(c: HexCoord): string {
  return hexId(c);
}

/** Every cell within `distance` steps of a land cell that is not land itself becomes sea. */
function withSea(land: readonly HexCoord[], gold: readonly HexCoord[], distance: number): HexDef[] {
  const landKeys = new Set(land.map(key));
  const goldKeys = new Set(gold.map(key));
  const sea = new Map<string, HexCoord>();
  let frontier = land.slice();
  for (let step = 0; step < distance; step++) {
    const next: HexCoord[] = [];
    for (const c of frontier) {
      for (let k = 0; k < 6; k++) {
        const n = neighbor(c, k);
        const id = key(n);
        if (landKeys.has(id) || sea.has(id)) continue;
        sea.set(id, n);
        next.push(n);
      }
    }
    frontier = next;
  }
  const out: HexDef[] = land.map((at) => (goldKeys.has(key(at)) ? { at, kind: "land", terrain: "gold" as Terrain } : { at, kind: "land" }));
  for (const at of sea.values()) out.push({ at, kind: "sea" });
  return out;
}

function around(centre: HexCoord, directions: readonly number[]): HexCoord[] {
  return [centre, ...directions.map((k) => neighbor(centre, k))];
}

function definition(name: string, land: readonly HexCoord[], gold: readonly HexCoord[], seats: 4 | 5 | 6, sea = 2): BoardDefinition {
  return {
    name,
    hexes: withSea(land, gold, sea),
    harbors: [],
    seats: { min: 3, max: seats },
    generation: { terrain: "shuffle", tokens: "balanced", harbors: "shuffle" },
  };
}

/** The standard island to the west, a strait, and an unexplored island of ten hexes with two gold fields to the east. */
export function acrossTheStraitBoard(): BoardDefinition {
  const main = standardHexes();
  const east: HexCoord[] = [
    ...around({ q: 6, r: -1 }, [0, 1, 2, 3, 4, 5]),
    { q: 6, r: 1 },
    { q: 7, r: 0 },
    { q: 5, r: 2 },
  ];
  return definition("Across the Strait", [...main, ...east], [{ q: 6, r: -1 }, { q: 5, r: 2 }], 4);
}

/** Five islands of five hexes each, two of them with a gold field. */
export function archipelagoBoard(): BoardDefinition {
  const centres: HexCoord[] = [
    { q: 0, r: 0 },
    { q: 4, r: -2 },
    { q: -4, r: 2 },
    { q: 2, r: 2 },
    { q: -2, r: -2 },
  ];
  const land = centres.flatMap((c, i) => around(c, [i % 6, (i + 1) % 6, (i + 2) % 6, (i + 3) % 6]));
  return definition("Archipelago", land, [{ q: 4, r: -2 }, { q: -4, r: 2 }], 4);
}

/** The standard frame with two gold fields in place of a meadow and a forest, ringed by sea for ships. */
export function goldCoastBoard(): BoardDefinition {
  const land = standardHexes();
  const gold: HexCoord[] = [
    { q: 2, r: -2 },
    { q: -2, r: 2 },
  ];
  const def = definition("Gold Coast", land, gold, 4, 1);
  // Standard pool less one meadow and one forest (the gold fields are pinned, so they are not drawn).
  const pool: Terrain[] = [
    ...Array<Terrain>(3).fill("forest"),
    ...Array<Terrain>(3).fill("claypit"),
    ...Array<Terrain>(3).fill("meadow"),
    ...Array<Terrain>(4).fill("farmland"),
    ...Array<Terrain>(3).fill("mountain"),
    "wasteland",
  ];
  return { ...def, presets: { terrainPool: pool } };
}

export function builtInScenario(id: BuiltInScenarioId): Scenario {
  switch (id) {
    case "acrossTheStrait":
      return {
        id,
        name: "Across the Strait",
        board: acrossTheStraitBoard(),
        modules: { tides: true },
        pirate: true,
        islandBonus: 2,
        setup: "mainIslandOnly",
        mainIsland: 0,
        victoryPoints: 12,
        specialRules: ["Start on the main island only.", "The first settlement on the far island is worth 2 extra points.", "Two gold fields wait across the strait."],
      };
    case "archipelago":
      return {
        id,
        name: "Archipelago",
        board: archipelagoBoard(),
        modules: { tides: true },
        pirate: false,
        islandBonus: 2,
        setup: "standard",
        victoryPoints: 13,
        specialRules: ["No pirate.", "Each new island you settle is worth 2 extra points.", "Ships carry you between the five islands."],
      };
    case "goldCoast":
      return {
        id,
        name: "Gold Coast",
        board: goldCoastBoard(),
        modules: { tides: true },
        pirate: true,
        islandBonus: 0,
        setup: "standard",
        victoryPoints: 11,
        specialRules: ["Two gold fields produce a resource of your choice.", "Ships may sail the coast; the pirate lurks offshore."],
      };
    default: {
      const exhaustive: never = id;
      throw new Error(`unknown scenario ${String(exhaustive)}`);
    }
  }
}
