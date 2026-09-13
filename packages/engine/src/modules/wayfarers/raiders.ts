/**
 * Wayfarers: raiders (docs/phase10.md §5). A cooperative-defence variant on
 * the coast.
 *
 * - Setup: after the second settlement each player picks one settlement as
 *   their castle (+1 VP, immune to raids; it may still become a city).
 * - Every seven advances the raider counter by the number of cities on the
 *   board. At `RAIDER_LANDING` the raiders land: each coastal land hex whose
 *   strength (1 per settlement, 2 per city on its corners, castles count 0)
 *   exceeds its defence (guards standing on it) is raided; guards on raided
 *   hexes go back to their owners' supply. Raided hexes produce nothing
 *   until rebuilt (1 ore + 1 wool, +1 VP for the rebuilder).
 * - Guards (the variant's knights, `BUILD_KNIGHT { hex }`): 1 ore + 1 wool,
 *   on a land hex the player touches, at most `MAX_GUARDS` per player.
 */

import { boardGeometry } from "../../board";
import { RuleError } from "../../errors";
import type { HexId, VertexId } from "../../geometry";
import { pay, requireBuilder, requireCurrent, requirePhase, requirePrompted } from "../../guards";
import { buildingsOnHex, emit, getPlayer, hand, hasResources, variantOn } from "../../state";
import type { Action, GameState, Hand, Player, PlayerId } from "../../types";
import { registerModule } from "../hooks";
import { finishPrompt, parkPrompt } from "../prompt";
import { MAX_GUARDS, RAIDER_LANDING, type RaidersState } from "../types";

export const GUARD_COST: Hand = hand({ ore: 1, wool: 1 });
export const REBUILD_COST: Hand = hand({ ore: 1, wool: 1 });

/** The variant's state; throws when the variant is off. */
export function raidersState(state: GameState): RaidersState {
  const r = state.wayfarers?.raiders;
  if (!r) throw new RuleError("MODULE_OFF", "the Raiders variant is not on in this game");
  return r;
}

/** Land hexes with at least one neighbour that is not land (sea, frame or missing). */
export function coastalHexes(state: GameState): HexId[] {
  const geo = boardGeometry(state.board);
  return Object.keys(state.board.hexes).filter((h) => (geo.hexNeighbors[h] ?? []).filter((n) => state.board.hexes[n] !== undefined).length < 6);
}

function castleVertices(r: RaidersState): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const v of Object.values(r.castles)) if (v !== null) out.add(v);
  return out;
}

/** Raider strength on a hex: 1 per settlement, 2 per city on its corners; castle corners count nothing. */
export function hexStrength(state: GameState, hex: HexId): number {
  const castles = castleVertices(raidersState(state));
  let n = 0;
  for (const b of buildingsOnHex(state, hex)) {
    if (castles.has(b.vertex)) continue;
    n += b.kind === "city" ? 2 : 1;
  }
  return n;
}

/** Defence of a hex: one per guard standing on it, whoever owns them. */
export function hexDefense(state: GameState, hex: HexId): number {
  let n = 0;
  for (const guards of Object.values(raidersState(state).guards)) for (const h of guards) if (h === hex) n += 1;
  return n;
}

/** Land hexes with a building of the player on one of their corners. */
export function touchedLandHexes(state: GameState, player: Player): HexId[] {
  const geo = boardGeometry(state.board);
  const out = new Set<HexId>();
  for (const v of [...player.settlements, ...player.cities]) {
    for (const h of geo.vertexHexes[v] ?? []) if (state.board.hexes[h] !== undefined) out.add(h);
  }
  return [...out];
}

function guardsOf(r: RaidersState, playerId: PlayerId): HexId[] {
  return (r.guards[playerId] ??= []);
}

function cityCount(state: GameState): number {
  return state.players.reduce((n, p) => n + p.cities.length, 0);
}

/** The raiders land: every coastal hex stronger than its defence is raided and loses its guards. */
function landRaiders(state: GameState, r: RaidersState): void {
  const raided: HexId[] = [];
  const defended: HexId[] = [];
  const guardsLost: { playerId: PlayerId; hex: HexId }[] = [];
  for (const hex of coastalHexes(state)) {
    const strength = hexStrength(state, hex);
    if (strength === 0) continue;
    if (strength <= hexDefense(state, hex)) {
      defended.push(hex);
      continue;
    }
    raided.push(hex);
    if (!r.raided.includes(hex)) r.raided.push(hex);
    for (const p of state.players) {
      const guards = guardsOf(r, p.id);
      const kept = guards.filter((h) => h !== hex);
      for (let i = kept.length; i < guards.length; i++) guardsLost.push({ playerId: p.id, hex });
      r.guards[p.id] = kept;
    }
  }
  emit(state, { kind: "raid", raided, defended, guardsLost });
  r.counter = 0;
  r.landings += 1;
}

function applyBuildCastle(state: GameState, playerId: PlayerId, vertex: unknown): void {
  requirePrompted(state, "placeCastle", playerId);
  const player = getPlayer(state, playerId);
  const r = raidersState(state);
  if (typeof vertex !== "string") throw new RuleError("INVALID_PAYLOAD", "BUILD_CASTLE needs a vertex");
  if (!player.settlements.includes(vertex)) throw new RuleError("NOT_YOUR_SETTLEMENT", `no settlement of yours at ${vertex}`);
  if (r.castles[playerId]) throw new RuleError("ALREADY_HAS_CASTLE", `${playerId} already has a castle`);
  r.castles[playerId] = vertex;
  emit(state, { kind: "castleBuilt", playerId, vertex });
  finishPrompt(state);
}

function applyBuildGuard(state: GameState, playerId: PlayerId, hex: unknown): void {
  requirePhase(state, "action", "specialBuild");
  const player = requireBuilder(state, playerId);
  const r = raidersState(state);
  if (typeof hex !== "string") throw new RuleError("INVALID_PAYLOAD", "BUILD_KNIGHT needs a hex under Raiders");
  if (state.board.hexes[hex] === undefined) throw new RuleError("INVALID_HEX", `${hex} is not a land hex`);
  if (r.raided.includes(hex)) throw new RuleError("INVALID_HEX", `${hex} is raided; rebuild it first`);
  if (!touchedLandHexes(state, player).includes(hex)) throw new RuleError("HEX_NOT_TOUCHED", `you have no building on ${hex}`);
  const guards = guardsOf(r, playerId);
  if (guards.length >= MAX_GUARDS) throw new RuleError("NO_KNIGHTS_LEFT", `all ${MAX_GUARDS} guards are posted`);
  pay(state, player, GUARD_COST);
  guards.push(hex);
  emit(state, { kind: "guardPlaced", playerId, hex });
}

function applyRebuildHex(state: GameState, playerId: PlayerId, hex: unknown): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, playerId);
  const r = raidersState(state);
  if (typeof hex !== "string") throw new RuleError("INVALID_PAYLOAD", "REBUILD_HEX needs a hex");
  const idx = r.raided.indexOf(hex);
  if (idx < 0) throw new RuleError("NOT_RAIDED", `${hex} is not raided`);
  pay(state, player, REBUILD_COST);
  r.raided.splice(idx, 1);
  r.rebuilt[playerId] = (r.rebuilt[playerId] ?? 0) + 1;
  emit(state, { kind: "hexRebuilt", playerId, hex });
}

registerModule({
  id: "raiders",
  enabled: (state: GameState) => variantOn(state, "raiders"),

  init(state) {
    state.wayfarers ??= { eventDeck: null, fishing: null, rivers: null, harbormaster: null, raiders: null, caravans: null, wagons: null };
    const castles: Record<PlayerId, VertexId | null> = {};
    const guards: Record<PlayerId, HexId[]> = {};
    const rebuilt: Record<PlayerId, number> = {};
    for (const p of state.players) {
      castles[p.id] = null;
      guards[p.id] = [];
      rebuilt[p.id] = 0;
    }
    state.wayfarers.raiders = { counter: 0, castles, guards, raided: [], rebuilt, landings: 0 };
  },

  onSetupSettlement(state, player, _vertex, round) {
    if (round !== 2) return;
    parkPrompt(state, { kind: "placeCastle", playerId: player.id });
  },

  onSeven(state) {
    const r = raidersState(state);
    const steps = cityCount(state);
    if (steps === 0) return;
    r.counter += steps;
    emit(state, { kind: "raidersAdvanced", steps, counter: r.counter });
    if (r.counter >= RAIDER_LANDING) landRaiders(state, r);
  },

  hexProduces(state, hex) {
    return !raidersState(state).raided.includes(hex);
  },

  extraActions(state, playerId, out) {
    const phase = state.phase;
    const r = raidersState(state);
    const player = getPlayer(state, playerId);
    const acting = phase.kind === "action" ? state.players[state.currentPlayer]?.id === playerId : phase.kind === "specialBuild" && phase.order[phase.index] === playerId;
    if (!acting) return;
    if (hasResources(player.hand, GUARD_COST) && guardsOf(r, playerId).length < MAX_GUARDS) {
      for (const hex of touchedLandHexes(state, player)) {
        if (!r.raided.includes(hex)) out.push({ type: "BUILD_KNIGHT", playerId, hex });
      }
    }
    if (phase.kind === "action" && hasResources(player.hand, REBUILD_COST)) {
      for (const hex of r.raided) out.push({ type: "REBUILD_HEX", playerId, hex });
    }
  },

  promptActions(state, prompt, playerId, out) {
    if (prompt.kind !== "placeCastle" || prompt.playerId !== playerId) return;
    for (const vertex of getPlayer(state, playerId).settlements) out.push({ type: "BUILD_CASTLE", playerId, vertex });
  },

  apply(state, action: Action) {
    switch (action.type) {
      case "BUILD_CASTLE":
        applyBuildCastle(state, action.playerId, action.vertex);
        return true;
      case "BUILD_KNIGHT":
        applyBuildGuard(state, action.playerId, action.hex);
        return true;
      case "REBUILD_HEX":
        applyRebuildHex(state, action.playerId, action.hex);
        return true;
      default:
        return false;
    }
  },

  victoryPoints(state, player) {
    const r = raidersState(state);
    const castle = r.castles[player.id] ? 1 : 0;
    return { publicVP: castle + (r.rebuilt[player.id] ?? 0), hiddenVP: 0 };
  },
});
