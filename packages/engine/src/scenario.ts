/**
 * Scenarios (docs/phase9.md §5): a board bundled with module rules and a
 * goal. `Scenario` is the stored, editable form; `ScenarioRules` is the
 * subset the engine keeps in `GameState.scenario` (the board itself is
 * resolved into `state.board`).
 */

import { isBoardDefinition, type BoardDefinition } from "./definition";
import { hasErrors, validateBoard, type ValidationIssue } from "./validation";

export type ScenarioSetup = "standard" | "mainIslandOnly";

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly board: BoardDefinition;
  readonly modules: { readonly tides?: boolean };
  /** Tides only: start with a pirate on the sea (default true). */
  readonly pirate?: boolean;
  /** VP per newly settled island (docs/rules.md §14.4); 0 or absent for none. */
  readonly islandBonus?: number;
  /** `mainIslandOnly` restricts setup settlements to `mainIsland`. */
  readonly setup?: ScenarioSetup;
  readonly mainIsland?: number;
  /** Victory points to win (§11); default 10. */
  readonly victoryPoints: number;
  /** Free text shown in the lobby. */
  readonly specialRules?: readonly string[];
}

/** What the engine keeps: plain JSON, no `undefined`. */
export interface ScenarioRules {
  readonly id: string;
  readonly name: string;
  readonly tides: boolean;
  readonly pirate: boolean;
  readonly islandBonus: number;
  readonly setup: ScenarioSetup;
  readonly mainIsland: number | null;
  readonly victoryPoints: number;
  readonly specialRules: readonly string[];
}

export const DEFAULT_VICTORY_POINTS = 10;
export const MIN_VICTORY_POINTS = 3;
export const MAX_VICTORY_POINTS = 30;

export function scenarioRules(s: Scenario): ScenarioRules {
  const tides = s.modules.tides === true;
  return {
    id: s.id,
    name: s.name,
    tides,
    pirate: tides && s.pirate !== false,
    islandBonus: tides ? Math.max(0, Math.floor(s.islandBonus ?? 0)) : 0,
    setup: s.setup ?? "standard",
    mainIsland: s.setup === "mainIslandOnly" ? (s.mainIsland ?? 0) : null,
    victoryPoints: s.victoryPoints,
    specialRules: [...(s.specialRules ?? [])],
  };
}

/** Structural check of untrusted JSON (rules live in `validateScenario`). */
export function isScenario(value: unknown): value is Scenario {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.name !== "string" || !isBoardDefinition(s.board)) return false;
  if (typeof s.modules !== "object" || s.modules === null) return false;
  if (s.pirate !== undefined && typeof s.pirate !== "boolean") return false;
  if (s.islandBonus !== undefined && typeof s.islandBonus !== "number") return false;
  if (s.setup !== undefined && s.setup !== "standard" && s.setup !== "mainIslandOnly") return false;
  if (s.mainIsland !== undefined && !Number.isInteger(s.mainIsland)) return false;
  if (typeof s.victoryPoints !== "number" || !Number.isInteger(s.victoryPoints)) return false;
  if (s.specialRules !== undefined && (!Array.isArray(s.specialRules) || !s.specialRules.every((x) => typeof x === "string"))) return false;
  return true;
}

/** Board issues (islands allowed under Tides) plus scenario-level checks (code `SCENARIO_*`). */
export function validateScenario(s: Scenario): ValidationIssue[] {
  const tides = s.modules.tides === true;
  const issues = validateBoard(s.board, { allowIslands: tides });
  const error = (code: string, message: string) => issues.push({ severity: "error", code, message });
  if (s.victoryPoints < MIN_VICTORY_POINTS || s.victoryPoints > MAX_VICTORY_POINTS) error("SCENARIO_VP", `victory points must be between ${MIN_VICTORY_POINTS} and ${MAX_VICTORY_POINTS}`);
  if (s.setup === "mainIslandOnly") {
    if (!tides) error("SCENARIO_SETUP", "restricting setup to an island needs the Tides module");
    const n = islandCount(s.board);
    const main = s.mainIsland ?? 0;
    if (main < 0 || main >= n) error("SCENARIO_MAIN_ISLAND", `main island ${main} does not exist (the board has ${n})`);
  }
  if (!tides && s.board.hexes.some((h) => h.kind === "sea") && s.board.hexes.every((h) => h.kind !== "land")) error("SCENARIO_BOARD", "a scenario needs land");
  return issues;
}

export function scenarioHasErrors(s: Scenario): boolean {
  return hasErrors(validateScenario(s));
}

function islandCount(board: BoardDefinition): number {
  // Late import to keep this module free of the generation cycle.
  return landComponentsOf(board).length;
}

import { landComponents as landComponentsOf } from "./validation";
