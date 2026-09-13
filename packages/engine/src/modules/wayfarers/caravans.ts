/**
 * Wayfarers: caravans (docs/phase10.md §6).
 *
 * Oases produce spice instead of their resource. A player who holds a road
 * next to a caravan's end may pay 1 spice to pull the caravan one edge
 * further (three edges per track). Roads on or touching a track count
 * double for Longest Road, and buildings on a track's vertices get one
 * extra card from each adjacent producing hex on its number.
 */

import { TERRAIN_RESOURCE, boardGeometry, type Resource } from "../../board";
import { RuleError } from "../../errors";
import type { EdgeId, HexId, VertexId } from "../../geometry";
import { requireCurrent, requirePhase } from "../../guards";
import { buildingAt, currentPlayerId, emit, getPlayer, variantOn } from "../../state";
import { updateLongestRoad } from "../../specialCards";
import type { Action, GameState, Player, PlayerId } from "../../types";
import { activeModules, registerModule, type ProduceContext } from "../hooks";
import { CARAVAN_LENGTH, SPICE_BANK, type CaravanTrack, type CaravansState } from "../types";

function caravans(state: GameState): CaravansState {
  const c = state.wayfarers?.caravans;
  if (!c) throw new RuleError("MODULE_OFF", "caravans are not in this game");
  return c;
}

function trackVertices(state: GameState, track: CaravanTrack): Set<VertexId> {
  const geo = boardGeometry(state.board);
  const out = new Set<VertexId>();
  for (const e of track.edges) for (const v of geo.edgeVertices[e] ?? []) out.add(v);
  return out;
}

/** Edges the caravan may take next: around its oasis when it has not left, else those sharing a vertex with its last edge. */
function nextEdges(state: GameState, track: CaravanTrack): EdgeId[] {
  const geo = boardGeometry(state.board);
  if (track.edges.length === 0) return [...(geo.hexEdges[track.oasis] ?? [])];
  const last = track.edges[track.edges.length - 1] as EdgeId;
  const out: EdgeId[] = [];
  for (const v of geo.edgeVertices[last] ?? []) {
    for (const e of geo.vertexEdges[v] ?? []) {
      if (!track.edges.includes(e) && !out.includes(e)) out.push(e);
    }
  }
  return out;
}

/** Does `hex` produce this roll for the base rules and every other module (robber, raids)? */
function hexProduces(state: GameState, hex: HexId): boolean {
  if (hex === state.robberHex) return false;
  return !activeModules(state).some((h) => h.id !== "caravans" && h.hexProduces?.(state, hex) === false);
}

/** Seat order starting at the current player. */
function seatOrder(state: GameState): Player[] {
  const n = state.players.length;
  const out: Player[] = [];
  for (let step = 0; step < n; step++) out.push(state.players[(state.currentPlayer + step) % n] as Player);
  return out;
}

function produceSpice(state: GameState, total: number): void {
  const c = caravans(state);
  const owed = new Map<PlayerId, { hex: HexId; count: number }[]>();
  for (const oasis of state.board.oases) {
    const tile = state.board.hexes[oasis];
    if (!tile || tile.token !== total || !hexProduces(state, oasis)) continue;
    for (const v of boardGeometry(state.board).hexVertices[oasis] ?? []) {
      const b = buildingAt(state, v);
      if (!b) continue;
      const list = owed.get(b.owner) ?? [];
      list.push({ hex: oasis, count: b.kind === "city" ? 2 : 1 });
      owed.set(b.owner, list);
    }
  }
  if (owed.size === 0) return;
  const gains: { playerId: PlayerId; hex: HexId; count: number }[] = [];
  for (const p of seatOrder(state)) {
    for (const g of owed.get(p.id) ?? []) {
      const count = Math.min(g.count, c.spiceBank);
      if (count <= 0) continue;
      c.spiceBank -= count;
      c.spice[p.id] = (c.spice[p.id] ?? 0) + count;
      gains.push({ playerId: p.id, hex: g.hex, count });
    }
  }
  if (gains.length > 0) emit(state, { kind: "spiceProduced", gains });
}

/** +1 of each adjacent producing hex's resource for every building on a track vertex (docs/phase10.md §6). */
function produceBonus(state: GameState, total: number, ctx: ProduceContext): void {
  const c = caravans(state);
  const geo = boardGeometry(state.board);
  const vertices = new Set<VertexId>();
  for (const t of c.tracks) for (const v of trackVertices(state, t)) vertices.add(v);
  const gains: { playerId: PlayerId; hex: HexId; resource: Resource; count: number }[] = [];
  for (const v of vertices) {
    const b = buildingAt(state, v);
    if (!b) continue;
    for (const hex of geo.vertexHexes[v] ?? []) {
      const tile = state.board.hexes[hex];
      if (!tile || tile.token !== total || state.board.oases.includes(hex) || !hexProduces(state, hex)) continue;
      const resource = TERRAIN_RESOURCE[tile.terrain];
      if (resource === null || state.bank[resource] <= 0) continue;
      state.bank[resource] -= 1;
      getPlayer(state, b.owner).hand[resource] += 1;
      ctx.received[b.owner] = (ctx.received[b.owner] ?? 0) + 1;
      gains.push({ playerId: b.owner, hex, resource, count: 1 });
    }
  }
  if (gains.length > 0) emit(state, { kind: "produced", gains });
}

function applyExtend(state: GameState, action: Extract<Action, { type: "EXTEND_CARAVAN" }>): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const c = caravans(state);
  const index: unknown = action.caravan;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= c.tracks.length) {
    throw new RuleError("INVALID_PAYLOAD", `no caravan ${String(index)}`);
  }
  const track = c.tracks[index] as CaravanTrack;
  if (track.edges.length >= CARAVAN_LENGTH) throw new RuleError("CARAVAN_COMPLETE", `caravan ${index} has reached its end`);
  const edge: unknown = action.edge;
  if (typeof edge !== "string" || !player.roads.includes(edge)) throw new RuleError("INVALID_EDGE", "you need a road on that edge");
  if (!nextEdges(state, track).includes(edge)) throw new RuleError("CARAVAN_NOT_ADJACENT", `edge ${edge} does not continue caravan ${index}`);
  if ((c.spice[player.id] ?? 0) < 1) throw new RuleError("NO_SPICE", "extending a caravan costs 1 spice");
  c.spice[player.id] = (c.spice[player.id] ?? 0) - 1;
  c.spiceBank += 1;
  track.edges.push(edge);
  emit(state, { kind: "caravanExtended", playerId: player.id, caravan: index, edge });
  updateLongestRoad(state); // road weights changed
}

registerModule({
  id: "caravans",
  enabled: (state: GameState) => variantOn(state, "caravans"),

  init(state) {
    if (!state.wayfarers) state.wayfarers = { eventDeck: null, fishing: null, rivers: null, harbormaster: null, raiders: null, caravans: null, wagons: null };
    const spice: Record<PlayerId, number> = {};
    for (const p of state.players) spice[p.id] = 0;
    state.wayfarers.caravans = {
      tracks: state.board.oases.map((oasis) => ({ oasis, edges: [] })),
      spice,
      spiceBank: SPICE_BANK,
    };
  },

  yieldOverride(state, hex) {
    return state.board.oases.includes(hex) ? { resources: 0 } : null;
  },

  afterProduction(state, total, ctx) {
    produceSpice(state, total);
    produceBonus(state, total, ctx);
  },

  extraActions(state, playerId, out) {
    if (state.phase.kind !== "action" || currentPlayerId(state) !== playerId) return;
    const c = caravans(state);
    if ((c.spice[playerId] ?? 0) < 1) return;
    const player = getPlayer(state, playerId);
    c.tracks.forEach((track, caravan) => {
      if (track.edges.length >= CARAVAN_LENGTH) return;
      for (const edge of nextEdges(state, track)) {
        if (player.roads.includes(edge)) out.push({ type: "EXTEND_CARAVAN", playerId, caravan, edge });
      }
    });
  },

  apply(state, action) {
    if (action.type !== "EXTEND_CARAVAN") return false;
    applyExtend(state, action);
    return true;
  },

  edgeWeight(state, _playerId, edge) {
    const c = caravans(state);
    const geo = boardGeometry(state.board);
    const [a, b] = geo.edgeVertices[edge] ?? [];
    for (const track of c.tracks) {
      for (const e of track.edges) {
        if (e === edge) return 2;
        const [x, y] = geo.edgeVertices[e] ?? [];
        if (x === a || x === b || y === a || y === b) return 2;
      }
    }
    return 1;
  },
});
