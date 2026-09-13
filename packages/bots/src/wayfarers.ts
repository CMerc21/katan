/**
 * Wayfarers variant heuristics (docs/phase10.md §4, docs/specs/phase10-spec.md
 * "Bots:" lines). Everything here reads only the redacted view (public
 * state under `view.wayfarers` plus the bot's own hand) and chooses from the
 * legal list; the base levels call in at a few marked points.
 *
 * - Prompts: `choosePrompt` (castle placement, Neighborly help; any other
 *   prompt kind gets a sensible random default so nothing stalls).
 * - Fishing: `chooseFishSpend` (greedy, highest-value affordable option) and
 *   `withBoot` (pass the old boot whenever a trade allows).
 * - Rivers / Harbormaster / Caravans: `vertexBonus` (extra vertex value) and
 *   `linkBonus` (road preference).
 * - Raiders: `chooseRaidersAction` (rebuild raided hexes, post guards when
 *   the counter is at 10 or more).
 * - Caravans: `chooseCaravanExtend` (spice has no other use).
 * - Wagons: `chooseWagonAction` (greedy nearest-delivery planner).
 *
 * Ordering for a turn: `wayfarersBeforeBuild` (free or clearly profitable
 * things: fish, caravans, rebuilds, deliveries) runs before the base build
 * logic, `wayfarersAfterBuild` (guards, wagon moves) after settlements and
 * cities but before roads and purchases.
 */

import { RESOURCES, boardGeometry, type Action, type EdgeId, type HexId, type Resource, type VariantName, type VertexId, type WagonGood } from "@katan/engine";
import { PIPS, cardCount, edgeTowardScore, handTotal, hexValueFor, me as meOf, myHand, player, rawPipCount, resourceNeed, scarcity, threat } from "./eval";
import { longestRoadGain, offeredThisTurn } from "./medium";
import { best, ensureLegal, ofType, pick, type RedactedState, type Rng } from "./types";

export function variantOn(view: RedactedState, name: VariantName): boolean {
  return view.scenario?.variants[name] === true;
}

// ---------------------------------------------------------------------------
// Prompts (docs/modules.md §4)

/** A module prompt addressed to the viewer: castle placement, Neighborly help, else a random legal answer. */
export function choosePrompt(view: RedactedState, legal: Action[], rng: Rng): Action {
  const phase = view.phase;
  if (phase.kind !== "modulePrompt") return pick(rng, legal);
  const me = view.viewer;
  switch (phase.prompt.kind) {
    case "placeCastle": {
      // docs/phase10.md §5: the castle is immune to raids, so protect the best producer.
      const castles = ofType(legal, "BUILD_CASTLE");
      if (castles.length) return best(rng, castles, (a) => rawPipCount(view, a.vertex));
      return pick(rng, legal);
    }
    case "neighborlyHelp": {
      // docs/phase10.md §1: give the most-held resource when the hand is big and the receiver is not the leader.
      const gives = ofType(legal, "NEIGHBORLY_GIVE");
      const nothing = gives.find((a) => a.resource === null);
      const hand = myHand(view);
      const receiverLeads = threat(view).leader?.id === phase.prompt.to;
      if (handTotal(hand) >= 5 && !receiverLeads) {
        const most = RESOURCES.reduce((b, r) => (hand[r] > hand[b] ? r : b), RESOURCES[0]);
        const give = gives.find((a) => a.resource === most);
        if (give) return give;
      }
      return nothing ?? (gives.length ? pick(rng, gives) : pick(rng, legal));
    }
    default:
      // Crown & Castle prompts (and anything new) never stall the bot.
      return pick(rng, legal);
  }
}

// ---------------------------------------------------------------------------
// Fishing (docs/phase10.md §2)

/** Greedy fish spend: the highest-value option affordable this turn, or null to keep the fish. */
export function chooseFishSpend(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const spends = ofType(legal, "SPEND_FISH");
  if (spends.length === 0) return null;
  const me = view.viewer;

  // 7: a free development card, or a free city when the deck is empty.
  const devCards = spends.filter((a) => a.option === "freeDevCard");
  if (devCards.length) {
    const upgrades = devCards.filter((a) => a.vertex !== undefined);
    if (upgrades.length) return best(rng, upgrades, (a) => rawPipCount(view, a.vertex as VertexId));
    return devCards[0] as Action;
  }

  // 5: a free road, when one actually leads somewhere (or takes Longest Road).
  const roads = spends.filter((a) => a.option === "freeRoad" && a.edge !== undefined);
  if (roads.length) {
    const scored = roads.map((a) => ({ a, s: edgeTowardScore(view, a.edge as EdgeId, me) + longestRoadGain(view, a.edge as EdgeId, me) + linkBonus(view, a.edge as EdgeId, me) }));
    const top = scored.reduce((b, x) => (x.s > b.s ? x : b), scored[0]!);
    if (top.s > 0.5) return best(rng, scored.filter((x) => x.s >= top.s - 1e-9), (x) => x.s).a;
  }

  // 4: a resource from the bank filling the next build, else the scarcest one.
  const bank = spends.filter((a) => a.option === "bankResource" && a.resource !== undefined);
  if (bank.length) {
    const need = resourceNeed(view, me);
    const weights = scarcity(view);
    return best(rng, bank, (a) => {
      const r = a.resource as Resource;
      return (need.missing[r] > 0 ? 10 : 0) + weights[r];
    });
  }

  // 3: steal from the leader (or whoever holds the most cards).
  const steals = spends.filter((a) => a.option === "steal" && a.targetPlayerId !== undefined);
  if (steals.length) {
    const leader = threat(view).leader?.id ?? null;
    return best(rng, steals, (a) => (a.targetPlayerId === leader ? 10 : 0) + cardCount(player(view, a.targetPlayerId as string)));
  }

  // 2: send the robber to rest only when it sits on one of the bot's producing hexes.
  const rests = spends.filter((a) => a.option === "moveRobber" && a.hex !== undefined);
  if (rests.length && hexValueFor(view, view.robberHex, me) > 0) return best(rng, rests, (a) => -hexValueFor(view, a.hex as HexId, me));

  return null;
}

/** Prefer the `boot: true` variant of a trade action when the engine lists it (the receiver is eligible). */
export function withBoot(legal: Action[], action: Action): Action {
  if (action.type !== "ACCEPT_TRADE" && action.type !== "OFFER_TRADE") return action;
  if (action.boot === true) return action;
  return ensureLegal(legal, { ...action, boot: true }) ?? action;
}

/** Holding the boot: offer a 1:1 trade with it attached (surplus for what the next build needs). */
export function chooseBootOffer(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const me = view.viewer;
  if (view.wayfarers?.fishing?.boot !== me || view.pendingTrade || offeredThisTurn(view)) return null;
  const offers = ofType(legal, "OFFER_TRADE").filter((a) => a.boot === true);
  if (offers.length === 0) return null;
  const hand = myHand(view);
  const need = resourceNeed(view, me);
  const weights = scarcity(view);
  const giveOf = (a: (typeof offers)[number]): Resource => RESOURCES.find((r) => a.give[r] > 0) ?? "wood";
  const receiveOf = (a: (typeof offers)[number]): Resource => RESOURCES.find((r) => a.receive[r] > 0) ?? "wood";
  return best(rng, offers, (a) => {
    const give = giveOf(a);
    const receive = receiveOf(a);
    const surplus = hand[give] - need.cost[give];
    return (surplus > 0 ? surplus : -5) + (need.missing[receive] > 0 ? 3 : 0) + weights[receive] * 0.2;
  });
}

// ---------------------------------------------------------------------------
// Vertex and road bonuses (rivers, harbormaster, caravans)

/** Extra value of a settlement spot under the variants that reward where a building stands. */
export function vertexBonus(view: RedactedState, vertex: VertexId): number {
  let bonus = 0;
  const geo = boardGeometry(view.board);
  if (variantOn(view, "rivers")) {
    // docs/phase10.md §3: riverside buildings earn coins every turn (and dodge the Poor Settler).
    const riverEdges = (geo.vertexEdges[vertex] ?? []).filter((e) => view.board.rivers.includes(e)).length;
    bonus += 0.8 * riverEdges;
  }
  if (variantOn(view, "harbormaster") && view.board.ports.some((p) => p.vertices.includes(vertex))) {
    // docs/phase10.md §4: harbour points toward the Harbormaster (2 VP).
    bonus += 1.5;
  }
  if (variantOn(view, "caravans")) {
    // docs/phase10.md §6: spice is roughly a resource, and a track can start here.
    for (const h of geo.vertexHexes[vertex] ?? []) {
      if (!view.board.oases.includes(h)) continue;
      const token = view.board.hexes[h]?.token ?? null;
      if (token !== null) bonus += 0.3 * (PIPS[token] ?? 0);
    }
  }
  return bonus;
}

function riverRoadCount(view: RedactedState, playerId: string): number {
  return player(view, playerId).roads.filter((e) => view.board.rivers.includes(e)).length;
}

/** Slight preference for river edges once the bot is on the way to Bridge Builder, and for edges beside a caravan track. */
export function linkBonus(view: RedactedState, edge: EdgeId, playerId: string): number {
  let bonus = 0;
  if (variantOn(view, "rivers") && view.board.rivers.includes(edge)) {
    const mine = riverRoadCount(view, playerId);
    const holder = view.wayfarers?.rivers?.bridgeBuilder;
    if (mine >= 2 && holder?.playerId !== playerId) bonus += holder && holder.count >= mine + 1 ? 0.3 : 0.6;
  }
  const c = view.wayfarers?.caravans;
  if (variantOn(view, "caravans") && c) {
    const geo = boardGeometry(view.board);
    const [a, b] = geo.edgeVertices[edge] as readonly [VertexId, VertexId];
    const touchesTrack = c.tracks.some((t) => t.edges.some((e) => (geo.edgeVertices[e] ?? []).some((v) => v === a || v === b)));
    if (touchesTrack) bonus += 0.5; // double weight for Longest Road
  }
  return bonus;
}

/** Harbormaster: cities on harbour vertices count double toward the chip. */
export function cityBonus(view: RedactedState, vertex: VertexId): number {
  if (!variantOn(view, "harbormaster")) return 0;
  return view.board.ports.some((p) => p.vertices.includes(vertex)) ? 3 : 0;
}

/** Position terms for the hard bot's scoring: progress toward chips and stored variant currency. */
export function positionBonus(view: RedactedState, playerId: string): number {
  const w = view.wayfarers;
  if (!w) return 0;
  const p = player(view, playerId);
  let bonus = 0;
  if (w.harbormaster && w.harbormaster.playerId !== playerId) {
    const harbour = new Set(view.board.ports.flatMap((port) => [...port.vertices]));
    let points = 0;
    for (const v of p.settlements) if (harbour.has(v)) points += 1;
    for (const v of p.cities) if (harbour.has(v)) points += 2;
    bonus += points * 0.7;
  }
  if (w.rivers) {
    if (w.rivers.bridgeBuilder.playerId !== playerId) bonus += riverRoadCount(view, playerId) * 0.5;
    const geo = boardGeometry(view.board);
    const riverside = (v: VertexId) => (geo.vertexEdges[v] ?? []).some((e) => view.board.rivers.includes(e));
    let coinsPerTurn = 0;
    for (const v of p.settlements) if (riverside(v)) coinsPerTurn += 1;
    for (const v of p.cities) if (riverside(v)) coinsPerTurn += 2;
    bonus += coinsPerTurn * 0.5;
  }
  if (w.fishing) bonus += (w.fishing.fish[playerId] ?? 0) * 0.3;
  if (w.caravans) bonus += (w.caravans.spice[playerId] ?? 0) * 0.4;
  if (w.wagons) bonus += (w.wagons.wagons[playerId]?.cargo.length ?? 0) * 0.5;
  return bonus;
}

// ---------------------------------------------------------------------------
// Raiders (docs/phase10.md §5)

export const GUARD_COUNTER_THRESHOLD = 10;

/** Raider strength on a hex (1 per settlement, 2 per city; castle corners count nothing), as the engine counts it. */
export function hexStrength(view: RedactedState, hex: HexId): number {
  const r = view.wayfarers?.raiders;
  if (!r) return 0;
  const castles = new Set(Object.values(r.castles).filter((v): v is VertexId => v !== null));
  let n = 0;
  for (const v of boardGeometry(view.board).hexVertices[hex] ?? []) {
    if (castles.has(v)) continue;
    for (const p of view.players) {
      if (p.settlements.includes(v)) n += 1;
      if (p.cities.includes(v)) n += 2;
    }
  }
  return n;
}

/** Guards standing on a hex, whoever owns them. */
export function hexDefense(view: RedactedState, hex: HexId): number {
  const r = view.wayfarers?.raiders;
  if (!r) return 0;
  let n = 0;
  for (const guards of Object.values(r.guards)) for (const h of guards) if (h === hex) n += 1;
  return n;
}

/** Land hexes with at least one neighbour that is not land: where the raiders strike. */
export function isCoastal(view: RedactedState, hex: HexId): boolean {
  const geo = boardGeometry(view.board);
  return (geo.hexNeighbors[hex] ?? []).filter((n) => view.board.hexes[n] !== undefined).length < 6;
}

/** Rebuild raided hexes (1 VP for two cards, the bot's own producers first); post guards once the raiders are close. */
export function chooseRaidersAction(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const r = view.wayfarers?.raiders;
  if (!r) return null;
  const me = view.viewer;
  const rebuilds = ofType(legal, "REBUILD_HEX");
  if (rebuilds.length) return best(rng, rebuilds, (a) => hexValueFor(view, a.hex, me) * 2 + (PIPS[view.board.hexes[a.hex]?.token ?? 0] ?? 0));
  return chooseGuard(view, legal, rng);
}

/** A guard on the bot's most valuable coastal hex whose strength exceeds its defence, when the counter is at 10 or more. */
export function chooseGuard(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const r = view.wayfarers?.raiders;
  if (!r || r.counter < GUARD_COUNTER_THRESHOLD) return null;
  const me = view.viewer;
  const guards = ofType(legal, "BUILD_KNIGHT").filter((a) => a.hex !== undefined);
  if (guards.length === 0) return null;
  // Keep a settlement or city budget: a guard never eats into a build affordable right now.
  if (legal.some((a) => a.type === "BUILD_CITY" || a.type === "BUILD_SETTLEMENT")) return null;
  const exposed = guards.filter((a) => {
    const hex = a.hex as HexId;
    return isCoastal(view, hex) && hexStrength(view, hex) > hexDefense(view, hex) && hexValueFor(view, hex, me) > 0;
  });
  if (exposed.length === 0) return null;
  return best(rng, exposed, (a) => hexValueFor(view, a.hex as HexId, me) * 2 - (hexStrength(view, a.hex as HexId) - hexDefense(view, a.hex as HexId)));
}

// ---------------------------------------------------------------------------
// Caravans (docs/phase10.md §6)

/** Spice has no other use: extend whenever a caravan can be pulled onto one of the bot's roads. */
export function chooseCaravanExtend(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const extends_ = ofType(legal, "EXTEND_CARAVAN");
  if (extends_.length === 0) return null;
  const me = view.viewer;
  const p = meOf(view);
  const geo = boardGeometry(view.board);
  const mine = new Set(p.roads);
  const buildings = new Set([...p.settlements, ...p.cities]);
  return best(rng, extends_, (a) => {
    // Roads sharing a vertex with the track count double; buildings on its vertices get bonus production.
    const [x, y] = geo.edgeVertices[a.edge] as readonly [VertexId, VertexId];
    let s = 0;
    for (const v of [x, y]) {
      if (buildings.has(v)) s += 2;
      for (const e of geo.vertexEdges[v] ?? []) if (e !== a.edge && mine.has(e)) s += 1;
    }
    return s + longestRoadGain(view, a.edge, me);
  });
}

// ---------------------------------------------------------------------------
// Wagons (docs/phase10.md §7)

type MoveWagon = Extract<Action, { type: "MOVE_WAGON" }>;

/** Multi-source BFS over every player's roads: distance from each vertex to the nearest of `targets`. */
export function roadDistances(view: RedactedState, targets: Iterable<VertexId>): Map<VertexId, number> {
  const geo = boardGeometry(view.board);
  const roads = new Set(view.players.flatMap((p) => p.roads));
  const dist = new Map<VertexId, number>();
  const queue: VertexId[] = [];
  for (const t of targets) {
    if (dist.has(t)) continue;
    dist.set(t, 0);
    queue.push(t);
  }
  while (queue.length) {
    const v = queue.shift() as VertexId;
    const d = dist.get(v) as number;
    for (const e of geo.vertexEdges[v] ?? []) {
      if (!roads.has(e)) continue;
      const [a, b] = geo.edgeVertices[e] as readonly [VertexId, VertexId];
      const n = a === v ? b : a;
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

interface WagonPlan {
  /** Vertices worth reaching, with how much better a matching one is (subtracted from its distance). */
  readonly score: (vertex: VertexId) => number;
  /** Vertices where the wagon's business (a delivery or a load) can be done. */
  readonly done: Set<VertexId>;
}

function wagonPlan(view: RedactedState): WagonPlan | null {
  const w = view.wayfarers?.wagons;
  const me = view.viewer;
  const wagon = w?.wagons[me];
  if (!w || !wagon) return null;
  const opponentCities = view.players.filter((p) => p.id !== me).flatMap((p) => p.cities);
  if (wagon.cargo.length > 0) {
    // Deliver: opponent cities that did not supply the cargo; a matching demand is worth an extra point.
    const any = new Set<VertexId>();
    const match = new Set<VertexId>();
    for (const city of opponentCities) {
      const deliverable = wagon.cargo.filter((_, i) => wagon.cargoFrom[i] !== city);
      if (deliverable.length === 0) continue;
      any.add(city);
      const demand = w.demand[city];
      if (demand !== undefined && deliverable.includes(demand)) match.add(city);
    }
    if (any.size === 0) return null;
    const dAny = roadDistances(view, any);
    const dMatch = roadDistances(view, match);
    return {
      score: (v) => Math.min(dAny.get(v) ?? Infinity, (dMatch.get(v) ?? Infinity) - 1.5),
      done: any,
    };
  }
  // Load: cities with stock, preferring a good some opponent city demands.
  if (opponentCities.length === 0) return null;
  const demanded = new Set(opponentCities.map((c) => w.demand[c]).filter((g): g is WagonGood => g !== undefined));
  const stocked = new Set<VertexId>();
  const wanted = new Set<VertexId>();
  for (const [city, shelf] of Object.entries(w.stock)) {
    if (shelf.length === 0) continue;
    stocked.add(city);
    if (shelf.some((g) => demanded.has(g))) wanted.add(city);
  }
  if (stocked.size === 0) return null;
  const dStock = roadDistances(view, stocked);
  const dWanted = roadDistances(view, wanted);
  return {
    score: (v) => Math.min(dStock.get(v) ?? Infinity, (dWanted.get(v) ?? Infinity) - 1),
    done: stocked,
  };
}

/** Greedy nearest-delivery planner: deliver, load, or move toward the nearest useful city. */
export function chooseWagonAction(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const w = view.wayfarers?.wagons;
  const me = view.viewer;
  const wagon = w?.wagons[me];
  if (!w || !wagon) return null;

  const deliveries = ofType(legal, "DELIVER");
  if (deliveries.length) {
    const demand = w.demand[wagon.at];
    return best(rng, deliveries, (a) => (a.good === demand ? 1 : 0));
  }

  const loads = ofType(legal, "LOAD_COMMODITY");
  if (loads.length) {
    const opponentCities = view.players.filter((p) => p.id !== me).flatMap((p) => p.cities);
    const demanded = new Set(opponentCities.map((c) => w.demand[c]));
    // Load only what can still be delivered somewhere (a good is never delivered back to its source).
    const deliverable = opponentCities.some((c) => c !== wagon.at);
    if (deliverable) return best(rng, loads, (a) => (demanded.has(a.good) ? 1 : 0));
  }

  const moves = ofType(legal, "MOVE_WAGON");
  if (moves.length === 0) return null;
  const plan = wagonPlan(view);
  if (!plan) return null;
  const here = plan.score(wagon.at);
  const end = (m: MoveWagon): VertexId => m.path[m.path.length - 1] as VertexId;
  const candidates = moves.filter((m) => {
    const to = end(m);
    // Grain and tolls are worth paying only when the step finishes the job this turn.
    if ((m.grain ?? 0) > 0 || m.toll !== undefined) return plan.done.has(to);
    return true;
  });
  if (candidates.length === 0) return null;
  const chosen = best(rng, candidates, (m) => -plan.score(end(m)) - (m.path.length - 1) * 0.01);
  return plan.score(end(chosen)) < here ? chosen : null;
}

// ---------------------------------------------------------------------------
// Turn hooks used by the levels

/** Free or clearly profitable variant actions to take before the base build logic. */
export function wayfarersBeforeBuild(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!view.wayfarers) return null;
  return chooseFishSpend(view, legal, rng) ?? chooseCaravanExtend(view, legal, rng) ?? rebuildOnly(view, legal, rng) ?? deliverOrLoad(view, legal, rng);
}

/** Variant actions that compete with roads and purchases: guards, wagon moves, a boot-passing offer. */
export function wayfarersAfterBuild(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!view.wayfarers) return null;
  return chooseGuard(view, legal, rng) ?? chooseWagonAction(view, legal, rng) ?? chooseBootOffer(view, legal, rng);
}

function rebuildOnly(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const rebuilds = ofType(legal, "REBUILD_HEX");
  if (rebuilds.length === 0) return null;
  return chooseRaidersAction(view, legal, rng);
}

function deliverOrLoad(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!legal.some((a) => a.type === "DELIVER" || a.type === "LOAD_COMMODITY")) return null;
  return chooseWagonAction(view, legal, rng);
}
