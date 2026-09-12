/**
 * Built-in frames and boards (docs/phase8.md §2): hex masks with scaled
 * pools. The Beginner board and the seeded Random board are definitions on
 * the Standard frame, so every existing test keeps passing.
 */

import { BEGINNER_PORTS, BEGINNER_TERRAINS, BEGINNER_TOKENS, PORT_KINDS, portEdgesInOrder, type PortKind, type Resource } from "./board";
import type { BoardDefinition, HarborDef, HexDef } from "./definition";
import { hexId, hexRing, spiralOrder, type HexCoord } from "./geometry";

function land(at: HexCoord, terrain?: HexDef["terrain"], token?: number): HexDef {
  if (terrain !== undefined && token !== undefined) return { at, kind: "land", terrain, token };
  if (terrain !== undefined) return { at, kind: "land", terrain };
  return { at, kind: "land" };
}

function sea(at: HexCoord): HexDef {
  return { at, kind: "sea" };
}

function harbor(edge: string, kind: PortKind): HarborDef {
  return kind === "any" ? { edge, ratio: 3 } : { edge, ratio: 2, resource: kind as Resource };
}

/** The 19 standard hexes in spiral order. */
export function standardHexes(): HexCoord[] {
  return spiralOrder();
}

/** Standard: 19 land (3-4-5-4-3), 3–4 seats, standard pools, harbours on the §3.6 edges. */
export function standardFrame(): BoardDefinition {
  return {
    name: "Standard",
    hexes: standardHexes().map((c) => land(c)),
    harbors: portEdgesInOrder().map((e, i) => harbor(e, PORT_KINDS[i] as PortKind)),
    seats: { min: 3, max: 4 },
    generation: { terrain: "shuffle", tokens: "shuffle", harbors: "shuffle" },
  };
}

/** Large: 30 land (3-4-5-6-5-4-3), 3–6 seats. The radius-3 hexagon minus the lowest-q hex of each row. */
export function largeFrame(): BoardDefinition {
  const hexes: HexCoord[] = [];
  for (let r = -3; r <= 3; r++) {
    const qMin = Math.max(-3, -3 - r);
    const qMax = Math.min(3, 3 - r);
    for (let q = qMin + 1; q <= qMax; q++) hexes.push({ q, r });
  }
  return {
    name: "Large",
    hexes: hexes.map((c) => land(c)),
    harbors: [],
    seats: { min: 3, max: 6 },
    generation: { terrain: "shuffle", tokens: "balanced", harbors: "shuffle" },
    presets: { tokenPool: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12] },
  };
}

/** Long strip: 3 × 7 land, 3–4 seats. */
export function longStripFrame(): BoardDefinition {
  const hexes: HexCoord[] = [];
  for (let r = -1; r <= 1; r++) {
    for (let c = 0; c < 7; c++) hexes.push({ q: c - 3 - Math.floor(r / 2), r });
  }
  return {
    name: "Long strip",
    hexes: hexes.map((c) => land(c)),
    harbors: [],
    seats: { min: 3, max: 4 },
    generation: { terrain: "shuffle", tokens: "balanced", harbors: "shuffle" },
  };
}

/** Ring: 24 land around a 7-hex lake (ring 2 plus ring 3 without its corners), 3–5 seats. */
export function ringFrame(): BoardDefinition {
  const lake = [...hexRing(0), ...hexRing(1)];
  const ring2 = hexRing(2);
  const ring3 = hexRing(3).filter((_, i) => i % 3 !== 0); // drop the six corners
  return {
    name: "Ring",
    hexes: [...lake.map(sea), ...ring2.map((c) => land(c)), ...ring3.map((c) => land(c))],
    harbors: [],
    seats: { min: 3, max: 5 },
    generation: { terrain: "shuffle", tokens: "balanced", harbors: "shuffle" },
  };
}

/** The fixed beginner layout (§3.5) as a definition. */
export function beginnerDefinition(): BoardDefinition {
  const order = standardHexes();
  let t = 0;
  return {
    name: "Beginner",
    hexes: order.map((c, i) => {
      const terrain = BEGINNER_TERRAINS[i]!;
      return terrain === "wasteland" ? land(c, terrain) : land(c, terrain, BEGINNER_TOKENS[t++]);
    }),
    harbors: portEdgesInOrder().map((e, i) => harbor(e, BEGINNER_PORTS[i] as PortKind)),
    seats: { min: 3, max: 4 },
    generation: { terrain: "fixed", tokens: "fixed", harbors: "fixed" },
  };
}

/** The seeded random board (§2.2, §12): the Standard frame with everything shuffled. */
export function randomDefinition(): BoardDefinition {
  return { ...standardFrame(), name: "Random" };
}

export type BuiltInBoardId = "beginner" | "random" | "large" | "longStrip" | "ring";

export const BUILT_IN_BOARD_IDS: readonly BuiltInBoardId[] = ["beginner", "random", "large", "longStrip", "ring"];

export function builtInBoard(id: BuiltInBoardId): BoardDefinition {
  switch (id) {
    case "beginner":
      return beginnerDefinition();
    case "random":
      return randomDefinition();
    case "large":
      return largeFrame();
    case "longStrip":
      return longStripFrame();
    case "ring":
      return ringFrame();
    default: {
      const exhaustive: never = id;
      throw new Error(String(exhaustive));
    }
  }
}

export function isBuiltInBoardId(value: unknown): value is BuiltInBoardId {
  return typeof value === "string" && (BUILT_IN_BOARD_IDS as readonly string[]).includes(value);
}

export { hexId };
