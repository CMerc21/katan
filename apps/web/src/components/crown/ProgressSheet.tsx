"use client";

/**
 * The progress card sheet (docs/rules.md §16.4): your hand, each card with
 * its help line and timing, greyed with a reason when the engine lists no
 * `PLAY_PROGRESS` for it. Cards without a payload play at once; player,
 * resource, commodity and dice payloads are picked here; cards whose payload
 * is a spot on the board hand over to a `progress:<card>` target mode.
 */

import { useState } from "react";
import { COMMODITIES, RESOURCES, isHiddenCount, isHiddenProgress, type Action, type Commodity, type ProgressCard, type Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { TargetMode } from "@/board3d/Interaction";
import { PROGRESS_CARD_HELP, PROGRESS_CARD_LABEL, cardLabel, progressTiming } from "@/game/labels";
import { PLAYER_FILL } from "@/game/theme";
import { CardFace, ProgressCardFace } from "../cards";
import { Button, Modal } from "../ui";

type Play = Extract<Action, { type: "PLAY_PROGRESS" }>;

/** Cards whose payload is picked on the board (docs/phase11.md §11). */
const BOARD_CARDS: ReadonlySet<ProgressCard> = new Set<ProgressCard>(["merchant", "bishop", "intrigue", "engineer", "medicine", "inventor", "diplomat", "smith"]);
const PLAYER_CARDS: ReadonlySet<ProgressCard> = new Set<ProgressCard>(["masterMerchant", "spy", "deserter"]);

/** Why a held card cannot be played right now (docs/rules.md §16.4). */
export function progressReason(view: RedactedState, me: string, card: ProgressCard, revealed: boolean, legal: Action[]): string | null {
  if (revealed) return "Counts automatically";
  if (legal.some((a) => a.type === "PLAY_PROGRESS" && a.card === card)) return null;
  const current = view.players[view.currentPlayer]?.id;
  if (current !== me) return "Not your turn";
  const cp = view.crown?.players[me];
  const timing = progressTiming(card);
  if (view.phase.kind === "roll") {
    if (timing === "after the roll") return "Only after rolling";
    if (cp?.progressPlayedBeforeRoll) return "Only one progress card before the roll";
  } else if (view.phase.kind === "action") {
    if (timing === "before the roll only") return "Only before rolling";
  } else return "Not right now";
  switch (card) {
    case "bishop":
      return "The robber stays home until the barbarians have attacked once";
    case "roadBuilding":
      return "Nowhere to build a road";
    case "medicine":
      return "Needs a settlement, a city piece and 2 ore + grain";
    case "engineer":
      return "No city of yours without a wall";
    case "intrigue":
      return "No opposing knight on a vertex your roads touch";
    case "smith":
      return "No knight of yours can be promoted";
    case "masterMerchant":
    case "spy":
    case "deserter":
    case "wedding":
    case "saboteur":
      return "Nobody to target";
    case "commercialHarbor":
      return "You hold no resource to swap";
    case "inventor":
      return "No two tokens to swap";
    default:
      return "Not right now";
  }
}

export function ProgressSheet({ view, me, legal, initial = null, onDispatch, onMode, onClose }: { view: RedactedState; me: string; legal: Action[]; initial?: ProgressCard | null; onDispatch: (a: Action) => void; onMode: (m: TargetMode) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<ProgressCard | null>(initial);
  const [dice, setDice] = useState<[number, number]>([6, 6]);
  const cp = view.crown?.players[me];
  const hand = cp && !isHiddenProgress(cp.progress) ? cp.progress : [];
  const plays = legal.filter((a): a is Play => a.type === "PLAY_PROGRESS");
  const forCard = (card: ProgressCard) => plays.filter((a) => a.card === card);
  const choose = (card: ProgressCard) => {
    const options = forCard(card);
    const first = options[0];
    if (!first) return;
    if (BOARD_CARDS.has(card)) {
      onMode(`progress:${card}`);
      onClose();
      return;
    }
    if (options.length === 1 && first.payload === undefined) {
      onDispatch(first);
      return;
    }
    setPicked(card);
  };

  const pickerFor = (card: ProgressCard) => {
    const options = forCard(card);
    if (PLAYER_CARDS.has(card)) {
      return (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Choose a player">
          {options.map((a) => {
            const id = a.payload?.targetPlayerId;
            const p = view.players.find((x) => x.id === id);
            if (!p || !id) return null;
            const hand = p.hand;
            const cards = isHiddenCount(hand) ? hand.count : RESOURCES.reduce((n, r) => n + hand[r], 0);
            const progress = view.crown?.players[id]?.progress;
            const held = progress ? (isHiddenProgress(progress) ? progress.count : progress.length) : 0;
            const knights = view.crown?.knights.filter((k) => k.owner === id).length ?? 0;
            return (
              <Button key={id} size="sm" onClick={() => onDispatch(a)} data-testid={`progress-target-${id}`}>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: PLAYER_FILL[p.color] }} />
                {p.name} · {card === "spy" ? `${held} progress cards` : card === "deserter" ? `${knights} knights` : `${cards} cards, ${p.publicVP + (p.privateVP ?? 0)} points`}
              </Button>
            );
          })}
        </div>
      );
    }
    if (card === "alchemist") {
      const a = options.find((o) => o.payload?.dice?.[0] === dice[0] && o.payload?.dice?.[1] === dice[1]);
      return (
        <div className="flex flex-col gap-2" role="group" aria-label="Choose the dice">
          {[0, 1].map((i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="w-16 text-sm">{i === 0 ? "Red die" : "Other die"}</span>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Button key={n} size="sm" variant={dice[i] === n ? "primary" : "secondary"} onClick={() => setDice(i === 0 ? [n, dice[1]] : [dice[0], n])} data-testid={`alchemist-${i}-${n}`}>
                  {n}
                </Button>
              ))}
            </span>
          ))}
          <p className="text-sm text-ink-soft">
            Total {dice[0] + dice[1]}; the red die decides who draws progress cards.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!a} onClick={() => a && onDispatch(a)} data-testid="alchemist-confirm">
              Set the dice
            </Button>
          </div>
        </div>
      );
    }
    // Resource and commodity pickers: monopolies, the Merchant Fleet, the Commercial Harbour.
    const cards: (Resource | Commodity)[] = card === "tradeMonopoly" ? [...COMMODITIES] : card === "resourceMonopoly" || card === "commercialHarbor" ? [...RESOURCES] : [...RESOURCES, ...COMMODITIES];
    const match = (k: Resource | Commodity) => options.find((o) => o.payload?.resource === k || o.payload?.commodity === k || o.payload?.card === k);
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a card type">
        {cards.map((k) => {
          const a = match(k);
          return (
            <Button key={k} size="sm" disabled={!a} reason="Not an option now" className="flex items-center gap-1" onClick={() => a && onDispatch(a)} data-testid={`progress-card-${k}`}>
              <CardFace card={k} size={18} />
              {cardLabel(k)}
            </Button>
          );
        })}
      </div>
    );
  };

  return (
    <Modal title="Progress cards" onClose={onClose} wide>
      {picked === null ? (
        hand.length === 0 ? (
          <p className="text-sm text-ink-soft">You hold no progress cards. Improve a track and match the event die to draw them.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="progress-options">
            {hand.map((held, i) => {
              const why = progressReason(view, me, held.card, held.revealed, legal);
              return (
                <li key={`${held.card}-${i}`}>
                  <Button className="flex w-full items-center gap-3 text-left" variant={why ? "secondary" : "primary"} disabled={why !== null} reason={why} onClick={() => choose(held.card)} data-testid={`play-${held.card}`}>
                    <ProgressCardFace card={held.card} size={30} />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {PROGRESS_CARD_LABEL[held.card]}
                        {held.revealed && <span className="ml-1 text-xs opacity-80">(face up, +1)</span>}
                      </span>
                      <span className="block text-xs font-normal opacity-80">{PROGRESS_CARD_HELP[held.card]}</span>
                      {!held.revealed && <span className="block text-[11px] font-normal opacity-70">Play {progressTiming(held.card)}</span>}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="space-y-3" data-testid={`progress-picker-${picked}`}>
          <p className="text-sm">
            <strong>{PROGRESS_CARD_LABEL[picked]}</strong>: {PROGRESS_CARD_HELP[picked]}
          </p>
          {pickerFor(picked)}
          <div className="flex justify-end">
            <Button variant="quiet" size="sm" onClick={() => setPicked(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
