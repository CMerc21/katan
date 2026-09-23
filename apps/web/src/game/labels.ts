/**
 * Copy for the UI: names, prompts, and explanations of RuleError codes.
 * Sentence case throughout (docs/phase3.md §7).
 */

import {
  COSTS,
  FISH_COST,
  RESOURCES,
  type Action,
  type Commodity,
  type DevCardType,
  type EventCardKind,
  type EventDie,
  type FishOption,
  type Hand,
  type ModulePromptKind,
  type KnightLevel,
  type PortKind,
  type ProgressCard,
  type Resource,
  type RuleErrorCode,
  type Track,
  type VariantChip,
  type VariantName,
  type WagonGood,
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
  NOTHING_TO_UNDO: "Nothing to take back",
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

/** docs/rules.md §16.9: under Crown & Castle the second setup placement is a city. */
export function setupPiece(view: RedactedState): "settlement" | "city" {
  return view.phase.kind === "setup" && view.phase.round === 2 && view.scenario?.crown ? "city" : "settlement";
}

/** The one-line prompt for the acting player (docs/phase3.md §5). */
export function bannerText(view: RedactedState, me: string): string {
  const phase = view.phase;
  const current = currentPlayerId(view);
  const name = playerName(view, current);
  const mine = current === me;
  switch (phase.kind) {
    case "setup":
      return phase.step === "settlement" ? `${name}: place a ${setupPiece(view)}` : view.scenario?.tides ? `${name}: place a road or a ship` : `${name}: place a road`;
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
    // Wayfarers (docs/phase10.md)
    case "SPEND_FISH":
      return `Spend ${FISH_COST[action.option]} fish: ${FISH_OPTION_LABEL[action.option].toLowerCase()}`;
    case "NEIGHBORLY_GIVE":
      return action.resource === null ? "Give nothing" : `Give ${RESOURCE_LABEL[action.resource].toLowerCase()}`;
    case "BUILD_CASTLE":
      return "Raise castle";
    case "BUILD_KNIGHT":
      return action.hex !== undefined ? "Post guard" : "Hire knight";
    case "REBUILD_HEX":
      return "Rebuild hex";
    case "EXTEND_CARAVAN":
      return `Lead caravan ${action.caravan + 1}`;
    case "MOVE_WAGON":
      return `Move wagon ${action.path.length - 1} step${action.path.length === 2 ? "" : "s"}`;
    case "LOAD_COMMODITY":
      return `Load ${WAGON_GOOD_LABEL[action.good].toLowerCase()}`;
    case "DELIVER":
      return `Deliver ${WAGON_GOOD_LABEL[action.good].toLowerCase()}`;
    // Crown & Castle (docs/phase11.md §11)
    case "ACTIVATE_KNIGHT":
      return "Activate knight";
    case "PROMOTE_KNIGHT":
      return "Promote knight";
    case "KNIGHT_MOVE":
      return "Move knight";
    case "KNIGHT_DISPLACE":
      return "Drive off knight";
    case "KNIGHT_CHASE_ROBBER":
      return "Chase the robber";
    case "BUILD_IMPROVEMENT":
      return `Improve ${TRACK_LABEL[action.track].toLowerCase()}`;
    case "BUILD_WALL":
      return "Build wall";
    case "PLAY_PROGRESS":
      return `Play ${PROGRESS_CARD_LABEL[action.card]}`;
    case "DISCARD_PROGRESS":
      return `Discard ${PROGRESS_CARD_LABEL[action.card]}`;
    case "CHOOSE_DOWNGRADE":
      return "Give up this city";
    case "PLACE_METROPOLIS":
      return "Place metropolis";
    case "CHOOSE_DESERTER":
      return "Desert this knight";
    case "PLACE_FREE_KNIGHT":
      return action.vertex === null ? "Place nowhere" : "Place knight";
    case "RETREAT_KNIGHT":
      return action.vertex === null ? "Lose the knight" : "Retreat here";
    case "SPY_TAKE":
      return `Take ${PROGRESS_CARD_LABEL[action.card]}`;
    case "COMMERCIAL_SWAP":
      return `Hand over ${COMMODITY_LABEL[action.commodity].toLowerCase()}`;
    case "GIVE_CARDS":
      return "Give cards";
    default:
      return action.type;
  }
}

// ---------------------------------------------------------------------------
// Wayfarers copy (docs/phase10.md, docs/rules.md §15). Sentence case; original wording.

export const VARIANT_LABEL: Record<VariantName, string> = {
  eventDeck: "Event deck",
  fishing: "Fishing",
  rivers: "Rivers",
  harbormaster: "Harbormaster",
  raiders: "Raiders",
  caravans: "Caravans",
  wagons: "Wagons",
};

/** One line per variant for tooltips and help. */
export const VARIANT_HELP: Record<VariantName, string> = {
  eventDeck: "A 36-card deck replaces the dice; five cards carry an event",
  fishing: "Settlements by the lake or a fishing ground catch fish to spend on favours; the old boot costs a point",
  rivers: "Roads on a river are bridges (one extra clay); riverside buildings earn coins, and the poorest holds the Poor Settler",
  harbormaster: "Three harbour points (1 per settlement, 2 per city on a harbour) take the Harbormaster, worth 2",
  raiders: "Every seven brings the raiders closer; guards defend coastal hexes, your castle is safe, rebuilding scores a point",
  caravans: "Oases yield spice; spend it to lead a caravan along your roads for double-length roads and bonus production",
  wagons: "Your wagon carries goods between cities along anyone's roads; deliveries to another player's city score",
};

export const EVENT_CARD_LABEL: Record<EventCardKind, string> = {
  plentifulHarvest: "Plentiful harvest",
  robbersRest: "Robber's rest",
  neighborlyHelp: "Neighborly help",
  taxCollector: "Tax collector",
  bounty: "Bounty",
};

export const EVENT_CARD_HELP: Record<EventCardKind, string> = {
  plentifulHarvest: "Everyone takes one resource of their choice",
  robbersRest: "The robber stays where it is; discards still happen",
  neighborlyHelp: "Everyone may give one card to the poorest player",
  taxCollector: "Players with eight or more cards put one back",
  bounty: "The current player takes one resource of their choice",
};

export const FISH_OPTION_LABEL: Record<FishOption, string> = {
  moveRobber: "Send the robber away",
  steal: "Steal a card",
  bankResource: "Take a resource",
  freeRoad: "Build a road for free",
  freeDevCard: "Draw a development card",
};

export const FISH_OPTION_HELP: Record<FishOption, string> = {
  moveRobber: "Move the robber to a lake or wasteland; nobody is robbed",
  steal: "Take one random card from any other player",
  bankResource: "Take one resource of your choice from the bank",
  freeRoad: "Place a road on any legal edge without paying",
  freeDevCard: "Draw a development card for free, or upgrade a settlement when the deck is empty",
};

export const CHIP_LABEL: Record<VariantChip, string> = {
  bridgeBuilder: "Bridge Builder",
  poorSettler: "Poor Settler",
  harbormaster: "Harbormaster",
};

export const CHIP_VP: Record<VariantChip, number> = { bridgeBuilder: 1, poorSettler: -2, harbormaster: 2 };

export const WAGON_GOOD_LABEL: Record<WagonGood, string> = {
  marble: "Marble",
  glass: "Glass",
  sand: "Sand",
  tools: "Tools",
};

/** What a target mode asks the player to click on the board. */
export const MODE_HINT: Record<string, string> = {
  moveShip: "Pick the ship, then where it sails",
  guard: "Choose a hex you touch for the guard",
  rebuild: "Choose the raided hex to rebuild",
  caravan: "Choose the road the caravan follows",
  wagon: "Click the next stop along a road, then Go",
  fishRobber: "Choose where the robber rests",
  fishRoad: "Choose the free road's edge",
  fishCity: "Choose the settlement to upgrade",
  // Crown & Castle (docs/phase11.md §11)
  knight: "Choose a vertex on your roads for the knight",
  knightAct: "Click one of your knights",
  knightMove: "Choose where the knight goes",
  knightDisplace: "Choose the weaker knight to drive off",
  wall: "Choose the city to wall",
  metropolis: "Choose the city for your metropolis",
  downgrade: "Choose the city that becomes a settlement",
  retreat: "Choose where your knight retreats, or let it go",
  "progress:merchant": "Choose a hex you have a building on",
  "progress:bishop": "Choose where the robber goes",
  "progress:intrigue": "Choose the opposing knight to remove",
  "progress:engineer": "Choose the city to wall for free",
  "progress:medicine": "Choose the settlement to upgrade",
  "progress:inventor": "Choose two number tokens to swap",
  "progress:diplomat": "Choose an open road to remove",
  "progress:smith": "Choose up to two knights to promote",
};

// ---------------------------------------------------------------------------
// Crown & Castle copy (docs/phase11.md §11, docs/rules.md §16). Sentence case; original wording.

export const COMMODITY_LABEL: Record<Commodity, string> = { cloth: "Cloth", coin: "Coin", paper: "Paper" };
export const COMMODITY_SHORT: Record<Commodity, string> = { cloth: "Ct", coin: "Cn", paper: "Pp" };

/** A resource or commodity by name. */
export function cardLabel(card: Resource | Commodity): string {
  return card === "cloth" || card === "coin" || card === "paper" ? COMMODITY_LABEL[card] : RESOURCE_LABEL[card];
}

export const TRACK_LABEL: Record<Track, string> = { trade: "Trade", politics: "Politics", science: "Science" };

/** What level 3 grants on each track. */
export const TRACK_ABILITY: Record<Track, string> = {
  trade: "Level 3: trade commodities with the bank at 2:1",
  politics: "Level 3: knights may be promoted to mighty (level 3)",
  science: "Level 3: a roll that brings you nothing gives one resource of your choice",
};

/** One line per track for the improvement sheet. */
export const TRACK_HELP: Record<Track, string> = {
  trade: "Paid in cloth. Draws trade cards on the trade face of the event die",
  politics: "Paid in coin. Draws politics cards on the politics face",
  science: "Paid in paper. Draws science cards on the science face",
};

export const EVENT_DIE_LABEL: Record<EventDie, string> = { fleet: "Fleet", trade: "Trade", politics: "Politics", science: "Science" };

export const KNIGHT_LEVEL_LABEL: Record<KnightLevel, string> = { 1: "Basic", 2: "Strong", 3: "Mighty" };

export const PROGRESS_CARD_LABEL: Record<ProgressCard, string> = {
  merchant: "Merchant",
  tradeMonopoly: "Trade monopoly",
  resourceMonopoly: "Resource monopoly",
  masterMerchant: "Master merchant",
  merchantFleet: "Merchant fleet",
  commercialHarbor: "Commercial harbour",
  bishop: "Bishop",
  constitution: "Constitution",
  deserter: "Deserter",
  diplomat: "Diplomat",
  intrigue: "Intrigue",
  saboteur: "Saboteur",
  spy: "Spy",
  warlord: "Warlord",
  wedding: "Wedding",
  alchemist: "Alchemist",
  crane: "Crane",
  engineer: "Engineer",
  inventor: "Inventor",
  irrigation: "Irrigation",
  medicine: "Medicine",
  mining: "Mining",
  printer: "Printer",
  roadBuilding: "Road building",
  smith: "Smith",
};

/** One line of help per progress card (docs/rules.md §16.4). */
export const PROGRESS_CARD_HELP: Record<ProgressCard, string> = {
  merchant: "Put the merchant on a hex you have a building on: that resource trades 2:1 and the merchant is worth 1 point while it stays",
  tradeMonopoly: "Name a commodity; every other player hands you one of it",
  resourceMonopoly: "Name a resource; every other player hands you up to two of it",
  masterMerchant: "Take two random cards from a player with more points than you",
  merchantFleet: "Name a resource or commodity: it trades with the bank at 2:1 this turn",
  commercialHarbor: "Every other player with a commodity must swap one for a resource of yours",
  bishop: "Move the robber and take a random card from everyone with a building on the new hex",
  constitution: "Worth 1 point; stays face up",
  deserter: "A player of your choice loses a knight; you place one of the same level for free",
  diplomat: "Remove any road with a free end; if it was yours, place it again elsewhere",
  intrigue: "Remove an opposing knight standing on a vertex your roads touch",
  saboteur: "Everyone with more points than you discards half their cards",
  spy: "Look at a player's progress cards and take one",
  warlord: "Activate all your knights for free",
  wedding: "Everyone with more points than you gives you two cards of their choice",
  alchemist: "Choose both number dice before you roll; the event die still rolls",
  crane: "Your next improvement costs one commodity less",
  engineer: "Build a city wall for free",
  inventor: "Swap the number tokens of two hexes numbered 3, 4, 5, 9, 10 or 11",
  irrigation: "Take two grain for every farmland hex you have a building on",
  medicine: "Upgrade a settlement to a city for two ore and one grain",
  mining: "Take two ore for every mountain hex you have a building on",
  printer: "Worth 1 point; stays face up",
  roadBuilding: "Place two roads for free",
  smith: "Promote up to two of your knights one level for free",
};

/** When a progress card may be played (docs/rules.md §16.4). */
export function progressTiming(card: ProgressCard): "before the roll only" | "before or after the roll" | "after the roll" {
  if (card === "alchemist") return "before the roll only";
  if (["bishop", "deserter", "diplomat", "intrigue", "saboteur", "spy", "warlord", "wedding", "inventor", "irrigation", "mining"].includes(card)) return "before or after the roll";
  return "after the roll";
}

export const KNIGHT_COST_TEXT = "wool + ore";
export const ACTIVATE_COST_TEXT = "grain";
export const WALL_COST_TEXT = "2 clay";
export const MEDICINE_COST_TEXT = "2 ore + grain";
