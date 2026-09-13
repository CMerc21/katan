/**
 * Small pure helpers over GameState: hands, costs, lookups, victory points.
 */

import { RESOURCES, boardGeometry, type PortKind, type Resource } from "./board";
import { RuleError } from "./errors";
import { describeEvent, eventPlayer, type EventBody, type GameEvent } from "./events";
import type { EdgeId, HexId, VertexId } from "./geometry";
import { activeModules } from "./modules/hooks";
import type { VariantName } from "./modules/types";
import { WINNING_VP, type GameState, type Hand, type LogEntry, type Player, type PlayerId } from "./types";

// ---------------------------------------------------------------------------
// Hands

export function emptyHand(): Hand {
  return { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
}

/** Build a full hand from a partial one. */
export function hand(partial: Partial<Hand>): Hand {
  return { ...emptyHand(), ...partial };
}

export function handSize(h: Hand): number {
  let n = 0;
  for (const r of RESOURCES) n += h[r];
  return n;
}

export function isValidHand(h: unknown): h is Hand {
  if (typeof h !== "object" || h === null) return false;
  const obj = h as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(RESOURCES as readonly string[]).includes(key)) return false;
  }
  return RESOURCES.every((r) => {
    const v = obj[r];
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
  });
}

export function hasResources(h: Hand, cost: Hand): boolean {
  return RESOURCES.every((r) => h[r] >= cost[r]);
}

/** target += sign * delta (mutates target). */
export function addHand(target: Hand, delta: Hand, sign: 1 | -1 = 1): void {
  for (const r of RESOURCES) target[r] += sign * delta[r];
}

/** Move `amount` from one hand to another (mutates both). */
export function transfer(from: Hand, to: Hand, amount: Hand): void {
  addHand(from, amount, -1);
  addHand(to, amount, 1);
}

/** Expand a hand into a list of resources in canonical order (for random draws). */
export function expandHand(h: Hand): Resource[] {
  const out: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < h[r]; i++) out.push(r);
  return out;
}

/** §5.1 */
export const COSTS = {
  road: hand({ wood: 1, clay: 1 }),
  settlement: hand({ wood: 1, clay: 1, wool: 1, grain: 1 }),
  city: hand({ grain: 2, ore: 3 }),
  devCard: hand({ ore: 1, wool: 1, grain: 1 }),
  /** §14.2 */
  ship: hand({ wood: 1, wool: 1 }),
} as const;

// ---------------------------------------------------------------------------
// Players

export function getPlayer(state: GameState, id: PlayerId): Player {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new RuleError("UNKNOWN_PLAYER", `unknown player ${id}`);
  return player;
}

export function playerIndex(state: GameState, id: PlayerId): number {
  const i = state.players.findIndex((p) => p.id === id);
  if (i < 0) throw new RuleError("UNKNOWN_PLAYER", `unknown player ${id}`);
  return i;
}

export function currentPlayer(state: GameState): Player {
  const p = state.players[state.currentPlayer];
  if (!p) throw new Error(`bad currentPlayer index ${state.currentPlayer}`);
  return p;
}

export function currentPlayerId(state: GameState): PlayerId {
  return currentPlayer(state).id;
}

// ---------------------------------------------------------------------------
// Board occupancy

export type BuildingKind = "settlement" | "city";

export interface Building {
  readonly owner: PlayerId;
  readonly kind: BuildingKind;
}

export function buildingAt(state: GameState, vertex: VertexId): Building | null {
  for (const p of state.players) {
    if (p.settlements.includes(vertex)) return { owner: p.id, kind: "settlement" };
    if (p.cities.includes(vertex)) return { owner: p.id, kind: "city" };
  }
  return null;
}

export function roadOwner(state: GameState, edge: EdgeId): PlayerId | null {
  for (const p of state.players) {
    if (p.roads.includes(edge)) return p.id;
  }
  return null;
}

export function buildingsMap(state: GameState): Map<VertexId, Building> {
  const map = new Map<VertexId, Building>();
  for (const p of state.players) {
    for (const v of p.settlements) map.set(v, { owner: p.id, kind: "settlement" });
    for (const v of p.cities) map.set(v, { owner: p.id, kind: "city" });
  }
  return map;
}

export function roadsMap(state: GameState): Map<EdgeId, PlayerId> {
  const map = new Map<EdgeId, PlayerId>();
  for (const p of state.players) for (const e of p.roads) map.set(e, p.id);
  return map;
}

/** §14.2 */
export function shipOwner(state: GameState, edge: EdgeId): PlayerId | null {
  for (const p of state.players) {
    if (p.ships.includes(edge)) return p.id;
  }
  return null;
}

export function shipsMap(state: GameState): Map<EdgeId, PlayerId> {
  const map = new Map<EdgeId, PlayerId>();
  for (const p of state.players) for (const e of p.ships) map.set(e, p.id);
  return map;
}

/** Whoever holds the edge with a road or a ship. */
export function edgeOwner(state: GameState, edge: EdgeId): PlayerId | null {
  return roadOwner(state, edge) ?? shipOwner(state, edge);
}

/** The island a vertex belongs to (§14.4), or null for a sea-only vertex. */
export function islandOfVertex(state: GameState, vertex: VertexId): number | null {
  for (const h of boardGeometry(state.board).vertexHexes[vertex] ?? []) {
    if (state.board.hexes[h] === undefined) continue;
    const island = state.board.islands.find((i) => i.hexes.includes(h));
    if (island) return island.id;
  }
  return null;
}

export interface HexBuilding extends Building {
  readonly vertex: VertexId;
}

/** Buildings on the corners of a hex. */
export function buildingsOnHex(state: GameState, hex: HexId): HexBuilding[] {
  const out: HexBuilding[] = [];
  for (const v of boardGeometry(state.board).hexVertices[hex] ?? []) {
    const b = buildingAt(state, v);
    if (b) out.push({ ...b, vertex: v });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ports (§9.2)

export function portsOf(state: GameState, player: Player): Set<PortKind> {
  const kinds = new Set<PortKind>();
  const mine = new Set([...player.settlements, ...player.cities]);
  for (const port of state.board.ports) {
    if (port.vertices.some((v) => mine.has(v))) kinds.add(port.kind);
  }
  return kinds;
}

/** Best maritime ratio the player may use when giving `resource`. */
export function bestRatio(state: GameState, player: Player, resource: Resource): 4 | 3 | 2 {
  const ports = portsOf(state, player);
  if (ports.has(resource)) return 2;
  if (ports.has("any")) return 3;
  return 4;
}

export function ratioAllowed(state: GameState, player: Player, resource: Resource, ratio: number): boolean {
  if (ratio === 4) return true;
  const ports = portsOf(state, player);
  if (ratio === 3) return ports.has("any");
  if (ratio === 2) return ports.has(resource);
  return false;
}

// ---------------------------------------------------------------------------
// Victory points (§2.8)

export interface VictoryPoints {
  /** Visible to everyone: buildings and special cards. */
  readonly publicVP: number;
  /** Hidden victoryPoint cards. */
  readonly hiddenVP: number;
  readonly total: number;
}

export function victoryPoints(state: GameState, player: Player): VictoryPoints {
  let publicVP = player.settlements.length + 2 * player.cities.length;
  if (state.longestRoad.playerId === player.id) publicVP += 2;
  if (state.largestArmy.playerId === player.id) publicVP += 2;
  publicVP += player.islandChips.length * (state.scenario?.islandBonus ?? 0); // §14.4
  let hiddenVP = player.devCards.filter((c) => c.type === "victoryPoint").length;
  // Module terms (docs/phase10.md, docs/phase11.md §8).
  for (const h of activeModules(state)) {
    const extra = h.victoryPoints?.(state, player);
    if (extra) {
      publicVP += extra.publicVP;
      hiddenVP += extra.hiddenVP;
    }
  }
  return { publicVP, hiddenVP, total: publicVP + hiddenVP };
}

/** §11, or the scenario's target (docs/phase9.md §5). */
export function winningVP(state: GameState): number {
  return state.scenario?.victoryPoints ?? WINNING_VP;
}

export function hasWon(state: GameState, player: Player): boolean {
  return victoryPoints(state, player).total >= winningVP(state);
}

/** Tides module on (docs/rules.md §14). */
export function tidesOn(state: GameState): boolean {
  return state.scenario?.tides === true;
}

/** Crown & Castle on (docs/phase11.md). */
export function crownOn(state: GameState): boolean {
  return state.scenario?.crown === true;
}

/** A Wayfarers variant on (docs/phase10.md). */
export function variantOn(state: GameState, name: VariantName): boolean {
  return state.scenario?.variants[name] === true;
}

/** Cards in hand that count toward the discard limit and can be stolen: resources plus module cards (commodities). */
export function cardCount(state: GameState, player: Player): number {
  let n = handSize(player.hand);
  for (const h of activeModules(state)) n += h.cardCount?.(state, player) ?? 0;
  return n;
}

/** §7.1: the hand size above which a seven forces a discard (7, raised by city walls under Crown & Castle). */
export function discardThreshold(state: GameState, player: Player): number {
  let t = 7;
  for (const h of activeModules(state)) t = Math.max(t, h.discardThreshold?.(state, player) ?? 7);
  return t;
}

/** §7.1: cards owed by a player holding `size` cards with the given threshold. */
export function discardOwedFor(size: number, threshold = 7): number {
  return size > threshold ? Math.floor(size / 2) : 0;
}

// ---------------------------------------------------------------------------
// Log

/** The UI feed keeps only the most recent entries; the action log is the audit trail. */
export const LOG_LIMIT = 100;

export function appendLog(state: GameState, playerId: PlayerId | null, text: string): void {
  const entry: LogEntry = { turn: state.turn, playerId, text };
  state.log.push(entry);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

// ---------------------------------------------------------------------------
// Events (docs/phase7.md §1)

let sink: GameEvent[] | null = null;

/**
 * Run `fn` collecting every event emitted meanwhile. `applyActionWithEvents`
 * is the only caller; nesting is safe (the previous sink is restored).
 */
export function collectEvents<T>(fn: () => T): { result: T; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const previous = sink;
  sink = events;
  try {
    const result = fn();
    return { result, events };
  } finally {
    sink = previous;
  }
}

/**
 * Record an event: number it, hand it to the collector, and append its
 * public description to `state.log`. Mutates `state`.
 */
export function emit(state: GameState, body: EventBody): GameEvent {
  const event = { seq: state.eventSeq, ...body } as GameEvent;
  state.eventSeq += 1;
  if (sink) sink.push(event);
  const text = describeEvent(event, (id) => state.players.find((p) => p.id === id)?.name ?? id);
  if (text !== null) appendLog(state, eventPlayer(event), text);
  return event;
}

/** A free-text log line from outside the rules (server escape hatches). */
export function appendNote(state: GameState, playerId: PlayerId | null, text: string): void {
  emit(state, { kind: "note", playerId, text });
}

/**
 * Deep-clone a JSON-shaped value (plain objects, arrays, primitives). The
 * state is exactly that, and this keeps the engine free of host APIs.
 */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => cloneJson(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneJson(v);
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Who must act next

/**
 * The player whose input the game is waiting for: the current player, or a
 * player who owes a discard (§7.1), or, in seat order after the offerer,
 * the next player who has not yet answered an open trade offer (§9.1).
 */
export function nextActor(state: GameState): PlayerId {
  const current = currentPlayerId(state);
  const phase = state.phase;
  if (phase.kind === "specialBuild") return phase.order[phase.index] ?? current;
  if (phase.kind === "modulePrompt") return phase.prompt.playerId;
  if (phase.kind === "discard") {
    const owing = state.players.find((p) => state.pendingDiscards[p.id] !== undefined);
    return owing ? owing.id : current;
  }
  if (phase.kind === "chooseGold") {
    // §14.3: in seat order from the current player.
    const n = state.players.length;
    for (let step = 0; step < n; step++) {
      const p = state.players[(state.currentPlayer + step) % n] as Player;
      if (phase.owed[p.id] !== undefined) return p.id;
    }
    return current;
  }
  if (phase.kind === "action" && state.pendingTrade) {
    const trade = state.pendingTrade;
    const n = state.players.length;
    for (let step = 1; step < n; step++) {
      const p = state.players[(state.currentPlayer + step) % n] as Player;
      if (p.id !== trade.from && !trade.rejectedBy.includes(p.id)) return p.id;
    }
  }
  return current;
}
