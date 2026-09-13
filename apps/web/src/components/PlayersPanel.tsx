"use client";

import type { BotLevel } from "@katan/bots";
import { isHiddenCount } from "@katan/engine";
import type { RedactedState, SeatInfo } from "@/driver/types";
import { currentPlayerId } from "@/game/labels";
import { useAnchor } from "./anim/anchors";
import { Avatar } from "./Avatar";
import { Button } from "./ui";
import { WayfarersBadges, WayfarersStrip } from "./wayfarers/Badges";

export interface PlayersPanelProps {
  view: RedactedState;
  me: string;
  /** Seat metadata (bots, portraits, presence timestamps). */
  seats?: SeatInfo[];
  /** Online only: player ids with a live Realtime presence. */
  connected?: ReadonlySet<string>;
  /** Online only, host: a human who may be bot-ified right now (docs/phase5.md §4). */
  botifiable?: ReadonlySet<string>;
  onBotify?: (playerId: string, level: BotLevel) => void;
  /** The bot currently "thinking" (docs/phase7.md §3). */
  thinking?: string | null;
  /** A special card that just moved to this player (glint). */
  glint?: string | null;
}

function PlayerRow({ p, view, me, seat, online, acting, botifiable, onBotify, thinking, glint }: { p: RedactedState["players"][number]; view: RedactedState; me: string; seat: SeatInfo | undefined; online: boolean | null; acting: boolean; botifiable: boolean; onBotify: PlayersPanelProps["onBotify"]; thinking: boolean; glint: boolean }) {
  const anchor = useAnchor(`player:${p.id}`);
  const cards = isHiddenCount(p.hand) ? p.hand.count : Object.values(p.hand).reduce((a, b) => a + b, 0);
  const dev = isHiddenCount(p.devCards) ? p.devCards.count : p.devCards.length;
  const vp = p.publicVP + (p.privateVP ?? 0);
  const isBot = seat?.kind === "bot";
  return (
    <li
      className={`my-1 rounded-md px-2 py-1.5 ${acting ? "bg-white/50 ring-1 ring-ink/40" : ""}`}
      data-testid={`player-row-${p.id}`}
      aria-current={acting ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        <span ref={anchor} className="relative shrink-0">
          <Avatar spec={seat?.avatar} color={p.color} name={p.name} size={34} />
          {thinking && (
            <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full bg-ink px-1 py-0.5" aria-label={`${p.name} is thinking`} data-testid={`thinking-${p.id}`}>
              <span className="thinking-dot block h-1 w-1 rounded-full bg-parchment" />
              <span className="thinking-dot block h-1 w-1 rounded-full bg-parchment" />
              <span className="thinking-dot block h-1 w-1 rounded-full bg-parchment" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className={`block truncate ${acting ? "font-semibold" : ""}`}>
            {p.name}
            {p.id === me && <span className="ml-1 text-xs text-ink-soft">(you)</span>}
          </span>
          <span className="flex items-center gap-1.5">
            {isBot && (
              <span className="rounded border border-line px-1 text-[10px] uppercase tracking-wide text-ink-soft" title="Computer player" data-testid={`bot-badge-${p.id}`}>
                {seat?.botLevel}
              </span>
            )}
            {!isBot && online !== null && seat && (
              <span
                aria-label={online ? "connected" : "disconnected"}
                title={online ? "Connected" : "Disconnected"}
                className={`inline-block h-2 w-2 rounded-full ${online ? "bg-wood" : "bg-clay"}`}
                data-testid={`presence-${p.id}`}
              />
            )}
            {thinking && <span className="text-[10px] text-ink-soft">thinking…</span>}
          </span>
        </span>
        <span className="ml-auto font-display text-lg font-semibold tabular-nums" aria-label={`${vp} victory points`}>
          {vp}
          {p.privateVP !== null && p.privateVP > 0 && (
            <span className="text-xs font-normal text-ink-soft">
              {" "}
              ({p.publicVP}+{p.privateVP})
            </span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-soft">
        <span>{cards} cards</span>
        <span>{dev} dev</span>
        <span>{p.playedKnights} knights</span>
        {p.islandChips.length > 0 && (
          <span className="flex items-center gap-0.5" aria-label={`${p.islandChips.length} island pennants`} title="Islands settled" data-testid={`pennants-${p.id}`}>
            {p.islandChips.map((island) => (
              <span key={island} className="inline-block h-3 w-2 bg-gilt" style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%)" }} />
            ))}
            <span>+{p.islandChips.length * (view.scenario?.islandBonus ?? 0)}</span>
          </span>
        )}
        {view.longestRoad.playerId === p.id && (
          <span className={`rounded bg-ink px-1 text-parchment ${glint ? "badge-glint" : ""}`}>Longest road {view.longestRoad.length}</span>
        )}
        {view.largestArmy.playerId === p.id && (
          <span className={`rounded bg-ink px-1 text-parchment ${glint ? "badge-glint" : ""}`}>Largest army {view.largestArmy.count}</span>
        )}
        {/* Wayfarers (docs/phase10.md): fish, boot, coins, chips, castle, guards, spice, deliveries, cargo. */}
        <WayfarersBadges p={p} view={view} glint={glint} />
        {botifiable && onBotify && (
          <Button size="sm" variant="quiet" className="ml-auto text-xs underline" onClick={() => onBotify(p.id, "medium")} data-testid={`botify-${p.id}`}>
            Let a bot play for {p.name}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Players panel (docs/phase3.md §6, docs/phase5.md §2, §7, docs/phase7.md §4). */
export function PlayersPanel({ view, me, seats, connected, botifiable, onBotify, thinking, glint }: PlayersPanelProps) {
  const current = currentPlayerId(view);
  return (
    <section aria-label="Players" className="ink-rule">
      <h2 className="font-display px-3 pt-2 text-sm font-semibold text-ink-soft">Players</h2>
      {/* Wayfarers (docs/phase10.md): the raider track and the event deck count. */}
      <WayfarersStrip view={view} />
      <ul className="px-1 pb-1">
        {view.players.map((p) => (
          <PlayerRow
            key={p.id}
            p={p}
            view={view}
            me={me}
            seat={seats?.find((s) => s.playerId === p.id)}
            online={connected ? connected.has(p.id) : null}
            acting={p.id === current}
            botifiable={botifiable?.has(p.id) ?? false}
            onBotify={onBotify}
            thinking={thinking === p.id}
            glint={glint === p.id}
          />
        ))}
      </ul>
    </section>
  );
}
