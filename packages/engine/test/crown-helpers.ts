/**
 * Shared fixtures for the Crown & Castle tests (docs/phase11.md). Games are
 * built on the fixed beginner board unless a test passes another
 * definition, so terrain and tokens are known (see crown-production.test.ts).
 */

import type { BoardDefinition } from "../src/definition";
import { beginnerDefinition, standardFrame } from "../src/frames";
import { createGame } from "../src/game";
import type { VertexId } from "../src/geometry";
import { rng } from "../src/rng";
import type { Scenario } from "../src/scenario";
import type { GameState, PlayerId } from "../src/types";
import type { CommodityHand, CrownState, EventDie, KnightLevel, Track } from "../src/modules/types";
import { COMMODITIES } from "../src/modules/types";
import { FOUR, mut } from "./helpers";

export function crownScenario(board: BoardDefinition = beginnerDefinition(), victoryPoints = 13): Scenario {
  return { id: "crown", name: "Crown & Castle", board, modules: { crown: true }, victoryPoints };
}

export const CROWN_RANDOM: Scenario = crownScenario(standardFrame());

export function crownGame(seed = "crown", board: BoardDefinition = beginnerDefinition()): GameState {
  return createGame({ seed, players: FOUR, scenario: crownScenario(board) });
}

export function crownOf(state: GameState): CrownState {
  if (!state.crown) throw new Error("crown is off");
  return state.crown;
}

/** Give commodities from the commodity bank (test setup only). */
export function giveCommodities(state: GameState, playerId: PlayerId, cards: Partial<CommodityHand>): GameState {
  return mut(state, (s) => {
    const crown = crownOf(s);
    const cp = crown.players[playerId]!;
    for (const c of COMMODITIES) {
      const n = cards[c] ?? 0;
      cp.commodities[c] += n;
      crown.bank[c] -= n;
    }
  });
}

export function setTrack(state: GameState, playerId: PlayerId, track: Track, level: number): GameState {
  return mut(state, (s) => void (crownOf(s).players[playerId]!.tracks[track] = level));
}

export function addKnight(state: GameState, owner: PlayerId, at: VertexId, level: KnightLevel = 1, active = false, actedThisTurn = false): GameState {
  return mut(state, (s) => void crownOf(s).knights.push({ owner, at, level, active, actedThisTurn, builtOnTurn: 0 }));
}

/** §2: the event die face for a draw of 0–5. */
export function eventFace(face: number): EventDie {
  return face <= 2 ? "fleet" : face === 3 ? "trade" : face === 4 ? "politics" : "science";
}

/** Set `actionIndex` so the next ROLL yields `total` on the number dice and `event` on the event die. */
export function withNextCrownRoll(state: GameState, total: number, event: EventDie): GameState {
  for (let i = 0; i < 200_000; i++) {
    const draw = rng(state.seed, i);
    const sum = draw.int(6) + 1 + draw.int(6) + 1;
    if (sum !== total) continue;
    if (eventFace(draw.int(6)) === event) return mut(state, (s) => void (s.actionIndex = i));
  }
  throw new Error(`no action index rolls ${total} with ${event}`);
}

/** Force exact number dice through the alchemist and search the stream for `event`. */
export function withForcedRoll(state: GameState, dice: [number, number], event: EventDie): GameState {
  for (let i = 0; i < 200_000; i++) {
    const draw = rng(state.seed, i);
    draw.int(6);
    draw.int(6);
    if (eventFace(draw.int(6)) !== event) continue;
    return mut(state, (s) => {
      s.actionIndex = i;
      crownOf(s).alchemist = dice;
    });
  }
  throw new Error(`no action index gives ${event}`);
}

export const A = "a";
export const B = "b";
export const C = "c";
export const D = "d";
