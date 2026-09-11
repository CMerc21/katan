/**
 * In-memory holder for the live game (docs/phase3.md §3.1). The start page
 * creates a driver here; `/play` reads it. A reload loses it, and `/play`
 * then redirects to `/`.
 */

import type { BotLevel } from "@katan/bots";
import type { BoardKind } from "@katan/engine";
import { HotseatDriver } from "@/driver/hotseat";
import type { GameDriver } from "@/driver/types";

export interface HotseatConfig {
  readonly players: readonly { id: string; name: string; bot?: BotLevel }[];
  readonly board: BoardKind;
  readonly seed: string;
}

let current: GameDriver | null = null;

export function startHotseat(config: HotseatConfig): GameDriver {
  const bots: Record<string, BotLevel> = {};
  for (const p of config.players) if (p.bot) bots[p.id] = p.bot;
  current = HotseatDriver.create({
    seed: config.seed,
    players: config.players.map((p) => ({ id: p.id, name: p.name })),
    board: config.board,
    bots,
  });
  return current;
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
