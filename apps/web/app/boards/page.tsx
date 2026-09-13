"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BUILT_IN_BOARD_IDS, BUILT_IN_SCENARIO_IDS, builtInBoard, builtInScenario, resolveBoard, rng, scenarioSummary } from "@katan/engine";
import { BoardThumbnail } from "@/board2d/Thumbnail";
import { Button } from "@/components/ui";
import { deleteBoardRemote, deleteDraft, deleteScenarioDraft, deleteScenarioRemote, forkBoardRemote, forkScenarioRemote, loadDrafts, loadSavedBoards, loadSavedScenarios, loadScenarioDrafts, type StoredBoard, type StoredScenario } from "@/editor/storage";
import { errorText } from "@/game/labels";
import { useSession } from "@/hooks/useSession";

const LABEL: Record<string, string> = { beginner: "Beginner", random: "Standard (random)", large: "Large", longStrip: "Long strip", ring: "Ring" };

function Card({ name, meta, thumb, actions, testId }: { name: string; meta: string; thumb: React.ReactNode; actions: React.ReactNode; testId: string }) {
  return (
    <li className="parchment flex flex-col gap-2 rounded-lg p-3" data-testid={testId}>
      <div className="flex justify-center">{thumb}</div>
      <div>
        <h3 className="font-display text-base font-semibold">{name}</h3>
        <p className="text-xs text-ink-soft">{meta}</p>
      </div>
      <div className="flex flex-wrap gap-1">{actions}</div>
    </li>
  );
}

/** `/boards`: built-in frames, my boards, public boards (docs/phase8.md §4.3). */
export default function BoardsPage() {
  const router = useRouter();
  const { session, configured } = useSession();
  const [drafts, setDrafts] = useState<StoredBoard[]>([]);
  const [saved, setSaved] = useState<StoredBoard[]>([]);
  const [scenarioDrafts, setScenarioDrafts] = useState<StoredScenario[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<StoredScenario[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = async () => {
    setDrafts(loadDrafts());
    setScenarioDrafts(loadScenarioDrafts());
    if (configured && session) {
      try {
        setSaved(await loadSavedBoards());
        setSavedScenarios(await loadSavedScenarios());
      } catch (err) {
        setToast(err instanceof Error ? err.message : String(err));
      }
    }
  };
  useEffect(() => {
    void refresh();
  }, [configured, session]);

  const mine = saved.filter((b) => b.ownerId === session?.user.id);
  const publicBoards = saved.filter((b) => b.isPublic && b.ownerId !== session?.user.id);
  const myScenarios = savedScenarios.filter((b) => b.ownerId === session?.user.id);
  const publicScenarios = savedScenarios.filter((b) => b.isPublic && b.ownerId !== session?.user.id);
  const scenarioThumb = (sc: StoredScenario) => {
    try {
      return <BoardThumbnail board={resolveBoard(sc.scenario.board, rng(sc.id, -2), { allowIslands: true })} size={200} showTokens={sc.scenario.board.generation.tokens === "fixed"} />;
    } catch {
      return <div className="grid h-[200px] w-[200px] place-items-center text-xs text-clay">Invalid board</div>;
    }
  };
  const scenarioMeta = (sc: StoredScenario, extra = "") => `${scenarioSummary(sc.scenario)} · up to ${sc.scenario.board.seats.max} seats${extra}`;
  const thumb = (b: StoredBoard) => {
    try {
      return <BoardThumbnail board={resolveBoard(b.definition, rng(b.id, -2), { allowIslands: true })} size={200} showTokens={b.definition.generation.tokens === "fixed"} />;
    } catch {
      return <div className="grid h-[200px] w-[200px] place-items-center text-xs text-clay">Invalid board</div>;
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="parchment rounded-lg px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold">Boards</h1>
            <p className="text-sm text-ink-soft">Build a board of any shape, save it, and pick it in the lobby or for hotseat.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => router.push("/boards/editor")} data-testid="new-board">
              New board
            </Button>
            <Link className="self-center text-sm underline" href="/">
              Home
            </Link>
          </div>
        </div>
        {toast && (
          <p className="mt-2 text-sm text-clay" role="alert">
            {toast}
          </p>
        )}
      </div>

      <section className="mt-6" aria-label="Built-in frames">
        <h2 className="font-display mb-2 text-xl font-semibold text-parchment">Built-in frames</h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {BUILT_IN_BOARD_IDS.map((id) => {
            const def = builtInBoard(id);
            return (
              <Card
                key={id}
                testId={`builtin-${id}`}
                name={LABEL[id] ?? def.name}
                meta={`${def.hexes.filter((h) => h.kind === "land").length} land · ${def.seats.min}–${def.seats.max} seats`}
                thumb={<BoardThumbnail board={resolveBoard(def, rng(id, -2))} size={200} showTokens={id === "beginner"} />}
                actions={
                  <Button size="sm" onClick={() => router.push(`/boards/editor/${id}`)} data-testid={`edit-${id}`}>
                    Open as template
                  </Button>
                }
              />
            );
          })}
        </ul>
      </section>

      <section className="mt-6" aria-label="Built-in scenarios">
        <h2 className="font-display mb-2 text-xl font-semibold text-parchment">Built-in scenarios</h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {BUILT_IN_SCENARIO_IDS.map((id) => {
            const sc = builtInScenario(id);
            return (
              <Card
                key={id}
                testId={`builtin-scenario-${id}`}
                name={sc.name}
                meta={`${scenarioSummary(sc)} · ${sc.board.hexes.filter((h) => h.kind === "land").length} land · up to ${sc.board.seats.max} seats`}
                thumb={<BoardThumbnail board={resolveBoard(sc.board, rng(id, -2), { allowIslands: true })} size={200} showTokens={false} />}
                actions={
                  <Button size="sm" onClick={() => router.push(`/boards/editor/${id}`)} data-testid={`edit-scenario-${id}`}>
                    Open as template
                  </Button>
                }
              />
            );
          })}
        </ul>
      </section>

      {scenarioDrafts.length > 0 && (
        <section className="mt-6" aria-label="Scenario drafts on this device">
          <h2 className="font-display mb-2 text-xl font-semibold text-parchment">Scenario drafts on this device</h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {scenarioDrafts.map((sc) => (
              <Card
                key={sc.id}
                testId={`scenario-draft-${sc.id}`}
                name={sc.name}
                meta={scenarioMeta(sc, " · not synced")}
                thumb={scenarioThumb(sc)}
                actions={
                  <>
                    <Button size="sm" onClick={() => router.push(`/boards/editor/${sc.id}`)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        deleteScenarioDraft(sc.id);
                        void refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {session && myScenarios.length > 0 && (
        <section className="mt-6" aria-label="My scenarios">
          <h2 className="font-display mb-2 text-xl font-semibold text-parchment">My scenarios</h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {myScenarios.map((sc) => (
              <Card
                key={sc.id}
                testId={`my-scenario-${sc.id}`}
                name={sc.name}
                meta={scenarioMeta(sc, sc.isPublic ? " · public" : "")}
                thumb={scenarioThumb(sc)}
                actions={
                  <>
                    <Button size="sm" onClick={() => router.push(`/boards/editor/${sc.id}`)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => void deleteScenarioRemote(sc.id).then((r) => (r.ok ? refresh() : setToast(errorText(r.code ?? "BAD_REQUEST"))))}>
                      Delete
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {session && publicScenarios.length > 0 && (
        <section className="mt-6" aria-label="Public scenarios">
          <h2 className="font-display mb-2 text-xl font-semibold text-parchment">Public scenarios</h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {publicScenarios.map((sc) => (
              <Card
                key={sc.id}
                testId={`public-scenario-${sc.id}`}
                name={sc.name}
                meta={scenarioMeta(sc)}
                thumb={scenarioThumb(sc)}
                actions={
                  <Button size="sm" onClick={() => void forkScenarioRemote(sc.id).then((r) => (r.ok ? router.push(`/boards/editor/${r.scenarioId}`) : setToast(errorText(r.code))))}>
                    Fork
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="mt-6" aria-label="Drafts on this device">
          <h2 className="font-display mb-2 text-xl font-semibold text-parchment">Drafts on this device</h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {drafts.map((b) => (
              <Card
                key={b.id}
                testId={`draft-${b.id}`}
                name={b.name}
                meta={`${b.definition.hexes.filter((h) => h.kind === "land").length} land · up to ${b.definition.seats.max} seats · not synced`}
                thumb={thumb(b)}
                actions={
                  <>
                    <Button size="sm" onClick={() => router.push(`/boards/editor/${b.id}`)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        deleteDraft(b.id);
                        void refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {session && (
        <section className="mt-6" aria-label="My boards">
          <h2 className="font-display mb-2 text-xl font-semibold text-parchment">My boards</h2>
          {mine.length === 0 && <p className="text-sm text-parchment/70">Nothing saved yet.</p>}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {mine.map((b) => (
              <Card
                key={b.id}
                testId={`mine-${b.id}`}
                name={b.name}
                meta={`${b.definition.hexes.filter((h) => h.kind === "land").length} land · up to ${b.definition.seats.max} seats${b.isPublic ? " · public" : ""}`}
                thumb={thumb(b)}
                actions={
                  <>
                    <Button size="sm" onClick={() => router.push(`/boards/editor/${b.id}`)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => void deleteBoardRemote(b.id).then((r) => (r.ok ? refresh() : setToast(errorText(r.code ?? "BAD_REQUEST"))))}
                    >
                      Delete
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {session && publicBoards.length > 0 && (
        <section className="mt-6" aria-label="Public boards">
          <h2 className="font-display mb-2 text-xl font-semibold text-parchment">Public boards</h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {publicBoards.map((b) => (
              <Card
                key={b.id}
                testId={`public-${b.id}`}
                name={b.name}
                meta={`${b.definition.hexes.filter((h) => h.kind === "land").length} land · up to ${b.definition.seats.max} seats`}
                thumb={thumb(b)}
                actions={
                  <Button size="sm" onClick={() => void forkBoardRemote(b.id).then((r) => (r.ok ? router.push(`/boards/editor/${r.boardId}`) : setToast(errorText(r.code))))}>
                    Fork
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
