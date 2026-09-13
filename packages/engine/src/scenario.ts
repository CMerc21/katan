/**
 * Scenarios (docs/phase9.md §5, docs/phase10.md §8, docs/phase11.md §9): a
 * board bundled with module rules and a goal. `Scenario` is the stored,
 * editable form; `ScenarioRules` is the subset the engine keeps in
 * `GameState.scenario` (the board itself is resolved into `state.board`).
 */

import { isBoardDefinition, oasisHexes, type BoardDefinition } from "./definition";
import { CROWN_VICTORY_POINTS, VARIANT_NAMES, type VariantFlags, type VariantName } from "./modules/types";
import { hasErrors, validateBoard, type ValidationIssue } from "./validation";

export type ScenarioSetup = "standard" | "mainIslandOnly";

export interface ScenarioModules {
  readonly tides?: boolean;
  /** Crown & Castle (docs/phase11.md). */
  readonly crown?: boolean;
}

/** Wayfarers variants (docs/phase10.md), each independent. */
export type ScenarioVariants = Partial<Record<VariantName, boolean>>;

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly board: BoardDefinition;
  readonly modules: ScenarioModules;
  readonly variants?: ScenarioVariants;
  /** Tides only: start with a pirate on the sea (default true). */
  readonly pirate?: boolean;
  /** VP per newly settled island (docs/rules.md §14.4); 0 or absent for none. */
  readonly islandBonus?: number;
  /** `mainIslandOnly` restricts setup settlements to `mainIsland`. */
  readonly setup?: ScenarioSetup;
  readonly mainIsland?: number;
  /** Victory points to win (§11); default 10 (13 under Crown & Castle). */
  readonly victoryPoints: number;
  /** Free text shown in the lobby. */
  readonly specialRules?: readonly string[];
}

/** What the engine keeps: plain JSON, no `undefined`. */
export interface ScenarioRules {
  readonly id: string;
  readonly name: string;
  readonly tides: boolean;
  readonly crown: boolean;
  readonly variants: VariantFlags;
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

export function noVariants(): VariantFlags {
  return { eventDeck: false, fishing: false, rivers: false, harbormaster: false, raiders: false, caravans: false, wagons: false };
}

export function variantFlags(s: Pick<Scenario, "variants">): VariantFlags {
  const out = { ...noVariants() } as Record<VariantName, boolean>;
  for (const name of VARIANT_NAMES) out[name] = s.variants?.[name] === true;
  return out;
}

export function scenarioRules(s: Scenario): ScenarioRules {
  const tides = s.modules.tides === true;
  const crown = s.modules.crown === true;
  return {
    id: s.id,
    name: s.name,
    tides,
    crown,
    variants: variantFlags(s),
    pirate: tides && s.pirate !== false,
    islandBonus: tides ? Math.max(0, Math.floor(s.islandBonus ?? 0)) : 0,
    setup: s.setup ?? "standard",
    mainIsland: s.setup === "mainIslandOnly" ? (s.mainIsland ?? 0) : null,
    victoryPoints: s.victoryPoints,
    specialRules: [...(s.specialRules ?? [])],
  };
}

/** Whether any Wayfarers variant is on. */
export function anyVariant(s: Pick<Scenario, "variants">): boolean {
  return VARIANT_NAMES.some((v) => s.variants?.[v] === true);
}

/** Structural check of untrusted JSON (rules live in `validateScenario`). */
export function isScenario(value: unknown): value is Scenario {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.name !== "string" || !isBoardDefinition(s.board)) return false;
  if (typeof s.modules !== "object" || s.modules === null) return false;
  const m = s.modules as Record<string, unknown>;
  if (m.tides !== undefined && typeof m.tides !== "boolean") return false;
  if (m.crown !== undefined && typeof m.crown !== "boolean") return false;
  if (s.variants !== undefined) {
    if (typeof s.variants !== "object" || s.variants === null) return false;
    for (const [k, v] of Object.entries(s.variants as Record<string, unknown>)) {
      if (!(VARIANT_NAMES as readonly string[]).includes(k) || typeof v !== "boolean") return false;
    }
  }
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
  const crown = s.modules.crown === true;
  const variants = variantFlags(s);
  const issues = validateBoard(s.board, { allowIslands: tides });
  const error = (code: string, message: string) => issues.push({ severity: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ severity: "warning", code, message });
  if (s.victoryPoints < MIN_VICTORY_POINTS || s.victoryPoints > MAX_VICTORY_POINTS) error("SCENARIO_VP", `victory points must be between ${MIN_VICTORY_POINTS} and ${MAX_VICTORY_POINTS}`);
  if (s.setup === "mainIslandOnly") {
    if (!tides) error("SCENARIO_SETUP", "restricting setup to an island needs the Tides module");
    const n = islandCount(s.board);
    const main = s.mainIsland ?? 0;
    if (main < 0 || main >= n) error("SCENARIO_MAIN_ISLAND", `main island ${main} does not exist (the board has ${n})`);
  }
  if (!tides && s.board.hexes.some((h) => h.kind === "sea") && s.board.hexes.every((h) => h.kind !== "land")) error("SCENARIO_BOARD", "a scenario needs land");
  // docs/phase11.md: raiders and Crown & Castle both use knights; they never mix.
  if (crown && variants.raiders) error("SCENARIO_MODULES", "Raiders and Crown & Castle cannot be combined");
  if (crown && s.victoryPoints < CROWN_VICTORY_POINTS) warn("SCENARIO_VP_LOW", `Crown & Castle is usually played to ${CROWN_VICTORY_POINTS} points`);
  const oases = oasisHexes(s.board).length;
  if (variants.caravans && oases === 0) error("SCENARIO_OASES", "the Caravans variant needs at least one oasis");
  if (variants.caravans && oases !== 3) warn("SCENARIO_OASES_COUNT", `Caravans is designed for three oases (the board has ${oases})`);
  if (!variants.caravans && oases > 0) warn("SCENARIO_OASES_UNUSED", "oases only produce with the Caravans variant");
  const grounds = (s.board.edges ?? []).filter((e) => e.kind === "fishingGround").length;
  const lakes = s.board.hexes.filter((h) => h.kind === "land" && h.terrain === "lake").length;
  if (variants.fishing && grounds === 0 && lakes === 0) warn("SCENARIO_NO_FISH", "the Fishing variant has no lake and no fishing grounds");
  if (!variants.fishing && grounds > 0) warn("SCENARIO_FISH_UNUSED", "fishing grounds only produce with the Fishing variant");
  const rivers = (s.board.edges ?? []).filter((e) => e.kind === "river").length;
  if (variants.rivers && rivers === 0) warn("SCENARIO_NO_RIVERS", "the Rivers variant has no river segments");
  if (!variants.rivers && rivers > 0) warn("SCENARIO_RIVERS_UNUSED", "river segments only matter with the Rivers variant");
  return issues;
}

/** Short labels for the modules and variants a scenario switches on (for pickers and lobbies). */
export const VARIANT_LABEL: Readonly<Record<VariantName, string>> = {
  eventDeck: "Event deck",
  fishing: "Fishing",
  rivers: "Rivers",
  harbormaster: "Harbormaster",
  raiders: "Raiders",
  caravans: "Caravans",
  wagons: "Wagons",
};

export function scenarioModuleLabels(s: Pick<Scenario, "modules" | "variants">): string[] {
  const out: string[] = [];
  if (s.modules.tides) out.push("Tides");
  if (s.modules.crown) out.push("Crown & Castle");
  for (const v of VARIANT_NAMES) if (s.variants?.[v]) out.push(VARIANT_LABEL[v]);
  return out;
}

/** "Tides · Fishing · 12 points to win" */
export function scenarioSummary(s: Pick<Scenario, "modules" | "variants" | "victoryPoints">): string {
  const labels = scenarioModuleLabels(s);
  return `${labels.length ? labels.join(" · ") + " · " : ""}${s.victoryPoints} points to win`;
}

export function scenarioHasErrors(s: Scenario): boolean {
  return hasErrors(validateScenario(s));
}

function islandCount(board: BoardDefinition): number {
  return landComponentsOf(board).length;
}

import { landComponents as landComponentsOf } from "./validation";
