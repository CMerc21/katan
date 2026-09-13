/**
 * Crown & Castle §5 (docs/phase11.md): knights as board pieces. Build,
 * activate, promote, move, displace (with the victim's retreat), chase the
 * robber; blocking of settlements and opposing roads through the
 * `blockedVertices` / `unbuildableVertices` hooks.
 */

import { boardGeometry } from "../../board";
import { RuleError } from "../../errors";
import { isBoardVertex, type VertexId } from "../../geometry";
import { pay, requireCurrent, requirePhase, requirePrompted } from "../../guards";
import { buildingAt, buildingsMap, currentPlayerId, emit, getPlayer, hasResources } from "../../state";
import { updateLongestRoad } from "../../specialCards";
import type { Action, ActivateKnightAction, BuildKnightAction, GameState, KnightChaseRobberAction, KnightDisplaceAction, KnightMoveAction, Player, PlayerId, PromoteKnightAction, RetreatKnightAction } from "../../types";
import { finishPrompt, parkPrompt } from "../prompt";
import { KNIGHTS_PER_LEVEL, type Knight, type KnightLevel, type ModulePrompt } from "../types";
import { ACTIVATE_COST, KNIGHT_COST, crownPlayer, crownState } from "./common";

// ---------------------------------------------------------------------------
// Queries

export function knightAt(state: GameState, vertex: VertexId): Knight | null {
  return crownState(state).knights.find((k) => k.at === vertex) ?? null;
}

export function knightsOf(state: GameState, playerId: PlayerId): Knight[] {
  return crownState(state).knights.filter((k) => k.owner === playerId);
}

/** §5: two pieces of each level per player. */
export function knightsInSupply(state: GameState, playerId: PlayerId, level: KnightLevel): number {
  return KNIGHTS_PER_LEVEL - knightsOf(state, playerId).filter((k) => k.level === level).length;
}

/** Vertices touched by the player's roads or ships. */
export function ownRoadVertices(state: GameState, playerId: PlayerId): Set<VertexId> {
  const geo = boardGeometry(state.board);
  const player = getPlayer(state, playerId);
  const out = new Set<VertexId>();
  for (const e of [...player.roads, ...player.ships]) for (const v of geo.edgeVertices[e] ?? []) out.add(v);
  return out;
}

/**
 * Vertices reachable from `from` along the player's own roads and ships
 * without passing through an opposing building or an opposing knight (a
 * trail may still end on one). `from` itself is not included.
 */
export function reachableVertices(state: GameState, playerId: PlayerId, from: VertexId): Set<VertexId> {
  const geo = boardGeometry(state.board);
  const player = getPlayer(state, playerId);
  const mine = new Set([...player.roads, ...player.ships]);
  const buildings = buildingsMap(state);
  const opposingKnights = new Set(crownState(state).knights.filter((k) => k.owner !== playerId).map((k) => k.at));
  const seen = new Set<VertexId>([from]);
  const queue: VertexId[] = [from];
  while (queue.length > 0) {
    const v = queue.pop() as VertexId;
    if (v !== from) {
      const b = buildings.get(v);
      if ((b && b.owner !== playerId) || opposingKnights.has(v)) continue;
    }
    for (const e of geo.vertexEdges[v] ?? []) {
      if (!mine.has(e)) continue;
      const [a, b] = geo.edgeVertices[e] as readonly [VertexId, VertexId];
      const next = a === v ? b : a;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  seen.delete(from);
  return seen;
}

/** A vertex with neither a building nor a knight. */
export function vertexFree(state: GameState, vertex: VertexId): boolean {
  return buildingAt(state, vertex) === null && knightAt(state, vertex) === null;
}

/** Where a knight of `playerId` could go from `from`: free vertices on their network reachable from there. */
export function knightDestinations(state: GameState, playerId: PlayerId, from: VertexId): VertexId[] {
  const touched = ownRoadVertices(state, playerId);
  return [...reachableVertices(state, playerId, from)].filter((v) => touched.has(v) && vertexFree(state, v)).sort();
}

/** Where a new knight may be placed: free vertices on the player's network. */
export function knightPlacements(state: GameState, playerId: PlayerId): VertexId[] {
  return [...ownRoadVertices(state, playerId)].filter((v) => vertexFree(state, v)).sort();
}

/** Opposing knights of strictly lower level the knight at `from` could drive off. */
export function displaceTargets(state: GameState, playerId: PlayerId, from: VertexId): VertexId[] {
  const mover = knightAt(state, from);
  if (!mover) return [];
  const touched = ownRoadVertices(state, playerId);
  return [...reachableVertices(state, playerId, from)]
    .filter((v) => {
      const k = knightAt(state, v);
      return touched.has(v) && k !== null && k.owner !== playerId && k.level < mover.level && buildingAt(state, v) === null;
    })
    .sort();
}

/** May this knight act this turn (active and not yet used)? */
export function knightCanAct(knight: Knight): boolean {
  return knight.active && !knight.actedThisTurn;
}

// ---------------------------------------------------------------------------
// Mutations shared with the progress cards

export function placeKnight(state: GameState, owner: PlayerId, at: VertexId, level: KnightLevel, active: boolean): Knight {
  const knight: Knight = { owner, at, level, active, actedThisTurn: true, builtOnTurn: state.turn };
  crownState(state).knights.push(knight);
  return knight;
}

export function removeKnight(state: GameState, vertex: VertexId): Knight {
  const knights = crownState(state).knights;
  const idx = knights.findIndex((k) => k.at === vertex);
  if (idx < 0) throw new RuleError("NO_KNIGHT", `no knight at ${vertex}`);
  return knights.splice(idx, 1)[0] as Knight;
}

/** Raise a knight one level (the caller checks politics and supply). */
export function promoteKnight(knight: Knight): void {
  if (knight.level >= 3) throw new RuleError("KNIGHT_MAX_LEVEL", "a mighty knight cannot be promoted");
  knight.level = (knight.level + 1) as KnightLevel;
}

/** The player's own knight at `vertex`. */
export function requireOwnKnight(state: GameState, playerId: PlayerId, vertex: VertexId): Knight {
  const knight = knightAt(state, vertex);
  if (!knight) throw new RuleError("NO_KNIGHT", `no knight at ${vertex}`);
  if (knight.owner !== playerId) throw new RuleError("NOT_YOUR_KNIGHT", `the knight at ${vertex} is not yours`);
  return knight;
}

function requireReadyKnight(state: GameState, playerId: PlayerId, vertex: VertexId): Knight {
  const knight = requireOwnKnight(state, playerId, vertex);
  if (!knight.active) throw new RuleError("KNIGHT_INACTIVE", "an inactive knight cannot act");
  if (knight.actedThisTurn) throw new RuleError("KNIGHT_ACTED", "that knight has already acted this turn");
  return knight;
}

// ---------------------------------------------------------------------------
// Actions

export function applyBuildKnight(state: GameState, action: BuildKnightAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const vertex = action.vertex;
  if (vertex === undefined || action.hex !== undefined) throw new RuleError("INVALID_PAYLOAD", "a knight is placed at a vertex");
  if (!isBoardVertex(vertex, boardGeometry(state.board))) throw new RuleError("INVALID_VERTEX", `no such vertex ${vertex}`);
  if (buildingAt(state, vertex) !== null) throw new RuleError("VERTEX_OCCUPIED", `vertex ${vertex} holds a building`);
  if (knightAt(state, vertex) !== null) throw new RuleError("VERTEX_HAS_KNIGHT", `a knight already stands at ${vertex}`);
  if (!ownRoadVertices(state, player.id).has(vertex)) throw new RuleError("KNIGHT_NOT_CONNECTED", "a knight must stand on one of your roads");
  if (knightsInSupply(state, player.id, 1) <= 0) throw new RuleError("NO_KNIGHTS_LEFT", "no basic knight pieces left");
  pay(state, player, KNIGHT_COST);
  placeKnight(state, player.id, vertex, 1, false);
  emit(state, { kind: "knightBuilt", playerId: player.id, vertex });
}

export function applyActivateKnight(state: GameState, action: ActivateKnightAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const knight = requireOwnKnight(state, player.id, action.vertex);
  if (knight.active) throw new RuleError("KNIGHT_ALREADY_ACTIVE", "that knight is already active");
  pay(state, player, ACTIVATE_COST);
  knight.active = true;
  knight.actedThisTurn = true; // an activated knight may not act until the next turn
  emit(state, { kind: "knightActivated", playerId: player.id, vertex: knight.at, free: false });
}

export function applyPromoteKnight(state: GameState, action: PromoteKnightAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const knight = requireOwnKnight(state, player.id, action.vertex);
  if (knight.level >= 3) throw new RuleError("KNIGHT_MAX_LEVEL", "a mighty knight cannot be promoted");
  const next = (knight.level + 1) as KnightLevel;
  if (next === 3 && crownPlayer(state, player.id).tracks.politics < 3) throw new RuleError("NEEDS_POLITICS", "mighty knights need politics level 3");
  if (knightsInSupply(state, player.id, next) <= 0) throw new RuleError("NO_KNIGHTS_LEFT", `no level ${next} knight pieces left`);
  pay(state, player, KNIGHT_COST);
  promoteKnight(knight);
  emit(state, { kind: "knightPromoted", playerId: player.id, vertex: knight.at, level: knight.level });
}

export function applyKnightMove(state: GameState, action: KnightMoveAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const knight = requireReadyKnight(state, player.id, action.from);
  const to = action.to;
  if (to === action.from || !isBoardVertex(to, boardGeometry(state.board))) throw new RuleError("INVALID_VERTEX", `cannot move to ${to}`);
  if (buildingAt(state, to) !== null) throw new RuleError("VERTEX_OCCUPIED", `vertex ${to} holds a building`);
  if (knightAt(state, to) !== null) throw new RuleError("VERTEX_HAS_KNIGHT", `a knight already stands at ${to}`);
  if (!knightDestinations(state, player.id, action.from).includes(to)) throw new RuleError("KNIGHT_NOT_CONNECTED", `${to} is not reachable along your roads`);
  knight.at = to;
  knight.active = false;
  knight.actedThisTurn = true;
  emit(state, { kind: "knightMoved", playerId: player.id, from: action.from, to });
  updateLongestRoad(state);
}

export function applyKnightDisplace(state: GameState, action: KnightDisplaceAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const knight = requireReadyKnight(state, player.id, action.from);
  const to = action.to;
  if (to === action.from || !isBoardVertex(to, boardGeometry(state.board))) throw new RuleError("INVALID_VERTEX", `cannot move to ${to}`);
  const victim = knightAt(state, to);
  if (!victim) throw new RuleError("NO_KNIGHT", `no knight to displace at ${to}`);
  if (victim.owner === player.id) throw new RuleError("VERTEX_HAS_KNIGHT", "you cannot displace your own knight");
  if (victim.level >= knight.level) throw new RuleError("NOT_STRONGER", "only a stronger knight can drive another off");
  if (!displaceTargets(state, player.id, action.from).includes(to)) throw new RuleError("KNIGHT_NOT_CONNECTED", `${to} is not reachable along your roads`);
  removeKnight(state, to);
  knight.at = to;
  knight.active = false;
  knight.actedThisTurn = true;
  emit(state, { kind: "knightDisplaced", playerId: player.id, from: action.from, to, victim: victim.owner });
  const options = knightDestinations(state, victim.owner, to);
  if (options.length === 0) {
    emit(state, { kind: "knightRemoved", playerId: victim.owner, vertex: to, reason: "noRetreat" });
  } else {
    parkPrompt(state, { kind: "knightRetreat", playerId: victim.owner, level: victim.level, active: victim.active, from: to, pending: [] });
  }
  updateLongestRoad(state);
}

export function applyRetreatKnight(state: GameState, action: RetreatKnightAction): void {
  const prompt = requirePrompted(state, "knightRetreat", action.playerId);
  const vertex = action.vertex;
  if (vertex === null) {
    emit(state, { kind: "knightRemoved", playerId: action.playerId, vertex: prompt.from, reason: "noRetreat" });
  } else {
    if (!knightDestinations(state, action.playerId, prompt.from).includes(vertex)) throw new RuleError("INVALID_CHOICE", `your knight cannot retreat to ${vertex}`);
    const knight = placeKnight(state, action.playerId, vertex, prompt.level, prompt.active);
    knight.actedThisTurn = false;
    emit(state, { kind: "knightRetreated", playerId: action.playerId, from: prompt.from, to: vertex });
  }
  finishPrompt(state);
  updateLongestRoad(state);
}

export function applyKnightChaseRobber(state: GameState, action: KnightChaseRobberAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const knight = requireReadyKnight(state, player.id, action.vertex);
  if (crownState(state).attacks === 0) throw new RuleError("ROBBER_LOCKED", "the robber cannot be moved before the first attack");
  const hexes = boardGeometry(state.board).vertexHexes[action.vertex] ?? [];
  if (!hexes.includes(state.robberHex)) throw new RuleError("NOT_ADJACENT", "the robber is not next to that knight");
  knight.active = false;
  knight.actedThisTurn = true;
  emit(state, { kind: "robberChased", playerId: player.id, vertex: action.vertex });
  state.phase = { kind: "moveRobber", via: "knight", returnTo: "action" };
}

// ---------------------------------------------------------------------------
// Hooks

export function blockedVertices(state: GameState, playerId: PlayerId): Set<VertexId> {
  return new Set(crownState(state).knights.filter((k) => k.owner !== playerId).map((k) => k.at));
}

export function unbuildableVertices(state: GameState): Set<VertexId> {
  return new Set(crownState(state).knights.map((k) => k.at));
}

export function clearKnightTurnFlags(state: GameState): void {
  for (const k of crownState(state).knights) k.actedThisTurn = false;
}

export function knightActions(state: GameState, player: Player, out: Action[]): void {
  if (state.phase.kind !== "action" || currentPlayerId(state) !== player.id) return;
  const playerId = player.id;
  const h = player.hand;
  if (hasResources(h, KNIGHT_COST) && knightsInSupply(state, playerId, 1) > 0) {
    for (const vertex of knightPlacements(state, playerId)) out.push({ type: "BUILD_KNIGHT", playerId, vertex });
  }
  const politics = crownPlayer(state, playerId).tracks.politics;
  const attacks = crownState(state).attacks;
  const geo = boardGeometry(state.board);
  for (const knight of knightsOf(state, playerId)) {
    if (!knight.active && hasResources(h, ACTIVATE_COST)) out.push({ type: "ACTIVATE_KNIGHT", playerId, vertex: knight.at });
    if (knight.level < 3 && hasResources(h, KNIGHT_COST)) {
      const next = (knight.level + 1) as KnightLevel;
      if ((next < 3 || politics >= 3) && knightsInSupply(state, playerId, next) > 0) out.push({ type: "PROMOTE_KNIGHT", playerId, vertex: knight.at });
    }
    if (!knightCanAct(knight)) continue;
    for (const to of knightDestinations(state, playerId, knight.at)) out.push({ type: "KNIGHT_MOVE", playerId, from: knight.at, to });
    for (const to of displaceTargets(state, playerId, knight.at)) out.push({ type: "KNIGHT_DISPLACE", playerId, from: knight.at, to });
    if (attacks > 0 && (geo.vertexHexes[knight.at] ?? []).includes(state.robberHex)) out.push({ type: "KNIGHT_CHASE_ROBBER", playerId, vertex: knight.at });
  }
}

export function knightPromptActions(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void {
  if (prompt.kind !== "knightRetreat" || prompt.playerId !== playerId) return;
  for (const vertex of knightDestinations(state, playerId, prompt.from)) out.push({ type: "RETREAT_KNIGHT", playerId, vertex });
  out.push({ type: "RETREAT_KNIGHT", playerId, vertex: null });
}
