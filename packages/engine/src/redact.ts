/**
 * `redact(state, playerId)`: the view of the game one player may see
 * (docs/phase2.md §4). Everything sent to a client goes through this.
 *
 * Module state (docs/phase10.md, docs/phase11.md §9): the event deck's
 * cards and the progress decks are hidden (counts only); other players'
 * progress cards show as a count plus their revealed VP cards; the merchant,
 * knights, walls, fish, chips and everything else is public.
 */

import { redactEvents, type GameEvent } from "./events";
import { legalActions } from "./legal";
import { cloneJson, handSize, victoryPoints } from "./state";
import { VP_PROGRESS_CARDS, type CrownPlayer, type CrownState, type EventCard, type HeldProgress, type ProgressCard, type Track, type WayfarersState } from "./modules/types";
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
  readonly ships: Player["ships"];
  readonly shipsBuiltThisTurn: Player["shipsBuiltThisTurn"];
  readonly shipMovedThisTurn: boolean;
  readonly startIslands: Player["startIslands"];
  readonly islandChips: Player["islandChips"];
  /** Buildings and special cards: visible to everyone. */
  readonly publicVP: number;
  /** Hidden victoryPoint cards; only present for the requesting player (everyone once the game has ended). */
  readonly privateVP: number | null;
}

/** Another player's progress hand: how many, and which VP cards are face up. */
export interface HiddenProgress {
  readonly count: number;
  readonly revealed: ProgressCard[];
}

export type RedactedCrownPlayer = Omit<CrownPlayer, "progress"> & { readonly progress: HeldProgress[] | HiddenProgress };

export type RedactedCrown = Omit<CrownState, "decks" | "players"> & {
  readonly decks: Record<Track, number>;
  readonly players: Record<PlayerId, RedactedCrownPlayer>;
};

export type RedactedWayfarers = Omit<WayfarersState, "eventDeck"> & {
  readonly eventDeck: { readonly count: number; readonly shuffles: number } | null;
};

export type RedactedGameState = Omit<GameState, "seed" | "players" | "devDeck" | "wayfarers" | "crown"> & {
  readonly viewer: PlayerId;
  readonly players: RedactedPlayer[];
  readonly devDeck: HiddenCount;
  readonly wayfarers: RedactedWayfarers | null;
  readonly crown: RedactedCrown | null;
  /** Events since the previous view this player received, redacted for them (docs/phase7.md §1.2). */
  readonly events: GameEvent[];
};

export function isHiddenCount(value: Hand | DevCard[] | HiddenCount): value is HiddenCount {
  return !Array.isArray(value) && "count" in value;
}

export function isHiddenProgress(value: HeldProgress[] | HiddenProgress): value is HiddenProgress {
  return !Array.isArray(value);
}

function redactCrown(crown: CrownState, viewer: PlayerId, revealAll: boolean): RedactedCrown {
  const { decks, players, ...rest } = crown;
  const out: Record<PlayerId, RedactedCrownPlayer> = {};
  for (const [id, p] of Object.entries(players)) {
    const mine = id === viewer || revealAll;
    out[id] = { ...p, progress: mine ? p.progress : { count: p.progress.length, revealed: p.progress.filter((c) => c.revealed).map((c) => c.card) } };
  }
  return { ...rest, decks: { trade: decks.trade.length, politics: decks.politics.length, science: decks.science.length }, players: out };
}

export function redact(state: GameState, viewer: PlayerId, events: readonly GameEvent[] = []): RedactedGameState {
  const { seed: _seed, players, devDeck, wayfarers, crown, ...rest } = cloneJson(state);
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
      ships: p.ships,
      shipsBuiltThisTurn: p.shipsBuiltThisTurn,
      shipMovedThisTurn: p.shipMovedThisTurn,
      startIslands: p.startIslands,
      islandChips: p.islandChips,
      publicVP: vp.publicVP,
      privateVP: showVP ? vp.hiddenVP : null,
    };
  });
  return {
    ...rest,
    viewer,
    players: redactedPlayers,
    devDeck: { count: devDeck.length },
    wayfarers: wayfarers ? { ...wayfarers, eventDeck: wayfarers.eventDeck ? { count: wayfarers.eventDeck.cards.length, shuffles: wayfarers.eventDeck.shuffles } : null } : null,
    crown: crown ? redactCrown(crown, viewer, revealAll) : null,
    events: redactEvents(events, viewer),
  };
}

const PLACEHOLDER_CARD: EventCard = { total: 7, event: null, reshuffle: false };

/**
 * Rebuild a GameState-shaped object from a redacted view so the engine's
 * pure queries (`legalActions`) can run on the client and inside bots.
 *
 * Hidden information is filled with placeholders: other players' hands and
 * development cards are empty, the deck is an array of the right length
 * (contents unknown), and the seed is blank. `legalActions` for the viewer
 * never depends on any of those: it reads only the viewer's own hand and
 * cards, the deck *size*, public pieces, and the phase. Module decks and
 * other players' progress hands are filled the same way (counts kept).
 */
export function viewToState(view: RedactedGameState): GameState {
  const { viewer, players, devDeck, events, wayfarers, crown, ...rest } = view;
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
    ships: [...p.ships],
    shipsBuiltThisTurn: [...p.shipsBuiltThisTurn],
    shipMovedThisTurn: p.shipMovedThisTurn,
    startIslands: [...p.startIslands],
    islandChips: [...p.islandChips],
  }));
  let fullCrown: CrownState | null = null;
  if (crown) {
    const { decks, players: cp, ...crest } = cloneJson(crown);
    const fullPlayersCrown: Record<PlayerId, CrownPlayer> = {};
    for (const [id, p] of Object.entries(cp)) {
      const progress: HeldProgress[] = isHiddenProgress(p.progress)
        ? [
            ...p.progress.revealed.map((card): HeldProgress => ({ card, revealed: true })),
            ...Array.from({ length: Math.max(0, p.progress.count - p.progress.revealed.length) }, (): HeldProgress => ({ card: "merchant", revealed: false })),
          ]
        : p.progress;
      fullPlayersCrown[id] = { ...p, progress };
    }
    const filler = (n: number): ProgressCard[] => Array.from({ length: n }, () => "merchant" as const);
    fullCrown = { ...crest, decks: { trade: filler(decks.trade), politics: filler(decks.politics), science: filler(decks.science) }, players: fullPlayersCrown };
  }
  const fullWayfarers: WayfarersState | null = wayfarers
    ? { ...cloneJson(wayfarers), eventDeck: wayfarers.eventDeck ? { cards: Array.from({ length: wayfarers.eventDeck.count }, () => ({ ...PLACEHOLDER_CARD })), shuffles: wayfarers.eventDeck.shuffles } : null }
    : null;
  return {
    ...cloneJson(rest),
    seed: "",
    players: fullPlayers,
    devDeck: Array.from({ length: devDeck.count }, () => "knight" as const),
    wayfarers: fullWayfarers,
    crown: fullCrown,
  };
}

/** Legal actions for the viewer of a redacted state (client hints and bots). */
export function legalActionsForView(view: RedactedGameState): Action[] {
  return legalActions(viewToState(view), view.viewer);
}

export { VP_PROGRESS_CARDS };
