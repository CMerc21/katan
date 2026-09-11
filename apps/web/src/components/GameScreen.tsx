"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isHiddenCount, type Action } from "@katan/engine";
import type { GameDriver } from "@/driver/types";
import { clearDriver } from "@/game/store";
import { ERROR_TEXT, playerName } from "@/game/labels";
import { useGame } from "@/hooks/useGame";
import { Board, hexPercent, type TargetMode } from "./Board";
import { BottomBar } from "./BottomBar";
import { DiscardDialog, EndedOverlay, HandoffOverlay, ResourcePicker, StealPopover, TradeDialog } from "./dialogs";
import { LogPanel } from "./LogPanel";
import { PlayersPanel } from "./PlayersPanel";

type Dialog = { kind: "trade" } | { kind: "picker"; card: "invention" | "monopoly" } | null;

/** The /play screen (docs/phase3.md §3.2). */
export function GameScreen({ driver }: { driver: GameDriver }) {
  const router = useRouter();
  const { view, legal, dispatch, me } = useGame(driver);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [mode, setMode] = useState<TargetMode>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);

  const ended = view.phase.kind === "ended";
  const handoff = !ended && acknowledged !== me;

  const run = useCallback(
    async (action: Action) => {
      const result = await dispatch(action);
      if (!result.ok) {
        setError(ERROR_TEXT[result.error.code]);
        return;
      }
      setError(null);
      setMode(null);
      setDialog(null);
    },
    [dispatch],
  );

  // Targeting mode only makes sense while it is still my action phase.
  useEffect(() => {
    if (view.phase.kind !== "action") setMode(null);
  }, [view.phase.kind]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode !== null) setMode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const meView = view.players.find((p) => p.id === me)!;
  const myHand = isHiddenCount(meView.hand) ? null : meView.hand;
  const owed = view.phase.kind === "discard" ? (view.pendingDiscards[me] ?? 0) : 0;

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_15rem]">
        <main className="relative flex min-h-0 items-center justify-center overflow-hidden p-2 md:p-4" aria-label="Board">
          <div className="relative w-full max-w-[min(100%,calc((100dvh-9rem)*1.08))]">
            <Board view={view} legal={handoff ? [] : legal} mode={mode} meColor={meView.color} onAction={run} />
            {!handoff && view.phase.kind === "steal" && (
              <StealPopover
                view={view}
                targets={view.phase.targets}
                position={hexPercent(view.phase.hex)}
                onSteal={(targetPlayerId) => run({ type: "STEAL", playerId: me, targetPlayerId })}
              />
            )}
          </div>
        </main>
        <aside className="flex min-h-0 flex-col border-l border-line bg-parchment-deep/40" aria-label="Game info">
          <PlayersPanel view={view} me={me} />
          <LogPanel view={view} />
        </aside>
      </div>

      <BottomBar
        view={view}
        me={me}
        legal={handoff ? [] : legal}
        mode={mode}
        revealed={!handoff}
        error={error}
        onDispatch={run}
        onMode={setMode}
        onTrade={() => setDialog({ kind: "trade" })}
        onPickResources={(card) => setDialog({ kind: "picker", card })}
      />

      {handoff && <HandoffOverlay name={playerName(view, me)} onReady={() => setAcknowledged(me)} />}

      {!handoff && owed > 0 && myHand && <DiscardDialog hand={myHand} owed={owed} onDiscard={(cards) => run({ type: "DISCARD", playerId: me, cards })} />}

      {!handoff && dialog?.kind === "trade" && myHand && (
        <TradeDialog view={view} me={me} hand={myHand} legal={legal} onDispatch={run} onClose={() => setDialog(null)} />
      )}

      {!handoff && dialog?.kind === "picker" && (
        <ResourcePicker card={dialog.card} legal={legal} onPlay={run} onClose={() => setDialog(null)} />
      )}

      {ended && (
        <EndedOverlay
          view={view}
          onPlayAgain={() => {
            clearDriver();
            router.push("/");
          }}
        />
      )}
    </div>
  );
}
