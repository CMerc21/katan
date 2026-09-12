"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { BotLevel } from "@katan/bots";
import { isHiddenCount, nextActor, viewToState, type Action, type EdgeId } from "@katan/engine";
import type { ConnectionState, GameDriver, SeatInfo } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { clearDriver } from "@/game/store";
import { errorText, playerName } from "@/game/labels";
import { effectiveSpeed, useSettings, type Quality } from "@/game/settings";
import { stepDown } from "@/board3d/quality";
import type { TargetMode } from "@/board3d/Board3D";
import { playSound } from "@/game/sound";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useGame } from "@/hooks/useGame";
import { AnchorsProvider } from "./anim/anchors";
import { Confetti, DevCardReveal, DiceTray, FlightLayer, TurnBanner, thinkingPlayer } from "./anim/effects";
import { BottomBar } from "./BottomBar";
import { DiscardDialog, EndedOverlay, GoldDialog, HandoffOverlay, ResourcePicker, StealPopover, TradeDialog } from "./dialogs";
import { LogPanel } from "./LogPanel";
import { PlayersPanel } from "./PlayersPanel";
import { Button } from "./ui";

type Dialog = { kind: "trade" } | { kind: "picker"; card: "invention" | "monopoly" } | null;

const ABSENT_MS = 10 * 60 * 1000;

/** The diorama needs WebGL and the DOM; never render it on the server (docs/phase7-5.md). */
const Board3D = dynamic(() => import("@/board3d/Board3D").then((m) => m.Board3D), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-parchment/70" aria-busy="true">
      Setting the table…
    </div>
  ),
});

/** The game screen for any driver (docs/phase3.md §3.2, docs/phase5.md §2–§5, docs/phase7.md §2–§3). */
export function GameScreen({ driver, onExit }: { driver: GameDriver; onExit?: () => void }) {
  return (
    <AnchorsProvider>
      <GameScreenInner driver={driver} onExit={onExit} />
    </AnchorsProvider>
  );
}

function GameScreenInner({ driver, onExit }: { driver: GameDriver; onExit?: (() => void) | undefined }) {
  const router = useRouter();
  const { legal, dispatch } = useGame(driver);
  const [settings] = useSettings();
  const [seats, setSeats] = useState<SeatInfo[] | undefined>(undefined);
  const isBot = useCallback((id: string) => seats?.find((s) => s.playerId === id)?.kind === "bot", [seats]);
  const onStep = useCallback(
    (step: Step) => {
      if (!settings.sound || effectiveSpeed(settings) === "off" || step.kind !== "event") return;
      switch (step.event.kind) {
        case "diceRolled":
          playSound("dice");
          break;
        case "produced":
        case "stole":
        case "tradeAccepted":
        case "maritimeTrade":
        case "devCardBought":
          playSound("card");
          break;
        case "built":
        case "shipBuilt":
        case "shipMoved":
          playSound("piece");
          break;
        case "robberMoved":
        case "pirateMoved":
          playSound("robber");
          break;
        case "goldChosen":
          playSound("card");
          break;
        case "turnStarted":
          playSound("turn");
          break;
        case "gameEnded":
          playSound("win");
          break;
        default:
          break;
      }
    },
    [settings],
  );
  const { view, latest, current, draining, skip } = useEventQueue(driver, settings, isBot, onStep);
  const me = latest.viewer;

  // Graphics quality: the setting, or auto-detection, minus any watchdog step-downs (docs/phase7-5.md §7).
  const [detected, setDetected] = useState<Quality>("medium");
  const [degraded, setDegraded] = useState<Quality | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const quality: Quality = degraded ?? (settings.quality === "auto" ? detected : settings.quality);
  useEffect(() => setDegraded(null), [settings.quality]);
  const onDegrade = useCallback((from: Quality) => {
    const next = stepDown(from);
    if (!next) return;
    setDegraded(next);
    setToast(`Graphics lowered to ${next} to keep the game smooth`);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const [mode, setModeRaw] = useState<TargetMode>(null);
  const [moveFrom, setMoveFrom] = useState<EdgeId | null>(null);
  const setMode = useCallback((m: TargetMode) => {
    setModeRaw(m);
    setMoveFrom(null);
  }, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
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
  const handoff = !ended && !draining && handoffFor !== null;

  const mySeat = seats?.find((s) => s.playerId === me);
  const seatIsBot = mySeat?.kind === "bot";
  const isHost = Boolean(driver.userId && driver.hostUserId && driver.userId() === driver.hostUserId());
  const waitingOn = useMemo(() => nextActor(viewToState(latest)), [latest]);

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
    if (view.phase.kind !== "action" && view.phase.kind !== "specialBuild") setMode(null);
  }, [view.phase.kind, setMode]);

  // docs/phase9.md §8: a toast when someone earns an island pennant.
  useEffect(() => {
    if (current?.kind === "event" && current.event.kind === "islandSettled") {
      setToast(`${playerName(view, current.event.playerId)} settled a new island (+${current.event.bonus})`);
    }
  }, [current, view]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode !== null) setMode(null);
      if (e.key === " " && draining && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draining, skip]);

  const meView = view.players.find((p) => p.id === me)!;
  const myHand = isHiddenCount(meView.hand) ? null : meView.hand;
  const owed = view.phase.kind === "discard" ? (view.pendingDiscards[me] ?? 0) : 0;
  const goldOwed = view.phase.kind === "chooseGold" ? (view.phase.owed[me] ?? 0) : 0;
  const goldChoice = legal.find((a): a is Extract<Action, { type: "CHOOSE_GOLD" }> => a.type === "CHOOSE_GOLD");
  // Input is disabled while the queue drains (docs/phase7.md §2.1); legal actions come from the latest server view.
  const interactive = !handoff && !seatIsBot && !draining;
  const activeLegal = interactive ? legal : [];
  const glint = current?.kind === "event" && current.event.kind === "specialCardMoved" ? current.event.to : null;
  const winner = ended && view.winner ? view.players.find((p) => p.id === view.winner) : undefined;

  const exit = () => {
    driver.close?.();
    clearDriver();
    if (onExit) onExit();
    else router.push("/");
  };

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden" data-draining={draining ? "true" : "false"}>
      {connection !== "live" && (
        <div className="parchment fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-md px-3 py-1.5 text-sm" role="status" data-testid="connection">
          {connection === "offline" ? "Connection lost. Reconnecting…" : "Couldn't reach the game server. Retrying…"}
        </div>
      )}

      {toast && (
        <div className="parchment fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-md px-3 py-1.5 text-sm" role="status" data-testid="quality-toast">
          {toast}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_16rem]">
        <main className="relative min-h-0 overflow-hidden" aria-label="Board">
          <Board3D
            view={view}
            legal={activeLegal}
            mode={mode}
            moveFrom={moveFrom}
            onPickShip={setMoveFrom}
            meColor={meView.color}
            onAction={run}
            step={current}
            onSkip={draining ? skip : undefined}
            onCancelMode={() => setMode(null)}
            quality={quality}
            onDegrade={onDegrade}
            onDetected={setDetected}
            followTurns={settings.followTurns}
            overlay={
              interactive && view.phase.kind === "steal" && view.players[view.currentPlayer]!.id === me
                ? {
                    hex: view.phase.hex,
                    node: <StealPopover view={view} targets={view.phase.targets} onSteal={(targetPlayerId) => run({ type: "STEAL", playerId: me, targetPlayerId })} />,
                  }
                : null
            }
          />
          <DiceTray step={current} view={view} />
          <DevCardReveal step={current} view={view} />
        </main>
        <aside className="parchment flex min-h-0 flex-col" aria-label="Game info">
          <PlayersPanel
            view={view}
            me={me}
            {...(seats ? { seats } : {})}
            {...(connected ? { connected } : {})}
            botifiable={botifiable}
            onBotify={(playerId: string, level: BotLevel) => void capability(driver.botifyAbsent ? () => driver.botifyAbsent!(playerId, level) : undefined)}
            thinking={thinkingPlayer(current)}
            glint={glint}
          />
          {(driver.handToBot || driver.abandonGame) && !ended && (
            <div className="ink-rule flex flex-wrap gap-2 px-3 py-2" aria-label="If someone has to leave">
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
        draining={draining}
        onSkip={skip}
        showGraphics
      />

      <TurnBanner step={current} view={view} seats={seats} />
      <FlightLayer step={current} view={view} />

      {handoff && handoffFor && <HandoffOverlay name={playerName(view, handoffFor)} onReady={() => driver.acknowledgeHandoff?.()} />}

      {interactive && owed > 0 && myHand && <DiscardDialog hand={myHand} owed={owed} onDiscard={(cards) => run({ type: "DISCARD", playerId: me, cards })} />}

      {interactive && goldOwed > 0 && goldChoice && <GoldDialog owed={goldChoice.resources.length} legal={legal} onChoose={run} />}

      {interactive && dialog?.kind === "trade" && myHand && <TradeDialog view={view} me={me} hand={myHand} legal={legal} onDispatch={run} onClose={() => setDialog(null)} seats={seats} />}

      {interactive && dialog?.kind === "picker" && <ResourcePicker card={dialog.card} legal={legal} onPlay={run} onClose={() => setDialog(null)} />}

      {ended && !draining && winner && effectiveSpeed(settings) !== "off" && <Confetti color={winner.color} />}
      {ended && !draining && <EndedOverlay view={view} onPlayAgain={exit} seats={seats} />}
    </div>
  );
}
