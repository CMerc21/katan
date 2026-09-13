/**
 * Hard bot (docs/phase5.md §6.6): medium plus a plan and one-ply lookahead.
 *
 * Candidate actions are applied to a local copy rebuilt from the redacted
 * view (`viewToState`), which is exact for the bot's own builds, purchases
 * and maritime trades because those only touch public state and its own
 * hand. The resulting position is scored; the best candidate wins.
 */

import {
  RESOURCES,
  applyAction,
  isRuleError,
  redact,
  viewToState,
  type Action,
  type EdgeId,
  type VertexId,
} from "@katan/engine";
import { afford, edgeTowardScore, geo, handTotal, hexValueFor, myHand, productionOf, publicVP, resourceNeed, scarcity, settlementCandidates, threat, vertexScore } from "./eval";
import { bestSetupLink, chooseGold, chooseRobberHex, chooseShipMove, chooseSpecialBuild, discardKeepingTarget, longestRoadGain, offeredThisTurn, respondToTrade } from "./medium";
import { best, ensureLegal, isResourceTrade, ofType, pick, type BotPolicy, type RedactedState, type Rng } from "./types";
import { choosePrompt, linkBonus, positionBonus, wayfarersAfterBuild, wayfarersBeforeBuild, withBoot } from "./wayfarers";

export function hardBot(): BotPolicy {
  return { level: "hard", chooseAction: chooseHard };
}

const MAX_CANDIDATES = 60;

export function chooseHard(view: RedactedState, legal: Action[], rng: Rng): Action {
  const phase = view.phase.kind;
  const me = view.viewer;

  if (phase === "setup") {
    const settlements = ofType(legal, "BUILD_SETTLEMENT");
    if (settlements.length) return best(rng, settlements, (a) => vertexScore(view, a.vertex, me) + 0.3 * planValueFrom(view, a.vertex, me));
    return bestSetupLink(view, legal, rng, (edge, kind) => scoreEdgeForPlan(view, edge, me) + (kind === "ship" ? edgeTowardScore(view, edge, me, "ship") * 0.5 : 0));
  }
  if (phase === "discard") return discardKeepingTarget(view, legal, rng);
  if (phase === "chooseGold") return chooseGold(view, legal, rng);
  if (phase === "moveRobber") {
    const leading = view.players.every((p) => p.id === me || publicVP(p) <= publicVP(view.players.find((x) => x.id === me)!));
    return chooseRobberHex(view, legal, rng, leading ? "threat" : "leader");
  }
  if (phase === "steal") {
    const t = threat(view);
    const steals = ofType(legal, "STEAL");
    return best(rng, steals, (a) => (a.targetPlayerId === t.leader?.id ? 10 : 0) + publicVP(view.players.find((p) => p.id === a.targetPlayerId)!));
  }
  if (phase === "roll") {
    const knight = legal.find((a) => a.type === "PLAY_KNIGHT");
    if (knight && hexValueFor(view, view.robberHex, me) > 0) return knight;
    return legal.find((a) => a.type === "ROLL") ?? pick(rng, legal);
  }
  if (phase === "roadBuilding") {
    return bestSetupLink(view, legal, rng, (edge, kind) => scoreEdgeForPlan(view, edge, me) + longestRoadGain(view, edge, me) + (kind === "ship" ? edgeTowardScore(view, edge, me, "ship") * 0.5 : 0));
  }
  if (phase === "action") {
    const current = view.players[view.currentPlayer]!.id;
    if (current !== me) return respondToTradeHard(view, legal, rng);
    return chooseByLookahead(view, legal, rng);
  }
  if (phase === "specialBuild") {
    // Lookahead over the build candidates; fall back to the medium rule of thumb.
    const pick1 = chooseByLookahead(view, legal, rng);
    return pick1.type === "SPECIAL_BUILD_DONE" ? chooseSpecialBuild(view, legal, rng) : pick1;
  }
  // Wayfarers / Crown prompts (docs/phase10.md §4).
  if (phase === "modulePrompt") return choosePrompt(view, legal, rng);
  return pick(rng, legal);
}

// ---------------------------------------------------------------------------
// Plan: reachable settlement spots within 3 roads scored by value / roads needed.

interface PlanTarget {
  readonly vertex: VertexId;
  readonly roads: number;
  readonly value: number;
}

export function plan(view: RedactedState, playerId: string): PlanTarget[] {
  const state = viewToState(view);
  const g = geo(view);
  const p = view.players.find((x) => x.id === playerId)!;
  const roadsAll = new Set(view.players.flatMap((x) => [...x.roads, ...x.ships]));
  const myLinks = new Set([...p.roads, ...p.ships]);
  const taken = new Set(view.players.flatMap((x) => [...x.settlements, ...x.cities]));
  const blocked = new Set(view.players.filter((x) => x.id !== playerId).flatMap((x) => [...x.settlements, ...x.cities]));
  // BFS over vertices from my network, counting roads needed.
  const dist = new Map<VertexId, number>();
  const queue: VertexId[] = [];
  for (const e of myLinks) for (const v of g.edgeVertices[e] ?? []) if (!dist.has(v)) { dist.set(v, 0); queue.push(v); }
  for (const v of [...p.settlements, ...p.cities]) if (!dist.has(v)) { dist.set(v, 0); queue.push(v); }
  while (queue.length) {
    const v = queue.shift()!;
    const d = dist.get(v)!;
    if (d >= 3 || (blocked.has(v) && d > 0)) continue;
    for (const e of g.vertexEdges[v] ?? []) {
      if (roadsAll.has(e) && !myLinks.has(e)) continue;
      const [a, b] = g.edgeVertices[e] as [VertexId, VertexId];
      const n = a === v ? b : a;
      const nd = myLinks.has(e) ? d : d + 1;
      if (!dist.has(n) || dist.get(n)! > nd) { dist.set(n, nd); queue.push(n); }
    }
  }
  const out: PlanTarget[] = [];
  const { satisfiesDistanceRule } = engineQueries();
  for (const [v, d] of dist) {
    if (taken.has(v) || !satisfiesDistanceRule(state, v)) continue;
    if (!(g.vertexHexes[v] ?? []).some((h) => view.board.hexes[h] !== undefined)) continue;
    const value = vertexScore(view, v, playerId);
    out.push({ vertex: v, roads: d, value: value / (d + 1) });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, 5);
}

function engineQueries() {
  // Imported lazily to keep the import list readable.
  return { satisfiesDistanceRule: satisfiesDistanceRuleImpl };
}
import { satisfiesDistanceRule as satisfiesDistanceRuleImpl } from "@katan/engine";

function planValueFrom(view: RedactedState, vertex: VertexId, playerId: string): number {
  // Value of the best neighbouring-neighbour spot (what a first road could reach).
  const g = geo(view);
  let bestV = 0;
  for (const n of g.vertexNeighbors[vertex] ?? []) {
    for (const nn of g.vertexNeighbors[n] ?? []) {
      if (nn === vertex) continue;
      bestV = Math.max(bestV, vertexScore(view, nn, playerId));
    }
  }
  return bestV;
}

function scoreEdgeForPlan(view: RedactedState, edge: EdgeId, playerId: string): number {
  const targets = plan(view, playerId);
  const g = geo(view);
  const [a, b] = g.edgeVertices[edge] as [VertexId, VertexId];
  let s = 0;
  for (const t of targets) {
    const touches = t.vertex === a || t.vertex === b;
    const near = (g.vertexNeighbors[t.vertex] ?? []).some((n) => n === a || n === b);
    if (touches) s = Math.max(s, t.value * 2);
    else if (near) s = Math.max(s, t.value);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Position scoring and one-ply lookahead.

export function positionScore(view: RedactedState, playerId: string): number {
  const p = view.players.find((x) => x.id === playerId)!;
  const vp = publicVP(p);
  const prod = productionOf(view, playerId);
  const weights = scarcity(view);
  let production = 0;
  for (const r of RESOURCES) production += prod[r] * weights[r];
  const targets = plan(view, playerId);
  const planScore = targets.reduce((n, t) => n + t.value, 0);
  const endgame = vp >= 8 ? 3 : 1;
  const hand = playerId === view.viewer ? myHand(view) : null;
  const need = resourceNeed(view, playerId);
  const closeness = hand ? -handTotal(need.missing) : 0;
  const cards = hand ? Math.min(handTotal(hand), 7) * 0.15 : 0;
  const t = threat(view);
  const lr = view.longestRoad.playerId === playerId ? 0 : p.roads.length >= 4 ? 0.8 : 0;
  const la = view.largestArmy.playerId === playerId ? 0 : p.playedKnights >= 2 ? 0.8 : 0;
  // Wayfarers (docs/phase10.md §4): chip progress and stored variant currency.
  const variants = positionBonus(view, playerId);
  return vp * 10 * endgame + production * 0.6 + planScore * 0.25 + closeness * 0.8 + cards + lr + la + variants - t.leaderVP * 0.2;
}

function chooseByLookahead(view: RedactedState, legal: Action[], rng: Rng): Action {
  const me = view.viewer;
  const hand = myHand(view);
  const need = resourceNeed(view, me);
  const baseState = viewToState(view);
  const baseScore = positionScore(view, me);

  // Wayfarers (docs/phase10.md §4): fish, caravans, rebuilds and deliveries first; the variant
  // action types stay out of the lookahead (their payoffs are not in positionScore).
  const early = wayfarersBeforeBuild(view, legal, rng);
  if (early) return early;

  const candidates = legal.filter(
    (a) =>
      a.type === "BUILD_ROAD" ||
      a.type === "BUILD_SHIP" ||
      a.type === "BUILD_SETTLEMENT" ||
      a.type === "BUILD_CITY" ||
      a.type === "BUY_DEV_CARD" ||
      a.type === "MARITIME_TRADE" ||
      a.type === "PLAY_ROAD_BUILDING" ||
      a.type === "PLAY_MONOPOLY" ||
      a.type === "PLAY_INVENTION" ||
      a.type === "PLAY_KNIGHT",
  );

  // Prune: keep the most promising roads and maritime trades.
  const roads = candidates.filter((a) => a.type === "BUILD_ROAD" || a.type === "BUILD_SHIP");
  const trades = candidates.filter((a) => a.type === "MARITIME_TRADE");
  const others = candidates.filter((a) => a.type !== "BUILD_ROAD" && a.type !== "BUILD_SHIP" && a.type !== "MARITIME_TRADE");
  const topRoads = roads
    .map((a) => ({ a, s: a.type === "BUILD_ROAD" ? scoreEdgeForPlan(view, a.edge, me) + longestRoadGain(view, a.edge, me) + linkBonus(view, a.edge, me) : a.type === "BUILD_SHIP" ? scoreEdgeForPlan(view, a.edge, me) + edgeTowardScore(view, a.edge, me, "ship") * 0.5 : 0 }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 8)
    .map((x) => x.a);
  const usefulTrades = trades.filter((a) => isResourceTrade(a) && need.missing[a.receive] > 0 && need.cost[a.give] === 0);
  const pool = [...others, ...topRoads, ...usefulTrades].slice(0, MAX_CANDIDATES);

  let bestAction: Action | null = null;
  let bestGain = 0.05;
  for (const a of pool) {
    const gain = evaluate(view, baseState, baseScore, a, me);
    if (gain > bestGain + 1e-9 || (bestAction === null && gain > bestGain)) {
      bestGain = gain;
      bestAction = a;
    }
  }
  // Wayfarers: guards, wagon moves and boot offers rank between buildings and everything else.
  if (bestAction && (bestAction.type === "BUILD_SETTLEMENT" || bestAction.type === "BUILD_CITY")) return bestAction;
  const later = wayfarersAfterBuild(view, legal, rng);
  if (later) return later;
  if (bestAction) return bestAction;
  const shipMove = chooseShipMove(view, legal, rng);
  if (shipMove) return shipMove;

  // One 1:1 offer per turn for the single blocking resource (as medium).
  const missing = RESOURCES.filter((r) => need.missing[r] > 0);
  if (missing.length === 1 && handTotal(need.missing) === 1 && !view.pendingTrade && !offeredThisTurn(view)) {
    const want = missing[0]!;
    const spare = RESOURCES.filter((r) => r !== want && hand[r] > need.cost[r]);
    if (spare.length) {
      const give = best(rng, spare, (r) => hand[r] - need.cost[r]);
      const giveHand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      const receive = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      giveHand[give] = 1;
      receive[want] = 1;
      const offer = ensureLegal(legal, { type: "OFFER_TRADE", playerId: me, give: giveHand, receive });
      if (offer) return withBoot(legal, offer);
    }
  }
  return legal.find((a) => a.type === "END_TURN") ?? legal.find((a) => a.type === "SPECIAL_BUILD_DONE") ?? pick(rng, legal);
}

/** Score gain from applying `action` to the local copy; cards with hidden outcomes get a fixed estimate. */
function evaluate(view: RedactedState, baseState: ReturnType<typeof viewToState>, baseScore: number, action: Action, me: string): number {
  switch (action.type) {
    case "BUY_DEV_CARD": {
      // Unknown card: value it by remaining deck (VP cards) and by what else the cards could do.
      const deck = view.devDeck.count;
      const vpChance = deck > 0 ? Math.min(5, deck) / 25 : 0;
      const p = view.players.find((x) => x.id === me)!;
      const endgame = publicVP(p) >= 8 ? 6 : 1.2;
      return vpChance * 10 * endgame + 0.6 - (settlementCandidates(view, me).length > 0 && afford(myHand(view), { wood: 1, clay: 1, wool: 1, grain: 1, ore: 0 }) ? 5 : 0);
    }
    case "PLAY_KNIGHT":
      return hexValueFor(view, view.robberHex, me) > 0 ? 1.5 : view.largestArmy.playerId !== me && view.players.find((x) => x.id === me)!.playedKnights >= 2 ? 3 : 0;
    case "PLAY_ROAD_BUILDING": {
      const p = view.players.find((x) => x.id === me)!;
      return view.longestRoad.playerId !== me && p.roads.length + 2 >= Math.max(5, view.longestRoad.length + 1) ? 20 : plan(view, me).length ? 1.5 : 0;
    }
    default: {
      try {
        const next = applyAction(baseState, action);
        const nextView = redact(next, me);
        return positionScore(nextView, me) - baseScore;
      } catch (err) {
        if (isRuleError(err)) return -Infinity;
        throw err;
      }
    }
  }
}

function respondToTradeHard(view: RedactedState, legal: Action[], rng: Rng): Action {
  const trade = view.pendingTrade;
  const accept = legal.find((a) => a.type === "ACCEPT_TRADE");
  if (!trade || !accept) return respondToTrade(view, legal, rng);
  // Decline anything that helps a leader close on 10.
  const from = view.players.find((p) => p.id === trade.from)!;
  if (publicVP(from) >= 8) return legal.find((a) => a.type === "REJECT_TRADE") ?? pick(rng, legal);
  // Wayfarers (docs/phase10.md §2): the medium rule handles an offer that carries the old boot.
  if (trade.boot === true) return respondToTrade(view, legal, rng);
  // Score both sides by expected production access: accept if my gain ≥ theirs.
  const me = view.viewer;
  const base = viewToState(view);
  try {
    const after = applyAction(base, accept);
    const mine = positionScore(redact(after, me), me) - positionScore(view, me);
    const theirs = positionScore(redact(after, from.id), from.id) - positionScore(redact(base, from.id), from.id);
    if (mine > 0 && mine >= theirs * 0.8) return withBoot(legal, accept);
  } catch {
    /* fall through */
  }
  return respondToTrade(view, legal, rng);
}
