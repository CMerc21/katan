/**
 * Wayfarers: the Harbormaster (docs/phase10.md §4).
 *
 * Harbour points: 1 per settlement and 2 per city on a harbour vertex. The
 * first player to 3 takes the chip (+2 VP); it moves only to a player who
 * strictly exceeds the holder, exactly like Longest Road.
 */

import type { VertexId } from "../../geometry";
import { emit, variantOn } from "../../state";
import type { GameState, Player, PlayerId } from "../../types";
import { registerModule } from "../hooks";
import type { HarbormasterState } from "../types";

export const HARBORMASTER_MIN = 3;
export const HARBORMASTER_VP = 2;

function chipOf(state: GameState): HarbormasterState {
  const chip = state.wayfarers?.harbormaster;
  if (!chip) throw new Error("harbormaster state missing");
  return chip;
}

/** 1 per settlement and 2 per city on a harbour vertex. */
export function harborPoints(state: GameState, player: Player): number {
  const harbour = new Set<VertexId>();
  for (const port of state.board.ports) for (const v of port.vertices) harbour.add(v);
  let points = 0;
  for (const v of player.settlements) if (harbour.has(v)) points += 1;
  for (const v of player.cities) if (harbour.has(v)) points += 2;
  return points;
}

/**
 * Who holds the chip after a change (the Longest Road rule with `min`):
 * nobody, or the holder below `min` → the unique leader at `min` or more;
 * otherwise the holder keeps it unless a unique challenger strictly exceeds.
 */
function chipHolder(counts: ReadonlyMap<PlayerId, number>, holder: PlayerId | null, min: number): PlayerId | null {
  const holderCount = holder === null ? 0 : (counts.get(holder) ?? 0);
  const uniqueMaxAtLeast = (floor: number): PlayerId | null => {
    let best = floor - 1;
    let who: PlayerId | null = null;
    let tied = false;
    for (const [id, n] of counts) {
      if (n > best) {
        best = n;
        who = id;
        tied = false;
      } else if (n === best && n >= floor) {
        tied = true;
      }
    }
    return tied ? null : who;
  };
  if (holder === null || holderCount < min) return uniqueMaxAtLeast(min);
  const anyoneExceeds = [...counts.values()].some((n) => n > holderCount);
  return anyoneExceeds ? uniqueMaxAtLeast(holderCount + 1) : holder;
}

/** Re-evaluate the chip after a settlement or city was placed. */
export function updateHarbormaster(state: GameState): void {
  const chip = chipOf(state);
  const points = new Map<PlayerId, number>();
  for (const p of state.players) points.set(p.id, harborPoints(state, p));
  const holder = chip.playerId;
  const next = chipHolder(points, holder, HARBORMASTER_MIN);
  chip.playerId = next;
  chip.points = next === null ? 0 : (points.get(next) ?? 0);
  if (next !== holder) emit(state, { kind: "chipMoved", chip: "harbormaster", from: holder, to: next });
}

registerModule({
  id: "harbormaster",
  enabled: (state: GameState) => variantOn(state, "harbormaster"),

  init(state) {
    if (!state.wayfarers) state.wayfarers = { eventDeck: null, fishing: null, rivers: null, harbormaster: null, caravans: null, raiders: null, wagons: null };
    state.wayfarers.harbormaster = { playerId: null, points: 0 };
  },

  onBuilt(state, _playerId, piece) {
    if (piece === "settlement" || piece === "city") updateHarbormaster(state);
  },

  victoryPoints(state, player) {
    return { publicVP: chipOf(state).playerId === player.id ? HARBORMASTER_VP : 0, hiddenVP: 0 };
  },
});
