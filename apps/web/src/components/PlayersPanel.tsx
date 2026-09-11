"use client";

import type { BotLevel } from "@katan/bots";
import { isHiddenCount } from "@katan/engine";
import type { RedactedState, SeatInfo } from "@/driver/types";
import { currentPlayerId } from "@/game/labels";
import { Button, Swatch } from "./ui";

export interface PlayersPanelProps {
  view: RedactedState;
  me: string;
  /** Online only: seat metadata (bots, presence timestamps). */
  seats?: SeatInfo[];
  /** Online only: player ids with a live Realtime presence. */
  connected?: ReadonlySet<string>;
  /** Online only, host: a human who may be bot-ified right now (docs/phase5.md §4). */
  botifiable?: ReadonlySet<string>;
  onBotify?: (playerId: string, level: BotLevel) => void;
}

/** Players panel (docs/phase3.md §6, docs/phase5.md §2, §7). */
export function PlayersPanel({ view, me, seats, connected, botifiable, onBotify }: PlayersPanelProps) {
  const current = currentPlayerId(view);
  const seatOf = (id: string) => seats?.find((s) => s.playerId === id);
  return (
    <section aria-label="Players" className="border-b border-line">
      <h2 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Players</h2>
      <ul className="px-1 pb-1">
        {view.players.map((p) => {
          const cards = isHiddenCount(p.hand) ? p.hand.count : Object.values(p.hand).reduce((a, b) => a + b, 0);
          const dev = isHiddenCount(p.devCards) ? p.devCards.count : p.devCards.length;
          const acting = p.id === current;
          const vp = p.publicVP + (p.privateVP ?? 0);
          const seat = seatOf(p.id);
          const isBot = seat?.kind === "bot";
          const online = connected ? connected.has(p.id) : null;
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
                {isBot && (
                  <span className="rounded border border-line px-1 text-[10px] uppercase tracking-wide text-ink-soft" title="Computer player">
                    bot · {seat?.botLevel}
                  </span>
                )}
                {!isBot && online !== null && seats && (
                  <span
                    aria-label={online ? "connected" : "disconnected"}
                    title={online ? "Connected" : "Disconnected"}
                    className={`inline-block h-2 w-2 rounded-full ${online ? "bg-wood" : "bg-clay"}`}
                    data-testid={`presence-${p.id}`}
                  />
                )}
                <span className="ml-auto text-base font-semibold tabular-nums" aria-label={`${vp} victory points`}>
                  {vp}
                  {p.privateVP !== null && p.privateVP > 0 && (
                    <span className="text-xs font-normal text-ink-soft"> ({p.publicVP}+{p.privateVP})</span>
                  )}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-soft">
                <span>{cards} cards</span>
                <span>{dev} dev</span>
                <span>{p.playedKnights} knights</span>
                {view.longestRoad.playerId === p.id && (
                  <span className="rounded bg-ink px-1 text-parchment">Longest road {view.longestRoad.length}</span>
                )}
                {view.largestArmy.playerId === p.id && (
                  <span className="rounded bg-ink px-1 text-parchment">Largest army {view.largestArmy.count}</span>
                )}
                {botifiable?.has(p.id) && onBotify && (
                  <Button size="sm" variant="quiet" className="ml-auto text-xs underline" onClick={() => onBotify(p.id, "medium")} data-testid={`botify-${p.id}`}>
                    Let a bot play for {p.name}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
