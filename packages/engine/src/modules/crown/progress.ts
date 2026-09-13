/**
 * Crown & Castle §2, §4 (docs/phase11.md): the three progress decks, draws
 * on the event die, the hand limit and DISCARD_PROGRESS.
 *
 * Card effects (`PLAY_PROGRESS`) live in `progressActions.ts`; this file is
 * the seam they build on: `drawProgress`, `discardProgressToBottom`,
 * `removeHeldProgress`, `revealed`, `progressHandCount`, `enforceProgressLimit`.
 */

import { RuleError } from "../../errors";
import { requirePrompted } from "../../guards";
import { createRng } from "../../rng";
import { emit } from "../../state";
import type { Action, DiscardProgressAction, GameState, PlayerId } from "../../types";
import { finishPrompt, parkPrompt } from "../prompt";
import { PROGRESS_DECKS, PROGRESS_HAND_LIMIT, TRACKS, VP_PROGRESS_CARDS, isProgressCard, trackOfCard, type HeldProgress, type ModulePrompt, type ProgressCard, type Track } from "../types";
import { crownPlayer, crownState, seatOrder } from "./common";

/** §4: each track's 18 cards in a seeded order (top at index 0). */
export function initialDecks(seed: string): Record<Track, ProgressCard[]> {
  const out = {} as Record<Track, ProgressCard[]>;
  for (const track of TRACKS) {
    const cards: ProgressCard[] = [];
    for (const [card, n] of PROGRESS_DECKS[track]) for (let i = 0; i < n; i++) cards.push(card);
    out[track] = createRng(seed, `crown:deck:${track}`).shuffle(cards);
  }
  return out;
}

/** Cards in hand that count toward the limit (revealed VP cards do not). */
export function progressHandCount(state: GameState, playerId: PlayerId): number {
  return crownPlayer(state, playerId).progress.filter((c) => !c.revealed).length;
}

/** The player's face-up VP cards. */
export function revealed(state: GameState, playerId: PlayerId): ProgressCard[] {
  return crownPlayer(state, playerId).progress.filter((c) => c.revealed).map((c) => c.card);
}

/** Does the player hold `card` face down? */
export function holdsProgress(state: GameState, playerId: PlayerId, card: ProgressCard): boolean {
  return crownPlayer(state, playerId).progress.some((c) => c.card === card && !c.revealed);
}

/** Take one face-down `card` out of the player's hand (NO_PROGRESS_CARD when absent). */
export function removeHeldProgress(state: GameState, playerId: PlayerId, card: ProgressCard): HeldProgress {
  const hand = crownPlayer(state, playerId).progress;
  const idx = hand.findIndex((c) => c.card === card && !c.revealed);
  if (idx < 0) throw new RuleError("NO_PROGRESS_CARD", `${playerId} does not hold ${card}`);
  return hand.splice(idx, 1)[0] as HeldProgress;
}

/** §4: draw the top card of `track` into the player's hand (VP cards face up); null when the deck is empty. */
export function drawProgress(state: GameState, playerId: PlayerId, track: Track): ProgressCard | null {
  const deck = crownState(state).decks[track];
  const card = deck.shift();
  if (card === undefined) return null;
  crownPlayer(state, playerId).progress.push({ card, revealed: VP_PROGRESS_CARDS.includes(card) });
  emit(state, { kind: "progressDrawn", playerId, track, card });
  return card;
}

/** A card leaves a hand and goes under its deck. */
export function discardProgressToBottom(state: GameState, playerId: PlayerId, card: ProgressCard): void {
  removeHeldProgress(state, playerId, card);
  returnToDeck(state, card);
  emit(state, { kind: "progressDiscarded", playerId, card });
}

/** Put a card (played or discarded) under its deck. */
export function returnToDeck(state: GameState, card: ProgressCard): void {
  crownState(state).decks[trackOfCard(card)].push(card);
}

/** §2: red die `red` lets a player at `level` on the track draw. */
export function drawsOnRed(level: number, red: number): boolean {
  return red >= 2 && level >= red - 1;
}

/** §2: a track face — every qualifying player draws, in seat order from the current player; then the hand limit. */
export function drawForTrack(state: GameState, track: Track, red: number): void {
  for (const p of seatOrder(state)) {
    if (drawsOnRed(crownPlayer(state, p.id).tracks[track], red)) drawProgress(state, p.id, track);
  }
  enforceProgressLimit(state);
}

/** §4: anyone over the hand limit must discard; parks the first such player's prompt. Returns true when a prompt was parked. */
export function enforceProgressLimit(state: GameState): boolean {
  const next = nextOverLimit(state);
  if (!next) return false;
  parkPrompt(state, next);
  return true;
}

function nextOverLimit(state: GameState): ModulePrompt | null {
  for (const p of seatOrder(state)) {
    const over = progressHandCount(state, p.id) - PROGRESS_HAND_LIMIT;
    if (over > 0) return { kind: "discardProgress", playerId: p.id, count: over };
  }
  return null;
}

export function applyDiscardProgress(state: GameState, action: DiscardProgressAction): void {
  const prompt = requirePrompted(state, "discardProgress", action.playerId);
  if (!isProgressCard(action.card)) throw new RuleError("INVALID_PAYLOAD", "unknown progress card");
  discardProgressToBottom(state, action.playerId, action.card);
  const left = prompt.count - 1;
  finishPrompt(state, left > 0 ? { kind: "discardProgress", playerId: action.playerId, count: left } : nextOverLimit(state));
}

export function progressPromptActions(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void {
  if (prompt.kind !== "discardProgress" || prompt.playerId !== playerId) return;
  const seen = new Set<ProgressCard>();
  for (const held of crownPlayer(state, playerId).progress) {
    if (held.revealed || seen.has(held.card)) continue;
    seen.add(held.card);
    out.push({ type: "DISCARD_PROGRESS", playerId, card: held.card });
  }
}
