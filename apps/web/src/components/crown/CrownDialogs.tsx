"use client";

/**
 * The Crown & Castle prompts (docs/phase11.md §11): answers that are a spot
 * on the board come as non-modal sheets (the board stays clickable and the
 * other answers are buttons here); hidden-information answers are modals.
 * Every option comes from the driver's legal list — the Spy's cards in
 * particular are only ever listed by the server (docs/phase11.md §13).
 */

import { useState } from "react";
import { COMMODITIES, RESOURCES, isHiddenProgress, type Action, type CommodityHand, type Hand, type VertexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { COMMODITY_LABEL, PROGRESS_CARD_HELP, PROGRESS_CARD_LABEL, RESOURCE_LABEL, cardLabel, playerName } from "@/game/labels";
import { COMMODITY_COLOR, PLAYER_FILL, RESOURCE_COLOR } from "@/game/theme";
import { CardFace, ProgressCardFace } from "../cards";
import { Button, Modal, Stepper } from "../ui";
import { Sheet } from "./Sheet";

const emptyHand = (): Hand => ({ wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 });
const emptyCommodities = (): CommodityHand => ({ cloth: 0, coin: 0, paper: 0 });
const handTotal = (h: Hand) => RESOURCES.reduce((n, r) => n + h[r], 0);
const goodsTotal = (c: CommodityHand) => COMMODITIES.reduce((n, k) => n + c[k], 0);

function VertexButtons({ actions, label, onDispatch, testPrefix }: { actions: (Action & { vertex: VertexId | null })[]; label: (v: VertexId) => string; onDispatch: (a: Action) => void; testPrefix: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose on the board or here">
      {actions.map((a) =>
        a.vertex === null ? null : (
          <Button key={a.vertex} size="sm" onClick={() => onDispatch(a)} data-testid={`${testPrefix}-${a.vertex}`}>
            {label(a.vertex)}
          </Button>
        ),
      )}
    </div>
  );
}

/** Fleet attack: choose the city that becomes a settlement (docs/rules.md §16.6). */
export function DowngradeDialog({ legal, onDispatch }: { legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "CHOOSE_DOWNGRADE" }> => a.type === "CHOOSE_DOWNGRADE");
  return (
    <Sheet title="The barbarians sacked the realm: choose a city to lose" testId="downgrade-dialog">
      <p className="mb-2 text-xs text-ink-soft">It becomes a settlement again and its wall is lost. A metropolis is safe.</p>
      <VertexButtons actions={choices} label={(v) => `City at ${v}`} onDispatch={onDispatch} testPrefix="downgrade" />
    </Sheet>
  );
}

/** Level 4 (or 5): choose the city for the metropolis (docs/rules.md §16.7). */
export function MetropolisDialog({ view, legal, onDispatch }: { view: RedactedState; legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "PLACE_METROPOLIS" }> => a.type === "PLACE_METROPOLIS");
  const track = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "placeMetropolis" ? view.phase.prompt.track : null;
  return (
    <Sheet title={`Place the ${track ?? ""} metropolis on one of your cities`} testId="metropolis-dialog">
      <p className="mb-2 text-xs text-ink-soft">Worth 2 points; the barbarians cannot sack it.</p>
      <VertexButtons actions={choices} label={(v) => `City at ${v}`} onDispatch={onDispatch} testPrefix="metropolis" />
    </Sheet>
  );
}

/** Deserter: the victim chooses which knight leaves (docs/rules.md §16.4). */
export function DeserterDialog({ view, legal, onDispatch }: { view: RedactedState; legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "CHOOSE_DESERTER" }> => a.type === "CHOOSE_DESERTER");
  const by = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "deserter" ? view.phase.prompt.by : null;
  const levelAt = (v: VertexId) => view.crown?.knights.find((k) => k.at === v)?.level ?? 1;
  return (
    <Sheet title={`${by ? playerName(view, by) : "Someone"} played the Deserter: choose a knight to lose`} testId="deserter-dialog">
      <VertexButtons actions={choices} label={(v) => `Level ${levelAt(v)} knight at ${v}`} onDispatch={onDispatch} testPrefix="deserter" />
    </Sheet>
  );
}

/** Deserter: the card's player places the free knight, or nowhere (docs/rules.md §16.4). */
export function FreeKnightDialog({ legal, onDispatch }: { legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "PLACE_FREE_KNIGHT" }> => a.type === "PLACE_FREE_KNIGHT");
  const nowhere = choices.find((a) => a.vertex === null);
  return (
    <Sheet title="Place your free knight on your road network" testId="free-knight-dialog">
      <div className="flex flex-wrap items-center gap-1.5">
        <VertexButtons actions={choices} label={(v) => `At ${v}`} onDispatch={onDispatch} testPrefix="free-knight" />
        {nowhere && (
          <Button size="sm" variant="quiet" onClick={() => onDispatch(nowhere)} data-testid="free-knight-nowhere">
            Place nowhere
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** A displaced knight retreats to a vertex of its owner's choice, or is lost (docs/rules.md §16.5). */
export function RetreatDialog({ legal, onDispatch }: { legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "RETREAT_KNIGHT" }> => a.type === "RETREAT_KNIGHT");
  const lose = choices.find((a) => a.vertex === null);
  return (
    <Sheet title="Your knight was driven off: choose where it retreats" testId="retreat-dialog">
      <div className="flex flex-wrap items-center gap-1.5">
        <VertexButtons actions={choices} label={(v) => `To ${v}`} onDispatch={onDispatch} testPrefix="retreat" />
        {lose && (
          <Button size="sm" variant="quiet" onClick={() => onDispatch(lose)} data-testid="retreat-lose">
            Lose the knight
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Over the hand limit: return cards to the bottom of their decks (docs/rules.md §16.2). */
export function DiscardProgressDialog({ view, legal, onDispatch }: { view: RedactedState; legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "DISCARD_PROGRESS" }> => a.type === "DISCARD_PROGRESS");
  const count = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "discardProgress" ? view.phase.prompt.count : 1;
  return (
    <Modal title={`Discard ${count} progress card${count === 1 ? "" : "s"}`}>
      <p className="mb-3 text-sm text-ink-soft">You may hold four; face-up victory point cards do not count.</p>
      <ul className="space-y-1.5" data-testid="discard-progress-options">
        {choices.map((a) => (
          <li key={a.card}>
            <Button className="flex w-full items-center gap-3 text-left" onClick={() => onDispatch(a)} data-testid={`discard-progress-${a.card}`}>
              <ProgressCardFace card={a.card} size={26} />
              <span className="min-w-0">
                <span className="block font-medium">{PROGRESS_CARD_LABEL[a.card]}</span>
                <span className="block text-xs font-normal opacity-80">{PROGRESS_CARD_HELP[a.card]}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Spy: the target's cards, as the server listed them (docs/phase11.md §13). */
export function SpyDialog({ view, legal, onDispatch }: { view: RedactedState; legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "SPY_TAKE" }> => a.type === "SPY_TAKE");
  const target = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "spy" ? view.phase.prompt.target : null;
  const progress = target ? view.crown?.players[target]?.progress : undefined;
  const held = progress ? (isHiddenProgress(progress) ? progress.count : progress.length) : 0;
  return (
    <Modal title={`Spy: ${target ? playerName(view, target) : "their"} progress cards`}>
      <p className="mb-3 text-sm text-ink-soft">
        They hold {held}. Take one of these{choices.length === 0 ? " (waiting for the server's list…)" : ""}:
      </p>
      <ul className="space-y-1.5" data-testid="spy-options">
        {choices.map((a) => (
          <li key={a.card}>
            <Button className="flex w-full items-center gap-3 text-left" variant="primary" onClick={() => onDispatch(a)} data-testid={`spy-${a.card}`}>
              <ProgressCardFace card={a.card} size={26} />
              <span className="min-w-0">
                <span className="block font-medium">{PROGRESS_CARD_LABEL[a.card]}</span>
                <span className="block text-xs font-normal opacity-80">{PROGRESS_CARD_HELP[a.card]}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Commercial Harbour: hand over a commodity for the card's resource (docs/rules.md §16.4). */
export function CommercialSwapDialog({ view, legal, onDispatch }: { view: RedactedState; legal: Action[]; onDispatch: (a: Action) => void }) {
  const choices = legal.filter((a): a is Extract<Action, { type: "COMMERCIAL_SWAP" }> => a.type === "COMMERCIAL_SWAP");
  const prompt = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "commercialHarbor" ? view.phase.prompt : null;
  return (
    <Modal title="Commercial harbour">
      <p className="mb-3 text-sm text-ink-soft">
        {prompt ? `${playerName(view, prompt.by)} offers ${RESOURCE_LABEL[prompt.resource].toLowerCase()}` : "Hand over a commodity"}: you must swap one of your commodities for it.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Hand over">
        {COMMODITIES.map((k) => {
          const a = choices.find((x) => x.commodity === k);
          return (
            <Button key={k} size="sm" disabled={!a} reason="You hold none" className="flex items-center gap-1" onClick={() => a && onDispatch(a)} data-testid={`swap-${k}`}>
              <CardFace card={k} size={18} />
              {COMMODITY_LABEL[k]}
            </Button>
          );
        })}
      </div>
    </Modal>
  );
}

/** Wedding: give `count` cards of your choice, resources and commodities alike (docs/rules.md §16.4). */
export function GiveCardsDialog({ view, me, hand, commodities, legal, onDispatch }: { view: RedactedState; me: string; hand: Hand; commodities: CommodityHand; legal: Action[]; onDispatch: (a: Action) => void }) {
  const prompt = view.phase.kind === "modulePrompt" && view.phase.prompt.kind === "giveCards" ? view.phase.prompt : null;
  const count = prompt?.count ?? 1;
  const [cards, setCards] = useState<Hand>(emptyHand);
  const [goods, setGoods] = useState<CommodityHand>(emptyCommodities);
  const chosen = handTotal(cards) + goodsTotal(goods);
  const left = count - chosen;
  const action = legal.find((a) => a.type === "GIVE_CARDS" && RESOURCES.every((r) => a.cards[r] === cards[r]) && COMMODITIES.every((k) => (a.commodities?.[k] ?? 0) === goods[k]));
  const fallback: Action = { type: "GIVE_CARDS", playerId: me, cards, ...(goodsTotal(goods) > 0 ? { commodities: goods } : {}) };
  return (
    <Modal title={`Wedding gift: give ${count} card${count === 1 ? "" : "s"}`}>
      <p className="mb-3 text-sm text-ink-soft">{prompt ? `${playerName(view, prompt.to)} has fewer points than you and celebrates a wedding.` : ""} Choose which cards to give.</p>
      <div className="space-y-2">
        {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
          <Stepper key={r} label={RESOURCE_LABEL[r]} accent={RESOURCE_COLOR[r]} value={cards[r]} min={0} max={Math.min(hand[r], cards[r] + left)} onChange={(n) => setCards({ ...cards, [r]: n })} />
        ))}
        {COMMODITIES.filter((k) => commodities[k] > 0).map((k) => (
          <Stepper key={k} label={cardLabel(k)} accent={COMMODITY_COLOR[k]} value={goods[k]} min={0} max={Math.min(commodities[k], goods[k] + left)} onChange={(n) => setGoods({ ...goods, [k]: n })} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm tabular-nums" aria-live="polite">
          {chosen} of {count} chosen
        </span>
        <Button variant="primary" disabled={chosen !== count} reason="Choose the exact number" onClick={() => onDispatch(action ?? fallback)} data-testid="give-confirm">
          Give {count} card{count === 1 ? "" : "s"}
        </Button>
      </div>
      {prompt && (
        <p className="mt-2 text-xs text-ink-soft">
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: PLAYER_FILL[view.players.find((p) => p.id === prompt.to)?.color ?? "white"] }} />
          To {playerName(view, prompt.to)}
        </p>
      )}
    </Modal>
  );
}
