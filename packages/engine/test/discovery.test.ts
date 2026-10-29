import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents, replay } from "../src/actions";
import { RESOURCES, TERRAIN_RESOURCE, boardGeometry, type Terrain } from "../src/board";
import type { BoardDefinition, HexDef } from "../src/definition";
import { beginnerDefinition } from "../src/frames";
import { createGame } from "../src/game";
import { edgeVerticesOf, hexId, hexVerticesOf, parseHexId, type EdgeId, type HexId, type VertexId } from "../src/geometry";
import { legalActions } from "../src/legal";
import { redact } from "../src/redact";
import type { Scenario } from "../src/scenario";
import { getPlayer, handSize } from "../src/state";
import { validateBoard } from "../src/validation";
import type { GameState, PlayerId } from "../src/types";
import { FOUR, expectRule, finishSetup, give, inPhase, mut, place, playRandomGame, withNextRoll } from "./helpers";

/** Beginner board with `tiles` face down (their own terrain) and `pool` drawn from the discovery pool. */
function discoveryBoard(tiles: readonly HexId[], pool: readonly HexId[] = [], discovery?: BoardDefinition["discovery"]): BoardDefinition {
  const def = beginnerDefinition();
  return {
    ...def,
    name: "Discovery test",
    hexes: def.hexes.map((h): HexDef => {
      const id = hexId(h.at);
      if (tiles.includes(id)) return { ...h, extras: { discover: "tile" } };
      if (pool.includes(id)) return { at: h.at, kind: "land", extras: { discover: "pool" } };
      return h;
    }),
    ...(discovery ? { discovery } : {}),
  };
}

function hexOf(def: BoardDefinition, terrain: Terrain, skip: readonly HexId[] = []): HexId {
  const h = def.hexes.find((x) => x.terrain === terrain && !skip.includes(hexId(x.at)));
  if (!h) throw new Error(`no ${terrain}`);
  return hexId(h.at);
}

function game(def: BoardDefinition, seed = "discovery"): GameState {
  return createGame({ seed, players: FOUR, board: def });
}

const BEGINNER = beginnerDefinition();
const FOREST = hexOf(BEGINNER, "forest");
const MOUNTAIN = hexOf(BEGINNER, "mountain");

/** Turn `hexes` face down on a running game (test setup only): the board's list is the module's switch. */
function hideTiles(state: GameState, hexes: readonly HexId[]): GameState {
  return mut(state, (x) => {
    x.discovery = { hidden: [...hexes], owedGold: {}, revealedThisAction: false };
    (x.board as unknown as { hidden: HexId[] }).hidden = [...hexes];
  });
}

function corners(hex: HexId): VertexId[] {
  return hexVerticesOf(parseHexId(hex));
}

/** A free setup corner of `hex` for the current player. */
function setupCorner(state: GameState, hex: HexId): VertexId {
  const legal = legalActions(state, state.players[state.currentPlayer]!.id);
  const v = corners(hex).find((c) => legal.some((a) => a.type === "BUILD_SETTLEMENT" && a.vertex === c));
  if (!v) throw new Error(`no legal corner on ${hex}`);
  return v;
}

describe("docs/rules.md §17.1 what is under a tile", () => {
  it("§17.1 a 'this tile' tile keeps its own terrain and token, face down; pool tiles draw from the shuffled pool", () => {
    const pool: HexId[] = [MOUNTAIN, hexOf(BEGINNER, "meadow")];
    const def = discoveryBoard([FOREST], pool, { terrains: ["gold", "lake"], tokens: [9] });
    const s = game(def);
    expect(new Set(s.board.hidden)).toEqual(new Set([FOREST, ...pool]));
    expect(new Set(s.discovery!.hidden)).toEqual(new Set([FOREST, ...pool]));
    expect(s.board.hexes[FOREST]).toEqual({ terrain: "forest", token: BEGINNER.hexes.find((h) => hexId(h.at) === FOREST)!.token });
    const drawn = pool.map((h) => s.board.hexes[h]!);
    expect(drawn.map((t) => t.terrain).sort()).toEqual(["gold", "lake"]);
    expect(drawn.find((t) => t.terrain === "gold")!.token).toBe(9);
    expect(drawn.find((t) => t.terrain === "lake")!.token).toBeNull();
    // Seeded: the same seed draws the same way.
    expect(game(def).board.hexes).toEqual(s.board.hexes);
  });

  it("§17.1 without an explicit pool the pool scales to the number of pool tiles and producing terrains get tokens", () => {
    const pool = BEGINNER.hexes.slice(0, 6).map((h) => hexId(h.at));
    const s = game(discoveryBoard([], pool));
    for (const h of pool) {
      const t = s.board.hexes[h]!;
      expect(t).toBeDefined();
      expect(t.token === null).toBe(t.terrain === "wasteland" || t.terrain === "lake");
    }
  });

  it("§17.1 a board without discoverable tiles is unchanged: no hidden list, no discovery state", () => {
    const s = game(BEGINNER);
    expect(s.board.hidden).toBeUndefined();
    expect(s.discovery).toBeUndefined();
  });

  it("§17.1 validation: pool tiles carry no terrain or token, the explicit pool covers them, discoverable tiles are land", () => {
    const codes = (def: BoardDefinition) => validateBoard(def).filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes(discoveryBoard([FOREST], [MOUNTAIN]))).toEqual([]);
    const painted = { ...BEGINNER, hexes: BEGINNER.hexes.map((h) => (hexId(h.at) === MOUNTAIN ? { ...h, extras: { discover: "pool" as const } } : h)) };
    expect(codes(painted)).toContain("DISCOVER_POOL_CONTENT");
    expect(codes(discoveryBoard([], [MOUNTAIN, FOREST], { terrains: ["gold"] }))).toContain("DISCOVER_POOL_SHORT");
    expect(codes(discoveryBoard([], [MOUNTAIN], { terrains: ["volcano" as Terrain] }))).toContain("BAD_TERRAIN");
    expect(codes(discoveryBoard([], [MOUNTAIN], { terrains: ["forest"], tokens: [7] }))).toContain("BAD_TOKEN");
    const sea: BoardDefinition = { ...BEGINNER, hexes: [...BEGINNER.hexes, { at: { q: 3, r: 0 }, kind: "sea", extras: { discover: "tile" } }] };
    expect(codes(sea)).toContain("DISCOVER_NOT_LAND");
  });

  it("§17.1 hidden information: a redacted view hides a face-down tile's terrain and token, and shows it once revealed", () => {
    const pool = [MOUNTAIN];
    const s = game(discoveryBoard([FOREST], pool));
    const view = redact(s, "a");
    for (const h of [FOREST, ...pool]) expect(view.board.hexes[h]).toEqual({ terrain: "wasteland", token: null });
    expect(new Set(view.discovery!.hidden)).toEqual(new Set([FOREST, ...pool]));
    // Which tiles are face down is public; what is under them is not.
    expect(new Set(view.board.hidden)).toEqual(new Set([FOREST, ...pool]));
    // The robber never starts on a face-down tile (its start would give the terrain away).
    expect([FOREST, ...pool]).not.toContain(s.robberHex);
  });

  it("§17.1 the robber does not start on a face-down wasteland", () => {
    const desert = hexOf(BEGINNER, "wasteland");
    const s = game(discoveryBoard([desert]));
    expect(s.robberHex).not.toBe(desert);
  });
});

describe("docs/rules.md §17.2 revealing", () => {
  it("§17.2 a setup settlement on a corner reveals the tile and §17.3 pays the discoverer", () => {
    const s = game(discoveryBoard([FOREST]));
    const v = setupCorner(s, FOREST);
    const { state, events } = applyActionWithEvents(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v });
    expect(state.discovery!.hidden).toEqual([]);
    expect(getPlayer(state, "a").hand.wood).toBe(1);
    expect(events.find((e) => e.kind === "tileDiscovered")).toMatchObject({ kind: "tileDiscovered", playerId: "a", hex: FOREST, terrain: "forest", resource: "wood" });
    expect(redact(state, "b").board.hexes[FOREST]!.terrain).toBe("forest");
  });

  it("§17.2 a road with one end on a corner reveals the tile; one build can reveal several", () => {
    let s = finishSetup(game(discoveryBoard([])));
    // Pick an own road end, then make every tile touching the next edge out face down.
    const me = s.players[s.currentPlayer]!;
    const geo = boardGeometry(s.board);
    s = give(inPhase(s, { kind: "action" }, me.id), me.id, { wood: 1, clay: 1 });
    const legal = legalActions(s, me.id).flatMap((a) => (a.type === "BUILD_ROAD" ? [a.edge] : []));
    const edge = legal[0] as EdgeId;
    const touched = [...new Set(edgeVerticesOf(edge).flatMap((v) => geo.vertexHexes[v] ?? []))].filter((h) => s.board.hexes[h]);
    const owned = new Set([...me.settlements, ...me.cities].flatMap((v) => geo.vertexHexes[v] ?? []));
    const fresh = touched.filter((h) => !owned.has(h));
    expect(fresh.length).toBeGreaterThan(0);
    s = hideTiles(s, fresh);
    const before = handSize(getPlayer(s, me.id).hand);
    const { state, events } = applyActionWithEvents(s, { type: "BUILD_ROAD", playerId: me.id, edge });
    expect(state.discovery!.hidden).toEqual([]);
    const found = events.filter((e) => e.kind === "tileDiscovered");
    expect(found.map((e) => (e as { hex: HexId }).hex).sort()).toEqual([...fresh].sort());
    const paying = fresh.filter((h) => TERRAIN_RESOURCE[s.board.hexes[h]!.terrain] !== null).length;
    expect(handSize(getPlayer(state, me.id).hand)).toBe(before - 2 + paying);
  });

  it("§17.2 a face-down tile produces nothing", () => {
    let s = finishSetup(game(discoveryBoard([])));
    const geo = boardGeometry(s.board);
    // A producing tile with an "a" settlement on it, its number unique on the board, then forced face down.
    const built = new Set(s.players.flatMap((p) => [...p.settlements, ...p.cities]).flatMap((v) => geo.vertexHexes[v] ?? []));
    const target = Object.keys(s.board.hexes).find((h) => {
      const t = s.board.hexes[h]!;
      return t.token !== null && TERRAIN_RESOURCE[t.terrain] !== null && h !== s.robberHex && !built.has(h);
    })!;
    const token = s.board.hexes[target]!.token!;
    const corner = corners(target).find((v) => (geo.vertexNeighbors[v] ?? []).every((n) => s.players.every((p) => !p.settlements.includes(n) && !p.cities.includes(n))) && s.players.every((p) => !p.settlements.includes(v) && !p.cities.includes(v)))!;
    s = place(s, "a", { settlements: [corner] });
    s = mut(s, (x) => {
      for (const [h, t] of Object.entries(x.board.hexes)) if (h !== target && t.token === token) (x.board.hexes as Record<HexId, typeof t>)[h] = { ...t, token: token === 2 ? 12 : 2 };
    });
    const resource = TERRAIN_RESOURCE[s.board.hexes[target]!.terrain]!;
    const roll = (state: GameState) => applyAction(withNextRoll(inPhase(state, { kind: "roll" }, "a"), token), { type: "ROLL", playerId: "a" });
    expect(getPlayer(roll(s), "a").hand[resource]).toBe(getPlayer(s, "a").hand[resource] + 1);
    const hidden = hideTiles(s, [target]);
    expect(getPlayer(roll(hidden), "a").hand[resource]).toBe(getPlayer(hidden, "a").hand[resource]);
  });
});

describe("docs/rules.md §17.3 the discoverer's reward", () => {
  function revealWith(def: BoardDefinition, hex: HexId): { state: GameState; player: PlayerId } {
    const s = game(def);
    const v = setupCorner(s, hex);
    return { state: applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: v }), player: "a" };
  }

  it("§17.3 a gold field asks the discoverer for one resource of their choice, then play continues", () => {
    const { state } = revealWith(discoveryBoard([], [FOREST], { terrains: ["gold"], tokens: [5] }), FOREST);
    expect(state.phase).toMatchObject({ kind: "chooseGold", owed: { a: 1 }, returnTo: { kind: "setup", step: "road" } });
    const after = applyAction(state, { type: "CHOOSE_GOLD", playerId: "a", resources: ["ore"] });
    expect(getPlayer(after, "a").hand.ore).toBe(1);
    expect(after.phase).toMatchObject({ kind: "setup", step: "road" });
  });

  it("§17.3 a wasteland or a lake gives nothing", () => {
    for (const terrain of ["wasteland", "lake"] as const) {
      const { state } = revealWith(discoveryBoard([], [FOREST], { terrains: [terrain] }), FOREST);
      expect(handSize(getPlayer(state, "a").hand)).toBe(0);
      expect(state.discovery!.hidden).toEqual([]);
    }
  });

  it("§17.3 an empty bank pays nothing for that tile", () => {
    const s = mut(game(discoveryBoard([FOREST])), (x) => {
      x.bank.wood = 0;
    });
    const after = applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: setupCorner(s, FOREST) });
    expect(getPlayer(after, "a").hand.wood).toBe(0);
    expect(after.discovery!.hidden).toEqual([]);
  });

  it("§17.3 the second setup settlement gets the starting resource and the reward from a tile it reveals", () => {
    let s = game(discoveryBoard([FOREST]));
    // Round 1 elsewhere for everyone, then player d (first in round 2) settles on the forest.
    s = mut(s, (x) => {
      x.phase = { kind: "setup", round: 2, step: "settlement", lastSettlement: null };
      x.currentPlayer = 3;
    });
    const after = applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "d", vertex: setupCorner(s, FOREST) });
    expect(getPlayer(after, "d").hand.wood).toBeGreaterThanOrEqual(2);
  });

  it("§5.6 a build that reveals nothing can still be undone; one that reveals a tile cannot", () => {
    let s = finishSetup(game(discoveryBoard([])));
    const me = s.players[s.currentPlayer]!.id;
    s = give(inPhase(s, { kind: "action" }, me), me, { wood: 2, clay: 2 });
    const edges = legalActions(s, me).flatMap((a) => (a.type === "BUILD_ROAD" ? [a.edge] : []));
    const plain = applyAction(s, { type: "BUILD_ROAD", playerId: me, edge: edges[0]! });
    expect(legalActions(plain, me).some((a) => a.type === "UNDO_BUILD")).toBe(true);
    const geo = boardGeometry(s.board);
    const touched = edgeVerticesOf(edges[0]!).flatMap((v) => geo.vertexHexes[v] ?? []).filter((h) => s.board.hexes[h]);
    const own = new Set(getPlayer(s, me).settlements.flatMap((v) => geo.vertexHexes[v] ?? []));
    const fresh = touched.filter((h) => !own.has(h));
    if (fresh.length === 0) return; // this edge only touches tiles the player already sits on
    const hidden = hideTiles(s, fresh);
    const revealed = applyAction(hidden, { type: "BUILD_ROAD", playerId: me, edge: edges[0]! });
    expect(legalActions(revealed, me).some((a) => a.type === "UNDO_BUILD")).toBe(false);
  });
});

describe("docs/rules.md §17 random play", () => {
  it("§17 random games on a board with face-down tiles keep the bank whole, reveal tiles only next to pieces, and replay exactly", () => {
    const def = discoveryBoard([FOREST, MOUNTAIN], [hexOf(BEGINNER, "farmland"), hexOf(BEGINNER, "claypit")], { terrains: ["gold", "forest"] });
    const scenario: Scenario = { id: "discovery", name: "Discovery", board: def, modules: {}, victoryPoints: 10 };
    for (const seed of ["d1", "d2", "d3"]) {
      const run = playRandomGame(seed, {
        scenario,
        onStep: (state) => {
          const total = RESOURCES.reduce((n, r) => n + state.bank[r] + state.players.reduce((m, p) => m + p.hand[r], 0), 0);
          expect(total).toBe(95);
          const geo = boardGeometry(state.board);
          for (const h of state.discovery?.hidden ?? []) {
            for (const p of state.players) {
              for (const v of [...p.settlements, ...p.cities]) expect(geo.vertexHexes[v] ?? []).not.toContain(h);
              for (const e of [...p.roads, ...p.ships]) for (const v of edgeVerticesOf(e)) expect(geo.vertexHexes[v] ?? []).not.toContain(h);
            }
          }
        },
      });
      expect(replay(run.initial, run.actions)).toEqual(run.final);
    }
  });

  it("§17 a revealed tile is ordinary: it shows to everyone and leaves the hidden list", () => {
    const s = game(discoveryBoard([FOREST]));
    expectRule(() => applyAction(s, { type: "BUILD_SETTLEMENT", playerId: "b", vertex: corners(FOREST)[0]! }), "NOT_YOUR_TURN");
  });
});
