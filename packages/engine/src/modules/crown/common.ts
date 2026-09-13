/**
 * Crown & Castle (docs/phase11.md): small accessors and costs shared by the
 * section files. Nothing here mutates state.
 */

import { RuleError } from "../../errors";
import { hand } from "../../state";
import type { GameState, Hand, Player, PlayerId } from "../../types";
import type { CrownPlayer, CrownState } from "../types";

/** The module state; the hooks only run when `enabled`, so it is never null in practice. */
export function crownState(state: GameState): CrownState {
  if (!state.crown) throw new RuleError("MODULE_OFF", "Crown & Castle is not on in this game");
  return state.crown;
}

export function crownPlayer(state: GameState, id: PlayerId): CrownPlayer {
  const cp = crownState(state).players[id];
  if (!cp) throw new RuleError("UNKNOWN_PLAYER", `unknown player ${id}`);
  return cp;
}

/** Players in seat order starting from the current player. */
export function seatOrder(state: GameState): Player[] {
  const n = state.players.length;
  const out: Player[] = [];
  for (let step = 0; step < n; step++) out.push(state.players[(state.currentPlayer + step) % n] as Player);
  return out;
}

/** docs/phase11.md §5, §7 */
export const KNIGHT_COST: Hand = hand({ wool: 1, ore: 1 });
export const ACTIVATE_COST: Hand = hand({ grain: 1 });
export const WALL_COST: Hand = hand({ clay: 2 });
