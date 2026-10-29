/**
 * In-memory holder for the live game (docs/phase3.md §3.1). The start page
 * creates a driver here; `/play` reads it. A reload loses it, and `/play`
 * then redirects to `/`.
 */

import type { AvatarSpec } from "@katan/avatars";
import type { BotLevel } from "@katan/bots";
import type { BoardDefinition, BoardKind, Scenario } from "@katan/engine";
import { HotseatDriver } from "@/driver/hotseat";
import type { GameDriver } from "@/driver/types";

export interface HotseatConfig {
  readonly players: readonly { id: string; name: string; bot?: BotLevel; avatar?: AvatarSpec }[];
  /** A built-in kind or a full definition from the picker/editor (docs/phase8.md §4). */
  readonly board: BoardKind | BoardDefinition;
  /** A Tides scenario (docs/phase9.md §5) takes precedence over `board`. */
  readonly scenario?: Scenario;
  readonly seed: string;
  /** Where leaving the game goes (the editor, after a test play); default the home lobby. */
  readonly returnTo?: string;
}

let current: GameDriver | null = null;
let returnTo: string | null = null;

export function startHotseat(config: HotseatConfig): GameDriver {
  const bots: Record<string, BotLevel> = {};
  const avatars: Record<string, AvatarSpec> = {};
  for (const p of config.players) {
    if (p.bot) bots[p.id] = p.bot;
    if (p.avatar) avatars[p.id] = p.avatar;
  }
  current = HotseatDriver.create({
    seed: config.seed,
    players: config.players.map((p) => ({ id: p.id, name: p.name })),
    board: config.board,
    ...(config.scenario ? { scenario: config.scenario } : {}),
    bots,
    avatars,
  });
  returnTo = config.returnTo ?? null;
  return current;
}

/** Where to go when the hotseat game is left. */
export function returnPath(): string {
  return returnTo ?? "/";
}

export function currentDriver(): GameDriver | null {
  return current;
}

export function clearDriver(): void {
  current = null;
}

/** Test hook: install any driver (e.g. a fake for Phase 4). */
export function installDriver(driver: GameDriver): void {
  current = driver;
}
