/**
 * `redact(state, playerId)`: the view of the game one player may see
 * (docs/phase2.md §4). Everything sent to a client goes through this.
 */

import { redactEvents, type GameEvent } from "./events";
import { legalActions } from "./legal";
import { cloneJson, handSize, victoryPoints } from "./state";
import type { Action, DevCard, GameState, Hand, Player, PlayerId } from "./types";

export interface HiddenCount {
  readonly count: number;
}

export interface RedactedPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: Player["color"];
  readonly hand: Hand | HiddenCount;
  readonly devCards: DevCard[] | HiddenCount;
  readonly playedKnights: number;
  readonly devCardPlayedThisTurn: boolean;
  readonly pieces: Player["pieces"];
  readonly roads: Player["roads"];
  readonly settlements: Player["settlements"];
  readonly cities: Player["cities"];
  /** Buildings and special cards: visible to everyone. */
  readonly publicVP: number;
  /** Hidden victoryPoint cards; only present for the requesting player (everyone once the game has ended). */
  readonly privateVP: number | null;
}

export type RedactedGameState = Omit<GameState, "seed" | "players" | "devDeck"> & {
  readonly viewer: PlayerId;
  readonly players: RedactedPlayer[];
  readonly devDeck: HiddenCount;
  /** Events since the previous view this player received, redacted for them (docs/phase7.md §1.2). */
  readonly events: GameEvent[];
};

export function isHiddenCount(value: Hand | DevCard[] | HiddenCount): value is HiddenCount {
  return !Array.isArray(value) && "count" in value;
}

export function redact(state: GameState, viewer: PlayerId, events: readonly GameEvent[] = []): RedactedGameState {
  const { seed: _seed, players, devDeck, ...rest } = cloneJson(state);
  void _seed;
  const revealAll = state.phase.kind === "ended";
  const redactedPlayers: RedactedPlayer[] = players.map((p) => {
    const vp = victoryPoints(state, p);
    const mine = p.id === viewer;
    const showVP = mine || revealAll;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      hand: mine ? p.hand : { count: handSize(p.hand) },
      devCards: mine ? p.devCards : { count: p.devCards.length },
      playedKnights: p.playedKnights,
      devCardPlayedThisTurn: p.devCardPlayedThisTurn,
      pieces: p.pieces,
      roads: p.roads,
      settlements: p.settlements,
      cities: p.cities,
      publicVP: vp.publicVP,
      privateVP: showVP ? vp.hiddenVP : null,
    };
  });
  return { ...rest, viewer, players: redactedPlayers, devDeck: { count: devDeck.length }, events: redactEvents(events, viewer) };
}

/**
 * Rebuild a GameState-shaped object from a redacted view so the engine's
 * pure queries (`legalActions`) can run on the client and inside bots.
 *
 * Hidden information is filled with placeholders: other players' hands and
 * development cards are empty, the deck is an array of the right length
 * (contents unknown), and the seed is blank. `legalActions` for the viewer
 * never depends on any of those: it reads only the viewer's own hand and
 * cards, the deck *size*, public pieces, and the phase. Exception: none
 * found; `phase.targets` for a steal is computed server-side when the
 * robber moves, so steal legality does not need opponents' hand sizes.
 */
export function viewToState(view: RedactedGameState): GameState {
  const { viewer, players, devDeck, events, ...rest } = view;
  void viewer;
  void events;
  const fullPlayers: Player[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    hand: isHiddenCount(p.hand) ? { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 } : cloneJson(p.hand),
    devCards: isHiddenCount(p.devCards) ? [] : cloneJson(p.devCards),
    playedKnights: p.playedKnights,
    devCardPlayedThisTurn: p.devCardPlayedThisTurn,
    pieces: { ...p.pieces },
    roads: [...p.roads],
    settlements: [...p.settlements],
    cities: [...p.cities],
  }));
  return {
    ...cloneJson(rest),
    seed: "",
    players: fullPlayers,
    devDeck: Array.from({ length: devDeck.count }, () => "knight" as const),
  };
}

/** Legal actions for the viewer of a redacted state (client hints and bots). */
export function legalActionsForView(view: RedactedGameState): Action[] {
  return legalActions(viewToState(view), view.viewer);
}
