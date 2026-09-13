/**
 * Wayfarers: Fishing (docs/phase10.md §2).
 *
 * A lake hex and coastal fishing grounds hand out fish tokens from a
 * seeded bag; fish are fungible points spent on five options; the old boot
 * hides in the bag and is worth −1 VP until it is passed on with a trade.
 */

import { RESOURCES, boardGeometry } from "../../board";
import { RuleError } from "../../errors";
import { edgeVerticesOf, isBoardEdge, type EdgeId, type HexId, type VertexId } from "../../geometry";
import { requireCurrent, requirePhase } from "../../guards";
import { isLandEdge, legalRoadEdges } from "../../legal";
import { createRng } from "../../rng";
import { updateLongestRoad } from "../../specialCards";
import { buildingAt, cardCount, currentPlayerId, edgeOwner, emit, getPlayer, hand, hasResources, playerIndex, variantOn, victoryPoints } from "../../state";
import { notifyBuilt, stealRandomCard, upgradeToCity } from "../../turnHelpers";
import type { Action, DevCardType, GameState, Player, PlayerId, SpendFishAction } from "../../types";
import { registerModule } from "../hooks";
import { FISH_COST, FISH_OPTIONS, type FishOption, type FishingState } from "../types";

/** The bag before shuffling: 11 × 1, 10 × 2, 8 × 3 fish and the old boot (0). */
export const FISH_BAG: readonly number[] = [...Array<number>(11).fill(1), ...Array<number>(10).fill(2), ...Array<number>(8).fill(3), 0];
/** Fish in the bag at the start (11 + 20 + 24). */
export const FISH_BAG_TOTAL = FISH_BAG.reduce((n, x) => n + x, 0);
/** Totals on which the lake yields fish. */
export const LAKE_TOTALS: readonly number[] = [2, 3, 11, 12];

function fishingState(state: GameState): FishingState {
  const f = state.wayfarers?.fishing;
  if (!f) throw new Error("fishing state missing while the variant is on");
  return f;
}

/** Hexes that produce nothing: where 2 fish may send the robber. */
export function robberRestHexes(state: GameState): HexId[] {
  return Object.keys(state.board.hexes).filter((h) => {
    const t = state.board.hexes[h]?.terrain;
    return t === "lake" || t === "wasteland";
  });
}

function lakeHexes(state: GameState): HexId[] {
  return Object.keys(state.board.hexes).filter((h) => state.board.hexes[h]?.terrain === "lake");
}

/** Pop tokens from the front of the bag for `playerId`; nothing is drawn once the bag is empty. */
function draw(state: GameState, f: FishingState, playerId: PlayerId, count: number, source: HexId | EdgeId): void {
  for (let i = 0; i < count; i++) {
    const token = f.bag.shift();
    if (token === undefined) return;
    if (token === 0) {
      f.boot = playerId;
      emit(state, { kind: "fishDrawn", playerId, fish: 0, boot: true, source });
    } else {
      f.fish[playerId] = (f.fish[playerId] ?? 0) + token;
      emit(state, { kind: "fishDrawn", playerId, fish: token, boot: false, source });
    }
  }
}

interface Draw {
  readonly playerId: PlayerId;
  readonly count: number;
  readonly source: HexId | EdgeId;
}

function drawFor(state: GameState, vertex: VertexId, source: HexId | EdgeId, out: Draw[]): void {
  const b = buildingAt(state, vertex);
  if (b) out.push({ playerId: b.owner, count: b.kind === "city" ? 2 : 1, source });
}

/** docs/phase10.md §2: the VP a player would show without the boot's penalty. */
function pointsWithoutBoot(state: GameState, f: FishingState, player: Player): number {
  return victoryPoints(state, player).total + (f.boot === player.id ? 1 : 0);
}

/** May `holder` hand the boot to `receiver`? The receiver needs at least the holder's points. */
function bootAllowed(state: GameState, f: FishingState, holder: Player, receiver: Player): boolean {
  return victoryPoints(state, receiver).total >= pointsWithoutBoot(state, f, holder);
}

function requireOption(value: unknown): FishOption {
  if (!(FISH_OPTIONS as readonly unknown[]).includes(value)) throw new RuleError("INVALID_CHOICE", `unknown fish option ${String(value)}`);
  return value as FishOption;
}

function stealTargetsFor(state: GameState, thief: PlayerId): PlayerId[] {
  return state.players.filter((p) => p.id !== thief && cardCount(state, p) >= 1).map((p) => p.id);
}

function applySpendFish(state: GameState, action: SpendFishAction): void {
  requirePhase(state, "action");
  const player = requireCurrent(state, action.playerId);
  const f = fishingState(state);
  const option = requireOption(action.option);
  const cost = FISH_COST[option];
  if ((f.fish[player.id] ?? 0) < cost) throw new RuleError("NO_FISH", `${option} costs ${cost} fish`);
  const spend = (): void => {
    f.fish[player.id] = (f.fish[player.id] ?? 0) - cost;
    f.spent += cost;
    emit(state, { kind: "fishSpent", playerId: player.id, fish: cost, option });
  };

  switch (option) {
    case "moveRobber": {
      const hex = action.hex;
      if (hex === undefined || !robberRestHexes(state).includes(hex)) throw new RuleError("INVALID_HEX", "the robber may only be sent to a hex that produces nothing");
      if (hex === state.robberHex) throw new RuleError("ROBBER_MUST_MOVE", "robber must move to a different hex");
      spend();
      const from = state.robberHex;
      state.robberHex = hex;
      emit(state, { kind: "robberMoved", from, to: hex, by: player.id });
      return;
    }
    case "steal": {
      const targetId = action.targetPlayerId;
      if (targetId === undefined || !stealTargetsFor(state, player.id).includes(targetId)) throw new RuleError("INVALID_STEAL_TARGET", "cannot steal from that player");
      spend();
      stealRandomCard(state, player, getPlayer(state, targetId));
      return;
    }
    case "bankResource": {
      const resource = action.resource;
      if (resource === undefined || !(RESOURCES as readonly unknown[]).includes(resource)) throw new RuleError("INVALID_CHOICE", "unknown resource");
      if (state.bank[resource] < 1) throw new RuleError("BANK_EMPTY", `bank has no ${resource}`);
      spend();
      state.bank[resource] -= 1;
      player.hand[resource] += 1;
      emit(state, { kind: "resourcesTaken", playerId: player.id, cards: hand({ [resource]: 1 }), reason: "fish" });
      return;
    }
    case "freeRoad": {
      const edge = action.edge;
      const geo = boardGeometry(state.board);
      if (edge === undefined || !isBoardEdge(edge, geo) || !isLandEdge(state, edge, geo)) throw new RuleError("INVALID_EDGE", `no such edge ${String(edge)}`);
      if (edgeOwner(state, edge) !== null) throw new RuleError("EDGE_OCCUPIED", `edge ${edge} is occupied`);
      if (!legalRoadEdges(state, player.id).includes(edge)) throw new RuleError("ROAD_NOT_CONNECTED", `edge ${edge} is not connected to your network`);
      if (player.pieces.roads <= 0) throw new RuleError("NO_PIECES_LEFT", "no roads left");
      spend();
      player.roads.push(edge);
      player.pieces.roads -= 1;
      emit(state, { kind: "built", playerId: player.id, piece: "road", at: edge });
      notifyBuilt(state, player.id, "road", edge);
      updateLongestRoad(state);
      return;
    }
    case "freeDevCard": {
      if (state.devDeck.length > 0) {
        spend();
        const type = state.devDeck.shift() as DevCardType;
        player.devCards.push({ type, boughtOnTurn: state.turn });
        emit(state, { kind: "devCardBought", playerId: player.id, card: type });
        return;
      }
      const vertex = action.vertex;
      if (vertex === undefined) throw new RuleError("INVALID_CHOICE", "the deck is empty: name a settlement to upgrade");
      if (!player.settlements.includes(vertex)) throw new RuleError("NOT_YOUR_SETTLEMENT", `no settlement of yours at ${vertex}`);
      if (player.pieces.cities <= 0) throw new RuleError("NO_PIECES_LEFT", "no cities left");
      spend();
      upgradeToCity(state, player, vertex);
      return;
    }
    default: {
      const exhaustive: never = option;
      throw new Error(`unknown fish option ${String(exhaustive)}`);
    }
  }
}

registerModule({
  id: "fishing",
  enabled: (state: GameState) => variantOn(state, "fishing"),

  init(state) {
    const fish: Record<PlayerId, number> = {};
    for (const p of state.players) fish[p.id] = 0;
    const fishing: FishingState = { fish, bag: createRng(state.seed, "fishing:bag").shuffle(FISH_BAG), boot: null, spent: 0 };
    if (state.wayfarers) state.wayfarers.fishing = fishing;
    else state.wayfarers = { eventDeck: null, fishing, rivers: null, harbormaster: null, raiders: null, caravans: null, wagons: null };
  },

  afterProduction(state, total) {
    const f = fishingState(state);
    const draws: Draw[] = [];
    for (const ground of state.board.fishingGrounds) {
      if (ground.token !== total) continue;
      for (const v of edgeVerticesOf(ground.edge)) drawFor(state, v, ground.edge, draws);
    }
    if (LAKE_TOTALS.includes(total)) {
      const geo = boardGeometry(state.board);
      for (const lake of lakeHexes(state)) {
        if (lake === state.robberHex) continue;
        for (const v of geo.hexVertices[lake] ?? []) drawFor(state, v, lake, draws);
      }
    }
    if (draws.length === 0) return;
    // Owners draw in seat order from the current player (the bag order matters).
    const n = state.players.length;
    const seat = (id: PlayerId) => (playerIndex(state, id) - state.currentPlayer + n) % n;
    draws.sort((a, b) => seat(a.playerId) - seat(b.playerId));
    for (const d of draws) draw(state, f, d.playerId, d.count, d.source);
  },

  extraActions(state, playerId, out) {
    if (state.phase.kind !== "action") return;
    const f = fishingState(state);
    const player = getPlayer(state, playerId);
    const trade = state.pendingTrade;
    if (currentPlayerId(state) !== playerId) {
      // The boot's holder may attach it to their acceptance when the offerer may receive it.
      if (!trade || trade.from === playerId || trade.rejectedBy.includes(playerId) || f.boot !== playerId) return;
      if (!hasResources(player.hand, trade.receive)) return;
      if (bootAllowed(state, f, player, getPlayer(state, trade.from))) out.push({ type: "ACCEPT_TRADE", playerId, boot: true });
      return;
    }

    const purse = f.fish[playerId] ?? 0;
    if (purse >= FISH_COST.moveRobber) {
      for (const hex of robberRestHexes(state)) if (hex !== state.robberHex) out.push({ type: "SPEND_FISH", playerId, option: "moveRobber", hex });
    }
    if (purse >= FISH_COST.steal) {
      for (const targetPlayerId of stealTargetsFor(state, playerId)) out.push({ type: "SPEND_FISH", playerId, option: "steal", targetPlayerId });
    }
    if (purse >= FISH_COST.bankResource) {
      for (const resource of RESOURCES) if (state.bank[resource] >= 1) out.push({ type: "SPEND_FISH", playerId, option: "bankResource", resource });
    }
    if (purse >= FISH_COST.freeRoad && player.pieces.roads > 0) {
      for (const edge of legalRoadEdges(state, playerId)) out.push({ type: "SPEND_FISH", playerId, option: "freeRoad", edge });
    }
    if (purse >= FISH_COST.freeDevCard) {
      if (state.devDeck.length > 0) out.push({ type: "SPEND_FISH", playerId, option: "freeDevCard" });
      else if (player.pieces.cities > 0) for (const vertex of player.settlements) out.push({ type: "SPEND_FISH", playerId, option: "freeDevCard", vertex });
    }

    // Representative 1:1 offers with the boot attached, when someone could take it.
    if (!trade && f.boot === playerId && state.players.some((p) => p.id !== playerId && bootAllowed(state, f, player, p))) {
      for (const give of RESOURCES) {
        if (player.hand[give] < 1) continue;
        for (const receive of RESOURCES) {
          if (receive === give) continue;
          out.push({ type: "OFFER_TRADE", playerId, give: hand({ [give]: 1 }), receive: hand({ [receive]: 1 }), boot: true });
        }
      }
    }
  },

  apply(state, action: Action) {
    if (action.type !== "SPEND_FISH") return false;
    applySpendFish(state, action);
    return true;
  },

  victoryPoints(state, player) {
    return { publicVP: fishingState(state).boot === player.id ? -1 : 0, hiddenVP: 0 };
  },

  onTradeAccepted(state, offerer, acceptor, boot) {
    if (!boot.offer && !boot.accept) return;
    const f = fishingState(state);
    if (boot.offer && f.boot !== offerer.id) throw new RuleError("NO_BOOT", `${offerer.id} does not hold the old boot`);
    if (boot.accept && f.boot !== acceptor.id) throw new RuleError("NO_BOOT", `${acceptor.id} does not hold the old boot`);
    const holder = boot.offer ? offerer : acceptor;
    const receiver = boot.offer ? acceptor : offerer;
    if (!bootAllowed(state, f, holder, receiver)) {
      // An offer with the boot attached may still be accepted by a player who is not eligible: the trade goes through and the boot stays.
      if (boot.offer && !boot.accept) return;
      throw new RuleError("BOOT_NOT_ALLOWED", `${receiver.id} has fewer points than ${holder.id}`);
    }
    f.boot = receiver.id;
    emit(state, { kind: "bootPassed", from: holder.id, to: receiver.id });
  },
});
