/**
 * Crown & Castle §3, §7 (docs/phase11.md): the three improvement tracks and
 * the metropolises they award at levels 4 and 5.
 */

import { RuleError } from "../../errors";
import type { VertexId } from "../../geometry";
import { requireCurrent, requirePhase, requirePrompted } from "../../guards";
import { currentPlayerId, emit, getPlayer } from "../../state";
import type { Action, BuildImprovementAction, GameState, PlaceMetropolisAction, Player, PlayerId } from "../../types";
import { finishPrompt, parkPrompt } from "../prompt";
import { MAX_LEVEL, METROPOLIS_LEVEL, TRACKS, TRACK_COMMODITY, isTrack, type ModulePrompt, type Track } from "../types";
import { crownPlayer, crownState } from "./common";

/** §3: level `n` costs `n` of the track's commodity, one less with a crane (never below 1). */
export function improvementCost(state: GameState, playerId: PlayerId, track: Track): number {
  const cp = crownPlayer(state, playerId);
  const next = cp.tracks[track] + 1;
  return cp.crane ? Math.max(1, next - 1) : next;
}

export type ImprovementCheck = "ok" | "NO_CITY" | "TRACK_MAXED" | "INSUFFICIENT_RESOURCES";

export function improvementCheck(state: GameState, player: Player, track: Track): ImprovementCheck {
  const cp = crownPlayer(state, player.id);
  if (player.cities.length === 0) return "NO_CITY";
  if (cp.tracks[track] >= MAX_LEVEL) return "TRACK_MAXED";
  if (cp.commodities[TRACK_COMMODITY[track]] < improvementCost(state, player.id, track)) return "INSUFFICIENT_RESOURCES";
  return "ok";
}

/** §7: the player's cities that could take the metropolis of `track` (no metropolis of another track on them). */
export function metropolisSites(state: GameState, playerId: PlayerId, track: Track): VertexId[] {
  const cp = crownPlayer(state, playerId);
  const player = getPlayer(state, playerId);
  const taken = new Set(TRACKS.filter((t) => t !== track).map((t) => cp.metropolises[t]).filter((v): v is VertexId => v !== null));
  return player.cities.filter((v) => !taken.has(v));
}

/** Does `vertex` carry a metropolis (of any track, any owner)? */
export function metropolisAt(state: GameState, vertex: VertexId): Track | null {
  for (const cp of Object.values(crownState(state).players)) {
    for (const t of TRACKS) if (cp.metropolises[t] === vertex) return t;
  }
  return null;
}

function placeMetropolis(state: GameState, playerId: PlayerId, track: Track, vertex: VertexId, from: PlayerId | null): void {
  const crown = crownState(state);
  if (from !== null) crownPlayer(state, from).metropolises[track] = null;
  crown.metropolis[track] = playerId;
  crownPlayer(state, playerId).metropolises[track] = vertex;
  emit(state, { kind: "metropolisPlaced", playerId, track, vertex, from });
}

/**
 * §7: reaching level 4 with the metropolis unclaimed, or level 5 while a
 * level-4 player holds it, awards it. One eligible city places it at once;
 * several ask the player; none leaves the metropolis where it is.
 */
function maybeAwardMetropolis(state: GameState, playerId: PlayerId, track: Track): void {
  const crown = crownState(state);
  const level = crownPlayer(state, playerId).tracks[track];
  const holder = crown.metropolis[track];
  let from: PlayerId | null = null;
  if (holder === playerId) return;
  if (holder === null) {
    if (level < METROPOLIS_LEVEL) return;
  } else {
    if (level < MAX_LEVEL || crownPlayer(state, holder).tracks[track] >= MAX_LEVEL) return;
    from = holder;
  }
  const sites = metropolisSites(state, playerId, track);
  if (sites.length === 0) return;
  if (sites.length === 1) placeMetropolis(state, playerId, track, sites[0] as VertexId, from);
  else parkPrompt(state, { kind: "placeMetropolis", playerId, track, from });
}

export function applyBuildImprovement(state: GameState, action: BuildImprovementAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const track: unknown = action.track;
  if (!isTrack(track)) throw new RuleError("INVALID_PAYLOAD", "unknown track");
  const check = improvementCheck(state, player, track);
  if (check !== "ok") throw new RuleError(check, `cannot improve ${track}: ${check}`);
  const cp = crownPlayer(state, player.id);
  const cost = improvementCost(state, player.id, track);
  const commodity = TRACK_COMMODITY[track];
  cp.commodities[commodity] -= cost;
  crownState(state).bank[commodity] += cost;
  cp.crane = false;
  cp.tracks[track] += 1;
  emit(state, { kind: "improvementBuilt", playerId: player.id, track, level: cp.tracks[track] });
  maybeAwardMetropolis(state, player.id, track);
}

export function applyPlaceMetropolis(state: GameState, action: PlaceMetropolisAction): void {
  const prompt = requirePrompted(state, "placeMetropolis", action.playerId);
  if (!metropolisSites(state, action.playerId, prompt.track).includes(action.vertex)) throw new RuleError("INVALID_CHOICE", `the metropolis cannot go on ${action.vertex}`);
  placeMetropolis(state, action.playerId, prompt.track, action.vertex, prompt.from);
  finishPrompt(state);
}

export function improvementActions(state: GameState, player: Player, out: Action[]): void {
  if (state.phase.kind !== "action" || currentPlayerId(state) !== player.id) return;
  for (const track of TRACKS) if (improvementCheck(state, player, track) === "ok") out.push({ type: "BUILD_IMPROVEMENT", playerId: player.id, track });
}

export function improvementPromptActions(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void {
  if (prompt.kind !== "placeMetropolis" || prompt.playerId !== playerId) return;
  for (const vertex of metropolisSites(state, playerId, prompt.track)) out.push({ type: "PLACE_METROPOLIS", playerId, vertex });
}
