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
  type ModulePromptKind,
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

/** Server transport codes (docs/phase4.md §3) and the client's own NETWORK code. */
export const TRANSPORT_TEXT: Record<string, string> = {
  UNAUTHORIZED: "Please sign in again",
  BAD_REQUEST: "The server rejected that request",
  GAME_NOT_FOUND: "That game no longer exists",
  NOT_A_MEMBER: "You are not in this game",
  GAME_NOT_ACTIVE: "This game is not in play",
  VERSION_CONFLICT: "The board updated. Try again",
  NOT_YOUR_SEAT: "That is not your seat",
  NOT_HOST: "Only the host can do that",
  INVALID_CODE: "No open game has that code",
  LOBBY_FULL: "That game is full",
  ALREADY_JOINED: "You are already in that game",
  COLOR_TAKEN: "That colour is taken",
  TOO_FEW_PLAYERS: "A game needs at least 3 seats",
  NOT_READY: "Everyone must be ready first",
  NOT_ABSENT: "That player has not been away long enough, or is not being waited on",
  BOT_CAP: "The bots stopped early; try again",
  BOARD_NOT_FOUND: "That board no longer exists",
  SCENARIO_NOT_FOUND: "That scenario no longer exists",
  NOT_OWNER: "You do not own that",
  NETWORK: "Couldn't reach the game server. Retrying…",
};

export function errorText(code: string): string {
  return (ERROR_TEXT as Record<string, string>)[code] ?? TRANSPORT_TEXT[code] ?? "Something went wrong";
}

export const ERROR_TEXT: Record<RuleErrorCode, string> = {
  BAD_PLAYER_COUNT: "A game needs 3 to 6 players (as the board allows)",
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
  INVALID_BOARD: "That board is not valid",
  TIDES_OFF: "Ships and the pirate need the Tides module",
  PIRATE_BLOCKS: "The pirate blocks that edge",
  SHIP_NOT_CONNECTED: "Ships must connect to your settlements or ships",
  NOT_YOUR_SHIP: "That is not your ship",
  NOT_OPEN_END: "Only the ship at the open end of a route can move",
  SHIP_TOO_NEW: "A ship built this turn cannot move yet",
  SHIP_ALREADY_MOVED: "Only one ship may move per turn",
  NO_GOLD_OWED: "You are owed no gold",
  WRONG_GOLD_COUNT: "Choose exactly the number owed",
  INVALID_SCENARIO: "That scenario is not valid",
  // Modules (docs/phase10.md, docs/phase11.md)
  MODULE_OFF: "That rule is not part of this game",
  NOT_YOUR_PROMPT: "Another player is deciding",
  INVALID_CHOICE: "That is not one of the choices",
  NO_FISH: "Not enough fish",
  NO_BOOT: "You do not hold the old boot",
  BOOT_NOT_ALLOWED: "The boot can only go to a player with at least as many points",
  NOT_COASTAL: "That hex is not on the coast",
  NO_KNIGHTS_LEFT: "No knights left",
  HEX_NOT_TOUCHED: "You have no building on that hex",
  NOT_RAIDED: "That hex was not raided",
  ALREADY_HAS_CASTLE: "You already have a castle",
  NO_SPICE: "Not enough spice",
  CARAVAN_NOT_ADJACENT: "The caravan can only move along a road next to its end",
  CARAVAN_COMPLETE: "That caravan has reached its end",
  WAGON_BAD_PATH: "The wagon can only travel along roads",
  WAGON_BLOCKED: "Another wagon blocks the way; pay a toll to pass",
  WAGON_FULL: "The wagon is full",
  WAGON_NO_STEPS: "The wagon has no moves left this turn",
  NO_CARGO: "The wagon carries no such goods",
  NOT_A_CITY: "The wagon must stand at a city",
  NO_GOODS: "No such goods are waiting there",
  NO_CITY: "You need a city for that",
  TRACK_MAXED: "That track is complete",
  NEEDS_POLITICS: "A mighty knight needs politics level 3",
  NO_KNIGHT: "No knight there",
  NOT_YOUR_KNIGHT: "That is not your knight",
  KNIGHT_INACTIVE: "That knight is not active",
  KNIGHT_ALREADY_ACTIVE: "That knight is already active",
  KNIGHT_ACTED: "That knight has already acted this turn",
  KNIGHT_MAX_LEVEL: "That knight cannot be promoted further",
  VERTEX_HAS_KNIGHT: "A knight stands there",
  KNIGHT_NOT_CONNECTED: "Knights must stand on your road network",
  NOT_STRONGER: "Your knight is not strong enough",
  NOT_ADJACENT: "Not adjacent",
  WALL_LIMIT: "You already have three walls",
  PROGRESS_LIMIT: "You may hold four progress cards",
  NO_PROGRESS_CARD: "You do not hold that card",
  PROGRESS_BEFORE_ROLL: "Only one progress card before the roll",
  ROBBER_LOCKED: "The robber stays home until the barbarians have attacked once",
  NO_TARGET: "Nobody to target",
  NOT_HELD: "You do not hold that",
  INVALID_PAYLOAD: "That card needs a different choice",
};

export function describeCost(cost: Hand): string {
  return RESOURCES.filter((r) => cost[r] > 0)
    .map((r) => (cost[r] > 1 ? `${cost[r]} ${RESOURCE_LABEL[r].toLowerCase()}` : RESOURCE_LABEL[r].toLowerCase()))
    .join(" + ");
}

export const COST_TEXT = {
  road: describeCost(COSTS.road),
  ship: describeCost(COSTS.ship),
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
      return phase.step === "settlement" ? `${name}: place a settlement` : view.scenario?.tides ? `${name}: place a road or a ship` : `${name}: place a road`;
    case "roll":
      return mine ? "Roll the dice" : `Waiting for ${name} to roll`;
    case "discard": {
      const owing = Object.keys(view.pendingDiscards);
      if (owing.includes(me)) return `Discard ${view.pendingDiscards[me]} cards`;
      return `Waiting for ${owing.map((id) => playerName(view, id)).join(", ")} to discard`;
    }
    case "moveRobber":
      if (view.pirateHex !== null) return mine ? "Move the robber or the pirate" : `Waiting for ${name} to move the robber or the pirate`;
      return mine ? "Move the robber" : `Waiting for ${name} to move the robber`;
    case "chooseGold": {
      const owing = Object.keys(phase.owed);
      if (owing.includes(me)) return `Gold: choose ${phase.owed[me]} resource${phase.owed[me] === 1 ? "" : "s"}`;
      return `Waiting for ${owing.map((id) => playerName(view, id)).join(", ")} to choose gold`;
    }
    case "steal":
      return mine ? "Choose who to steal from" : `Waiting for ${name} to steal`;
    case "roadBuilding":
      return view.scenario?.tides ? `Place ${phase.remaining} free road${phase.remaining === 1 ? "" : "s"} or ship${phase.remaining === 1 ? "" : "s"}` : `Place ${phase.remaining} free road${phase.remaining === 1 ? "" : "s"}`;
    case "specialBuild": {
      const builder = phase.order[phase.index] ?? current;
      return builder === me ? "Special build: build, buy, or pass" : `Waiting for ${playerName(view, builder)} to build or pass`;
    }
    case "action":
      if (view.pendingTrade) {
        const from = playerName(view, view.pendingTrade.from);
        return me === view.pendingTrade.from ? "Waiting for responses to your offer" : `${from} offers a trade`;
      }
      return mine ? "Build, trade, or end your turn" : `Waiting for ${name}`;
    case "modulePrompt": {
      const who = phase.prompt.playerId;
      const label = PROMPT_TEXT[phase.prompt.kind];
      return who === me ? label : `Waiting for ${playerName(view, who)}: ${label.toLowerCase()}`;
    }
    case "ended":
      return `${playerName(view, view.winner ?? current)} wins`;
    default: {
      const exhaustive: never = phase;
      return String(exhaustive);
    }
  }
}

/** What a module prompt asks of its player (docs/phase10.md, docs/phase11.md). */
export const PROMPT_TEXT: Record<ModulePromptKind, string> = {
  neighborlyHelp: "Give a card to the poorest player, or pass",
  placeCastle: "Choose the settlement that becomes your castle",
  downgradeCity: "Choose a city to lose",
  placeMetropolis: "Place your metropolis on a city",
  discardProgress: "Discard down to four progress cards",
  deserter: "Choose a knight to desert",
  placeFreeKnight: "Place your new knight",
  knightRetreat: "Choose where your knight retreats",
  spy: "Take one of their progress cards",
  commercialHarbor: "Hand over a commodity",
  giveCards: "Give the wedding gift",
};

export function actionLabel(action: Action): string {
  switch (action.type) {
    case "BUILD_ROAD":
      return "Build road";
    case "BUILD_SETTLEMENT":
      return "Build settlement";
    case "BUILD_CITY":
      return "Build city";
    case "BUILD_SHIP":
      return "Build ship";
    case "MOVE_SHIP":
      return "Move ship";
    default:
      return action.type;
  }
}
