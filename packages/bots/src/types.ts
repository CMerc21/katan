/**
 * Bot contract (docs/phase5.md §6.1).
 *
 * Bots see exactly what a human at that seat sees: a RedactedGameState.
 * They choose only from `legal`, and are deterministic given
 * (view, legal, rng).
 */

import type { Action, RedactedGameState } from "@katan/engine";

export type BotLevel = "easy" | "medium" | "hard";

export const BOT_LEVELS: readonly BotLevel[] = ["easy", "medium", "hard"];

export type RedactedState = RedactedGameState;

/** Uniform float in [0, 1). */
export type Rng = () => number;

export interface BotPolicy {
  readonly level: BotLevel;
  chooseAction(view: RedactedState, legal: Action[], rng: Rng): Action;
}

// ---------------------------------------------------------------------------
// Small deterministic helpers shared by every level.

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick: empty list");
  return items[Math.floor(rng() * items.length)] as T;
}

/** Highest-scoring item; ties broken by rng so play is not lopsided but still seeded. */
export function best<T>(rng: Rng, items: readonly T[], score: (item: T) => number): T {
  if (items.length === 0) throw new Error("best: empty list");
  let top = -Infinity;
  let ties: T[] = [];
  for (const item of items) {
    const s = score(item);
    if (s > top + 1e-9) {
      top = s;
      ties = [item];
    } else if (Math.abs(s - top) <= 1e-9) {
      ties.push(item);
    }
  }
  return ties.length === 1 ? (ties[0] as T) : pick(rng, ties);
}

export function ofType<T extends Action["type"]>(legal: Action[], type: T): Extract<Action, { type: T }>[] {
  return legal.filter((a): a is Extract<Action, { type: T }> => a.type === type);
}

export function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Return `action` only if it appears in `legal` (payload-bearing actions must match exactly). */
export function ensureLegal(legal: Action[], action: Action): Action | null {
  return legal.some((l) => sameAction(l, action)) ? action : null;
}
