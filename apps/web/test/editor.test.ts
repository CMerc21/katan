import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_SCENARIO_IDS, hasErrors, isBoardDefinition, isScenario, standardFrame, validateBoard } from "@katan/engine";
import { builtInScenario, validateScenario } from "@katan/engine";
import { DEFAULT_FISHING_TOKEN, DEFAULT_SCENARIO, emptyDefinition, fishingGroundAt, harborEdges, historyReduce, initialEditorState, islandIndexOf, landEdges, oasisCount, rectangleCells, reduce, riverEdgesOf, settingsOf, symmetricCells, toScenario, tokenTray, type History } from "@/editor/model";
import { loadScenarioDrafts, saveScenarioDraft } from "@/editor/storage";

describe("docs/phase8.md §4 editor model", () => {
  it("frame brush cycles empty → land → sea → frame → empty, with symmetry", () => {
    let s = initialEditorState(emptyDefinition());
    s = reduce(s, { type: "cycleCell", at: { q: 1, r: 0 } });
    expect(s.def.hexes).toEqual([{ at: { q: 1, r: 0 }, kind: "land" }]);
    s = reduce(s, { type: "cycleCell", at: { q: 1, r: 0 } });
    expect(s.def.hexes[0]!.kind).toBe("sea");
    s = reduce(s, { type: "cycleCell", at: { q: 1, r: 0 } });
    expect(s.def.hexes[0]!.kind).toBe("frame");
    s = reduce(s, { type: "cycleCell", at: { q: 1, r: 0 } });
    expect(s.def.hexes).toEqual([]);
    s = reduce(s, { type: "setSymmetry", symmetry: "mirror" });
    s = reduce(s, { type: "setCell", at: { q: 2, r: 0 }, kind: "land" });
    expect(s.def.hexes.map((h) => h.at)).toEqual([
      { q: 2, r: 0 },
      { q: -2, r: 0 },
    ]);
    expect(symmetricCells({ q: 0, r: 0 }, "rotate")).toEqual([{ q: 0, r: 0 }]);
    expect(symmetricCells({ q: 1, r: -1 }, "rotate")).toEqual([
      { q: 1, r: -1 },
      { q: -1, r: 1 },
    ]);
    expect(rectangleCells({ q: 0, r: 0 }, { q: 1, r: 1 })).toHaveLength(4);
  });

  it("terrain and token tools respect land-only and the wasteland rule; painting a wasteland drops its token", () => {
    let s = initialEditorState(emptyDefinition());
    s = reduce(s, { type: "setCells", cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], kind: "land" });
    s = reduce(s, { type: "setCell", at: { q: 0, r: 1 }, kind: "sea" });
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: "forest" });
    s = reduce(s, { type: "setToken", at: { q: 0, r: 0 }, token: 8 });
    expect(reduce(s, { type: "paintTerrain", at: { q: 0, r: 1 }, terrain: null })).toBe(s); // clearing a sea cell: nothing to do
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at: { q: 0, r: 0 }, kind: "land", terrain: "forest", token: 8 });
    expect(s.def.hexes.find((h) => h.at.r === 1)).toEqual({ at: { q: 0, r: 1 }, kind: "sea" });
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: "wasteland" });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at: { q: 0, r: 0 }, kind: "land", terrain: "wasteland" });
    expect(reduce(s, { type: "setToken", at: { q: 0, r: 0 }, token: 6 })).toBe(s);
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: null });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at: { q: 0, r: 0 }, kind: "land" });
  });

  it("the frame brush paints one kind (land by default) and the terrain brush makes empty, sea or frame cells land", () => {
    let s = initialEditorState(emptyDefinition());
    expect(s.frameKind).toBe("land");
    s = reduce(s, { type: "setTool", tool: "terrain" });
    s = reduce(s, { type: "setFrameKind", kind: "sea" });
    expect(s.tool).toBe("frame");
    expect(s.frameKind).toBe("sea");
    s = reduce(s, { type: "setCell", at: { q: 0, r: 0 }, kind: s.frameKind });
    expect(s.def.hexes).toEqual([{ at: { q: 0, r: 0 }, kind: "sea" }]);
    // Terrain on a sea cell turns it into land; on an empty cell it creates the land.
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: "meadow" });
    s = reduce(s, { type: "paintTerrain", at: { q: 1, r: 0 }, terrain: "forest" });
    s = reduce(s, { type: "setCell", at: { q: 2, r: 0 }, kind: "frame" });
    s = reduce(s, { type: "paintTerrain", at: { q: 2, r: 0 }, terrain: "mountain" });
    expect(s.def.hexes).toEqual([
      { at: { q: 0, r: 0 }, kind: "land", terrain: "meadow" },
      { at: { q: 1, r: 0 }, kind: "land", terrain: "forest" },
      { at: { q: 2, r: 0 }, kind: "land", terrain: "mountain" },
    ]);
    // Clearing terrain on an empty cell is a no-op and not recorded in history.
    expect(reduce(s, { type: "paintTerrain", at: { q: 5, r: 5 }, terrain: null })).toBe(s);
    let h: History = { past: [], present: s, future: [] };
    h = historyReduce(h, { type: "setFrameKind", kind: "land" });
    expect(h.past).toHaveLength(0);
  });

  it("a 12-hex island: auto-fill tokens is balanced and fixed, auto-place harbours covers the coast, and the board validates", () => {
    let s = initialEditorState(emptyDefinition("Isle"));
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cells.push({ q: c - Math.floor(r / 2), r });
    s = reduce(s, { type: "setCells", cells, kind: "land" });
    for (const [i, h] of s.def.hexes.entries()) s = reduce(s, { type: "paintTerrain", at: h.at, terrain: (["forest", "meadow", "farmland", "claypit", "mountain", "wasteland"] as const)[i % 6]! });
    s = reduce(s, { type: "setGeneration", terrain: "fixed" });
    s = reduce(s, { type: "autoFillTokens", seed: "isle" });
    expect(s.def.generation.tokens).toBe("fixed");
    const producing = s.def.hexes.filter((h) => h.terrain !== "wasteland");
    expect(producing.every((h) => h.token !== undefined)).toBe(true);
    expect(s.def.hexes.filter((h) => h.terrain === "wasteland").every((h) => h.token === undefined)).toBe(true);
    expect(tokenTray(s.def).every((t) => t.left === 0)).toBe(true);
    s = reduce(s, { type: "autoPlaceHarbors", seed: "isle" });
    expect(s.def.harbors.length).toBeGreaterThanOrEqual(4);
    for (const h of s.def.harbors) expect(harborEdges(s.def)).toContain(h.edge);
    const issues = validateBoard(s.def);
    expect(hasErrors(issues)).toBe(false);
    // Harbour tool cycles none → 3:1 → 2:1 wood … → none.
    const edge = harborEdges(s.def).find((e) => !s.def.harbors.some((h) => h.edge === e))!;
    const cleared = reduce(s, { type: "clearLayer", layer: "harbors" });
    let c = reduce(cleared, { type: "cycleHarbor", edge });
    expect(c.def.harbors).toEqual([{ edge, ratio: 3 }]);
    c = reduce(c, { type: "cycleHarbor", edge });
    expect(c.def.harbors).toEqual([{ edge, ratio: 2, resource: "wood" }]);
    for (let i = 0; i < 5; i++) c = reduce(c, { type: "cycleHarbor", edge });
    expect(c.def.harbors).toEqual([]);
  });

  it("undo and redo walk the definition history; view-only actions are not recorded", () => {
    let h: History = { past: [], present: initialEditorState(emptyDefinition()), future: [] };
    h = historyReduce(h, { type: "setCell", at: { q: 0, r: 0 }, kind: "land" });
    h = historyReduce(h, { type: "setTool", tool: "terrain" });
    h = historyReduce(h, { type: "setCell", at: { q: 1, r: 0 }, kind: "land" });
    expect(h.past).toHaveLength(2);
    expect(h.present.def.hexes).toHaveLength(2);
    h = historyReduce(h, { type: "undo" });
    expect(h.present.def.hexes).toHaveLength(1);
    expect(h.present.tool).toBe("terrain");
    h = historyReduce(h, { type: "undo" });
    expect(h.present.def.hexes).toHaveLength(0);
    expect(historyReduce(h, { type: "undo" })).toEqual(h);
    h = historyReduce(h, { type: "redo" });
    h = historyReduce(h, { type: "redo" });
    expect(h.present.def.hexes).toHaveLength(2);
    // A new edit clears the redo stack.
    h = historyReduce(h, { type: "undo" });
    h = historyReduce(h, { type: "setCell", at: { q: 5, r: 0 }, kind: "sea" });
    expect(h.future).toEqual([]);
  });

  it("loading a template replaces the board; editing marks it dirty and saving clears the flag", () => {
    let s = initialEditorState(emptyDefinition());
    s = reduce(s, { type: "loadTemplate", id: "large" });
    expect(s.def.hexes).toHaveLength(30);
    expect(s.dirty).toBe(true);
    s = reduce(s, { type: "markSaved", boardId: "b1" });
    expect(s.dirty).toBe(false);
    expect(s.boardId).toBe("b1");
    s = reduce(s, { type: "setName", name: "My large" });
    expect(s.dirty).toBe(true);
    expect(s.def.name).toBe("My large");
  });

  it("docs/phase9.md §5 the scenario tab: settings round-trip, main island picked by hex, VP clamped, not undoable", () => {
    let s = initialEditorState(emptyDefinition("Isles"));
    expect(toScenario(s)).toBeNull();
    s = reduce(s, { type: "setScenario", scenario: { ...DEFAULT_SCENARIO } });
    expect(s.scenario).toEqual(DEFAULT_SCENARIO);
    expect(s.dirty).toBe(true);
    s = reduce(s, { type: "setScenario", scenario: { victoryPoints: 99, islandBonus: -1 } });
    expect(s.scenario?.victoryPoints).toBe(30);
    expect(s.scenario?.islandBonus).toBe(0);
    // Two islands: the second one picked by clicking one of its hexes.
    s = reduce(s, { type: "loadTemplate", id: "random" });
    s = reduce(s, { type: "setCells", cells: [{ q: 5, r: 0 }, { q: 6, r: 0 }, { q: 5, r: 1 }, { q: 6, r: -1 }, { q: 4, r: 1 }, { q: 7, r: -1 }, { q: 6, r: 1 }], kind: "land" });
    expect(islandIndexOf(s.def, { q: 6, r: 0 })).toBe(1);
    expect(islandIndexOf(s.def, { q: 0, r: 0 })).toBe(0);
    expect(islandIndexOf(s.def, { q: 3, r: 0 })).toBeNull();
    s = reduce(s, { type: "setScenario", scenario: { setup: "mainIslandOnly", mainIsland: 1, specialRules: "Start east\n\nGold is west" } });
    const sc = toScenario(s, "test")!;
    expect(sc).toMatchObject({ id: "test", name: "Isles", modules: { tides: true }, setup: "mainIslandOnly", mainIsland: 1, specialRules: ["Start east", "Gold is west"] });
    expect(validateScenario(sc).some((i) => i.code === "SCENARIO_MAIN_ISLAND")).toBe(false);
    // Settings from a stored scenario and back.
    const gold = builtInScenario("goldCoast");
    const fromStored = settingsOf(gold);
    expect(fromStored).toMatchObject({ tides: true, pirate: true, islandBonus: 0, setup: "standard", victoryPoints: 11 });
    const loaded = reduce(initialEditorState(gold.board, "gc", fromStored), { type: "setName", name: "Gold Coast" });
    expect(toScenario(loaded, "gc")?.victoryPoints).toBe(11);
    // Scenario settings are not part of the undo history; turning it off keeps the board.
    let h: History = { past: [], present: initialEditorState(emptyDefinition()), future: [] };
    h = historyReduce(h, { type: "setCell", at: { q: 0, r: 0 }, kind: "land" });
    h = historyReduce(h, { type: "setScenario", scenario: { ...DEFAULT_SCENARIO } });
    expect(h.past).toHaveLength(1);
    h = historyReduce(h, { type: "setScenario", scenario: null });
    expect(h.present.scenario).toBeNull();
    expect(h.present.def.hexes).toHaveLength(1);
  });
});

describe("docs/phase10.md §8 editor: Wayfarers markers and scenario switches", () => {
  const standard = () => initialEditorState(standardFrame());
  const LAND_EDGE = "0,0|1,0";
  const COAST_EDGE = "2,0|3,0";

  it("river tool toggles a segment on land edges only, keeps `edges` absent when empty, and is undoable", () => {
    let s = standard();
    expect(s.def.edges).toBeUndefined();
    expect(landEdges(s.def)).toContain(LAND_EDGE);
    expect(landEdges(s.def)).toContain(COAST_EDGE);
    // An edge off the land (between two missing cells) is refused.
    expect(reduce(s, { type: "toggleRiver", edge: "4,0|5,0" })).toBe(s);
    s = reduce(s, { type: "toggleRiver", edge: LAND_EDGE });
    expect(s.def.edges).toEqual([{ edge: LAND_EDGE, kind: "river" }]);
    expect(riverEdgesOf(s.def)).toEqual([LAND_EDGE]);
    expect(hasErrors(validateBoard(s.def))).toBe(false);
    s = reduce(s, { type: "toggleRiver", edge: COAST_EDGE });
    expect(riverEdgesOf(s.def)).toEqual([LAND_EDGE, COAST_EDGE]);
    s = reduce(s, { type: "toggleRiver", edge: LAND_EDGE });
    expect(riverEdgesOf(s.def)).toEqual([COAST_EDGE]);
    s = reduce(s, { type: "toggleRiver", edge: COAST_EDGE });
    expect(s.def.edges).toBeUndefined();
    expect(s.def).toEqual({ ...standardFrame(), name: "Standard" });
    let h: History = { past: [], present: standard(), future: [] };
    h = historyReduce(h, { type: "toggleRiver", edge: LAND_EDGE });
    expect(h.past).toHaveLength(1);
    h = historyReduce(h, { type: "undo" });
    expect(h.present.def.edges).toBeUndefined();
  });

  it("fishing tool: a coastal edge gets the default token, typing 2–12 (never 7) re-numbers it, null removes it; inland edges are refused", () => {
    let s = standard();
    expect(reduce(s, { type: "setFishingGround", edge: LAND_EDGE, token: DEFAULT_FISHING_TOKEN })).toBe(s);
    s = reduce(s, { type: "setFishingGround", edge: COAST_EDGE, token: fishingGroundAt(s.def, COAST_EDGE) ? null : DEFAULT_FISHING_TOKEN });
    expect(s.def.edges).toEqual([{ edge: COAST_EDGE, kind: "fishingGround", token: 5 }]);
    expect(reduce(s, { type: "setFishingGround", edge: COAST_EDGE, token: 7 })).toBe(s);
    expect(reduce(s, { type: "setFishingGround", edge: COAST_EDGE, token: 13 })).toBe(s);
    s = reduce(s, { type: "setFishingGround", edge: COAST_EDGE, token: 8 });
    expect(s.def.edges).toEqual([{ edge: COAST_EDGE, kind: "fishingGround", token: 8 }]);
    expect(fishingGroundAt(s.def, COAST_EDGE)).toEqual({ edge: COAST_EDGE, token: 8 });
    expect(hasErrors(validateBoard(s.def))).toBe(false);
    // A river and a fishing ground may share the coast edge; clearing one keeps the other.
    s = reduce(s, { type: "toggleRiver", edge: COAST_EDGE });
    expect(s.def.edges).toHaveLength(2);
    s = reduce(s, { type: "setFishingGround", edge: COAST_EDGE, token: null });
    expect(s.def.edges).toEqual([{ edge: COAST_EDGE, kind: "river" }]);
    expect(reduce(s, { type: "setFishingGround", edge: COAST_EDGE, token: null })).toBe(s);
    s = reduce(s, { type: "clearLayer", layer: "edges" });
    expect(s.def.edges).toBeUndefined();
    expect(reduce(s, { type: "clearLayer", layer: "edges" })).toBe(s);
  });

  it("oasis tool toggles `extras.oasis` on land hexes, never leaves an empty extras object, and clearLayer oases removes them all", () => {
    let s = standard();
    const at = { q: 0, r: 0 };
    s = reduce(s, { type: "setCell", at: { q: 3, r: 0 }, kind: "sea" });
    expect(reduce(s, { type: "toggleOasis", at: { q: 3, r: 0 } })).toBe(s);
    expect(reduce(s, { type: "toggleOasis", at: { q: 9, r: 9 } })).toBe(s);
    s = reduce(s, { type: "toggleOasis", at });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at, kind: "land", extras: { oasis: true } });
    expect(oasisCount(s.def)).toBe(1);
    // Terrain and tokens survive on an oasis and the marker survives painting.
    s = reduce(s, { type: "paintTerrain", at, terrain: "farmland" });
    s = reduce(s, { type: "setToken", at, token: 6 });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at, kind: "land", terrain: "farmland", token: 6, extras: { oasis: true } });
    s = reduce(s, { type: "toggleOasis", at });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at, kind: "land", terrain: "farmland", token: 6 });
    s = reduce(s, { type: "toggleOasis", at });
    s = reduce(s, { type: "toggleOasis", at: { q: 1, r: 0 } });
    expect(oasisCount(s.def)).toBe(2);
    s = reduce(s, { type: "clearLayer", layer: "oases" });
    expect(oasisCount(s.def)).toBe(0);
    expect(s.def.hexes.every((h) => h.extras === undefined)).toBe(true);
    expect(reduce(s, { type: "clearLayer", layer: "oases" })).toBe(s);
  });

  it("lake is a terrain (key 8): painting it drops the token, no token can be set on it, and the tray counts it as non-producing", () => {
    let s = standard();
    const at = { q: 0, r: 0 };
    s = reduce(s, { type: "paintTerrain", at, terrain: "meadow" });
    s = reduce(s, { type: "setToken", at, token: 9 });
    const before = tokenTray(s.def).find((t) => t.token === 9)!.left;
    s = reduce(s, { type: "paintTerrain", at, terrain: "lake" });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at, kind: "land", terrain: "lake" });
    expect(reduce(s, { type: "setToken", at, token: 6 })).toBe(s);
    // The lake no longer owes a 9 and the pool shrinks by one hex, so the tray's total drops.
    const after = tokenTray(s.def).find((t) => t.token === 9)!.left;
    expect(after).toBe(before + 1);
    const total = (def: typeof s.def) => tokenTray(def).reduce((n, t) => n + t.left, 0);
    expect(total(s.def)).toBe(total(reduce(s, { type: "paintTerrain", at, terrain: "wasteland" }).def));
    expect(validateBoard(s.def).some((i) => i.code === "TOKEN_ON_LAKE")).toBe(false);
    // Validation catches a token that arrives on a lake by another route.
    const tokened = { ...s.def, hexes: s.def.hexes.map((h) => (h.at.q === 0 && h.at.r === 0 ? { ...h, token: 5 } : h)) };
    expect(validateBoard(tokened).some((i) => i.code === "TOKEN_ON_LAKE")).toBe(true);
  });

  it("scenario settings round-trip crown and the variants; DEFAULT_SCENARIO has them off", () => {
    expect(DEFAULT_SCENARIO.crown).toBe(false);
    expect(Object.values(DEFAULT_SCENARIO.variants).every((v) => v === false)).toBe(true);
    for (const id of BUILT_IN_SCENARIO_IDS) {
      const sc = builtInScenario(id);
      const settings = settingsOf(sc);
      const loaded = initialEditorState(sc.board, id, settings);
      const back = toScenario(loaded, id)!;
      expect(back.modules.crown).toBe(sc.modules.crown === true);
      expect(back.modules.tides).toBe(sc.modules.tides === true);
      expect(back.variants ?? {}).toEqual(sc.variants ?? {});
      expect(isScenario(back)).toBe(true);
      expect(validateScenario(back).filter((i) => i.severity === "error")).toEqual(validateScenario(sc).filter((i) => i.severity === "error"));
    }
    expect(settingsOf(builtInScenario("greatLake")).variants).toMatchObject({ fishing: true, harbormaster: true, rivers: false });
    expect(settingsOf(builtInScenario("crownStandard"))).toMatchObject({ crown: true, tides: false });
    // Only true flags are written; none at all means no `variants` key.
    let s = reduce(standard(), { type: "setScenario", scenario: { ...DEFAULT_SCENARIO, tides: false } });
    expect(toScenario(s, "x")).not.toHaveProperty("variants");
    s = reduce(s, { type: "setScenario", scenario: { variants: { ...DEFAULT_SCENARIO.variants, rivers: true, wagons: true } } });
    expect(toScenario(s, "x")?.variants).toEqual({ rivers: true, wagons: true });
    expect(toScenario(s, "x")?.modules).toEqual({ tides: false, crown: false });
  });

  it("Raiders and Crown & Castle are mutually exclusive in the editor; validation flags the combination", () => {
    let s = reduce(standard(), { type: "setScenario", scenario: { ...DEFAULT_SCENARIO, tides: false } });
    s = reduce(s, { type: "setScenario", scenario: { variants: { ...DEFAULT_SCENARIO.variants, raiders: true } } });
    expect(s.scenario?.variants.raiders).toBe(true);
    s = reduce(s, { type: "setScenario", scenario: { crown: true } });
    expect(s.scenario?.crown).toBe(true);
    expect(s.scenario?.variants.raiders).toBe(false);
    s = reduce(s, { type: "setScenario", scenario: { variants: { ...s.scenario!.variants, raiders: true } } });
    expect(s.scenario?.variants.raiders).toBe(true);
    expect(s.scenario?.crown).toBe(false);
    const both = { ...toScenario(s, "both")!, modules: { crown: true }, variants: { raiders: true } };
    expect(validateScenario(both).some((i) => i.code === "SCENARIO_MODULES" && i.severity === "error")).toBe(true);
    expect(validateScenario(toScenario(s, "ok")!).some((i) => i.code === "SCENARIO_MODULES")).toBe(false);
  });

  it("the new validation codes surface for misplaced markers", () => {
    let s = standard();
    s = reduce(s, { type: "toggleOasis", at: { q: 0, r: 0 } });
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: "lake" });
    expect(validateBoard(s.def).some((i) => i.code === "OASIS_TERRAIN")).toBe(true);
    s = reduce(s, { type: "toggleRiver", edge: COAST_EDGE });
    s = reduce(s, { type: "setCell", at: { q: 2, r: 0 }, kind: "sea" });
    expect(validateBoard(s.def).some((i) => i.code === "RIVER_AT_SEA")).toBe(true);
    const sc = reduce(s, { type: "setScenario", scenario: { ...DEFAULT_SCENARIO, tides: false, variants: { ...DEFAULT_SCENARIO.variants, caravans: true } } });
    const codes = validateScenario(toScenario(sc, "v")!).map((i) => i.code);
    expect(codes).toContain("SCENARIO_OASES_COUNT");
    expect(codes).toContain("SCENARIO_RIVERS_UNUSED");
  });
});

describe("docs/phase10.md §8 storage: drafts with markers round-trip", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a scenario draft with rivers, a fishing ground, an oasis, crown off and variants on survives JSON and the guards", () => {
    let s = initialEditorState(standardFrame(), null, { ...DEFAULT_SCENARIO, tides: false, victoryPoints: 12, variants: { ...DEFAULT_SCENARIO.variants, rivers: true, fishing: true, caravans: true } });
    s = reduce(s, { type: "toggleRiver", edge: "0,0|1,0" });
    s = reduce(s, { type: "setFishingGround", edge: "2,0|3,0", token: 8 });
    s = reduce(s, { type: "toggleOasis", at: { q: 0, r: 0 } });
    const sc = toScenario(s)!;
    expect(isScenario(sc)).toBe(true);
    expect(isBoardDefinition(JSON.parse(JSON.stringify(sc.board)))).toBe(true);
    const draft = saveScenarioDraft(sc);
    expect(draft.id.startsWith("sdraft-")).toBe(true);
    const loaded = loadScenarioDrafts();
    expect(loaded).toHaveLength(1);
    const back = loaded[0]!.scenario;
    expect(back.board.edges).toEqual([
      { edge: "0,0|1,0", kind: "river" },
      { edge: "2,0|3,0", kind: "fishingGround", token: 8 },
    ]);
    expect(back.board.hexes.find((h) => h.at.q === 0 && h.at.r === 0)?.extras).toEqual({ oasis: true });
    expect(back.variants).toEqual({ fishing: true, rivers: true, caravans: true });
    expect(back.modules).toEqual({ tides: false, crown: false });
    expect(settingsOf(back)).toMatchObject({ crown: false, victoryPoints: 12, variants: { rivers: true, fishing: true, caravans: true, wagons: false } });
    // Saving again under the same id replaces rather than duplicates.
    saveScenarioDraft({ ...sc, name: "Renamed" }, draft.id);
    expect(loadScenarioDrafts().map((d) => d.name)).toEqual(["Renamed"]);
  });
});
