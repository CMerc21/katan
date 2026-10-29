"use client";

/**
 * The board editor (docs/phase8.md §4, docs/phase14.md §2): tools and
 * collapsible sections on the left (shape, terrain, symmetry, game setup,
 * tokens and harbours, face-down tiles, markers, templates), the 3D canvas
 * in the centre, inspector, validation and the Scenario section on the
 * right, name / undo / view / Save / Save as / Test play on top. Keys: 1–8
 * terrains, F shape, L land, S sea, T token, H harbour, D face-down, R
 * river, G fishing ground, O oasis, Del clears the active tool's layer,
 * Ctrl+Z/Y. Unsaved work is guarded (leaving asks; Test play keeps a
 * recovery copy that the editor restores on return).
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BUILT_IN_BOARD_IDS, RESOURCES, TERRAINS, discoveryPoolFor, hasErrors, landComponents, poolHexes, validateBoard, type BoardDefinition, type DiscoverKind, type EdgeId, type HexCoord, type HexKind, type Terrain } from "@katan/engine";
import { Button } from "@/components/ui";
import { errorText } from "@/game/labels";
import { VARIANT_LABEL, VARIANT_NAMES, scenarioSummary, validateScenario, type Scenario, type VariantName } from "@katan/engine";
import { startHotseat } from "@/game/store";
import { TERRAIN_FILL } from "@/game/theme";
import { useSettings } from "@/game/settings";
import { useSession } from "@/hooks/useSession";
import { DEFAULT_FISHING_TOKEN, DEFAULT_SCENARIO, TEMPLATE_LABEL, discoverCount, discoverOf, fishingGroundAt, fishingGroundsOf, harborEdges, harborKindOf, historyReduce, initialEditorState, isOasis, islandIndexOf, islandsOf, landEdges, oasisCount, rectangleCells, riverEdgesOf, tokenTray, toScenario, type EditorAction, type History, type SavedMeta, type ScenarioSettings, type Symmetry, type Tool } from "./model";
import { deleteDraft, deleteScenarioDraft, isDraftId, isScenarioDraftId, saveBoardRemote, saveDraft, saveScenarioDraft, saveScenarioRemote, type StoredBoard, type StoredScenario } from "./storage";

const EditorCanvas = dynamic(() => import("./EditorCanvas").then((m) => m.EditorCanvas), { ssr: false, loading: () => <div className="grid h-full place-items-center text-parchment/70">Laying out the table…</div> });

const TERRAIN_LABEL: Record<Terrain, string> = { forest: "Forest", claypit: "Clay pit", meadow: "Meadow", farmland: "Farmland", mountain: "Mountain", wasteland: "Wasteland", gold: "Gold", lake: "Lake" };
const TEST_NAMES = ["Ada", "Bo", "Cy", "Di", "Eve", "Fay"];
/** Test play leaves a copy of the board here so coming back from the game restores unsaved work. */
const RECOVERY_KEY = "katan.editor.recovery";

interface Recovery {
  readonly forId: string | null;
  readonly def: BoardDefinition;
  readonly scenario: ScenarioSettings | null;
}

function readRecovery(forId: string | null): Recovery | null {
  try {
    const raw = window.sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Recovery;
    return r.forId === forId && r.def && Array.isArray(r.def.hexes) ? r : null;
  } catch {
    return null;
  }
}

function writeRecovery(r: Recovery | null): void {
  try {
    if (r) window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(r));
    else window.sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* private mode: no recovery */
  }
}

/**
 * A number typed freely and clamped only when it is committed (blur or
 * Enter): clamping each keystroke turned "12" into 30 on the way.
 */
function NumberField({ value, min, max, onCommit, disabled, testId, label }: { value: number; min: number; max: number; onCommit: (n: number) => void; disabled?: boolean; testId: string; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, Math.round(n))));
    setDraft(null);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      aria-label={label}
      className="w-14 rounded-md border border-line bg-white/60 px-1 py-0.5"
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      data-testid={testId}
    />
  );
}

/** A sidebar section that folds away, so the palette fits a laptop screen. */
function Section({ title, children, defaultOpen = true, testId, aside }: { title: string; children: React.ReactNode; defaultOpen?: boolean; testId?: string; aside?: React.ReactNode }) {
  return (
    <details className="group border-b border-line/70 pb-2 last:border-0" open={defaultOpen} data-testid={testId}>
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 py-0.5 font-display text-sm font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
        <span>
          <span aria-hidden className="mr-1 inline-block w-3 text-[10px] transition-transform group-open:rotate-90">
            ▶
          </span>
          {title}
        </span>
        {aside}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

const GENERATION_HELP = {
  terrain: { fixed: "Every land hex needs a painted terrain.", shuffle: "Unpainted land hexes get a random terrain each game." },
  tokens: { fixed: "Numbers exactly as placed; every producing hex needs one.", shuffle: "Placed numbers stay; the rest are dealt at random (no 6 next to 8).", balanced: "Placed numbers stay; the rest are dealt for a fair spread." },
  harbors: { fixed: "Harbours exactly as placed.", shuffle: "Harbour spots stay; their types are drawn each game." },
} as const;

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

export function Editor({
  initial,
  initialId,
  initialScenario = null,
  initialMeta = null,
  onSaved,
}: {
  initial: BoardDefinition;
  initialId: string | null;
  initialScenario?: ScenarioSettings | null;
  initialMeta?: SavedMeta | null;
  /** Told the id a save moved the URL to, so the page does not reload the board the editor already holds. */
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const { session, loading: sessionLoading, configured } = useSession();
  const [settings] = useSettings();
  const [history, dispatchRaw] = useReducer(historyReduce, null, (): History => ({ past: [], present: initialEditorState(initial, initialId, initialScenario), future: [] }));
  const state = history.present;
  const dispatch = useCallback((a: EditorAction | { type: "undo" } | { type: "redo" }) => dispatchRaw(a), []);
  const [topDown, setTopDown] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(initialMeta?.isPublic ?? false);
  // Which table the open board was saved in (a board saved as a scenario must not send its board id, and back).
  const [savedKind, setSavedKind] = useState<SavedMeta["kind"] | null>(initialMeta?.kind ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(initialMeta?.ownerId ?? null);
  const [saving, setSaving] = useState(false);
  const validationRef = useRef<HTMLDivElement>(null);
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

  // Back from a test play: put the unsaved board back.
  useEffect(() => {
    const r = readRecovery(initialId);
    if (!r) return;
    writeRecovery(null);
    dispatch({ type: "load", def: r.def, boardId: initialId, scenario: r.scenario });
    dispatch({ type: "setName", name: r.def.name });
    setToast("Restored the board you were testing");
  }, []);

  // Leaving with unsaved changes asks first (reload, closing the tab, typing another URL).
  useEffect(() => {
    if (!state.dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state.dirty]);

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
        case "oasis": {
          const h = state.def.hexes.find((x) => x.at.q === at.q && x.at.r === at.r);
          // An oasis needs a producing terrain (validation would refuse a wasteland or a lake).
          if (!erase && !isOasis(h) && (h?.terrain === "wasteland" || h?.terrain === "lake")) {
            setToast(`An oasis needs a producing terrain, not a ${h.terrain}`);
            break;
          }
          if (!erase || isOasis(h)) dispatch({ type: "toggleOasis", at });
          dispatch({ type: "select", id: `${at.q},${at.r}` });
          break;
        }
        case "discover": {
          const h = state.def.hexes.find((x) => x.at.q === at.q && x.at.r === at.r);
          if (!erase || h?.extras?.discover) dispatch({ type: "toggleDiscover", at });
          break;
        }
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
      else {
        // A harbour placed by hand keeps its type only when harbours are Fixed.
        if (state.def.generation.harbors !== "fixed") {
          dispatch({ type: "setGeneration", harbors: "fixed" });
          setToast("Harbours set to Fixed so the types you pick are kept");
        }
        dispatch({ type: "cycleHarbor", edge });
      }
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
      else if (e.key.toLowerCase() === "d") dispatch({ type: "setTool", tool: "discover" });
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedHex) {
        // Only the active tool's layer: the harbour or river tool must not wipe a hex's terrain.
        if (state.tool === "frame") dispatch({ type: "setCell", at: selectedHex.at, kind: null });
        else if (state.tool === "token") dispatch({ type: "setToken", at: selectedHex.at, token: null });
        else if (state.tool === "terrain") dispatch({ type: "paintTerrain", at: selectedHex.at, terrain: null });
        else if (state.tool === "oasis") {
          if (isOasis(selectedHex)) dispatch({ type: "toggleOasis", at: selectedHex.at });
        } else if (state.tool === "discover") {
          if (discoverOf(selectedHex)) dispatch({ type: "toggleDiscover", at: selectedHex.at });
        }
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

  /** After a save: remember where it went and move the URL there without reloading the editor. */
  const settle = (id: string, kind: SavedMeta["kind"], message: string) => {
    dispatch({ type: "markSaved", boardId: id });
    setSavedKind(kind);
    if (session) setOwnerId(session.user.id);
    setToast(message);
    writeRecovery(null);
    onSaved?.(id);
    // The editor lives in the /boards/editor layout, which survives this change of id (a page would remount
    // and lose the undo history, the tool and the camera); the page tells the layout not to reload what it holds.
    router.replace(`/boards/editor/${id}`);
  };

  const save = async (asCopy: boolean) => {
    if (saving) return;
    if (hasErrors(issues)) {
      validationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return setToast(`Fix ${errors.length === 1 ? "the error" : `the ${errors.length} errors`} before saving`);
    }
    // The session is looked up after the page loads; saving before that would silently make a device draft for a signed-in player.
    if (sessionLoading) return setToast("Checking your sign-in, try again in a moment");
    // Someone else's public board can only be saved as your own copy.
    const notMine = Boolean(session && ownerId && ownerId !== session.user.id && state.boardId && !isDraftId(state.boardId) && !isScenarioDraftId(state.boardId));
    const copy = asCopy || notMine;
    if (copy && state.boardId) dispatch({ type: "setName", name: `${state.def.name.replace(/ \(copy\)$/, "")} (copy)` });
    const name = copy && state.boardId ? `${state.def.name.replace(/ \(copy\)$/, "")} (copy)` : state.def.name;
    const def = { ...state.def, name };
    setSaving(true);
    try {
      if (scenario) await saveScenario(copy, { ...scenario, name, board: { ...scenario.board, name } }, notMine);
      else await saveBoard(copy, def, notMine);
    } finally {
      setSaving(false);
    }
  };

  const saveBoard = async (copy: boolean, def: BoardDefinition, notMine: boolean) => {
    const id = state.boardId;
    if (session) {
      const keepId = !copy && id && savedKind === "board" && !isDraftId(id) ? id : undefined;
      const r = await saveBoardRemote(def, keepId ? { boardId: keepId, isPublic } : { isPublic });
      if (!r.ok) return setToast(r.code === "INVALID_BOARD" && r.message ? r.message : r.code === "NOT_OWNER" ? "This board belongs to someone else: use Save as to keep your own copy" : errorText(r.code === "NETWORK" ? "SAVE_OFFLINE" : r.code));
      if (id && isDraftId(id)) deleteDraft(id);
      if (id && isScenarioDraftId(id)) deleteScenarioDraft(id); // it was a scenario until now
      return settle(r.boardId, "board", notMine ? "Saved your own copy to your library" : "Saved to your library");
    }
    const draft: StoredBoard = saveDraft(def, !copy && id && isDraftId(id) ? id : undefined);
    if (id && isScenarioDraftId(id)) deleteScenarioDraft(id);
    settle(draft.id, "board", deviceToast(copy ? "Copy saved" : "Saved"));
  };

  const saveScenario = async (copy: boolean, sc: Scenario, notMine: boolean) => {
    const id = state.boardId;
    if (session) {
      const keepId = !copy && id && savedKind === "scenario" && !isScenarioDraftId(id) && !isDraftId(id) ? id : undefined;
      const r = await saveScenarioRemote(sc, keepId ? { scenarioId: keepId, isPublic } : { isPublic });
      if (!r.ok) return setToast(r.code === "INVALID_BOARD" && r.message ? r.message : r.code === "NOT_OWNER" ? "This scenario belongs to someone else: use Save as to keep your own copy" : errorText(r.code === "NETWORK" ? "SAVE_OFFLINE" : r.code));
      if (id && isScenarioDraftId(id)) deleteScenarioDraft(id);
      if (id && isDraftId(id)) deleteDraft(id); // it was a plain board until now
      return settle(r.scenarioId, "scenario", notMine ? "Saved your own copy to your library" : "Scenario saved to your library");
    }
    const draft: StoredScenario = saveScenarioDraft(sc, !copy && id && isScenarioDraftId(id) ? id : undefined);
    if (id && isDraftId(id)) deleteDraft(id);
    settle(draft.id, "scenario", deviceToast(copy ? "Copy saved" : "Scenario saved"));
  };

  const testPlay = () => {
    if (hasErrors(issues)) {
      validationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return setToast("Fix the errors before playing");
    }
    // Every seat the board allows: you and bots.
    const seats = Math.min(TEST_NAMES.length, state.def.seats.max);
    writeRecovery(state.dirty ? { forId: state.boardId, def: state.def, scenario: state.scenario } : null);
    startHotseat({
      players: TEST_NAMES.slice(0, seats).map((name, i) => (i === 0 ? { id: `p${i + 1}-${name.toLowerCase()}`, name } : { id: `p${i + 1}-${name.toLowerCase()}`, name, bot: "medium" as const })),
      board: state.def,
      ...(scenario ? { scenario } : {}),
      seed: `test-${Date.now().toString(36)}`,
      returnTo: window.location.pathname,
    });
    router.push("/play");
  };

  const leave = () => {
    if (state.dirty && !window.confirm("Leave the editor? Your unsaved changes will be lost.")) return;
    router.push("/boards");
  };

  const loadTemplate = (id: (typeof BUILT_IN_BOARD_IDS)[number]) => {
    if (state.def.hexes.length > 0 && !window.confirm(`Replace this board with the ${TEMPLATE_LABEL[id]} template? (Undo brings it back.)`)) return;
    dispatch({ type: "loadTemplate", id });
  };

  const setScenario = (patch: Partial<ScenarioSettings> | null) => dispatch({ type: "setScenario", scenario: patch });
  const setVariant = (name: VariantName, on: boolean) => {
    const current = state.scenario?.variants ?? DEFAULT_SCENARIO.variants;
    if (name === "raiders" && on && state.scenario?.crown) setToast("Raiders and Crown & Castle both use knights, so Crown & Castle is off");
    setScenario({ variants: { ...current, [name]: on } });
  };
  const setCrown = (on: boolean) => {
    if (on && state.scenario?.variants.raiders) setToast("Crown & Castle and Raiders both use knights, so Raiders is off");
    setScenario({ crown: on });
  };

  const modeButton = <T extends string>(current: T, value: T, label: string, onPick: () => void, testId: string) => (
    <Button size="sm" variant={current === value ? "primary" : "secondary"} aria-pressed={current === value} onClick={onPick} data-testid={testId}>
      {label}
    </Button>
  );

  const land = state.def.hexes.filter((h) => h.kind === "land").length;
  const faceDown = discoverCount(state.def);
  const poolTiles = useMemo(() => poolHexes(state.def).length, [state.def]);
  const pool = useMemo(() => discoveryPoolFor(state.def), [state.def]);
  const poolCounts = useMemo(() => {
    const m = new Map<Terrain, number>();
    for (const t of pool.terrains) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [pool]);
  const setPoolCount = (t: Terrain, delta: 1 | -1) => {
    const list = [...pool.terrains];
    if (delta > 0) list.push(t);
    else {
      const k = list.lastIndexOf(t);
      if (k >= 0) list.splice(k, 1);
    }
    dispatch({ type: "setDiscoveryPool", terrains: list });
  };

  const toolButton = (t: Tool, label: string, key?: string) => (
    <Button key={t} size="sm" variant={state.tool === t ? "primary" : "secondary"} aria-pressed={state.tool === t} title={key ? `${label} (${key})` : label} onClick={() => dispatch({ type: "setTool", tool: t })} data-testid={`tool-${t}`}>
      {label}
      {key && <kbd className="ml-1 text-[10px] opacity-70">{key}</kbd>}
    </Button>
  );

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {/* Top bar: what the board is called, history, view, and getting it out of the editor. */}
      <header className="parchment flex flex-wrap items-center gap-2 px-3 py-2" data-testid="editor-top">
        <input className="w-52 rounded-md border border-line bg-white/60 px-2 py-1 font-display text-base" value={state.def.name} maxLength={40} aria-label="Board name" onChange={(e) => dispatch({ type: "setName", name: e.target.value })} data-testid="board-name" />
        <span className="flex items-center gap-1">
          <Button size="sm" variant="quiet" disabled={history.past.length === 0} onClick={() => dispatch({ type: "undo" })} data-testid="undo" title="Undo (Ctrl+Z)">
            Undo
          </Button>
          <Button size="sm" variant="quiet" disabled={history.future.length === 0} onClick={() => dispatch({ type: "redo" })} data-testid="redo" title="Redo (Ctrl+Y)">
            Redo
          </Button>
        </span>
        <span className="flex items-center rounded-md border border-line" role="radiogroup" aria-label="Camera">
          <button type="button" role="radio" aria-checked={topDown} className={`rounded-l-md px-2.5 py-1 text-sm ${topDown ? "bg-ink text-parchment" : "hover:bg-parchment-deep"}`} onClick={() => setTopDown(true)} data-testid="view-top">
            Top-down
          </button>
          <button type="button" role="radio" aria-checked={!topDown} className={`rounded-r-md px-2.5 py-1 text-sm ${!topDown ? "bg-ink text-parchment" : "hover:bg-parchment-deep"}`} onClick={() => setTopDown(false)} data-testid="toggle-view">
            Diorama
          </button>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {errors.length > 0 ? (
            <button type="button" className="rounded-md border border-clay/60 bg-clay/10 px-2 py-1 text-xs font-semibold text-clay" onClick={() => validationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} data-testid="error-count">
              {land === 0 ? "Paint some land to start" : `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix`}
            </button>
          ) : (
            <span className="text-xs text-ink-soft" data-testid="save-state">
              {state.dirty ? "Unsaved changes" : state.boardId ? "All changes saved" : ""}
            </span>
          )}
          {session && (
            <label className="flex items-center gap-1 text-xs" title="Public boards appear in everyone's picker">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} data-testid="is-public" /> Public
            </label>
          )}
          <Button size="sm" variant="primary" disabled={errors.length > 0 || saving} reason={saving ? "Saving…" : "Fix the problems listed under Validation first"} onClick={() => void save(false)} data-testid="save">
            {saving ? "Saving…" : `Save${state.dirty ? "*" : ""}`}
          </Button>
          <Button size="sm" disabled={errors.length > 0 || saving} reason="Fix the problems listed under Validation first" onClick={() => void save(true)} data-testid="save-as">
            Save as copy
          </Button>
          <Button size="sm" disabled={errors.length > 0} reason="Fix the problems listed under Validation first" onClick={testPlay} data-testid="test-play" title="Play it now with bots; you come back here when you leave the table">
            Test play
          </Button>
          <Button size="sm" variant="quiet" onClick={leave} data-testid="editor-boards">
            Boards
          </Button>
        </span>
      </header>

      <div className="grid min-h-0 grid-cols-[14.5rem_minmax(0,1fr)_17.5rem]">
        {/* Palette */}
        <aside className="parchment flex min-h-0 flex-col gap-2 overflow-y-auto p-3 text-sm" aria-label="Tools">
          <Section title="Tool" testId="section-tool">
            <div className="flex flex-wrap gap-1">
              {toolButton("frame", "Shape", "F")}
              {toolButton("terrain", "Terrain", "1–8")}
              {toolButton("token", "Number", "T")}
              {toolButton("harbor", "Harbour", "H")}
              {toolButton("discover", "Face-down", "D")}
              {state.scenario && toolButton("island", "Main island")}
            </div>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Wayfarers markers</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {toolButton("river", "River", "R")}
              {toolButton("fishing", "Fishing", "G")}
              {toolButton("oasis", "Oasis", "O")}
            </div>
            {state.tool === "frame" && (
              <div className="mt-1.5 flex gap-1" role="radiogroup" aria-label="Shape brush">
                {(
                  [
                    ["land", "Land", "L"],
                    ["sea", "Sea", "S"],
                    ["frame", "Border", ""],
                  ] as [HexKind, string, string][]
                ).map(([k, label, key]) => (
                  <Button key={k} size="sm" role="radio" aria-checked={state.frameKind === k} variant={state.frameKind === k ? "primary" : "secondary"} onClick={() => dispatch({ type: "setFrameKind", kind: k })} data-testid={`brush-${k}`}>
                    {label}
                    {key && <kbd className="ml-1 text-[10px] opacity-70">{key}</kbd>}
                  </Button>
                ))}
              </div>
            )}
            {state.tool === "discover" && (
              <div className="mt-1.5 flex gap-1" role="radiogroup" aria-label="Face-down brush">
                {(
                  [
                    ["tile", "This tile"],
                    ["pool", "From the pool"],
                  ] as [DiscoverKind, string][]
                ).map(([k, label]) => (
                  <Button key={k} size="sm" role="radio" aria-checked={state.discoverKind === k} variant={state.discoverKind === k ? "primary" : "secondary"} onClick={() => dispatch({ type: "setDiscoverKind", kind: k })} data-testid={`discover-${k}`}>
                    {label}
                  </Button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs leading-snug text-ink-soft" data-testid="tool-hint">
              {state.tool === "frame" && `Click or drag to paint ${state.frameKind === "land" ? "land" : state.frameKind === "sea" ? "sea" : "the border (the table's wooden edge)"}. Right-click or right-drag erases. Shift-drag paints a rectangle.`}
              {state.tool === "terrain" && `Click or drag to paint ${TERRAIN_LABEL[state.terrain].toLowerCase()}; empty and sea cells become land. Right-click clears the terrain.`}
              {state.tool === "token" && "Click a hex, then type its number in the inspector on the right."}
              {state.tool === "harbor" && "Click a coastal edge to cycle 3:1 → 2:1 for each resource → none."}
              {state.tool === "island" && "Click a hex to make its island the starting island."}
              {state.tool === "river" && "Click an edge beside land to lay or lift a river segment (Rivers variant)."}
              {state.tool === "fishing" && `Click a coastal edge to add a fishing ground (number ${DEFAULT_FISHING_TOKEN}); change its number in the inspector. Click again to remove it.`}
              {state.tool === "oasis" && "Click a land hex to mark or unmark an oasis (Caravans variant)."}
              {state.tool === "discover" &&
                (state.discoverKind === "tile"
                  ? "Click a land hex to start it face down. Players see its terrain and number when a road, ship or settlement touches one of its corners; the builder takes one of its resource."
                  : "Click a land hex to make it a face-down tile drawn from the discovery pool (below). It loses its own terrain and number.")}
            </p>
          </Section>

          <Section title={`Terrain (1–${TERRAINS.length})`} testId="section-terrain">
            <div className="grid grid-cols-2 gap-1">
              {TERRAINS.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={state.tool === "terrain" && state.terrain === t}
                  className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs ${state.tool === "terrain" && state.terrain === t ? "border-ink bg-white/60 ring-1 ring-ink" : "border-line hover:bg-white/40"}`}
                  onClick={() => dispatch({ type: "setTerrain", terrain: t })}
                  data-testid={`terrain-${t}`}
                >
                  <span className="inline-block h-4 w-4 shrink-0 rounded-sm border border-ink/40" style={{ background: TERRAIN_FILL[t] }} />
                  <kbd className="text-[10px] text-ink-soft">{i + 1}</kbd> {TERRAIN_LABEL[t]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Symmetry" testId="section-symmetry">
            <div className="flex gap-1">
              {(["none", "mirror", "rotate"] as Symmetry[]).map((sym) => (
                <Button key={sym} size="sm" aria-pressed={state.symmetry === sym} variant={state.symmetry === sym ? "primary" : "secondary"} onClick={() => dispatch({ type: "setSymmetry", symmetry: sym })} data-testid={`symmetry-${sym}`}>
                  {sym === "none" ? "Off" : sym === "mirror" ? "Mirror" : "Rotate"}
                </Button>
              ))}
            </div>
            {state.symmetry !== "none" && <p className="mt-1 text-[11px] text-ink-soft">{state.symmetry === "mirror" ? "Every edit is copied to the left–right mirror cell." : "Every edit is copied to the six rotations around the centre."}</p>}
          </Section>

          <Section title="Game setup" testId="section-setup">
            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-1.5">
                Seats up to
                <select className="rounded-md border border-line bg-white/60 px-1 py-0.5" value={state.def.seats.max} onChange={(e) => dispatch({ type: "setSeats", max: Number(e.target.value) as 4 | 5 | 6 })} data-testid="seats-max">
                  {[4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="w-14 font-semibold">Terrain</span>
                  {modeButton(state.def.generation.terrain, "fixed", "Fixed", () => dispatch({ type: "setGeneration", terrain: "fixed" }), "gen-terrain-fixed")}
                  {modeButton(state.def.generation.terrain, "shuffle", "Shuffle", () => dispatch({ type: "setGeneration", terrain: "shuffle" }), "gen-terrain-shuffle")}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-soft">{GENERATION_HELP.terrain[state.def.generation.terrain]}</p>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="w-14 font-semibold">Numbers</span>
                  {modeButton(state.def.generation.tokens, "fixed", "Fixed", () => dispatch({ type: "setGeneration", tokens: "fixed" }), "gen-tokens-fixed")}
                  {modeButton(state.def.generation.tokens, "shuffle", "Shuffle", () => dispatch({ type: "setGeneration", tokens: "shuffle" }), "gen-tokens-shuffle")}
                  {modeButton(state.def.generation.tokens, "balanced", "Balanced", () => dispatch({ type: "setGeneration", tokens: "balanced" }), "gen-tokens-balanced")}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-soft">{GENERATION_HELP.tokens[state.def.generation.tokens]}</p>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="w-14 font-semibold">Harbours</span>
                  {modeButton(state.def.generation.harbors, "fixed", "Fixed", () => dispatch({ type: "setGeneration", harbors: "fixed" }), "gen-harbors-fixed")}
                  {modeButton(state.def.generation.harbors, "shuffle", "Shuffle", () => dispatch({ type: "setGeneration", harbors: "shuffle" }), "gen-harbors-shuffle")}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-soft">{GENERATION_HELP.harbors[state.def.generation.harbors]}</p>
              </div>
            </div>
          </Section>

          <Section title="Numbers and harbours" testId="section-fill">
            <div className="flex flex-wrap gap-1" aria-label="Number tray">
              {tray.map((t) => (
                <span key={t.token} className={`rounded border px-1 text-xs tabular-nums ${t.left > 0 ? "border-ink bg-white/60" : t.left < 0 ? "border-clay text-clay" : "border-line text-ink-soft"}`} title={`${t.left} left to place`}>
                  {t.token}
                  <span className="text-[10px]">×{t.left}</span>
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button size="sm" onClick={() => dispatch({ type: "autoFillTokens", seed: `${seedRef.current}-${history.past.length}` })} data-testid="auto-tokens" title="Deal a fair set of numbers and fix them in place">
                Auto-fill numbers
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  dispatch({ type: "clearLayer", layer: "tokens" });
                  setToast("Numbers cleared (Undo brings them back)");
                }}
              >
                Clear
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button size="sm" onClick={() => dispatch({ type: "autoPlaceHarbors", seed: `${seedRef.current}-${history.past.length}` })} data-testid="auto-harbors">
                Auto-place harbours
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  dispatch({ type: "clearLayer", layer: "harbors" });
                  setToast("Harbours cleared (Undo brings them back)");
                }}
              >
                Clear
              </Button>
            </div>
          </Section>

          <Section title="Face-down tiles" defaultOpen={faceDown > 0 || state.tool === "discover"} testId="section-discovery" aside={faceDown > 0 ? <span className="text-xs font-normal">{faceDown}</span> : undefined}>
            <p className="text-[11px] leading-snug text-ink-soft">
              Tiles that start face down and turn over when a road, ship or settlement touches a corner; the builder takes one of the tile&apos;s resource (gold: their choice).
            </p>
            {poolTiles > 0 && (
              <div className="mt-1.5" data-testid="discovery-pool">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">
                    Pool: {pool.terrains.length} for {poolTiles} tile{poolTiles === 1 ? "" : "s"}
                  </span>
                  <button type="button" className={`text-[11px] underline ${state.def.discovery ? "" : "opacity-50"}`} disabled={!state.def.discovery} onClick={() => dispatch({ type: "setDiscoveryPool", terrains: null })} data-testid="discovery-pool-auto">
                    {state.def.discovery ? "Back to automatic" : "Automatic"}
                  </button>
                </div>
                <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {TERRAINS.map((t) => (
                    <li key={t} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1">
                        <span className="inline-block h-3 w-3 rounded-sm border border-ink/40" style={{ background: TERRAIN_FILL[t] }} />
                        {TERRAIN_LABEL[t]}
                      </span>
                      <span className="flex items-center">
                        <button type="button" className="rounded px-1 hover:bg-parchment-deep" aria-label={`One fewer ${TERRAIN_LABEL[t]}`} onClick={() => setPoolCount(t, -1)} disabled={!poolCounts.get(t)}>
                          −
                        </button>
                        <span className="w-4 text-center tabular-nums" data-testid={`pool-count-${t}`}>
                          {poolCounts.get(t) ?? 0}
                        </span>
                        <button type="button" className="rounded px-1 hover:bg-parchment-deep" aria-label={`One more ${TERRAIN_LABEL[t]}`} onClick={() => setPoolCount(t, 1)}>
                          +
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-0.5 text-[11px] text-ink-soft">Numbers for the pool are dealt automatically.</p>
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button size="sm" onClick={() => dispatch({ type: "setTool", tool: "discover" })}>
                Mark tiles
              </Button>
              <Button size="sm" variant="quiet" disabled={faceDown === 0} onClick={() => dispatch({ type: "clearLayer", layer: "discovery" })} data-testid="clear-discovery">
                Turn all face up
              </Button>
            </div>
          </Section>

          <Section title="Markers" defaultOpen={rivers.length + grounds.length + oases > 0} testId="section-markers">
            <p className="text-xs text-ink-soft">Rivers, fishing grounds and oases only matter with their variant on (Scenario, on the right).</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" variant="quiet" disabled={rivers.length === 0 && grounds.length === 0} onClick={() => dispatch({ type: "clearLayer", layer: "edges" })} data-testid="clear-edges">
                Clear rivers &amp; grounds
              </Button>
              <Button size="sm" variant="quiet" disabled={oases === 0} onClick={() => dispatch({ type: "clearLayer", layer: "oases" })} data-testid="clear-oases">
                Clear oases
              </Button>
            </div>
          </Section>

          <Section title="Templates" defaultOpen={state.def.hexes.length === 0} testId="section-templates">
            <div className="flex flex-wrap gap-1">
              {BUILT_IN_BOARD_IDS.map((id) => (
                <Button key={id} size="sm" variant="quiet" onClick={() => loadTemplate(id)} data-testid={`template-${id}`}>
                  {TEMPLATE_LABEL[id]}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-soft">Standard is the classic 19-hex island.</p>
          </Section>
        </aside>

        {/* Canvas */}
        <main className="relative min-h-0" aria-label="Board canvas">
          <EditorCanvas def={state.def} tool={state.tool} symmetry={state.symmetry} selected={state.selected} topDown={topDown} quality={quality} gridRadius={state.gridRadius} onCellDown={onCellDown} onCellDrag={onCellDrag} onCellUp={onCellUp} onEdge={onEdge} onSelect={(id) => dispatch({ type: "select", id })} />
          {state.def.hexes.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4" data-testid="editor-empty">
              <div className="parchment pointer-events-auto max-w-xl rounded-lg px-4 py-3 text-center text-sm shadow-lg">
                <p className="font-display font-semibold">An empty table</p>
                <p className="mt-0.5 text-xs text-ink-soft">Click or drag on the grid to paint land (Shape tool, L), then sea (S). Or start from a template:</p>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {BUILT_IN_BOARD_IDS.map((id) => (
                    <Button key={id} size="sm" onClick={() => loadTemplate(id)} data-testid={`empty-template-${id}`}>
                      {TEMPLATE_LABEL[id]}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
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
                          else if (tokenDraft.trim() !== "") setToast("Numbers are 2–12, never 7");
                          setTokenDraft("");
                          // Hand the keyboard back to the shortcuts.
                          (document.activeElement as HTMLElement | null)?.blur();
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
                    <label className="flex items-center gap-1 text-xs">
                      Starts
                      <select
                        className="rounded-md border border-line bg-white/60 px-1 py-0.5"
                        value={discoverOf(selectedHex) ?? "up"}
                        onChange={(e) => dispatch({ type: "setDiscover", at: selectedHex.at, kind: e.target.value === "up" ? null : (e.target.value as DiscoverKind) })}
                        data-testid="inspector-discover"
                      >
                        <option value="up">face up</option>
                        <option value="tile">face down (this tile)</option>
                        <option value="pool">face down (from the pool)</option>
                      </select>
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
                      (document.activeElement as HTMLElement | null)?.blur();
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
              <p className="mt-1 text-xs text-ink-soft">Click a hex to edit it here. With the harbour, fishing or river tool, click an edge.</p>
            )}
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-ink-soft">Board</h2>
            <p className="mt-1 text-xs text-ink-soft" data-testid="board-stats">
              {state.def.hexes.filter((h) => h.kind === "land").length} land · {state.def.hexes.filter((h) => h.kind === "sea").length} sea · {state.def.harbors.length} harbours · {islands} island{islands === 1 ? "" : "s"}
              {rivers.length > 0 && ` · ${rivers.length} river${rivers.length === 1 ? "" : "s"}`}
              {grounds.length > 0 && ` · ${grounds.length} fishing ground${grounds.length === 1 ? "" : "s"}`}
              {oases > 0 && ` · ${oases} oas${oases === 1 ? "is" : "es"}`}
              {faceDown > 0 && ` · ${faceDown} face-down`}
            </p>
          </div>
          <div ref={validationRef} className="scroll-mt-2">
            <h2 className="font-display text-sm font-semibold text-ink-soft">Validation</h2>
            <ul className="mt-1 space-y-1" data-testid="validation">
              {issues.length === 0 && <li className="text-xs text-wood">No problems: ready to save and play.</li>}
              {land === 0 && (
                <li className="rounded border border-line bg-white/40 px-1.5 py-1 text-xs" data-severity="hint">
                  An empty board. Paint at least 7 land hexes with the Shape tool, or start from a template.
                </li>
              )}
              {(land === 0 ? [] : errors).map((i, k) => (
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
                  <NumberField label="Island bonus" min={0} max={5} value={state.scenario.islandBonus} disabled={!state.scenario.tides} onCommit={(n) => setScenario({ islandBonus: n })} testId="scenario-island-bonus" /> points per new island
                </label>
                <label className="flex items-center gap-1">
                  Points to win
                  <NumberField label="Points to win" min={3} max={30} value={state.scenario.victoryPoints} onCommit={(n) => setScenario({ victoryPoints: n })} testId="scenario-vp" />
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
                    <input type="checkbox" checked={state.scenario.crown} onChange={(e) => setCrown(e.target.checked)} data-testid="scenario-crown" /> Crown &amp; Castle
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
