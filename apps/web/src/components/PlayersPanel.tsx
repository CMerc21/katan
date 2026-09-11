"use client";

import { isHiddenCount } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { currentPlayerId } from "@/game/labels";
import { Swatch } from "./ui";

/** Players panel (docs/phase3.md §6). */
export function PlayersPanel({ view, me }: { view: RedactedState; me: string }) {
  const current = currentPlayerId(view);
  return (
    <section aria-label="Players" className="border-b border-line">
      <h2 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Players</h2>
      <ul className="px-1 pb-1">
        {view.players.map((p) => {
          const cards = isHiddenCount(p.hand) ? p.hand.count : Object.values(p.hand).reduce((a, b) => a + b, 0);
          const dev = isHiddenCount(p.devCards) ? p.devCards.count : p.devCards.length;
          const acting = p.id === current;
          const vp = p.publicVP + (p.privateVP ?? 0);
          return (
            <li
              key={p.id}
              className={`my-1 rounded-md px-2 py-1.5 ${acting ? "bg-white/50 ring-1 ring-ink/40" : ""}`}
              data-testid={`player-row-${p.id}`}
              aria-current={acting ? "true" : undefined}
            >
              <div className="flex items-center gap-2">
                <Swatch color={p.color} />
                <span className={`truncate ${acting ? "font-semibold" : ""}`}>{p.name}</span>
                {p.id === me && <span className="text-xs text-ink-soft">(you)</span>}
                <span className="ml-auto text-base font-semibold tabular-nums" aria-label={`${vp} victory points`}>
                  {vp}
                  {p.privateVP !== null && p.privateVP > 0 && (
                    <span className="text-xs font-normal text-ink-soft"> ({p.publicVP}+{p.privateVP})</span>
                  )}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                <span>{cards} cards</span>
                <span>{dev} dev</span>
                <span>{p.playedKnights} knights</span>
                {view.longestRoad.playerId === p.id && (
                  <span className="rounded bg-ink px-1 text-parchment">Longest road {view.longestRoad.length}</span>
                )}
                {view.largestArmy.playerId === p.id && (
                  <span className="rounded bg-ink px-1 text-parchment">Largest army {view.largestArmy.count}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
