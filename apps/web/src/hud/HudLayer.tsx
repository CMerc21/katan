"use client";

/**
 * The HUD (docs/phase12.md §1): one absolutely positioned layer over the
 * full-bleed diorama, laid out as a five-region grid. Top: a banner per
 * player. Left: the rail and its side panel. Bottom: the build-cost card,
 * the resource tray with the dice widget, the module strip and the cards
 * panel above it, and the round action buttons. Overlays: the status line,
 * the turn ribbon, event toasts, help tips. Pointer events pass through to
 * the canvas everywhere except on interactive children.
 *
 * Keys: E end turn, T trade, U undo the last build, L log, B build costs,
 * Space skip, Esc closes any panel or targeting mode.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BotLevel } from "@katan/bots";
import { RAIDER_LANDING, isHiddenCount, type Action, type DevCard, type Hand, type ProgressCard } from "@katan/engine";
import type { GameDriver, RedactedState, SeatInfo } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { EVENT_CARD_HELP, EVENT_CARD_LABEL, EVENT_DIE_LABEL, MODE_HINT, PROGRESS_CARD_LABEL, TRACK_LABEL, bannerText, currentPlayerId, playerName } from "@/game/labels";
import type { CrownPick, TargetMode } from "@/board3d/Interaction";
import { CounterOffers, TradeResponse } from "@/components/dialogs";
import { ActionButtons } from "./ActionButtons";
import { BuildCostCard } from "./BuildCostCard";
import { CardsPanel } from "./CardsPanel";
import { DiceWidget } from "./DiceWidget";
import { EventToast, type Toast } from "./EventToast";
import { HelpTipProvider, useTipHandlers } from "./HelpTip";
import { HUD_COPY } from "./hudCopy";
import { Icon } from "./icons";
import { LeftRail, type RailKey } from "./LeftRail";
import { ModuleStrip } from "./ModuleStrip";
import { costRows, devCount, onlyEndTurnLeft, pushRoll, waitingText, type Roll } from "./model";
import { ChatPanel, EmotePanel, InfoPanel, LeavePanel, LogList, StatsPanel, type ChatMessage } from "./panels";
import { PlayerBanner } from "./PlayerBanner";
import { Chip } from "./primitives";
import { ResourceTray, type TrayPicking } from "./ResourceTray";
import { SettingsBody, type ActiveQuality } from "./SettingsMenu";
import { SidePanel } from "./SidePanel";
import { TurnBanner } from "./TurnBanner";
import type { WagonControls } from "./WayfarersActions";

export interface HudLayerProps {
  driver: GameDriver;
  view: RedactedState;
  me: string;
  /** Legal actions while interactive; empty while draining or handed off. */
  legal: Action[];
  seats?: SeatInfo[] | undefined;
  connected?: ReadonlySet<string> | undefined;
  botifiable: ReadonlySet<string>;
  onBotify: (playerId: string, level: BotLevel) => void;
  step: Step | null;
  draining: boolean;
  onSkip: () => void;
  interactive: boolean;
  /** Hidden information is rendered only after the hotseat handoff. */
  revealed: boolean;
  mode: TargetMode;
  onMode: (mode: TargetMode) => void;
  crownPick: CrownPick;
  wagon: WagonControls;
  onDispatch: (action: Action) => void;
  error: string | null;
  waitingOn: string | undefined;
  glint: string | null;
  activeQuality: ActiveQuality;
  toasts: readonly Toast[];
  pushToast: (text: string, kind?: string) => void;
  shiftToast: (id: number) => void;
  /** The trade dialog is composing an offer: tray clicks add to it. */
  tradePicking: TrayPicking | null;
  onTrade: () => void;
  onPickResources: (card: "invention" | "monopoly") => void;
  onFish: () => void;
  onImprove: () => void;
  onProgress: (card?: ProgressCard) => void;
  onExit: () => void;
  onCapability: (fn: (() => Promise<{ ok: boolean; error?: { code: string } }>) | undefined) => void;
  /** A banner is hovered: the board outlines that player's pieces. */
  onHighlight?: ((playerId: string | null) => void) | undefined;
  /** Rendered inside the layer's overlay slot (the fleet pills etc. live in the scene instead). */
  children?: ReactNode;
}

const PANEL_TITLE: Record<RailKey, string> = { chat: "Chat", emote: "Emote", log: "Log", stats: "Stats", info: "Rules", settings: "Settings", leave: "Leave game" };

/** The build-cost card is closed by default and its state is remembered per device. */
const COST_CARD_KEY = "katan.hud.costCard";

function loadCostOpen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(COST_CARD_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCostOpen(open: boolean): void {
  try {
    window.localStorage.setItem(COST_CARD_KEY, open ? "1" : "0");
  } catch {
    // Private mode: the card simply starts closed next time.
  }
}

/** The Build toggle under the cost card: a count badge says how many rows are affordable while the card is closed. */
function CostToggle({ open, affordable, onToggle }: { open: boolean; affordable: number; onToggle: () => void }) {
  const tip = useTipHandlers(
    <>
      <b>{HUD_COPY.actions.costs.label}</b>
      <div>{HUD_COPY.actions.costs.help}</div>
    </>,
  );
  return (
    <button type="button" className="hud-cost-toggle hud-panel hud-interactive" onClick={onToggle} aria-expanded={open} aria-controls="build-cost-card" data-testid="build-costs" data-count={affordable} title={HUD_COPY.actions.costs.help} {...tip}>
      <Icon name="settlement" size={18} />
      <span>{HUD_COPY.actions.costs.label}</span>
      {!open && affordable > 0 && (
        <span className="hud-cost-badge" aria-label={`${affordable} affordable`}>
          {affordable}
        </span>
      )}
      <kbd aria-hidden>B</kbd>
    </button>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}

export function HudLayer(props: HudLayerProps) {
  const { driver, view, me, legal, seats, connected, botifiable, onBotify, step, draining, onSkip, interactive, revealed, mode, onMode, crownPick, wagon, onDispatch, error, waitingOn, glint, activeQuality, toasts, pushToast, shiftToast, tradePicking, onTrade, onPickResources, onFish, onImprove, onProgress, onExit, onCapability, onHighlight, children } = props;
  const [panel, setPanel] = useState<RailKey | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  useEffect(() => setCostOpen(loadCostOpen()), []);
  const toggleCost = useCallback(() => {
    setCostOpen((o) => {
      saveCostOpen(!o);
      return !o;
    });
  }, []);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Online, the driver carries the chat (docs/phase12.md §3); hotseat keeps it on this screen.
  const remoteChat = driver.subscribeChat !== undefined && driver.sendChat !== undefined;
  useEffect(() => {
    if (!driver.subscribeChat) return;
    return driver.subscribeChat((lines) => {
      setMessages(
        lines.map((l) => {
          const p = view.players.find((x) => x.id === l.playerId);
          return { id: l.id, from: p?.name ?? l.playerId, color: p?.color ?? "white", text: l.text };
        }),
      );
    });
    // The players' names and colours are fixed for the game; resubscribing on every view is pointless.
  }, [driver]);
  const [emote, setEmote] = useState<{ text: string; key: number } | null>(null);

  const meView = view.players.find((p) => p.id === me)!;
  const hand: Hand | null = revealed && !isHiddenCount(meView.hand) ? meView.hand : null;
  const devCards: DevCard[] = revealed && !isHiddenCount(meView.devCards) ? meView.devCards : [];
  const crown = view.scenario?.crown === true;
  const commodities = crown ? view.crown?.players[me]?.commodities : undefined;
  const isCurrent = currentPlayerId(view) === me;
  const phase = view.phase;
  const acting = interactive && phase.kind === "action" && isCurrent;
  const specialBuild = interactive && phase.kind === "specialBuild" && phase.order[phase.index] === me;
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const current = currentPlayerId(view);
  const thinking = step?.kind === "thinking" ? step : null;
  const ended = phase.kind === "ended";

  // Banners: the local player first, then seat order.
  const ordered = useMemo(() => [...view.players].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0)), [view.players, me]);

  // Dice history and event toasts from the queue (docs/phase12.md §6).
  useEffect(() => {
    if (step?.kind !== "event") return;
    const e = step.event;
    switch (e.kind) {
      case "diceRolled": {
        const total = e.dice[0] + e.dice[1];
        setRolls((h) => pushRoll(h, { seq: e.seq, dice: [e.dice[0], e.dice[1]], event: e.event ?? null }, Infinity));
        const die = e.event ? ` · ${EVENT_DIE_LABEL[e.event]}` : "";
        if (e.card?.event) pushToast(`${EVENT_CARD_LABEL[e.card.event]}: ${EVENT_CARD_HELP[e.card.event]}`, "event-card");
        else pushToast(`${playerName(view, e.playerId)} rolled ${e.dice[0]} + ${e.dice[1]} = ${total}${die}`, "roll");
        break;
      }
      case "robberMoved":
        pushToast(`${playerName(view, e.by)} moved the robber`, "robber");
        break;
      case "pirateMoved":
        pushToast(`${playerName(view, e.by)} moved the pirate`, "robber");
        break;
      case "islandSettled":
        pushToast(`${playerName(view, e.playerId)} settled a new island (+${e.bonus})`, "island");
        break;
      case "raid":
        pushToast(e.raided.length === 0 ? "The raiders landed and were driven off" : `The raiders landed: ${e.raided.length} hex${e.raided.length === 1 ? "" : "es"} raided`, "raid");
        break;
      case "bootPassed":
        pushToast(`${playerName(view, e.to)} now holds the old boot`, "boot");
        break;
      case "fleetAttacked":
        pushToast(e.result === "defended" ? `The barbarians attacked (${e.strength} vs ${e.defense}) and were repelled` : `The barbarians attacked (${e.strength} vs ${e.defense}) and sacked the realm`, "fleet");
        break;
      case "defenderAwarded":
        pushToast(e.chip ? `${playerName(view, e.playerId)} is Defender of the Realm (+1)` : `${playerName(view, e.playerId)} draws a progress card for the defence`, "defender");
        break;
      case "metropolisPlaced":
        pushToast(`${playerName(view, e.playerId)} ${e.from ? "took" : "founded"} the ${TRACK_LABEL[e.track].toLowerCase()} metropolis (+2)`, "metropolis");
        break;
      case "progressPlayed":
        if (e.playerId !== view.viewer) pushToast(`${playerName(view, e.playerId)} played ${PROGRESS_CARD_LABEL[e.card]}`, "progress");
        break;
      default:
        break;
    }
    // The step identity is the trigger; names are read from the view at that moment.
  }, [step]);

  useEffect(() => {
    if (!emote) return;
    const t = setTimeout(() => setEmote(null), 2500);
    return () => clearTimeout(t);
  }, [emote]);

  // Keyboard (docs/phase12.md §8).
  const endTurnEnabled = acting && has("END_TURN");
  const tradeEnabled = acting && !view.pendingTrade && hand !== null;
  const undoEnabled = interactive && has("UNDO_BUILD");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === "Escape") {
        if (panel) setPanel(null);
        else if (cardsOpen) setCardsOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "e" && endTurnEnabled) onDispatch({ type: "END_TURN", playerId: me });
      else if (k === "t" && tradeEnabled) onTrade();
      else if (k === "u" && undoEnabled) onDispatch({ type: "UNDO_BUILD", playerId: me });
      else if (k === "l") setPanel((p) => (p === "log" ? null : "log"));
      else if (k === "b") toggleCost();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, cardsOpen, endTurnEnabled, tradeEnabled, undoEnabled, onDispatch, onTrade, me, toggleCost]);

  useEffect(() => {
    if (!interactive) setCardsOpen(false);
  }, [interactive]);

  const rows = useMemo(() => costRows(view, me, interactive ? hand : null, legal), [view, me, interactive, hand, legal]);
  const cp = crown ? view.crown?.players[me] : undefined;
  const progressCount = cp ? (Array.isArray(cp.progress) ? cp.progress.length : cp.progress.count) : 0;
  const handCount = crown ? progressCount : revealed ? devCount(meView) : 0;
  const cardsReason = !revealed ? "Take the device first" : handCount === 0 ? (crown ? "You hold no progress cards" : "No development cards") : null;

  const status = draining ? "…" : (waitingText(view, me, waitingOn, seats) ?? bannerText(view, me));
  const togglePanel = useCallback((key: RailKey) => setPanel((p) => (p === key ? null : key)), []);
  const send = useCallback(
    (text: string) => {
      if (remoteChat && driver.sendChat) {
        void driver.sendChat(text).then((r) => {
          if (!r.ok) pushToast(`Message not sent: ${r.error.message}`, "chat-error");
        });
        return;
      }
      setMessages((m) => [...m, { id: Date.now() + m.length, from: meView.name, color: meView.color, text }]);
    },
    [remoteChat, driver, meView.name, meView.color, pushToast],
  );
  const raiders = view.scenario?.variants.raiders ? view.wayfarers?.raiders : null;
  const eventDeck = view.scenario?.variants.eventDeck ? view.wayfarers?.eventDeck : null;

  return (
    <HelpTipProvider>
      <div className="hud-layer" data-testid="hud">
        {/* First in tree order, so they paint under every other HUD element. */}
        <div className="hud-scrim hud-scrim-top" aria-hidden="true" />
        <div className="hud-scrim hud-scrim-bottom" aria-hidden="true" />
        <div className="hud-banners" role="list" aria-label="Players">
          {ordered.map((p) => (
            <PlayerBanner
              key={p.id}
              p={p}
              view={view}
              me={me}
              seat={seats?.find((s) => s.playerId === p.id)}
              acting={p.id === current && !ended}
              thinking={thinking?.playerId === p.id ? thinking.duration : null}
              online={connected ? connected.has(p.id) : null}
              botifiable={botifiable.has(p.id)}
              onBotify={onBotify}
              glint={glint === p.id}
              emote={emote && p.id === me ? emote.text : null}
              onHover={onHighlight}
            />
          ))}
        </div>

        <LeftRail open={panel} onToggle={togglePanel} />
        {panel === "chat" && (
          <SidePanel title={PANEL_TITLE.chat} onClose={() => setPanel(null)} testId="panel-chat">
            <ChatPanel messages={messages} onSend={send} />
          </SidePanel>
        )}
        {panel === "emote" && (
          <SidePanel title={PANEL_TITLE.emote} onClose={() => setPanel(null)} testId="panel-emote">
            <EmotePanel
              onEmote={(text) => {
                setEmote({ text, key: Date.now() });
                setPanel(null);
              }}
            />
          </SidePanel>
        )}
        {panel === "log" ? (
          <SidePanel title={PANEL_TITLE.log} onClose={() => setPanel(null)} testId="panel-log">
            <LogList view={view} />
          </SidePanel>
        ) : (
          <LogList view={view} hidden />
        )}
        {panel === "stats" && (
          <SidePanel title={PANEL_TITLE.stats} onClose={() => setPanel(null)} testId="panel-stats">
            <StatsPanel view={view} rolls={rolls} seats={seats} />
          </SidePanel>
        )}
        {panel === "info" && (
          <SidePanel title={PANEL_TITLE.info} onClose={() => setPanel(null)} testId="panel-info">
            <InfoPanel view={view} />
          </SidePanel>
        )}
        {panel === "settings" && (
          <SidePanel title={PANEL_TITLE.settings} onClose={() => setPanel(null)} testId="panel-settings">
            <SettingsBody showGraphics activeQuality={activeQuality} />
          </SidePanel>
        )}
        {panel === "leave" && (
          <SidePanel title={PANEL_TITLE.leave} onClose={() => setPanel(null)} testId="panel-leave">
            <LeavePanel driver={driver} me={me} seats={seats} ended={ended} onExit={onExit} onCapability={onCapability} />
          </SidePanel>
        )}

        <div className="hud-bottom">
          <div className="relative h-full">
            <div className="absolute bottom-0 flex flex-col items-start gap-2" style={{ left: 48 }}>
              {costOpen && <BuildCostCard rows={rows} mode={mode} onMode={onMode} onDispatch={onDispatch} onImprove={onImprove} onClose={toggleCost} />}
              <CostToggle open={costOpen} affordable={rows.filter((r) => r.affordable).length} onToggle={toggleCost} />
            </div>
          </div>
          <div className="relative">
            <div className="hud-above-tray hud-above-tray-left">
              <DiceWidget step={step} view={view} rolls={rolls.slice(-6)} />
            </div>
            {mode !== null && !draining && (
              <div className="hud-above-tray left-1/2 -translate-x-1/2">
                <Chip testId="mode-hint">
                  {MODE_HINT[mode] ?? "Choose a spot on the board"} · <kbd>Esc</kbd> cancels
                </Chip>
              </div>
            )}
            {interactive && phase.kind === "action" && view.pendingTrade && !isCurrent && (
              <div className="hud-above-tray left-1/2 -translate-x-1/2">
                <div className="hud-panel hud-dark hud-interactive p-2">
                  <TradeResponse view={view} me={me} hand={hand} legal={legal} onDispatch={onDispatch} />
                </div>
              </div>
            )}
            {interactive && phase.kind === "action" && view.pendingTrade?.from === me && view.pendingTrade.counters.length > 0 && (
              <div className="hud-above-tray left-1/2 -translate-x-1/2">
                <div className="hud-panel hud-dark hud-interactive p-2">
                  <CounterOffers view={view} me={me} legal={legal} onDispatch={onDispatch} />
                </div>
              </div>
            )}
            <div className="hud-above-tray hud-above-tray-right flex-col items-end">
              {cardsOpen && revealed && (
                <CardsPanel view={view} me={me} devCards={devCards} legal={legal} draining={draining} onDispatch={onDispatch} onPickResources={onPickResources} onProgress={(card) => onProgress(card)} onClose={() => setCardsOpen(false)} />
              )}
              <ModuleStrip view={view} me={me} hand={interactive ? hand : null} legal={legal} mode={mode} onMode={onMode} onDispatch={onDispatch} wayfarers={view.wayfarers ? { onFish, wagon } : undefined} crownPick={crownPick} acting={acting} specialBuild={specialBuild} />
            </div>
            <ResourceTray hand={hand} commodities={commodities} crown={crown} picking={tradePicking} />
          </div>
          <ActionButtons
            roll={interactive && phase.kind === "roll" && isCurrent ? { enabled: has("ROLL"), reason: "Finish the current step first", onClick: () => onDispatch({ type: "ROLL", playerId: me }) } : null}
            undo={undoEnabled ? { enabled: true, onClick: () => onDispatch({ type: "UNDO_BUILD", playerId: me }) } : null}
            endTurn={{ enabled: endTurnEnabled, reason: acting ? "Finish the current step first" : "Not your turn", onClick: () => onDispatch({ type: "END_TURN", playerId: me }) }}
            endTurnPulse={acting && onlyEndTurnLeft(legal)}
            trade={{ enabled: tradeEnabled, reason: view.pendingTrade ? "An offer is already open" : "Trade on your turn, after rolling", onClick: onTrade }}
            cards={{ enabled: interactive && cardsReason === null, reason: cardsReason ?? "Wait for the animation", onClick: () => setCardsOpen((o) => !o) }}
            cardCount={handCount}
            cardsOpen={cardsOpen}
            specialBuildDone={specialBuild ? { enabled: has("SPECIAL_BUILD_DONE"), onClick: () => onDispatch({ type: "SPECIAL_BUILD_DONE", playerId: me }) } : null}
            draining={draining}
            onSkip={onSkip}
          />
        </div>

        <div className="hud-status hud-panel" aria-live="polite">
          <span data-testid="banner">{status}</span>
          {view.pendingTrade?.from === me && view.pendingTrade.rejectedBy.length > 0 && (
            <span className="hud-dim text-xs" data-testid="declined">
              Declined: {view.pendingTrade.rejectedBy.map((id) => playerName(view, id)).join(", ")}
            </span>
          )}
          {view.pendingTrade?.from === me && view.pendingTrade.counters.length > 0 && (
            <span className="hud-dim text-xs" data-testid="countered">
              Countered: {view.pendingTrade.counters.map((c) => playerName(view, c.from)).join(", ")}
            </span>
          )}
          {error && (
            <span className="text-sm text-[#ff8a80]" role="alert" data-testid="error">
              {error}
            </span>
          )}
        </div>

        {(raiders || eventDeck) && (
          <div className="hud-module-pill hud-panel" data-testid="wayfarers-strip">
            {raiders && (
              <span title="The raiders land when the counter reaches 15; it advances by the number of cities on every seven" data-testid="raider-counter">
                Raiders {raiders.counter}/{RAIDER_LANDING}
                {raiders.raided.length > 0 && <span className="hud-dim" data-testid="raided-count"> · {raiders.raided.length} raided</span>}
              </span>
            )}
            {eventDeck && (
              <span data-testid="deck-remaining" title="Cards left in the event deck before the reshuffle">
                Event deck: {eventDeck.count} cards left
              </span>
            )}
          </div>
        )}

        <TurnBanner step={step} view={view} seats={seats} />
        <EventToast queue={toasts} onShift={shiftToast} />
        {children}
      </div>
    </HelpTipProvider>
  );
}
