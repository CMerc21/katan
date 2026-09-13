"use client";

/**
 * Board picker (docs/phase8.md §4.4): the built-in frames, drafts from this
 * browser, and saved boards (yours and public) as thumbnails. Used by the
 * hotseat form and the create-lobby form.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BUILT_IN_BOARD_IDS,
  BUILT_IN_SCENARIO_IDS,
  builtInBoard,
  builtInScenario,
  scenarioSummary,
  createRng,
  hasErrors,
  resolveBoard,
  validateBoard,
  validateScenario,
  type Board,
  type BoardDefinition,
  type BuiltInBoardId,
  type BuiltInScenarioId,
  type Scenario,
} from "@katan/engine";
import { BoardThumbnail } from "@/board2d/Thumbnail";
import { loadDrafts, loadSavedBoards, loadSavedScenarios, loadScenarioDrafts, type StoredBoard, type StoredScenario } from "@/editor/storage";

export type BoardChoice =
  | { readonly kind: "builtin"; readonly id: BuiltInBoardId }
  | { readonly kind: "stored"; readonly board: StoredBoard }
  | { readonly kind: "scenario"; readonly id: BuiltInScenarioId }
  | { readonly kind: "storedScenario"; readonly scenario: StoredScenario };

export const BUILT_IN_LABEL: Record<BuiltInBoardId, string> = { beginner: "Beginner", random: "Random", large: "Large", longStrip: "Long strip", ring: "Ring" };
const BUILT_IN_BLURB: Record<BuiltInBoardId, string> = {
  beginner: "The fixed starter layout.",
  random: "Standard shape, shuffled at start.",
  large: "30 hexes for 5–6 players.",
  longStrip: "A long table for 5–6 players.",
  ring: "Land around an inner sea.",
};

/** The scenario a choice carries, or null for a plain board. */
export function choiceScenario(choice: BoardChoice): Scenario | null {
  if (choice.kind === "scenario") return builtInScenario(choice.id);
  if (choice.kind === "storedScenario") return choice.scenario.scenario;
  return null;
}

export function choiceDefinition(choice: BoardChoice): BoardDefinition {
  switch (choice.kind) {
    case "builtin":
      return builtInBoard(choice.id);
    case "stored":
      return choice.board.definition;
    case "scenario":
      return builtInScenario(choice.id).board;
    case "storedScenario":
      return choice.scenario.scenario.board;
    default: {
      const exhaustive: never = choice;
      throw new Error(String(exhaustive));
    }
  }
}

export function choiceKey(choice: BoardChoice): string {
  switch (choice.kind) {
    case "builtin":
      return `builtin:${choice.id}`;
    case "stored":
      return `${choice.board.source}:${choice.board.id}`;
    case "scenario":
      return `scenario:${choice.id}`;
    case "storedScenario":
      return `s${choice.scenario.source}:${choice.scenario.id}`;
    default: {
      const exhaustive: never = choice;
      throw new Error(String(exhaustive));
    }
  }
}

/** What the hotseat driver / `createGame` takes for this choice. */
export function choiceForGame(choice: BoardChoice): { board: "beginner" | "random" | BoardDefinition; scenario?: Scenario } {
  const scenario = choiceScenario(choice);
  if (scenario) return { board: scenario.board, scenario };
  if (choice.kind === "builtin" && (choice.id === "beginner" || choice.id === "random")) return { board: choice.id };
  return { board: choiceDefinition(choice) };
}

/** What the create-lobby Edge Function takes for this choice (docs/phase8.md §4.3, docs/phase9.md §5). */
export function choiceForLobby(choice: BoardChoice): string | { boardId: string } | { definition: BoardDefinition } | { scenarioId: string } | { scenario: Scenario } {
  switch (choice.kind) {
    case "builtin":
    case "scenario":
      return choice.id;
    case "stored":
      return choice.board.source === "saved" ? { boardId: choice.board.id } : { definition: choice.board.definition };
    case "storedScenario":
      return choice.scenario.source === "saved" ? { scenarioId: choice.scenario.id } : { scenario: choice.scenario.scenario };
    default: {
      const exhaustive: never = choice;
      throw new Error(String(exhaustive));
    }
  }
}

/** A resolved preview with a fixed seed, or null when the definition has errors. */
export function previewBoard(def: BoardDefinition, allowIslands = false): Board | null {
  if (hasErrors(validateBoard(def, { allowIslands }))) return null;
  try {
    return resolveBoard(def, createRng("preview", def.name), { allowIslands });
  } catch {
    return null;
  }
}

function previewOf(choice: BoardChoice): Board | null {
  const scenario = choiceScenario(choice);
  if (scenario) return hasErrors(validateScenario(scenario)) ? null : previewBoard(scenario.board, scenario.modules.tides === true);
  return previewBoard(choiceDefinition(choice));
}

function blurbOf(choice: BoardChoice): string {
  switch (choice.kind) {
    case "builtin":
      return BUILT_IN_BLURB[choice.id];
    case "scenario":
      return scenarioSummary(builtInScenario(choice.id));
    case "stored":
      return choice.board.source === "draft" ? "Draft on this device" : choice.board.isPublic ? "Public board" : "Your board";
    case "storedScenario":
      return `${choice.scenario.source === "draft" ? "Draft scenario" : choice.scenario.isPublic ? "Public scenario" : "Your scenario"} · ${scenarioSummary(choice.scenario.scenario)}`;
    default: {
      const exhaustive: never = choice;
      return String(exhaustive);
    }
  }
}

function nameOf(choice: BoardChoice): string {
  switch (choice.kind) {
    case "builtin":
      return BUILT_IN_LABEL[choice.id];
    case "scenario":
      return builtInScenario(choice.id).name;
    case "stored":
      return choice.board.name;
    case "storedScenario":
      return choice.scenario.name;
    default: {
      const exhaustive: never = choice;
      return String(exhaustive);
    }
  }
}

function Card({ choice, selected, onPick, testId }: { choice: BoardChoice; selected: boolean; onPick: () => void; testId: string }) {
  const def = choiceDefinition(choice);
  const board = useMemo(() => previewOf(choice), [choice]);
  const name = nameOf(choice);
  const blurb = blurbOf(choice);
  const tides = choiceScenario(choice)?.modules.tides === true;
  const playable = board !== null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!playable}
      title={playable ? undefined : "This board has errors; open it in the editor"}
      className={`flex w-40 flex-col items-center gap-1 rounded-md border p-2 text-left text-sm transition ${selected ? "border-ink bg-white/70 shadow" : "border-line bg-white/30 hover:bg-white/50"} disabled:opacity-50`}
      onClick={onPick}
      data-testid={testId}
      data-seats={def.seats.max}
      data-scenario={tides ? "tides" : undefined}
    >
      {board ? <BoardThumbnail board={board} size={128} showTokens={def.generation.tokens === "fixed"} /> : <div className="grid h-32 w-32 place-items-center text-xs text-ink-soft">Has errors</div>}
      <span className="w-full truncate font-medium" data-testid="board-card-name">
        {name}
        {tides && <span className="ml-1 rounded bg-ink px-1 text-[10px] uppercase tracking-wide text-parchment">Tides</span>}
      </span>
      <span className="w-full text-xs text-ink-soft">
        {blurb} · up to {def.seats.max}
      </span>
    </button>
  );
}

export function BoardPicker({ value, onChange, signedIn }: { value: BoardChoice; onChange: (choice: BoardChoice) => void; signedIn: boolean }) {
  const [drafts, setDrafts] = useState<StoredBoard[]>([]);
  const [saved, setSaved] = useState<StoredBoard[]>([]);
  const [scenarioDrafts, setScenarioDrafts] = useState<StoredScenario[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<StoredScenario[]>([]);
  useEffect(() => {
    setDrafts(loadDrafts());
    setScenarioDrafts(loadScenarioDrafts());
  }, []);
  useEffect(() => {
    if (!signedIn) {
      setSaved([]);
      setSavedScenarios([]);
      return;
    }
    let alive = true;
    loadSavedBoards()
      .then((rows) => alive && setSaved(rows))
      .catch(() => alive && setSaved([]));
    loadSavedScenarios()
      .then((rows) => alive && setSavedScenarios(rows))
      .catch(() => alive && setSavedScenarios([]));
    return () => {
      alive = false;
    };
  }, [signedIn]);
  const key = choiceKey(value);
  const stored = [...drafts, ...saved];
  const storedScenarios = [...scenarioDrafts, ...savedScenarios];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Board">
        {BUILT_IN_BOARD_IDS.map((id) => (
          <Card key={id} choice={{ kind: "builtin", id }} selected={key === `builtin:${id}`} onPick={() => onChange({ kind: "builtin", id })} testId={`board-${id}`} />
        ))}
        {stored.map((b) => (
          <Card key={`${b.source}:${b.id}`} choice={{ kind: "stored", board: b }} selected={key === `${b.source}:${b.id}`} onPick={() => onChange({ kind: "stored", board: b })} testId={`board-${b.source}-${b.id}`} />
        ))}
      </div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Scenarios (Tides)</h4>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Scenario">
        {BUILT_IN_SCENARIO_IDS.map((id) => (
          <Card key={id} choice={{ kind: "scenario", id }} selected={key === `scenario:${id}`} onPick={() => onChange({ kind: "scenario", id })} testId={`scenario-${id}`} />
        ))}
        {storedScenarios.map((sc) => (
          <Card key={`s${sc.source}:${sc.id}`} choice={{ kind: "storedScenario", scenario: sc }} selected={key === `s${sc.source}:${sc.id}`} onPick={() => onChange({ kind: "storedScenario", scenario: sc })} testId={`scenario-${sc.source}-${sc.id}`} />
        ))}
      </div>
      <p className="text-xs text-ink-soft">
        Want another shape?{" "}
        <Link className="underline" href="/boards">
          Open the board editor
        </Link>
        .
      </p>
    </div>
  );
}
