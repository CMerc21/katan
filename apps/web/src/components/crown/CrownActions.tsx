"use client";

/**
 * The bottom bar's Crown & Castle pieces (docs/phase11.md §11): the
 * commodity stacks beside the resources, the progress card row where the
 * development cards used to be, and the action buttons — hire a knight
 * (board mode), pick a knight, improve (the sheet), wall (board mode) and
 * progress (the sheet) — plus the extra answers a two-step card offers
 * (remove a road without moving it, promote just one knight). Reasons
 * explain every disabled button (docs/phase3.md §5).
 */

import { useEffect, useRef, useState } from "react";
import { COMMODITIES, KNIGHTS_PER_LEVEL, MAX_WALLS, isHiddenProgress, type Action, type Commodity, type CommodityHand, type Hand, type ProgressCard } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { soloCardAction, type CrownPick, type TargetMode } from "@/board3d/Interaction";
import { KNIGHT_COST_TEXT, PROGRESS_CARD_HELP, PROGRESS_CARD_LABEL, WALL_COST_TEXT, currentPlayerId } from "@/game/labels";
import { useAnchor } from "../anim/anchors";
import { ProgressCardFace } from "../cards";
import { Button, CommodityChip } from "../ui";
import { progressReason } from "./ProgressSheet";

function CommodityStack({ commodity, count, bump }: { commodity: Commodity; count: number; bump: number }) {
  const anchor = useAnchor(`hand:${commodity}`);
  return <CommodityChip commodity={commodity} count={count} animateKey={bump} anchorRef={anchor} />;
}

/** Three commodity stacks next to the resources; a stack that grew bumps its count. */
export function CrownHandView({ commodities }: { commodities: CommodityHand }) {
  const previous = useRef<CommodityHand>(commodities);
  const [bumps, setBumps] = useState<Record<Commodity, number>>({ cloth: 0, coin: 0, paper: 0 });
  useEffect(() => {
    const grew = COMMODITIES.filter((k) => commodities[k] > previous.current[k]);
    previous.current = commodities;
    if (grew.length) setBumps((b) => ({ ...b, ...Object.fromEntries(grew.map((k) => [k, b[k] + 1])) }));
  }, [commodities]);
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Your commodities" data-testid="commodities">
      {COMMODITIES.map((k) => (
        <CommodityStack key={k} commodity={k} count={commodities[k]} bump={bumps[k]} />
      ))}
    </div>
  );
}

/** Your progress cards as buttons: a playable one opens the sheet on that card; face-up VP cards just count. */
export function ProgressHand({ view, me, legal, draining, onPlay }: { view: RedactedState; me: string; legal: Action[]; draining: boolean; onPlay: (card: ProgressCard) => void }) {
  const cp = view.crown?.players[me];
  if (!cp || isHiddenProgress(cp.progress) || cp.progress.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Progress cards" data-testid="progress-hand">
      {cp.progress.map((held, i) => {
        const reason = draining ? "Wait for the animation" : progressReason(view, me, held.card, held.revealed, legal);
        const playable = reason === null;
        return (
          <Button
            key={`${held.card}-${i}`}
            size="sm"
            variant={playable ? "primary" : "secondary"}
            disabled={!playable}
            reason={reason ?? undefined}
            title={playable ? PROGRESS_CARD_HELP[held.card] : (reason ?? undefined)}
            className="flex items-center gap-1.5"
            onClick={() => onPlay(held.card)}
            data-testid={`progress-${held.card}`}
            data-revealed={held.revealed ? "true" : undefined}
          >
            <ProgressCardFace card={held.card} size={18} />
            {PROGRESS_CARD_LABEL[held.card]}
            {held.revealed && <span className="text-xs">+1</span>}
          </Button>
        );
      })}
    </div>
  );
}

export interface CrownActionsProps {
  view: RedactedState;
  me: string;
  hand: Hand;
  legal: Action[];
  mode: TargetMode;
  pick: CrownPick;
  onMode: (mode: TargetMode) => void;
  onDispatch: (action: Action) => void;
  onImprove: () => void;
  onProgress: () => void;
}

function ModeButton({ label, mode, current, reason, onMode, testId }: { label: string; mode: TargetMode; current: TargetMode; reason: string | null; onMode: (m: TargetMode) => void; testId: string }) {
  const active = current === mode;
  return (
    <Button variant={active ? "primary" : "secondary"} disabled={reason !== null} reason={reason} aria-pressed={active} onClick={() => onMode(active ? null : mode)} data-testid={testId}>
      {label}
    </Button>
  );
}

export function CrownActions(props: CrownActionsProps) {
  const { view, me, hand, legal, mode, pick, onMode, onDispatch, onImprove, onProgress } = props;
  const c = view.crown;
  const cp = c?.players[me];
  const player = view.players.find((p) => p.id === me);
  if (!view.scenario?.crown || !c || !cp || !player) return null;
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const isCurrent = currentPlayerId(view) === me;
  const action = view.phase.kind === "action" && isCurrent;
  const mine = c.knights.filter((k) => k.owner === me);

  const knightReason = (): string | null => {
    if (legal.some((a) => a.type === "BUILD_KNIGHT" && a.vertex !== undefined)) return null;
    if (!action) return "Only on your turn, after rolling";
    if (mine.filter((k) => k.level === 1).length >= KNIGHTS_PER_LEVEL) return "Both basic knight pieces are on the board";
    if (hand.wool < 1 || hand.ore < 1) return `Needs ${KNIGHT_COST_TEXT}`;
    return "No free vertex on your roads";
  };
  const actReason = (): string | null => {
    if (["ACTIVATE_KNIGHT", "PROMOTE_KNIGHT", "KNIGHT_MOVE", "KNIGHT_DISPLACE", "KNIGHT_CHASE_ROBBER"].some((t) => has(t as Action["type"]))) return null;
    if (!action) return "Only on your turn, after rolling";
    if (mine.length === 0) return "You have no knights";
    return "None of your knights can do anything right now";
  };
  const wallReason = (): string | null => {
    if (has("BUILD_WALL")) return null;
    if (!action) return "Only on your turn, after rolling";
    if (cp.walls.length >= MAX_WALLS) return `All ${MAX_WALLS} walls are built`;
    if (player.cities.length === 0) return "Walls go on cities";
    if (hand.clay < 2) return `Needs ${WALL_COST_TEXT}`;
    return "Every city of yours is walled";
  };
  const improveReason = (): string | null => {
    if (has("BUILD_IMPROVEMENT")) return null;
    if (!action) return "Only on your turn, after rolling";
    if (player.cities.length === 0) return "You need a city first";
    return "Not enough commodities for the next level";
  };
  const progressReasonAll = (): string | null => {
    if (has("PLAY_PROGRESS")) return null;
    const held = isHiddenProgress(cp.progress) ? cp.progress.count : cp.progress.filter((h) => !h.revealed).length;
    if (held === 0) return "You hold no progress cards";
    if (!isCurrent) return "Not your turn";
    if (view.phase.kind === "roll" && cp.progressPlayedBeforeRoll) return "Only one progress card before the roll";
    return "None of your cards can be played right now";
  };
  const solo = soloCardAction(legal, mode, pick.first);

  return (
    <>
      {action && (
        <>
          <ModeButton label={`Hire knight (${KNIGHT_COST_TEXT})`} mode="knight" current={mode} reason={knightReason()} onMode={onMode} testId="knight" />
          <ModeButton label="Knights" mode="knightAct" current={mode} reason={actReason()} onMode={onMode} testId="knight-act" />
          <Button disabled={improveReason() !== null} reason={improveReason()} onClick={onImprove} data-testid="improve">
            Improve
          </Button>
          <ModeButton label={`Wall (${WALL_COST_TEXT})`} mode="wall" current={mode} reason={wallReason()} onMode={onMode} testId="wall" />
        </>
      )}
      <Button disabled={progressReasonAll() !== null} reason={progressReasonAll()} onClick={onProgress} data-testid="progress">
        Progress cards
      </Button>
      {solo && mode === "progress:diplomat" && (
        <Button size="sm" variant="primary" onClick={() => onDispatch(solo)} data-testid="diplomat-remove">
          Remove it without moving
        </Button>
      )}
      {solo && mode === "progress:smith" && (
        <Button size="sm" variant="primary" onClick={() => onDispatch(solo)} data-testid="smith-one">
          Promote just this one
        </Button>
      )}
    </>
  );
}
