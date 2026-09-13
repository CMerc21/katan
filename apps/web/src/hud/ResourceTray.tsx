"use client";

/**
 * The bottom-centre tray (docs/phase12.md §2): eight icon-only cells, the
 * three commodities only under Crown & Castle. Numerals bump on change and
 * float a ±N; zero cells dim. While a trade offer is being composed, a cell
 * click adds one of that card to the offer.
 */

import type { CommodityHand, Hand, Resource } from "@katan/engine";
import { cardLabel } from "@/game/labels";
import { useAnchor } from "@/components/anim/anchors";
import { Icon } from "./icons";
import { TRAY_CARDS, type TrayCard } from "./model";
import { Numeral } from "./primitives";

export interface TrayPicking {
  /** Cards already in the offer (drawn as a superscript). */
  readonly give: Hand;
  readonly onPick: (resource: Resource) => void;
}

function isResource(card: TrayCard): card is Resource {
  return card !== "cloth" && card !== "coin" && card !== "paper";
}

function Cell({ card, count, picking }: { card: TrayCard; count: number; picking: TrayPicking | null }) {
  const anchor = useAnchor(`hand:${card}`);
  const clickable = picking !== null && isResource(card) && count > 0;
  const picked = picking && isResource(card) ? picking.give[card] : 0;
  return (
    <button
      ref={anchor}
      type="button"
      className="hud-cell"
      data-zero={count === 0 ? "true" : "false"}
      data-clickable={clickable ? "true" : undefined}
      {...(isResource(card) ? { "data-resource": card } : { "data-commodity": card })}
      aria-label={`${count} ${cardLabel(card)}`}
      title={picked ? `${cardLabel(card)}: ${picked} in the offer` : cardLabel(card)}
      disabled={!clickable}
      onClick={() => clickable && picking.onPick(card)}
    >
      <Numeral value={count} />
      <span className="hud-cell-icon">
        <Icon name={card} size={28} tint />
      </span>
      {picked > 0 && (
        <span className="absolute right-1 top-0 rounded bg-[var(--hud-accent)] px-1 text-[11px] font-bold text-black" aria-hidden>
          −{picked}
        </span>
      )}
    </button>
  );
}

export function ResourceTray({ hand, commodities, crown, picking = null }: { hand: Hand | null; commodities?: CommodityHand | undefined; crown: boolean; picking?: TrayPicking | null }) {
  const cards = TRAY_CARDS.filter((c) => crown || isResource(c));
  if (!hand) {
    return (
      <div className="hud-tray hud-panel" aria-label="Your hand is hidden until you take the device" data-testid="resource-tray">
        {cards.map((c) => (
          <span key={c} className="hud-cell" data-zero="true">
            <span className="hud-cell-icon">
              <Icon name={c} size={28} />
            </span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="hud-tray hud-panel" role="group" aria-label="Your cards" data-testid="resource-tray">
      <div className="contents" data-testid="hand" aria-label="Your hand">
        {cards.filter(isResource).map((c) => (
          <Cell key={c} card={c} count={hand[c]} picking={picking} />
        ))}
      </div>
      {crown && commodities && (
        <div className="contents" data-testid="commodities" aria-label="Your commodities">
          {(["cloth", "coin", "paper"] as const).map((c) => (
            <Cell key={c} card={c} count={commodities[c]} picking={null} />
          ))}
        </div>
      )}
    </div>
  );
}
