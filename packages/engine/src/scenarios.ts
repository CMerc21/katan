/**
 * Built-in scenarios (docs/phase9.md §5): Across the Strait, Archipelago
 * and Gold Coast. Each is a `Scenario` over a `BoardDefinition` built here
 * from hex masks; terrain, tokens and harbours are filled at game start
 * with the seeded generator, except the gold fields, which are pinned.
 */

import { PORT_KINDS, boundaryEdgesInOrder, portEdgesInOrder, type PortKind, type Resource, type Terrain } from "./board";
import type { BoardDefinition, EdgeDef, HarborDef, HexDef } from "./definition";
import { hexEdge, hexId, neighbor, type HexCoord } from "./geometry";
import { largeFrame, standardFrame, standardHexes } from "./frames";
import type { Scenario } from "./scenario";

export type BuiltInScenarioId =
  | "acrossTheStrait"
  | "archipelago"
  | "goldCoast"
  | "greatLake"
  | "riverCountry"
  | "coastalWatch"
  | "saltRoad"
  | "crownStandard";
export const BUILT_IN_SCENARIO_IDS: readonly BuiltInScenarioId[] = ["acrossTheStrait", "archipelago", "goldCoast", "greatLake", "riverCountry", "coastalWatch", "saltRoad", "crownStandard"];

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

// ---------------------------------------------------------------------------
// Phase 10 and 11 built-ins (docs/phase10.md §8, docs/phase11.md §13)

function harbor(edge: string, kind: PortKind): HarborDef {
  return kind === "any" ? { edge, ratio: 3 } : { edge, ratio: 2, resource: kind as Resource };
}

/** The standard frame with a lake in place of the wasteland and three fishing grounds on the coast between the harbours. */
export function greatLakeBoard(): BoardDefinition {
  const base = standardFrame();
  const ordered = boundaryEdgesInOrder();
  const grounds: EdgeDef[] = [
    { edge: ordered[5] as string, kind: "fishingGround", token: 5 },
    { edge: ordered[15] as string, kind: "fishingGround", token: 9 },
    { edge: ordered[25] as string, kind: "fishingGround", token: 8 },
  ];
  const pool: Terrain[] = [
    ...Array<Terrain>(4).fill("forest"),
    ...Array<Terrain>(3).fill("claypit"),
    ...Array<Terrain>(4).fill("meadow"),
    ...Array<Terrain>(4).fill("farmland"),
    ...Array<Terrain>(3).fill("mountain"),
  ];
  return {
    ...base,
    name: "The Great Lake",
    hexes: base.hexes.map((h): HexDef => (h.at.q === 0 && h.at.r === 0 ? { at: h.at, kind: "land", terrain: "lake" } : h)),
    harbors: portEdgesInOrder().map((e, i) => harbor(e, PORT_KINDS[i] as PortKind)),
    edges: grounds,
    presets: { terrainPool: pool },
  };
}

/** The standard frame with a river winding from the south coast to the north coast along the middle column. */
export function riverCountryBoard(): BoardDefinition {
  const base = standardFrame();
  const river: EdgeDef[] = [];
  for (let r = 2; r >= -2; r--) {
    river.push({ edge: hexEdge({ q: 0, r }, 0), kind: "river" });
    river.push({ edge: hexEdge({ q: 0, r }, 1), kind: "river" });
  }
  return { ...base, name: "River Country", edges: river };
}

/** The standard island ringed by sea, watched by raiders. */
export function coastalWatchBoard(): BoardDefinition {
  const land = standardHexes();
  return { ...definition("Coastal Watch", land, [], 4, 1), harbors: portEdgesInOrder().map((e, i) => harbor(e, PORT_KINDS[i] as PortKind)) };
}

/** The large frame with three oases spread across it, for six caravan masters and their wagons. */
export function saltRoadBoard(): BoardDefinition {
  const base = largeFrame();
  const oases = new Set(["0,0", "3,-3", "-2,3"]);
  return {
    ...base,
    name: "Salt Road",
    hexes: base.hexes.map((h): HexDef => (oases.has(hexId(h.at)) ? { ...h, extras: { oasis: true } } : h)),
  };
}

export function crownStandardBoard(): BoardDefinition {
  return { ...standardFrame(), name: "Crown & Castle" };
}

export function builtInScenario(id: BuiltInScenarioId): Scenario {
  switch (id) {
    case "greatLake":
      return {
        id,
        name: "The Great Lake",
        board: greatLakeBoard(),
        modules: {},
        variants: { fishing: true, harbormaster: true },
        victoryPoints: 12,
        specialRules: ["A lake lies where the wasteland was: fish bite on 2, 3, 11 and 12.", "Three fishing grounds line the coast.", "The first to three harbour points takes the Harbormaster (2 points)."],
      };
    case "riverCountry":
      return {
        id,
        name: "River Country",
        board: riverCountryBoard(),
        modules: {},
        variants: { rivers: true, eventDeck: true },
        victoryPoints: 12,
        specialRules: ["A river crosses the island: roads along it cost an extra clay.", "Bridge Builder is worth a point; the Poor Settler costs two.", "The event deck replaces the dice."],
      };
    case "coastalWatch":
      return {
        id,
        name: "Coastal Watch",
        board: coastalWatchBoard(),
        modules: {},
        variants: { raiders: true },
        victoryPoints: 12,
        specialRules: ["Every seven brings the raiders closer; they land when the counter reaches 15.", "Post guards on coastal hexes to hold them.", "Your castle is safe; rebuilding a raided hex is worth a point."],
      };
    case "saltRoad":
      return {
        id,
        name: "Salt Road",
        board: saltRoadBoard(),
        modules: {},
        variants: { caravans: true, wagons: true },
        victoryPoints: 13,
        specialRules: ["Three oases yield spice; spend it to lead caravans along your roads.", "Wagons carry goods between cities for points.", "Room for six players."],
      };
    case "crownStandard":
      return {
        id,
        name: "Crown & Castle — Standard",
        board: crownStandardBoard(),
        modules: { crown: true },
        victoryPoints: 13,
        specialRules: ["Cities yield commodities; build improvements and knights.", "The barbarian fleet attacks on the seventh step.", "No development cards: progress cards instead."],
      };
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
