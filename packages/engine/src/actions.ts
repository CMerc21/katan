/**
 * `applyAction`: the authoritative state transition (docs/phase2.md §2–§3).
 *
 * Never mutates its input. Returns the next state or throws `RuleError`.
 * Module rules (docs/phase10.md, docs/phase11.md) enter through the hook
 * list in `modules/hooks.ts`; the core never tests a scenario flag itself.
 */

import "./modules"; // registers every module's hooks
import { RESOURCES, TERRAIN_RESOURCE, boardGeometry, type Resource } from "./board";
import { RuleError } from "./errors";
import { isBoardEdge, isBoardVertex, type EdgeId, type HexId, type VertexId } from "./geometry";
import { pay, requireBuilder, requireCurrent, requireHand, requirePhase } from "./guards";
import {
  canPlaceRoadOrShip,
  devCardPlayable,
  goldOwedNow,
  isLandEdge,
  isLandVertex,
  isOpenEndShip,
  isSeaEdge,
  legalSetupRoadEdges,
  legalSetupSettlementVertices,
  legalSetupShipEdges,
  pirateEdges,
  pirateEnabled,
  pirateStealTargets,
  roadConnects,
  roadCostOf,
  satisfiesDistanceRule,
  shipConnects,
  stealTargets,
  unbuildableVertices,
} from "./legal";
import { activeModules, type ProduceContext, type RollOutcome } from "./modules/hooks";
import { rng } from "./rng";
import { notifyBuilt, resolveGold, startDiscards, startRoadBuilding, stealRandomCard, upgradeToCity } from "./turnHelpers";
import { updateLargestArmy, updateLongestRoad } from "./specialCards";
import type { GameEvent } from "./events";
import {
  COSTS,
  addHand,
  buildingAt,
  cloneJson,
  collectEvents,
  currentPlayerId,
  edgeOwner,
  emit,
  emptyHand,
  getPlayer,
  handSize,
  hasResources,
  hasWon,
  islandOfVertex,
  ratioAllowed,
  shipOwner,
  tidesOn,
  transfer,
  victoryPoints,
} from "./state";
import { MODULE_ACTION_TYPES, type Action, type ChooseGoldAction, type DevCardType, type DiscardAction, type GameState, type Hand, type MaritimeTradeAction, type MoveRobberAction, type MoveShipAction, type OfferTradeAction, type Phase, type PlayInventionAction, type Player, type PlayerId } from "./types";

// ---------------------------------------------------------------------------
// Roll and production (§6)

type Gain = { playerId: PlayerId; hex: HexId; resource: Resource; count: number };

/** Roll production; returns what gold fields owe each player (§14.3) and what everyone received. */
function produce(state: GameState, total: number): ProduceContext {
  // owed[playerIndex][resource], plus per-hex gains for the event stream.
  const owed = state.players.map(() => emptyHand());
  const gains: Gain[] = [];
  const gold: Record<PlayerId, number> = {};
  const geo = boardGeometry(state.board);
  const hooks = activeModules(state);
  for (const hex of Object.keys(state.board.hexes)) {
    const tile = state.board.hexes[hex];
    if (!tile || tile.token !== total) continue;
    if (hex === state.robberHex) {
      emit(state, { kind: "productionBlocked", hex });
      continue;
    }
    if (hooks.some((h) => h.hexProduces?.(state, hex) === false)) continue;
    const resource = TERRAIN_RESOURCE[tile.terrain];
    if (resource === null && tile.terrain !== "gold") continue;
    for (const v of geo.hexVertices[hex] ?? []) {
      const b = buildingAt(state, v);
      if (!b) continue;
      const idx = state.players.findIndex((p) => p.id === b.owner);
      let count = b.kind === "city" ? 2 : 1;
      for (const h of hooks) {
        const o = h.yieldOverride?.(state, hex, b.owner, b.kind);
        if (o) count = o.resources;
      }
      if (resource === null) {
        gold[b.owner] = (gold[b.owner] ?? 0) + count;
        continue;
      }
      if (count <= 0) continue;
      (owed[idx] as Hand)[resource] += count;
      gains.push({ playerId: b.owner, hex, resource, count });
    }
  }

  // §6.2 bank shortage, one resource at a time.
  const shortfalls: { resource: Resource; playerId: PlayerId | null; count: number }[] = [];
  const paidGains: Gain[] = [];
  for (const r of RESOURCES) {
    const recipients = owed.map((h, i) => ({ i, n: h[r] })).filter((x) => x.n > 0);
    if (recipients.length === 0) continue;
    const totalOwed = recipients.reduce((n, x) => n + x.n, 0);
    if (state.bank[r] >= totalOwed) {
      for (const x of recipients) {
        (state.players[x.i] as Player).hand[r] += x.n;
        state.bank[r] -= x.n;
      }
      paidGains.push(...gains.filter((g) => g.resource === r));
    } else if (recipients.length === 1) {
      const x = recipients[0] as { i: number; n: number };
      const player = state.players[x.i] as Player;
      const paid = state.bank[r];
      player.hand[r] += paid;
      state.bank[r] = 0;
      shortfalls.push({ resource: r, playerId: player.id, count: paid });
      // Attribute the partial payment to the player's hexes in order.
      let left = paid;
      for (const g of gains.filter((x) => x.resource === r)) {
        const count = Math.min(left, g.count);
        if (count > 0) paidGains.push({ ...g, count });
        left -= count;
      }
    } else {
      shortfalls.push({ resource: r, playerId: null, count: 0 });
    }
  }
  if (paidGains.length > 0) emit(state, { kind: "produced", gains: paidGains });
  for (const short of shortfalls) emit(state, { kind: "bankShort", ...short });
  const received: Record<PlayerId, number> = {};
  for (const p of state.players) received[p.id] = 0;
  for (const g of paidGains) received[g.playerId] = (received[g.playerId] ?? 0) + g.count;
  return { received, gold };
}

function applyChooseGold(state: GameState, action: ChooseGoldAction): void {
  const phase = requirePhase(state, "chooseGold");
  const player = getPlayer(state, action.playerId);
  if (phase.owed[action.playerId] === undefined) throw new RuleError("NO_GOLD_OWED", `${action.playerId} is owed no gold`);
  const raw: unknown = action.resources;
  if (!Array.isArray(raw) || !raw.every((r: unknown) => (RESOURCES as readonly unknown[]).includes(r))) throw new RuleError("INVALID_TRADE", "unknown resource");
  const resources = raw as Resource[];
  const want = emptyHand();
  for (const r of resources) want[r] += 1;
  const allowed = goldOwedNow(state, action.playerId);
  if (resources.length !== allowed) throw new RuleError("WRONG_GOLD_COUNT", `choose exactly ${allowed} resources`);
  if (!hasResources(state.bank, want)) throw new RuleError("BANK_EMPTY", "bank cannot supply those resources");
  transfer(state.bank, player.hand, want);
  emit(state, { kind: "goldChosen", playerId: action.playerId, resources: [...resources] });
  const owed = { ...phase.owed };
  delete owed[action.playerId];
  if (Object.keys(owed).length === 0 || handSize(state.bank) === 0) state.phase = phase.returnTo;
  else state.phase = { kind: "chooseGold", owed, returnTo: phase.returnTo };
}

function applyRoll(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "roll");
  const player = requireCurrent(state, playerId);
  const draw = rng(state.seed, state.actionIndex);
  const d1 = draw.int(6) + 1;
  const d2 = draw.int(6) + 1;
  let outcome: RollOutcome = { dice: [d1, d2], total: d1 + d2 };
  const hooks = activeModules(state);
  for (const h of hooks) if (h.roll) outcome = h.roll(state, player, outcome, draw);
  const total = outcome.total;
  state.lastRoll = outcome.dice;
  emit(state, {
    kind: "diceRolled",
    playerId,
    dice: outcome.dice,
    ...(outcome.card ? { card: outcome.card } : {}),
    ...(outcome.red !== undefined ? { red: outcome.red } : {}),
    ...(outcome.event !== undefined ? { event: outcome.event } : {}),
  });

  if (total === 7) {
    const noRobber = hooks.some((h) => h.onSeven?.(state) === "noRobber");
    startDiscards(state, noRobber ? { kind: "action" } : { kind: "moveRobber", via: "seven", returnTo: "action" });
  } else {
    const ctx = produce(state, total);
    for (const h of hooks) h.afterProduction?.(state, total, ctx);
    resolveGold(state, ctx.gold, { kind: "action" });
  }
  for (const h of hooks) if (h.afterRoll?.(state, player, outcome)) break;
}

// ---------------------------------------------------------------------------
// Seven (§7)

function applyDiscard(state: GameState, action: DiscardAction): void {
  const phase = requirePhase(state, "discard");
  const player = getPlayer(state, action.playerId);
  const owed = state.pendingDiscards[action.playerId];
  if (owed === undefined) throw new RuleError("NO_DISCARD_OWED", `${action.playerId} owes no discard`);
  const cards = requireHand(action.cards, "cards");
  // Commodities (docs/phase11.md §1) count too; the crown module moves them.
  let extra = 0;
  if (action.commodities !== undefined) {
    for (const h of activeModules(state)) extra += h.discardExtra?.(state, player, action.commodities, false) ?? 0;
  }
  if (handSize(cards) + extra !== owed) throw new RuleError("WRONG_DISCARD_COUNT", `must discard exactly ${owed}`);
  if (!hasResources(player.hand, cards)) throw new RuleError("INSUFFICIENT_RESOURCES", "not holding those cards");
  transfer(player.hand, state.bank, cards);
  if (action.commodities !== undefined) for (const h of activeModules(state)) h.discardExtra?.(state, player, action.commodities, true);
  delete state.pendingDiscards[action.playerId];
  emit(state, { kind: "discarded", playerId: action.playerId, count: owed, cards, ...(action.commodities !== undefined ? { commodities: action.commodities } : {}) });
  if (Object.keys(state.pendingDiscards).length === 0) state.phase = phase.returnTo;
}

function applyMoveRobber(state: GameState, action: MoveRobberAction): void {
  const phase = requirePhase(state, "moveRobber");
  const playerId = action.playerId;
  requireCurrent(state, playerId);
  const hex = action.hex;
  let targets: PlayerId[];
  if (action.target === "pirate") {
    // §14.5: the pirate sails to another sea hex and robs the ships around it.
    if (!pirateEnabled(state)) throw new RuleError("TIDES_OFF", "there is no pirate in this game");
    if (!state.board.sea.includes(hex)) throw new RuleError("INVALID_HEX", `no such sea hex ${hex}`);
    if (hex === state.pirateHex) throw new RuleError("ROBBER_MUST_MOVE", "pirate must move to a different hex");
    const from = state.pirateHex;
    state.pirateHex = hex;
    emit(state, { kind: "pirateMoved", from, to: hex, by: playerId });
    targets = pirateStealTargets(state, hex, playerId);
  } else {
    if (action.target !== undefined && action.target !== "robber") throw new RuleError("INVALID_HEX", "target must be robber or pirate");
    if (state.board.hexes[hex] === undefined) throw new RuleError("INVALID_HEX", `no such hex ${hex}`);
    if (hex === state.robberHex) throw new RuleError("ROBBER_MUST_MOVE", "robber must move to a different hex");
    const from = state.robberHex;
    state.robberHex = hex;
    emit(state, { kind: "robberMoved", from, to: hex, by: playerId });
    targets = stealTargets(state, hex, playerId);
  }
  state.phase =
    targets.length === 0 ? { kind: phase.returnTo } : { kind: "steal", hex, targets, returnTo: phase.returnTo };
}

function applySteal(state: GameState, playerId: PlayerId, targetPlayerId: PlayerId): void {
  const phase = requirePhase(state, "steal");
  const player = requireCurrent(state, playerId);
  if (!phase.targets.includes(targetPlayerId)) throw new RuleError("INVALID_STEAL_TARGET", "cannot steal from that player");
  const target = getPlayer(state, targetPlayerId);
  stealRandomCard(state, player, target);
  state.phase = { kind: phase.returnTo };
}

// ---------------------------------------------------------------------------
// Building (§5)

function advanceSetup(state: GameState): void {
  const phase = requirePhase(state, "setup");
  const last = state.players.length - 1;
  if (phase.round === 1) {
    if (state.currentPlayer === last) {
      state.phase = { kind: "setup", round: 2, step: "settlement", lastSettlement: null };
    } else {
      state.currentPlayer += 1;
      state.phase = { kind: "setup", round: 1, step: "settlement", lastSettlement: null };
    }
  } else if (state.currentPlayer === 0) {
    state.phase = { kind: "roll" }; // §4.5
    emit(state, { kind: "setupCompleted" });
  } else {
    state.currentPlayer -= 1;
    state.phase = { kind: "setup", round: 2, step: "settlement", lastSettlement: null };
  }
  emit(state, { kind: "turnStarted", playerId: currentPlayerId(state), turn: state.turn });
}

function applyBuildRoad(state: GameState, playerId: PlayerId, edge: EdgeId): void {
  const phase = requirePhase(state, "setup", "action", "roadBuilding", "specialBuild");
  const player = requireBuilder(state, playerId);
  const geo = boardGeometry(state.board);
  if (phase.kind === "setup" && phase.step !== "road") throw new RuleError("WRONG_PHASE", "place a settlement first");
  if (!isBoardEdge(edge, geo) || !isLandEdge(state, edge, geo)) throw new RuleError("INVALID_EDGE", `no such edge ${edge}`);
  if (edgeOwner(state, edge) !== null) throw new RuleError("EDGE_OCCUPIED", `edge ${edge} is occupied`);
  if (phase.kind === "setup") {
    const at = phase.lastSettlement;
    if (at === null || !legalSetupRoadEdges(state, at).includes(edge)) {
      throw new RuleError("ROAD_NOT_CONNECTED", "setup road must touch the new settlement");
    }
  } else if (!roadConnects(state, playerId, edge)) {
    throw new RuleError("ROAD_NOT_CONNECTED", `edge ${edge} is not connected to your network`);
  }
  if (player.pieces.roads <= 0) throw new RuleError("NO_PIECES_LEFT", "no roads left");
  if (phase.kind === "action" || phase.kind === "specialBuild") pay(state, player, roadCostOf(state, edge));

  player.roads.push(edge);
  player.pieces.roads -= 1;
  emit(state, { kind: "built", playerId, piece: "road", at: edge });
  notifyBuilt(state, playerId, "road", edge);
  updateLongestRoad(state);

  if (phase.kind === "setup") {
    advanceSetup(state);
  } else if (phase.kind === "roadBuilding") {
    continueRoadBuilding(state, player, phase.remaining);
  }
}

/** Road Building (§8.2, §14.2): one piece placed; stop when done or nothing else can be placed. */
function continueRoadBuilding(state: GameState, player: Player, remaining: number): void {
  const left = remaining - 1;
  if (left === 0 || !canPlaceRoadOrShip(state, player)) state.phase = { kind: "action" };
  else state.phase = { kind: "roadBuilding", remaining: 1 };
}

/** §14.2: build a ship on a sea edge connected to an own building or ship (never straight to a road). */
function applyBuildShip(state: GameState, playerId: PlayerId, edge: EdgeId): void {
  const phase = requirePhase(state, "setup", "action", "roadBuilding", "specialBuild");
  const player = requireBuilder(state, playerId);
  if (!tidesOn(state)) throw new RuleError("TIDES_OFF", "ships need the Tides module");
  const geo = boardGeometry(state.board);
  if (phase.kind === "setup" && phase.step !== "road") throw new RuleError("WRONG_PHASE", "place a settlement first");
  if (!isBoardEdge(edge, geo) || !isSeaEdge(state, edge, geo)) throw new RuleError("INVALID_EDGE", `no sea at edge ${edge}`);
  if (edgeOwner(state, edge) !== null) throw new RuleError("EDGE_OCCUPIED", `edge ${edge} is occupied`);
  if (pirateEdges(state, geo).has(edge)) throw new RuleError("PIRATE_BLOCKS", "the pirate blocks that edge");
  if (phase.kind === "setup") {
    const at = phase.lastSettlement;
    if (at === null || !legalSetupShipEdges(state, at).includes(edge)) {
      throw new RuleError("SHIP_NOT_CONNECTED", "setup ship must touch the new settlement");
    }
  } else if (!shipConnects(state, playerId, edge)) {
    throw new RuleError("SHIP_NOT_CONNECTED", `edge ${edge} is not connected to your ships or buildings`);
  }
  if (player.pieces.ships <= 0) throw new RuleError("NO_PIECES_LEFT", "no ships left");
  if (phase.kind === "action" || phase.kind === "specialBuild") pay(state, player, COSTS.ship);

  player.ships.push(edge);
  player.shipsBuiltThisTurn.push(edge);
  player.pieces.ships -= 1;
  emit(state, { kind: "shipBuilt", playerId, at: edge });
  notifyBuilt(state, playerId, "ship", edge);
  updateLongestRoad(state);

  if (phase.kind === "setup") {
    advanceSetup(state);
  } else if (phase.kind === "roadBuilding") {
    continueRoadBuilding(state, player, phase.remaining);
  }
}

/** §14.2: once per turn, move the ship at the open end of a route. */
function applyMoveShip(state: GameState, action: MoveShipAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  if (!tidesOn(state)) throw new RuleError("TIDES_OFF", "ships need the Tides module");
  const { from, to } = action;
  const geo = boardGeometry(state.board);
  if (shipOwner(state, from) !== player.id) throw new RuleError("NOT_YOUR_SHIP", `no ship of yours at ${from}`);
  if (player.shipMovedThisTurn) throw new RuleError("SHIP_ALREADY_MOVED", "only one ship may move per turn");
  if (player.shipsBuiltThisTurn.includes(from)) throw new RuleError("SHIP_TOO_NEW", "a ship built this turn cannot move");
  const pirate = pirateEdges(state, geo);
  if (pirate.has(from)) throw new RuleError("PIRATE_BLOCKS", "the pirate holds that ship in place");
  if (!isOpenEndShip(state, player.id, from)) throw new RuleError("NOT_OPEN_END", "only the ship at the open end of a route may move");
  if (to === from) throw new RuleError("INVALID_EDGE", "the ship must move somewhere else");
  if (!isBoardEdge(to, geo) || !isSeaEdge(state, to, geo)) throw new RuleError("INVALID_EDGE", `no sea at edge ${to}`);
  if (edgeOwner(state, to) !== null) throw new RuleError("EDGE_OCCUPIED", `edge ${to} is occupied`);
  if (pirate.has(to)) throw new RuleError("PIRATE_BLOCKS", "the pirate blocks that edge");
  if (!shipConnects(state, player.id, to, from)) throw new RuleError("SHIP_NOT_CONNECTED", `edge ${to} is not connected to your ships or buildings`);

  player.ships.splice(player.ships.indexOf(from), 1);
  player.ships.push(to);
  player.shipMovedThisTurn = true;
  emit(state, { kind: "shipMoved", playerId: player.id, from, to });
  updateLongestRoad(state);
}

/** §4.3: one resource per producing hex adjacent to the second settlement; gold fields owe a choice (§14.3). */
function grantStartingResources(state: GameState, player: Player, vertex: VertexId): number {
  const gains: Gain[] = [];
  let gold = 0;
  for (const h of boardGeometry(state.board).vertexHexes[vertex] ?? []) {
    const tile = state.board.hexes[h];
    if (!tile) continue;
    if (tile.terrain === "gold") {
      gold += 1;
      continue;
    }
    const resource = TERRAIN_RESOURCE[tile.terrain];
    if (resource === null || state.bank[resource] <= 0) continue;
    if (state.board.oases.includes(h)) continue; // an oasis yields spice or nothing (docs/phase10.md §6)
    state.bank[resource] -= 1;
    player.hand[resource] += 1;
    gains.push({ playerId: player.id, hex: h, resource, count: 1 });
  }
  if (gains.length > 0) emit(state, { kind: "produced", gains });
  return gold;
}

function applyBuildSettlement(state: GameState, playerId: PlayerId, vertex: VertexId): void {
  const phase = requirePhase(state, "setup", "action", "specialBuild");
  const player = requireBuilder(state, playerId);
  const geo = boardGeometry(state.board);
  if (phase.kind === "setup" && phase.step !== "settlement") throw new RuleError("WRONG_PHASE", "place the road first");
  if (!isBoardVertex(vertex, geo) || !isLandVertex(state, vertex, geo)) throw new RuleError("INVALID_VERTEX", `no such vertex ${vertex}`);
  if (phase.kind === "setup" && !legalSetupSettlementVertices(state).includes(vertex)) {
    throw new RuleError(buildingAt(state, vertex) ? "VERTEX_OCCUPIED" : satisfiesDistanceRule(state, vertex) ? "INVALID_VERTEX" : "DISTANCE_RULE", `cannot start at ${vertex}`);
  }
  if (buildingAt(state, vertex) !== null) throw new RuleError("VERTEX_OCCUPIED", `vertex ${vertex} is occupied`);
  if (unbuildableVertices(state, playerId).has(vertex)) throw new RuleError("VERTEX_HAS_KNIGHT", `a knight stands at ${vertex}`);
  if (!satisfiesDistanceRule(state, vertex)) throw new RuleError("DISTANCE_RULE", `vertex ${vertex} is too close`);
  if (phase.kind !== "setup") {
    const touchesOwn = (geo.vertexEdges[vertex] ?? []).some((e) => edgeOwner(state, e) === playerId);
    if (!touchesOwn) throw new RuleError("NOT_CONNECTED_TO_ROAD", "settlement must touch one of your roads or ships");
  }
  if (player.pieces.settlements <= 0) throw new RuleError("NO_PIECES_LEFT", "no settlements left");
  if (phase.kind !== "setup") pay(state, player, COSTS.settlement);

  player.settlements.push(vertex);
  player.pieces.settlements -= 1;
  emit(state, { kind: "built", playerId, piece: "settlement", at: vertex });
  notifyBuilt(state, playerId, "settlement", vertex);
  updateLongestRoad(state); // an opponent's road may have been cut

  const island = islandOfVertex(state, vertex);
  if (phase.kind === "setup") {
    if (island !== null && !player.startIslands.includes(island)) player.startIslands.push(island);
    for (const h of activeModules(state)) h.onSetupSettlement?.(state, player, vertex, phase.round);
    const next: Phase = { kind: "setup", round: phase.round, step: "road", lastSettlement: vertex };
    const gold = phase.round === 2 ? grantStartingResources(state, player, vertex) : 0;
    resolveGold(state, { [playerId]: gold }, next);
    return;
  }
  // §14.4: first settlement on an island the player did not start on.
  const bonus = state.scenario?.islandBonus ?? 0;
  if (bonus > 0 && island !== null && !player.startIslands.includes(island) && !player.islandChips.includes(island)) {
    player.islandChips.push(island);
    emit(state, { kind: "islandSettled", playerId, island, bonus });
  }
}

function applyBuildCity(state: GameState, playerId: PlayerId, vertex: VertexId): void {
  requirePhase(state, "action", "specialBuild");
  const player = requireBuilder(state, playerId);
  const idx = player.settlements.indexOf(vertex);
  if (idx < 0) throw new RuleError("NOT_YOUR_SETTLEMENT", `no settlement of yours at ${vertex}`);
  if (player.pieces.cities <= 0) throw new RuleError("NO_PIECES_LEFT", "no cities left");
  pay(state, player, COSTS.city);
  upgradeToCity(state, player, vertex);
}

// ---------------------------------------------------------------------------
// Development cards (§8)

function applyBuyDevCard(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "action", "specialBuild");
  const player = requireBuilder(state, playerId);
  if (state.devDeck.length === 0) throw new RuleError("DECK_EMPTY", "no development cards left");
  pay(state, player, COSTS.devCard);
  const type = state.devDeck.shift() as DevCardType;
  player.devCards.push({ type, boughtOnTurn: state.turn });
  emit(state, { kind: "devCardBought", playerId, card: type });
}

function playDevCard(state: GameState, player: Player, type: DevCardType): void {
  const check = devCardPlayable(state, player, type);
  if (check !== "ok") throw new RuleError(check, `cannot play ${type}: ${check}`);
  const idx = player.devCards.findIndex((c) => c.type === type && c.boughtOnTurn < state.turn);
  player.devCards.splice(idx, 1);
  player.devCardPlayedThisTurn = true;
  emit(state, { kind: "devCardPlayed", playerId: player.id, card: type });
}

function applyPlayKnight(state: GameState, playerId: PlayerId): void {
  const phase = requirePhase(state, "roll", "action");
  const player = requireCurrent(state, playerId);
  playDevCard(state, player, "knight");
  player.playedKnights += 1;
  updateLargestArmy(state);
  state.phase = { kind: "moveRobber", via: "knight", returnTo: phase.kind };
}

function applyPlayRoadBuilding(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, playerId);
  const check = devCardPlayable(state, player, "roadBuilding");
  if (check !== "ok") throw new RuleError(check, `cannot play roadBuilding: ${check}`);
  if (!canPlaceRoadOrShip(state, player)) {
    if (player.pieces.roads <= 0 && (!tidesOn(state) || player.pieces.ships <= 0)) throw new RuleError("NO_PIECES_LEFT", "no roads left");
    throw new RuleError("NO_LEGAL_ROAD", "nowhere to build a road");
  }
  playDevCard(state, player, "roadBuilding");
  startRoadBuilding(state, player);
}

function applyPlayInvention(state: GameState, action: PlayInventionAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const [a, b] = action.resources;
  if (!RESOURCES.includes(a) || !RESOURCES.includes(b)) throw new RuleError("INVALID_TRADE", "unknown resource");
  const want = emptyHand();
  want[a] += 1;
  want[b] += 1;
  const check = devCardPlayable(state, player, "invention");
  if (check !== "ok") throw new RuleError(check, `cannot play invention: ${check}`);
  if (!hasResources(state.bank, want)) throw new RuleError("BANK_EMPTY", "bank cannot supply those resources");
  playDevCard(state, player, "invention");
  transfer(state.bank, player.hand, want);
  emit(state, { kind: "inventionTaken", playerId: action.playerId, resources: [a, b] });
}

function applyPlayMonopoly(state: GameState, playerId: PlayerId, resource: Resource): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, playerId);
  if (!RESOURCES.includes(resource)) throw new RuleError("INVALID_TRADE", "unknown resource");
  playDevCard(state, player, "monopoly");
  const taken: Record<PlayerId, number> = {};
  for (const other of state.players) {
    if (other.id === playerId) continue;
    taken[other.id] = other.hand[resource];
    player.hand[resource] += other.hand[resource];
    other.hand[resource] = 0;
  }
  emit(state, { kind: "monopolised", playerId, resource, taken });
}

// ---------------------------------------------------------------------------
// Trading (§9)

function applyOfferTrade(state: GameState, action: OfferTradeAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  if (state.pendingTrade) throw new RuleError("TRADE_ALREADY_PENDING", "a trade is already pending");
  const give = requireHand(action.give, "give");
  const receive = requireHand(action.receive, "receive");
  if (handSize(give) === 0 || handSize(receive) === 0) throw new RuleError("EMPTY_TRADE", "both sides must be non-empty");
  if (RESOURCES.some((r) => give[r] > 0 && receive[r] > 0)) {
    throw new RuleError("INVALID_TRADE", "a resource cannot be on both sides");
  }
  if (!hasResources(player.hand, give)) throw new RuleError("INSUFFICIENT_RESOURCES", "you do not hold those cards");
  if (action.boot === true) {
    // docs/phase10.md §2: only the boot's holder may attach it; the module checks that when the trade completes.
    if (state.wayfarers?.fishing?.boot !== action.playerId) throw new RuleError("NO_BOOT", "you do not hold the old boot");
  }
  state.pendingTrade = { from: action.playerId, give, receive, rejectedBy: [], ...(action.boot === true ? { boot: true } : {}) };
  emit(state, { kind: "tradeOffered", playerId: action.playerId, give, receive });
}

function applyAcceptTrade(state: GameState, playerId: PlayerId, boot: boolean): void {
  requirePhase(state, "action");
  const acceptor = getPlayer(state, playerId);
  const trade = state.pendingTrade;
  if (!trade || trade.rejectedBy.includes(playerId)) throw new RuleError("NO_PENDING_TRADE", "no trade to accept");
  if (trade.from === playerId) throw new RuleError("INVALID_TRADE", "cannot accept your own offer");
  const offerer = getPlayer(state, trade.from);
  if (!hasResources(acceptor.hand, trade.receive)) throw new RuleError("INSUFFICIENT_RESOURCES", "you cannot pay");
  if (!hasResources(offerer.hand, trade.give)) throw new RuleError("INSUFFICIENT_RESOURCES", "offerer can no longer pay");
  transfer(offerer.hand, acceptor.hand, trade.give);
  transfer(acceptor.hand, offerer.hand, trade.receive);
  state.pendingTrade = null;
  emit(state, { kind: "tradeAccepted", from: trade.from, to: playerId, give: trade.give, receive: trade.receive });
  if (trade.boot === true || boot) {
    const handled = activeModules(state).some((h) => {
      if (!h.onTradeAccepted) return false;
      h.onTradeAccepted(state, offerer, acceptor, { offer: trade.boot === true, accept: boot });
      return true;
    });
    if (!handled) throw new RuleError("MODULE_OFF", "there is no old boot in this game");
  }
}

function applyRejectTrade(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "action");
  const player = getPlayer(state, playerId);
  const trade = state.pendingTrade;
  if (!trade || trade.rejectedBy.includes(playerId)) throw new RuleError("NO_PENDING_TRADE", "no trade to reject");
  if (trade.from === playerId) throw new RuleError("INVALID_TRADE", "cancel your own offer instead");
  trade.rejectedBy.push(playerId);
  void player;
  emit(state, { kind: "tradeDeclined", playerId, from: trade.from });
  if (trade.rejectedBy.length >= state.players.length - 1) {
    state.pendingTrade = null;
    emit(state, { kind: "tradeCancelled", playerId: trade.from, reason: "everyoneDeclined" });
  }
}

function applyCancelTrade(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, playerId);
  if (!state.pendingTrade || state.pendingTrade.from !== playerId) {
    throw new RuleError("NO_PENDING_TRADE", "no trade of yours to cancel");
  }
  state.pendingTrade = null;
  void player;
  emit(state, { kind: "tradeCancelled", playerId, reason: "withdrawn" });
}

function applyMaritimeTrade(state: GameState, action: MaritimeTradeAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const { give, giveCount, receive } = action;
  if (give === receive) throw new RuleError("INVALID_TRADE", "bad maritime trade");
  if (![4, 3, 2].includes(giveCount)) throw new RuleError("BAD_TRADE_RATIO", "ratio must be 4, 3 or 2");
  // Modules may take the whole trade (commodities, the merchant, docs/phase11.md §1, §4).
  for (const h of activeModules(state)) {
    if (h.maritime?.(state, player, give, giveCount, receive)) {
      emit(state, { kind: "maritimeTrade", playerId: action.playerId, give, count: giveCount, receive });
      return;
    }
  }
  if (!RESOURCES.includes(give as Resource) || !RESOURCES.includes(receive as Resource)) {
    throw new RuleError("INVALID_TRADE", "bad maritime trade");
  }
  const g = give as Resource;
  const r = receive as Resource;
  if (!ratioAllowed(state, player, g, giveCount)) {
    throw new RuleError("BAD_TRADE_RATIO", `you may not trade ${give} at ${giveCount}:1`);
  }
  if (player.hand[g] < giveCount) throw new RuleError("INSUFFICIENT_RESOURCES", `need ${giveCount} ${give}`);
  if (state.bank[r] < 1) throw new RuleError("BANK_EMPTY", `bank has no ${receive}`);
  player.hand[g] -= giveCount;
  state.bank[g] += giveCount;
  state.bank[r] -= 1;
  player.hand[r] += 1;
  emit(state, { kind: "maritimeTrade", playerId: action.playerId, give, count: giveCount, receive });
}

// ---------------------------------------------------------------------------
// End turn (§6.3)

function applyEndTurn(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, playerId);
  if (state.pendingTrade) {
    state.pendingTrade = null;
    emit(state, { kind: "tradeCancelled", playerId, reason: "turnEnded" });
  }
  emit(state, { kind: "turnEnded", playerId });
  for (const h of activeModules(state)) h.onTurnEnd?.(state, player);
  // docs/phase8.md §5: with 5–6 players every other player gets a special build before the next roll.
  if (state.players.length > 4) {
    const n = state.players.length;
    const order: PlayerId[] = [];
    for (let step = 1; step < n; step++) order.push((state.players[(state.currentPlayer + step) % n] as Player).id);
    state.phase = { kind: "specialBuild", order, index: 0 };
    emit(state, { kind: "specialBuildTurn", playerId: order[0] as PlayerId });
    return;
  }
  startNextTurn(state);
}

function startNextTurn(state: GameState): void {
  for (const p of state.players) {
    p.devCardPlayedThisTurn = false;
    p.shipsBuiltThisTurn = [];
    p.shipMovedThisTurn = false;
  }
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.turn += 1;
  state.phase = { kind: "roll" };
  for (const h of activeModules(state)) h.onTurnStart?.(state);
  emit(state, { kind: "turnStarted", playerId: currentPlayerId(state), turn: state.turn });
}

function applySpecialBuildDone(state: GameState, playerId: PlayerId): void {
  const phase = requirePhase(state, "specialBuild");
  requireBuilder(state, playerId);
  const index = phase.index + 1;
  if (index >= phase.order.length) {
    startNextTurn(state);
    return;
  }
  state.phase = { kind: "specialBuild", order: phase.order, index };
  emit(state, { kind: "specialBuildTurn", playerId: phase.order[index] as PlayerId });
}

// ---------------------------------------------------------------------------

/** An offer the offerer can no longer cover is withdrawn automatically. */
function expireUnpayableTrade(state: GameState): void {
  const trade = state.pendingTrade;
  if (trade && !hasResources(getPlayer(state, trade.from).hand, trade.give)) {
    state.pendingTrade = null;
    emit(state, { kind: "tradeCancelled", playerId: trade.from, reason: "unpayable" });
  }
}

/** §11: only the current player can win, checked after every action. */
function checkWin(state: GameState): void {
  if (state.phase.kind === "ended" || state.phase.kind === "setup") return;
  const player = state.players[state.currentPlayer];
  if (player && hasWon(state, player)) {
    state.winner = player.id;
    state.phase = { kind: "ended" };
    const scores: Record<PlayerId, number> = {};
    for (const p of state.players) scores[p.id] = victoryPoints(state, p).total;
    emit(state, { kind: "gameEnded", winner: player.id, scores });
  }
}

/**
 * Apply `action` to `state` and return the new state together with the
 * events it produced (docs/phase7.md §1.1). Throws `RuleError` if the
 * action is illegal; the input state is never modified.
 */
export function applyActionWithEvents(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const { result, events } = collectEvents(() => applyCore(state, action));
  return { state: result, events };
}

/** Apply `action` and return only the new state (the Phase 2 contract). */
export function applyAction(state: GameState, action: Action): GameState {
  return applyActionWithEvents(state, action).state;
}

function applyCore(state: GameState, action: Action): GameState {
  const next = cloneJson(state);
  if (next.phase.kind === "ended") throw new RuleError("GAME_OVER", "the game is over");
  getPlayer(next, action.playerId);

  switch (action.type) {
    case "ROLL":
      applyRoll(next, action.playerId);
      break;
    case "DISCARD":
      applyDiscard(next, action);
      break;
    case "MOVE_ROBBER":
      applyMoveRobber(next, action);
      break;
    case "STEAL":
      applySteal(next, action.playerId, action.targetPlayerId);
      break;
    case "BUILD_ROAD":
      applyBuildRoad(next, action.playerId, action.edge);
      break;
    case "BUILD_SETTLEMENT":
      applyBuildSettlement(next, action.playerId, action.vertex);
      break;
    case "BUILD_CITY":
      applyBuildCity(next, action.playerId, action.vertex);
      break;
    case "BUY_DEV_CARD":
      applyBuyDevCard(next, action.playerId);
      break;
    case "PLAY_KNIGHT":
      applyPlayKnight(next, action.playerId);
      break;
    case "PLAY_ROAD_BUILDING":
      applyPlayRoadBuilding(next, action.playerId);
      break;
    case "PLAY_INVENTION":
      applyPlayInvention(next, action);
      break;
    case "PLAY_MONOPOLY":
      applyPlayMonopoly(next, action.playerId, action.resource);
      break;
    case "OFFER_TRADE":
      applyOfferTrade(next, action);
      break;
    case "ACCEPT_TRADE":
      applyAcceptTrade(next, action.playerId, action.boot === true);
      break;
    case "REJECT_TRADE":
      applyRejectTrade(next, action.playerId);
      break;
    case "CANCEL_TRADE":
      applyCancelTrade(next, action.playerId);
      break;
    case "MARITIME_TRADE":
      applyMaritimeTrade(next, action);
      break;
    case "END_TURN":
      applyEndTurn(next, action.playerId);
      break;
    case "SPECIAL_BUILD_DONE":
      applySpecialBuildDone(next, action.playerId);
      break;
    case "BUILD_SHIP":
      applyBuildShip(next, action.playerId, action.edge);
      break;
    case "MOVE_SHIP":
      applyMoveShip(next, action);
      break;
    case "CHOOSE_GOLD":
      applyChooseGold(next, action);
      break;
    case "NEIGHBORLY_GIVE":
    case "SPEND_FISH":
    case "BUILD_KNIGHT":
    case "BUILD_CASTLE":
    case "REBUILD_HEX":
    case "EXTEND_CARAVAN":
    case "MOVE_WAGON":
    case "LOAD_COMMODITY":
    case "DELIVER":
    case "ACTIVATE_KNIGHT":
    case "PROMOTE_KNIGHT":
    case "KNIGHT_MOVE":
    case "KNIGHT_DISPLACE":
    case "KNIGHT_CHASE_ROBBER":
    case "BUILD_IMPROVEMENT":
    case "BUILD_WALL":
    case "PLAY_PROGRESS":
    case "DISCARD_PROGRESS":
    case "CHOOSE_DOWNGRADE":
    case "PLACE_METROPOLIS":
    case "CHOOSE_DESERTER":
    case "PLACE_FREE_KNIGHT":
    case "RETREAT_KNIGHT":
    case "SPY_TAKE":
    case "COMMERCIAL_SWAP":
    case "GIVE_CARDS": {
      // Module actions (docs/phase10.md, docs/phase11.md §9): the first enabled module that owns the action applies it.
      const handled = activeModules(next).some((h) => h.apply?.(next, action) === true);
      if (!handled) throw new RuleError("MODULE_OFF", `${action.type} needs a module that is not on in this game`);
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown action ${JSON.stringify(exhaustive)}`);
    }
  }

  next.actionIndex += 1;
  expireUnpayableTrade(next);
  checkWin(next);
  return next;
}

/** Replay an action log from a fresh state (§12). */
export function replay(initial: GameState, actions: readonly Action[]): GameState {
  let state = initial;
  for (const action of actions) state = applyAction(state, action);
  return state;
}

// Re-exported for convenience so callers can compute hand-side helpers.
export { addHand, MODULE_ACTION_TYPES };
