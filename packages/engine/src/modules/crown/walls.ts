/**
 * Crown & Castle §7 (docs/phase11.md): city walls. 2 clay each, on an own
 * city, at most three per player; each raises the discard threshold by 2.
 */

import { RuleError } from "../../errors";
import type { VertexId } from "../../geometry";
import { pay, requireCurrent, requirePhase } from "../../guards";
import { currentPlayerId, emit, hasResources } from "../../state";
import type { Action, BuildWallAction, GameState, Player } from "../../types";
import { MAX_WALLS } from "../types";
import { WALL_COST, crownPlayer } from "./common";

/** §7: 7, raised by 2 per wall. */
export function discardThreshold(state: GameState, player: Player): number {
  return 7 + 2 * crownPlayer(state, player.id).walls.length;
}

/** Own cities without a wall. */
export function wallSites(state: GameState, player: Player): VertexId[] {
  const walls = crownPlayer(state, player.id).walls;
  return player.cities.filter((v) => !walls.includes(v));
}

export function applyBuildWall(state: GameState, action: BuildWallAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const cp = crownPlayer(state, player.id);
  if (!player.cities.includes(action.vertex)) throw new RuleError("NOT_A_CITY", `no city of yours at ${action.vertex}`);
  if (cp.walls.includes(action.vertex)) throw new RuleError("VERTEX_OCCUPIED", `the city at ${action.vertex} already has a wall`);
  if (cp.walls.length >= MAX_WALLS) throw new RuleError("WALL_LIMIT", `at most ${MAX_WALLS} walls`);
  pay(state, player, WALL_COST);
  cp.walls.push(action.vertex);
  emit(state, { kind: "wallBuilt", playerId: player.id, vertex: action.vertex, free: false });
}

export function wallActions(state: GameState, player: Player, out: Action[]): void {
  if (state.phase.kind !== "action" || currentPlayerId(state) !== player.id) return;
  if (!hasResources(player.hand, WALL_COST) || crownPlayer(state, player.id).walls.length >= MAX_WALLS) return;
  for (const vertex of wallSites(state, player)) out.push({ type: "BUILD_WALL", playerId: player.id, vertex });
}
