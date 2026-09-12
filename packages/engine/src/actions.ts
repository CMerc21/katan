/**
 * `applyAction`: the authoritative state transition (docs/phase2.md §2–§3).
 *
 * Never mutates its input. Returns the next state or throws `RuleError`.
 */

import { RESOURCES, TERRAIN_RESOURCE, boardGeometry, type Resource } from "./board";
import { RuleError } from "./errors";
import { isBoardEdge, isBoardVertex, type EdgeId, type HexId, type VertexId } from "./geometry";
import {
  devCardPlayable,
  isLandEdge,
  isLandVertex,
  legalRoadEdges,
  legalSetupRoadEdges,
  legalSetupSettlementVertices,
  roadConnects,
  satisfiesDistanceRule,
  stealTargets,
  discardOwed,
} from "./legal";
import { rng } from "./rng";
import { updateLargestArmy, updateLongestRoad } from "./specialCards";
import type { GameEvent } from "./events";
import {
  COSTS,
  addHand,
  buildingAt,
  cloneJson,
  collectEvents,
  currentPlayerId,
  emit,
  emptyHand,
  expandHand,
  getPlayer,
  handSize,
  hasResources,
  hasWon,
  isValidHand,
  ratioAllowed,
  roadOwner,
  transfer,
  victoryPoints,
} from "./state";
import type {
  Action,
  DevCardType,
  DiscardAction,
  GameState,
  Hand,
  MaritimeTradeAction,
  OfferTradeAction,
  Phase,
  PlayInventionAction,
  Player,
  PlayerId,
} from "./types";

type PhaseOf<K extends Phase["kind"]> = Extract<Phase, { kind: K }>;

function requirePhase<K extends Phase["kind"]>(state: GameState, ...kinds: K[]): PhaseOf<K> {
  const phase = state.phase;
  if (!(kinds as string[]).includes(phase.kind)) {
    throw new RuleError("WRONG_PHASE", `${phase.kind} phase does not allow this action`);
  }
  return phase as PhaseOf<K>;
}

function requireCurrent(state: GameState, playerId: PlayerId): Player {
  const player = getPlayer(state, playerId);
  if (currentPlayerId(state) !== playerId) throw new RuleError("NOT_YOUR_TURN", `it is not ${playerId}'s turn`);
  return player;
}

/** The player who may build right now: the current player, or the special builder (docs/phase8.md §5). */
function requireBuilder(state: GameState, playerId: PlayerId): Player {
  if (state.phase.kind === "specialBuild") {
    const player = getPlayer(state, playerId);
    if (state.phase.order[state.phase.index] !== playerId) throw new RuleError("NOT_YOUR_TURN", `it is not ${playerId}'s special build`);
    return player;
  }
  return requireCurrent(state, playerId);
}

function pay(state: GameState, player: Player, cost: Hand): void {
  if (!hasResources(player.hand, cost)) throw new RuleError("INSUFFICIENT_RESOURCES", "cannot afford this");
  transfer(player.hand, state.bank, cost);
}

function requireHand(value: unknown, what: string): Hand {
  if (!isValidHand(value)) throw new RuleError("INVALID_TRADE", `${what} is not a valid hand`);
  return value;
}

// ---------------------------------------------------------------------------
// Roll and production (§6)

type Gain = { playerId: PlayerId; hex: HexId; resource: Resource; count: number };

function produce(state: GameState, total: number): void {
  // owed[playerIndex][resource], plus per-hex gains for the event stream.
  const owed = state.players.map(() => emptyHand());
  const gains: Gain[] = [];
  const geo = boardGeometry(state.board);
  for (const hex of Object.keys(state.board.hexes)) {
    const tile = state.board.hexes[hex];
    if (!tile || tile.token !== total) continue;
    if (hex === state.robberHex) {
      emit(state, { kind: "productionBlocked", hex });
      continue;
    }
    const resource = TERRAIN_RESOURCE[tile.terrain];
    if (resource === null) continue;
    for (const v of geo.hexVertices[hex] ?? []) {
      const b = buildingAt(state, v);
      if (!b) continue;
      const idx = state.players.findIndex((p) => p.id === b.owner);
      const count = b.kind === "city" ? 2 : 1;
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
}

function applyRoll(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "roll");
  const player = requireCurrent(state, playerId);
  const dice = rng(state.seed, state.actionIndex);
  const d1 = dice.int(6) + 1;
  const d2 = dice.int(6) + 1;
  const total = d1 + d2;
  state.lastRoll = [d1, d2];
  void player;
  emit(state, { kind: "diceRolled", playerId, dice: [d1, d2] });

  if (total === 7) {
    const pending: Record<PlayerId, number> = {};
    for (const p of state.players) {
      const owed = discardOwed(handSize(p.hand));
      if (owed > 0) pending[p.id] = owed;
    }
    state.pendingDiscards = pending;
    state.phase =
      Object.keys(pending).length > 0
        ? { kind: "discard" }
        : { kind: "moveRobber", via: "seven", returnTo: "action" };
    return;
  }

  produce(state, total);
  state.phase = { kind: "action" };
}

// ---------------------------------------------------------------------------
// Seven (§7)

function applyDiscard(state: GameState, action: DiscardAction): void {
  requirePhase(state, "discard");
  const player = getPlayer(state, action.playerId);
  const owed = state.pendingDiscards[action.playerId];
  if (owed === undefined) throw new RuleError("NO_DISCARD_OWED", `${action.playerId} owes no discard`);
  const cards = requireHand(action.cards, "cards");
  if (handSize(cards) !== owed) throw new RuleError("WRONG_DISCARD_COUNT", `must discard exactly ${owed}`);
  if (!hasResources(player.hand, cards)) throw new RuleError("INSUFFICIENT_RESOURCES", "not holding those cards");
  transfer(player.hand, state.bank, cards);
  delete state.pendingDiscards[action.playerId];
  emit(state, { kind: "discarded", playerId: action.playerId, count: owed, cards });
  if (Object.keys(state.pendingDiscards).length === 0) {
    state.phase = { kind: "moveRobber", via: "seven", returnTo: "action" };
  }
}

function applyMoveRobber(state: GameState, playerId: PlayerId, hex: HexId): void {
  const phase = requirePhase(state, "moveRobber");
  const player = requireCurrent(state, playerId);
  if (state.board.hexes[hex] === undefined) throw new RuleError("INVALID_HEX", `no such hex ${hex}`);
  if (hex === state.robberHex) throw new RuleError("ROBBER_MUST_MOVE", "robber must move to a different hex");
  void player;
  const from = state.robberHex;
  state.robberHex = hex;
  emit(state, { kind: "robberMoved", from, to: hex, by: playerId });
  const targets = stealTargets(state, hex, playerId);
  state.phase =
    targets.length === 0 ? { kind: phase.returnTo } : { kind: "steal", hex, targets, returnTo: phase.returnTo };
}

function applySteal(state: GameState, playerId: PlayerId, targetPlayerId: PlayerId): void {
  const phase = requirePhase(state, "steal");
  const player = requireCurrent(state, playerId);
  if (!phase.targets.includes(targetPlayerId)) throw new RuleError("INVALID_STEAL_TARGET", "cannot steal from that player");
  const target = getPlayer(state, targetPlayerId);
  const cards = expandHand(target.hand);
  const pick = cards[rng(state.seed, state.actionIndex).int(cards.length)] as Resource;
  target.hand[pick] -= 1;
  player.hand[pick] += 1;
  emit(state, { kind: "stole", from: targetPlayerId, to: playerId, resource: pick });
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
  if (roadOwner(state, edge) !== null) throw new RuleError("EDGE_OCCUPIED", `edge ${edge} is occupied`);
  if (phase.kind === "setup") {
    const at = phase.lastSettlement;
    if (at === null || !legalSetupRoadEdges(state, at).includes(edge)) {
      throw new RuleError("ROAD_NOT_CONNECTED", "setup road must touch the new settlement");
    }
  } else if (!roadConnects(state, playerId, edge)) {
    throw new RuleError("ROAD_NOT_CONNECTED", `edge ${edge} is not connected to your network`);
  }
  if (player.pieces.roads <= 0) throw new RuleError("NO_PIECES_LEFT", "no roads left");
  if (phase.kind === "action" || phase.kind === "specialBuild") pay(state, player, COSTS.road);

  player.roads.push(edge);
  player.pieces.roads -= 1;
  emit(state, { kind: "built", playerId, piece: "road", at: edge });
  updateLongestRoad(state);

  if (phase.kind === "setup") {
    advanceSetup(state);
  } else if (phase.kind === "roadBuilding") {
    const remaining = phase.remaining - 1;
    if (remaining === 0 || player.pieces.roads === 0 || legalRoadEdges(state, playerId).length === 0) {
      state.phase = { kind: "action" };
    } else {
      state.phase = { kind: "roadBuilding", remaining: 1 };
    }
  }
}

/** §4.3: one resource per producing hex adjacent to the second settlement. */
function grantStartingResources(state: GameState, player: Player, vertex: VertexId): void {
  const gains: Gain[] = [];
  for (const h of boardGeometry(state.board).vertexHexes[vertex] ?? []) {
    const tile = state.board.hexes[h];
    if (!tile) continue;
    const resource = TERRAIN_RESOURCE[tile.terrain];
    if (resource === null || state.bank[resource] <= 0) continue;
    state.bank[resource] -= 1;
    player.hand[resource] += 1;
    gains.push({ playerId: player.id, hex: h, resource, count: 1 });
  }
  if (gains.length > 0) emit(state, { kind: "produced", gains });
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
  if (!satisfiesDistanceRule(state, vertex)) throw new RuleError("DISTANCE_RULE", `vertex ${vertex} is too close`);
  if (phase.kind !== "setup") {
    const touchesOwnRoad = (geo.vertexEdges[vertex] ?? []).some((e) => roadOwner(state, e) === playerId);
    if (!touchesOwnRoad) throw new RuleError("NOT_CONNECTED_TO_ROAD", "settlement must touch one of your roads");
  }
  if (player.pieces.settlements <= 0) throw new RuleError("NO_PIECES_LEFT", "no settlements left");
  if (phase.kind !== "setup") pay(state, player, COSTS.settlement);

  player.settlements.push(vertex);
  player.pieces.settlements -= 1;
  emit(state, { kind: "built", playerId, piece: "settlement", at: vertex });
  updateLongestRoad(state); // an opponent's road may have been cut

  if (phase.kind === "setup") {
    if (phase.round === 2) grantStartingResources(state, player, vertex);
    state.phase = { kind: "setup", round: phase.round, step: "road", lastSettlement: vertex };
  }
}

function applyBuildCity(state: GameState, playerId: PlayerId, vertex: VertexId): void {
  requirePhase(state, "action", "specialBuild");
  const player = requireBuilder(state, playerId);
  const idx = player.settlements.indexOf(vertex);
  if (idx < 0) throw new RuleError("NOT_YOUR_SETTLEMENT", `no settlement of yours at ${vertex}`);
  if (player.pieces.cities <= 0) throw new RuleError("NO_PIECES_LEFT", "no cities left");
  pay(state, player, COSTS.city);
  player.settlements.splice(idx, 1);
  player.cities.push(vertex);
  player.pieces.cities -= 1;
  player.pieces.settlements += 1; // §5.4
  emit(state, { kind: "built", playerId, piece: "city", at: vertex });
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
  if (player.pieces.roads <= 0) throw new RuleError("NO_PIECES_LEFT", "no roads left");
  if (legalRoadEdges(state, playerId).length === 0) throw new RuleError("NO_LEGAL_ROAD", "nowhere to build a road");
  playDevCard(state, player, "roadBuilding");
  state.phase = { kind: "roadBuilding", remaining: player.pieces.roads >= 2 ? 2 : 1 };
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
  state.pendingTrade = { from: action.playerId, give, receive, rejectedBy: [] };
  emit(state, { kind: "tradeOffered", playerId: action.playerId, give, receive });
}

function applyAcceptTrade(state: GameState, playerId: PlayerId): void {
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
  if (!RESOURCES.includes(give) || !RESOURCES.includes(receive) || give === receive) {
    throw new RuleError("INVALID_TRADE", "bad maritime trade");
  }
  if (![4, 3, 2].includes(giveCount) || !ratioAllowed(state, player, give, giveCount)) {
    throw new RuleError("BAD_TRADE_RATIO", `you may not trade ${give} at ${giveCount}:1`);
  }
  if (player.hand[give] < giveCount) throw new RuleError("INSUFFICIENT_RESOURCES", `need ${giveCount} ${give}`);
  if (state.bank[receive] < 1) throw new RuleError("BANK_EMPTY", `bank has no ${receive}`);
  player.hand[give] -= giveCount;
  state.bank[give] += giveCount;
  state.bank[receive] -= 1;
  player.hand[receive] += 1;
  emit(state, { kind: "maritimeTrade", playerId: action.playerId, give, count: giveCount, receive });
}

// ---------------------------------------------------------------------------
// End turn (§6.3)

function applyEndTurn(state: GameState, playerId: PlayerId): void {
  requirePhase(state, "action");
  requireCurrent(state, playerId);
  if (state.pendingTrade) {
    state.pendingTrade = null;
    emit(state, { kind: "tradeCancelled", playerId, reason: "turnEnded" });
  }
  emit(state, { kind: "turnEnded", playerId });
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
  for (const p of state.players) p.devCardPlayedThisTurn = false;
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.turn += 1;
  state.phase = { kind: "roll" };
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
      applyMoveRobber(next, action.playerId, action.hex);
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
      applyAcceptTrade(next, action.playerId);
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
export { addHand };
