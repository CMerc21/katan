import { describe, expect, it } from "vitest";
import { hasErrors, validateBoard } from "@katan/engine";
import { emptyDefinition, harborEdges, historyReduce, initialEditorState, rectangleCells, reduce, symmetricCells, tokenTray, type History } from "@/editor/model";

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
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 1 }, terrain: "forest" }); // sea: ignored
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at: { q: 0, r: 0 }, kind: "land", terrain: "forest", token: 8 });
    expect(s.def.hexes.find((h) => h.at.r === 1)).toEqual({ at: { q: 0, r: 1 }, kind: "sea" });
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: "wasteland" });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at: { q: 0, r: 0 }, kind: "land", terrain: "wasteland" });
    expect(reduce(s, { type: "setToken", at: { q: 0, r: 0 }, token: 6 })).toBe(s);
    s = reduce(s, { type: "paintTerrain", at: { q: 0, r: 0 }, terrain: null });
    expect(s.def.hexes.find((h) => h.at.q === 0 && h.at.r === 0)).toEqual({ at: { q: 0, r: 0 }, kind: "land" });
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
});
