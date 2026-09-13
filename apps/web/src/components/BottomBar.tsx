"use client";

import { useEffect, useRef, useState } from "react";
import { COSTS, RESOURCES, isHiddenCount, type Action, type DevCard, type Hand, type Resource } from "@katan/engine";
import type { RedactedState, SeatInfo } from "@/driver/types";
import { COST_TEXT, DEV_CARD_HELP, DEV_CARD_LABEL, MODE_HINT, bannerText, currentPlayerId } from "@/game/labels";
import type { TargetMode } from "@/board3d/Board3D";
import { useAnchor } from "./anim/anchors";
import { Avatar } from "./Avatar";
import { CardBack, DevCardFace } from "./cards";
import { TradeResponse } from "./dialogs";
import { SettingsMenu } from "./SettingsMenu";
import { Button, ResourceChip } from "./ui";
import { WayfarersActions, type WagonControls } from "./wayfarers/WayfarersActions";

export interface BottomBarProps {
  view: RedactedState;
  me: string;
  legal: Action[];
  mode: TargetMode;
  /** Hidden information is only rendered after the hotseat handoff is acknowledged. */
  revealed: boolean;
  error: string | null;
  onDispatch: (action: Action) => void;
  onMode: (mode: TargetMode) => void;
  onTrade: () => void;
  onPickResources: (card: "invention" | "monopoly") => void;
  /** Seat metadata, to say whether the game waits on a bot and to show portraits. */
  seats?: SeatInfo[];
  /** The player the game is waiting for (engine `nextActor`). */
  waitingOn?: string;
  /** Animations are draining: show the skip hint instead of controls (docs/phase7.md §2.1). */
  draining?: boolean;
  onSkip?: () => void;
  /** The 3D board has graphics settings (docs/phase7-5.md §7). */
  showGraphics?: boolean;
  /** Wayfarers (docs/phase10.md): the fish sheet opener and the wagon path state. */
  wayfarers?: { onFish: () => void; wagon: WagonControls };
}

/** The acting player's bar: banner, hand, dev cards, actions (docs/phase3.md §3.2, §5, §6). */
export function BottomBar(props: BottomBarProps) {
  const { view, me, legal, mode, revealed, error, onDispatch, onMode, onTrade, onPickResources, seats, waitingOn, draining = false, onSkip, showGraphics = false, wayfarers } = props;
  const player = view.players.find((p) => p.id === me)!;
  const hand: Hand | null = isHiddenCount(player.hand) ? null : player.hand;
  const devCards: DevCard[] = isHiddenCount(player.devCards) ? [] : player.devCards;
  const phase = view.phase;
  const isCurrent = currentPlayerId(view) === me;
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const seat = seats?.find((s) => s.playerId === me);
  const bankAnchor = useAnchor("bank");
  const deckAnchor = useAnchor("deck");

  return (
    <div className="parchment flex flex-wrap items-center gap-x-5 gap-y-3 px-3 py-2" data-testid="bottom-bar">
      <div className="flex min-w-[12rem] items-center gap-2">
        <Avatar spec={seat?.avatar} color={player.color} name={player.name} size={40} />
        <div className="flex flex-col items-start gap-0.5">
          <span className="font-display text-base font-semibold leading-tight">{player.name}</span>
          <p className="text-sm" aria-live="polite" data-testid="banner">
            {draining ? "…" : (waitingText(view, me, waitingOn, seats) ?? bannerText(view, me))}
          </p>
          {view.pendingTrade?.from === me && view.pendingTrade.rejectedBy.length > 0 && (
            <p className="text-xs text-ink-soft" data-testid="declined">
              Declined: {view.pendingTrade.rejectedBy.map((id) => view.players.find((p) => p.id === id)?.name ?? id).join(", ")}
            </p>
          )}
          {error && (
            <p className="text-sm text-clay" role="alert" data-testid="error">
              {error}
            </p>
          )}
        </div>
      </div>

      {revealed && hand && <HandView hand={hand} />}

      {revealed && devCards.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Development cards">
          {devCards.map((card, i) => {
            const reason = draining ? "Wait for the animation" : devCardReason(view, player.devCardPlayedThisTurn, card, legal, isCurrent);
            const playable = reason === null;
            return (
              <Button
                key={`${card.type}-${card.boughtOnTurn}-${i}`}
                size="sm"
                variant={playable ? "primary" : "secondary"}
                disabled={!playable}
                reason={reason ?? undefined}
                title={playable ? DEV_CARD_HELP[card.type] : (reason ?? undefined)}
                className="flex items-center gap-1.5"
                onClick={() => {
                  if (card.type === "knight") onDispatch({ type: "PLAY_KNIGHT", playerId: me });
                  else if (card.type === "roadBuilding") onDispatch({ type: "PLAY_ROAD_BUILDING", playerId: me });
                  else if (card.type === "invention" || card.type === "monopoly") onPickResources(card.type);
                }}
                data-testid={`dev-${card.type}`}
              >
                <DevCardFace type={card.type} size={18} />
                {DEV_CARD_LABEL[card.type]}
              </Button>
            );
          })}
        </div>
      )}

      {/* Bank and deck anchors: where cards fly from and to. */}
      <div className="flex items-center gap-1" aria-label="Bank" title={`Deck: ${view.devDeck.count} cards`}>
        <span ref={bankAnchor} className="grid h-9 w-7 place-items-center rounded border border-ink/40 bg-parchment-deep text-[10px] font-semibold text-ink-soft">
          bank
        </span>
        <span ref={deckAnchor} className="relative">
          <CardBack size={26} />
          <span className="absolute -right-1 -top-1 rounded-full bg-ink px-1 text-[10px] text-parchment" data-testid="deck-count">
            {view.devDeck.count}
          </span>
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2" aria-label="Actions">
        {draining ? (
          <Button size="sm" variant="quiet" onClick={onSkip} data-testid="skip">
            Skip <kbd className="ml-1 rounded border border-line px-1 text-xs">Space</kbd>
          </Button>
        ) : (
          <>
            {phase.kind === "action" && view.pendingTrade && !isCurrent && <TradeResponse view={view} me={me} legal={legal} onDispatch={onDispatch} />}

            {phase.kind === "roll" && isCurrent && (
              <>
                {has("PLAY_KNIGHT") && <Button onClick={() => onDispatch({ type: "PLAY_KNIGHT", playerId: me })}>Play knight first</Button>}
                <Button variant="primary" onClick={() => onDispatch({ type: "ROLL", playerId: me })} data-testid="roll">
                  Roll dice
                </Button>
              </>
            )}

            {phase.kind === "specialBuild" && phase.order[phase.index] === me && hand && (
              <>
                <BuildButton label="Build road" active={mode === "road"} reason={buildReason(view, player, hand, legal, "road")} onClick={() => onMode(mode === "road" ? null : "road")} testId="build-road" />
                {view.scenario?.tides && <BuildButton label="Build ship" active={mode === "ship"} reason={buildReason(view, player, hand, legal, "ship")} onClick={() => onMode(mode === "ship" ? null : "ship")} testId="build-ship" />}
                <BuildButton label="Build settlement" active={mode === "settlement"} reason={buildReason(view, player, hand, legal, "settlement")} onClick={() => onMode(mode === "settlement" ? null : "settlement")} testId="build-settlement" />
                <BuildButton label="Build city" active={mode === "city"} reason={buildReason(view, player, hand, legal, "city")} onClick={() => onMode(mode === "city" ? null : "city")} testId="build-city" />
                <Button disabled={!has("BUY_DEV_CARD")} reason={buyReason(view, hand)} onClick={() => onDispatch({ type: "BUY_DEV_CARD", playerId: me })} data-testid="buy-dev">
                  Buy development card
                </Button>
                {wayfarers && <WayfarersActions view={view} me={me} hand={hand} legal={legal} mode={mode} onMode={onMode} onDispatch={onDispatch} onFish={wayfarers.onFish} wagon={wayfarers.wagon} specialBuild />}
                <Button variant="primary" onClick={() => onDispatch({ type: "SPECIAL_BUILD_DONE", playerId: me })} data-testid="special-build-done">
                  Done building
                </Button>
              </>
            )}

            {phase.kind === "action" && isCurrent && hand && (
              <>
                <BuildButton label="Build road" active={mode === "road"} reason={buildReason(view, player, hand, legal, "road")} onClick={() => onMode(mode === "road" ? null : "road")} testId="build-road" />
                {view.scenario?.tides && <BuildButton label="Build ship" active={mode === "ship"} reason={buildReason(view, player, hand, legal, "ship")} onClick={() => onMode(mode === "ship" ? null : "ship")} testId="build-ship" />}
                {view.scenario?.tides && <BuildButton label="Move ship" active={mode === "moveShip"} reason={has("MOVE_SHIP") ? null : moveShipReason(player)} onClick={() => onMode(mode === "moveShip" ? null : "moveShip")} testId="move-ship" />}
                <BuildButton label="Build settlement" active={mode === "settlement"} reason={buildReason(view, player, hand, legal, "settlement")} onClick={() => onMode(mode === "settlement" ? null : "settlement")} testId="build-settlement" />
                <BuildButton label="Build city" active={mode === "city"} reason={buildReason(view, player, hand, legal, "city")} onClick={() => onMode(mode === "city" ? null : "city")} testId="build-city" />
                <Button disabled={!has("BUY_DEV_CARD")} reason={buyReason(view, hand)} onClick={() => onDispatch({ type: "BUY_DEV_CARD", playerId: me })} data-testid="buy-dev">
                  Buy development card
                </Button>
                <Button disabled={!!view.pendingTrade} reason="An offer is already open" onClick={onTrade} data-testid="trade">
                  Trade
                </Button>
                {/* Wayfarers (docs/phase10.md): fish, guards, rebuilds, caravans and the wagon. */}
                {wayfarers && <WayfarersActions view={view} me={me} hand={hand} legal={legal} mode={mode} onMode={onMode} onDispatch={onDispatch} onFish={wayfarers.onFish} wagon={wayfarers.wagon} />}
                {view.pendingTrade?.from === me && <Button onClick={() => onDispatch({ type: "CANCEL_TRADE", playerId: me })}>Withdraw offer</Button>}
                <Button variant="primary" disabled={!has("END_TURN")} reason="Finish the current step first" onClick={() => onDispatch({ type: "END_TURN", playerId: me })} data-testid="end-turn">
                  End turn
                </Button>
              </>
            )}

            {mode !== null && (
              <span className="text-sm text-ink-soft" data-testid="mode-hint">
                {MODE_HINT[mode] ?? "Choose a spot on the board"} · <kbd className="rounded border border-line px-1">Esc</kbd> cancels
              </span>
            )}
          </>
        )}
        <SettingsMenu showGraphics={showGraphics} />
      </div>
    </div>
  );
}

/** docs/phase5.md §3: always say who the game is waiting for, and for what. */
export function waitingText(view: RedactedState, me: string, waitingOn: string | undefined, seats: SeatInfo[] | undefined): string | null {
  if (!waitingOn || waitingOn === me || view.phase.kind === "ended") return null;
  const name = view.players.find((p) => p.id === waitingOn)?.name ?? waitingOn;
  const bot = seats?.find((s) => s.playerId === waitingOn)?.kind === "bot" ? " (bot)" : "";
  const who = `${name}${bot}`;
  switch (view.phase.kind) {
    case "setup":
      return `Waiting for ${who} to place a ${view.phase.step}`;
    case "roll":
      return `Waiting for ${who} to roll`;
    case "discard":
      return `Waiting for ${Object.keys(view.pendingDiscards).map((id) => view.players.find((p) => p.id === id)?.name ?? id).join(", ")} to discard`;
    case "moveRobber":
      return view.pirateHex !== null ? `Waiting for ${who} to move the robber or the pirate` : `Waiting for ${who} to move the robber`;
    case "steal":
      return `Waiting for ${who} to steal`;
    case "chooseGold":
      return `Waiting for ${Object.keys(view.phase.owed).map((id) => view.players.find((p) => p.id === id)?.name ?? id).join(", ")} to choose gold`;
    case "roadBuilding":
      return `Waiting for ${who} to place free roads`;
    case "specialBuild":
      return `Waiting for ${who} to build or pass`;
    case "action":
      if (view.pendingTrade && view.pendingTrade.from === me) return `Waiting for ${who} to respond to your trade`;
      if (view.pendingTrade) return null; // I am a responder: the offer card is showing
      return `Waiting for ${who} to build, trade, or end their turn`;
    default:
      return null;
  }
}

function BuildButton({ label, active, reason, onClick, testId }: { label: string; active: boolean; reason: string | null; onClick: () => void; testId: string }) {
  return (
    <Button variant={active ? "primary" : "secondary"} disabled={reason !== null} reason={reason} aria-pressed={active} onClick={onClick} data-testid={testId}>
      {label}
    </Button>
  );
}

function afford(hand: Hand, cost: Hand): boolean {
  return RESOURCES.every((r) => hand[r] >= cost[r]);
}

/** Why a build button is disabled, or null when it is enabled (docs/phase3.md §5). */
export function buildReason(view: RedactedState, player: RedactedState["players"][number], hand: Hand, legal: Action[], kind: "road" | "settlement" | "city" | "ship"): string | null {
  const type = kind === "road" ? "BUILD_ROAD" : kind === "settlement" ? "BUILD_SETTLEMENT" : kind === "ship" ? "BUILD_SHIP" : "BUILD_CITY";
  if (legal.some((a) => a.type === type)) return null;
  if (view.phase.kind !== "action" && view.phase.kind !== "specialBuild") return "Only after rolling";
  const pieces = kind === "road" ? player.pieces.roads : kind === "settlement" ? player.pieces.settlements : kind === "ship" ? player.pieces.ships : player.pieces.cities;
  if (pieces <= 0) return "No pieces of that kind left";
  if (!afford(hand, COSTS[kind])) return `Needs ${COST_TEXT[kind]}`;
  if (kind === "city") return "No settlement to upgrade";
  if (kind === "ship") return "No sea edge joins your ships or settlements";
  return "No legal spot";
}

/** docs/phase9.md §2: why no ship may move right now. */
export function moveShipReason(player: RedactedState["players"][number]): string {
  if (player.ships.length === 0) return "You have no ships";
  if (player.shipMovedThisTurn) return "Only one ship may move per turn";
  return "No ship at an open end can move";
}

function buyReason(view: RedactedState, hand: Hand): string {
  if (view.devDeck.count === 0) return "No development cards left";
  if (!afford(hand, COSTS.devCard)) return `Needs ${COST_TEXT.devCard}`;
  return "Only after rolling";
}

function devCardReason(view: RedactedState, playedThisTurn: boolean, card: DevCard, legal: Action[], isCurrent: boolean): string | null {
  if (card.type === "victoryPoint") return "Counts automatically";
  if (!isCurrent) return "Not your turn";
  const type = card.type === "knight" ? "PLAY_KNIGHT" : card.type === "roadBuilding" ? "PLAY_ROAD_BUILDING" : card.type === "invention" ? "PLAY_INVENTION" : "PLAY_MONOPOLY";
  if (legal.some((a) => a.type === type)) return null;
  if (playedThisTurn) return "Already played a card this turn";
  if (card.boughtOnTurn === view.turn) return "Bought this turn; play it next turn";
  if (view.phase.kind !== "action") return card.type === "knight" ? "Not right now" : "Only after rolling";
  if (card.type === "roadBuilding") return "Nowhere to build a road";
  return "Not right now";
}

function HandStack({ resource, count, bump }: { resource: Resource; count: number; bump: number }) {
  const anchor = useAnchor(`hand:${resource}`);
  return <ResourceChip resource={resource} count={count} animateKey={bump} anchorRef={anchor} />;
}

/** Five resource stacks; a stack that grew bumps its count. */
function HandView({ hand }: { hand: Hand }) {
  const previous = useRef<Hand>(hand);
  const [bumps, setBumps] = useState<Record<Resource, number>>({ wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 });
  useEffect(() => {
    const grew = RESOURCES.filter((r) => hand[r] > previous.current[r]);
    previous.current = hand;
    if (grew.length) setBumps((b) => ({ ...b, ...Object.fromEntries(grew.map((r) => [r, b[r] + 1])) }));
  }, [hand]);
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Your hand" data-testid="hand">
      {RESOURCES.map((r) => (
        <HandStack key={r} resource={r} count={hand[r]} bump={bumps[r]} />
      ))}
    </div>
  );
}
