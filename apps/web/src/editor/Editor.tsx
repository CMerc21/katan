"use client";

/**
 * The board editor (docs/phase8.md §4): palette on the left, the 3D canvas
 * in the centre, inspector and live validation on the right, name / seats /
 * generation / Save / Save as / Test play on top. Undo/redo and keyboard
 * shortcuts: 1–7 terrains, H harbour, F frame, T token, Del clear, Ctrl+Z/Y.
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BUILT_IN_BOARD_IDS, RESOURCES, TERRAINS, builtInBoard, hasErrors, landComponents, validateBoard, type BoardDefinition, type EdgeId, type HexCoord, type Terrain } from "@katan/engine";
import { Button } from "@/components/ui";
import { errorText } from "@/game/labels";
import { startHotseat } from "@/game/store";
import { TERRAIN_FILL } from "@/game/theme";
import { useSettings } from "@/game/settings";
import { useSession } from "@/hooks/useSession";
import { harborKindOf, historyReduce, initialEditorState, rectangleCells, tokenTray, type EditorAction, type History, type Symmetry, type Tool } from "./model";
import { deleteDraft, isDraftId, saveBoardRemote, saveDraft, type StoredBoard } from "./storage";

const EditorCanvas = dynamic(() => import("./EditorCanvas").then((m) => m.EditorCanvas), { ssr: false, loading: () => <div className="grid h-full place-items-center text-parchment/70">Laying out the table…</div> });

const TERRAIN_LABEL: Record<Terrain, string> = { forest: "Forest", claypit: "Clay pit", meadow: "Meadow", farmland: "Farmland", mountain: "Mountain", wasteland: "Wasteland", gold: "Gold" };
const TEMPLATE_LABEL: Record<string, string> = { beginner: "Beginner", random: "Standard", large: "Large", longStrip: "Long strip", ring: "Ring" };

export function Editor({ initial, initialId }: { initial: BoardDefinition; initialId: string | null }) {
  const router = useRouter();
  const { session } = useSession();
  const [settings] = useSettings();
  const [history, dispatchRaw] = useReducer(historyReduce, null, (): History => ({ past: [], present: initialEditorState(initial, initialId), future: [] }));
  const state = history.present;
  const dispatch = useCallback((a: EditorAction | { type: "undo" } | { type: "redo" }) => dispatchRaw(a), []);
  const [topDown, setTopDown] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const dragStart = useRef<{ at: HexCoord; shift: boolean; button: number } | null>(null);
  const quality = settings.quality === "auto" ? "medium" : settings.quality;

  const issues = useMemo(() => validateBoard(state.def, { allowIslands: true }), [state.def]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const islands = useMemo(() => landComponents(state.def).length, [state.def]);
  const tray = useMemo(() => tokenTray(state.def), [state.def]);
  const selectedHex = state.selected && !state.selected.includes("|") ? state.def.hexes.find((h) => `${h.at.q},${h.at.r}` === state.selected) : undefined;
  const selectedEdge = state.selected && state.selected.includes("|") ? state.selected : null;
  const seedRef = useRef(`${Date.now()}`);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Painting.
  const paintCell = useCallback(
    (at: HexCoord, button: number) => {
      const erase = button === 2;
      switch (state.tool) {
        case "frame":
          if (erase) dispatch({ type: "setCell", at, kind: null });
          else dispatch({ type: "cycleCell", at });
          break;
        case "terrain":
          dispatch({ type: "paintTerrain", at, terrain: erase ? null : state.terrain });
          break;
        case "token":
          if (erase) dispatch({ type: "setToken", at, token: null });
          dispatch({ type: "select", id: `${at.q},${at.r}` });
          break;
        case "harbor":
          dispatch({ type: "select", id: `${at.q},${at.r}` });
          break;
        default:
          break;
      }
    },
    [dispatch, state.tool, state.terrain],
  );
  const onCellDown = useCallback(
    (at: HexCoord, shift: boolean, button: number) => {
      dragStart.current = { at, shift, button };
      dispatch({ type: "select", id: `${at.q},${at.r}` });
      if (!shift) paintCell(at, button);
    },
    [dispatch, paintCell],
  );
  const onCellDrag = useCallback(
    (at: HexCoord) => {
      const d = dragStart.current;
      if (!d || d.shift) return;
      if (state.tool === "frame") {
        // Dragging paints the kind of the first cell rather than cycling each one.
        const first = state.def.hexes.find((h) => h.at.q === d.at.q && h.at.r === d.at.r)?.kind ?? null;
        dispatch({ type: "setCell", at, kind: d.button === 2 ? null : first });
      } else if (state.tool === "terrain") dispatch({ type: "paintTerrain", at, terrain: d.button === 2 ? null : state.terrain });
    },
    [dispatch, state.def.hexes, state.terrain, state.tool],
  );
  const onCellUp = useCallback(
    (at: HexCoord | null) => {
      const d = dragStart.current;
      dragStart.current = null;
      if (!d || !d.shift || !at) return;
      const cells = rectangleCells(d.at, at);
      if (state.tool === "frame") dispatch({ type: "setCells", cells, kind: d.button === 2 ? null : "land" });
      else if (state.tool === "terrain") for (const c of cells) dispatch({ type: "paintTerrain", at: c, terrain: d.button === 2 ? null : state.terrain });
    },
    [dispatch, state.terrain, state.tool],
  );
  const onEdge = useCallback(
    (edge: EdgeId) => {
      dispatch({ type: "cycleHarbor", edge });
      dispatch({ type: "select", id: edge });
    },
    [dispatch],
  );

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch(e.shiftKey ? { type: "redo" } : { type: "undo" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      const idx = Number(e.key);
      if (idx >= 1 && idx <= TERRAINS.length) dispatch({ type: "setTerrain", terrain: TERRAINS[idx - 1] as Terrain });
      else if (e.key.toLowerCase() === "h") dispatch({ type: "setTool", tool: "harbor" });
      else if (e.key.toLowerCase() === "f") dispatch({ type: "setTool", tool: "frame" });
      else if (e.key.toLowerCase() === "t") dispatch({ type: "setTool", tool: "token" });
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedHex) {
        if (state.tool === "frame") dispatch({ type: "setCell", at: selectedHex.at, kind: null });
        else if (state.tool === "token") dispatch({ type: "setToken", at: selectedHex.at, token: null });
        else dispatch({ type: "paintTerrain", at: selectedHex.at, terrain: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, selectedHex, state.tool]);

  const save = async (asCopy: boolean) => {
    if (hasErrors(issues)) return setToast("Fix the errors before saving");
    if (session) {
      const keepId = !asCopy && state.boardId && !isDraftId(state.boardId) ? state.boardId : undefined;
      const r = await saveBoardRemote(state.def, keepId ? { boardId: keepId, isPublic } : { isPublic });
      if (!r.ok) return setToast(errorText(r.code));
      if (state.boardId && isDraftId(state.boardId)) deleteDraft(state.boardId);
      dispatch({ type: "markSaved", boardId: r.boardId });
      setToast("Saved");
      router.replace(`/boards/editor/${r.boardId}`);
      return;
    }
    const draft: StoredBoard = saveDraft(state.def, asCopy ? undefined : (state.boardId ?? undefined));
    dispatch({ type: "markSaved", boardId: draft.id });
    setToast("Saved on this device");
    router.replace(`/boards/editor/${draft.id}`);
  };

  const testPlay = () => {
    if (hasErrors(issues)) return setToast("Fix the errors before playing");
    const seats = Math.min(4, state.def.seats.max);
    const names = ["Ada", "Bo", "Cy", "Di"];
    startHotseat({
      players: names.slice(0, seats).map((name, i) => (i === 0 ? { id: `p${i + 1}-${name.toLowerCase()}`, name } : { id: `p${i + 1}-${name.toLowerCase()}`, name, bot: "medium" as const })),
      board: state.def,
      seed: `test-${Date.now().toString(36)}`,
    });
    router.push("/play");
  };

  const modeButton = <T extends string>(current: T, value: T, label: string, onPick: () => void, testId: string) => (
    <Button size="sm" variant={current === value ? "primary" : "secondary"} onClick={onPick} data-testid={testId}>
      {label}
    </Button>
  );

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {/* Top bar */}
      <header className="parchment flex flex-wrap items-center gap-2 px-3 py-2" data-testid="editor-top">
        <input className="w-44 rounded-md border border-line bg-white/60 px-2 py-1 font-display text-base" value={state.def.name} maxLength={40} aria-label="Board name" onChange={(e) => dispatch({ type: "setName", name: e.target.value })} data-testid="board-name" />
        <label className="flex items-center gap-1 text-sm">
          Seats up to
          <select className="rounded-md border border-line bg-white/60 px-1 py-1" value={state.def.seats.max} onChange={(e) => dispatch({ type: "setSeats", max: Number(e.target.value) as 4 | 5 | 6 })} data-testid="seats-max">
            {[4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1 text-sm">
          Terrain {modeButton(state.def.generation.terrain, "fixed", "Fixed", () => dispatch({ type: "setGeneration", terrain: "fixed" }), "gen-terrain-fixed")}
          {modeButton(state.def.generation.terrain, "shuffle", "Shuffle", () => dispatch({ type: "setGeneration", terrain: "shuffle" }), "gen-terrain-shuffle")}
        </span>
        <span className="flex items-center gap-1 text-sm">
          Tokens {modeButton(state.def.generation.tokens, "fixed", "Fixed", () => dispatch({ type: "setGeneration", tokens: "fixed" }), "gen-tokens-fixed")}
          {modeButton(state.def.generation.tokens, "shuffle", "Shuffle", () => dispatch({ type: "setGeneration", tokens: "shuffle" }), "gen-tokens-shuffle")}
          {modeButton(state.def.generation.tokens, "balanced", "Balanced", () => dispatch({ type: "setGeneration", tokens: "balanced" }), "gen-tokens-balanced")}
        </span>
        <span className="flex items-center gap-1 text-sm">
          Harbours {modeButton(state.def.generation.harbors, "fixed", "Fixed", () => dispatch({ type: "setGeneration", harbors: "fixed" }), "gen-harbors-fixed")}
          {modeButton(state.def.generation.harbors, "shuffle", "Shuffle", () => dispatch({ type: "setGeneration", harbors: "shuffle" }), "gen-harbors-shuffle")}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="quiet" disabled={history.past.length === 0} onClick={() => dispatch({ type: "undo" })} data-testid="undo" title="Undo (Ctrl+Z)">
            Undo
          </Button>
          <Button size="sm" variant="quiet" disabled={history.future.length === 0} onClick={() => dispatch({ type: "redo" })} data-testid="redo" title="Redo (Ctrl+Y)">
            Redo
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setTopDown((t) => !t)} data-testid="toggle-view">
            {topDown ? "Diorama view" : "Top-down view"}
          </Button>
          {session && (
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} data-testid="is-public" /> Public
            </label>
          )}
          <Button size="sm" variant="primary" disabled={errors.length > 0} reason="Fix the errors first" onClick={() => void save(false)} data-testid="save">
            Save{state.dirty ? "*" : ""}
          </Button>
          <Button size="sm" disabled={errors.length > 0} reason="Fix the errors first" onClick={() => void save(true)} data-testid="save-as">
            Save as
          </Button>
          <Button size="sm" disabled={errors.length > 0} reason="Fix the errors first" onClick={testPlay} data-testid="test-play">
            Test play
          </Button>
          <Button size="sm" variant="quiet" onClick={() => router.push("/boards")}>
            Boards
          </Button>
        </span>
      </header>

      <div className="grid min-h-0 grid-cols-[13rem_minmax(0,1fr)_17rem]">
        {/* Palette */}
        <aside className="parchment flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm" aria-label="Tools">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Tool</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              {(
                [
                  ["frame", "Frame (F)"],
                  ["terrain", "Terrain"],
                  ["token", "Token (T)"],
                  ["harbor", "Harbour (H)"],
                ] as [Tool, string][]
              ).map(([t, label]) => (
                <Button key={t} size="sm" variant={state.tool === t ? "primary" : "secondary"} onClick={() => dispatch({ type: "setTool", tool: t })} data-testid={`tool-${t}`}>
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {state.tool === "frame" && "Click: empty → land → sea → frame. Right-click clears. Shift-drag: rectangle."}
              {state.tool === "terrain" && "Paint land hexes. Right-click clears to unassigned."}
              {state.tool === "token" && "Click a hex, then type its number in the inspector."}
              {state.tool === "harbor" && "Click a coastal edge to cycle 3:1 → 2:1 …"}
            </p>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Terrain (1–7)</h2>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {TERRAINS.map((t, i) => (
                <button key={t} type="button" className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs ${state.tool === "terrain" && state.terrain === t ? "border-ink bg-white/60" : "border-line"}`} onClick={() => dispatch({ type: "setTerrain", terrain: t })} data-testid={`terrain-${t}`}>
                  <span className="inline-block h-4 w-4 rounded-sm border border-ink/40" style={{ background: TERRAIN_FILL[t] }} />
                  <kbd className="text-[10px] text-ink-soft">{i + 1}</kbd> {TERRAIN_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Symmetry</h2>
            <div className="mt-1 flex gap-1">
              {(["none", "mirror", "rotate"] as Symmetry[]).map((s) => (
                <Button key={s} size="sm" variant={state.symmetry === s ? "primary" : "secondary"} onClick={() => dispatch({ type: "setSymmetry", symmetry: s })} data-testid={`symmetry-${s}`}>
                  {s === "none" ? "Off" : s === "mirror" ? "Mirror" : "Rotate"}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Tokens</h2>
            <div className="mt-1 flex flex-wrap gap-1" aria-label="Token tray">
              {tray.map((t) => (
                <span key={t.token} className={`rounded border px-1 text-xs tabular-nums ${t.left > 0 ? "border-ink bg-white/60" : t.left < 0 ? "border-clay text-clay" : "border-line text-ink-soft"}`} title={`${t.left} left`}>
                  {t.token}
                  <span className="text-[10px]">×{t.left}</span>
                </span>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" onClick={() => dispatch({ type: "autoFillTokens", seed: `${seedRef.current}-${history.past.length}` })} data-testid="auto-tokens">
                Auto-fill balanced
              </Button>
              <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "clearLayer", layer: "tokens" })}>
                Clear
              </Button>
            </div>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Harbours</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" onClick={() => dispatch({ type: "autoPlaceHarbors", seed: `${seedRef.current}-${history.past.length}` })} data-testid="auto-harbors">
                Auto-place
              </Button>
              <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "clearLayer", layer: "harbors" })}>
                Clear
              </Button>
            </div>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Templates</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              {BUILT_IN_BOARD_IDS.map((id) => (
                <Button key={id} size="sm" variant="quiet" onClick={() => dispatch({ type: "loadTemplate", id })} data-testid={`template-${id}`}>
                  {TEMPLATE_LABEL[id]}
                </Button>
              ))}
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <main className="relative min-h-0" aria-label="Board canvas">
          <EditorCanvas def={state.def} tool={state.tool} symmetry={state.symmetry} selected={state.selected} topDown={topDown} quality={quality} gridRadius={state.gridRadius} onCellDown={onCellDown} onCellDrag={onCellDrag} onCellUp={onCellUp} onEdge={onEdge} onSelect={(id) => dispatch({ type: "select", id })} />
        </main>

        {/* Inspector and validation */}
        <aside className="parchment flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm" aria-label="Inspector">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Selected</h2>
            {selectedHex ? (
              <div className="mt-1 space-y-1" data-testid="inspector-hex">
                <p>
                  Hex <span className="font-mono">{selectedHex.at.q},{selectedHex.at.r}</span> · {selectedHex.kind}
                  {selectedHex.terrain ? ` · ${TERRAIN_LABEL[selectedHex.terrain]}` : selectedHex.kind === "land" ? " · unassigned" : ""}
                </p>
                {selectedHex.kind === "land" && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {TERRAINS.map((t) => (
                        <button key={t} type="button" title={TERRAIN_LABEL[t]} aria-label={`Set ${TERRAIN_LABEL[t]}`} className={`h-5 w-5 rounded-sm border ${selectedHex.terrain === t ? "border-ink ring-2 ring-gilt" : "border-ink/40"}`} style={{ background: TERRAIN_FILL[t] }} onClick={() => dispatch({ type: "paintTerrain", at: selectedHex.at, terrain: t })} />
                      ))}
                      <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "paintTerrain", at: selectedHex.at, terrain: null })}>
                        Clear
                      </Button>
                    </div>
                    {selectedHex.terrain !== "wasteland" && (
                      <form
                        className="flex items-center gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const n = Number(tokenDraft);
                          if (Number.isInteger(n) && n >= 2 && n <= 12 && n !== 7) dispatch({ type: "setToken", at: selectedHex.at, token: n });
                          setTokenDraft("");
                        }}
                      >
                        <label className="text-xs">
                          Token
                          <input className="ml-1 w-14 rounded-md border border-line bg-white/60 px-1 py-0.5" value={tokenDraft} placeholder={selectedHex.token !== undefined ? String(selectedHex.token) : "2–12"} inputMode="numeric" onChange={(e) => setTokenDraft(e.target.value)} data-testid="token-input" />
                        </label>
                        <Button size="sm" type="submit">
                          Set
                        </Button>
                        {selectedHex.token !== undefined && (
                          <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "setToken", at: selectedHex.at, token: null })}>
                            Remove
                          </Button>
                        )}
                      </form>
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-1">
                  {(["land", "sea", "frame"] as const).map((k) => (
                    <Button key={k} size="sm" variant={selectedHex.kind === k ? "primary" : "secondary"} onClick={() => dispatch({ type: "setCell", at: selectedHex.at, kind: k })}>
                      {k}
                    </Button>
                  ))}
                  <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "setCell", at: selectedHex.at, kind: null })}>
                    Remove
                  </Button>
                </div>
              </div>
            ) : selectedEdge ? (
              <div className="mt-1 space-y-1" data-testid="inspector-edge">
                <p>
                  Edge <span className="font-mono text-xs">{selectedEdge}</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant={harborKindOf(state.def.harbors.find((h) => h.edge === selectedEdge)) === "any" ? "primary" : "secondary"} onClick={() => dispatch({ type: "setHarbor", edge: selectedEdge, harbor: { edge: selectedEdge, ratio: 3 } })}>
                    3:1
                  </Button>
                  {RESOURCES.map((r) => (
                    <Button key={r} size="sm" variant={harborKindOf(state.def.harbors.find((h) => h.edge === selectedEdge)) === r ? "primary" : "secondary"} onClick={() => dispatch({ type: "setHarbor", edge: selectedEdge, harbor: { edge: selectedEdge, ratio: 2, resource: r } })}>
                      2:1 {r}
                    </Button>
                  ))}
                  <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "setHarbor", edge: selectedEdge, harbor: null })}>
                    None
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-soft">Click a cell or, with the harbour tool, a coastal edge.</p>
            )}
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Board</h2>
            <p className="mt-1 text-xs text-ink-soft" data-testid="board-stats">
              {state.def.hexes.filter((h) => h.kind === "land").length} land · {state.def.hexes.filter((h) => h.kind === "sea").length} sea · {state.def.harbors.length} harbours · {islands} island{islands === 1 ? "" : "s"}
            </p>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Validation</h2>
            <ul className="mt-1 space-y-1" data-testid="validation">
              {issues.length === 0 && <li className="text-xs text-wood">No problems.</li>}
              {errors.map((i, k) => (
                <li key={`e${k}`} className="rounded border border-clay/60 bg-clay/10 px-1.5 py-1 text-xs" data-severity="error">
                  <button type="button" className="text-left" onClick={() => i.at && dispatch({ type: "select", id: i.at })}>
                    <strong>Error:</strong> {i.message}
                  </button>
                </li>
              ))}
              {warnings.map((i, k) => (
                <li key={`w${k}`} className="rounded border border-grain/70 bg-grain/10 px-1.5 py-1 text-xs" data-severity="warning">
                  <button type="button" className="text-left" onClick={() => i.at && dispatch({ type: "select", id: i.at })}>
                    <strong>Warning:</strong> {i.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-ink-soft">
            Templates: {Object.values(TEMPLATE_LABEL).join(", ")}. {builtInBoard("random").hexes.length} hexes is the standard size.
          </p>
        </aside>
      </div>
      {toast && (
        <div className="parchment fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-md px-3 py-1.5 text-sm" role="status" data-testid="editor-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
