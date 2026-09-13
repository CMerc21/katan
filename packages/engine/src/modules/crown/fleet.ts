/**
 * Crown & Castle §6 (docs/phase11.md): the barbarian fleet. Every fleet
 * face advances it; on the seventh step it attacks, comparing the number
 * of cities with the levels of the active knights.
 */

import { RuleError } from "../../errors";
import type { VertexId } from "../../geometry";
import { requirePrompted } from "../../guards";
import { emit, getPlayer } from "../../state";
import type { Action, ChooseDowngradeAction, GameState, Player, PlayerId } from "../../types";
import { finishPrompt, parkPrompt } from "../prompt";
import { FLEET_STEPS, TRACKS, type ModulePrompt, type Track } from "../types";
import { crownPlayer, crownState, seatOrder } from "./common";
import { metropolisAt } from "./improvements";
import { drawProgress, enforceProgressLimit } from "./progress";

/** §6: fleet strength is the number of cities on the board (metropolises included). */
export function fleetStrength(state: GameState): number {
  return state.players.reduce((n, p) => n + p.cities.length, 0);
}

/** §5: a player's defense is the sum of the levels of their active knights. */
export function defenseOf(state: GameState, playerId: PlayerId): number {
  return crownState(state)
    .knights.filter((k) => k.owner === playerId && k.active)
    .reduce((n, k) => n + k.level, 0);
}

/** §6: cities the barbarians may sack (a metropolis is immune). */
export function downgradeCandidates(state: GameState, player: Player): VertexId[] {
  return player.cities.filter((v) => metropolisAt(state, v) === null);
}

/**
 * §6: a city becomes a settlement again; its wall is lost. The city piece
 * returns to supply and a settlement piece comes out. A player with no
 * settlement piece left still loses the city; their settlement supply then
 * reads -1 until one is upgraded again (conservation holds).
 */
export function downgradeCity(state: GameState, player: Player, vertex: VertexId): void {
  const idx = player.cities.indexOf(vertex);
  if (idx < 0) throw new RuleError("NOT_A_CITY", `no city of yours at ${vertex}`);
  player.cities.splice(idx, 1);
  player.settlements.push(vertex);
  player.pieces.cities += 1;
  player.pieces.settlements -= 1;
  const walls = crownPlayer(state, player.id).walls;
  const w = walls.indexOf(vertex);
  if (w >= 0) walls.splice(w, 1);
  emit(state, { kind: "cityDowngraded", playerId: player.id, vertex });
}

/** The track a player is furthest along (ties: trade, then politics, then science). */
export function bestTrack(state: GameState, playerId: PlayerId): Track {
  const tracks = crownPlayer(state, playerId).tracks;
  let best: Track = "trade";
  for (const t of TRACKS) if (tracks[t] > tracks[best]) best = t;
  return best;
}

/** §6: one step along the track; the seventh triggers the attack. */
export function advanceFleet(state: GameState): void {
  const crown = crownState(state);
  crown.fleet += 1;
  emit(state, { kind: "fleetAdvanced", position: crown.fleet });
  if (crown.fleet >= FLEET_STEPS) attack(state);
}

function attack(state: GameState): void {
  const crown = crownState(state);
  const strength = fleetStrength(state);
  const defenses = new Map<PlayerId, number>();
  for (const p of state.players) defenses.set(p.id, defenseOf(state, p.id));
  const defense = [...defenses.values()].reduce((n, d) => n + d, 0);
  const result = defense >= strength ? "defended" : "raided";
  const order = seatOrder(state);
  let defenders: PlayerId[] = [];
  let losers: PlayerId[] = [];
  if (result === "defended") {
    const max = Math.max(...defenses.values());
    if (max > 0) defenders = order.filter((p) => defenses.get(p.id) === max).map((p) => p.id);
  } else {
    const holders = order.filter((p) => downgradeCandidates(state, p).length > 0);
    if (holders.length > 0) {
      const min = Math.min(...holders.map((p) => defenses.get(p.id) ?? 0));
      losers = holders.filter((p) => defenses.get(p.id) === min).map((p) => p.id);
    }
  }
  emit(state, { kind: "fleetAttacked", strength, defense, result, defenders, losers });

  const pendingChoices: PlayerId[] = [];
  if (result === "defended") {
    if (defenders.length === 1) {
      const id = defenders[0] as PlayerId;
      if (crown.defenderSupply > 0) {
        crown.defenderSupply -= 1;
        crownPlayer(state, id).defenderChips += 1;
        emit(state, { kind: "defenderAwarded", playerId: id, chip: true });
      }
    } else {
      for (const id of defenders) {
        emit(state, { kind: "defenderAwarded", playerId: id, chip: false });
        drawProgress(state, id, bestTrack(state, id));
      }
    }
  } else {
    for (const id of losers) {
      const player = getPlayer(state, id);
      const candidates = downgradeCandidates(state, player);
      if (candidates.length === 1) downgradeCity(state, player, candidates[0] as VertexId);
      else pendingChoices.push(id);
    }
  }

  for (const k of crown.knights) k.active = false;
  emit(state, { kind: "knightsDeactivated" });
  crown.fleet = 0;
  crown.attacks += 1;

  const [first, ...rest] = pendingChoices;
  if (first !== undefined) parkPrompt(state, { kind: "downgradeCity", playerId: first, pending: rest });
  else if (result === "defended") enforceProgressLimit(state);
}

export function applyChooseDowngrade(state: GameState, action: ChooseDowngradeAction): void {
  const prompt = requirePrompted(state, "downgradeCity", action.playerId);
  const player = getPlayer(state, action.playerId);
  if (!player.cities.includes(action.vertex)) throw new RuleError("NOT_A_CITY", `no city of yours at ${action.vertex}`);
  if (!downgradeCandidates(state, player).includes(action.vertex)) throw new RuleError("INVALID_CHOICE", "a metropolis cannot be sacked");
  downgradeCity(state, player, action.vertex);
  const [next, ...rest] = prompt.pending;
  finishPrompt(state, next !== undefined ? { kind: "downgradeCity", playerId: next, pending: rest } : null);
}

export function fleetPromptActions(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void {
  if (prompt.kind !== "downgradeCity" || prompt.playerId !== playerId) return;
  for (const vertex of downgradeCandidates(state, getPlayer(state, playerId))) out.push({ type: "CHOOSE_DOWNGRADE", playerId, vertex });
}
