"use client";

/**
 * The Cards panel (docs/phase12.md §5): opened by the small round button.
 * Base game: the development cards as playable buttons with reasons. Crown
 * & Castle: the progress cards (a playable one opens the sheet on that
 * card; face-up point cards just count).
 */

import { isHiddenProgress, type Action, type DevCard, type ProgressCard } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { DEV_CARD_HELP, DEV_CARD_LABEL, PROGRESS_CARD_HELP, PROGRESS_CARD_LABEL, currentPlayerId } from "@/game/labels";
import { DevCardFace, ProgressCardFace } from "@/components/cards";
import { progressReason } from "@/components/crown/ProgressSheet";
import { Button } from "@/components/ui";
import { useOpenSound } from "./primitives";

function devCardReason(view: RedactedState, playedThisTurn: boolean, card: DevCard, legal: readonly Action[], isCurrent: boolean): string | null {
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

export interface CardsPanelProps {
  view: RedactedState;
  me: string;
  devCards: readonly DevCard[];
  legal: Action[];
  draining: boolean;
  onDispatch: (a: Action) => void;
  onPickResources: (card: "invention" | "monopoly") => void;
  onProgress: (card: ProgressCard) => void;
  onClose: () => void;
}

export function CardsPanel({ view, me, devCards, legal, draining, onDispatch, onPickResources, onProgress, onClose }: CardsPanelProps) {
  useOpenSound();
  const crown = view.scenario?.crown === true;
  const player = view.players.find((p) => p.id === me)!;
  const isCurrent = currentPlayerId(view) === me;
  const cp = crown ? view.crown?.players[me] : undefined;
  const progress = cp && !isHiddenProgress(cp.progress) ? cp.progress : [];
  return (
    <div className="hud-panel hud-dark hud-interactive flex max-w-[560px] flex-wrap items-center justify-end gap-1.5 p-2" role="dialog" aria-label={crown ? "Progress cards" : "Development cards"} data-testid={crown ? "progress-hand" : "dev-hand"}>
      {!crown && devCards.length === 0 && <span className="text-sm text-ink-soft">No development cards yet.</span>}
      {!crown &&
        devCards.map((card, i) => {
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
      {crown && progress.length === 0 && <span className="text-sm text-ink-soft">No progress cards yet.</span>}
      {crown &&
        progress.map((held, i) => {
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
              onClick={() => onProgress(held.card)}
              data-testid={`progress-${held.card}`}
              data-revealed={held.revealed ? "true" : undefined}
            >
              <ProgressCardFace card={held.card} size={18} />
              {PROGRESS_CARD_LABEL[held.card]}
              {held.revealed && <span className="text-xs">+1</span>}
            </Button>
          );
        })}
      <button type="button" className="hud-close" aria-label="Close cards" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
