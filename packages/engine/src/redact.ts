/**
 * `redact(state, playerId)`: the view of the game one player may see
 * (docs/phase2.md §4). Everything sent to a client goes through this.
 */

import { cloneJson, handSize, victoryPoints } from "./state";
import type { DevCard, GameState, Hand, Player, PlayerId } from "./types";

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
};

export function isHiddenCount(value: Hand | DevCard[] | HiddenCount): value is HiddenCount {
  return !Array.isArray(value) && "count" in value;
}

export function redact(state: GameState, viewer: PlayerId): RedactedGameState {
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
  return { ...rest, viewer, players: redactedPlayers, devDeck: { count: devDeck.length } };
}
