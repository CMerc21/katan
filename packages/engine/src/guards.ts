/**
 * Small guards shared by the core transition and the modules: phase and
 * turn checks, paying the bank, validating hands.
 */

import { RuleError } from "./errors";
import { currentPlayerId, getPlayer, hasResources, isValidHand, transfer } from "./state";
import type { GameState, Hand, Phase, Player, PlayerId } from "./types";

export type PhaseOf<K extends Phase["kind"]> = Extract<Phase, { kind: K }>;

export function requirePhase<K extends Phase["kind"]>(state: GameState, ...kinds: K[]): PhaseOf<K> {
  const phase = state.phase;
  if (!(kinds as string[]).includes(phase.kind)) {
    throw new RuleError("WRONG_PHASE", `${phase.kind} phase does not allow this action`);
  }
  return phase as PhaseOf<K>;
}

export function requireCurrent(state: GameState, playerId: PlayerId): Player {
  const player = getPlayer(state, playerId);
  if (currentPlayerId(state) !== playerId) throw new RuleError("NOT_YOUR_TURN", `it is not ${playerId}'s turn`);
  return player;
}

/** The player who may build right now: the current player, or the special builder (docs/phase8.md §5). */
export function requireBuilder(state: GameState, playerId: PlayerId): Player {
  if (state.phase.kind === "specialBuild") {
    const player = getPlayer(state, playerId);
    if (state.phase.order[state.phase.index] !== playerId) throw new RuleError("NOT_YOUR_TURN", `it is not ${playerId}'s special build`);
    return player;
  }
  return requireCurrent(state, playerId);
}

export function pay(state: GameState, player: Player, cost: Hand): void {
  if (!hasResources(player.hand, cost)) throw new RuleError("INSUFFICIENT_RESOURCES", "cannot afford this");
  transfer(player.hand, state.bank, cost);
}

export function requireHand(value: unknown, what: string): Hand {
  if (!isValidHand(value)) throw new RuleError("INVALID_TRADE", `${what} is not a valid hand`);
  return value;
}

/** The player a module prompt is waiting on. */
export function requirePrompted<K extends import("./modules/types").ModulePrompt["kind"]>(state: GameState, kind: K, playerId: PlayerId): Extract<import("./modules/types").ModulePrompt, { kind: K }> {
  const phase = requirePhase(state, "modulePrompt");
  if (phase.prompt.kind !== kind) throw new RuleError("WRONG_PHASE", `waiting on ${phase.prompt.kind}, not ${kind}`);
  if (phase.prompt.playerId !== playerId) throw new RuleError("NOT_YOUR_PROMPT", `it is ${phase.prompt.playerId}'s decision`);
  getPlayer(state, playerId);
  return phase.prompt as Extract<import("./modules/types").ModulePrompt, { kind: K }>;
}
