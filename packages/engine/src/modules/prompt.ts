/**
 * Prompt helpers: a module parks the game on a decision by wrapping the
 * current phase, and unwraps it when the decision is in.
 */

import type { GameState, Phase } from "../types";
import type { ModulePrompt } from "./types";

/** Ask `prompt.playerId` for a decision; play resumes in the phase that was current. */
export function parkPrompt(state: GameState, prompt: ModulePrompt): void {
  state.phase = { kind: "modulePrompt", prompt, returnTo: state.phase };
}

/** The current prompt is answered: continue with `next` (another prompt in the same chain) or resume. */
export function finishPrompt(state: GameState, next: ModulePrompt | null = null): void {
  const phase = state.phase;
  if (phase.kind !== "modulePrompt") throw new Error("finishPrompt outside a prompt");
  if (next) state.phase = { kind: "modulePrompt", prompt: next, returnTo: phase.returnTo };
  else state.phase = phase.returnTo;
}

/** The phase play will resume in once every wrapped prompt / gold choice has resolved. */
export function underlyingPhase(phase: Phase): Phase {
  let p = phase;
  for (;;) {
    if (p.kind === "modulePrompt") p = p.returnTo;
    else if (p.kind === "chooseGold") p = p.returnTo;
    else if (p.kind === "discard") p = p.returnTo;
    else return p;
  }
}
