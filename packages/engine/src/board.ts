/**
 * Board contents: terrain, number tokens, ports (docs/rules.md §2, §3.5–§3.6).
 *
 * The geometry (which hexes/vertices/edges exist) is fixed; a Board only
 * says what sits on each hex and where the ports are.
 */

import {
  GEOMETRY,
  edgeMidpoint,
  hexId,
  spiralOrder,
  type EdgeId,
  type HexId,
  type VertexId,
} from "./geometry";
import { createRng, type Rng } from "./rng";

export const RESOURCES = ["wood", "clay", "wool", "grain", "ore"] as const;
export type Resource = (typeof RESOURCES)[number];

export const TERRAINS = ["forest", "claypit", "meadow", "farmland", "mountain", "wasteland"] as const;
export type Terrain = (typeof TERRAINS)[number];

/** §2.1 */
export const TERRAIN_RESOURCE: Readonly<Record<Terrain, Resource | null>> = {
  forest: "wood",
  claypit: "clay",
  meadow: "wool",
  farmland: "grain",
  mountain: "ore",
  wasteland: null,
};

/** §2.1 */
export const TERRAIN_COUNTS: Readonly<Record<Terrain, number>> = {
  forest: 4,
  claypit: 3,
  meadow: 4,
  farmland: 4,
  mountain: 3,
  wasteland: 1,
};

/** §2.2 */
export const NUMBER_TOKENS: readonly number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export type PortKind = "any" | Resource;

/** §2.6: four generic ports plus one per resource. */
export const PORT_KINDS: readonly PortKind[] = ["any", "any", "any", "any", ...RESOURCES];

/** §3.6: indices into the angle-ordered boundary edge list. */
export const PORT_EDGE_INDICES: readonly number[] = [0, 3, 7, 10, 13, 17, 20, 23, 27];

export interface HexTile {
  readonly terrain: Terrain;
  /** null only for the wasteland. */
  readonly token: number | null;
}

export interface Port {
  readonly edge: EdgeId;
  readonly kind: PortKind;
  readonly vertices: readonly [VertexId, VertexId];
}

export interface Board {
  readonly hexes: Readonly<Record<HexId, HexTile>>;
  readonly ports: readonly Port[];
}

export type BoardKind = "beginner" | "random";

/** §3.6: boundary edges ordered by the angle of their midpoint. */
export function portEdgesInOrder(): EdgeId[] {
  const withAngle = GEOMETRY.boundaryEdges.map((e) => {
    const m = edgeMidpoint(e);
    return { e, angle: Math.atan2(m.y, m.x) };
  });
  withAngle.sort((a, b) => a.angle - b.angle || (a.e < b.e ? -1 : 1));
  const ordered = withAngle.map((x) => x.e);
  return PORT_EDGE_INDICES.map((i) => ordered[i] as EdgeId);
}

function makePorts(kinds: readonly PortKind[]): Port[] {
  const edges = portEdgesInOrder();
  return edges.map((edge, i) => ({
    edge,
    kind: kinds[i] as PortKind,
    vertices: GEOMETRY.edgeVertices[edge] as readonly [VertexId, VertexId],
  }));
}

function assembleHexes(terrains: readonly Terrain[], tokens: readonly number[]): Record<HexId, HexTile> {
  const order = spiralOrder();
  if (terrains.length !== order.length) throw new Error("need 19 terrains");
  const hexes: Record<HexId, HexTile> = {};
  let t = 0;
  order.forEach((coord, i) => {
    const terrain = terrains[i] as Terrain;
    const token = terrain === "wasteland" ? null : (tokens[t++] as number);
    hexes[hexId(coord)] = { terrain, token };
  });
  if (t !== tokens.length) throw new Error("token count does not match producing hexes");
  return hexes;
}

/** §2.2: true when no two adjacent hexes both carry a 6 or an 8. */
export function honorsSixEightRule(hexes: Readonly<Record<HexId, HexTile>>): boolean {
  const hot = (h: HexId): boolean => {
    const tok = hexes[h]?.token;
    return tok === 6 || tok === 8;
  };
  for (const h of GEOMETRY.hexes) {
    if (!hot(h)) continue;
    for (const n of GEOMETRY.hexNeighbors[h] ?? []) {
      if (hot(n)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Beginner board: a fixed, original layout specified in spiral order (§3.5).

const BEGINNER_TERRAINS: readonly Terrain[] = [
  // outer ring (12)
  "forest", "meadow", "farmland", "mountain", "claypit", "forest",
  "meadow", "farmland", "mountain", "claypit", "forest", "meadow",
  // inner ring (6)
  "farmland", "forest", "meadow", "mountain", "claypit", "farmland",
  // centre
  "wasteland",
];

const BEGINNER_TOKENS: readonly number[] = [
  // outer ring (12)
  6, 3, 11, 8, 4, 9, 6, 2, 10, 8, 5, 12,
  // inner ring (6)
  3, 11, 4, 9, 10, 5,
];

const BEGINNER_PORTS: readonly PortKind[] = ["any", "wood", "any", "clay", "wool", "any", "grain", "any", "ore"];

export function beginnerBoard(): Board {
  return {
    hexes: assembleHexes(BEGINNER_TERRAINS, BEGINNER_TOKENS),
    ports: makePorts(BEGINNER_PORTS),
  };
}

// ---------------------------------------------------------------------------
// Random board (§2.2 six/eight rule, §12 seeded).

function allTerrains(): Terrain[] {
  const out: Terrain[] = [];
  for (const t of TERRAINS) {
    for (let i = 0; i < TERRAIN_COUNTS[t]; i++) out.push(t);
  }
  return out;
}

const MAX_TOKEN_ATTEMPTS = 10_000;

export function randomBoardWithRng(rng: Rng): Board {
  const terrains = rng.shuffle(allTerrains());
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
    const hexes = assembleHexes(terrains, rng.shuffle(NUMBER_TOKENS));
    if (honorsSixEightRule(hexes)) {
      return { hexes, ports: makePorts(rng.shuffle(PORT_KINDS)) };
    }
  }
  // Unreachable in practice: a valid token assignment exists for every
  // terrain layout, and rejection sampling finds one quickly.
  throw new Error("randomBoard: could not satisfy the 6/8 rule");
}

export function randomBoard(seed: string): Board {
  return randomBoardWithRng(createRng(seed, "board"));
}

export function makeBoard(kind: BoardKind, seed: string): Board {
  switch (kind) {
    case "beginner":
      return beginnerBoard();
    case "random":
      return randomBoard(seed);
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown board kind ${String(exhaustive)}`);
    }
  }
}

/** The hex holding the wasteland (where the robber starts, §4.4). */
export function wastelandHex(board: Board): HexId {
  for (const h of GEOMETRY.hexes) {
    if (board.hexes[h]?.terrain === "wasteland") return h;
  }
  throw new Error("board has no wasteland");
}
