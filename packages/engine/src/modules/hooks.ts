/**
 * The module hook list (docs/phase11.md §9). The core never tests a
 * scenario flag itself: every module registers a `ModuleHooks` object and
 * the core calls the hooks of the modules a game has switched on, in
 * registration order. Modules register at import time; `actions.ts` and
 * `game.ts` import `./modules` so the registry is always full.
 */

import type { Resource } from "../board";
import type { HexId, VertexId, EdgeId } from "../geometry";
import type { Action, GameState, Hand, Player, PlayerId } from "../types";
import type { Rng } from "../rng";
import type { EventCardKind, EventDie, ModulePrompt } from "./types";

export type ModuleId = "eventDeck" | "fishing" | "rivers" | "harbormaster" | "raiders" | "caravans" | "wagons" | "crown";

export interface RollOutcome {
  readonly dice: [number, number];
  readonly total: number;
  /** Event deck (docs/phase10.md §1). */
  readonly card?: { total: number; event: EventCardKind | null };
  /** Crown & Castle (docs/phase11.md §2). */
  readonly red?: number;
  readonly event?: EventDie;
}

export interface ProduceContext {
  /** Resource cards each player received this roll (after bank shortage). */
  readonly received: Record<PlayerId, number>;
  /** Gold owed per player; hooks may add to it (a resource of the player's choice). */
  readonly gold: Record<PlayerId, number>;
}

export interface ModuleHooks {
  readonly id: ModuleId;
  /** Is the module on for this game? */
  enabled(state: GameState): boolean;
  /** Fresh per-game state, called once by `createGame` after the base state exists. */
  init?(state: GameState): void;
  /** Adjust the roll: the event deck replaces the dice, Crown & Castle adds the event die. Draw further randomness from `draw`. */
  roll?(state: GameState, player: Player, outcome: RollOutcome, draw: Rng): RollOutcome;
  /** After the number is known and before production / the seven (crown's event die, event cards). Return true to swallow the rest of the roll. */
  afterRoll?(state: GameState, player: Player, roll: RollOutcome): boolean | void;
  /** May a hex produce this roll (raided hexes do not). */
  hexProduces?(state: GameState, hex: HexId): boolean;
  /** Override what a building on a hex yields; null keeps the base rule. `resources` is how many of the terrain's resource. */
  yieldOverride?(state: GameState, hex: HexId, owner: PlayerId, building: "settlement" | "city"): { resources: number } | null;
  /** After resource production (and the base gold map) for a non-seven roll. */
  afterProduction?(state: GameState, total: number, ctx: ProduceContext): void;
  /** On a seven, before the robber: return "noRobber" to skip the robber move (Robber's Rest, the first-attack rule). */
  onSeven?(state: GameState): "noRobber" | void;
  /** Extra legal actions for `playerId` in the given phase (action, roll, specialBuild, or any other core phase). */
  extraActions?(state: GameState, playerId: PlayerId, out: Action[]): void;
  /** Legal actions inside one of this module's prompts. */
  promptActions?(state: GameState, prompt: ModulePrompt, playerId: PlayerId, out: Action[]): void;
  /** Handle a module action; return true when handled (the core then bumps the action index and checks the win). */
  apply?(state: GameState, action: Action): boolean;
  /** Extra victory points. */
  victoryPoints?(state: GameState, player: Player): { publicVP: number; hiddenVP: number };
  /** Extra cards in hand that count toward the discard limit and are stealable (commodities). */
  cardCount?(state: GameState, player: Player): number;
  /** Discarding module cards: validate (and, when `commit`, move) `extra` from the player's module hand; return how many cards it holds. */
  discardExtra?(state: GameState, player: Player, extra: unknown, commit: boolean): number;
  /** The hand size above which a seven forces a discard (base 7). */
  discardThreshold?(state: GameState, player: Player): number;
  onTurnStart?(state: GameState): void;
  onTurnEnd?(state: GameState, player: Player): void;
  /** A road, ship, settlement or city was placed (setup included). */
  onBuilt?(state: GameState, playerId: PlayerId, piece: "road" | "ship" | "settlement" | "city", at: EdgeId | VertexId): void;
  /** A settlement placed during setup (round 1 or 2). */
  onSetupSettlement?(state: GameState, player: Player, vertex: VertexId, round: 1 | 2): void;
  /** Extra cost for a road on an edge (bridges). */
  roadCost?(state: GameState, edge: EdgeId): Hand | null;
  /** Vertices `playerId`'s roads may not pass through (opposing knights break the network). */
  blockedVertices?(state: GameState, playerId: PlayerId): Set<VertexId>;
  /** Vertices `playerId` may not place a settlement on (any knight stands there). */
  unbuildableVertices?(state: GameState, playerId: PlayerId): Set<VertexId>;
  /** Longest road weight of an edge (caravans double it). */
  edgeWeight?(state: GameState, playerId: PlayerId, edge: EdgeId): number;
  /** Extra maritime trade legality: give/receive may be a commodity. Return true when handled. */
  maritime?(state: GameState, player: Player, give: string, giveCount: number, receive: string): boolean;
  /** A player-to-player trade completed (the boot rides along, docs/phase10.md §2). */
  onTradeAccepted?(state: GameState, offerer: Player, acceptor: Player, boot: { offer: boolean; accept: boolean }): void;
  /** Random steal: extra stealable cards (commodities). Returns the picked card name or null when a resource was picked. */
  stealExtra?(state: GameState, thief: Player, victim: Player, roll: number): string | null;
}

const registry: ModuleHooks[] = [];

export function registerModule(hooks: ModuleHooks): void {
  if (registry.some((h) => h.id === hooks.id)) return;
  registry.push(hooks);
}

export function allModules(): readonly ModuleHooks[] {
  return registry;
}

/** The hooks of every module switched on for `state`, in registration order. */
export function activeModules(state: GameState): ModuleHooks[] {
  return registry.filter((h) => h.enabled(state));
}

export function moduleById(id: ModuleId): ModuleHooks | undefined {
  return registry.find((h) => h.id === id);
}

/** Sum a numeric hook over the active modules. */
export function sumHook(state: GameState, fn: (h: ModuleHooks) => number | undefined): number {
  let n = 0;
  for (const h of activeModules(state)) n += fn(h) ?? 0;
  return n;
}

export { type Resource };
