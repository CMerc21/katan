/**
 * Crown & Castle §4 (docs/phase11.md, docs/rules.md §16.4): what the progress
 * cards do. `PLAY_PROGRESS { card, payload }` resolves a card at once or
 * parks a prompt (Deserter, Spy, Commercial Harbor, Wedding) whose answers
 * are `CHOOSE_DESERTER`, `PLACE_FREE_KNIGHT`, `SPY_TAKE`, `COMMERCIAL_SWAP`
 * and `GIVE_CARDS`. Drawing, the hand limit and discards live in
 * `progress.ts`.
 *
 * Timing: any number of cards in the action phase and at most one before
 * the roll. The Alchemist only works before the roll; politics cards and
 * the Inventor, Irrigation and Mining may open the turn too; every card
 * that builds, promotes or trades (the trade deck, Crane, Engineer,
 * Medicine, Road Building, Smith) waits for the action phase.
 */

import { RESOURCES, boardGeometry, type HexTile, type Resource } from "../../board";
import { RuleError, type RuleErrorCode } from "../../errors";
import { isBoardEdge, isBoardVertex, type EdgeId, type HexId, type VertexId } from "../../geometry";
import { pay, requireCurrent, requireHand, requirePhase, requirePrompted } from "../../guards";
import { canPlaceRoadOrShip, legalRoadEdges, stealTargets } from "../../legal";
import { rng } from "../../rng";
import { updateLongestRoad } from "../../specialCards";
import { cardCount, currentPlayerId, emit, emptyHand, getPlayer, hand, handSize, hasResources, roadOwner, transfer, victoryPoints } from "../../state";
import { startRoadBuilding, stealRandomCard, upgradeToCity } from "../../turnHelpers";
import type {
  Action,
  ChooseDeserterAction,
  CommercialSwapAction,
  GameState,
  GiveCardsAction,
  Hand,
  PlaceFreeKnightAction,
  PlayProgressAction,
  Player,
  PlayerId,
  ProgressPayload,
  SpyTakeAction,
} from "../../types";
import { finishPrompt, parkPrompt } from "../prompt";
import {
  COMMODITIES,
  MAX_WALLS,
  VP_PROGRESS_CARDS,
  commodityTotal,
  emptyCommodities,
  isCommodity,
  isProgressCard,
  type Commodity,
  type CommodityHand,
  type KnightLevel,
  type ModulePrompt,
  type ProgressCard,
} from "../types";
import { crownPlayer, crownState, seatOrder } from "./common";
import { knightAt, knightPlacements, knightsInSupply, knightsOf, ownRoadVertices, placeKnight, promoteKnight, removeKnight, requireOwnKnight } from "./knights";
import { isCommodityHand } from "./production";
import { enforceProgressLimit, holdsProgress, progressHandCount, removeHeldProgress, returnToDeck } from "./progress";
import { wallSites } from "./walls";

// ---------------------------------------------------------------------------
// Timing and payload checks

/** Cards that may be played before the roll (the Alchemist may be played only then). */
const BEFORE_ROLL: ReadonlySet<ProgressCard> = new Set<ProgressCard>(["alchemist", "bishop", "deserter", "diplomat", "intrigue", "saboteur", "spy", "warlord", "wedding", "inventor", "irrigation", "mining"]);

export function playableIn(card: ProgressCard, phase: "roll" | "action"): boolean {
  if (card === "alchemist") return phase === "roll";
  return phase === "action" || BEFORE_ROLL.has(card);
}

/** §4: the number tokens the Inventor may swap. */
const INVENTOR_TOKENS: ReadonlySet<number> = new Set([3, 4, 5, 9, 10, 11]);
/** §4: Medicine upgrades a settlement for two ore and one grain. */
export const MEDICINE_COST: Hand = hand({ ore: 2, grain: 1 });
/** How many relocations per own open road `legalActions` lists for the Diplomat. */
const RELOCATION_CAP = 3;

function isResource(value: unknown): value is Resource {
  return (RESOURCES as readonly unknown[]).includes(value);
}

function requireLandHex(state: GameState, hex: unknown): HexId {
  if (typeof hex !== "string" || state.board.hexes[hex] === undefined) throw new RuleError("INVALID_PAYLOAD", "a land hex is needed");
  return hex;
}

function requireVertex(state: GameState, vertex: unknown): VertexId {
  if (typeof vertex !== "string" || !isBoardVertex(vertex, boardGeometry(state.board))) throw new RuleError("INVALID_PAYLOAD", "a board vertex is needed");
  return vertex;
}

function requireEdge(state: GameState, edge: unknown): EdgeId {
  if (typeof edge !== "string" || !isBoardEdge(edge, boardGeometry(state.board))) throw new RuleError("INVALID_PAYLOAD", "a board edge is needed");
  return edge;
}

function requireResource(value: unknown): Resource {
  if (!isResource(value)) throw new RuleError("INVALID_PAYLOAD", "a resource is needed");
  return value;
}

function requireCommodity(value: unknown): Commodity {
  if (!isCommodity(value)) throw new RuleError("INVALID_PAYLOAD", "a commodity is needed");
  return value;
}

/** Another player named in a payload. */
function requireTarget(state: GameState, player: Player, id: unknown): Player {
  if (typeof id !== "string" || !state.players.some((p) => p.id === id)) throw new RuleError("INVALID_PAYLOAD", "a player is needed");
  if (id === player.id) throw new RuleError("INVALID_CHOICE", "you cannot target yourself");
  return getPlayer(state, id);
}

// ---------------------------------------------------------------------------
// Queries shared by the effects and `legalActions`

/** Land hexes the player has a settlement or city on, in board order. */
export function touchedHexes(state: GameState, playerId: PlayerId): HexId[] {
  const geo = boardGeometry(state.board);
  const player = getPlayer(state, playerId);
  const touched = new Set<HexId>();
  for (const v of [...player.settlements, ...player.cities]) for (const h of geo.vertexHexes[v] ?? []) touched.add(h);
  return geo.hexes.filter((h) => touched.has(h) && state.board.hexes[h] !== undefined);
}

/** Players with more victory points than `player` (Master Merchant, Saboteur, Wedding), in seat order. */
export function richerPlayers(state: GameState, player: Player): Player[] {
  const mine = victoryPoints(state, player).total;
  return seatOrder(state).filter((p) => p.id !== player.id && victoryPoints(state, p).total > mine);
}

export function masterMerchantTargets(state: GameState, player: Player): PlayerId[] {
  return richerPlayers(state, player)
    .filter((p) => cardCount(state, p) >= 1)
    .map((p) => p.id);
}

export function spyTargets(state: GameState, player: Player): PlayerId[] {
  return seatOrder(state)
    .filter((p) => p.id !== player.id && progressHandCount(state, p.id) >= 1)
    .map((p) => p.id);
}

export function deserterTargets(state: GameState, player: Player): PlayerId[] {
  return seatOrder(state)
    .filter((p) => p.id !== player.id && knightsOf(state, p.id).length > 0)
    .map((p) => p.id);
}

/** Opposing knights standing on a vertex one of the player's roads touches. */
export function intrigueTargets(state: GameState, playerId: PlayerId): VertexId[] {
  const mine = ownRoadVertices(state, playerId);
  return crownState(state)
    .knights.filter((k) => k.owner !== playerId && mine.has(k.at))
    .map((k) => k.at)
    .sort();
}

/** Other players holding at least one commodity, in seat order (Commercial Harbor). */
function harborVictims(state: GameState, playerId: PlayerId): PlayerId[] {
  return seatOrder(state)
    .filter((p) => p.id !== playerId && commodityTotal(crownPlayer(state, p.id).commodities) >= 1)
    .map((p) => p.id);
}

export interface OpenRoad {
  readonly edge: EdgeId;
  readonly owner: PlayerId;
}

/** §4: a road is open when one of its ends carries no other road, ship or building of its owner. */
function isOpenRoad(state: GameState, owner: Player, edge: EdgeId): boolean {
  const geo = boardGeometry(state.board);
  return (geo.edgeVertices[edge] ?? []).some((v) => {
    if (owner.settlements.includes(v) || owner.cities.includes(v)) return false;
    return !(geo.vertexEdges[v] ?? []).some((e) => e !== edge && (owner.roads.includes(e) || owner.ships.includes(e)));
  });
}

/** Every open road on the board (Diplomat), by seat then edge. */
export function openRoads(state: GameState): OpenRoad[] {
  const out: OpenRoad[] = [];
  for (const p of state.players) {
    for (const edge of [...p.roads].sort()) if (isOpenRoad(state, p, edge)) out.push({ edge, owner: p.id });
  }
  return out;
}

/** Edges the player could place a removed road on again (computed with the road lifted off the board). */
export function relocationsFor(state: GameState, player: Player, edge: EdgeId): EdgeId[] {
  const idx = player.roads.indexOf(edge);
  if (idx < 0) return [];
  player.roads.splice(idx, 1);
  try {
    return legalRoadEdges(state, player.id).filter((e) => e !== edge);
  } finally {
    player.roads.splice(idx, 0, edge);
  }
}

/** Unordered pairs of land hexes whose tokens the Inventor may swap. */
export function inventorPairs(state: GameState): [HexId, HexId][] {
  const geo = boardGeometry(state.board);
  const candidates = geo.hexes.filter((h) => {
    const tile = state.board.hexes[h];
    return tile !== undefined && tile.token !== null && INVENTOR_TOKENS.has(tile.token);
  });
  const out: [HexId, HexId][] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i] as HexId;
      const b = candidates[j] as HexId;
      if (state.board.hexes[a]?.token !== state.board.hexes[b]?.token) out.push([a, b]);
    }
  }
  return out;
}

/** Why the Smith cannot promote `vertices` in that order, or null when it can (piece supply is tracked promotion by promotion). */
export function smithCheck(state: GameState, playerId: PlayerId, vertices: readonly VertexId[]): RuleErrorCode | null {
  if (vertices.length < 1 || vertices.length > 2 || new Set(vertices).size !== vertices.length) return "INVALID_PAYLOAD";
  const politics = crownPlayer(state, playerId).tracks.politics;
  const onBoard: Record<KnightLevel, number> = { 1: 0, 2: 0, 3: 0 };
  for (const k of knightsOf(state, playerId)) onBoard[k.level] += 1;
  for (const v of vertices) {
    const knight = knightAt(state, v);
    if (!knight) return "NO_KNIGHT";
    if (knight.owner !== playerId) return "NOT_YOUR_KNIGHT";
    if (knight.level >= 3) return "KNIGHT_MAX_LEVEL";
    const next = (knight.level + 1) as KnightLevel;
    if (next === 3 && politics < 3) return "NEEDS_POLITICS";
    if (onBoard[next] >= 2) return "NO_KNIGHTS_LEFT";
    onBoard[knight.level] -= 1;
    onBoard[next] += 1;
  }
  return null;
}

/** Every multiset of `count` cards from a hand of resources and commodities (Wedding). */
function giveChoices(cards: Hand, commodities: CommodityHand, count: number): { cards: Hand; commodities: CommodityHand }[] {
  const kinds: (Resource | Commodity)[] = [...RESOURCES.filter((r) => cards[r] > 0), ...COMMODITIES.filter((c) => commodities[c] > 0)];
  const out: { cards: Hand; commodities: CommodityHand }[] = [];
  const pick: (Resource | Commodity)[] = [];
  const walk = (from: number, left: number): void => {
    if (left === 0) {
      const h = emptyHand();
      const c = emptyCommodities();
      for (const k of pick) {
        if (isCommodity(k)) c[k] += 1;
        else h[k] += 1;
      }
      out.push({ cards: h, commodities: c });
      return;
    }
    for (let i = from; i < kinds.length; i++) {
      const k = kinds[i] as Resource | Commodity;
      const have = isCommodity(k) ? commodities[k] : cards[k];
      if (pick.filter((x) => x === k).length >= have) continue;
      pick.push(k);
      walk(i, left - 1);
      pick.pop();
    }
  };
  walk(0, count);
  return out;
}

// ---------------------------------------------------------------------------
// PLAY_PROGRESS

type Effect = (state: GameState, player: Player, payload: ProgressPayload) => void;

export function applyPlayProgress(state: GameState, action: PlayProgressAction): void {
  const phase = requirePhase(state, "roll", "action");
  const player = requireCurrent(state, action.playerId);
  const card: unknown = action.card;
  if (!isProgressCard(card)) throw new RuleError("INVALID_PAYLOAD", "unknown progress card");
  if (VP_PROGRESS_CARDS.includes(card)) throw new RuleError("INVALID_CHOICE", `${card} is a victory point card and stays face up`);
  if (!holdsProgress(state, player.id, card)) throw new RuleError("NO_PROGRESS_CARD", `you do not hold ${card}`);
  const cp = crownPlayer(state, player.id);
  if (phase.kind === "roll") {
    if (cp.progressPlayedBeforeRoll) throw new RuleError("PROGRESS_BEFORE_ROLL", "only one progress card may be played before the roll");
    if (!playableIn(card, "roll")) throw new RuleError("WRONG_PHASE", `${card} is played after the roll`);
  } else if (!playableIn(card, "action")) {
    throw new RuleError("WRONG_PHASE", `${card} is played before the roll`);
  }
  const payload: unknown = action.payload ?? {};
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new RuleError("INVALID_PAYLOAD", "payload must be an object");

  // The card leaves the hand first so the effect's events follow `progressPlayed`; a failing effect discards the whole transition.
  removeHeldProgress(state, player.id, card);
  returnToDeck(state, card);
  cp.progressPlayedThisTurn += 1;
  if (phase.kind === "roll") cp.progressPlayedBeforeRoll = true;
  emit(state, { kind: "progressPlayed", playerId: player.id, card });
  EFFECTS[card](state, player, payload as ProgressPayload);
}

// --- Trade -------------------------------------------------------------------

const merchant: Effect = (state, player, payload) => {
  const hex = requireLandHex(state, payload.hex);
  if (!touchedHexes(state, player.id).includes(hex)) throw new RuleError("HEX_NOT_TOUCHED", "the merchant goes on a hex you have a building on");
  const crown = crownState(state);
  const from = crown.merchant !== null && crown.merchant.playerId !== player.id ? crown.merchant.playerId : null;
  crown.merchant = { playerId: player.id, hex };
  emit(state, { kind: "merchantPlaced", playerId: player.id, hex, from });
};

const tradeMonopoly: Effect = (state, player, payload) => {
  const commodity = requireCommodity(payload.commodity);
  const mine = crownPlayer(state, player.id).commodities;
  const taken: Record<PlayerId, number> = {};
  for (const other of state.players) {
    if (other.id === player.id) continue;
    const theirs = crownPlayer(state, other.id).commodities;
    const n = Math.min(1, theirs[commodity]);
    theirs[commodity] -= n;
    mine[commodity] += n;
    taken[other.id] = n;
  }
  emit(state, { kind: "commodityMonopolised", playerId: player.id, commodity, taken });
};

const resourceMonopoly: Effect = (state, player, payload) => {
  const resource = requireResource(payload.resource);
  const taken: Record<PlayerId, number> = {};
  for (const other of state.players) {
    if (other.id === player.id) continue;
    const n = Math.min(2, other.hand[resource]);
    other.hand[resource] -= n;
    player.hand[resource] += n;
    taken[other.id] = n;
  }
  emit(state, { kind: "resourceMonopolised", playerId: player.id, resource, taken });
};

const masterMerchant: Effect = (state, player, payload) => {
  const target = requireTarget(state, player, payload.targetPlayerId);
  if (!masterMerchantTargets(state, player).includes(target.id)) throw new RuleError("INVALID_CHOICE", "the target must have more victory points than you and a card to take");
  const draw = rng(state.seed, state.actionIndex);
  const count = Math.min(2, cardCount(state, target));
  for (let i = 0; i < count; i++) stealRandomCard(state, player, target, draw);
  emit(state, { kind: "cardsTaken", from: target.id, to: player.id, count, what: "cards" });
};

const merchantFleet: Effect = (state, player, payload) => {
  const card: unknown = payload.card;
  if (!isResource(card) && !isCommodity(card)) throw new RuleError("INVALID_PAYLOAD", "a resource or commodity is needed");
  crownPlayer(state, player.id).merchantFleet = card;
};

const commercialHarbor: Effect = (state, player, payload) => {
  const resource = requireResource(payload.resource);
  if (player.hand[resource] < 1) throw new RuleError("INSUFFICIENT_RESOURCES", `you hold no ${resource} to swap`);
  const [first, ...pending] = harborVictims(state, player.id);
  if (first !== undefined) parkPrompt(state, { kind: "commercialHarbor", playerId: first, by: player.id, pending, resource });
};

// --- Politics ----------------------------------------------------------------

const bishop: Effect = (state, player, payload) => {
  const hex = requireLandHex(state, payload.hex);
  if (crownState(state).attacks === 0) throw new RuleError("ROBBER_LOCKED", "the robber cannot be moved before the first attack");
  if (hex === state.robberHex) throw new RuleError("ROBBER_MUST_MOVE", "the robber must move to a different hex");
  const from = state.robberHex;
  state.robberHex = hex;
  emit(state, { kind: "robberMoved", from, to: hex, by: player.id });
  const draw = rng(state.seed, state.actionIndex);
  for (const id of stealTargets(state, hex, player.id)) stealRandomCard(state, player, getPlayer(state, id), draw);
};

const deserter: Effect = (state, player, payload) => {
  const target = requireTarget(state, player, payload.targetPlayerId);
  if (knightsOf(state, target.id).length === 0) throw new RuleError("NO_KNIGHT", `${target.id} has no knights`);
  parkPrompt(state, { kind: "deserter", playerId: target.id, by: player.id });
};

const diplomat: Effect = (state, player, payload) => {
  const edge = requireEdge(state, payload.edge);
  const ownerId = roadOwner(state, edge);
  if (ownerId === null) throw new RuleError("INVALID_CHOICE", `no road at ${edge}`);
  const owner = getPlayer(state, ownerId);
  if (!isOpenRoad(state, owner, edge)) throw new RuleError("NOT_OPEN_END", "only a road with a free end can be removed");
  const relocateTo: unknown = payload.relocateTo;
  if (relocateTo !== undefined && ownerId !== player.id) throw new RuleError("INVALID_CHOICE", "only your own road may be placed again");
  owner.roads.splice(owner.roads.indexOf(edge), 1);
  owner.pieces.roads += 1;
  let relocatedTo: EdgeId | null = null;
  if (relocateTo !== undefined) {
    const to = requireEdge(state, relocateTo);
    if (to === edge) throw new RuleError("INVALID_CHOICE", "place the road somewhere else");
    if (!legalRoadEdges(state, player.id).includes(to)) throw new RuleError("ROAD_NOT_CONNECTED", `edge ${to} is not free and connected to your network`);
    player.roads.push(to);
    player.pieces.roads -= 1;
    relocatedTo = to;
  }
  emit(state, { kind: "roadRemoved", playerId: player.id, owner: ownerId, edge, relocatedTo });
  updateLongestRoad(state);
};

const intrigue: Effect = (state, player, payload) => {
  const vertex = requireVertex(state, payload.vertex);
  const knight = knightAt(state, vertex);
  if (!knight) throw new RuleError("NO_KNIGHT", `no knight at ${vertex}`);
  if (knight.owner === player.id) throw new RuleError("INVALID_CHOICE", "intrigue removes an opposing knight");
  if (!ownRoadVertices(state, player.id).has(vertex)) throw new RuleError("KNIGHT_NOT_CONNECTED", "the knight must stand on a vertex your roads touch");
  removeKnight(state, vertex);
  emit(state, { kind: "knightRemoved", playerId: knight.owner, vertex, reason: "intrigue" });
  updateLongestRoad(state);
};

const saboteur: Effect = (state, player) => {
  const pending: Record<PlayerId, number> = {};
  for (const p of richerPlayers(state, player)) {
    const owed = Math.floor(cardCount(state, p) / 2);
    if (owed > 0) pending[p.id] = owed;
  }
  if (Object.keys(pending).length === 0) return;
  state.pendingDiscards = pending;
  state.phase = { kind: "discard", returnTo: state.phase };
};

const spy: Effect = (state, player, payload) => {
  const target = requireTarget(state, player, payload.targetPlayerId);
  if (progressHandCount(state, target.id) === 0) throw new RuleError("NO_PROGRESS_CARD", `${target.id} holds no progress cards`);
  parkPrompt(state, { kind: "spy", playerId: player.id, target: target.id });
};

const warlord: Effect = (state, player) => {
  for (const knight of knightsOf(state, player.id)) {
    if (knight.active) continue;
    knight.active = true;
    knight.actedThisTurn = true; // like a paid activation: no action until the next turn
    emit(state, { kind: "knightActivated", playerId: player.id, vertex: knight.at, free: true });
  }
};

/** The next Wedding prompt among `pending` (players who no longer hold a card are skipped). */
function nextGivePrompt(state: GameState, pending: readonly PlayerId[], to: PlayerId): ModulePrompt | null {
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i] as PlayerId;
    const count = Math.min(2, cardCount(state, getPlayer(state, id)));
    if (count > 0) return { kind: "giveCards", playerId: id, pending: pending.slice(i + 1), to, count };
  }
  return null;
}

const wedding: Effect = (state, player) => {
  const victims = richerPlayers(state, player).map((p) => p.id);
  const first = nextGivePrompt(state, victims, player.id);
  if (first) parkPrompt(state, first);
};

// --- Science -----------------------------------------------------------------

const alchemist: Effect = (state, player, payload) => {
  requirePhase(state, "roll");
  const dice: unknown = payload.dice;
  if (!Array.isArray(dice) || dice.length !== 2 || !dice.every((d: unknown) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 6)) {
    throw new RuleError("INVALID_PAYLOAD", "dice must be two numbers from 1 to 6");
  }
  crownState(state).alchemist = [dice[0] as number, dice[1] as number];
  emit(state, { kind: "alchemistSet", playerId: player.id });
};

const crane: Effect = (state, player) => {
  crownPlayer(state, player.id).crane = true;
};

const engineer: Effect = (state, player, payload) => {
  const vertex = requireVertex(state, payload.vertex);
  const cp = crownPlayer(state, player.id);
  if (!player.cities.includes(vertex)) throw new RuleError("NOT_A_CITY", `no city of yours at ${vertex}`);
  if (cp.walls.includes(vertex)) throw new RuleError("VERTEX_OCCUPIED", `the city at ${vertex} already has a wall`);
  if (cp.walls.length >= MAX_WALLS) throw new RuleError("WALL_LIMIT", `at most ${MAX_WALLS} walls`);
  cp.walls.push(vertex);
  emit(state, { kind: "wallBuilt", playerId: player.id, vertex, free: true });
};

const inventor: Effect = (state, player, payload) => {
  const hexes: unknown = payload.hexes;
  if (!Array.isArray(hexes) || hexes.length !== 2) throw new RuleError("INVALID_PAYLOAD", "two hexes are needed");
  const a = requireLandHex(state, hexes[0]);
  const b = requireLandHex(state, hexes[1]);
  const tileA = state.board.hexes[a] as HexTile;
  const tileB = state.board.hexes[b] as HexTile;
  if (a === b || tileA.token === null || tileB.token === null || !INVENTOR_TOKENS.has(tileA.token) || !INVENTOR_TOKENS.has(tileB.token) || tileA.token === tileB.token) {
    throw new RuleError("INVALID_CHOICE", "swap two different tokens among 3, 4, 5, 9, 10 and 11");
  }
  const tiles = state.board.hexes as Record<HexId, HexTile>;
  tiles[a] = { ...tileA, token: tileB.token };
  tiles[b] = { ...tileB, token: tileA.token };
  emit(state, { kind: "tokensSwapped", playerId: player.id, a, b });
};

/** Irrigation and Mining: two of a resource per touched hex of a terrain, as far as the bank goes. */
function harvest(state: GameState, player: Player, terrain: "farmland" | "mountain", resource: Resource, reason: "irrigation" | "mining"): void {
  const hexes = touchedHexes(state, player.id).filter((h) => state.board.hexes[h]?.terrain === terrain).length;
  const count = Math.min(2 * hexes, state.bank[resource]);
  if (count === 0) return;
  const cards = hand({ [resource]: count });
  transfer(state.bank, player.hand, cards);
  emit(state, { kind: "resourcesTaken", playerId: player.id, cards, reason });
}

const irrigation: Effect = (state, player) => harvest(state, player, "farmland", "grain", "irrigation");
const mining: Effect = (state, player) => harvest(state, player, "mountain", "ore", "mining");

const medicine: Effect = (state, player, payload) => {
  const vertex = requireVertex(state, payload.vertex);
  if (!player.settlements.includes(vertex)) throw new RuleError("NOT_YOUR_SETTLEMENT", `no settlement of yours at ${vertex}`);
  if (player.pieces.cities <= 0) throw new RuleError("NO_PIECES_LEFT", "no cities left");
  pay(state, player, MEDICINE_COST);
  upgradeToCity(state, player, vertex);
};

const roadBuilding: Effect = (state, player) => {
  if (!canPlaceRoadOrShip(state, player)) throw new RuleError("NO_LEGAL_ROAD", "nowhere to build a road");
  startRoadBuilding(state, player);
};

const smith: Effect = (state, player, payload) => {
  const vertices: unknown = payload.vertices;
  if (!Array.isArray(vertices) || !vertices.every((v: unknown) => typeof v === "string")) throw new RuleError("INVALID_PAYLOAD", "one or two knight vertices are needed");
  const check = smithCheck(state, player.id, vertices as VertexId[]);
  if (check !== null) throw new RuleError(check, `the smith cannot promote those knights: ${check}`);
  for (const v of vertices as VertexId[]) {
    const knight = requireOwnKnight(state, player.id, v);
    promoteKnight(knight);
    emit(state, { kind: "knightPromoted", playerId: player.id, vertex: v, level: knight.level });
  }
};

const notPlayable: Effect = (state, player) => {
  void state;
  void player;
  throw new RuleError("INVALID_CHOICE", "victory point cards are not played");
};

const EFFECTS: Readonly<Record<ProgressCard, Effect>> = {
  merchant,
  tradeMonopoly,
  resourceMonopoly,
  masterMerchant,
  merchantFleet,
  commercialHarbor,
  bishop,
  constitution: notPlayable,
  deserter,
  diplomat,
  intrigue,
  saboteur,
  spy,
  warlord,
  wedding,
  alchemist,
  crane,
  engineer,
  inventor,
  irrigation,
  medicine,
  mining,
  printer: notPlayable,
  roadBuilding,
  smith,
};

// ---------------------------------------------------------------------------
// Prompt answers

export function applyChooseDeserter(state: GameState, action: ChooseDeserterAction): void {
  const prompt = requirePrompted(state, "deserter", action.playerId);
  const vertex = requireVertex(state, action.vertex);
  const knight = requireOwnKnight(state, action.playerId, vertex);
  removeKnight(state, vertex);
  emit(state, { kind: "knightRemoved", playerId: action.playerId, vertex, reason: "deserter" });
  const by = prompt.by;
  const canPlace = knightsInSupply(state, by, knight.level) > 0 && knightPlacements(state, by).length > 0;
  finishPrompt(state, canPlace ? { kind: "placeFreeKnight", playerId: by, level: knight.level, active: false } : null);
  updateLongestRoad(state);
}

export function applyPlaceFreeKnight(state: GameState, action: PlaceFreeKnightAction): void {
  const prompt = requirePrompted(state, "placeFreeKnight", action.playerId);
  const vertex: unknown = action.vertex;
  if (vertex !== null) {
    if (typeof vertex !== "string") throw new RuleError("INVALID_PAYLOAD", "a vertex or null is needed");
    if (!knightPlacements(state, action.playerId).includes(vertex)) throw new RuleError("INVALID_CHOICE", `a knight cannot be placed at ${vertex}`);
    if (knightsInSupply(state, action.playerId, prompt.level) <= 0) throw new RuleError("NO_KNIGHTS_LEFT", `no level ${prompt.level} knight pieces left`);
    placeKnight(state, action.playerId, vertex, prompt.level, prompt.active);
    emit(state, { kind: "knightBuilt", playerId: action.playerId, vertex });
  }
  finishPrompt(state);
  updateLongestRoad(state);
}

export function applySpyTake(state: GameState, action: SpyTakeAction): void {
  const prompt = requirePrompted(state, "spy", action.playerId);
  const card: unknown = action.card;
  if (!isProgressCard(card)) throw new RuleError("INVALID_PAYLOAD", "unknown progress card");
  if (!holdsProgress(state, prompt.target, card)) throw new RuleError("INVALID_CHOICE", `${prompt.target} does not hold ${card}`);
  const held = removeHeldProgress(state, prompt.target, card);
  crownPlayer(state, action.playerId).progress.push(held);
  emit(state, { kind: "cardsTaken", from: prompt.target, to: action.playerId, count: 1, what: "progress" });
  finishPrompt(state);
  enforceProgressLimit(state);
}

/** The next Commercial Harbor victim, or null when the chain is over (the player ran out of the resource, or nobody is left). */
function nextHarborPrompt(state: GameState, prompt: Extract<ModulePrompt, { kind: "commercialHarbor" }>): ModulePrompt | null {
  if (getPlayer(state, prompt.by).hand[prompt.resource] < 1) return null;
  for (let i = 0; i < prompt.pending.length; i++) {
    const id = prompt.pending[i] as PlayerId;
    if (commodityTotal(crownPlayer(state, id).commodities) >= 1) return { ...prompt, playerId: id, pending: prompt.pending.slice(i + 1) };
  }
  return null;
}

export function applyCommercialSwap(state: GameState, action: CommercialSwapAction): void {
  const prompt = requirePrompted(state, "commercialHarbor", action.playerId);
  const commodity: unknown = action.commodity;
  if (!isCommodity(commodity)) throw new RuleError("INVALID_PAYLOAD", "a commodity is needed");
  const victim = getPlayer(state, action.playerId);
  const by = getPlayer(state, prompt.by);
  const theirs = crownPlayer(state, victim.id).commodities;
  const mine = crownPlayer(state, by.id).commodities;
  if (theirs[commodity] < 1) throw new RuleError("INSUFFICIENT_RESOURCES", `you hold no ${commodity}`);
  if (by.hand[prompt.resource] < 1) throw new RuleError("INSUFFICIENT_RESOURCES", `${by.id} has no ${prompt.resource} left`);
  theirs[commodity] -= 1;
  mine[commodity] += 1;
  by.hand[prompt.resource] -= 1;
  victim.hand[prompt.resource] += 1;
  emit(state, { kind: "commercialSwap", by: by.id, with: victim.id, resource: prompt.resource, commodity });
  finishPrompt(state, nextHarborPrompt(state, prompt));
}

export function applyGiveCards(state: GameState, action: GiveCardsAction): void {
  const prompt = requirePrompted(state, "giveCards", action.playerId);
  const giver = getPlayer(state, action.playerId);
  const to = getPlayer(state, prompt.to);
  const cards = requireHand(action.cards, "cards");
  const commodities: unknown = action.commodities ?? emptyCommodities();
  if (!isCommodityHand(commodities)) throw new RuleError("INVALID_PAYLOAD", "commodities is not a valid commodity hand");
  if (handSize(cards) + commodityTotal(commodities) !== prompt.count) throw new RuleError("WRONG_DISCARD_COUNT", `give exactly ${prompt.count} cards`);
  if (!hasResources(giver.hand, cards)) throw new RuleError("INSUFFICIENT_RESOURCES", "not holding those cards");
  const theirs = crownPlayer(state, giver.id).commodities;
  if (COMMODITIES.some((c) => theirs[c] < commodities[c])) throw new RuleError("INSUFFICIENT_RESOURCES", "not holding those commodities");
  transfer(giver.hand, to.hand, cards);
  const mine = crownPlayer(state, to.id).commodities;
  for (const c of COMMODITIES) {
    theirs[c] -= commodities[c];
    mine[c] += commodities[c];
  }
  emit(state, { kind: "cardsTaken", from: giver.id, to: to.id, count: prompt.count, what: "cards" });
  finishPrompt(state, nextGivePrompt(state, prompt.pending, prompt.to));
}

// ---------------------------------------------------------------------------
// legalActions

/** Payload instances `applyPlayProgress` accepts for `card` right now; `[]` when the card cannot be played. */
function payloadsFor(state: GameState, player: Player, card: ProgressCard): (ProgressPayload | null)[] {
  const playerId = player.id;
  switch (card) {
    case "merchant":
      return touchedHexes(state, playerId).map((hex) => ({ hex }));
    case "tradeMonopoly":
      return COMMODITIES.map((commodity) => ({ commodity }));
    case "resourceMonopoly":
      return RESOURCES.map((resource) => ({ resource }));
    case "masterMerchant":
      return masterMerchantTargets(state, player).map((targetPlayerId) => ({ targetPlayerId }));
    case "merchantFleet":
      return [...RESOURCES, ...COMMODITIES].map((c) => ({ card: c }));
    case "commercialHarbor":
      return RESOURCES.filter((r) => player.hand[r] >= 1).map((resource) => ({ resource }));
    case "bishop":
      if (crownState(state).attacks === 0) return [];
      return boardGeometry(state.board)
        .hexes.filter((h) => h !== state.robberHex && state.board.hexes[h] !== undefined)
        .map((hex) => ({ hex }));
    case "deserter":
      return deserterTargets(state, player).map((targetPlayerId) => ({ targetPlayerId }));
    case "diplomat": {
      const out: ProgressPayload[] = [];
      for (const { edge, owner } of openRoads(state)) {
        out.push({ edge });
        if (owner !== playerId) continue;
        for (const relocateTo of relocationsFor(state, player, edge).slice(0, RELOCATION_CAP)) out.push({ edge, relocateTo });
      }
      return out;
    }
    case "intrigue":
      return intrigueTargets(state, playerId).map((vertex) => ({ vertex }));
    case "spy":
      return spyTargets(state, player).map((targetPlayerId) => ({ targetPlayerId }));
    case "alchemist": {
      const out: ProgressPayload[] = [];
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push({ dice: [a, b] });
      return out;
    }
    case "engineer":
      return crownPlayer(state, playerId).walls.length >= MAX_WALLS ? [] : wallSites(state, player).map((vertex) => ({ vertex }));
    case "inventor":
      return inventorPairs(state).map((hexes) => ({ hexes }));
    case "medicine":
      if (player.pieces.cities <= 0 || !hasResources(player.hand, MEDICINE_COST)) return [];
      return player.settlements.map((vertex) => ({ vertex }));
    case "roadBuilding":
      return canPlaceRoadOrShip(state, player) ? [null] : [];
    case "smith": {
      const knights = knightsOf(state, playerId)
        .map((k) => k.at)
        .sort();
      const out: ProgressPayload[] = [];
      for (const v of knights) if (smithCheck(state, playerId, [v]) === null) out.push({ vertices: [v] });
      for (let i = 0; i < knights.length; i++) {
        for (let j = i + 1; j < knights.length; j++) {
          const a = knights[i] as VertexId;
          const b = knights[j] as VertexId;
          if (smithCheck(state, playerId, [a, b]) === null) out.push({ vertices: [a, b] });
          else if (smithCheck(state, playerId, [b, a]) === null) out.push({ vertices: [b, a] });
        }
      }
      return out;
    }
    case "saboteur":
    case "warlord":
    case "wedding":
    case "crane":
    case "irrigation":
    case "mining":
      return [null];
    case "constitution":
    case "printer":
      return [];
    default: {
      const exhaustive: never = card;
      throw new Error(`unknown progress card ${String(exhaustive)}`);
    }
  }
}

/** §4: every PLAY_PROGRESS the current player may make in the roll or action phase. */
export function progressCardActions(state: GameState, player: Player, out: Action[]): void {
  const phase = state.phase.kind;
  if ((phase !== "roll" && phase !== "action") || currentPlayerId(state) !== player.id) return;
  const cp = crownPlayer(state, player.id);
  if (phase === "roll" && cp.progressPlayedBeforeRoll) return;
  const seen = new Set<ProgressCard>();
  for (const held of cp.progress) {
    if (held.revealed || seen.has(held.card) || VP_PROGRESS_CARDS.includes(held.card)) continue;
    seen.add(held.card);
    if (!playableIn(held.card, phase)) continue;
    for (const payload of payloadsFor(state, player, held.card)) {
      if (payload === null) out.push({ type: "PLAY_PROGRESS", playerId: player.id, card: held.card });
      else out.push({ type: "PLAY_PROGRESS", playerId: player.id, card: held.card, payload });
    }
  }
}

export function progressCardPromptActions(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void {
  if (prompt.playerId !== playerId) return;
  switch (prompt.kind) {
    case "deserter":
      for (const k of [...knightsOf(state, playerId)].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))) out.push({ type: "CHOOSE_DESERTER", playerId, vertex: k.at });
      return;
    case "placeFreeKnight":
      if (knightsInSupply(state, playerId, prompt.level) > 0) {
        for (const vertex of knightPlacements(state, playerId)) out.push({ type: "PLACE_FREE_KNIGHT", playerId, vertex });
      }
      out.push({ type: "PLACE_FREE_KNIGHT", playerId, vertex: null });
      return;
    case "spy": {
      const seen = new Set<ProgressCard>();
      for (const held of crownPlayer(state, prompt.target).progress) {
        if (held.revealed || seen.has(held.card)) continue;
        seen.add(held.card);
        out.push({ type: "SPY_TAKE", playerId, card: held.card });
      }
      return;
    }
    case "commercialHarbor": {
      const held = crownPlayer(state, playerId).commodities;
      for (const commodity of COMMODITIES) if (held[commodity] >= 1) out.push({ type: "COMMERCIAL_SWAP", playerId, commodity });
      return;
    }
    case "giveCards": {
      const giver = getPlayer(state, playerId);
      for (const choice of giveChoices(giver.hand, crownPlayer(state, playerId).commodities, prompt.count)) {
        if (commodityTotal(choice.commodities) === 0) out.push({ type: "GIVE_CARDS", playerId, cards: choice.cards });
        else out.push({ type: "GIVE_CARDS", playerId, cards: choice.cards, commodities: choice.commodities });
      }
      return;
    }
    default:
      return;
  }
}
