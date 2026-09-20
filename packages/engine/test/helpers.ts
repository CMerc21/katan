import { expect } from "vitest";
import { RESOURCES, TERRAIN_RESOURCE, type Resource, type Terrain } from "../src/board";
import { RuleError, isRuleError } from "../src/errors";
import { GEOMETRY, hexCorner, type EdgeId, type HexId, type VertexId } from "../src/geometry";
import { applyAction } from "../src/actions";
import { createGame } from "../src/game";
import { legalActions } from "../src/legal";
import { createRng, rng, type Rng } from "../src/rng";
import { buildingAt, cloneJson, currentPlayerId, getPlayer, hand, nextActor } from "../src/state";
import { updateLongestRoad } from "../src/specialCards";
import type { Scenario } from "../src/scenario";
import type { Action, GameState, Hand, PlayerId } from "../src/types";

export const FOUR = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
  { id: "d", name: "Di" },
];

export function newGame(players = FOUR, seed = "test-seed"): GameState {
  return createGame({ seed, players, board: "beginner" });
}

export function expectRule(fn: () => unknown, code: RuleError["code"]): void {
  try {
    fn();
  } catch (err) {
    if (!isRuleError(err)) throw err;
    expect(err.code).toBe(code);
    return;
  }
  throw new Error(`expected RuleError ${code}`);
}

/** Return a modified deep copy. */
export function mut(state: GameState, fn: (s: GameState) => void): GameState {
  const next = cloneJson(state);
  fn(next);
  return next;
}

/** Give a player resources from the bank (test setup only). */
export function give(state: GameState, playerId: PlayerId, cards: Partial<Hand>): GameState {
  return mut(state, (s) => {
    const p = getPlayer(s, playerId);
    const full = hand(cards);
    for (const r of RESOURCES) {
      p.hand[r] += full[r];
      s.bank[r] -= full[r];
    }
  });
}

/** Directly place pieces, keeping supplies consistent (test setup only). */
export function place(
  state: GameState,
  playerId: PlayerId,
  pieces: { roads?: EdgeId[]; settlements?: VertexId[]; cities?: VertexId[] },
): GameState {
  return mut(state, (s) => {
    const p = getPlayer(s, playerId);
    for (const e of pieces.roads ?? []) {
      p.roads.push(e);
      p.pieces.roads -= 1;
    }
    for (const v of pieces.settlements ?? []) {
      p.settlements.push(v);
      p.pieces.settlements -= 1;
    }
    for (const v of pieces.cities ?? []) {
      p.cities.push(v);
      p.pieces.cities -= 1;
    }
    updateLongestRoad(s);
  });
}

/** Put the game into a given phase with `playerId` as current (test setup only). */
export function inPhase(state: GameState, phase: GameState["phase"], playerId?: PlayerId): GameState {
  return mut(state, (s) => {
    s.phase = phase;
    if (playerId !== undefined) s.currentPlayer = s.players.findIndex((p) => p.id === playerId);
  });
}

export const ACTION_PHASE: GameState["phase"] = { kind: "action" };
export const ROLL_PHASE: GameState["phase"] = { kind: "roll" };

/** A deterministic, sensible setup: each player takes the first legal placement. */
export function finishSetup(start: GameState, rng?: Rng): GameState {
  let state = start;
  // Module prompts (a raiders castle) and gold choices may interleave with the setup steps.
  while (state.phase.kind !== "roll" && state.phase.kind !== "ended") {
    const who = nextActor(state);
    const actions = legalActions(state, who);
    const action = rng ? actions[rng.int(actions.length)] : actions[0];
    if (!action) throw new Error("no legal setup action");
    state = applyAction(state, action);
  }
  return state;
}

/** Corner helpers around the centre hex for hand-built scenarios. */
export const CENTER = { q: 0, r: 0 };
export const centerCorner = (k: number): VertexId => hexCorner(CENTER, k);

/** The edge joining two adjacent vertices. */
export function edgeBetween(a: VertexId, b: VertexId): EdgeId {
  const e = GEOMETRY.vertexEdges[a]?.find((x) => GEOMETRY.edgeVertices[x]?.includes(b));
  if (!e) throw new Error(`no edge between ${a} and ${b}`);
  return e;
}

/** A simple path of vertices starting at `start`, following the first unvisited neighbour. */
export function vertexPath(start: VertexId, length: number, avoid: readonly VertexId[] = []): VertexId[] {
  const path = [start];
  while (path.length < length + 1) {
    const at = path[path.length - 1] as VertexId;
    const next = GEOMETRY.vertexNeighbors[at]?.find((n) => !path.includes(n) && !avoid.includes(n));
    if (!next) throw new Error("path dead end");
    path.push(next);
  }
  return path;
}

/** Vertices of `path` plus all their neighbours (for keeping other paths clear). */
export function around(path: readonly VertexId[]): VertexId[] {
  const out = new Set<VertexId>(path);
  for (const v of path) for (const n of GEOMETRY.vertexNeighbors[v] ?? []) out.add(n);
  return [...out];
}

/** A vertex outside `avoid` from which a clear path of `length` can be walked. */
export function clearStart(length: number, avoid: readonly VertexId[]): VertexId {
  for (const v of GEOMETRY.vertices) {
    if (avoid.includes(v)) continue;
    try {
      vertexPath(v, length, avoid);
      return v;
    } catch {
      /* try next */
    }
  }
  throw new Error("no clear start");
}

export function pathEdges(path: VertexId[]): EdgeId[] {
  const out: EdgeId[] = [];
  for (let i = 0; i + 1 < path.length; i++) out.push(edgeBetween(path[i] as VertexId, path[i + 1] as VertexId));
  return out;
}

// ---------------------------------------------------------------------------
// Random play driver

const WEIGHTS: Record<Action["type"], number> = {
  ROLL: 1,
  DISCARD: 1,
  MOVE_ROBBER: 1,
  STEAL: 1,
  BUILD_ROAD: 6,
  BUILD_SETTLEMENT: 12,
  BUILD_CITY: 12,
  BUY_DEV_CARD: 4,
  PLAY_KNIGHT: 3,
  PLAY_ROAD_BUILDING: 4,
  PLAY_INVENTION: 4,
  PLAY_MONOPOLY: 4,
  OFFER_TRADE: 0.5,
  ACCEPT_TRADE: 1,
  REJECT_TRADE: 2,
  CANCEL_TRADE: 1,
  COUNTER_TRADE: 1,
  ACCEPT_COUNTER: 2,
  UNDO_BUILD: 0.5,
  MARITIME_TRADE: 1,
  END_TURN: 2,
  SPECIAL_BUILD_DONE: 2,
  BUILD_SHIP: 6,
  MOVE_SHIP: 1,
  CHOOSE_GOLD: 1,
  // Wayfarers (docs/phase10.md)
  NEIGHBORLY_GIVE: 1,
  SPEND_FISH: 4,
  BUILD_KNIGHT: 4,
  BUILD_CASTLE: 6,
  REBUILD_HEX: 6,
  EXTEND_CARAVAN: 4,
  MOVE_WAGON: 2,
  LOAD_COMMODITY: 4,
  DELIVER: 8,
  // Crown & Castle (docs/phase11.md)
  ACTIVATE_KNIGHT: 3,
  PROMOTE_KNIGHT: 3,
  KNIGHT_MOVE: 1,
  KNIGHT_DISPLACE: 2,
  KNIGHT_CHASE_ROBBER: 2,
  BUILD_IMPROVEMENT: 8,
  BUILD_WALL: 2,
  PLAY_PROGRESS: 4,
  DISCARD_PROGRESS: 1,
  CHOOSE_DOWNGRADE: 1,
  PLACE_METROPOLIS: 1,
  CHOOSE_DESERTER: 1,
  PLACE_FREE_KNIGHT: 1,
  RETREAT_KNIGHT: 1,
  SPY_TAKE: 1,
  COMMERCIAL_SWAP: 1,
  GIVE_CARDS: 1,
};

/** All legal actions for every player, current player first. */
export function allLegalActions(state: GameState): Action[] {
  const out: Action[] = [];
  const cur = currentPlayerId(state);
  out.push(...legalActions(state, cur));
  for (const p of state.players) if (p.id !== cur) out.push(...legalActions(state, p.id));
  return out;
}

const BUILD_TYPES: ReadonlySet<Action["type"]> = new Set(["BUILD_ROAD", "BUILD_SHIP", "BUILD_SETTLEMENT", "BUILD_CITY", "BUY_DEV_CARD"]);

/**
 * Greedy-random policy: build or buy whenever possible; otherwise pick an
 * action type by weight, then a uniform instance of that type. Maritime
 * trades are only considered when the trader holds 7+ cards, so resources
 * are not squandered and games progress.
 */
export function pickWeighted(state: GameState, actions: Action[], rng: Rng): Action {
  const builds = actions.filter((a) => BUILD_TYPES.has(a.type));
  const useful = actions.filter((a) => {
    if (a.type !== "MARITIME_TRADE" || !RESOURCES.includes(a.give as Resource) || !RESOURCES.includes(a.receive as Resource)) return false;
    const h = getPlayer(state, a.playerId).hand;
    const most = RESOURCES.reduce((best, r) => (h[r] > h[best] ? r : best), RESOURCES[0]);
    const give = a.give as Resource;
    const receive = a.receive as Resource;
    return give === most && h[receive] <= 1 && h[give] - a.giveCount >= 1;
  });
  const pool =
    builds.length > 0 ? builds : useful.length > 0 ? useful : actions.filter((a) => a.type !== "MARITIME_TRADE");
  const candidates = pool.length > 0 ? pool : actions;
  const byType = new Map<Action["type"], Action[]>();
  for (const a of candidates) {
    const list = byType.get(a.type);
    if (list) list.push(a);
    else byType.set(a.type, [a]);
  }
  const types = [...byType.keys()];
  const total = types.reduce((n, t) => n + WEIGHTS[t], 0);
  let roll = rng.next() * total;
  let chosen = types[types.length - 1] as Action["type"];
  for (const t of types) {
    roll -= WEIGHTS[t];
    if (roll < 0) {
      chosen = t;
      break;
    }
  }
  const list = byType.get(chosen) as Action[];
  return list[rng.int(list.length)] as Action;
}

export interface RandomGame {
  readonly initial: GameState;
  readonly final: GameState;
  readonly actions: Action[];
  readonly turnsPlayed: number;
}

export function playRandomGame(
  seed: string,
  options: { maxTurns?: number; onStep?: (state: GameState, action: Action) => void; players?: typeof FOUR; scenario?: Scenario } = {},
): RandomGame {
  // 600, not 400: over forty seeds the greedy-random policy's games run 80–390 turns
  // (mean ~180) whatever the rule set, so a 400 cap was one reshuffle of the seeded
  // stream away from a false failure.
  const maxTurns = options.maxTurns ?? 600;
  const initial = options.scenario ? createGame({ seed, players: options.players ?? FOUR, scenario: options.scenario }) : createGame({ seed, players: options.players ?? FOUR, board: "random" });
  const rng = createRng(seed, "random-play");
  let state = initial;
  const actions: Action[] = [];
  while (state.phase.kind !== "ended" && state.turn < maxTurns) {
    const legal = allLegalActions(state);
    if (legal.length === 0) throw new Error(`no legal actions in phase ${state.phase.kind} (seed ${seed})`);
    const action = pickWeighted(state, legal, rng);
    state = applyAction(state, action);
    actions.push(action);
    options.onStep?.(state, action);
  }
  return { initial, final: state, actions, turnsPlayed: state.turn };
}

// ---------------------------------------------------------------------------
// Scenario helpers

/** Set `actionIndex` so that the next ROLL produces `total` (searches the seeded stream). */
export function withNextRoll(state: GameState, total: number): GameState {
  for (let i = 0; i < 100_000; i++) {
    const dice = rng(state.seed, i);
    const sum = dice.int(6) + 1 + dice.int(6) + 1;
    if (sum === total) return mut(state, (s) => void (s.actionIndex = i));
  }
  throw new Error(`no action index rolls ${total}`);
}

/** First hex with the given terrain (and optionally token). */
export function hexWith(state: GameState, terrain: Terrain, token?: number): HexId {
  const hex = GEOMETRY.hexes.find((h) => {
    const t = state.board.hexes[h]!;
    return t.terrain === terrain && (token === undefined || t.token === token);
  });
  if (!hex) throw new Error(`no ${terrain} hex`);
  return hex;
}

/** The hand each player would receive if `total` were rolled (settlement 1, city 2), ignoring the bank. */
export function expectedProduction(state: GameState, total: number): Record<PlayerId, Hand> {
  const out: Record<PlayerId, Hand> = {};
  for (const p of state.players) out[p.id] = hand({});
  for (const h of GEOMETRY.hexes) {
    const tile = state.board.hexes[h]!;
    if (tile.token !== total || h === state.robberHex) continue;
    const r = TERRAIN_RESOURCE[tile.terrain];
    if (!r) continue;
    for (const v of GEOMETRY.hexVertices[h]!) {
      const b = buildingAt(state, v);
      if (b) out[b.owner]![r] += b.kind === "city" ? 2 : 1;
    }
  }
  return out;
}
