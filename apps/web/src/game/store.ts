/**
 * In-memory holder for the live game (docs/phase3.md §3.1). The start page
 * creates a driver here; `/play` reads it. A reload loses it, and `/play`
 * then redirects to `/`.
 */

import type { BoardKind } from "@katan/engine";
import { HotseatDriver } from "@/driver/hotseat";
import type { GameDriver } from "@/driver/types";

export interface HotseatConfig {
  readonly players: readonly { id: string; name: string }[];
  readonly board: BoardKind;
  readonly seed: string;
}

let current: GameDriver | null = null;

export function startHotseat(config: HotseatConfig): GameDriver {
  current = HotseatDriver.create({ seed: config.seed, players: config.players, board: config.board });
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
