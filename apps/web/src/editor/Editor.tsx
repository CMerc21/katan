"use client";

/**
 * The board editor (docs/phase8.md §4): palette on the left, the 3D canvas
 * in the centre, inspector and live validation on the right, name / seats /
 * generation / Save / Save as / Test play on top. Undo/redo and keyboard
 * shortcuts: 1–8 terrains, H harbour, F frame, T token, R river, G fishing
 * ground, O oasis, Del clear, Ctrl+Z/Y. The Scenario section switches on
 * Tides, Crown & Castle and the Wayfarers variants (docs/phase10.md §8).
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BUILT_IN_BOARD_IDS, RESOURCES, TERRAINS, builtInBoard, hasErrors, landComponents, validateBoard, type BoardDefinition, type EdgeId, type HexCoord, type HexKind, type Terrain } from "@katan/engine";
import { Button } from "@/components/ui";
import { errorText } from "@/game/labels";
import { VARIANT_LABEL, VARIANT_NAMES, scenarioSummary, validateScenario, type Scenario, type VariantName } from "@katan/engine";
import { startHotseat } from "@/game/store";
import { TERRAIN_FILL } from "@/game/theme";
import { useSettings } from "@/game/settings";
import { useSession } from "@/hooks/useSession";
import { DEFAULT_FISHING_TOKEN, DEFAULT_SCENARIO, fishingGroundAt, fishingGroundsOf, harborEdges, harborKindOf, historyReduce, initialEditorState, isOasis, islandIndexOf, islandsOf, landEdges, oasisCount, rectangleCells, riverEdgesOf, tokenTray, toScenario, type EditorAction, type History, type ScenarioSettings, type Symmetry, type Tool } from "./model";
import { deleteDraft, deleteScenarioDraft, isDraftId, isScenarioDraftId, saveBoardRemote, saveDraft, saveScenarioDraft, saveScenarioRemote, type StoredBoard, type StoredScenario } from "./storage";

const EditorCanvas = dynamic(() => import("./EditorCanvas").then((m) => m.EditorCanvas), { ssr: false, loading: () => <div className="grid h-full place-items-center text-parchment/70">Laying out the table…</div> });

const TERRAIN_LABEL: Record<Terrain, string> = { forest: "Forest", claypit: "Clay pit", meadow: "Meadow", farmland: "Farmland", mountain: "Mountain", wasteland: "Wasteland", gold: "Gold", lake: "Lake" };
const TEMPLATE_LABEL: Record<string, string> = { beginner: "Beginner", random: "Standard", large: "Large", longStrip: "Long strip", ring: "Ring" };

/** Plain-language rule summaries for the Scenario section (docs/phase10.md §1–§7, docs/phase11.md). */
const VARIANT_SUMMARY: Record<VariantName, string> = {
  eventDeck:
    "The dice are replaced by a deck of 36 cards with the same odds as two dice. Five of the cards also trigger an event when drawn: a harvest that gives everyone a resource of their choice, a quiet seven that leaves the robber in place, a round of gifts to the player with the fewest points, a tax on anyone holding eight or more cards, or a bounty for the roller. The deck is reshuffled shortly before it runs out.",
  fishing:
    "Fishing grounds on the coast carry a number; when it comes up, each settlement next to the ground draws one fish token and each city draws two. A lake yields fish on any 2, 3, 11 or 12. Fish are spent on favours: two move the robber away, three steal a card, four take a resource from the bank, five build a free road and seven buy a free development card. One token in the bag is an old boot, worth minus one point until you trade it to a player with at least as many points as you.",
  rivers:
    "Some edges are river segments. A road along a river needs an extra clay for the bridge, and whoever has built the most bridges (at least three) holds Bridge Builder for one point. At the end of each of your turns you earn coins for your riverside settlements and cities; the player with the fewest coins carries the Poor Settler, which costs two points, unless several players are tied.",
  harbormaster:
    "Settlements on a harbour are worth one harbour point and cities two. The first player to reach three harbour points takes the Harbormaster chip, worth two victory points, and keeps it until someone passes their total.",
  raiders:
    "Raiders threaten the coast. Every seven moves their counter forward by the number of cities on the board, and when it reaches fifteen they land on every coastal hex whose guards are fewer than its settlements and cities. A raided hex stops producing until a player pays an ore and a wool to rebuild it, which is worth a point. Guards cost an ore and a wool each and stand on a hex you touch; your castle, chosen during setup, is worth a point and can never be raided.",
  caravans:
    "Three oases are marked on the board. Settlements next to an oasis receive spice on its number instead of a resource, and spice pays to lead one of the three caravans along a road you just built next to its trail. Roads beside a caravan trail count double for the longest road, and settlements beside it produce one extra card when their hexes roll.",
  wagons:
    "Each player has a wagon that travels two road steps per turn along anyone's roads, one more per grain paid. Wagons load goods at cities and deliver them to another player's city for a point, with a second point when the goods match what that city is asking for. A wagon parked on a road blocks other wagons unless they pay it a resource to pass.",
};
const CROWN_SUMMARY =
  "Cities also yield commodities, which pay for city improvements and progress cards in place of development cards. Knights are pieces on the board: they chase the robber, block roads and defend against the barbarian fleet, which attacks whenever it reaches the shore and downgrades the cities of the weakest defenders. Usually played to thirteen points.";

/** A rule summary shown when its switch is on, or on demand with a small "rules" link. */
function RuleBlurb({ id, text, open }: { id: string; text: string; open: boolean }) {
  const [shown, setShown] = useState(false);
  if (!open && !shown)
    return (
      <button type="button" className="ml-1 text-[11px] text-ink-soft underline" onClick={() => setShown(true)} data-testid={`rules-${id}`}>
        rules
      </button>
    );
  return (
    <p className="mt-0.5 text-[11px] leading-snug text-ink-soft" data-testid={`rules-${id}`}>
      {text}
      {!open && (
        <button type="button" className="ml-1 underline" onClick={() => setShown(false)}>
          hide
        </button>
      )}
    </p>
  );
}

export function Editor({ initial, initialId, initialScenario = null }: { initial: BoardDefinition; initialId: string | null; initialScenario?: ScenarioSettings | null }) {
  const router = useRouter();
  const { session, loading: sessionLoading, configured } = useSession();
  const [settings] = useSettings();
  const [history, dispatchRaw] = useReducer(historyReduce, null, (): History => ({ past: [], present: initialEditorState(initial, initialId, initialScenario), future: [] }));
  const state = history.present;
  const dispatch = useCallback((a: EditorAction | { type: "undo" } | { type: "redo" }) => dispatchRaw(a), []);
  const [topDown, setTopDown] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const dragStart = useRef<{ at: HexCoord; shift: boolean; button: number } | null>(null);
  const quality = settings.quality === "auto" ? "medium" : settings.quality;

  const scenario = useMemo(() => toScenario(state), [state]);
  // A plain board is validated the way the game and the lobby validate it (islands need Tides); a scenario validates itself.
  const issues = useMemo(() => (scenario ? validateScenario(scenario) : validateBoard(state.def)), [scenario, state.def]);
  const islandList = useMemo(() => islandsOf(state.def), [state.def]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const islands = useMemo(() => landComponents(state.def).length, [state.def]);
  const tray = useMemo(() => tokenTray(state.def), [state.def]);
  const selectedHex = state.selected && !state.selected.includes("|") ? state.def.hexes.find((h) => `${h.at.q},${h.at.r}` === state.selected) : undefined;
  const selectedEdge = state.selected && state.selected.includes("|") ? state.selected : null;
  const seedRef = useRef(`${Date.now()}`);
  const [fishingDraft, setFishingDraft] = useState("");
  const rivers = useMemo(() => riverEdgesOf(state.def), [state.def]);
  const grounds = useMemo(() => fishingGroundsOf(state.def), [state.def]);
  const oases = useMemo(() => oasisCount(state.def), [state.def]);
  const selectedIsCoast = useMemo(() => (selectedEdge ? harborEdges(state.def).includes(selectedEdge) : false), [selectedEdge, state.def]);
  const selectedIsLand = useMemo(() => (selectedEdge ? landEdges(state.def).includes(selectedEdge) : false), [selectedEdge, state.def]);
  const selectedGround = selectedEdge ? fishingGroundAt(state.def, selectedEdge) : null;
  const scenarioSummaryText = scenario ? scenarioSummary(scenario) : null;

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
          dispatch({ type: "setCell", at, kind: erase ? null : state.frameKind });
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
        case "island": {
          const island = islandIndexOf(state.def, at);
          if (island !== null) dispatch({ type: "setScenario", scenario: { setup: "mainIslandOnly", mainIsland: island } });
          break;
        }
        case "oasis":
          if (!erase || isOasis(state.def.hexes.find((h) => h.at.q === at.q && h.at.r === at.r))) dispatch({ type: "toggleOasis", at });
          dispatch({ type: "select", id: `${at.q},${at.r}` });
          break;
        case "river":
        case "fishing":
          dispatch({ type: "select", id: `${at.q},${at.r}` });
          break;
        default: {
          const exhaustive: never = state.tool;
          throw new Error(String(exhaustive));
        }
      }
    },
    [dispatch, state.tool, state.frameKind, state.terrain, state.def],
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
      if (state.tool === "frame") dispatch({ type: "setCell", at, kind: d.button === 2 ? null : state.frameKind });
      else if (state.tool === "terrain") dispatch({ type: "paintTerrain", at, terrain: d.button === 2 ? null : state.terrain });
    },
    [dispatch, state.frameKind, state.terrain, state.tool],
  );
  const onCellUp = useCallback(
    (at: HexCoord | null) => {
      const d = dragStart.current;
      dragStart.current = null;
      if (!d || !d.shift || !at) return;
      const cells = rectangleCells(d.at, at);
      if (state.tool === "frame") dispatch({ type: "setCells", cells, kind: d.button === 2 ? null : state.frameKind });
      else if (state.tool === "terrain") for (const c of cells) dispatch({ type: "paintTerrain", at: c, terrain: d.button === 2 ? null : state.terrain });
    },
    [dispatch, state.frameKind, state.terrain, state.tool],
  );
  const onEdge = useCallback(
    (edge: EdgeId) => {
      if (state.tool === "river") dispatch({ type: "toggleRiver", edge });
      else if (state.tool === "fishing") dispatch({ type: "setFishingGround", edge, token: fishingGroundAt(state.def, edge) ? null : DEFAULT_FISHING_TOKEN });
      else dispatch({ type: "cycleHarbor", edge });
      dispatch({ type: "select", id: edge });
    },
    [dispatch, state.def, state.tool],
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
      else if (e.key.toLowerCase() === "l") dispatch({ type: "setFrameKind", kind: "land" });
      else if (e.key.toLowerCase() === "s") dispatch({ type: "setFrameKind", kind: "sea" });
      else if (e.key.toLowerCase() === "t") dispatch({ type: "setTool", tool: "token" });
      else if (e.key.toLowerCase() === "r") dispatch({ type: "setTool", tool: "river" });
      else if (e.key.toLowerCase() === "g") dispatch({ type: "setTool", tool: "fishing" });
      else if (e.key.toLowerCase() === "o") dispatch({ type: "setTool", tool: "oasis" });
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedHex) {
        if (state.tool === "frame") dispatch({ type: "setCell", at: selectedHex.at, kind: null });
        else if (state.tool === "token") dispatch({ type: "setToken", at: selectedHex.at, token: null });
        else if (state.tool === "oasis") {
          if (isOasis(selectedHex)) dispatch({ type: "toggleOasis", at: selectedHex.at });
        } else dispatch({ type: "paintTerrain", at: selectedHex.at, terrain: null });
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
        if (state.tool === "river") {
          if (riverEdgesOf(state.def).includes(selectedEdge)) dispatch({ type: "toggleRiver", edge: selectedEdge });
        } else if (state.tool === "fishing") dispatch({ type: "setFishingGround", edge: selectedEdge, token: null });
        else dispatch({ type: "setHarbor", edge: selectedEdge, harbor: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, selectedHex, selectedEdge, state.def, state.tool]);

  /** Where a save goes: the library when signed in, otherwise this device (with a nudge to sign in when an account is possible). */
  const deviceToast = (what: string) => (configured ? `${what} on this device only. Sign in to keep it in your library.` : `${what} on this device`);

  const save = async (asCopy: boolean) => {
    if (hasErrors(issues)) return setToast("Fix the errors before saving");
    // The session is looked up after the page loads; saving before that would silently make a device draft for a signed-in player.
    if (sessionLoading) return setToast("Checking your sign-in, try again in a moment");
    if (scenario) return saveScenario(asCopy, scenario);
    if (session) {
      const keepId = !asCopy && state.boardId && !isDraftId(state.boardId) ? state.boardId : undefined;
      const r = await saveBoardRemote(state.def, keepId ? { boardId: keepId, isPublic } : { isPublic });
      if (!r.ok) return setToast(errorText(r.code));
      if (state.boardId && isDraftId(state.boardId)) deleteDraft(state.boardId);
      dispatch({ type: "markSaved", boardId: r.boardId });
      setToast("Saved to your library");
      router.replace(`/boards/editor/${r.boardId}`);
      return;
    }
    const draft: StoredBoard = saveDraft(state.def, asCopy ? undefined : (state.boardId ?? undefined));
    dispatch({ type: "markSaved", boardId: draft.id });
    setToast(deviceToast("Saved"));
    router.replace(`/boards/editor/${draft.id}`);
  };

  const saveScenario = async (asCopy: boolean, sc: Scenario) => {
    if (session) {
      const keepId = !asCopy && state.boardId && !isScenarioDraftId(state.boardId) && !isDraftId(state.boardId) ? state.boardId : undefined;
      const r = await saveScenarioRemote(sc, keepId ? { scenarioId: keepId, isPublic } : { isPublic });
      if (!r.ok) return setToast(errorText(r.code));
      if (state.boardId && isScenarioDraftId(state.boardId)) deleteScenarioDraft(state.boardId);
      dispatch({ type: "markSaved", boardId: r.scenarioId });
      setToast("Scenario saved to your library");
      router.replace(`/boards/editor/${r.scenarioId}`);
      return;
    }
    const draft: StoredScenario = saveScenarioDraft(sc, asCopy ? undefined : (state.boardId ?? undefined));
    dispatch({ type: "markSaved", boardId: draft.id });
    setToast(deviceToast("Scenario saved"));
    router.replace(`/boards/editor/${draft.id}`);
  };

  const testPlay = () => {
    if (hasErrors(issues)) return setToast("Fix the errors before playing");
    const seats = Math.min(4, state.def.seats.max);
    const names = ["Ada", "Bo", "Cy", "Di"];
    startHotseat({
      players: names.slice(0, seats).map((name, i) => (i === 0 ? { id: `p${i + 1}-${name.toLowerCase()}`, name } : { id: `p${i + 1}-${name.toLowerCase()}`, name, bot: "medium" as const })),
      board: state.def,
      ...(scenario ? { scenario } : {}),
      seed: `test-${Date.now().toString(36)}`,
    });
    router.push("/play");
  };

  const setScenario = (patch: Partial<ScenarioSettings> | null) => dispatch({ type: "setScenario", scenario: patch });
  const setVariant = (name: VariantName, on: boolean) => {
    const current = state.scenario?.variants ?? DEFAULT_SCENARIO.variants;
    setScenario({ variants: { ...current, [name]: on } });
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
                  ["river", "River (R)"],
                  ["fishing", "Fishing ground (G)"],
                  ["oasis", "Oasis (O)"],
                  ...(state.scenario ? [["island", "Main island"]] : []),
                ] as [Tool, string][]
              ).map(([t, label]) => (
                <Button key={t} size="sm" variant={state.tool === t ? "primary" : "secondary"} onClick={() => dispatch({ type: "setTool", tool: t })} data-testid={`tool-${t}`}>
                  {label}
                </Button>
              ))}
            </div>
            {state.tool === "frame" && (
              <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Frame brush">
                {(
                  [
                    ["land", "Land (L)"],
                    ["sea", "Sea (S)"],
                    ["frame", "Frame"],
                  ] as [HexKind, string][]
                ).map(([k, label]) => (
                  <Button key={k} size="sm" role="radio" aria-checked={state.frameKind === k} variant={state.frameKind === k ? "primary" : "secondary"} onClick={() => dispatch({ type: "setFrameKind", kind: k })} data-testid={`brush-${k}`}>
                    {label}
                  </Button>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-ink-soft">
              {state.tool === "frame" && `Click or drag to paint ${state.frameKind === "land" ? "land" : state.frameKind === "sea" ? "sea" : "frame (the border)"}. Right-click or right-drag clears. Shift-drag: a rectangle.`}
              {state.tool === "terrain" && "Click or drag to paint a terrain; empty and sea cells become land. Right-click clears the terrain."}
              {state.tool === "token" && "Click a hex, then type its number in the inspector."}
              {state.tool === "harbor" && "Click a coastal edge to cycle 3:1 → 2:1 …"}
              {state.tool === "island" && "Click a hex to make its island the starting island."}
              {state.tool === "river" && "Click an edge beside land to lay or lift a river segment (Rivers variant)."}
              {state.tool === "fishing" && `Click a coastal edge to add a fishing ground (token ${DEFAULT_FISHING_TOKEN}); set its number in the inspector. Click again to remove it.`}
              {state.tool === "oasis" && "Click a land hex to mark or unmark an oasis (Caravans variant)."}
            </p>
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Terrain (1–{TERRAINS.length})</h2>
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
            <h2 className="font-display text-sm font-semibold text-ink-soft">Markers</h2>
            <p className="mt-1 text-xs text-ink-soft">Rivers, fishing grounds and oases only matter with their variant on.</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" variant="quiet" disabled={rivers.length === 0 && grounds.length === 0} onClick={() => dispatch({ type: "clearLayer", layer: "edges" })} data-testid="clear-edges">
                Clear rivers &amp; grounds
              </Button>
              <Button size="sm" variant="quiet" disabled={oases === 0} onClick={() => dispatch({ type: "clearLayer", layer: "oases" })} data-testid="clear-oases">
                Clear oases
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
                    {selectedHex.terrain !== "wasteland" && selectedHex.terrain !== "lake" && (
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
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={isOasis(selectedHex)} onChange={() => dispatch({ type: "toggleOasis", at: selectedHex.at })} data-testid="inspector-oasis" /> Oasis (Caravans)
                    </label>
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
                  {selectedIsCoast ? " · coast" : selectedIsLand ? " · inland" : " · off the land"}
                </p>
                {selectedIsCoast && (
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
                )}
                {selectedIsLand && (
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={rivers.includes(selectedEdge)} onChange={() => dispatch({ type: "toggleRiver", edge: selectedEdge })} data-testid="inspector-river" /> River segment (Rivers)
                  </label>
                )}
                {selectedIsCoast && (
                  <form
                    className="flex flex-wrap items-center gap-1"
                    data-testid="inspector-fishing"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = Number(fishingDraft);
                      if (Number.isInteger(n) && n >= 2 && n <= 12 && n !== 7) dispatch({ type: "setFishingGround", edge: selectedEdge, token: n });
                      setFishingDraft("");
                    }}
                  >
                    <label className="text-xs">
                      Fishing ground
                      <input className="ml-1 w-14 rounded-md border border-line bg-white/60 px-1 py-0.5" value={fishingDraft} placeholder={selectedGround ? String(selectedGround.token) : "2–12"} inputMode="numeric" onChange={(e) => setFishingDraft(e.target.value)} data-testid="fishing-token-input" />
                    </label>
                    <Button size="sm" type="submit">
                      Set
                    </Button>
                    {selectedGround ? (
                      <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "setFishingGround", edge: selectedEdge, token: null })} data-testid="fishing-remove">
                        Remove
                      </Button>
                    ) : (
                      <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "setFishingGround", edge: selectedEdge, token: DEFAULT_FISHING_TOKEN })} data-testid="fishing-add">
                        Add ({DEFAULT_FISHING_TOKEN})
                      </Button>
                    )}
                  </form>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-soft">Click a cell or, with the harbour, fishing or river tool, an edge.</p>
            )}
          </div>
          <div data-testid="scenario-tab">
            <h2 className="font-display text-sm font-semibold text-ink-soft">Scenario</h2>
            {!state.scenario ? (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-ink-soft">A plain board. Turn it into a scenario for ships, gold, islands, Crown &amp; Castle, the Wayfarers variants and a custom goal.</p>
                <Button size="sm" onClick={() => setScenario({ ...DEFAULT_SCENARIO })} data-testid="scenario-on">
                  Make it a scenario
                </Button>
              </div>
            ) : (
              <div className="mt-1 space-y-1.5 text-xs">
                {scenarioSummaryText && (
                  <p className="font-medium" data-testid="scenario-summary">
                    {scenarioSummaryText}
                  </p>
                )}
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={state.scenario.tides} onChange={(e) => setScenario({ tides: e.target.checked })} data-testid="scenario-tides" /> Tides: ships, sea play, gold fields
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={state.scenario.pirate} disabled={!state.scenario.tides} onChange={(e) => setScenario({ pirate: e.target.checked })} data-testid="scenario-pirate" /> Pirate
                </label>
                <label className="flex items-center gap-1">
                  Island bonus
                  <input type="number" min={0} max={5} className="w-12 rounded-md border border-line bg-white/60 px-1 py-0.5" value={state.scenario.islandBonus} disabled={!state.scenario.tides} onChange={(e) => setScenario({ islandBonus: Number(e.target.value) })} data-testid="scenario-island-bonus" /> points per new island
                </label>
                <label className="flex items-center gap-1">
                  Points to win
                  <input type="number" min={3} max={30} className="w-12 rounded-md border border-line bg-white/60 px-1 py-0.5" value={state.scenario.victoryPoints} onChange={(e) => setScenario({ victoryPoints: Number(e.target.value) })} data-testid="scenario-vp" />
                </label>
                <label className="flex items-center gap-1">
                  Setup
                  <select className="rounded-md border border-line bg-white/60 px-1 py-0.5" value={state.scenario.setup} onChange={(e) => setScenario({ setup: e.target.value as ScenarioSettings["setup"], ...(e.target.value === "mainIslandOnly" && state.scenario?.mainIsland === null ? { mainIsland: 0 } : {}) })} data-testid="scenario-setup">
                    <option value="standard">Anywhere</option>
                    <option value="mainIslandOnly">Main island only</option>
                  </select>
                </label>
                {state.scenario.setup === "mainIslandOnly" && (
                  <div className="flex flex-wrap items-center gap-1" data-testid="scenario-islands">
                    Main island:
                    {islandList.map((comp, i) => (
                      <Button key={i} size="sm" variant={state.scenario?.mainIsland === i ? "primary" : "secondary"} onClick={() => setScenario({ mainIsland: i })} data-testid={`scenario-island-${i}`}>
                        {i + 1} ({comp.length})
                      </Button>
                    ))}
                    <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "setTool", tool: "island" })}>
                      Pick on board
                    </Button>
                  </div>
                )}
                <div>
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={state.scenario.crown} onChange={(e) => setScenario({ crown: e.target.checked })} data-testid="scenario-crown" /> Crown &amp; Castle
                  </label>
                  <RuleBlurb id="crown" text={CROWN_SUMMARY} open={state.scenario.crown} />
                </div>
                <div data-testid="scenario-variants">
                  <h3 className="font-semibold text-ink-soft">Variants</h3>
                  {VARIANT_NAMES.map((v) => (
                    <div key={v}>
                      <label className="inline-flex items-center gap-1">
                        <input type="checkbox" checked={state.scenario?.variants[v] === true} onChange={(e) => setVariant(v, e.target.checked)} data-testid={`scenario-variant-${v}`} /> {VARIANT_LABEL[v]}
                      </label>
                      <RuleBlurb id={v} text={VARIANT_SUMMARY[v]} open={state.scenario?.variants[v] === true} />
                    </div>
                  ))}
                </div>
                <label className="block">
                  Special rules (one per line)
                  <textarea className="mt-0.5 w-full rounded-md border border-line bg-white/60 px-1 py-0.5" rows={2} value={state.scenario.specialRules} onChange={(e) => setScenario({ specialRules: e.target.value })} data-testid="scenario-rules" />
                </label>
                <Button size="sm" variant="quiet" onClick={() => setScenario(null)} data-testid="scenario-off">
                  Back to a plain board
                </Button>
              </div>
            )}
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Board</h2>
            <p className="mt-1 text-xs text-ink-soft" data-testid="board-stats">
              {state.def.hexes.filter((h) => h.kind === "land").length} land · {state.def.hexes.filter((h) => h.kind === "sea").length} sea · {state.def.harbors.length} harbours · {islands} island{islands === 1 ? "" : "s"}
              {rivers.length > 0 && ` · ${rivers.length} river${rivers.length === 1 ? "" : "s"}`}
              {grounds.length > 0 && ` · ${grounds.length} fishing ground${grounds.length === 1 ? "" : "s"}`}
              {oases > 0 && ` · ${oases} oas${oases === 1 ? "is" : "es"}`}
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
