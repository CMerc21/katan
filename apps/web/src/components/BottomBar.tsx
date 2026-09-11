"use client";

import { useEffect, useRef, useState } from "react";
import { COSTS, RESOURCES, isHiddenCount, type Action, type DevCard, type Hand, type Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { COST_TEXT, DEV_CARD_HELP, DEV_CARD_LABEL, bannerText, currentPlayerId } from "@/game/labels";
import type { TargetMode } from "./Board";
import { TradeResponse } from "./dialogs";
import { Button, PlayerTag, ResourceChip } from "./ui";

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
}

/** The acting player's bar: banner, hand, dev cards, actions (docs/phase3.md §3.2, §5, §6). */
export function BottomBar(props: BottomBarProps) {
  const { view, me, legal, mode, revealed, error, onDispatch, onMode, onTrade, onPickResources } = props;
  const player = view.players.find((p) => p.id === me)!;
  const hand: Hand | null = isHiddenCount(player.hand) ? null : player.hand;
  const devCards: DevCard[] = isHiddenCount(player.devCards) ? [] : player.devCards;
  const phase = view.phase;
  const isCurrent = currentPlayerId(view) === me;
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line bg-parchment-deep/60 px-3 py-2" data-testid="bottom-bar">
      <div className="flex min-w-[12rem] flex-col items-start gap-1">
        <PlayerTag name={player.name} color={player.color} />
        <p className="text-sm" aria-live="polite" data-testid="banner">
          {bannerText(view, me)}
        </p>
        {error && (
          <p className="text-sm text-clay" role="alert" data-testid="error">
            {error}
          </p>
        )}
      </div>

      {revealed && hand && <HandView hand={hand} />}

      {revealed && devCards.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Development cards">
          {devCards.map((card, i) => {
            const reason = devCardReason(view, player.devCardPlayedThisTurn, card, legal, isCurrent);
            const playable = reason === null;
            return (
              <Button
                key={`${card.type}-${card.boughtOnTurn}-${i}`}
                size="sm"
                variant={playable ? "primary" : "secondary"}
                disabled={!playable}
                reason={reason ?? undefined}
                title={playable ? DEV_CARD_HELP[card.type] : (reason ?? undefined)}
                onClick={() => {
                  if (card.type === "knight") onDispatch({ type: "PLAY_KNIGHT", playerId: me });
                  else if (card.type === "roadBuilding") onDispatch({ type: "PLAY_ROAD_BUILDING", playerId: me });
                  else if (card.type === "invention" || card.type === "monopoly") onPickResources(card.type);
                }}
                data-testid={`dev-${card.type}`}
              >
                {DEV_CARD_LABEL[card.type]}
              </Button>
            );
          })}
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2" aria-label="Actions">
        {phase.kind === "action" && view.pendingTrade && !isCurrent && (
          <TradeResponse view={view} me={me} legal={legal} onDispatch={onDispatch} />
        )}

        {phase.kind === "roll" && isCurrent && (
          <>
            {has("PLAY_KNIGHT") && (
              <Button onClick={() => onDispatch({ type: "PLAY_KNIGHT", playerId: me })}>Play knight first</Button>
            )}
            <Button variant="primary" onClick={() => onDispatch({ type: "ROLL", playerId: me })} data-testid="roll">
              Roll dice
            </Button>
          </>
        )}

        {phase.kind === "action" && isCurrent && hand && (
          <>
            <BuildButton label="Build road" active={mode === "road"} reason={buildReason(view, player, hand, legal, "road")} onClick={() => onMode(mode === "road" ? null : "road")} testId="build-road" />
            <BuildButton label="Build settlement" active={mode === "settlement"} reason={buildReason(view, player, hand, legal, "settlement")} onClick={() => onMode(mode === "settlement" ? null : "settlement")} testId="build-settlement" />
            <BuildButton label="Build city" active={mode === "city"} reason={buildReason(view, player, hand, legal, "city")} onClick={() => onMode(mode === "city" ? null : "city")} testId="build-city" />
            <Button disabled={!has("BUY_DEV_CARD")} reason={buyReason(view, hand)} onClick={() => onDispatch({ type: "BUY_DEV_CARD", playerId: me })} data-testid="buy-dev">
              Buy development card
            </Button>
            <Button disabled={!!view.pendingTrade} reason="An offer is already open" onClick={onTrade} data-testid="trade">
              Trade
            </Button>
            {view.pendingTrade?.from === me && (
              <Button onClick={() => onDispatch({ type: "CANCEL_TRADE", playerId: me })}>Withdraw offer</Button>
            )}
            <Button variant="primary" disabled={!has("END_TURN")} reason="Finish the current step first" onClick={() => onDispatch({ type: "END_TURN", playerId: me })} data-testid="end-turn">
              End turn
            </Button>
          </>
        )}

        {mode !== null && (
          <span className="text-sm text-ink-soft">
            Choose a spot on the board · <kbd className="rounded border border-line px-1">Esc</kbd> cancels
          </span>
        )}
      </div>
    </div>
  );
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
export function buildReason(
  view: RedactedState,
  player: RedactedState["players"][number],
  hand: Hand,
  legal: Action[],
  kind: "road" | "settlement" | "city",
): string | null {
  const type = kind === "road" ? "BUILD_ROAD" : kind === "settlement" ? "BUILD_SETTLEMENT" : "BUILD_CITY";
  if (legal.some((a) => a.type === type)) return null;
  if (view.phase.kind !== "action") return "Only after rolling";
  const pieces = kind === "road" ? player.pieces.roads : kind === "settlement" ? player.pieces.settlements : player.pieces.cities;
  if (pieces <= 0) return "No pieces of that kind left";
  if (!afford(hand, COSTS[kind])) return `Needs ${COST_TEXT[kind]}`;
  if (kind === "city") return "No settlement to upgrade";
  return "No legal spot";
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

/** Five resource stacks; a stack that grew slides in (the page's single motion effect). */
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
        <ResourceChip key={r} resource={r} count={hand[r]} animateKey={bumps[r]} />
      ))}
    </div>
  );
}
