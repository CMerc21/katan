/**
 * Turn helpers shared by the core transition and the modules: gold choices,
 * discards, random steals, city upgrades, Road Building. Kept out of
 * `actions.ts` so modules can import them without an import cycle.
 */

import type { Resource } from "./board";
import { RuleError } from "./errors";
import type { EdgeId, VertexId } from "./geometry";
import { activeModules } from "./modules/hooks";
import { rng } from "./rng";
import { cardCount, discardOwedFor, discardThreshold, emit, expandHand, handSize, tidesOn } from "./state";
import type { GameState, Phase, Player, PlayerId } from "./types";

/** §14.3: park the game in `chooseGold` when anyone is owed gold and the bank has cards; otherwise go straight on. */
export function resolveGold(state: GameState, gold: Record<PlayerId, number>, returnTo: Phase): void {
  const owed: Record<PlayerId, number> = {};
  for (const [id, n] of Object.entries(gold)) if (n > 0) owed[id] = n;
  if (Object.keys(owed).length === 0 || handSize(state.bank) === 0) {
    state.phase = returnTo;
    return;
  }
  state.phase = { kind: "chooseGold", owed, returnTo };
}

/** §7.1: everyone over the limit discards; play resumes in `returnTo` (the robber after a seven). */
export function startDiscards(state: GameState, returnTo: Phase, threshold: (p: Player) => number = (p) => discardThreshold(state, p)): void {
  const pending: Record<PlayerId, number> = {};
  for (const p of state.players) {
    const owed = discardOwedFor(cardCount(state, p), threshold(p));
    if (owed > 0) pending[p.id] = owed;
  }
  state.pendingDiscards = pending;
  state.phase = Object.keys(pending).length > 0 ? { kind: "discard", returnTo } : returnTo;
}

/** §7.3: take one random card (resource, or a module card such as a commodity) from `target`. Shared with modules. */
export function stealRandomCard(state: GameState, thief: Player, target: Player, draw = rng(state.seed, state.actionIndex)): void {
  const cards = expandHand(target.hand);
  const hooks = activeModules(state);
  const extra = hooks.reduce((n, h) => n + (h.cardCount?.(state, target) ?? 0), 0);
  const n = cards.length + extra;
  if (n === 0) return;
  const i = draw.int(n);
  if (i < cards.length) {
    const pick = cards[i] as Resource;
    target.hand[pick] -= 1;
    thief.hand[pick] += 1;
    emit(state, { kind: "stole", from: target.id, to: thief.id, resource: pick });
    return;
  }
  let offset = i - cards.length;
  for (const h of hooks) {
    const count = h.cardCount?.(state, target) ?? 0;
    if (offset < count) {
      const name = h.stealExtra?.(state, thief, target, offset) ?? null;
      emit(state, { kind: "stole", from: target.id, to: thief.id, resource: name as Resource | null });
      return;
    }
    offset -= count;
  }
}

export function notifyBuilt(state: GameState, playerId: PlayerId, piece: "road" | "ship" | "settlement" | "city", at: EdgeId | VertexId): void {
  for (const h of activeModules(state)) h.onBuilt?.(state, playerId, piece, at);
}

/** Turn a settlement into a city (shared with the crown module's Medicine card). */
export function upgradeToCity(state: GameState, player: Player, vertex: VertexId): void {
  const idx = player.settlements.indexOf(vertex);
  if (idx < 0) throw new RuleError("NOT_YOUR_SETTLEMENT", `no settlement of yours at ${vertex}`);
  player.settlements.splice(idx, 1);
  player.cities.push(vertex);
  player.pieces.cities -= 1;
  player.pieces.settlements += 1; // §5.4
  emit(state, { kind: "built", playerId: player.id, piece: "city", at: vertex });
  notifyBuilt(state, player.id, "city", vertex);
}

/** Two free roads (or ships), shared with the crown module's Road Building card. */
export function startRoadBuilding(state: GameState, player: Player): void {
  const pieces = player.pieces.roads + (tidesOn(state) ? player.pieces.ships : 0);
  state.phase = { kind: "roadBuilding", remaining: pieces >= 2 ? 2 : 1 };
}

