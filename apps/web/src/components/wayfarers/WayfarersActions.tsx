"use client";

/**
 * The bottom bar's Wayfarers buttons (docs/phase10.md §5), each shown only
 * when its variant is on: Fish (opens the spend sheet), Guard and Rebuild
 * (raiders; board target modes), Caravan (board mode on the legal road
 * edges), and the wagon controls (step-by-step vertex picking with Go and
 * Undo, plus Load and Deliver with a good picker). Reasons explain every
 * disabled button, as the base build buttons do (docs/phase3.md §5).
 */

import { useState } from "react";
import { CARAVAN_LENGTH, MAX_GUARDS, WAGON_FREE_STEPS, WAGON_GOODS, type Action, type Hand, type VertexId, type WagonGood } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { wagonMoveFor, type TargetMode } from "@/board3d/Interaction";
import { WAGON_GOOD_LABEL, currentPlayerId } from "@/game/labels";
import { Button } from "../ui";

export interface WagonControls {
  /** Stops picked so far after the wagon's own vertex. */
  readonly path: readonly VertexId[];
  readonly onUndo: () => void;
}

export interface WayfarersActionsProps {
  view: RedactedState;
  me: string;
  hand: Hand;
  legal: Action[];
  mode: TargetMode;
  onMode: (mode: TargetMode) => void;
  onDispatch: (action: Action) => void;
  onFish: () => void;
  wagon: WagonControls;
  /** The special build phase allows guards only (docs/rules.md §15.5). */
  specialBuild?: boolean;
}

function ModeButton({ label, mode, current, reason, onMode, testId }: { label: string; mode: TargetMode; current: TargetMode; reason: string | null; onMode: (m: TargetMode) => void; testId: string }) {
  const active = current === mode;
  return (
    <Button variant={active ? "primary" : "secondary"} disabled={reason !== null} reason={reason} aria-pressed={active} onClick={() => onMode(active ? null : mode)} data-testid={testId}>
      {label}
    </Button>
  );
}

export function WayfarersActions(props: WayfarersActionsProps) {
  const { view, me, hand, legal, mode, onMode, onDispatch, onFish, wagon, specialBuild = false } = props;
  const variants = view.scenario?.variants;
  const w = view.wayfarers;
  const [good, setGood] = useState<"load" | "deliver" | null>(null);
  if (!variants || !w) return null;
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const isCurrent = currentPlayerId(view) === me;

  const guardReason = (): string | null => {
    if (legal.some((a) => a.type === "BUILD_KNIGHT" && a.hex !== undefined)) return null;
    if ((w.raiders?.guards[me]?.length ?? 0) >= MAX_GUARDS) return `All ${MAX_GUARDS} guards are posted`;
    if (hand.ore < 1 || hand.wool < 1) return "Needs ore + wool";
    return "No hex of yours to guard";
  };
  const rebuildReason = (): string | null => {
    if (has("REBUILD_HEX")) return null;
    if ((w.raiders?.raided.length ?? 0) === 0) return "No hex has been raided";
    if (hand.ore < 1 || hand.wool < 1) return "Needs ore + wool";
    return "Only on your turn";
  };
  const caravanReason = (): string | null => {
    if (has("EXTEND_CARAVAN")) return null;
    if ((w.caravans?.spice[me] ?? 0) < 1) return "Needs 1 spice";
    if (w.caravans?.tracks.every((t) => t.edges.length >= CARAVAN_LENGTH)) return "Every caravan has reached its end";
    return "No road of yours continues a caravan";
  };
  const myWagon = w.wagons?.wagons[me];
  const stepsLeft = myWagon ? Math.max(0, WAGON_FREE_STEPS - myWagon.stepsUsed) : 0;
  const moveReason = (): string | null => {
    if (has("MOVE_WAGON")) return null;
    if (!myWagon) return "Your wagon arrives with your second settlement";
    if (stepsLeft === 0 && hand.grain === 0) return "No free steps left; a grain buys one more";
    return "No road leads on from here";
  };
  const goAction = wagonMoveFor(legal, wagon.path);
  const loads = legal.filter((a): a is Extract<Action, { type: "LOAD_COMMODITY" }> => a.type === "LOAD_COMMODITY");
  const delivers = legal.filter((a): a is Extract<Action, { type: "DELIVER" }> => a.type === "DELIVER");
  const loadReason = loads.length > 0 ? null : !myWagon ? "No wagon yet" : myWagon.cargo.length >= 2 ? "The wagon is full" : "Stand at a city with goods waiting";
  const deliverReason = delivers.length > 0 ? null : !myWagon ? "No wagon yet" : myWagon.cargo.length === 0 ? "The wagon carries nothing" : "Stand at another player's city";
  const pickGood = (kind: "load" | "deliver", g: WagonGood) => {
    const a = (kind === "load" ? loads : delivers).find((x) => x.good === g);
    if (a) onDispatch(a);
    setGood(null);
  };

  return (
    <>
      {variants.fishing && w.fishing && (
        <Button disabled={!isCurrent || view.phase.kind !== "action"} reason="Fish are spent on your turn, after rolling" onClick={onFish} data-testid="fish" title={`${w.fishing.fish[me] ?? 0} fish`}>
          Fish <span className="ml-1 rounded-full bg-ink px-1.5 text-xs text-parchment tabular-nums">{w.fishing.fish[me] ?? 0}</span>
        </Button>
      )}
      {variants.raiders && w.raiders && (
        <>
          <ModeButton label={`Post guard (${w.raiders.guards[me]?.length ?? 0}/${MAX_GUARDS})`} mode="guard" current={mode} reason={guardReason()} onMode={onMode} testId="guard" />
          {!specialBuild && <ModeButton label="Rebuild" mode="rebuild" current={mode} reason={rebuildReason()} onMode={onMode} testId="rebuild" />}
        </>
      )}
      {!specialBuild && variants.caravans && w.caravans && <ModeButton label={`Lead caravan (${w.caravans.spice[me] ?? 0} spice)`} mode="caravan" current={mode} reason={caravanReason()} onMode={onMode} testId="caravan" />}
      {!specialBuild && variants.wagons && w.wagons && (
        <>
          <ModeButton label={`Move wagon (${stepsLeft} free)`} mode="wagon" current={mode} reason={moveReason()} onMode={onMode} testId="wagon" />
          {mode === "wagon" && (
            <span className="flex items-center gap-1.5" data-testid="wagon-controls">
              <span className="text-xs text-ink-soft" aria-live="polite" data-testid="wagon-path">
                {wagon.path.length === 0 ? "No stop picked" : `${wagon.path.length} stop${wagon.path.length === 1 ? "" : "s"}${goAction?.grain ? ` · ${goAction.grain} grain` : ""}${goAction?.toll ? ` · toll ${goAction.toll}` : ""}`}
              </span>
              <Button size="sm" disabled={wagon.path.length === 0} onClick={wagon.onUndo} data-testid="wagon-undo">
                Undo
              </Button>
              <Button size="sm" variant="primary" disabled={!goAction} reason="Pick at least one stop" onClick={() => goAction && onDispatch(goAction)} data-testid="wagon-go">
                Go
              </Button>
            </span>
          )}
          <Button disabled={loadReason !== null} reason={loadReason} onClick={() => setGood(good === "load" ? null : "load")} aria-pressed={good === "load"} data-testid="wagon-load">
            Load
          </Button>
          <Button disabled={deliverReason !== null} reason={deliverReason} onClick={() => setGood(good === "deliver" ? null : "deliver")} aria-pressed={good === "deliver"} data-testid="wagon-deliver">
            Deliver
          </Button>
          {good !== null && (
            <span className="flex items-center gap-1" role="group" aria-label={good === "load" ? "Load which good" : "Deliver which good"} data-testid="good-picker">
              {WAGON_GOODS.map((g) => {
                const ok = (good === "load" ? loads : delivers).some((a) => a.good === g);
                return (
                  <Button key={g} size="sm" disabled={!ok} reason={good === "load" ? "Not in stock here" : "Not in the wagon"} onClick={() => pickGood(good, g)} data-testid={`good-${g}`}>
                    {WAGON_GOOD_LABEL[g]}
                  </Button>
                );
              })}
            </span>
          )}
        </>
      )}
    </>
  );
}
