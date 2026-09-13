/**
 * Crown & Castle §1 (docs/phase11.md): commodities. City yields on meadow,
 * mountain and forest become 1 resource + 1 commodity; commodities are part
 * of the hand for discards and steals; the science level-3 aid (§3) rides
 * on the same production pass.
 */

import { boardGeometry, type Terrain } from "../../board";
import { RuleError } from "../../errors";
import type { HexId } from "../../geometry";
import { activeModules, type ProduceContext } from "../hooks";
import { buildingAt, emit, handSize } from "../../state";
import type { Action, DiscardAction, GameState, Player, PlayerId } from "../../types";
import { COMMODITIES, commodityTotal, type Commodity, type CommodityHand } from "../types";
import { crownPlayer, crownState, seatOrder } from "./common";
import { representativeDiscard } from "../../legal";

const COMMODITY_TERRAIN: Readonly<Partial<Record<Terrain, Commodity>>> = { meadow: "cloth", mountain: "coin", forest: "paper" };

/** §1: the commodity a city on this terrain yields, or null (fields, hills, gold...). */
export function commodityOf(terrain: Terrain): Commodity | null {
  return COMMODITY_TERRAIN[terrain] ?? null;
}

/** §1: a city on a commodity terrain yields one resource (plus the commodity paid in `afterProduction`). */
export function yieldOverride(state: GameState, hex: HexId, owner: PlayerId, building: "settlement" | "city"): { resources: number } | null {
  void owner;
  if (building !== "city") return null;
  const tile = state.board.hexes[hex];
  if (!tile || commodityOf(tile.terrain) === null) return null;
  return { resources: 1 };
}

/**
 * §1: one commodity per city adjacent to a producing hex, paid from the
 * commodity bank in seat order from the current player until it runs out.
 * §3: a player at science 3+ who received nothing at all takes a resource
 * of their choice (through the core's gold phase).
 */
export function afterProduction(state: GameState, total: number, ctx: ProduceContext): void {
  const crown = crownState(state);
  const geo = boardGeometry(state.board);
  const hooks = activeModules(state);
  const wants: { playerId: PlayerId; hex: HexId; commodity: Commodity }[] = [];
  for (const hex of Object.keys(state.board.hexes)) {
    const tile = state.board.hexes[hex];
    if (!tile || tile.token !== total || hex === state.robberHex) continue;
    if (hooks.some((h) => h.hexProduces?.(state, hex) === false)) continue;
    const commodity = commodityOf(tile.terrain);
    if (commodity === null) continue;
    for (const v of geo.hexVertices[hex] ?? []) {
      const b = buildingAt(state, v);
      if (b && b.kind === "city") wants.push({ playerId: b.owner, hex, commodity });
    }
  }
  const gains: { playerId: PlayerId; hex: HexId; commodity: Commodity; count: number }[] = [];
  const got: Record<PlayerId, number> = {};
  for (const p of seatOrder(state)) {
    const cp = crownPlayer(state, p.id);
    for (const w of wants) {
      if (w.playerId !== p.id || crown.bank[w.commodity] <= 0) continue;
      crown.bank[w.commodity] -= 1;
      cp.commodities[w.commodity] += 1;
      got[p.id] = (got[p.id] ?? 0) + 1;
      const same = gains.find((g) => g.playerId === p.id && g.hex === w.hex && g.commodity === w.commodity);
      if (same) same.count += 1;
      else gains.push({ ...w, count: 1 });
    }
  }
  if (gains.length > 0) emit(state, { kind: "commoditiesProduced", gains });

  for (const p of state.players) {
    const cp = crownPlayer(state, p.id);
    if (cp.tracks.science < 3) continue;
    if ((ctx.received[p.id] ?? 0) > 0 || (got[p.id] ?? 0) > 0 || (ctx.gold[p.id] ?? 0) > 0) continue;
    ctx.gold[p.id] = 1;
  }
}

// ---------------------------------------------------------------------------
// Commodities as cards in hand (§1): discards and steals.

export function isCommodityHand(value: unknown): value is CommodityHand {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!(COMMODITIES as readonly string[]).includes(key)) return false;
  return COMMODITIES.every((c) => {
    const v = obj[c];
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
  });
}

export function cardCount(state: GameState, player: Player): number {
  return commodityTotal(crownPlayer(state, player.id).commodities);
}

/** The i-th commodity in cloth, coin, paper order moves from victim to thief. */
export function stealExtra(state: GameState, thief: Player, victim: Player, i: number): Commodity | null {
  const from = crownPlayer(state, victim.id).commodities;
  const to = crownPlayer(state, thief.id).commodities;
  let offset = i;
  for (const c of COMMODITIES) {
    if (offset < from[c]) {
      from[c] -= 1;
      to[c] += 1;
      return c;
    }
    offset -= from[c];
  }
  return null;
}

/** Validate (and on `commit` move to the bank) the commodity part of a DISCARD; returns how many cards it holds. */
export function discardExtra(state: GameState, player: Player, extra: unknown, commit: boolean): number {
  if (!isCommodityHand(extra)) throw new RuleError("INVALID_TRADE", "commodities is not a valid commodity hand");
  const cp = crownPlayer(state, player.id);
  for (const c of COMMODITIES) if (cp.commodities[c] < extra[c]) throw new RuleError("INSUFFICIENT_RESOURCES", `not holding ${extra[c]} ${c}`);
  if (commit) {
    const bank = crownState(state).bank;
    for (const c of COMMODITIES) {
      cp.commodities[c] -= extra[c];
      bank[c] += extra[c];
    }
  }
  return commodityTotal(extra);
}

/** A representative discard that spends resources first and commodities (largest stacks first) for the rest. */
export function representativeCommodityDiscard(state: GameState, player: Player, owed: number): DiscardAction | null {
  const resources = handSize(player.hand);
  if (resources >= owed) return null; // the core's resource-only instance covers it
  const cards = representativeDiscard(player.hand, resources);
  const remaining = { ...crownPlayer(state, player.id).commodities };
  const commodities: CommodityHand = { cloth: 0, coin: 0, paper: 0 };
  for (let i = resources; i < owed; i++) {
    let best: Commodity = COMMODITIES[0];
    for (const c of COMMODITIES) if (remaining[c] > remaining[best]) best = c;
    if (remaining[best] === 0) return null;
    remaining[best] -= 1;
    commodities[best] += 1;
  }
  return { type: "DISCARD", playerId: player.id, cards, commodities };
}

export function discardActions(state: GameState, playerId: PlayerId, out: Action[]): void {
  if (state.phase.kind !== "discard") return;
  const owed = state.pendingDiscards[playerId];
  if (owed === undefined) return;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  const rep = representativeCommodityDiscard(state, player, owed);
  if (rep) out.push(rep);
}
