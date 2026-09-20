"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { BotLevel } from "@katan/bots";
import { isHiddenCount, nextActor, viewToState, type Action, type EdgeId, type Hand, type HexId, type ProgressCard, type Resource, type VertexId } from "@katan/engine";
import type { ConnectionState, GameDriver, SeatInfo } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { clearDriver } from "@/game/store";
import { errorText, playerName } from "@/game/labels";
import { effectiveSpeed, loadSettings, useSettings, type Quality } from "@/game/settings";
import { QUALITY_PRESETS, resolveDpr, stepDown, type QualitySource } from "@/board3d/quality";
import type { CrownPick, TargetMode } from "@/board3d/Board3D";
import { NO_PICK } from "@/board3d/Interaction";
import { boardBounds } from "@/board3d/layout3d";
import { installHudSounds, playSound } from "@/game/sound";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useGame } from "@/hooks/useGame";
import { BankDecks } from "@/board/props/BankDecks";
import { BarbarianTrack } from "@/board/props/BarbarianTrack";
import { ImprovementBooks } from "@/board/props/ImprovementBooks";
import { PiecePiles } from "@/board/props/PiecePiles";
import { HudLayer } from "@/hud/HudLayer";
import type { Toast } from "@/hud/EventToast";
import { AnchorsProvider } from "./anim/anchors";
import { Confetti, DevCardReveal, FlightLayer } from "./anim/effects";
import { DiscardDialog, EndedOverlay, GoldDialog, HandoffOverlay, ResourcePicker, StealPopover, TradeDialog } from "./dialogs";
import { FishSheet } from "./wayfarers/FishSheet";
import { NeighborlyDialog } from "./wayfarers/NeighborlyDialog";
// Crown & Castle (docs/phase11.md §11)
import { CommercialSwapDialog, DeserterDialog, DiscardProgressDialog, DowngradeDialog, FreeKnightDialog, GiveCardsDialog, MetropolisDialog, RetreatDialog, SpyDialog } from "./crown/CrownDialogs";
import { ImprovementSheet } from "./crown/ImprovementSheet";
import { KnightMenu } from "./crown/KnightMenu";
import { ProgressSheet } from "./crown/ProgressSheet";

type Dialog = { kind: "trade" } | { kind: "picker"; card: "invention" | "monopoly" } | { kind: "fish" } | { kind: "improve" } | { kind: "progress"; card: ProgressCard | null } | null;

const ABSENT_MS = 10 * 60 * 1000;
const EMPTY_HAND: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };

/** The diorama needs WebGL and the DOM; never render it on the server (docs/phase7-5.md). */
const Board3D = dynamic(() => import("@/board3d/Board3D").then((m) => m.Board3D), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-[var(--hud-text-dim)]" aria-busy="true">
      Setting the table…
    </div>
  ),
});

/** The game screen for any driver (docs/phase3.md §3.2, docs/phase5.md §2–§5, docs/phase7.md §2–§3, docs/phase12.md). */
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
        case "goldChosen":
        // Wayfarers (docs/phase10.md) and Crown & Castle (docs/phase11.md §11) reuse the existing cues.
        case "fishDrawn":
        case "fishSpent":
        case "bootPassed":
        case "neighborlyGave":
        case "coinsAwarded":
        case "spiceProduced":
        case "goodLoaded":
        case "resourcesTaken":
        case "commoditiesProduced":
        case "progressDrawn":
        case "progressPlayed":
        case "cardsTaken":
        case "commercialSwap":
        case "commodityMonopolised":
        case "resourceMonopolised":
          playSound("card");
          break;
        case "built":
        case "shipBuilt":
        case "shipMoved":
        case "castleBuilt":
        case "guardPlaced":
        case "hexRebuilt":
        case "caravanExtended":
        case "wagonMoved":
        case "bridgeBuilt":
        case "knightBuilt":
        case "knightActivated":
        case "knightPromoted":
        case "knightMoved":
        case "knightDisplaced":
        case "knightRetreated":
        case "wallBuilt":
        case "roadRemoved":
        case "tokensSwapped":
          playSound("piece");
          break;
        case "robberMoved":
        case "pirateMoved":
        case "raidersAdvanced":
        case "raid":
        case "fleetAdvanced":
        case "fleetAttacked":
        case "robberChased":
        case "cityDowngraded":
          playSound("robber");
          break;
        case "chipMoved":
        case "delivered":
        case "turnStarted":
        case "improvementBuilt":
        case "metropolisPlaced":
        case "defenderAwarded":
        case "merchantPlaced":
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

  // HUD sound hooks (docs/phase12.md §8): read the live setting so a toggle applies at once.
  useEffect(() => installHudSounds(() => loadSettings().sound && effectiveSpeed(loadSettings()) !== "off"), []);

  // Graphics quality (docs/phase7-5.md §6): a manual preset is used as is and the watchdog stays off;
  // Auto starts from detection and may be stepped down by the watchdog for this session only.
  const [detected, setDetected] = useState<Quality>("medium");
  const [degraded, setDegraded] = useState<Quality | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((text: string, kind?: string) => setToasts((q) => [...q, { id: Date.now() + q.length, text, kind }]), []);
  const shiftToast = useCallback((id: number) => setToasts((q) => q.filter((t) => t.id !== id)), []);
  const manual = settings.quality !== "auto";
  const quality: Quality = manual ? settings.quality : (degraded ?? detected);
  const qualitySource: QualitySource = manual ? "manual" : degraded ? "watchdog" : "auto";
  useEffect(() => setDegraded(null), [settings.quality]);
  const onDegrade = useCallback(
    (from: Quality) => {
      const next = stepDown(from);
      if (!next) return;
      setDegraded(next);
      pushToast(`Graphics lowered to ${next} to keep the game smooth`, "quality");
    },
    [pushToast],
  );
  useEffect(() => {
    const dpr = resolveDpr(quality, window.devicePixelRatio);
    console.info(`[katan] graphics preset: ${quality} (${qualitySource}, render dpr ${dpr}, device dpr ${window.devicePixelRatio})`);
  }, [quality, qualitySource]);

  const [mode, setModeRaw] = useState<TargetMode>(null);
  const [moveFrom, setMoveFrom] = useState<EdgeId | null>(null);
  // Wayfarers, wagons (docs/phase10.md §7): the stops picked so far in wagon mode.
  const [wagonPath, setWagonPath] = useState<VertexId[]>([]);
  // Crown & Castle (docs/phase11.md §11): the knight being moved / the first pick of a two-step card, and the open knight menu.
  const [crownPick, setCrownPick] = useState<CrownPick>(NO_PICK);
  const [knightMenu, setKnightMenu] = useState<VertexId | null>(null);
  const setMode = useCallback((m: TargetMode) => {
    setModeRaw(m);
    setMoveFrom(null);
    setWagonPath([]);
    setCrownPick(NO_PICK);
    setKnightMenu(null);
  }, []);
  const knightMode = useCallback((m: TargetMode, from: VertexId) => {
    setModeRaw(m);
    setMoveFrom(null);
    setWagonPath([]);
    setCrownPick({ from, first: null });
    setKnightMenu(null);
  }, []);
  const pickFirst = useCallback((id: string) => setCrownPick((p) => ({ ...p, first: id })), []);
  const pickStep = useCallback((v: VertexId) => setWagonPath((path) => [...path, v]), []);
  const undoStep = useCallback(() => setWagonPath((path) => path.slice(0, -1)), []);
  const wagon = useMemo(() => ({ path: wagonPath, onUndo: undoStep }), [wagonPath, undoStep]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tradeGive, setTradeGive] = useState<Hand>(EMPTY_HAND);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<ReadonlySet<string> | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("live");
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
    [dispatch, setMode],
  );

  const capability = useCallback(async (fn: (() => Promise<{ ok: boolean; error?: { code: string } }>) | undefined) => {
    if (!fn) return;
    const result = await fn();
    if (!result.ok && result.error) setError(errorText(result.error.code));
  }, []);

  useEffect(() => {
    if (view.phase.kind !== "action" && view.phase.kind !== "specialBuild") setMode(null);
  }, [view.phase.kind, setMode]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dialog) setDialog(null);
        else if (mode !== null) setMode(null);
      }
      if (e.key === " " && draining && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draining, skip, dialog, setMode]);

  const meView = view.players.find((p) => p.id === me)!;
  const myHand = isHiddenCount(meView.hand) ? null : meView.hand;
  const owed = view.phase.kind === "discard" ? (view.pendingDiscards[me] ?? 0) : 0;
  const goldOwed = view.phase.kind === "chooseGold" ? (view.phase.owed[me] ?? 0) : 0;
  const goldChoice = legal.find((a): a is Extract<Action, { type: "CHOOSE_GOLD" }> => a.type === "CHOOSE_GOLD");
  // Wayfarers (docs/phase10.md): the Neighborly help prompt for me.
  const neighborly = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "neighborlyHelp" && view.phase.prompt.playerId === me ? view.phase.prompt : null;
  // Crown & Castle (docs/phase11.md §11): the module prompts for me, and my commodities.
  const crownOn = view.scenario?.crown === true;
  const prompt = view.phase.kind === "modulePrompt" && view.phase.prompt.playerId === me ? view.phase.prompt.kind : null;
  const myCommodities = crownOn ? view.crown?.players[me]?.commodities : undefined;
  const crownHand = crownOn && myCommodities && myHand ? { hand: myHand, commodities: myCommodities } : null;
  // Input is disabled while the queue drains (docs/phase7.md §2.1); legal actions come from the latest server view.
  const interactive = !handoff && !seatIsBot && !draining;
  const activeLegal = interactive ? legal : [];
  const glint = current?.kind === "event" && (current.event.kind === "specialCardMoved" || current.event.kind === "chipMoved") ? current.event.to : null;
  const winner = ended && view.winner ? view.players.find((p) => p.id === view.winner) : undefined;
  const bounds = useMemo(() => boardBounds([...(Object.keys(view.board.hexes) as HexId[]), ...view.board.sea]), [view.board]);
  const shadows = QUALITY_PRESETS[quality].shadows;

  const openTrade = useCallback(() => {
    setTradeGive(EMPTY_HAND);
    setDialog({ kind: "trade" });
  }, []);
  const tradePicking = useMemo(
    () =>
      dialog?.kind === "trade" && myHand
        ? {
            give: tradeGive,
            onPick: (r: Resource) => setTradeGive((g) => ({ ...g, [r]: Math.min(myHand[r], g[r] + 1) })),
          }
        : null,
    [dialog, myHand, tradeGive],
  );

  const exit = () => {
    driver.close?.();
    clearDriver();
    if (onExit) onExit();
    else router.push("/");
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden" data-draining={draining ? "true" : "false"}>
      <main className="absolute inset-0" aria-label="Board">
        <Board3D
          view={view}
          legal={activeLegal}
          mode={mode}
          moveFrom={moveFrom}
          onPickShip={setMoveFrom}
          wagonPath={wagonPath}
          onPickStep={pickStep}
          crownPick={crownPick}
          onPickKnight={(v) => setKnightMenu((open) => (open === v ? null : v))}
          onPick={pickFirst}
          meColor={meView.color}
          onAction={run}
          step={current}
          onSkip={draining ? skip : undefined}
          onCancelMode={() => setMode(null)}
          quality={quality}
          {...(manual ? {} : { onDegrade })}
          onDetected={setDetected}
          followTurns={settings.followTurns}
          overlay={
            interactive && view.phase.kind === "steal" && view.players[view.currentPlayer]!.id === me
              ? {
                  hex: view.phase.hex,
                  node: <StealPopover view={view} targets={view.phase.targets} onSteal={(targetPlayerId) => run({ type: "STEAL", playerId: me, targetPlayerId })} />,
                }
              : interactive && crownHand && knightMenu !== null && view.phase.kind === "action"
                ? {
                    vertex: knightMenu,
                    node: <KnightMenu view={view} me={me} vertex={knightMenu} hand={crownHand.hand} legal={legal} onDispatch={run} onMode={knightMode} onClose={() => setKnightMenu(null)} />,
                  }
                : null
          }
        >
          {/* On-table props (docs/phase12.md §7): the bank, the piece piles and, under Crown & Castle, the fleet's lane and the improvement books. */}
          <BankDecks view={view} bounds={bounds} />
          <PiecePiles view={view} bounds={bounds} shadows={shadows} />
          {crownOn && <BarbarianTrack view={view} bounds={bounds} shadows={shadows} />}
          {crownOn && <ImprovementBooks view={view} bounds={bounds} shadows={shadows} onOpen={interactive ? () => setDialog({ kind: "improve" }) : undefined} />}
        </Board3D>
        <DevCardReveal step={current} view={view} />
        {/* Crown & Castle (docs/phase11.md §11): the prompts answered on the board. */}
        {interactive && crownOn && prompt === "downgradeCity" && <DowngradeDialog legal={legal} onDispatch={run} />}
        {interactive && crownOn && prompt === "placeMetropolis" && <MetropolisDialog view={view} legal={legal} onDispatch={run} />}
        {interactive && crownOn && prompt === "deserter" && <DeserterDialog view={view} legal={legal} onDispatch={run} />}
        {interactive && crownOn && prompt === "placeFreeKnight" && <FreeKnightDialog legal={legal} onDispatch={run} />}
        {interactive && crownOn && prompt === "knightRetreat" && <RetreatDialog legal={legal} onDispatch={run} />}
      </main>

      <HudLayer
        driver={driver}
        view={view}
        me={me}
        legal={activeLegal}
        seats={seats}
        connected={connected}
        botifiable={botifiable}
        onBotify={(playerId: string, level: BotLevel) => void capability(driver.botifyAbsent ? () => driver.botifyAbsent!(playerId, level) : undefined)}
        step={current}
        draining={draining}
        onSkip={skip}
        interactive={interactive}
        revealed={!handoff}
        mode={mode}
        onMode={setMode}
        crownPick={crownPick}
        wagon={wagon}
        onDispatch={run}
        error={seatIsBot ? "A bot is playing your seat. Take it back to act." : error}
        waitingOn={waitingOn}
        glint={glint}
        activeQuality={{ quality, source: qualitySource }}
        toasts={toasts}
        pushToast={pushToast}
        shiftToast={shiftToast}
        tradePicking={tradePicking}
        onTrade={openTrade}
        onPickResources={(card) => setDialog({ kind: "picker", card })}
        onFish={() => setDialog({ kind: "fish" })}
        onImprove={() => setDialog({ kind: "improve" })}
        onProgress={(card?: ProgressCard) => setDialog({ kind: "progress", card: card ?? null })}
        onExit={exit}
        onCapability={(fn) => void capability(fn)}
      >
        {connection !== "live" && (
          <div className="hud-toast hud-panel" style={{ top: "12%" }} role="status" data-testid="connection">
            {connection === "offline" ? "Connection lost. Reconnecting…" : "Couldn't reach the game server. Retrying…"}
          </div>
        )}
      </HudLayer>
      <FlightLayer step={current} view={view} />

      {handoff && handoffFor && <HandoffOverlay name={playerName(view, handoffFor)} onReady={() => driver.acknowledgeHandoff?.()} />}

      {interactive && owed > 0 && myHand && (
        <DiscardDialog hand={myHand} owed={owed} commodities={myCommodities} onDiscard={(cards, commodities) => run({ type: "DISCARD", playerId: me, cards, ...(commodities ? { commodities } : {}) })} />
      )}

      {interactive && goldOwed > 0 && goldChoice && <GoldDialog owed={goldChoice.resources.length} legal={legal} onChoose={run} />}

      {interactive && dialog?.kind === "trade" && myHand && <TradeDialog view={view} me={me} hand={myHand} legal={legal} onDispatch={run} onClose={() => setDialog(null)} seats={seats} give={tradeGive} onGive={setTradeGive} />}

      {interactive && dialog?.kind === "picker" && <ResourcePicker card={dialog.card} legal={legal} onPlay={run} onClose={() => setDialog(null)} />}

      {/* Wayfarers (docs/phase10.md): the fish sheet and the Neighborly help prompt. */}
      {interactive && dialog?.kind === "fish" && <FishSheet view={view} me={me} legal={legal} onDispatch={run} onMode={setMode} onClose={() => setDialog(null)} />}
      {interactive && neighborly && <NeighborlyDialog view={view} legal={legal} to={neighborly.to} onGive={run} />}

      {/* Crown & Castle (docs/phase11.md §11): the improvement and progress sheets, and the hidden-information prompts. */}
      {interactive && crownOn && dialog?.kind === "improve" && <ImprovementSheet view={view} me={me} legal={legal} onDispatch={run} onClose={() => setDialog(null)} />}
      {interactive && crownOn && dialog?.kind === "progress" && <ProgressSheet view={view} me={me} legal={legal} initial={dialog.card} onDispatch={run} onMode={setMode} onClose={() => setDialog(null)} />}
      {interactive && crownOn && prompt === "discardProgress" && <DiscardProgressDialog view={view} legal={legal} onDispatch={run} />}
      {interactive && crownOn && prompt === "spy" && <SpyDialog view={view} legal={legal} onDispatch={run} />}
      {interactive && crownOn && prompt === "commercialHarbor" && <CommercialSwapDialog view={view} legal={legal} onDispatch={run} />}
      {interactive && crownOn && prompt === "giveCards" && crownHand && <GiveCardsDialog view={view} me={me} hand={crownHand.hand} commodities={crownHand.commodities} legal={legal} onDispatch={run} />}

      {ended && !draining && winner && effectiveSpeed(settings) !== "off" && <Confetti color={winner.color} />}
      {ended && !draining && <EndedOverlay view={view} onPlayAgain={exit} seats={seats} />}
    </div>
  );
}
