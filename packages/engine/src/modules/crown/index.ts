/**
 * Crown & Castle (docs/phase11.md): registers the module's hooks. The rules
 * live in the section files (`production`, `trade`, `progress`,
 * `progressCards`, `improvements`, `knights`, `fleet`, `walls`, `victory`);
 * this file only wires them to `ModuleHooks`.
 */

import { registerModule, type RollOutcome } from "../hooks";
import { upgradeToCity } from "../../turnHelpers";
import { crownOn, getPlayer } from "../../state";
import type { Action, GameState, Player, PlayerId } from "../../types";
import type { Rng } from "../../rng";
import { COMMODITY_BANK, DEFENDER_SUPPLY, emptyCommodities, type CrownPlayer, type EventDie, type ModulePrompt } from "../types";
import { crownState } from "./common";
import { afterProduction, cardCount, discardActions, discardExtra, stealExtra, yieldOverride } from "./production";
import { maritime, maritimeActions } from "./trade";
import { applyDiscardProgress, drawForTrack, initialDecks, progressPromptActions } from "./progress";
import { applyChooseDeserter, applyCommercialSwap, applyGiveCards, applyPlaceFreeKnight, applyPlayProgress, applySpyTake, progressCardActions, progressCardPromptActions } from "./progressCards";
import { applyBuildImprovement, applyPlaceMetropolis, improvementActions, improvementPromptActions } from "./improvements";
import {
  applyActivateKnight,
  applyBuildKnight,
  applyKnightChaseRobber,
  applyKnightDisplace,
  applyKnightMove,
  applyPromoteKnight,
  applyRetreatKnight,
  blockedVertices,
  clearKnightTurnFlags,
  knightActions,
  knightPromptActions,
  unbuildableVertices,
} from "./knights";
import { advanceFleet, applyChooseDowngrade, fleetPromptActions } from "./fleet";
import { applyBuildWall, discardThreshold, wallActions } from "./walls";
import { victoryPoints } from "./victory";

function freshPlayer(): CrownPlayer {
  return {
    commodities: emptyCommodities(),
    tracks: { trade: 0, politics: 0, science: 0 },
    progress: [],
    progressPlayedThisTurn: 0,
    progressPlayedBeforeRoll: false,
    walls: [],
    metropolises: { trade: null, politics: null, science: null },
    defenderChips: 0,
    crane: false,
    merchantFleet: null,
  };
}

function init(state: GameState): void {
  const players: Record<PlayerId, CrownPlayer> = {};
  for (const p of state.players) players[p.id] = freshPlayer();
  state.crown = {
    players,
    bank: { cloth: COMMODITY_BANK, coin: COMMODITY_BANK, paper: COMMODITY_BANK },
    decks: initialDecks(state.seed),
    knights: [],
    fleet: 0,
    attacks: 0,
    defenderSupply: DEFENDER_SUPPLY,
    merchant: null,
    alchemist: null,
    lastEvent: null,
    lastRed: null,
    metropolis: { trade: null, politics: null, science: null },
  };
  // §8: no development cards and no Largest Army in this module.
  state.devDeck = [];
}

/** §2: the event die — three fleet faces, one per track. */
function eventFace(face: number): EventDie {
  if (face <= 2) return "fleet";
  if (face === 3) return "trade";
  if (face === 4) return "politics";
  return "science";
}

function roll(state: GameState, player: Player, outcome: RollOutcome, draw: Rng): RollOutcome {
  void player;
  const crown = crownState(state);
  const dice: [number, number] = crown.alchemist ? [crown.alchemist[0], crown.alchemist[1]] : outcome.dice;
  const event = eventFace(draw.int(6));
  const red = dice[0];
  crown.lastEvent = event;
  crown.lastRed = red;
  return { ...outcome, dice, total: dice[0] + dice[1], red, event };
}

function afterRoll(state: GameState, player: Player, outcome: RollOutcome): void {
  void player;
  const crown = crownState(state);
  crown.alchemist = null;
  if (outcome.event === undefined || outcome.red === undefined) return;
  if (outcome.event === "fleet") advanceFleet(state);
  else drawForTrack(state, outcome.event, outcome.red);
}

function onTurnStart(state: GameState): void {
  clearKnightTurnFlags(state);
  for (const cp of Object.values(crownState(state).players)) {
    cp.progressPlayedThisTurn = 0;
    cp.progressPlayedBeforeRoll = false;
    cp.merchantFleet = null;
  }
}

function extraActions(state: GameState, playerId: PlayerId, out: Action[]): void {
  const player = getPlayer(state, playerId);
  discardActions(state, playerId, out);
  knightActions(state, player, out);
  improvementActions(state, player, out);
  wallActions(state, player, out);
  maritimeActions(state, playerId, out);
  progressCardActions(state, player, out);
}

function promptActions(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void {
  progressPromptActions(state, prompt, playerId, out);
  progressCardPromptActions(state, prompt, playerId, out);
  improvementPromptActions(state, prompt, playerId, out);
  fleetPromptActions(state, prompt, playerId, out);
  knightPromptActions(state, prompt, playerId, out);
}

function apply(state: GameState, action: Action): boolean {
  switch (action.type) {
    case "BUILD_KNIGHT":
      applyBuildKnight(state, action);
      return true;
    case "ACTIVATE_KNIGHT":
      applyActivateKnight(state, action);
      return true;
    case "PROMOTE_KNIGHT":
      applyPromoteKnight(state, action);
      return true;
    case "KNIGHT_MOVE":
      applyKnightMove(state, action);
      return true;
    case "KNIGHT_DISPLACE":
      applyKnightDisplace(state, action);
      return true;
    case "KNIGHT_CHASE_ROBBER":
      applyKnightChaseRobber(state, action);
      return true;
    case "RETREAT_KNIGHT":
      applyRetreatKnight(state, action);
      return true;
    case "BUILD_IMPROVEMENT":
      applyBuildImprovement(state, action);
      return true;
    case "PLACE_METROPOLIS":
      applyPlaceMetropolis(state, action);
      return true;
    case "BUILD_WALL":
      applyBuildWall(state, action);
      return true;
    case "DISCARD_PROGRESS":
      applyDiscardProgress(state, action);
      return true;
    case "CHOOSE_DOWNGRADE":
      applyChooseDowngrade(state, action);
      return true;
    case "PLAY_PROGRESS":
      applyPlayProgress(state, action);
      return true;
    case "CHOOSE_DESERTER":
      applyChooseDeserter(state, action);
      return true;
    case "PLACE_FREE_KNIGHT":
      applyPlaceFreeKnight(state, action);
      return true;
    case "SPY_TAKE":
      applySpyTake(state, action);
      return true;
    case "COMMERCIAL_SWAP":
      applyCommercialSwap(state, action);
      return true;
    case "GIVE_CARDS":
      applyGiveCards(state, action);
      return true;
    default:
      return false;
  }
}

registerModule({
  id: "crown",
  enabled: (state: GameState) => crownOn(state),
  init,
  roll,
  afterRoll,
  yieldOverride,
  afterProduction,
  onSeven: (state) => (crownState(state).attacks === 0 ? "noRobber" : undefined),
  extraActions,
  promptActions,
  apply,
  victoryPoints,
  cardCount,
  stealExtra,
  discardExtra,
  discardThreshold,
  onTurnStart,
  // docs/rules.md §16.9: the second setup placement is a city. The core has
  // already paid the starting resources (one per hex, no commodities).
  onSetupSettlement: (state, player, vertex, round) => {
    if (round === 2) upgradeToCity(state, player, vertex);
  },
  blockedVertices,
  unbuildableVertices: (state) => unbuildableVertices(state),
  maritime,
});
