"use client";

/**
 * The strip above the tray's right half (docs/phase12.md §5, deviations):
 * everything the base layout has no slot for. Tides' Move ship, the
 * Wayfarers buttons, the two-step progress card answers, the withdraw-offer
 * chip. Renders nothing when there is nothing to show.
 */

import type { Action, Hand } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { soloCardAction, type CrownPick, type TargetMode } from "@/board3d/Interaction";
import { Button } from "@/components/ui";
import { moveShipReason } from "./model";
import { WayfarersActions, type WagonControls } from "./WayfarersActions";

export interface ModuleStripProps {
  view: RedactedState;
  me: string;
  hand: Hand | null;
  legal: Action[];
  mode: TargetMode;
  onMode: (m: TargetMode) => void;
  onDispatch: (a: Action) => void;
  wayfarers?: { onFish: () => void; wagon: WagonControls } | undefined;
  crownPick: CrownPick;
  /** My turn, action phase. */
  acting: boolean;
  specialBuild: boolean;
}

export function ModuleStrip({ view, me, hand, legal, mode, onMode, onDispatch, wayfarers, crownPick, acting, specialBuild }: ModuleStripProps) {
  const player = view.players.find((p) => p.id === me);
  if (!player || !hand) return null;
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const solo = soloCardAction(legal, mode, crownPick.first);
  const items: React.ReactNode[] = [];
  if (acting && view.scenario?.tides) {
    const reason = has("MOVE_SHIP") ? null : moveShipReason(player);
    items.push(
      <Button key="move-ship" size="sm" variant={mode === "moveShip" ? "primary" : "secondary"} disabled={reason !== null} reason={reason} aria-pressed={mode === "moveShip"} onClick={() => onMode(mode === "moveShip" ? null : "moveShip")} data-testid="move-ship">
        Move ship
      </Button>,
    );
  }
  if ((acting || specialBuild) && wayfarers && view.wayfarers) {
    items.push(<WayfarersActions key="wayfarers" view={view} me={me} hand={hand} legal={legal} mode={mode} onMode={onMode} onDispatch={onDispatch} onFish={wayfarers.onFish} wagon={wayfarers.wagon} specialBuild={specialBuild} />);
  }
  if (solo && mode === "progress:diplomat") {
    items.push(
      <Button key="diplomat" size="sm" variant="primary" onClick={() => onDispatch(solo)} data-testid="diplomat-remove">
        Remove it without moving
      </Button>,
    );
  }
  if (solo && mode === "progress:smith") {
    items.push(
      <Button key="smith" size="sm" variant="primary" onClick={() => onDispatch(solo)} data-testid="smith-one">
        Promote just this one
      </Button>,
    );
  }
  if (view.pendingTrade?.from === me && has("CANCEL_TRADE")) {
    items.push(
      <Button key="withdraw" size="sm" onClick={() => onDispatch({ type: "CANCEL_TRADE", playerId: me })} data-testid="withdraw-offer">
        Withdraw offer
      </Button>,
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="hud-panel hud-dark hud-interactive flex flex-wrap items-center justify-end gap-1.5 p-1.5" role="group" aria-label="Module actions" data-testid="module-strip">
      {items}
    </div>
  );
}
