/**
 * `createGame`: a fresh state in the setup phase (§1, §2, §4).
 */

import "./modules"; // registers every module's hooks
import { makeBoard, wastelandHex, type Board } from "./board";
import { activeModules } from "./modules/hooks";
import { isBoardDefinition } from "./definition";
import { resolveBoard } from "./generation";
import { RuleError } from "./errors";
import { geometryFor, type HexId } from "./geometry";
import { RNG_INDEX_BOARD, RNG_INDEX_DECK, rng } from "./rng";
import { isScenario, scenarioHasErrors, scenarioRules, type ScenarioRules } from "./scenario";
import { emptyHand } from "./state";
import {
  BANK_PER_RESOURCE,
  DEV_CARD_TYPES,
  DEV_DECK_COMPOSITION,
  PLAYER_COLORS,
  STARTING_PIECES,
  type CreateGameOptions,
  type DevCardType,
  type GameState,
  type Player,
  type PlayerColor,
  type PlayerId,
} from "./types";

export const MIN_PLAYERS = 3;
/** The absolute cap; a board's `seats.max` may be lower (docs/phase8.md §5). */
export const MAX_PLAYERS = 6;

/** §2.5: the 25-card deck in a seeded order (top = index 0). */
export function shuffledDevDeck(seed: string): DevCardType[] {
  const cards: DevCardType[] = [];
  for (const type of DEV_CARD_TYPES) {
    for (let i = 0; i < DEV_DECK_COMPOSITION[type]; i++) cards.push(type);
  }
  return rng(seed, RNG_INDEX_DECK).shuffle(cards);
}

/** Where the pirate starts (docs/rules.md §14.5): the sea hex with the fewest land neighbours, lowest id first. */
export function initialPirateHex(board: Board): HexId | null {
  if (board.sea.length === 0) return null;
  const geo = geometryFor([...Object.keys(board.hexes), ...board.sea]);
  let bestHex: HexId | null = null;
  let bestLand = Infinity;
  for (const h of [...board.sea].sort()) {
    const land = (geo.hexNeighbors[h] ?? []).filter((n) => board.hexes[n] !== undefined).length;
    if (land < bestLand) {
      bestLand = land;
      bestHex = h;
    }
  }
  return bestHex;
}

export function createGame(options: CreateGameOptions): GameState {
  const { seed, players } = options;
  const boardOption = options.board ?? "random";
  let board: Board;
  let boardKind: GameState["boardKind"];
  let rules: ScenarioRules | null = null;
  if (options.scenario !== undefined) {
    if (!isScenario(options.scenario)) throw new RuleError("INVALID_SCENARIO", "malformed scenario");
    if (scenarioHasErrors(options.scenario)) throw new RuleError("INVALID_SCENARIO", "the scenario has errors");
    rules = scenarioRules(options.scenario);
    const resolved = resolveBoard(options.scenario.board, rng(seed, RNG_INDEX_BOARD), { allowIslands: rules.tides });
    board = { ...resolved, seaPlayable: rules.tides };
    boardKind = "custom";
    if (rules.setup === "mainIslandOnly" && !board.islands.some((i) => i.id === rules?.mainIsland)) {
      throw new RuleError("INVALID_SCENARIO", "main island does not exist");
    }
  } else if (typeof boardOption === "string") {
    board = makeBoard(boardOption, seed);
    boardKind = boardOption;
  } else {
    if (!isBoardDefinition(boardOption)) throw new RuleError("INVALID_BOARD", "malformed board definition");
    board = resolveBoard(boardOption, rng(seed, RNG_INDEX_BOARD));
    boardKind = "custom";
  }
  const maxSeats = Math.min(MAX_PLAYERS, board.seats.max);
  if (players.length < MIN_PLAYERS || players.length > maxSeats) {
    throw new RuleError("BAD_PLAYER_COUNT", `expected ${MIN_PLAYERS}-${maxSeats} players, got ${players.length}`);
  }
  const ids = new Set<PlayerId>();
  for (const p of players) {
    if (ids.has(p.id)) throw new RuleError("DUPLICATE_PLAYER", `duplicate player id ${p.id}`);
    ids.add(p.id);
  }
  const colors = players.map((p, seat) => p.color ?? (PLAYER_COLORS[seat] as PlayerColor));
  if (new Set(colors).size !== colors.length) throw new RuleError("DUPLICATE_PLAYER", "player colours must differ");
  const seated: Player[] = players.map((p, seat) => ({
    id: p.id,
    name: p.name,
    color: colors[seat] as PlayerColor,
    hand: emptyHand(),
    devCards: [],
    playedKnights: 0,
    devCardPlayedThisTurn: false,
    pieces: { ...STARTING_PIECES },
    roads: [],
    settlements: [],
    cities: [],
    ships: [],
    shipsBuiltThisTurn: [],
    shipMovedThisTurn: false,
    startIslands: [],
    islandChips: [],
  }));

  const state: GameState = {
    version: 1,
    seed,
    boardKind,
    board,
    actionIndex: 0,
    eventSeq: 0,
    turn: 0,
    phase: { kind: "setup", round: 1, step: "settlement", lastSettlement: null },
    players: seated,
    currentPlayer: 0,
    bank: { wood: BANK_PER_RESOURCE, clay: BANK_PER_RESOURCE, wool: BANK_PER_RESOURCE, grain: BANK_PER_RESOURCE, ore: BANK_PER_RESOURCE },
    devDeck: shuffledDevDeck(seed),
    robberHex: wastelandHex(board),
    pirateHex: rules?.tides && rules.pirate ? initialPirateHex(board) : null,
    scenario: rules,
    lastRoll: null,
    longestRoad: { playerId: null, length: 0 },
    largestArmy: { playerId: null, count: 0 },
    pendingTrade: null,
    lastBuild: null,
    pendingDiscards: {},
    winner: null,
    log: [],
    wayfarers: null,
    crown: null,
  };
  // Module state (docs/phase10.md, docs/phase11.md §9).
  for (const h of activeModules(state)) h.init?.(state);
  return state;
}
