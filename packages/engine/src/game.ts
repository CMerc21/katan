/**
 * `createGame`: a fresh state in the setup phase (§1, §2, §4).
 */

import { makeBoard, wastelandHex } from "./board";
import { RuleError } from "./errors";
import { RNG_INDEX_DECK, rng } from "./rng";
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
export const MAX_PLAYERS = 4;

/** §2.5: the 25-card deck in a seeded order (top = index 0). */
export function shuffledDevDeck(seed: string): DevCardType[] {
  const cards: DevCardType[] = [];
  for (const type of DEV_CARD_TYPES) {
    for (let i = 0; i < DEV_DECK_COMPOSITION[type]; i++) cards.push(type);
  }
  return rng(seed, RNG_INDEX_DECK).shuffle(cards);
}

export function createGame(options: CreateGameOptions): GameState {
  const { seed, players } = options;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RuleError("BAD_PLAYER_COUNT", `expected ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${players.length}`);
  }
  const ids = new Set<PlayerId>();
  for (const p of players) {
    if (ids.has(p.id)) throw new RuleError("DUPLICATE_PLAYER", `duplicate player id ${p.id}`);
    ids.add(p.id);
  }
  const colors = players.map((p, seat) => p.color ?? (PLAYER_COLORS[seat] as PlayerColor));
  if (new Set(colors).size !== colors.length) throw new RuleError("DUPLICATE_PLAYER", "player colours must differ");
  const boardKind = options.board ?? "random";
  const board = makeBoard(boardKind, seed);

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
  }));

  return {
    version: 1,
    seed,
    boardKind,
    board,
    actionIndex: 0,
    turn: 0,
    phase: { kind: "setup", round: 1, step: "settlement", lastSettlement: null },
    players: seated,
    currentPlayer: 0,
    bank: { wood: BANK_PER_RESOURCE, clay: BANK_PER_RESOURCE, wool: BANK_PER_RESOURCE, grain: BANK_PER_RESOURCE, ore: BANK_PER_RESOURCE },
    devDeck: shuffledDevDeck(seed),
    robberHex: wastelandHex(board),
    lastRoll: null,
    longestRoad: { playerId: null, length: 0 },
    largestArmy: { playerId: null, count: 0 },
    pendingTrade: null,
    pendingDiscards: {},
    winner: null,
    log: [],
  };
}
