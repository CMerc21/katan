/**
 * Copy for the UI: names, prompts, and explanations of RuleError codes.
 * Sentence case throughout (docs/phase3.md §7).
 */

import {
  COSTS,
  RESOURCES,
  type Action,
  type DevCardType,
  type Hand,
  type PortKind,
  type Resource,
  type RuleErrorCode,
} from "@katan/engine";
import type { RedactedState } from "@/driver/types";

export const RESOURCE_LABEL: Record<Resource, string> = {
  wood: "Wood",
  clay: "Clay",
  wool: "Wool",
  grain: "Grain",
  ore: "Ore",
};

export const RESOURCE_SHORT: Record<Resource, string> = {
  wood: "Wd",
  clay: "Cl",
  wool: "Wl",
  grain: "Gr",
  ore: "Or",
};

export const DEV_CARD_LABEL: Record<DevCardType, string> = {
  knight: "Knight",
  victoryPoint: "Victory point",
  roadBuilding: "Road building",
  invention: "Invention",
  monopoly: "Monopoly",
};

export const DEV_CARD_HELP: Record<DevCardType, string> = {
  knight: "Move the robber and steal a card",
  victoryPoint: "Worth 1 point; counts automatically",
  roadBuilding: "Place two free roads",
  invention: "Take any two resources from the bank",
  monopoly: "Take every card of one resource from all players",
};

export const ERROR_TEXT: Record<RuleErrorCode, string> = {
  BAD_PLAYER_COUNT: "A game needs 3 or 4 players",
  DUPLICATE_PLAYER: "Player names must differ",
  UNKNOWN_PLAYER: "Unknown player",
  NOT_YOUR_TURN: "Not your turn",
  WRONG_PHASE: "Not allowed right now",
  GAME_OVER: "The game is over",
  INVALID_VERTEX: "Not a valid spot",
  VERTEX_OCCUPIED: "That spot is taken",
  DISTANCE_RULE: "Too close to another settlement",
  NOT_CONNECTED_TO_ROAD: "Must touch one of your roads",
  NOT_YOUR_SETTLEMENT: "Only your own settlements can become cities",
  INVALID_EDGE: "Not a valid edge",
  EDGE_OCCUPIED: "That edge already has a road",
  ROAD_NOT_CONNECTED: "Roads must connect to your network",
  NO_LEGAL_ROAD: "Nowhere to build a road",
  NO_PIECES_LEFT: "No pieces of that kind left",
  INSUFFICIENT_RESOURCES: "Not enough resources",
  NO_DISCARD_OWED: "You owe no discard",
  WRONG_DISCARD_COUNT: "Discard exactly the required number",
  INVALID_HEX: "Not a valid hex",
  ROBBER_MUST_MOVE: "The robber must move to a different hex",
  INVALID_STEAL_TARGET: "You cannot steal from that player",
  DECK_EMPTY: "No development cards left",
  NO_SUCH_CARD: "You do not hold that card",
  CARD_TOO_NEW: "Bought this turn; play it next turn",
  DEV_CARD_ALREADY_PLAYED: "Already played a card this turn",
  BANK_EMPTY: "The bank is out of that resource",
  EMPTY_TRADE: "Both sides of a trade need cards",
  INVALID_TRADE: "That trade is not valid",
  TRADE_ALREADY_PENDING: "An offer is already open",
  NO_PENDING_TRADE: "There is no open offer",
  BAD_TRADE_RATIO: "You do not have a port for that ratio",
};

export function describeCost(cost: Hand): string {
  return RESOURCES.filter((r) => cost[r] > 0)
    .map((r) => (cost[r] > 1 ? `${cost[r]} ${RESOURCE_LABEL[r].toLowerCase()}` : RESOURCE_LABEL[r].toLowerCase()))
    .join(" + ");
}

export const COST_TEXT = {
  road: describeCost(COSTS.road),
  settlement: describeCost(COSTS.settlement),
  city: describeCost(COSTS.city),
  devCard: describeCost(COSTS.devCard),
};

export function portLabel(kind: PortKind): string {
  return kind === "any" ? "3:1" : "2:1";
}

export function playerName(view: RedactedState, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? id;
}

export function currentPlayerId(view: RedactedState): string {
  return view.players[view.currentPlayer]!.id;
}

/** The one-line prompt for the acting player (docs/phase3.md §5). */
export function bannerText(view: RedactedState, me: string): string {
  const phase = view.phase;
  const current = currentPlayerId(view);
  const name = playerName(view, current);
  const mine = current === me;
  switch (phase.kind) {
    case "setup":
      return phase.step === "settlement" ? `${name}: place a settlement` : `${name}: place a road`;
    case "roll":
      return mine ? "Roll the dice" : `Waiting for ${name} to roll`;
    case "discard": {
      const owing = Object.keys(view.pendingDiscards);
      if (owing.includes(me)) return `Discard ${view.pendingDiscards[me]} cards`;
      return `Waiting for ${owing.map((id) => playerName(view, id)).join(", ")} to discard`;
    }
    case "moveRobber":
      return mine ? "Move the robber" : `Waiting for ${name} to move the robber`;
    case "steal":
      return mine ? "Choose who to steal from" : `Waiting for ${name} to steal`;
    case "roadBuilding":
      return `Place ${phase.remaining} free road${phase.remaining === 1 ? "" : "s"}`;
    case "action":
      if (view.pendingTrade) {
        const from = playerName(view, view.pendingTrade.from);
        return me === view.pendingTrade.from ? "Waiting for responses to your offer" : `${from} offers a trade`;
      }
      return mine ? "Build, trade, or end your turn" : `Waiting for ${name}`;
    case "ended":
      return `${playerName(view, view.winner ?? current)} wins`;
    default: {
      const exhaustive: never = phase;
      return String(exhaustive);
    }
  }
}

export function actionLabel(action: Action): string {
  switch (action.type) {
    case "BUILD_ROAD":
      return "Build road";
    case "BUILD_SETTLEMENT":
      return "Build settlement";
    case "BUILD_CITY":
      return "Build city";
    default:
      return action.type;
  }
}
