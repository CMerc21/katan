"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BotLevel } from "@katan/bots";
import { isHiddenCount, nextActor, viewToState, type Action } from "@katan/engine";
import type { ConnectionState, GameDriver, SeatInfo } from "@/driver/types";
import { clearDriver } from "@/game/store";
import { errorText, playerName } from "@/game/labels";
import { useGame } from "@/hooks/useGame";
import { Board, hexPercent, type TargetMode } from "./Board";
import { BottomBar } from "./BottomBar";
import { DiscardDialog, EndedOverlay, HandoffOverlay, ResourcePicker, StealPopover, TradeDialog } from "./dialogs";
import { LogPanel } from "./LogPanel";
import { PlayersPanel } from "./PlayersPanel";
import { Button } from "./ui";

type Dialog = { kind: "trade" } | { kind: "picker"; card: "invention" | "monopoly" } | null;

const ABSENT_MS = 10 * 60 * 1000;

/** The game screen for any driver (docs/phase3.md §3.2, docs/phase5.md §2–§5). */
export function GameScreen({ driver, onExit }: { driver: GameDriver; onExit?: () => void }) {
  const router = useRouter();
  const { view, legal, dispatch, me } = useGame(driver);
  const [mode, setMode] = useState<TargetMode>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState<SeatInfo[] | undefined>(undefined);
  const [connected, setConnected] = useState<ReadonlySet<string> | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("live");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => driver.subscribeSeats?.(setSeats), [driver]);
  useEffect(() => driver.subscribePresence?.(setConnected), [driver]);
  useEffect(() => driver.subscribeConnection?.(setConnection), [driver]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const ended = view.phase.kind === "ended";
  const handoffFor = driver.pendingHandoff?.() ?? null;
  const handoff = !ended && handoffFor !== null;

  const mySeat = seats?.find((s) => s.playerId === me);
  const seatIsBot = mySeat?.kind === "bot";
  const isHost = Boolean(driver.userId && driver.hostUserId && driver.userId() === driver.hostUserId());
  const waitingOn = useMemo(() => nextActor(viewToState(view)), [view]);

  const botifiable = useMemo(() => {
    const out = new Set<string>();
    if (!isHost || !seats || !driver.botifyAbsent || ended) return out;
    for (const s of seats) {
      if (s.kind !== "human" || s.playerId !== waitingOn || s.playerId === me) continue;
      const lastSeen = s.lastSeenAt ? Date.parse(s.lastSeenAt) : 0;
      const present = connected?.has(s.playerId) ?? false;
      if (!present && now - lastSeen > ABSENT_MS) out.add(s.playerId);
    }
    return out;
  }, [isHost, seats, driver, ended, waitingOn, me, connected, now]);

  const run = useCallback(
    async (action: Action) => {
      const result = await dispatch(action);
      if (!result.ok) {
        setError(errorText(result.error.code));
        return;
      }
      setError(null);
      setMode(null);
      setDialog(null);
    },
    [dispatch],
  );

  const capability = useCallback(async (fn: (() => Promise<{ ok: boolean; error?: { code: string } }>) | undefined) => {
    if (!fn) return;
    const result = await fn();
    if (!result.ok && result.error) setError(errorText(result.error.code));
  }, []);

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
  const interactive = !handoff && !seatIsBot;
  const activeLegal = interactive ? legal : [];

  const exit = () => {
    driver.close?.();
    clearDriver();
    if (onExit) onExit();
    else router.push("/");
  };

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      {connection !== "live" && (
        <div className="fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-md border border-ink bg-parchment px-3 py-1.5 text-sm shadow" role="status" data-testid="connection">
          {connection === "offline" ? "Connection lost. Reconnecting…" : "Couldn't reach the game server. Retrying…"}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_15rem]">
        <main className="relative flex min-h-0 items-center justify-center overflow-hidden p-2 md:p-4" aria-label="Board">
          <div className="relative w-full max-w-[min(100%,calc((100dvh-9rem)*1.08))]">
            <Board view={view} legal={activeLegal} mode={mode} meColor={meView.color} onAction={run} />
            {interactive && view.phase.kind === "steal" && view.players[view.currentPlayer]!.id === me && (
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
          <PlayersPanel
            view={view}
            me={me}
            {...(seats ? { seats } : {})}
            {...(connected ? { connected } : {})}
            botifiable={botifiable}
            onBotify={(playerId: string, level: BotLevel) => void capability(driver.botifyAbsent ? () => driver.botifyAbsent!(playerId, level) : undefined)}
          />
          {(driver.handToBot || driver.abandonGame) && !ended && (
            <div className="flex flex-wrap gap-2 border-b border-line px-3 py-2" aria-label="If someone has to leave">
              {driver.handToBot && !seatIsBot && (
                <Button size="sm" onClick={() => void capability(() => driver.handToBot!("medium"))} data-testid="hand-to-bot">
                  Let a bot play for me
                </Button>
              )}
              {driver.reclaimSeat && seatIsBot && (
                <Button size="sm" variant="primary" onClick={() => void capability(() => driver.reclaimSeat!())} data-testid="reclaim-seat">
                  Take my seat back
                </Button>
              )}
              {driver.abandonGame && isHost && !confirmEnd && (
                <Button size="sm" variant="quiet" onClick={() => setConfirmEnd(true)} data-testid="abandon">
                  End game for everyone
                </Button>
              )}
              {confirmEnd && (
                <span className="flex items-center gap-2 text-sm">
                  End the game with no winner?
                  <Button size="sm" variant="primary" onClick={() => void capability(() => driver.abandonGame!())} data-testid="abandon-confirm">
                    End game
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setConfirmEnd(false)}>
                    Keep playing
                  </Button>
                </span>
              )}
            </div>
          )}
          <LogPanel view={view} />
        </aside>
      </div>

      <BottomBar
        view={view}
        me={me}
        legal={activeLegal}
        mode={mode}
        revealed={!handoff}
        error={seatIsBot ? "A bot is playing your seat. Take it back to act." : error}
        onDispatch={run}
        onMode={setMode}
        onTrade={() => setDialog({ kind: "trade" })}
        onPickResources={(card) => setDialog({ kind: "picker", card })}
        {...(seats ? { seats } : {})}
        waitingOn={waitingOn}
      />

      {handoff && handoffFor && <HandoffOverlay name={playerName(view, handoffFor)} onReady={() => driver.acknowledgeHandoff?.()} />}

      {interactive && owed > 0 && myHand && <DiscardDialog hand={myHand} owed={owed} onDiscard={(cards) => run({ type: "DISCARD", playerId: me, cards })} />}

      {interactive && dialog?.kind === "trade" && myHand && (
        <TradeDialog view={view} me={me} hand={myHand} legal={legal} onDispatch={run} onClose={() => setDialog(null)} />
      )}

      {interactive && dialog?.kind === "picker" && (
        <ResourcePicker card={dialog.card} legal={legal} onPlay={run} onClose={() => setDialog(null)} />
      )}

      {ended && <EndedOverlay view={view} onPlayAgain={exit} />}
    </div>
  );
}
