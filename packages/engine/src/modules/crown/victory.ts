/**
 * Crown & Castle §8 (docs/phase11.md): the module's victory point terms —
 * 2 per metropolis, Defender of the Realm chips, revealed VP progress
 * cards and the merchant. All public; the module has no hidden points.
 */

import type { GameState, Player } from "../../types";
import { TRACKS } from "../types";
import { crownPlayer, crownState } from "./common";

export function victoryPoints(state: GameState, player: Player): { publicVP: number; hiddenVP: number } {
  const crown = crownState(state);
  const cp = crownPlayer(state, player.id);
  let publicVP = 0;
  for (const t of TRACKS) if (cp.metropolises[t] !== null) publicVP += 2;
  publicVP += cp.defenderChips;
  publicVP += cp.progress.filter((c) => c.revealed).length;
  if (crown.merchant?.playerId === player.id) publicVP += 1;
  return { publicVP, hiddenVP: 0 };
}
