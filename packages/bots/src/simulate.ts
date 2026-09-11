/**
 * Bot-driven simulation (docs/phase5.md §6.2, §6.7). Used by tests and by
 * the server's bot loop helper: every bot decision goes through the same
 * redaction boundary as a human client.
 */

import {
  applyAction,
  createGame,
  legalActions,
  nextActor,
  redact,
  rng,
  type Action,
  type CreateGameOptions,
  type GameState,
  type PlayerId,
} from "@katan/engine";
import { createBot } from "./index";
import { sameAction, type BotLevel, type BotPolicy } from "./types";

export class IllegalBotAction extends Error {
  constructor(
    readonly playerId: PlayerId,
    readonly action: Action,
  ) {
    super(`bot ${playerId} chose an illegal action ${JSON.stringify(action)}`);
  }
}

/**
 * Choose and validate one bot action for the acting player. The bot sees
 * only `redact(state, actor)`; its choice must be present in the legal list.
 */
export function botStep(state: GameState, actor: PlayerId, policy: BotPolicy): Action {
  const legal = legalActions(state, actor);
  if (legal.length === 0) throw new Error(`no legal actions for ${actor}`);
  const view = redact(state, actor);
  const draw = rng(state.seed, state.actionIndex);
  const action = policy.chooseAction(view, legal, () => draw.next());
  if (!legal.some((l) => sameAction(l, action))) throw new IllegalBotAction(actor, action);
  return action;
}

export interface BotGameResult {
  readonly final: GameState;
  readonly actions: Action[];
  readonly turns: number;
}

/** Play a whole game where every seat is a bot of the given level. */
export function playBotGame(
  options: CreateGameOptions & { levels: readonly BotLevel[]; maxTurns?: number; maxActions?: number },
): BotGameResult {
  const { levels, maxTurns = 400, maxActions = 20_000, ...create } = options;
  const policies = new Map<PlayerId, BotPolicy>();
  create.players.forEach((p, i) => policies.set(p.id, createBot(levels[i] ?? levels[levels.length - 1] ?? "easy")));
  let state = createGame(create);
  const actions: Action[] = [];
  while (state.phase.kind !== "ended" && state.turn < maxTurns && actions.length < maxActions) {
    const actor = nextActor(state);
    const action = botStep(state, actor, policies.get(actor)!);
    state = applyAction(state, action);
    actions.push(action);
  }
  return { final: state, actions, turns: state.turn };
}
