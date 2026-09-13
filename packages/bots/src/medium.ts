/**
 * Medium bot (docs/phase5.md §6.5): a competent opponent.
 */

import { RESOURCES, TERRAIN_RESOURCE, type Action, type Hand, type Resource } from "@katan/engine";
import {
  afford,
  cardCount,
  edgeTowardScore,
  geo,
  goldPick,
  handTotal,
  hexValueFor,
  hexValueForOpponents,
  hexesOf,
  me as meOf,
  myHand,
  opponentsLikelyResource,
  pirateHexScore,
  publicVP,
  resourceNeed,
  threat,
  vertexScore,
} from "./eval";
import { best, ensureLegal, ofType, pick, resourceTrades, type BotPolicy, type RedactedState, type Rng } from "./types";
import { chooseGuard, choosePrompt, cityBonus, linkBonus, wayfarersAfterBuild, wayfarersBeforeBuild, withBoot } from "./wayfarers";

export function mediumBot(): BotPolicy {
  return { level: "medium", chooseAction: chooseMedium };
}

/** Did I already offer a trade this turn? (Bots are stateless; the log is public.) */
export function offeredThisTurn(view: RedactedState): boolean {
  return view.log.some((l) => l.turn === view.turn && l.playerId === view.viewer && l.text.endsWith("offered a trade"));
}

export function chooseMedium(view: RedactedState, legal: Action[], rng: Rng): Action {
  const phase = view.phase.kind;
  const me = view.viewer;

  if (phase === "setup") {
    const settlements = ofType(legal, "BUILD_SETTLEMENT");
    if (settlements.length) return best(rng, settlements, (a) => vertexScore(view, a.vertex, me));
    return bestSetupLink(view, legal, rng, (edge, kind) => edgeTowardScore(view, edge, me, kind));
  }

  if (phase === "discard") return discardKeepingTarget(view, legal, rng);

  if (phase === "chooseGold") return chooseGold(view, legal, rng);

  if (phase === "moveRobber") return chooseRobberHex(view, legal, rng, "leader");

  if (phase === "steal") {
    const steals = ofType(legal, "STEAL");
    return best(rng, steals, (a) => cardCount(view.players.find((p) => p.id === a.targetPlayerId)!));
  }

  if (phase === "roll") {
    // Knight before rolling if the robber sits on one of my producing hexes.
    const knight = legal.find((a) => a.type === "PLAY_KNIGHT");
    if (knight && hexValueFor(view, view.robberHex, me) > 0) return knight;
    return legal.find((a) => a.type === "ROLL") ?? pick(rng, legal);
  }

  if (phase === "roadBuilding") {
    return bestSetupLink(view, legal, rng, (edge, kind) => edgeTowardScore(view, edge, me, kind) + longestRoadGain(view, edge, me) + linkBonus(view, edge, me));
  }

  if (phase === "action") {
    const current = view.players[view.currentPlayer]!.id;
    if (current !== me) return respondToTrade(view, legal, rng);
    return chooseTurnAction(view, legal, rng);
  }

  if (phase === "specialBuild") return chooseSpecialBuild(view, legal, rng);

  // Wayfarers / Crown prompts (docs/phase10.md §4).
  if (phase === "modulePrompt") return choosePrompt(view, legal, rng);

  return pick(rng, legal);
}

/** Setup and Road Building: the best road or ship (docs/phase9.md §7), scored by `score(edge, kind)`. */
export function bestSetupLink(view: RedactedState, legal: Action[], rng: Rng, score: (edge: string, kind: "road" | "ship") => number): Action {
  const links: { a: Action; s: number }[] = [];
  for (const a of ofType(legal, "BUILD_ROAD")) links.push({ a, s: score(a.edge, "road") });
  for (const a of ofType(legal, "BUILD_SHIP")) links.push({ a, s: score(a.edge, "ship") });
  if (links.length === 0) return pick(rng, legal);
  return best(rng, links, (l) => l.s).a;
}

/** docs/phase9.md §7: take what the next build needs, then the scarcest resource. */
export function chooseGold(view: RedactedState, legal: Action[], rng: Rng): Action {
  const me = view.viewer;
  const choices = ofType(legal, "CHOOSE_GOLD");
  if (choices.length === 0) return pick(rng, legal);
  const want = goldPick(view, me, choices[0]!.resources.length);
  const key = (rs: readonly Resource[]) => [...rs].sort().join();
  return choices.find((c) => key(c.resources) === key(want)) ?? best(rng, choices, (c) => c.resources.filter((r) => want.includes(r)).length);
}

/** docs/phase9.md §7: move the open-end ship toward the best target when it leads nowhere itself. */
export function chooseShipMove(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const me = view.viewer;
  const moves = ofType(legal, "MOVE_SHIP");
  if (moves.length === 0) return null;
  const scored = moves.map((m) => ({ m, gain: edgeTowardScore(view, m.to, me, "ship") - edgeTowardScore(view, m.from, me, "ship") }));
  const top = scored.reduce((b, x) => (x.gain > b.gain ? x : b), scored[0]!);
  return top.gain > 1 ? best(rng, scored.filter((x) => x.gain >= top.gain - 1e-9), (x) => x.gain).m : null;
}

/** docs/phase8.md §5: the special build is a build-or-pass decision with the turn priorities. */
export function chooseSpecialBuild(view: RedactedState, legal: Action[], rng: Rng): Action {
  const me = view.viewer;
  const need = resourceNeed(view, me);
  const cities = ofType(legal, "BUILD_CITY");
  if (cities.length) return best(rng, cities, (a) => handTotal(vertexPipsFor(view, a.vertex)) + cityBonus(view, a.vertex));
  const settlements = ofType(legal, "BUILD_SETTLEMENT");
  if (settlements.length) return best(rng, settlements, (a) => vertexScore(view, a.vertex, me));
  // Wayfarers (docs/phase10.md §5): guards may be posted in the special build phase.
  const guard = chooseGuard(view, legal, rng);
  if (guard) return guard;
  const links = [
    ...ofType(legal, "BUILD_ROAD").map((a) => ({ a: a as Action, s: edgeTowardScore(view, a.edge, me) + longestRoadGain(view, a.edge, me) + linkBonus(view, a.edge, me) })),
    ...ofType(legal, "BUILD_SHIP").map((a) => ({ a: a as Action, s: edgeTowardScore(view, a.edge, me, "ship") + longestRoadGain(view, a.edge, me) })),
  ];
  if (links.length) {
    const top = links.reduce((b, x) => (x.s > b.s ? x : b), links[0]!);
    if (top.s > 0.5) return top.a;
  }
  const buy = legal.find((a) => a.type === "BUY_DEV_CARD");
  if (buy && need.target === "devCard") return buy;
  return legal.find((a) => a.type === "SPECIAL_BUILD_DONE") ?? pick(rng, legal);
}

// ---------------------------------------------------------------------------

export function discardKeepingTarget(view: RedactedState, legal: Action[], rng: Rng): Action {
  const me = view.viewer;
  const owed = view.pendingDiscards[me] ?? 0;
  const need = resourceNeed(view, me);
  const hand = { ...myHand(view) };
  const cards = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
  for (let i = 0; i < owed; i++) {
    // Surplus first: cards beyond what the target needs; then the biggest stack.
    const options = RESOURCES.filter((r) => hand[r] > 0);
    const r = best(rng, options, (x) => (hand[x] - need.cost[x]) * 10 + hand[x]);
    hand[r] -= 1;
    cards[r] += 1;
  }
  return ensureLegal(legal, { type: "DISCARD", playerId: me, cards }) ?? pick(rng, legal);
}

export function chooseRobberHex(view: RedactedState, legal: Action[], rng: Rng, mode: "leader" | "threat"): Action {
  const me = view.viewer;
  const moves = ofType(legal, "MOVE_ROBBER");
  const mine = hexesOf(view, me);
  const t = threat(view);
  const target =
    mode === "threat" ? (t.roadThreat ?? t.armyThreat ?? t.leader?.id ?? null) : (t.leader?.id ?? null);
  return best(rng, moves, (m) => {
    // docs/phase9.md §7: the pirate goes where the most opposing ships are, never beside our own.
    if (m.target === "pirate") return pirateHexScore(view, m.hex, me);
    if (mine.has(m.hex)) return -100;
    const forTarget = target ? hexValueFor(view, m.hex, target) : 0;
    return forTarget * 3 + hexValueForOpponents(view, m.hex);
  });
}

export function respondToTrade(view: RedactedState, legal: Action[], rng: Rng): Action {
  const me = view.viewer;
  const trade = view.pendingTrade;
  const accept = legal.find((a) => a.type === "ACCEPT_TRADE");
  const reject = legal.find((a) => a.type === "REJECT_TRADE");
  if (!trade || !accept) return reject ?? pick(rng, legal);
  const need = resourceNeed(view, me);
  const hand = myHand(view);
  // Accept only if it strictly reduces what I am missing and gives away nothing I am short on.
  const before = handTotal(need.missing);
  const after = RESOURCES.reduce((n, r) => n + Math.max(0, need.cost[r] - (hand[r] - trade.receive[r] + trade.give[r])), 0);
  const givesAwayShort = RESOURCES.some((r) => trade.receive[r] > 0 && hand[r] - trade.receive[r] < need.cost[r]);
  const leaderAsking = threat(view).leader?.id === trade.from && publicVP(view.players.find((p) => p.id === trade.from)!) >= 8;
  // Wayfarers (docs/phase10.md §2): an offer carrying the old boot (-1 VP) is taken only when it completes the build.
  if (trade.boot === true && after > 0) return reject ?? pick(rng, legal);
  if (after < before && !givesAwayShort && !leaderAsking) return withBoot(legal, accept);
  return reject ?? pick(rng, legal);
}

/** How many extra Longest Road points a road would earn (rough: 2 if it makes me the unique holder). */
export function longestRoadGain(view: RedactedState, edge: string, playerId: string): number {
  void edge;
  const p = view.players.find((x) => x.id === playerId)!;
  const holderLen = view.longestRoad.length;
  if (view.longestRoad.playerId === playerId) return 0;
  // Approximation: my road count near the threshold means an extra edge may take it.
  const mine = p.roads.length + 1;
  if (mine >= Math.max(5, holderLen + 1)) return 2;
  return 0;
}

export function chooseTurnAction(view: RedactedState, legal: Action[], rng: Rng): Action {
  const me = view.viewer;
  const p = meOf(view);
  const hand = myHand(view);
  const need = resourceNeed(view, me);

  // Wayfarers (docs/phase10.md §4): fish, caravans, rebuilds and deliveries first (free or clearly profitable).
  const early = wayfarersBeforeBuild(view, legal, rng);
  if (early) return early;

  // Road Building toward Longest Road, or when roads are what the plan needs.
  const roadBuilding = legal.find((a) => a.type === "PLAY_ROAD_BUILDING");
  if (roadBuilding && view.longestRoad.playerId !== me && p.roads.length + 2 >= Math.max(5, view.longestRoad.length + 1)) return roadBuilding;

  // Monopoly on what opponents likely hold most of, when it completes a build.
  const monopoly = ofType(legal, "PLAY_MONOPOLY");
  if (monopoly.length) {
    const r = opponentsLikelyResource(view);
    const m = monopoly.find((a) => a.resource === r);
    if (m && need.missing[r] > 0) return m;
  }
  // Invention fills the next build.
  const inventions = ofType(legal, "PLAY_INVENTION");
  if (inventions.length && handTotal(need.missing) > 0) {
    const wanted = RESOURCES.flatMap((r) => Array<Resource>(need.missing[r]).fill(r)).slice(0, 2);
    const pair: [Resource, Resource] = [wanted[0] ?? "ore", wanted[1] ?? wanted[0] ?? "grain"];
    const match = inventions.find((a) => [...a.resources].sort().join() === [...pair].sort().join());
    if (match) return match;
  }

  // Build priority (§6.5).
  const cities = ofType(legal, "BUILD_CITY");
  if (cities.length) return best(rng, cities, (a) => handTotal(vertexPipsFor(view, a.vertex)) + cityBonus(view, a.vertex));
  const settlements = ofType(legal, "BUILD_SETTLEMENT");
  if (settlements.length) return best(rng, settlements, (a) => vertexScore(view, a.vertex, me));
  // Wayfarers (docs/phase10.md §4): guards, wagon moves and boot-passing offers before roads and purchases.
  const later = wayfarersAfterBuild(view, legal, rng);
  if (later) return later;
  const links = [
    ...ofType(legal, "BUILD_ROAD").map((a) => ({ a: a as Action, s: edgeTowardScore(view, a.edge, me) + longestRoadGain(view, a.edge, me) + linkBonus(view, a.edge, me) })),
    ...ofType(legal, "BUILD_SHIP").map((a) => ({ a: a as Action, s: edgeTowardScore(view, a.edge, me, "ship") + longestRoadGain(view, a.edge, me) })),
  ];
  if (links.length) {
    const top = links.reduce((b, x) => (x.s > b.s ? x : b), links[0]!);
    // Only spend on a road or ship when it opens something, or when settlements are the plan and nothing is reachable.
    if (top.s > 0.5 || ((need.target === "settlement" || need.target === "ship") && top.s > 0)) return best(rng, links.filter((l) => l.s >= top.s - 1e-9), (l) => l.s).a;
  }
  // docs/phase9.md §7: relocate a ship that leads nowhere.
  const shipMove = chooseShipMove(view, legal, rng);
  if (shipMove) return shipMove;
  const buy = legal.find((a) => a.type === "BUY_DEV_CARD");
  if (buy && (need.target === "devCard" || afford(hand, { wood: 0, clay: 0, wool: 1, grain: 1, ore: 1 }))) {
    // Buy when nothing better is affordable this turn.
    if (!cities.length && !settlements.length) return buy;
  }

  // Knight after rolling if the robber blocks me (and it is not too early).
  const knight = legal.find((a) => a.type === "PLAY_KNIGHT");
  if (knight && hexValueFor(view, view.robberHex, me) > 0) return knight;

  // Maritime trades to complete the next build, keeping at least one card of what is traded away.
  const maritime = resourceTrades(legal);
  const missing = RESOURCES.filter((r) => need.missing[r] > 0);
  if (maritime.length && missing.length) {
    const useful = maritime.filter((t) => missing.includes(t.receive) && need.cost[t.give] === 0 && hand[t.give] - t.giveCount >= 1);
    if (useful.length) {
      const chosen = best(rng, useful, (t) => -t.giveCount + hand[t.give] * 0.1);
      // Only if the trade actually gets me to the build (or within one card).
      const after = handTotal(need.missing) - 1;
      if (after <= 1) return chosen;
    }
  }

  // One 1:1 offer per turn for the single blocking resource.
  if (missing.length === 1 && handTotal(need.missing) === 1 && !view.pendingTrade && !offeredThisTurn(view)) {
    const want = missing[0]!;
    const spare = RESOURCES.filter((r) => r !== want && hand[r] > need.cost[r]);
    if (spare.length) {
      const give = best(rng, spare, (r) => hand[r] - need.cost[r]);
      const giveHand: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      const receive: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      giveHand[give] = 1;
      receive[want] = 1;
      const offer = ensureLegal(legal, { type: "OFFER_TRADE", playerId: me, give: giveHand, receive });
      if (offer) return withBoot(legal, offer);
    }
  }

  return legal.find((a) => a.type === "END_TURN") ?? pick(rng, legal);
}

function vertexPipsFor(view: RedactedState, vertex: string): Hand {
  const out: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
  for (const h of geo(view).vertexHexes[vertex] ?? []) {
    const tile = view.board.hexes[h];
    if (!tile || tile.token === null) continue;
    const r = TERRAIN_RESOURCE[tile.terrain];
    if (r) out[r] += 6 - Math.abs(7 - tile.token);
  }
  return out;
}
