/**
 * Crown & Castle heuristics (docs/phase11.md §10, docs/specs/phase11-spec.md
 * §10). Everything here reads only the redacted view (public module state
 * under `view.crown` plus the bot's own hand, commodities and progress cards)
 * and chooses from the legal list; the base levels call in at marked points:
 *
 * - `crownDiscard`: a DISCARD that keeps the primary track's commodities.
 * - `crownBeforeRoll`: the one card allowed before the roll (Warlord when the
 *   fleet is about to land, the Alchemist on a good number, Saboteur / Wedding
 *   when trailing).
 * - `crownBeforeBuild`: urgent defence (activate / build / promote when the
 *   fleet is within two steps and the bot's share is short), free progress
 *   cards with a clear payoff, robber chases and road-breaking knight moves.
 * - `crownBuild`: improvements per the plan, knights when short, activation,
 *   commodity maritime trades that complete a build or an improvement,
 *   promotions and walls from spare cards.
 * - `chooseCrownPrompt`: every crown prompt kind.
 * - `improvementPlan`, `defence`, `fleetRisk`, `crownCityBonus`,
 *   `crownPositionBonus`, `usefulCommodityTrades`: shared with the levels'
 *   scoring (the hard bot folds the build actions into its lookahead).
 */

import {
  COMMODITIES,
  FLEET_STEPS,
  MAX_LEVEL,
  METROPOLIS_LEVEL,
  RESOURCES,
  TERRAIN_RESOURCE,
  TRACKS,
  TRACK_COMMODITY,
  applyAction,
  isHiddenProgress,
  isRuleError,
  viewToState,
  type Action,
  type Commodity,
  type CommodityHand,
  type GameState,
  type Hand,
  type HexId,
  type ProgressCard,
  type RedactedCrown,
  type RedactedCrownPlayer,
  type Resource,
  type Terrain,
  type Track,
  type VertexId,
} from "@katan/engine";
import { PIPS, cardCount, geo, handTotal, hexValueFor, hexValueForOpponents, hexesOf, me as meOf, myHand, player, productionOf, publicVP, rawPipCount, resourceNeed, settlementCandidates, threat } from "./eval";
import { best, ensureLegal, ofType, pick, type RedactedState, type Rng } from "./types";

type Play = Extract<Action, { type: "PLAY_PROGRESS" }>;
type Trade = Extract<Action, { type: "MARITIME_TRADE" }>;

const TERRAIN_TRACK: Readonly<Partial<Record<Terrain, Track>>> = { meadow: "trade", mountain: "politics", forest: "science" };

export function crownOf(view: RedactedState): RedactedCrown | null {
  return view.crown;
}

function crownPlayerOf(view: RedactedState, playerId: string): RedactedCrownPlayer | null {
  return view.crown?.players[playerId] ?? null;
}

function emptyCommodities(): CommodityHand {
  return { cloth: 0, coin: 0, paper: 0 };
}

function commodityTotal(c: CommodityHand): number {
  return c.cloth + c.coin + c.paper;
}

/** The bot's own commodities (public, but only its own matter for spending). */
export function myCommodities(view: RedactedState): CommodityHand {
  return crownPlayerOf(view, view.viewer)?.commodities ?? emptyCommodities();
}

/** Progress cards the bot holds face down. */
export function myProgress(view: RedactedState): ProgressCard[] {
  const cp = crownPlayerOf(view, view.viewer);
  if (!cp || isHiddenProgress(cp.progress)) return [];
  return cp.progress.filter((c) => !c.revealed).map((c) => c.card);
}

/** Resources plus commodities: what a seven or a Saboteur counts. */
export function fullCardCount(view: RedactedState, playerId: string): number {
  return cardCount(player(view, playerId)) + commodityTotal(crownPlayerOf(view, playerId)?.commodities ?? emptyCommodities());
}

/** Opponents with more victory points than the bot (Saboteur, Wedding, Master Merchant targets). */
export function richerOpponents(view: RedactedState): string[] {
  const mine = publicVP(meOf(view));
  return view.players.filter((p) => p.id !== view.viewer && publicVP(p) > mine).map((p) => p.id);
}

function simulate(view: RedactedState, action: Action): GameState | null {
  try {
    return applyAction(viewToState(view), action);
  } catch (err) {
    if (isRuleError(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Improvement plan (§3, §7)

/** Expected commodity pips per track: cities on meadow / mountain / forest count fully, settlements (future cities) at 0.4. */
export function commodityIncome(view: RedactedState, playerId: string): Record<Track, number> {
  const p = player(view, playerId);
  const g = geo(view);
  const out: Record<Track, number> = { trade: 0, politics: 0, science: 0 };
  const add = (v: VertexId, mult: number) => {
    for (const h of g.vertexHexes[v] ?? []) {
      const tile = view.board.hexes[h];
      if (!tile || tile.token === null) continue;
      const track = TERRAIN_TRACK[tile.terrain];
      if (track) out[track] += (PIPS[tile.token] ?? 0) * mult;
    }
  };
  for (const v of p.cities) add(v, 1);
  for (const v of p.settlements) add(v, 0.4);
  return out;
}

export interface ImprovementPlan {
  readonly primary: Track;
  readonly secondary: Track;
  /** The level the bot is working toward on each track. */
  readonly goals: Record<Track, number>;
}

const TRACK_BIAS: Readonly<Record<Track, number>> = { trade: 0, politics: 0.2, science: 0.3 };

/**
 * Primary track by commodity income plus holdings and levels already bought;
 * aim for level 3 (the ability), then 4 for the metropolis when nobody else
 * is at 4 or more, 5 when a level-4 holder can be overtaken or the bot's own
 * metropolis needs locking; the second track aims for 3.
 */
export function improvementPlan(view: RedactedState, playerId: string): ImprovementPlan {
  const crown = crownOf(view);
  const cp = crownPlayerOf(view, playerId);
  const income = commodityIncome(view, playerId);
  const holdings = cp?.commodities ?? emptyCommodities();
  const levels = cp?.tracks ?? { trade: 0, politics: 0, science: 0 };
  const score = (t: Track) => income[t] + holdings[TRACK_COMMODITY[t]] * 0.5 + levels[t] * 1.0 + TRACK_BIAS[t];
  const ordered = [...TRACKS].sort((a, b) => score(b) - score(a));
  const primary = ordered[0] as Track;
  const secondary = ordered[1] as Track;
  const goals: Record<Track, number> = { trade: 1, politics: 1, science: 1 };
  for (const t of TRACKS) {
    const level = levels[t];
    const base = t === primary || t === secondary ? 3 : 1;
    let goal = base;
    if (t === primary || level >= 3) {
      const holder = crown?.metropolis[t] ?? null;
      const opponentMax = Math.max(0, ...view.players.filter((p) => p.id !== playerId).map((p) => crown?.players[p.id]?.tracks[t] ?? 0));
      if (holder === null && opponentMax < METROPOLIS_LEVEL) goal = METROPOLIS_LEVEL;
      else if (holder === playerId) goal = opponentMax >= METROPOLIS_LEVEL ? MAX_LEVEL : METROPOLIS_LEVEL;
      else if (holder !== null && (crown?.players[holder]?.tracks[t] ?? 0) < MAX_LEVEL) goal = MAX_LEVEL;
      else goal = 3;
    }
    goals[t] = Math.max(goal, base);
  }
  return { primary, secondary, goals };
}

function wantsMore(view: RedactedState, plan: ImprovementPlan, track: Track): boolean {
  const level = crownPlayerOf(view, view.viewer)?.tracks[track] ?? 0;
  return level < plan.goals[track];
}

/** Cost of the next level on a track (a crane makes it one less, never below 1). */
function nextCost(view: RedactedState, track: Track): number {
  const cp = crownPlayerOf(view, view.viewer);
  if (!cp) return Infinity;
  const next = cp.tracks[track] + 1;
  return cp.crane ? Math.max(1, next - 1) : next;
}

/** Commodity pips a city at `vertex` would yield, weighted toward the primary track. */
export function crownCityBonus(view: RedactedState, vertex: VertexId, playerId: string): number {
  if (!crownOf(view)) return 0;
  const plan = improvementPlan(view, playerId);
  let bonus = 0;
  for (const h of geo(view).vertexHexes[vertex] ?? []) {
    const tile = view.board.hexes[h];
    if (!tile || tile.token === null) continue;
    const track = TERRAIN_TRACK[tile.terrain];
    if (!track) continue;
    bonus += (PIPS[tile.token] ?? 0) * (track === plan.primary ? 0.6 : 0.3);
  }
  return bonus;
}

// ---------------------------------------------------------------------------
// Fleet and knights (§5, §6)

export interface Defence {
  /** Sum of the levels of the bot's active knights. */
  readonly active: number;
  /** Sum of the levels of its inactive knights. */
  readonly inactive: number;
  /** ceil(cities / players), at least 1 once any city stands. */
  readonly fair: number;
  readonly fleet: number;
  /** Expected rolls until the attack: (7 - fleet) / (3/6). */
  readonly rolls: number;
  /** Weight for defence terms: 3 within two rolls, tapering to 0.4 far away. */
  readonly risk: number;
  /** Active defence missing against the fair share (0 when covered). */
  readonly short: number;
  /** Does the bot have a city the barbarians could sack? */
  readonly exposed: boolean;
}

export function fleetRisk(view: RedactedState): { fleet: number; rolls: number; risk: number } {
  const fleet = crownOf(view)?.fleet ?? 0;
  const rolls = (FLEET_STEPS - fleet) * 2;
  const risk = rolls <= 2 ? 3 : rolls <= 4 ? 1.8 : rolls <= 8 ? 0.9 : 0.4;
  return { fleet, rolls, risk };
}

export function defence(view: RedactedState, playerId: string): Defence {
  const crown = crownOf(view);
  const { fleet, rolls, risk } = fleetRisk(view);
  let active = 0;
  let inactive = 0;
  for (const k of crown?.knights ?? []) {
    if (k.owner !== playerId) continue;
    if (k.active) active += k.level;
    else inactive += k.level;
  }
  const cities = view.players.reduce((n, p) => n + p.cities.length, 0);
  const fair = cities === 0 ? 0 : Math.max(1, Math.ceil(cities / view.players.length));
  const cp = crownPlayerOf(view, playerId);
  const metropolises = new Set(Object.values(cp?.metropolises ?? {}).filter((v): v is VertexId => v !== null));
  const exposed = player(view, playerId).cities.some((v) => !metropolises.has(v));
  return { active, inactive, fair, fleet, rolls, risk, short: Math.max(0, fair - active), exposed };
}

function knightAt(view: RedactedState, vertex: VertexId) {
  return crownOf(view)?.knights.find((k) => k.at === vertex) ?? null;
}

/** Vertices touched by a player's roads and ships. */
function roadVertices(view: RedactedState, playerId: string): Set<VertexId> {
  const g = geo(view);
  const p = player(view, playerId);
  const out = new Set<VertexId>();
  for (const e of [...p.roads, ...p.ships]) for (const v of g.edgeVertices[e] ?? []) out.add(v);
  return out;
}

/** Where a knight is worth standing: beside the bot's best hexes (chases), on the Longest Road holder's road, never on an own settlement spot. */
export function knightSpotScore(view: RedactedState, vertex: VertexId, playerId: string, ownSpots: ReadonlySet<VertexId>): number {
  let score = 0;
  for (const h of geo(view).vertexHexes[vertex] ?? []) score += hexValueFor(view, h, playerId) * 0.3;
  const holder = view.longestRoad.playerId;
  if (holder !== null && holder !== playerId && roadVertices(view, holder).has(vertex)) score += 1.5;
  if (ownSpots.has(vertex)) score -= 3;
  return score;
}

function bestKnightVertex<T extends { vertex: VertexId | null }>(view: RedactedState, options: readonly T[], rng: Rng): T | null {
  const placeable = options.filter((o): o is T & { vertex: VertexId } => o.vertex !== null);
  if (placeable.length === 0) return null;
  const spots = new Set(settlementCandidates(view, view.viewer));
  return best(rng, placeable, (o) => knightSpotScore(view, o.vertex, view.viewer, spots));
}

/** Does `action` (a knight move, displacement or Diplomat) take the Longest Road away from an opponent? */
function breaksLongestRoad(view: RedactedState, action: Action): boolean {
  const holder = view.longestRoad.playerId;
  if (holder === null || holder === view.viewer) return false;
  const next = simulate(view, action);
  return next !== null && next.longestRoad.playerId !== holder;
}

// ---------------------------------------------------------------------------
// Progress cards (§4)

const CARD_VALUE: Readonly<Record<ProgressCard, number>> = {
  constitution: 100,
  printer: 100,
  warlord: 8,
  saboteur: 6,
  wedding: 6,
  masterMerchant: 6,
  resourceMonopoly: 6,
  medicine: 6,
  merchant: 5,
  spy: 5,
  deserter: 5,
  bishop: 5,
  smith: 5,
  alchemist: 5,
  tradeMonopoly: 4,
  crane: 4,
  irrigation: 4,
  mining: 4,
  roadBuilding: 4,
  engineer: 3,
  inventor: 3,
  merchantFleet: 3,
  commercialHarbor: 3,
  diplomat: 3,
  intrigue: 3,
};

function touchedTerrain(view: RedactedState, playerId: string, terrain: Terrain): number {
  let n = 0;
  for (const h of hexesOf(view, playerId)) if (view.board.hexes[h]?.terrain === terrain) n += 1;
  return n;
}

/** How useful a progress card is to the bot right now (keep the highest; the Spy takes the highest). */
export function progressCardValue(view: RedactedState, card: ProgressCard): number {
  const me = view.viewer;
  const p = meOf(view);
  const knights = (crownOf(view)?.knights ?? []).filter((k) => k.owner === me);
  let v = CARD_VALUE[card];
  switch (card) {
    case "warlord":
    case "smith":
      if (knights.length === 0) v = 1;
      break;
    case "medicine":
      if (p.settlements.length === 0 || p.pieces.cities === 0) v = 1;
      break;
    case "engineer":
      if (p.cities.length === 0) v = 1;
      break;
    case "irrigation":
      v = touchedTerrain(view, me, "farmland") * 2.5;
      break;
    case "mining":
      v = touchedTerrain(view, me, "mountain") * 2.5;
      break;
    case "saboteur":
    case "wedding":
      if (richerOpponents(view).length === 0) v = 2;
      break;
    default:
      break;
  }
  return v;
}

function playsOf(legal: Action[], card: ProgressCard): Play[] {
  return ofType(legal, "PLAY_PROGRESS").filter((a) => a.card === card);
}

interface ScoredPlay {
  readonly action: Action;
  readonly score: number;
}

/** Expected own cards for a given dice total (settlements 1, cities 2; the robber's hex yields nothing). */
function yieldForTotal(view: RedactedState, playerId: string, total: number): number {
  const p = player(view, playerId);
  const g = geo(view);
  let n = 0;
  for (const [h, tile] of Object.entries(view.board.hexes)) {
    if (tile.token !== total || h === view.robberHex || TERRAIN_RESOURCE[tile.terrain] === null) continue;
    for (const v of g.hexVertices[h] ?? []) {
      if (p.settlements.includes(v)) n += 1;
      if (p.cities.includes(v)) n += 2;
    }
  }
  return n;
}

/** The Alchemist: the total with the highest own yield, the red die chosen for progress draws (§2). */
function alchemistPlay(view: RedactedState, legal: Action[]): ScoredPlay | null {
  const plays = playsOf(legal, "alchemist");
  if (plays.length === 0) return null;
  const me = view.viewer;
  const crown = crownOf(view);
  let bestTotal = 8;
  let bestYield = -Infinity;
  for (let total = 2; total <= 12; total++) {
    if (total === 7) continue;
    const y = yieldForTotal(view, me, total) - 0.3 * view.players.filter((p) => p.id !== me).reduce((n, p) => n + yieldForTotal(view, p.id, total), 0);
    if (y > bestYield + 1e-9) {
      bestYield = y;
      bestTotal = total;
    }
  }
  const mine = crown?.players[me]?.tracks ?? { trade: 0, politics: 0, science: 0 };
  const opponents = view.players.filter((p) => p.id !== me).map((p) => crown?.players[p.id]?.tracks ?? { trade: 0, politics: 0, science: 0 });
  let bestRed = Math.max(1, bestTotal - 6);
  let bestRedScore = -Infinity;
  for (let red = Math.max(1, bestTotal - 6); red <= Math.min(6, bestTotal - 1); red++) {
    let s = 0;
    if (red >= 2) {
      for (const t of TRACKS) {
        if (mine[t] >= red - 1) s += 1 / 6;
        for (const o of opponents) if (o[t] >= red - 1) s -= 0.4 / 6;
      }
    }
    if (s > bestRedScore + 1e-9) {
      bestRedScore = s;
      bestRed = red;
    }
  }
  const white = bestTotal - bestRed;
  const action = plays.find((a) => a.payload?.dice?.[0] === bestRed && a.payload?.dice?.[1] === white);
  if (!action) return null;
  const own = yieldForTotal(view, me, bestTotal);
  const score = own >= 2 ? 4 + own : myProgress(view).length >= 4 ? 1 : -1;
  return { action, score };
}

/** The best hex for the robber from the bot's point of view (Bishop, chases): hurts the leader, never itself. */
function robberTargetScore(view: RedactedState, hex: HexId): number {
  const me = view.viewer;
  if (hexesOf(view, me).has(hex)) return -100;
  const leader = threat(view).leader?.id ?? null;
  return (leader ? hexValueFor(view, hex, leader) * 3 : 0) + hexValueForOpponents(view, hex);
}

/** Opponents' expected holdings of a resource: their card counts spread by their production. */
function opponentsExpected(view: RedactedState, resource: Resource): number {
  let n = 0;
  for (const p of view.players) {
    if (p.id === view.viewer) continue;
    const prod = productionOf(view, p.id);
    const total = handTotal(prod) || 1;
    n += Math.min(2, (cardCount(p) * prod[resource]) / total);
  }
  return n;
}

function scorePlay(view: RedactedState, legal: Action[], rng: Rng, card: ProgressCard): ScoredPlay | null {
  const plays = playsOf(legal, card);
  if (plays.length === 0) return null;
  const me = view.viewer;
  const p = meOf(view);
  const hand = myHand(view);
  const need = resourceNeed(view, me);
  const d = defence(view, me);
  const plan = improvementPlan(view, me);
  const commodities = myCommodities(view);
  const first = plays[0] as Play;
  const byPayload = (score: (a: Play) => number): Play => best(rng, plays, score);
  switch (card) {
    case "alchemist":
      return alchemistPlay(view, legal);
    case "warlord": {
      if (d.inactive === 0) return { action: first, score: -1 };
      const score = d.fleet >= 6 ? 10 : d.fleet >= 5 && d.short > 0 ? 8 : d.fleet >= 4 && d.short > 0 ? 3 : -1;
      return { action: first, score };
    }
    case "smith":
      return { action: byPayload((a) => a.payload?.vertices?.length ?? 0), score: 4 };
    case "engineer":
      return { action: byPayload((a) => rawPipCount(view, a.payload?.vertex ?? "")), score: 3 };
    case "medicine":
      return { action: byPayload((a) => rawPipCount(view, a.payload?.vertex ?? "") + crownCityBonus(view, a.payload?.vertex ?? "", me)), score: 6 };
    case "crane": {
      const ready = p.cities.length > 0 && TRACKS.some((t) => (crownPlayerOf(view, me)?.tracks[t] ?? 0) < MAX_LEVEL && commodities[TRACK_COMMODITY[t]] >= Math.max(1, nextCost(view, t) - 1));
      return { action: first, score: ready ? 3 : -1 };
    }
    case "irrigation":
    case "mining": {
      const resource: Resource = card === "irrigation" ? "grain" : "ore";
      const yield_ = Math.min(2 * touchedTerrain(view, me, card === "irrigation" ? "farmland" : "mountain"), view.bank[resource]);
      if (yield_ < 2) return { action: first, score: -1 };
      const limit = 7 + 2 * (crownPlayerOf(view, me)?.walls.length ?? 0);
      const overflow = fullCardCount(view, me) + yield_ > limit && need.missing[resource] === 0;
      return { action: first, score: yield_ + (need.missing[resource] > 0 ? 3 : 0) - (overflow ? 4 : 0) };
    }
    case "masterMerchant":
      return { action: byPayload((a) => fullCardCount(view, a.payload?.targetPlayerId ?? "") + (a.payload?.targetPlayerId === threat(view).leader?.id ? 5 : 0)), score: 5 };
    case "spy": {
      const count = (id: string) => {
        const cp = crownPlayerOf(view, id);
        return cp && isHiddenProgress(cp.progress) ? cp.progress.count - cp.progress.revealed.length : 0;
      };
      return { action: byPayload((a) => count(a.payload?.targetPlayerId ?? "") + (a.payload?.targetPlayerId === threat(view).leader?.id ? 2 : 0)), score: 4 };
    }
    case "saboteur": {
      const richer = richerOpponents(view);
      const cards = richer.reduce((n, id) => n + fullCardCount(view, id), 0);
      return { action: first, score: richer.length > 0 && cards >= 6 ? 5 : -1 };
    }
    case "wedding": {
      const richer = richerOpponents(view);
      const cards = richer.reduce((n, id) => n + Math.min(2, fullCardCount(view, id)), 0);
      return { action: first, score: cards >= 2 ? 5 : -1 };
    }
    case "resourceMonopoly": {
      const action = byPayload((a) => opponentsExpected(view, a.payload?.resource ?? "wood") + (need.missing[a.payload?.resource ?? "wood"] > 0 ? 2 : 0));
      const r = action.payload?.resource ?? "wood";
      const est = opponentsExpected(view, r);
      return { action, score: est >= 2 || (est >= 1 && need.missing[r] > 0) ? est * 1.5 + (need.missing[r] > 0 ? 2 : 0) : -1 };
    }
    case "tradeMonopoly": {
      const taken = (c: Commodity) => view.players.filter((x) => x.id !== me).reduce((n, x) => n + Math.min(1, crownPlayerOf(view, x.id)?.commodities[c] ?? 0), 0);
      const track = (c: Commodity) => TRACKS.find((t) => TRACK_COMMODITY[t] === c) as Track;
      const action = byPayload((a) => {
        const c = a.payload?.commodity ?? "cloth";
        return taken(c) + (wantsMore(view, plan, track(c)) ? 1 : 0) + (track(c) === plan.primary ? 0.5 : 0);
      });
      const c = action.payload?.commodity ?? "cloth";
      const n = taken(c);
      const completes = n >= 1 && commodities[c] < nextCost(view, track(c)) && commodities[c] + n >= nextCost(view, track(c)) && p.cities.length > 0;
      return { action, score: n >= 2 || completes ? n * 1.5 + (completes ? 2 : 0) : -1 };
    }
    case "bishop": {
      const victims = (hex: HexId) => view.players.filter((x) => x.id !== me && (geo(view).hexVertices[hex] ?? []).some((v) => x.settlements.includes(v) || x.cities.includes(v))).length;
      const action = byPayload((a) => robberTargetScore(view, a.payload?.hex ?? "") + victims(a.payload?.hex ?? "") * 2);
      const hex = action.payload?.hex ?? "";
      if (robberTargetScore(view, hex) < 0) return { action, score: -1 };
      return { action, score: 2 + (hexValueFor(view, view.robberHex, me) > 0 ? 4 : 0) + victims(hex) };
    }
    case "deserter": {
      const bestLevel = (id: string) => Math.max(0, ...(crownOf(view)?.knights ?? []).filter((k) => k.owner === id).map((k) => k.level));
      const action = byPayload((a) => bestLevel(a.payload?.targetPlayerId ?? "") + (a.payload?.targetPlayerId === threat(view).leader?.id ? 1 : 0));
      return { action, score: 3 + bestLevel(action.payload?.targetPlayerId ?? "") };
    }
    case "intrigue": {
      const action = byPayload((a) => {
        const k = knightAt(view, a.payload?.vertex ?? "");
        return (k?.level ?? 0) + (k?.owner === threat(view).leader?.id ? 1 : 0) + (k?.owner === view.longestRoad.playerId ? 1 : 0);
      });
      return { action, score: 3 + (knightAt(view, action.payload?.vertex ?? "")?.level ?? 0) };
    }
    case "diplomat": {
      const holder = view.longestRoad.playerId;
      if (holder === null || holder === me) return { action: first, score: -1 };
      const holderRoads = new Set(player(view, holder).roads);
      for (const a of plays) {
        if (a.payload?.relocateTo !== undefined || !holderRoads.has(a.payload?.edge ?? "")) continue;
        if (breaksLongestRoad(view, a)) return { action: a, score: 8 };
      }
      return { action: first, score: -1 };
    }
    case "inventor": {
      const mult = (hex: HexId, id: string) => {
        const x = player(view, id);
        let m = 0;
        for (const v of geo(view).hexVertices[hex] ?? []) {
          if (x.settlements.includes(v)) m += 1;
          if (x.cities.includes(v)) m += 2;
        }
        return m;
      };
      const gain = (a: Play) => {
        const [h1, h2] = a.payload?.hexes ?? ["", ""];
        const t1 = PIPS[view.board.hexes[h1]?.token ?? 0] ?? 0;
        const t2 = PIPS[view.board.hexes[h2]?.token ?? 0] ?? 0;
        const leader = threat(view).leader?.id ?? null;
        const own = (t2 - t1) * mult(h1, me) + (t1 - t2) * mult(h2, me);
        const theirs = leader ? (t2 - t1) * mult(h1, leader) + (t1 - t2) * mult(h2, leader) : 0;
        return own - 0.5 * theirs;
      };
      const action = byPayload(gain);
      const g = gain(action);
      return { action, score: g >= 2 ? g * 1.5 : -1 };
    }
    case "merchant": {
      const ports = new Set(view.board.ports.filter((port) => port.vertices.some((v) => p.settlements.includes(v) || p.cities.includes(v))).map((port) => port.kind));
      const action = byPayload((a) => {
        const hex = a.payload?.hex ?? "";
        const r = TERRAIN_RESOURCE[view.board.hexes[hex]?.terrain ?? "wasteland"];
        return hexValueFor(view, hex, me) + (r !== null && !ports.has(r) ? 1 : 0);
      });
      return { action, score: 6 };
    }
    case "roadBuilding": {
      const lr = view.longestRoad.playerId !== me && p.roads.length + 2 >= Math.max(5, view.longestRoad.length + 1);
      const stuck = settlementCandidates(view, me).length === 0 && p.pieces.settlements > 0;
      return { action: first, score: lr ? 6 : stuck ? 3 : -1 };
    }
    case "merchantFleet": {
      if (handTotal(need.missing) === 0) return { action: first, score: -1 };
      const ports = new Set(view.board.ports.filter((port) => port.vertices.some((v) => p.settlements.includes(v) || p.cities.includes(v))).map((port) => port.kind));
      const surplus = (c: Resource | Commodity): number => {
        if ((RESOURCES as readonly string[]).includes(c)) {
          const r = c as Resource;
          return ports.has(r) ? -1 : hand[r] - need.cost[r];
        }
        const track = TRACKS.find((t) => TRACK_COMMODITY[t] === c) as Track;
        return (crownPlayerOf(view, me)?.tracks.trade ?? 0) >= 3 ? -1 : commodities[c as Commodity] - (wantsMore(view, plan, track) ? nextCost(view, track) : 0);
      };
      const action = byPayload((a) => surplus(a.payload?.card ?? "wood"));
      return { action, score: surplus(action.payload?.card ?? "wood") >= 2 ? 3 : -1 };
    }
    case "commercialHarbor": {
      const victims = view.players.filter((x) => x.id !== me && commodityTotal(crownPlayerOf(view, x.id)?.commodities ?? emptyCommodities()) >= 1).length;
      const action = byPayload((a) => hand[a.payload?.resource ?? "wood"] - need.cost[a.payload?.resource ?? "wood"]);
      const r = action.payload?.resource ?? "wood";
      return { action, score: victims >= 1 && hand[r] - need.cost[r] >= 1 ? 2 + victims : -1 };
    }
    case "constitution":
    case "printer":
      return null;
    default: {
      const exhaustive: never = card;
      throw new Error(`unknown progress card ${String(exhaustive)}`);
    }
  }
}

/** The progress card play with the best positive score in the current phase, or null to hold. */
export function chooseProgressPlay(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const cards = new Set(ofType(legal, "PLAY_PROGRESS").map((a) => a.card));
  let top: ScoredPlay | null = null;
  for (const card of cards) {
    const scored = scorePlay(view, legal, rng, card);
    if (scored && scored.score > 0 && (!top || scored.score > top.score)) top = scored;
  }
  return top ? top.action : null;
}

// ---------------------------------------------------------------------------
// Turn hooks

/** Roll phase: the one card allowed before rolling (Warlord first when the fleet is about to land). */
export function crownBeforeRoll(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!crownOf(view)) return null;
  const d = defence(view, view.viewer);
  if (d.fleet >= 6 && d.inactive > 0) {
    const warlord = playsOf(legal, "warlord")[0];
    if (warlord) return warlord;
  }
  return chooseProgressPlay(view, legal, rng);
}

/** The knight to activate: the highest level first (most defence per grain). */
function chooseActivate(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const activations = ofType(legal, "ACTIVATE_KNIGHT");
  if (activations.length === 0) return null;
  return best(rng, activations, (a) => knightAt(view, a.vertex)?.level ?? 0);
}

/** The knight to promote: an active one first (defence now), then the lowest level. */
function choosePromote(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const promotions = ofType(legal, "PROMOTE_KNIGHT");
  if (promotions.length === 0) return null;
  return best(rng, promotions, (a) => {
    const k = knightAt(view, a.vertex);
    return (k?.active ? 2 : 0) - (k?.level ?? 0);
  });
}

function chooseBuildKnight(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const builds = ofType(legal, "BUILD_KNIGHT").filter((a) => a.vertex !== undefined);
  return bestKnightVertex(view, builds.map((a) => ({ a, vertex: a.vertex ?? null })), rng)?.a ?? null;
}

/**
 * Before the base build logic: urgent defence when the fleet is within two
 * steps and the fair share is short, then free progress cards with a clear
 * payoff, then knight actions that cost nothing (chase the robber off an own
 * hex, break the Longest Road).
 */
export function crownBeforeBuild(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!crownOf(view)) return null;
  const me = view.viewer;
  const d = defence(view, me);

  if (d.fleet >= 5 && d.short > 0) {
    const activate = chooseActivate(view, legal, rng);
    if (activate) return activate;
    const warlord = d.inactive > 0 ? playsOf(legal, "warlord")[0] : undefined;
    if (warlord) return warlord;
    if (d.active + d.inactive === 0) {
      const build = chooseBuildKnight(view, legal, rng);
      if (build) return build;
    }
    const promotions = ofType(legal, "PROMOTE_KNIGHT").filter((a) => knightAt(view, a.vertex)?.active === true);
    if (promotions.length) return best(rng, promotions, (a) => -(knightAt(view, a.vertex)?.level ?? 0));
  }

  const play = chooseProgressPlay(view, legal, rng);
  if (play) return play;

  // Chase the robber off an own producing hex when the knight's defence is not needed right away.
  const chases = ofType(legal, "KNIGHT_CHASE_ROBBER");
  if (chases.length && hexValueFor(view, view.robberHex, me) >= 2) {
    const safe = chases.filter((a) => d.fleet <= 3 || d.active - (knightAt(view, a.vertex)?.level ?? 0) >= d.fair);
    if (safe.length) return best(rng, safe, (a) => -(knightAt(view, a.vertex)?.level ?? 0));
  }

  // Displace or move onto the Longest Road holder's road only when it actually breaks the road.
  const holder = view.longestRoad.playerId;
  if (holder !== null && holder !== me) {
    const holderVertices = roadVertices(view, holder);
    type KnightStep = Extract<Action, { type: "KNIGHT_DISPLACE" | "KNIGHT_MOVE" }>;
    const knightMoves: KnightStep[] = [...ofType(legal, "KNIGHT_DISPLACE"), ...ofType(legal, "KNIGHT_MOVE")].filter((a) => holderVertices.has(a.to));
    for (const a of knightMoves) {
      const mover = knightAt(view, a.from);
      const safe = d.fleet <= 3 || d.active - (mover?.level ?? 0) >= d.fair;
      if (safe && breaksLongestRoad(view, a)) return a;
    }
  }
  return null;
}

/** The improvement to build now: tracks below their goal first, the primary track first, then the cheapest level. */
export function chooseImprovement(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const builds = ofType(legal, "BUILD_IMPROVEMENT");
  if (builds.length === 0) return null;
  const plan = improvementPlan(view, view.viewer);
  const cp = crownPlayerOf(view, view.viewer);
  return best(rng, builds, (a) => (wantsMore(view, plan, a.track) ? 10 : 0) + (a.track === plan.primary ? 5 : a.track === plan.secondary ? 2 : 0) - (cp?.tracks[a.track] ?? 0));
}

/** Commodity maritime trades that complete the next build (commodity → missing resource) or an improvement (spare resource → commodity). */
export function usefulCommodityTrades(view: RedactedState, legal: Action[]): Trade[] {
  if (!crownOf(view)) return [];
  const me = view.viewer;
  const hand = myHand(view);
  const need = resourceNeed(view, me);
  const plan = improvementPlan(view, me);
  const commodities = myCommodities(view);
  const trackOf = (c: Commodity) => TRACKS.find((t) => TRACK_COMMODITY[t] === c) as Track;
  const isCommodity = (c: string): c is Commodity => (COMMODITIES as readonly string[]).includes(c);
  const out: Trade[] = [];
  for (const a of ofType(legal, "MARITIME_TRADE")) {
    if (isCommodity(a.give)) {
      if (isCommodity(a.receive)) continue;
      if (need.missing[a.receive] === 0 || handTotal(need.missing) > 2) continue;
      const track = trackOf(a.give);
      // Never delay a wanted improvement: keep what the next level costs unless the ability is already bought.
      const level = crownPlayerOf(view, me)?.tracks[track] ?? 0;
      const spare = !wantsMore(view, plan, track) || level >= 3 || commodities[a.give] - a.giveCount >= nextCost(view, track);
      if (spare) out.push(a);
    } else if (isCommodity(a.receive)) {
      const track = trackOf(a.receive);
      if (!wantsMore(view, plan, track) || meOf(view).cities.length === 0) continue;
      if (commodities[a.receive] + 1 < nextCost(view, track)) continue;
      if (hand[a.give] - need.cost[a.give] < a.giveCount) continue;
      out.push(a);
    }
  }
  return out;
}

/**
 * After settlements and cities: improvements, a knight when the fair share
 * is short, activation when the fleet is near or grain is spare, commodity
 * trades, promotions and walls from spare cards.
 */
export function crownBuild(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!crownOf(view)) return null;
  const me = view.viewer;
  const hand = myHand(view);
  const need = resourceNeed(view, me);
  const d = defence(view, me);

  const improvement = chooseImprovement(view, legal, rng);
  if (improvement) return improvement;

  if (d.active + d.inactive < d.fair) {
    const build = chooseBuildKnight(view, legal, rng);
    if (build) return build;
  }
  if (d.short > 0 && (d.fleet >= 4 || hand.grain > need.cost.grain)) {
    const activate = chooseActivate(view, legal, rng);
    if (activate) return activate;
  }

  const trades = usefulCommodityTrades(view, legal);
  if (trades.length) return best(rng, trades, (t) => -t.giveCount);

  const spare = (r: Resource, n: number) => hand[r] - need.cost[r] >= n;
  if ((d.short > 0 || d.fleet >= 4) && spare("wool", 1) && spare("ore", 1)) {
    const promote = choosePromote(view, legal, rng);
    if (promote) return promote;
  }
  if (spare("clay", 2) && (fullCardCount(view, me) >= 6 || hand.clay >= 4)) {
    const walls = ofType(legal, "BUILD_WALL");
    if (walls.length) return best(rng, walls, (a) => rawPipCount(view, a.vertex));
  }
  return null;
}

/** Easy: improvements and knights sometimes, a random progress card now and then; never anything clever. */
export function crownEasy(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!crownOf(view)) return null;
  const improvements = ofType(legal, "BUILD_IMPROVEMENT");
  if (improvements.length && rng() < 0.6) return pick(rng, improvements);
  const knights = ofType(legal, "BUILD_KNIGHT").filter((a) => a.vertex !== undefined);
  if (knights.length && rng() < 0.35) return pick(rng, knights);
  const activations = ofType(legal, "ACTIVATE_KNIGHT");
  if (activations.length && rng() < 0.4) return pick(rng, activations);
  const promotions = ofType(legal, "PROMOTE_KNIGHT");
  if (promotions.length && rng() < 0.15) return pick(rng, promotions);
  const chases = ofType(legal, "KNIGHT_CHASE_ROBBER");
  if (chases.length && rng() < 0.3) return pick(rng, chases);
  const plays = ofType(legal, "PLAY_PROGRESS");
  if (plays.length && rng() < 0.3) {
    const cards = [...new Set(plays.map((a) => a.card))];
    const card = pick(rng, cards);
    return pick(
      rng,
      plays.filter((a) => a.card === card),
    );
  }
  const walls = ofType(legal, "BUILD_WALL");
  if (walls.length && rng() < 0.1) return pick(rng, walls);
  return null;
}

// ---------------------------------------------------------------------------
// Discards (§1)

/**
 * A DISCARD that spends resources the base rule would and, for the rest,
 * commodities off the tracks the plan is not pursuing (largest stacks
 * first). Null when resources alone cover the discard (the base rule runs).
 */
export function crownDiscard(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  if (!crownOf(view)) return null;
  const me = view.viewer;
  const owed = view.pendingDiscards[me] ?? 0;
  const hand = myHand(view);
  const resources = handTotal(hand);
  if (resources >= owed) return null;
  const plan = improvementPlan(view, me);
  const remaining = { ...myCommodities(view) };
  const commodities = emptyCommodities();
  for (let i = resources; i < owed; i++) {
    const options = COMMODITIES.filter((c) => remaining[c] > 0);
    if (options.length === 0) break;
    const c = best(rng, options, (x) => {
      const track = TRACKS.find((t) => TRACK_COMMODITY[t] === x) as Track;
      return (wantsMore(view, plan, track) ? -10 : 0) + (track === plan.primary ? -5 : 0) + remaining[x];
    });
    remaining[c] -= 1;
    commodities[c] += 1;
  }
  const cards: Hand = { ...hand };
  return ensureLegal(legal, { type: "DISCARD", playerId: me, cards, commodities }) ?? legal.find((a) => a.type === "DISCARD") ?? pick(rng, legal);
}

// ---------------------------------------------------------------------------
// Prompts (docs/modules.md §4)

/** A crown prompt addressed to the viewer, or null for other prompt kinds. */
export function chooseCrownPrompt(view: RedactedState, legal: Action[], rng: Rng): Action | null {
  const phase = view.phase;
  if (phase.kind !== "modulePrompt" || !crownOf(view)) return null;
  const me = view.viewer;
  const cp = crownPlayerOf(view, me);
  const plan = improvementPlan(view, me);
  switch (phase.prompt.kind) {
    case "downgradeCity": {
      // Lose the city with the fewest pips; a wall goes with it, so walled cities are kept.
      const choices = ofType(legal, "CHOOSE_DOWNGRADE");
      if (choices.length === 0) return null;
      const walls = new Set(cp?.walls ?? []);
      return best(rng, choices, (a) => -(rawPipCount(view, a.vertex) + crownCityBonus(view, a.vertex, me) * 0.5 + (walls.has(a.vertex) ? 2 : 0)));
    }
    case "placeMetropolis": {
      const choices = ofType(legal, "PLACE_METROPOLIS");
      if (choices.length === 0) return null;
      return best(rng, choices, (a) => rawPipCount(view, a.vertex) + crownCityBonus(view, a.vertex, me) * 0.5);
    }
    case "discardProgress": {
      const choices = ofType(legal, "DISCARD_PROGRESS");
      if (choices.length === 0) return null;
      return best(rng, choices, (a) => -progressCardValue(view, a.card));
    }
    case "deserter": {
      // As the victim: give up the lowest, inactive knight.
      const choices = ofType(legal, "CHOOSE_DESERTER");
      if (choices.length === 0) return null;
      return best(rng, choices, (a) => {
        const k = knightAt(view, a.vertex);
        return -((k?.level ?? 0) * 10 + (k?.active ? 5 : 0));
      });
    }
    case "placeFreeKnight":
      return bestKnightVertex(view, ofType(legal, "PLACE_FREE_KNIGHT"), rng) ?? ofType(legal, "PLACE_FREE_KNIGHT")[0] ?? null;
    case "knightRetreat":
      return bestKnightVertex(view, ofType(legal, "RETREAT_KNIGHT"), rng) ?? ofType(legal, "RETREAT_KNIGHT")[0] ?? null;
    case "spy": {
      const choices = ofType(legal, "SPY_TAKE");
      if (choices.length === 0) return null;
      return best(rng, choices, (a) => progressCardValue(view, a.card));
    }
    case "commercialHarbor": {
      // Hand over the commodity of a track the plan is not pursuing.
      const choices = ofType(legal, "COMMERCIAL_SWAP");
      if (choices.length === 0) return null;
      const held = myCommodities(view);
      return best(rng, choices, (a) => {
        const track = TRACKS.find((t) => TRACK_COMMODITY[t] === a.commodity) as Track;
        return -((wantsMore(view, plan, track) ? 2 : 0) + (track === plan.primary ? 1 : 0) + (held[a.commodity] <= nextCost(view, track) ? 1 : 0));
      });
    }
    case "giveCards": {
      // Surplus first: cards beyond the next build's cost and commodities off unwanted tracks.
      const choices = ofType(legal, "GIVE_CARDS");
      if (choices.length === 0) return null;
      const hand = myHand(view);
      const need = resourceNeed(view, me);
      return best(rng, choices, (a) => {
        let loss = 0;
        for (const r of RESOURCES) loss += a.cards[r] * (need.cost[r] > 0 ? (hand[r] <= need.cost[r] ? 3 : 1) : 0.5);
        for (const c of COMMODITIES) {
          const track = TRACKS.find((t) => TRACK_COMMODITY[t] === c) as Track;
          loss += (a.commodities?.[c] ?? 0) * (wantsMore(view, plan, track) ? 2 : 0.5);
        }
        return -loss;
      });
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Position terms for the hard bot (docs/phase5.md §6.6)

/**
 * Track levels (1.2 each, +2 for a level-3 ability, a pending metropolis at
 * its VP value), active defence against the fair share with a fleet-risk
 * penalty when short, knights in reserve, the top-defender chip chance,
 * commodity holdings and income, walls.
 */
export function crownPositionBonus(view: RedactedState, playerId: string): number {
  const crown = crownOf(view);
  const cp = crownPlayerOf(view, playerId);
  if (!crown || !cp) return 0;
  let bonus = 0;
  for (const t of TRACKS) {
    const level = cp.tracks[t];
    bonus += level * 1.2;
    if (level >= 3) bonus += 2;
    if (level >= METROPOLIS_LEVEL && cp.metropolises[t] === null) {
      const holder = crown.metropolis[t];
      const holderLevel = holder === null ? 0 : (crown.players[holder]?.tracks[t] ?? 0);
      if (holder === null || (level >= MAX_LEVEL && holderLevel < MAX_LEVEL)) bonus += 20;
    }
  }
  const d = defence(view, playerId);
  const potential = d.active + (d.fleet >= 5 ? 0.3 : 0.8) * d.inactive;
  bonus += Math.min(d.active, d.fair) * (0.6 + 0.4 * d.risk);
  bonus += Math.max(0, d.active - d.fair) * 0.3;
  bonus += d.inactive * (d.fleet >= 5 ? 0.3 : 0.5);
  if (potential < d.fair) bonus -= (d.fair - potential) * d.risk * (d.exposed ? 1 : 0.5);
  if (d.active > 0 && d.fleet >= 3) {
    const topOpponent = Math.max(0, ...view.players.filter((p) => p.id !== playerId).map((p) => defence(view, p.id).active));
    if (d.active > topOpponent) bonus += 1.5;
  }
  bonus += commodityTotal(cp.commodities) * 0.2;
  const income = commodityIncome(view, playerId);
  bonus += (income.trade + income.politics + income.science) * 0.35;
  bonus += cp.walls.length * 0.3;
  return bonus;
}
