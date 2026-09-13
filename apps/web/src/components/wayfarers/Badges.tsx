"use client";

/**
 * Players panel additions for the Wayfarers variants (docs/phase10.md §5):
 * per-player badges (fish, the old boot, coins, the three chips, castle,
 * guards, spice, delivery points, wagon cargo) and a header strip with the
 * raider counter track and the event deck's remaining cards. Each only
 * renders when its variant is on.
 */

import { MAX_GUARDS, RAIDER_LANDING, type VariantChip } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { CHIP_LABEL, CHIP_VP, WAGON_GOOD_LABEL } from "@/game/labels";
import { GOOD_COLOR } from "@/game/theme";

function Badge({ children, title, testId, dark = false }: { children: React.ReactNode; title: string; testId: string; dark?: boolean }) {
  return (
    <span className={`rounded px-1 ${dark ? "bg-ink text-parchment" : "border border-line"}`} title={title} data-testid={testId}>
      {children}
    </span>
  );
}

export function WayfarersBadges({ p, view, glint }: { p: RedactedState["players"][number]; view: RedactedState; glint: boolean }) {
  const variants = view.scenario?.variants;
  const w = view.wayfarers;
  if (!variants || !w) return null;
  const chips: VariantChip[] = [];
  if (variants.rivers && w.rivers?.bridgeBuilder.playerId === p.id) chips.push("bridgeBuilder");
  if (variants.rivers && w.rivers?.poorSettler === p.id) chips.push("poorSettler");
  if (variants.harbormaster && w.harbormaster?.playerId === p.id) chips.push("harbormaster");
  const wagon = w.wagons?.wagons[p.id];
  return (
    <>
      {variants.fishing && w.fishing && (
        <Badge title="Fish" testId={`fish-${p.id}`}>
          {w.fishing.fish[p.id] ?? 0} fish
        </Badge>
      )}
      {variants.fishing && w.fishing?.boot === p.id && (
        <Badge title="The old boot: −1 point until passed on with a trade" testId={`boot-${p.id}`} dark>
          Old boot −1
        </Badge>
      )}
      {variants.rivers && w.rivers && (
        <Badge title="Gold coins from riverside buildings" testId={`coins-${p.id}`}>
          {w.rivers.coins[p.id] ?? 0} coins
        </Badge>
      )}
      {chips.map((chip) => (
        <span key={chip} className={`rounded bg-ink px-1 text-parchment ${glint ? "badge-glint" : ""}`} title={`${CHIP_LABEL[chip]}: ${CHIP_VP[chip] > 0 ? "+" : ""}${CHIP_VP[chip]} points`} data-testid={`chip-${chip}-${p.id}`}>
          {CHIP_LABEL[chip]} {CHIP_VP[chip] > 0 ? `+${CHIP_VP[chip]}` : CHIP_VP[chip]}
        </span>
      ))}
      {variants.raiders && w.raiders && (
        <>
          {w.raiders.castles[p.id] && (
            <Badge title="Castle: +1 point, never raided" testId={`castle-${p.id}`}>
              Castle
            </Badge>
          )}
          <Badge title="Guards posted" testId={`guards-${p.id}`}>
            {w.raiders.guards[p.id]?.length ?? 0}/{MAX_GUARDS} guards
          </Badge>
          {(w.raiders.rebuilt[p.id] ?? 0) > 0 && (
            <Badge title="Raided hexes rebuilt (+1 each)" testId={`rebuilt-${p.id}`}>
              Rebuilt {w.raiders.rebuilt[p.id]}
            </Badge>
          )}
        </>
      )}
      {variants.caravans && w.caravans && (
        <Badge title="Spice from the oases" testId={`spice-${p.id}`}>
          {w.caravans.spice[p.id] ?? 0} spice
        </Badge>
      )}
      {variants.wagons && w.wagons && (
        <>
          <Badge title="Delivery points" testId={`deliveries-${p.id}`}>
            {w.wagons.points[p.id] ?? 0} delivered
          </Badge>
          {wagon && (
            <span className="flex items-center gap-0.5" title={wagon.cargo.length ? `Wagon carrying ${wagon.cargo.map((g) => WAGON_GOOD_LABEL[g].toLowerCase()).join(", ")}` : "Wagon empty"} data-testid={`wagon-${p.id}`} aria-label={`wagon carrying ${wagon.cargo.length} goods`}>
              <span>wagon</span>
              {wagon.cargo.map((g, i) => (
                <span key={i} className="inline-block h-2.5 w-2.5 rounded-sm border border-ink/50" style={{ background: GOOD_COLOR[g] }} />
              ))}
            </span>
          )}
        </>
      )}
    </>
  );
}

/** The raider track and the event deck count above the player rows. */
export function WayfarersStrip({ view }: { view: RedactedState }) {
  const variants = view.scenario?.variants;
  const w = view.wayfarers;
  if (!variants || !w) return null;
  const raiders = variants.raiders ? w.raiders : null;
  const deck = variants.eventDeck ? w.eventDeck : null;
  if (!raiders && !deck) return null;
  return (
    <div className="flex flex-col gap-1 px-3 pb-1 text-xs text-ink-soft" data-testid="wayfarers-strip">
      {raiders && (
        <div className="flex items-center gap-2" title="The raiders land when the counter reaches 15; it advances by the number of cities on every seven">
          <span data-testid="raider-counter">
            Raiders {raiders.counter}/{RAIDER_LANDING}
          </span>
          <span className="flex flex-1 gap-px" role="progressbar" aria-valuemin={0} aria-valuemax={RAIDER_LANDING} aria-valuenow={raiders.counter} aria-label="Raider counter">
            {Array.from({ length: RAIDER_LANDING }, (_, i) => (
              <span key={i} className={`h-2 flex-1 rounded-sm ${i < raiders.counter ? "bg-clay" : "bg-parchment-deep"}`} />
            ))}
          </span>
          {raiders.raided.length > 0 && <span data-testid="raided-count">{raiders.raided.length} raided</span>}
        </div>
      )}
      {deck && (
        <span data-testid="deck-remaining" title="Cards left in the event deck before the reshuffle">
          Event deck: {deck.count} cards left
        </span>
      )}
    </div>
  );
}
