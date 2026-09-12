/**
 * The board editor's pure model (docs/phase8.md §4): a BoardDefinition plus
 * tool state, edited through a reducer with undo/redo. No React, no DOM.
 * The engine validates the definition in real time (`validateBoard`).
 */

import {
  RESOURCES,
  TERRAINS,
  autoHarborEdges,
  builtInBoard,
  coastalEdges,
  createRng,
  geometryFor,
  harborCount,
  harborPool,
  hexId,
  parseHexId,
  resolveBoard,
  type BoardDefinition,
  type BuiltInBoardId,
  type EdgeId,
  type HarborDef,
  type HarborGeneration,
  type HexCoord,
  type HexDef,
  type HexId,
  type HexKind,
  type PortKind,
  type Resource,
  type Terrain,
  type TerrainGeneration,
  type TokenGeneration,
  landComponents,
  type Scenario,
  type ScenarioSetup,
} from "@katan/engine";

export type Tool = "frame" | "terrain" | "token" | "harbor" | "island";

/** Scenario settings kept next to the board while editing (docs/phase9.md §5); null means a plain board. */
export interface ScenarioSettings {
  readonly tides: boolean;
  readonly pirate: boolean;
  readonly islandBonus: number;
  readonly setup: ScenarioSetup;
  readonly mainIsland: number | null;
  readonly victoryPoints: number;
  /** One rule per line. */
  readonly specialRules: string;
}

export const DEFAULT_SCENARIO: ScenarioSettings = { tides: true, pirate: true, islandBonus: 2, setup: "standard", mainIsland: null, victoryPoints: 10, specialRules: "" };
export type Symmetry = "none" | "mirror" | "rotate";

export interface EditorState {
  readonly def: BoardDefinition;
  readonly tool: Tool;
  readonly terrain: Terrain;
  readonly symmetry: Symmetry;
  readonly selected: HexId | EdgeId | null;
  /** Radius of the extended grid drawn around the board (empty cells). */
  readonly gridRadius: number;
  readonly dirty: boolean;
  /** A saved board's (or scenario's) id, or null for a new board / draft. */
  readonly boardId: string | null;
  readonly scenario: ScenarioSettings | null;
}

export type EditorAction =
  | { type: "setTool"; tool: Tool }
  | { type: "setTerrain"; terrain: Terrain }
  | { type: "setSymmetry"; symmetry: Symmetry }
  | { type: "select"; id: HexId | EdgeId | null }
  | { type: "setName"; name: string }
  | { type: "setSeats"; max: 4 | 5 | 6 }
  | { type: "setGeneration"; terrain?: TerrainGeneration; tokens?: TokenGeneration; harbors?: HarborGeneration }
  /** Frame brush: cycle a cell empty → land → sea → empty (or set a kind). */
  | { type: "cycleCell"; at: HexCoord }
  | { type: "setCell"; at: HexCoord; kind: HexKind | null }
  | { type: "setCells"; cells: HexCoord[]; kind: HexKind | null }
  | { type: "paintTerrain"; at: HexCoord; terrain: Terrain | null }
  | { type: "setToken"; at: HexCoord; token: number | null }
  | { type: "cycleHarbor"; edge: EdgeId }
  | { type: "setHarbor"; edge: EdgeId; harbor: HarborDef | null }
  | { type: "autoFillTokens"; seed: string }
  | { type: "autoPlaceHarbors"; seed: string }
  | { type: "clearLayer"; layer: "terrain" | "tokens" | "harbors" }
  | { type: "loadTemplate"; id: BuiltInBoardId }
  | { type: "load"; def: BoardDefinition; boardId: string | null; scenario?: ScenarioSettings | null }
  | { type: "markSaved"; boardId: string | null }
  /** Scenario tab: null turns the scenario off, a partial updates its settings. */
  | { type: "setScenario"; scenario: Partial<ScenarioSettings> | null };

export function emptyDefinition(name = "New board"): BoardDefinition {
  return { name, hexes: [], harbors: [], seats: { min: 3, max: 4 }, generation: { terrain: "shuffle", tokens: "balanced", harbors: "shuffle" } };
}

export function initialEditorState(def: BoardDefinition = builtInBoard("random"), boardId: string | null = null, scenario: ScenarioSettings | null = null): EditorState {
  return { def: { ...def, name: def.name }, tool: "frame", terrain: "forest", symmetry: "none", selected: null, gridRadius: gridRadiusFor(def), dirty: false, boardId, scenario };
}

/** Editor settings from a stored scenario. */
export function settingsOf(s: Scenario): ScenarioSettings {
  return {
    tides: s.modules.tides === true,
    pirate: s.pirate !== false,
    islandBonus: s.islandBonus ?? 0,
    setup: s.setup ?? "standard",
    mainIsland: s.mainIsland ?? null,
    victoryPoints: s.victoryPoints,
    specialRules: (s.specialRules ?? []).join("\n"),
  };
}

/** The scenario the editor would save, or null for a plain board. */
export function toScenario(state: EditorState, id = state.boardId ?? "draft"): Scenario | null {
  const sc = state.scenario;
  if (!sc) return null;
  const rules = sc.specialRules
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return {
    id,
    name: state.def.name,
    board: state.def,
    modules: { tides: sc.tides },
    pirate: sc.pirate,
    islandBonus: sc.islandBonus,
    setup: sc.setup,
    ...(sc.setup === "mainIslandOnly" ? { mainIsland: sc.mainIsland ?? 0 } : {}),
    victoryPoints: sc.victoryPoints,
    specialRules: rules,
  };
}

/** Islands of the current definition in engine order (largest first), so the index is the island id. */
export function islandsOf(def: BoardDefinition): HexId[][] {
  return landComponents(def);
}

export function islandIndexOf(def: BoardDefinition, at: HexCoord): number | null {
  const id = hexId(at);
  const i = islandsOf(def).findIndex((comp) => comp.includes(id));
  return i < 0 ? null : i;
}

export function gridRadiusFor(def: BoardDefinition): number {
  let r = 3;
  for (const h of def.hexes) r = Math.max(r, Math.abs(h.at.q), Math.abs(h.at.r), Math.abs(-h.at.q - h.at.r));
  return Math.min(8, r + 1);
}

/** Every cell of the extended grid (a hexagon of `radius`). */
export function gridCells(radius: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= radius) out.push({ q, r });
  return out;
}

/** The mirror image across the vertical axis and the 180° rotation of a cell. */
export function symmetricCells(at: HexCoord, symmetry: Symmetry): HexCoord[] {
  switch (symmetry) {
    case "none":
      return [at];
    case "mirror": {
      const m = { q: -at.q - at.r, r: at.r };
      return m.q === at.q ? [at] : [at, m];
    }
    case "rotate": {
      const m = { q: -at.q, r: -at.r };
      return m.q === at.q && m.r === at.r ? [at] : [at, m];
    }
    default: {
      const exhaustive: never = symmetry;
      throw new Error(String(exhaustive));
    }
  }
}

/** All cells in the axial "rectangle" spanned by two corners (for shift-drag). */
export function rectangleCells(a: HexCoord, b: HexCoord): HexCoord[] {
  const out: HexCoord[] = [];
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  // Use offset columns so the rectangle looks rectangular on screen.
  const col = (c: HexCoord) => c.q + Math.floor(c.r / 2);
  const c0 = Math.min(col(a), col(b));
  const c1 = Math.max(col(a), col(b));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ q: c - Math.floor(r / 2), r });
  return out;
}

function hexAt(def: BoardDefinition, at: HexCoord): HexDef | undefined {
  return def.hexes.find((h) => h.at.q === at.q && h.at.r === at.r);
}

function withHex(def: BoardDefinition, at: HexCoord, next: HexDef | null): BoardDefinition {
  const others = def.hexes.filter((h) => !(h.at.q === at.q && h.at.r === at.r));
  const hexes = next ? [...others, next] : others;
  // Harbours on edges that lost their coast are dropped by validation later; keep them.
  return { ...def, hexes };
}

function setCellKind(def: BoardDefinition, at: HexCoord, kind: HexKind | null): BoardDefinition {
  if (kind === null) return withHex(def, at, null);
  const current = hexAt(def, at);
  if (kind === "land") {
    const keep: HexDef = current?.kind === "land" ? current : { at, kind: "land" };
    return withHex(def, at, keep);
  }
  return withHex(def, at, { at, kind });
}

const HARBOR_CYCLE: (PortKind | null)[] = [null, "any", ...RESOURCES];

export function harborOf(kind: PortKind, edge: EdgeId): HarborDef {
  return kind === "any" ? { edge, ratio: 3 } : { edge, ratio: 2, resource: kind as Resource };
}

export function harborKindOf(h: HarborDef | undefined): PortKind | null {
  if (!h) return null;
  return h.ratio === 2 && h.resource ? h.resource : "any";
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  const def = state.def;
  const touch = (next: BoardDefinition, extra: Partial<EditorState> = {}): EditorState => ({ ...state, ...extra, def: next, dirty: true, gridRadius: Math.max(state.gridRadius, gridRadiusFor(next)) });
  switch (action.type) {
    case "setTool":
      return { ...state, tool: action.tool };
    case "setTerrain":
      return { ...state, terrain: action.terrain, tool: "terrain" };
    case "setSymmetry":
      return { ...state, symmetry: action.symmetry };
    case "select":
      return { ...state, selected: action.id };
    case "setName":
      return touch({ ...def, name: action.name.slice(0, 40) });
    case "setSeats":
      return touch({ ...def, seats: { min: 3, max: action.max } });
    case "setGeneration":
      return touch({
        ...def,
        generation: { terrain: action.terrain ?? def.generation.terrain, tokens: action.tokens ?? def.generation.tokens, harbors: action.harbors ?? def.generation.harbors },
      });
    case "cycleCell": {
      const current = hexAt(def, action.at)?.kind ?? null;
      const next: HexKind | null = current === null ? "land" : current === "land" ? "sea" : current === "sea" ? "frame" : null;
      let out = def;
      for (const c of symmetricCells(action.at, state.symmetry)) out = setCellKind(out, c, next);
      return touch(out);
    }
    case "setCell": {
      let out = def;
      for (const c of symmetricCells(action.at, state.symmetry)) out = setCellKind(out, c, action.kind);
      return touch(out);
    }
    case "setCells": {
      let out = def;
      for (const cell of action.cells) for (const c of symmetricCells(cell, state.symmetry)) out = setCellKind(out, c, action.kind);
      return touch(out);
    }
    case "paintTerrain": {
      let out = def;
      for (const c of symmetricCells(action.at, state.symmetry)) {
        const h = hexAt(out, c);
        if (!h || h.kind !== "land") continue;
        const next: HexDef = action.terrain === null ? stripKeys(h, ["terrain", "token"]) : { ...h, terrain: action.terrain };
        // A wasteland never carries a token.
        out = withHex(out, c, action.terrain === "wasteland" ? stripKeys(next, ["token"]) : next);
      }
      return touch(out);
    }
    case "setToken": {
      const h = hexAt(def, action.at);
      if (!h || h.kind !== "land" || h.terrain === "wasteland") return state;
      const next: HexDef = action.token === null ? stripKeys(h, ["token"]) : { ...h, token: action.token };
      return touch(withHex(def, action.at, next));
    }
    case "cycleHarbor": {
      const current = harborKindOf(def.harbors.find((h) => h.edge === action.edge));
      const next = HARBOR_CYCLE[(HARBOR_CYCLE.indexOf(current) + 1) % HARBOR_CYCLE.length] ?? null;
      const harbors = def.harbors.filter((h) => h.edge !== action.edge);
      return touch({ ...def, harbors: next === null ? harbors : [...harbors, harborOf(next, action.edge)] });
    }
    case "setHarbor": {
      const harbors = def.harbors.filter((h) => h.edge !== action.edge);
      return touch({ ...def, harbors: action.harbor ? [...harbors, action.harbor] : harbors });
    }
    case "autoFillTokens": {
      // Resolve tokens with the engine's balanced generator, then write them back as fixed tokens.
      const landOnly: BoardDefinition = {
        ...def,
        hexes: def.hexes.map((h) => (h.kind === "land" ? { ...h, terrain: h.terrain ?? "meadow" } : h)),
        harbors: [],
        generation: { terrain: "fixed", tokens: "balanced", harbors: "shuffle" },
      };
      let resolved;
      try {
        resolved = resolveBoard(landOnly, createRng(action.seed, "autofill"), { allowIslands: true });
      } catch {
        return state;
      }
      const hexes = def.hexes.map((h): HexDef => {
        if (h.kind !== "land") return h;
        const t = resolved.hexes[hexId(h.at)];
        if (!t || t.token === null) return stripKeys(h, ["token"]);
        return { ...h, token: t.token };
      });
      return touch({ ...def, hexes, generation: { ...def.generation, tokens: "fixed" } });
    }
    case "autoPlaceHarbors": {
      const land = def.hexes.filter((h) => h.kind === "land").length;
      const edges = autoHarborEdges(def, harborCount(land));
      const kinds = createRng(action.seed, "harbors").shuffle(harborPool(edges.length));
      return touch({ ...def, harbors: edges.map((edge, i) => harborOf(kinds[i] ?? "any", edge)), generation: { ...def.generation, harbors: "fixed" } });
    }
    case "clearLayer": {
      if (action.layer === "harbors") return touch({ ...def, harbors: [] });
      const hexes = def.hexes.map((h) => (h.kind === "land" ? stripKeys(h, action.layer === "terrain" ? ["terrain", "token"] : ["token"]) : h));
      return touch({ ...def, hexes });
    }
    case "loadTemplate": {
      const t = builtInBoard(action.id);
      return { ...state, def: { ...t, name: state.def.name || t.name }, selected: null, dirty: true, gridRadius: gridRadiusFor(t) };
    }
    case "load":
      return { ...state, def: action.def, boardId: action.boardId, selected: null, dirty: false, gridRadius: gridRadiusFor(action.def), scenario: action.scenario === undefined ? state.scenario : action.scenario };
    case "markSaved":
      return { ...state, dirty: false, boardId: action.boardId };
    case "setScenario": {
      if (action.scenario === null) return { ...state, scenario: null, dirty: true, tool: state.tool === "island" ? "frame" : state.tool };
      const base = state.scenario ?? DEFAULT_SCENARIO;
      const next: ScenarioSettings = { ...base, ...action.scenario };
      return { ...state, scenario: { ...next, victoryPoints: Math.max(3, Math.min(30, Math.round(next.victoryPoints))), islandBonus: Math.max(0, Math.min(5, Math.round(next.islandBonus))) }, dirty: true };
    }
    default: {
      const exhaustive: never = action;
      throw new Error(String(exhaustive));
    }
  }
}

function stripKeys(h: HexDef, keys: ("terrain" | "token")[]): HexDef {
  const out: { at: HexCoord; kind: HexKind; terrain?: Terrain; token?: number; extras?: Record<string, unknown> } = { at: h.at, kind: h.kind };
  if (!keys.includes("terrain") && h.terrain !== undefined) out.terrain = h.terrain;
  if (!keys.includes("token") && h.token !== undefined) out.token = h.token;
  if (h.extras) out.extras = h.extras;
  return out;
}

/** Actions that change the definition are recorded in history; view state is not. */
export function isUndoable(action: EditorAction): boolean {
  return !["setTool", "setTerrain", "setSymmetry", "select", "load", "markSaved", "setScenario"].includes(action.type);
}

export interface History {
  readonly past: BoardDefinition[];
  readonly present: EditorState;
  readonly future: BoardDefinition[];
}

export const HISTORY_LIMIT = 200;

export function historyReduce(h: History, action: EditorAction | { type: "undo" } | { type: "redo" }): History {
  if (action.type === "undo") {
    const prev = h.past[h.past.length - 1];
    if (!prev) return h;
    return { past: h.past.slice(0, -1), present: { ...h.present, def: prev, dirty: true }, future: [h.present.def, ...h.future] };
  }
  if (action.type === "redo") {
    const next = h.future[0];
    if (!next) return h;
    return { past: [...h.past, h.present.def], present: { ...h.present, def: next, dirty: true }, future: h.future.slice(1) };
  }
  const present = reduce(h.present, action);
  if (!isUndoable(action) || present.def === h.present.def) return { ...h, present };
  const past = [...h.past, h.present.def];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present, future: [] };
}

/** Coastal edges of the current definition (where the harbour tool may act). */
export function harborEdges(def: BoardDefinition): EdgeId[] {
  return coastalEdges(def);
}

/** Tokens still unplaced from the pool implied by the land count (for the token tray). */
export function tokenTray(def: BoardDefinition): { token: number; left: number }[] {
  const producing = def.hexes.filter((h) => h.kind === "land" && h.terrain !== "wasteland").length;
  const counts = new Map<number, number>();
  for (const t of def.presets?.tokenPool ?? tokenPoolFor(producing)) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const h of def.hexes) if (h.kind === "land" && h.token !== undefined) counts.set(h.token, (counts.get(h.token) ?? 0) - 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([token, left]) => ({ token, left }));
}

import { tokenPool as tokenPoolFor } from "@katan/engine";

export const TERRAIN_KEYS: Record<string, Terrain> = Object.fromEntries(TERRAINS.map((t, i) => [String(i + 1), t]));

/** Land hexes that touch the extended grid cell (for rendering ghost cells only where empty). */
export function isEmptyCell(def: BoardDefinition, at: HexCoord): boolean {
  return hexAt(def, at) === undefined;
}

export function landIds(def: BoardDefinition): HexId[] {
  return def.hexes.filter((h) => h.kind === "land").map((h) => hexId(h.at));
}

export function vertexCountOf(def: BoardDefinition): number {
  return geometryFor(landIds(def)).vertices.length;
}

export { hexId, parseHexId };
