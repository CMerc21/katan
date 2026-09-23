/**
 * Pure helpers behind the HUD (docs/phase12.md §1, §4): banner statistics,
 * cost-card rows with affordability and reasons, hand sizes, and the dice
 * history. No React here so the unit tests can drive them directly.
 */

import { COSTS, KNIGHTS_PER_LEVEL, MAX_WALLS, RESOURCES, isHiddenCount, isHiddenProgress, type Action, type EventDie, type Hand, type Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { TargetMode } from "@/board3d/Interaction";
import { COST_TEXT, KNIGHT_COST_TEXT, WALL_COST_TEXT, currentPlayerId, setupPiece } from "@/game/labels";
import type { IconName } from "./icons";

export type RedactedPlayer = RedactedState["players"][number];

export function handSize(p: RedactedPlayer): number {
  const h = p.hand;
  return isHiddenCount(h) ? h.count : RESOURCES.reduce((n, r) => n + h[r], 0);
}

export function devCount(p: RedactedPlayer): number {
  return isHiddenCount(p.devCards) ? p.devCards.count : p.devCards.length;
}

export function totalVP(p: RedactedPlayer): number {
  return p.publicVP + (p.privateVP ?? 0);
}

export interface StatColumn {
  readonly key: "roads" | "army" | "defense" | "knights" | "dev" | "progress" | "hand";
  readonly value: number;
  readonly icon: IconName;
  /** The column glows gold while the player holds the matching title. */
  readonly title: boolean;
  readonly label: string;
}

export interface BannerStats {
  readonly vp: number;
  readonly cards: number;
  /** The two pills under the portrait. */
  readonly pills: readonly [{ icon: IconName; value: number; label: string }, { icon: IconName; value: number; label: string }];
  readonly columns: readonly StatColumn[];
}

/** Everything a banner shows for one player (docs/phase12.md §1). */
export function bannerStats(view: RedactedState, p: RedactedPlayer): BannerStats {
  const crown = view.scenario?.crown === true ? view.crown : null;
  const cp = crown?.players[p.id];
  if (crown && cp) {
    const knights = crown.knights.filter((k) => k.owner === p.id);
    const active = knights.filter((k) => k.active);
    const defense = active.reduce((n, k) => n + k.level, 0);
    const progress = isHiddenProgress(cp.progress) ? cp.progress.count : cp.progress.length;
    return {
      vp: totalVP(p),
      cards: handSize(p),
      pills: [
        { icon: "knight", value: active.length, label: "active knights" },
        { icon: "shield", value: defense, label: "defence" },
      ],
      columns: [
        { key: "roads", value: p.roads.length, icon: "road", title: view.longestRoad.playerId === p.id, label: "roads" },
        { key: "defense", value: defense, icon: "shield", title: cp.defenderChips > 0, label: "defence" },
        { key: "knights", value: knights.length, icon: "knight", title: false, label: "knights" },
        { key: "progress", value: progress, icon: "card", title: false, label: "progress cards" },
        { key: "hand", value: handSize(p), icon: "cards", title: false, label: "cards in hand" },
      ],
    };
  }
  return {
    vp: totalVP(p),
    cards: handSize(p),
    pills: [
      { icon: "army", value: p.playedKnights, label: "knights played" },
      { icon: "road", value: view.longestRoad.playerId === p.id ? view.longestRoad.length : 0, label: "longest road" },
    ],
    columns: [
      { key: "roads", value: p.roads.length, icon: "road", title: view.longestRoad.playerId === p.id, label: "roads" },
      { key: "army", value: p.playedKnights, icon: "army", title: view.largestArmy.playerId === p.id, label: "knights played" },
      { key: "knights", value: isHiddenCount(p.devCards) ? 0 : p.devCards.filter((c) => c.type === "knight").length, icon: "knight", title: false, label: "knight cards" },
      { key: "dev", value: devCount(p), icon: "card", title: false, label: "development cards" },
      { key: "hand", value: handSize(p), icon: "cards", title: false, label: "cards in hand" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Build cost card

export type CostRowKey = "road" | "ship" | "settlement" | "city" | "devCard" | "wall" | "knight" | "promote" | "improvement";

export interface CostRow {
  readonly key: CostRowKey;
  /** Icons on the right, one per card. */
  readonly cost: readonly IconName[];
  /** The row is enabled: clicking enters `mode` or dispatches `action`. */
  readonly affordable: boolean;
  /** Why the row is off, or null. */
  readonly reason: string | null;
  readonly mode?: TargetMode;
  readonly action?: Action;
  /** Rows that open a sheet instead of a board mode. */
  readonly opens?: "improve";
}

function icons(hand: Hand): IconName[] {
  const out: IconName[] = [];
  for (const r of RESOURCES) for (let i = 0; i < hand[r]; i++) out.push(r);
  return out;
}

function afford(hand: Hand, cost: Hand): boolean {
  return RESOURCES.every((r) => hand[r] >= cost[r]);
}

/** Why a build is disabled, or null when it is legal (docs/phase3.md §5). */
export function buildReason(view: RedactedState, player: RedactedPlayer, hand: Hand, legal: readonly Action[], kind: "road" | "settlement" | "city" | "ship"): string | null {
  const type = kind === "road" ? "BUILD_ROAD" : kind === "settlement" ? "BUILD_SETTLEMENT" : kind === "ship" ? "BUILD_SHIP" : "BUILD_CITY";
  // Setup placements and Road Building's free roads are legal builds, but they are placed on the board, not bought from the card.
  if (view.phase.kind === "setup") return "Place your starting pieces on the board";
  if (view.phase.kind === "roadBuilding") return "Place the free roads on the board";
  if (legal.some((a) => a.type === type)) return null;
  if (view.phase.kind !== "action" && view.phase.kind !== "specialBuild") return "Only after rolling";
  const pieces = kind === "road" ? player.pieces.roads : kind === "settlement" ? player.pieces.settlements : kind === "ship" ? player.pieces.ships : player.pieces.cities;
  if (pieces <= 0) return "No pieces of that kind left";
  if (!afford(hand, COSTS[kind])) return `Needs ${COST_TEXT[kind]}`;
  if (kind === "city") return "No settlement to upgrade";
  if (kind === "ship") return "No sea edge joins your ships or settlements";
  return "No legal spot";
}

/** docs/phase9.md §2: why no ship may move right now. */
export function moveShipReason(player: RedactedPlayer): string {
  if (player.ships.length === 0) return "You have no ships";
  if (player.shipMovedThisTurn) return "Only one ship may move per turn";
  return "No ship at an open end can move";
}

function buyReason(view: RedactedState, hand: Hand): string {
  if (view.devDeck.count === 0) return "No development cards left";
  if (!afford(hand, COSTS.devCard)) return `Needs ${COST_TEXT.devCard}`;
  return "Only after rolling";
}

/** The rows of the cost card for `me`, in order, with Crown and Tides rows only under those modules (docs/phase12.md §4). */
export function costRows(view: RedactedState, me: string, hand: Hand | null, legal: readonly Action[]): CostRow[] {
  const player = view.players.find((p) => p.id === me);
  if (!player) return [];
  const crown = view.scenario?.crown === true;
  const tides = view.scenario?.tides === true;
  const h: Hand = hand ?? { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const rows: CostRow[] = [];
  const build = (key: "road" | "ship" | "settlement" | "city") => {
    const reason = hand ? buildReason(view, player, h, legal, key) : "Not your turn";
    rows.push({ key, cost: icons(COSTS[key]), affordable: reason === null, reason, mode: key });
  };
  build("road");
  if (tides) build("ship");
  build("settlement");
  build("city");
  if (!crown) {
    const ok = has("BUY_DEV_CARD");
    rows.push({ key: "devCard", cost: icons(COSTS.devCard), affordable: ok, reason: ok ? null : buyReason(view, h), action: { type: "BUY_DEV_CARD", playerId: me } });
  } else {
    const c = view.crown;
    const cp = c?.players[me];
    const action = view.phase.kind === "action" && currentPlayerId(view) === me;
    const mine = c ? c.knights.filter((k) => k.owner === me) : [];
    const wallReason = (): string | null => {
      if (has("BUILD_WALL")) return null;
      if (!action) return "Only on your turn, after rolling";
      if ((cp?.walls.length ?? 0) >= MAX_WALLS) return `All ${MAX_WALLS} walls are built`;
      if (player.cities.length === 0) return "Walls go on cities";
      if (h.clay < 2) return `Needs ${WALL_COST_TEXT}`;
      return "Every city of yours is walled";
    };
    const knightReason = (): string | null => {
      if (legal.some((a) => a.type === "BUILD_KNIGHT" && a.vertex !== undefined)) return null;
      if (!action) return "Only on your turn, after rolling";
      if (mine.filter((k) => k.level === 1).length >= KNIGHTS_PER_LEVEL) return "Both basic knight pieces are on the board";
      if (h.wool < 1 || h.ore < 1) return `Needs ${KNIGHT_COST_TEXT}`;
      return "No free vertex on your roads";
    };
    const promoteReason = (): string | null => {
      if (has("PROMOTE_KNIGHT")) return null;
      if (!action) return "Only on your turn, after rolling";
      if (mine.length === 0) return "You have no knights";
      if (h.wool < 1 || h.ore < 1) return `Needs ${KNIGHT_COST_TEXT}`;
      return "No knight can be promoted right now";
    };
    const improveReason = (): string | null => {
      if (has("BUILD_IMPROVEMENT")) return null;
      if (!action) return "Only on your turn, after rolling";
      if (player.cities.length === 0) return "You need a city first";
      return "Not enough commodities for the next level";
    };
    const wr = wallReason();
    rows.push({ key: "wall", cost: ["clay", "clay"], affordable: wr === null, reason: wr, mode: "wall" });
    const kr = knightReason();
    rows.push({ key: "knight", cost: ["wool", "ore"], affordable: kr === null, reason: kr, mode: "knight" });
    const pr = promoteReason();
    rows.push({ key: "promote", cost: ["wool", "ore"], affordable: pr === null, reason: pr, mode: "knightAct" });
    const ir = improveReason();
    rows.push({ key: "improvement", cost: ["cloth", "coin", "paper"], affordable: ir === null, reason: ir, opens: "improve" });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Dice history

export interface Roll {
  readonly seq: number;
  readonly dice: readonly [number, number];
  readonly event: EventDie | null;
}

export const DICE_HISTORY = 6;

/** Append a roll, keeping the last `limit` (six for the widget), ignoring a repeat of the same event. */
export function pushRoll(history: readonly Roll[], roll: Roll, limit = DICE_HISTORY): Roll[] {
  if (history.some((r) => r.seq === roll.seq)) return [...history];
  const next = [...history, roll];
  return Number.isFinite(limit) ? next.slice(-limit) : next;
}

/** Roll totals as a 2..12 histogram for the Stats panel. */
export function rollHistogram(history: readonly Roll[]): number[] {
  const out = Array.from({ length: 13 }, () => 0);
  for (const r of history) out[r.dice[0] + r.dice[1]] = (out[r.dice[0] + r.dice[1]] ?? 0) + 1;
  return out;
}

/** The whole tray: eight cells, the last three only under Crown & Castle (docs/phase12.md §2). */
export type TrayCard = Resource | "cloth" | "coin" | "paper";
export const TRAY_CARDS: readonly TrayCard[] = ["wood", "clay", "wool", "grain", "ore", "cloth", "coin", "paper"];

// ---------------------------------------------------------------------------
// Status line

/** docs/phase5.md §3: always say who the game is waiting for, and for what. */
export function waitingText(view: RedactedState, me: string, waitingOn: string | undefined, seats: readonly { playerId: string; kind: "human" | "bot" }[] | undefined): string | null {
  if (!waitingOn || waitingOn === me || view.phase.kind === "ended") return null;
  const name = view.players.find((p) => p.id === waitingOn)?.name ?? waitingOn;
  const bot = seats?.find((s) => s.playerId === waitingOn)?.kind === "bot" ? " (bot)" : "";
  const who = `${name}${bot}`;
  switch (view.phase.kind) {
    case "setup":
      return `Waiting for ${who} to place a ${view.phase.step === "settlement" ? setupPiece(view) : view.phase.step}`;
    case "roll":
      return `Waiting for ${who} to roll`;
    case "discard":
      return `Waiting for ${Object.keys(view.pendingDiscards).map((id) => view.players.find((p) => p.id === id)?.name ?? id).join(", ")} to discard`;
    case "moveRobber":
      return view.pirateHex !== null ? `Waiting for ${who} to move the robber or the pirate` : `Waiting for ${who} to move the robber`;
    case "steal":
      return `Waiting for ${who} to steal`;
    case "chooseGold":
      return `Waiting for ${Object.keys(view.phase.owed).map((id) => view.players.find((p) => p.id === id)?.name ?? id).join(", ")} to choose gold`;
    case "roadBuilding":
      return `Waiting for ${who} to place free roads`;
    case "specialBuild":
      return `Waiting for ${who} to build or pass`;
    case "action":
      if (view.pendingTrade && view.pendingTrade.from === me) return `Waiting for ${who} to respond to your trade`;
      if (view.pendingTrade) return null; // I am a responder: the offer card is showing
      return `Waiting for ${who} to build, trade, or end their turn`;
    default:
      return null;
  }
}

/** End turn is the only thing left: no build, buy, play, trade or move is legal (docs/phase12.md §5). */
export function onlyEndTurnLeft(legal: readonly Action[]): boolean {
  return legal.some((a) => a.type === "END_TURN") && legal.every((a) => a.type === "END_TURN" || a.type === "CANCEL_TRADE" || a.type === "REJECT_TRADE");
}
