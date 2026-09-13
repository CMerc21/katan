/**
 * Wayfarers: wagons (docs/phase10.md §7).
 *
 * Every player has a wagon that rolls along anyone's roads: two free steps
 * per turn, one grain per step after that, and a toll of one resource to
 * pass an opponent's wagon. Cities stock a seeded good at every turn end;
 * wagons carry up to two goods and score by delivering them to an
 * opponent's city (1 VP, 2 when the good is the one that city demands).
 */

import { RESOURCES, boardGeometry, type Resource } from "../../board";
import { RuleError } from "../../errors";
import type { EdgeId, VertexId } from "../../geometry";
import { requireCurrent, requirePhase } from "../../guards";
import { createRng } from "../../rng";
import { buildingAt, currentPlayerId, emit, getPlayer, roadsMap, variantOn } from "../../state";
import type { Action, GameState, Player, PlayerId } from "../../types";
import { registerModule } from "../hooks";
import { CITY_STOCK_CAP, WAGON_CAPACITY, WAGON_FREE_STEPS, WAGON_GOODS, isWagonGood, type Wagon, type WagonGood, type WagonsState } from "../types";

function wagons(state: GameState): WagonsState {
  const w = state.wayfarers?.wagons;
  if (!w) throw new RuleError("MODULE_OFF", "wagons are not in this game");
  return w;
}

function wagonOf(state: GameState, playerId: PlayerId): Wagon {
  const wagon = wagons(state).wagons[playerId];
  if (!wagon) throw new RuleError("WAGON_BAD_PATH", `${playerId} has no wagon yet`);
  return wagon;
}

/** The good a city produces, fixed by a seeded hash of its vertex. */
function goodOf(state: GameState, vertex: VertexId): WagonGood {
  return WAGON_GOODS[createRng(state.seed, `wagon:${vertex}`).int(WAGON_GOODS.length)] as WagonGood;
}

/** The city's current demand, seeded at first and rotating after every delivery. */
function demandAt(state: GameState, vertex: VertexId): WagonGood {
  const w = wagons(state);
  const held = w.demand[vertex];
  if (held) return held;
  const initial = WAGON_GOODS[createRng(state.seed, `demand:${vertex}`).int(WAGON_GOODS.length)] as WagonGood;
  w.demand[vertex] = initial;
  return initial;
}

function nextGood(good: WagonGood): WagonGood {
  return WAGON_GOODS[(WAGON_GOODS.indexOf(good) + 1) % WAGON_GOODS.length] as WagonGood;
}

/** Register a city's demand token and empty shelf the moment it exists. */
function registerCity(state: GameState, vertex: VertexId): void {
  const w = wagons(state);
  demandAt(state, vertex);
  if (!w.stock[vertex]) w.stock[vertex] = [];
}

function allCities(state: GameState): VertexId[] {
  return state.players.flatMap((p) => p.cities);
}

/** Free steps left this turn. */
function freeSteps(wagon: Wagon): number {
  return Math.max(0, WAGON_FREE_STEPS - wagon.stepsUsed);
}

/** Opponents whose wagon stands on any vertex of `path` after the first. */
function blockers(state: GameState, playerId: PlayerId, path: readonly VertexId[]): PlayerId[] {
  const w = wagons(state);
  const out: PlayerId[] = [];
  for (const [id, wagon] of Object.entries(w.wagons)) {
    if (id === playerId) continue;
    if (path.slice(1).includes(wagon.at)) out.push(id);
  }
  return out;
}

/** Vertices reachable from `v` by a road of any player (ships never carry a wagon). */
function roadNeighbours(state: GameState, roads: ReadonlyMap<EdgeId, PlayerId>, v: VertexId): VertexId[] {
  const geo = boardGeometry(state.board);
  const out: VertexId[] = [];
  for (const e of geo.vertexEdges[v] ?? []) {
    if (!roads.has(e)) continue;
    const [a, b] = geo.edgeVertices[e] as readonly [VertexId, VertexId];
    out.push(a === v ? b : a);
  }
  return out;
}

function applyMove(state: GameState, action: Extract<Action, { type: "MOVE_WAGON" }>): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const wagon = wagonOf(state, player.id);
  const raw: unknown = action.path;
  if (!Array.isArray(raw) || raw.length < 2 || !raw.every((v: unknown) => typeof v === "string")) throw new RuleError("WAGON_BAD_PATH", "a wagon path lists at least two vertices");
  const path = raw as VertexId[];
  if (path[0] !== wagon.at) throw new RuleError("WAGON_BAD_PATH", `the wagon stands at ${wagon.at}, not ${path[0]}`);
  if (new Set(path).size !== path.length) throw new RuleError("WAGON_BAD_PATH", "a wagon path never revisits a vertex");
  const roads = roadsMap(state);
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i] as VertexId;
    const to = path[i + 1] as VertexId;
    if (!roadNeighbours(state, roads, from).includes(to)) throw new RuleError("WAGON_BAD_PATH", `no road from ${from} to ${to}`);
  }

  const steps = path.length - 1;
  const extra = Math.max(0, steps - freeSteps(wagon));
  const grain: unknown = action.grain ?? 0;
  if (typeof grain !== "number" || !Number.isInteger(grain) || grain !== extra) {
    throw new RuleError("WAGON_NO_STEPS", extra === 0 ? "those steps are free this turn" : `${extra} step${extra === 1 ? "" : "s"} beyond the free ones cost ${extra} grain`);
  }
  if (player.hand.grain < grain) throw new RuleError("INSUFFICIENT_RESOURCES", `need ${grain} grain`);

  const inTheWay = blockers(state, player.id, path);
  if (inTheWay.length > 1) throw new RuleError("WAGON_BLOCKED", "only one wagon can be paid off per move");
  const blocker = inTheWay[0] ?? null;
  let toll: Resource | null = null;
  if (blocker !== null) {
    const offered: unknown = action.toll;
    if (!RESOURCES.includes(offered as Resource)) throw new RuleError("WAGON_BLOCKED", `${blocker}'s wagon is in the way: offer a toll`);
    toll = offered as Resource;
    if (player.hand[toll] < 1 + (toll === "grain" ? grain : 0)) throw new RuleError("INSUFFICIENT_RESOURCES", `no ${toll} for the toll`);
  }

  player.hand.grain -= grain;
  state.bank.grain += grain;
  if (blocker !== null && toll !== null) {
    player.hand[toll] -= 1;
    getPlayer(state, blocker).hand[toll] += 1;
  }
  wagon.at = path[path.length - 1] as VertexId;
  wagon.stepsUsed += steps;
  emit(state, { kind: "wagonMoved", playerId: player.id, path: [...path], grain, toll: blocker });
}

/** Index of a `good` in the cargo that was not loaded at the wagon's current vertex, or -1. */
function deliverableIndex(wagon: Wagon, good: WagonGood): number {
  return wagon.cargo.findIndex((g, i) => g === good && wagon.cargoFrom[i] !== wagon.at);
}

function requireGood(value: unknown): WagonGood {
  if (!isWagonGood(value)) throw new RuleError("INVALID_PAYLOAD", `${String(value)} is not a good`);
  return value;
}

function applyLoad(state: GameState, action: Extract<Action, { type: "LOAD_COMMODITY" }>): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const wagon = wagonOf(state, player.id);
  const good = requireGood(action.good);
  if (buildingAt(state, wagon.at)?.kind !== "city") throw new RuleError("NOT_A_CITY", "goods are loaded at a city");
  const w = wagons(state);
  const shelf = w.stock[wagon.at] ?? [];
  const i = shelf.indexOf(good);
  if (i < 0) throw new RuleError("NO_GOODS", `no ${good} in stock here`);
  if (wagon.cargo.length >= WAGON_CAPACITY) throw new RuleError("WAGON_FULL", `a wagon carries ${WAGON_CAPACITY} goods`);
  shelf.splice(i, 1);
  w.stock[wagon.at] = shelf;
  wagon.cargo.push(good);
  wagon.cargoFrom.push(wagon.at);
  emit(state, { kind: "goodLoaded", playerId: player.id, vertex: wagon.at, good });
}

function applyDeliver(state: GameState, action: Extract<Action, { type: "DELIVER" }>): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const wagon = wagonOf(state, player.id);
  const good = requireGood(action.good);
  const city = buildingAt(state, wagon.at);
  if (!city || city.kind !== "city" || city.owner === player.id) throw new RuleError("NOT_A_CITY", "deliveries go to another player's city");
  const i = deliverableIndex(wagon, good);
  if (i < 0) throw new RuleError("NO_CARGO", wagon.cargo.includes(good) ? `that ${good} was loaded here; deliver it elsewhere` : `the wagon carries no ${good}`);
  const w = wagons(state);
  const demand = demandAt(state, wagon.at);
  const points = good === demand ? 2 : 1;
  wagon.cargo.splice(i, 1);
  wagon.cargoFrom.splice(i, 1);
  w.points[player.id] = (w.points[player.id] ?? 0) + points;
  w.demand[wagon.at] = nextGood(demand);
  emit(state, { kind: "delivered", playerId: player.id, vertex: wagon.at, good, points });
}

/** Every simple road path from the wagon of up to `maxSteps` steps (roads have degree ≤ 3, so this stays tiny). */
function wagonPaths(state: GameState, from: VertexId, maxSteps: number): VertexId[][] {
  const roads = roadsMap(state);
  const out: VertexId[][] = [];
  const walk = (path: VertexId[]): void => {
    if (path.length - 1 >= maxSteps) return;
    for (const next of roadNeighbours(state, roads, path[path.length - 1] as VertexId)) {
      if (path.includes(next)) continue;
      const longer = [...path, next];
      out.push(longer);
      walk(longer);
    }
  };
  walk([from]);
  return out;
}

registerModule({
  id: "wagons",
  enabled: (state: GameState) => variantOn(state, "wagons"),

  init(state) {
    if (!state.wayfarers) state.wayfarers = { eventDeck: null, fishing: null, rivers: null, harbormaster: null, raiders: null, caravans: null, wagons: null };
    const points: Record<PlayerId, number> = {};
    for (const p of state.players) points[p.id] = 0;
    state.wayfarers.wagons = { wagons: {}, stock: {}, demand: {}, points };
  },

  onSetupSettlement(state, player, vertex, round) {
    if (round !== 2) return;
    wagons(state).wagons[player.id] = { at: vertex, cargo: [], cargoFrom: [], stepsUsed: 0 };
  },

  onBuilt(state, _playerId, piece, at) {
    if (piece === "city") registerCity(state, at);
  },

  onTurnStart(state) {
    for (const wagon of Object.values(wagons(state).wagons)) wagon.stepsUsed = 0;
  },

  onTurnEnd(state) {
    const w = wagons(state);
    const stocked: { vertex: VertexId; good: WagonGood }[] = [];
    for (const vertex of allCities(state)) {
      registerCity(state, vertex);
      const shelf = w.stock[vertex] as WagonGood[];
      if (shelf.length >= CITY_STOCK_CAP) continue;
      const good = goodOf(state, vertex);
      shelf.push(good);
      stocked.push({ vertex, good });
    }
    if (stocked.length > 0) emit(state, { kind: "goodsStocked", stocked });
  },

  extraActions(state, playerId, out) {
    if (state.phase.kind !== "action" || currentPlayerId(state) !== playerId) return;
    const w = wagons(state);
    const wagon = w.wagons[playerId];
    if (!wagon) return;
    const player: Player = getPlayer(state, playerId);
    const free = freeSteps(wagon);
    const paid = player.hand.grain > 0 ? 1 : 0;
    const tollWith = RESOURCES.find((r) => player.hand[r] > 0) ?? null;
    for (const path of wagonPaths(state, wagon.at, free + paid)) {
      const steps = path.length - 1;
      const grain = Math.max(0, steps - free);
      const inTheWay = blockers(state, playerId, path);
      if (inTheWay.length > 1) continue;
      if (inTheWay.length === 1 && tollWith === null) continue;
      // A toll and the grain come out of the same hand: skip what cannot be paid together.
      if (inTheWay.length === 1 && tollWith === "grain" && player.hand.grain < grain + 1) continue;
      out.push({
        type: "MOVE_WAGON",
        playerId,
        path,
        ...(grain > 0 ? { grain } : {}),
        ...(inTheWay.length === 1 && tollWith !== null ? { toll: tollWith } : {}),
      });
    }
    const here = buildingAt(state, wagon.at);
    if (here?.kind !== "city") return;
    if (wagon.cargo.length < WAGON_CAPACITY) {
      for (const good of new Set(w.stock[wagon.at] ?? [])) out.push({ type: "LOAD_COMMODITY", playerId, good });
    }
    if (here.owner !== playerId) {
      for (const good of new Set(wagon.cargo)) if (deliverableIndex(wagon, good) >= 0) out.push({ type: "DELIVER", playerId, good });
    }
  },

  apply(state, action) {
    switch (action.type) {
      case "MOVE_WAGON":
        applyMove(state, action);
        return true;
      case "LOAD_COMMODITY":
        applyLoad(state, action);
        return true;
      case "DELIVER":
        applyDeliver(state, action);
        return true;
      default:
        return false;
    }
  },

  victoryPoints(state, player) {
    return { publicVP: wagons(state).points[player.id] ?? 0, hiddenVP: 0 };
  },
});
