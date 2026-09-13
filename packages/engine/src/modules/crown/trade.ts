/**
 * Crown & Castle §1, §3, §4 (docs/phase11.md): maritime trades involving a
 * commodity (4:1, or 2:1 with trade level 3 / Merchant Fleet), and the 2:1
 * resource trades granted by the Merchant Fleet card and the merchant token.
 */

import { RESOURCES, TERRAIN_RESOURCE, boardGeometry, type Resource } from "../../board";
import { RuleError } from "../../errors";
import type { HexId } from "../../geometry";
import { buildingAt, currentPlayerId, ratioAllowed } from "../../state";
import type { Action, GameState, Player } from "../../types";
import { COMMODITIES, isCommodity, type Commodity } from "../types";
import { crownPlayer, crownState } from "./common";

/** §3: trade level 3 (or a Merchant Fleet naming the card) lets commodities go 2:1. */
export function commodityRatio(state: GameState, player: Player, give: Commodity): 4 | 2 {
  const cp = crownPlayer(state, player.id);
  return cp.tracks.trade >= 3 || cp.merchantFleet === give ? 2 : 4;
}

/** §4: the merchant token grants its owner 2:1 for the resource of the hex it stands on, while the owner still touches that hex. */
export function merchantGrants(state: GameState, player: Player, resource: Resource): boolean {
  const merchant = crownState(state).merchant;
  if (!merchant || merchant.playerId !== player.id) return false;
  const tile = state.board.hexes[merchant.hex];
  if (!tile || TERRAIN_RESOURCE[tile.terrain] !== resource) return false;
  return touchesHex(state, player, merchant.hex);
}

function touchesHex(state: GameState, player: Player, hex: HexId): boolean {
  return (boardGeometry(state.board).hexVertices[hex] ?? []).some((v) => buildingAt(state, v)?.owner === player.id);
}

/** May `player` give `giveCount` of a resource for one card under the module's 2:1 rules (Merchant Fleet, the merchant)? */
export function resourceTwoForOne(state: GameState, player: Player, give: Resource): boolean {
  return crownPlayer(state, player.id).merchantFleet === give || merchantGrants(state, player, give);
}

function takeOne(state: GameState, player: Player, receive: Resource | Commodity): void {
  if (isCommodity(receive)) {
    const bank = crownState(state).bank;
    if (bank[receive] < 1) throw new RuleError("BANK_EMPTY", `bank has no ${receive}`);
    bank[receive] -= 1;
    crownPlayer(state, player.id).commodities[receive] += 1;
    return;
  }
  if (state.bank[receive] < 1) throw new RuleError("BANK_EMPTY", `bank has no ${receive}`);
  state.bank[receive] -= 1;
  player.hand[receive] += 1;
}

/**
 * The `maritime` hook: handle any trade where a commodity is given or
 * received, and resource-for-resource trades at 2:1 granted by the module.
 * Returns false for everything else (the base rule runs).
 */
export function maritime(state: GameState, player: Player, give: string, giveCount: number, receive: string): boolean {
  const cp = crownPlayer(state, player.id);
  if (isCommodity(give)) {
    if (!isCommodity(receive) && !RESOURCES.includes(receive as Resource)) throw new RuleError("INVALID_TRADE", `unknown card ${receive}`);
    const best = commodityRatio(state, player, give);
    if (giveCount !== 4 && giveCount !== best) throw new RuleError("BAD_TRADE_RATIO", `you may not trade ${give} at ${giveCount}:1`);
    if (cp.commodities[give] < giveCount) throw new RuleError("INSUFFICIENT_RESOURCES", `need ${giveCount} ${give}`);
    takeOne(state, player, receive as Resource | Commodity);
    cp.commodities[give] -= giveCount;
    crownState(state).bank[give] += giveCount;
    return true;
  }
  if (!RESOURCES.includes(give as Resource)) return false;
  const g = give as Resource;
  const twoForOne = giveCount === 2 && resourceTwoForOne(state, player, g);
  if (isCommodity(receive)) {
    if (!ratioAllowed(state, player, g, giveCount) && !twoForOne) throw new RuleError("BAD_TRADE_RATIO", `you may not trade ${give} at ${giveCount}:1`);
    if (player.hand[g] < giveCount) throw new RuleError("INSUFFICIENT_RESOURCES", `need ${giveCount} ${give}`);
    takeOne(state, player, receive);
    player.hand[g] -= giveCount;
    state.bank[g] += giveCount;
    return true;
  }
  if (!RESOURCES.includes(receive as Resource) || !twoForOne) return false;
  const r = receive as Resource;
  if (player.hand[g] < giveCount) throw new RuleError("INSUFFICIENT_RESOURCES", `need ${giveCount} ${give}`);
  takeOne(state, player, r);
  player.hand[g] -= giveCount;
  state.bank[g] += giveCount;
  return true;
}

/** Legal MARITIME_TRADE instances the base rule does not already list (action phase, current player). */
export function maritimeActions(state: GameState, playerId: string, out: Action[]): void {
  if (state.phase.kind !== "action" || currentPlayerId(state) !== playerId) return;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  const crown = crownState(state);
  const cp = crown.players[playerId];
  if (!cp) return;
  const receivable: (Resource | Commodity)[] = [...RESOURCES.filter((r) => state.bank[r] >= 1), ...COMMODITIES.filter((c) => crown.bank[c] >= 1)];
  for (const give of COMMODITIES) {
    const best = commodityRatio(state, player, give);
    for (const giveCount of best === 2 ? ([4, 2] as const) : ([4] as const)) {
      if (cp.commodities[give] < giveCount) continue;
      for (const receive of receivable) if (receive !== give) out.push({ type: "MARITIME_TRADE", playerId, give, giveCount, receive });
    }
  }
  for (const give of RESOURCES) {
    for (const giveCount of [4, 3, 2] as const) {
      if (player.hand[give] < giveCount) continue;
      const base = ratioAllowed(state, player, give, giveCount);
      const module = giveCount === 2 && resourceTwoForOne(state, player, give);
      if (!base && !module) continue;
      for (const receive of COMMODITIES) if (crown.bank[receive] >= 1) out.push({ type: "MARITIME_TRADE", playerId, give, giveCount, receive });
      if (module && !base) {
        for (const receive of RESOURCES) if (receive !== give && state.bank[receive] >= 1) out.push({ type: "MARITIME_TRADE", playerId, give, giveCount, receive });
      }
    }
  }
}
