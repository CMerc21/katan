"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { builtInBoard, builtInScenario, isBuiltInBoardId, isBuiltInScenarioId, type BoardDefinition } from "@katan/engine";
import { Editor } from "@/editor/Editor";
import { TEMPLATE_LABEL, emptyDefinition, settingsOf, type SavedMeta, type ScenarioSettings } from "@/editor/model";
import { isDraftId, isScenarioDraftId, loadDrafts, loadSavedBoard, loadSavedScenario, loadScenarioDrafts } from "@/editor/storage";

/**
 * `/boards/editor` (new), `/boards/editor/<built-in>` (template), `/boards/editor/<draft-or-saved id>` (docs/phase8.md §4).
 * Rendered by the layout, not the page: a page remounts whenever the id in the URL changes (a save moves a new
 * board to its id), and that would throw away the undo history, the tool and the camera (docs/phase14.md §2).
 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string[] }>();
  const id = params.id?.[0] ?? null;
  const [loaded, setLoaded] = useState<{ def: BoardDefinition; id: string | null; scenario: ScenarioSettings | null; meta?: SavedMeta } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The URL the editor itself moved to after a save: it already holds that board, so the page must not reload
  // (and remount) it, or the undo history, the tool and the camera would be lost.
  const ownNavigation = useRef<string | null>(null);
  const onSaved = useCallback((savedId: string) => {
    ownNavigation.current = savedId;
  }, []);

  useEffect(() => {
    if (id !== null && id === ownNavigation.current) return;
    let active = true;
    void (async () => {
      if (!id) return setLoaded({ def: emptyDefinition(), id: null, scenario: null });
      if (isBuiltInBoardId(id)) return setLoaded({ def: { ...builtInBoard(id), name: `My ${(TEMPLATE_LABEL[id] ?? builtInBoard(id).name).toLowerCase()} board` }, id: null, scenario: null });
      if (isBuiltInScenarioId(id)) {
        const s = builtInScenario(id);
        return setLoaded({ def: { ...s.board, name: `My ${s.name.toLowerCase()}` }, id: null, scenario: settingsOf(s) });
      }
      if (isDraftId(id)) {
        const draft = loadDrafts().find((d) => d.id === id);
        return draft ? setLoaded({ def: draft.definition, id: draft.id, scenario: null, meta: { kind: "board", isPublic: false, ownerId: null } }) : setProblem("That draft is not on this device");
      }
      if (isScenarioDraftId(id)) {
        const draft = loadScenarioDrafts().find((d) => d.id === id);
        return draft ? setLoaded({ def: draft.scenario.board, id: draft.id, scenario: settingsOf(draft.scenario), meta: { kind: "scenario", isPublic: false, ownerId: null } }) : setProblem("That draft is not on this device");
      }
      try {
        const saved = await loadSavedBoard(id);
        if (!active) return;
        if (saved) return setLoaded({ def: { ...saved.definition, name: saved.name }, id: saved.id, scenario: null, meta: { kind: "board", isPublic: saved.isPublic, ownerId: saved.ownerId } });
        const savedScenario = await loadSavedScenario(id);
        if (!active) return;
        if (!savedScenario) return setProblem("That board does not exist or is private");
        setLoaded({ def: { ...savedScenario.scenario.board, name: savedScenario.name }, id: savedScenario.id, scenario: settingsOf(savedScenario.scenario), meta: { kind: "scenario", isPublic: savedScenario.isPublic, ownerId: savedScenario.ownerId } });
      } catch (err) {
        if (active) setProblem(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (problem) {
    return (
      <main className="parchment mx-auto my-8 max-w-md rounded-lg px-6 py-8">
        <h1 className="font-display text-2xl font-semibold">Can&apos;t open that board</h1>
        <p className="mt-2 text-ink-soft">{problem}</p>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="grid h-dvh place-items-center text-parchment/70" aria-busy="true">
        Opening the editor…
      </main>
    );
  }
  return (
    <>
      <Editor key={loaded.id ?? "new"} initial={loaded.def} initialId={loaded.id} initialScenario={loaded.scenario} initialMeta={loaded.meta ?? null} onSaved={onSaved} />
      {children}
    </>
  );
}
