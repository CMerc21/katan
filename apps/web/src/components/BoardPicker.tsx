"use client";

/**
 * Board picker (docs/phase8.md §4.4): the built-in frames, drafts from this
 * browser, and saved boards (yours and public) as thumbnails. Used by the
 * hotseat form and the create-lobby form.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BUILT_IN_BOARD_IDS, builtInBoard, createRng, hasErrors, resolveBoard, validateBoard, type Board, type BoardDefinition, type BuiltInBoardId } from "@katan/engine";
import { BoardThumbnail } from "@/board2d/Thumbnail";
import { loadDrafts, loadSavedBoards, type StoredBoard } from "@/editor/storage";

export type BoardChoice = { readonly kind: "builtin"; readonly id: BuiltInBoardId } | { readonly kind: "stored"; readonly board: StoredBoard };

export const BUILT_IN_LABEL: Record<BuiltInBoardId, string> = { beginner: "Beginner", random: "Random", large: "Large", longStrip: "Long strip", ring: "Ring" };
const BUILT_IN_BLURB: Record<BuiltInBoardId, string> = {
  beginner: "The fixed starter layout.",
  random: "Standard shape, shuffled at start.",
  large: "30 hexes for 5–6 players.",
  longStrip: "A long table for 5–6 players.",
  ring: "Land around an inner sea.",
};

export function choiceDefinition(choice: BoardChoice): BoardDefinition {
  return choice.kind === "builtin" ? builtInBoard(choice.id) : choice.board.definition;
}

export function choiceKey(choice: BoardChoice): string {
  return choice.kind === "builtin" ? `builtin:${choice.id}` : `${choice.board.source}:${choice.board.id}`;
}

/** What the hotseat driver / `createGame` takes for this choice. */
export function choiceForGame(choice: BoardChoice): "beginner" | "random" | BoardDefinition {
  if (choice.kind === "builtin" && (choice.id === "beginner" || choice.id === "random")) return choice.id;
  return choiceDefinition(choice);
}

/** What the create-lobby Edge Function takes for this choice (docs/phase8.md §4.3). */
export function choiceForLobby(choice: BoardChoice): string | { boardId: string } | { definition: BoardDefinition } {
  if (choice.kind === "builtin") return choice.id;
  return choice.board.source === "saved" ? { boardId: choice.board.id } : { definition: choice.board.definition };
}

/** A resolved preview with a fixed seed, or null when the definition has errors. */
export function previewBoard(def: BoardDefinition): Board | null {
  if (hasErrors(validateBoard(def))) return null;
  try {
    return resolveBoard(def, createRng("preview", def.name));
  } catch {
    return null;
  }
}

function Card({ choice, selected, onPick, testId }: { choice: BoardChoice; selected: boolean; onPick: () => void; testId: string }) {
  const def = choiceDefinition(choice);
  const board = useMemo(() => previewBoard(def), [def]);
  const name = choice.kind === "builtin" ? BUILT_IN_LABEL[choice.id] : choice.board.name;
  const blurb = choice.kind === "builtin" ? BUILT_IN_BLURB[choice.id] : choice.board.source === "draft" ? "Draft on this device" : choice.board.isPublic ? "Public board" : "Your board";
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
    >
      {board ? <BoardThumbnail board={board} size={128} showTokens={def.generation.tokens === "fixed"} /> : <div className="grid h-32 w-32 place-items-center text-xs text-ink-soft">Has errors</div>}
      <span className="w-full truncate font-medium" data-testid="board-card-name">
        {name}
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
  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);
  useEffect(() => {
    if (!signedIn) return setSaved([]);
    let alive = true;
    loadSavedBoards()
      .then((rows) => alive && setSaved(rows))
      .catch(() => alive && setSaved([]));
    return () => {
      alive = false;
    };
  }, [signedIn]);
  const key = choiceKey(value);
  const stored = [...drafts, ...saved];
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
