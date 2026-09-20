"use client";

/**
 * One player's banner (docs/phase12.md §1), laid out like a table-top
 * scoreboard: VP badge over the portrait, gold turn marker, a player-colour
 * name ribbon with the bot glyph and, under Crown & Castle, the three city
 * improvement tracks as tall pip columns at the ribbon's end (the level of
 * each track and its metropolis are readable from across the table), two
 * pills hanging under the portrait, and a five column stat block of numeral
 * over glyph ending with the hand. Hovering the banner opens a detailed tip
 * after 300 ms. Wayfarers badges ride in an extra row under the block, since
 * those variants carry state the columns do not cover.
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { BotLevel } from "@katan/bots";
import { MAX_LEVEL, MAX_WALLS, TRACKS, isHiddenProgress, type PlayerColor, type ProgressCard, type RedactedCrownPlayer, type VariantChip } from "@katan/engine";
import type { RedactedState, SeatInfo } from "@/driver/types";
import { CHIP_LABEL, CHIP_VP, COMMODITY_LABEL, PROGRESS_CARD_LABEL, TRACK_ABILITY, TRACK_LABEL, WAGON_GOOD_LABEL } from "@/game/labels";
import { GOOD_COLOR, TRACK_COLOR } from "@/game/theme";
import { useAnchor } from "@/components/anim/anchors";
import { Avatar } from "@/components/Avatar";
import { MAX_GUARDS } from "@katan/engine";
import { HUD_COPY } from "./hudCopy";
import { Icon } from "./icons";
import { useTipHandlers } from "./HelpTip";
import { bannerStats, type RedactedPlayer } from "./model";
import { BotifyButton } from "./panels";
import { Numeral } from "./primitives";

/** Banner tints match the pieces on the table; argent gets a slate ribbon so white text reads. */
export const HUD_PLAYER_COLOR: Record<PlayerColor, string> = {
  red: "var(--player-red)",
  blue: "var(--player-blue)",
  orange: "var(--player-gold)",
  white: "var(--player-silver)",
  green: "var(--player-green)",
  brown: "var(--player-brown)",
};

export interface PlayerBannerProps {
  p: RedactedPlayer;
  view: RedactedState;
  me: string;
  seat: SeatInfo | undefined;
  acting: boolean;
  /** The bot is thinking: show the gold progress bar for this long. */
  thinking: number | null;
  online: boolean | null;
  botifiable: boolean;
  /** Milliseconds this player has been away while the game waits on them, or null. */
  away?: number | null | undefined;
  /** The lobby's absent threshold, for the chip's "bot at N min". */
  absentAfter?: number | null | undefined;
  onBotify?: ((playerId: string, level: BotLevel) => void) | undefined;
  glint: boolean;
  emote: string | null;
  /** Hovering the banner outlines that player's pieces on the board. */
  onHover?: ((playerId: string | null) => void) | undefined;
}

/**
 * The three improvement tracks (docs/rules.md §16.3, §16.7) as pip columns in
 * the track colours, one pip per level from the bottom, the third pip ringed
 * in gold (the level that unlocks the track's ability) and the whole column
 * ringed in gold while the player holds that track's metropolis.
 */
export function TriTrack({ cp, id }: { cp: RedactedCrownPlayer; id: string }) {
  return (
    <span className="hud-tracks" aria-label={TRACKS.map((t) => `${TRACK_LABEL[t]} level ${cp.tracks[t]}${cp.metropolises[t] ? " with the metropolis" : ""}`).join(", ")} title={TRACKS.map((t) => `${TRACK_LABEL[t]} ${cp.tracks[t]}/${MAX_LEVEL}`).join(" · ")} data-testid={`tracks-${id}`}>
      {TRACKS.map((t) => (
        <span key={t} data-track={t} data-level={cp.tracks[t]} data-metropolis={cp.metropolises[t] ? "true" : undefined} style={{ "--track": TRACK_COLOR[t] } as CSSProperties}>
          {Array.from({ length: MAX_LEVEL }, (_, i) => (
            <i key={i} data-reached={i < cp.tracks[t] ? "true" : "false"} data-unlock={i === 2 ? "true" : undefined} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Everything the tip lists (goods, progress cards by track, walls, wayfarers state). */
function detail(view: RedactedState, p: RedactedPlayer): ReactNode {
  const c = view.scenario?.crown === true ? view.crown : null;
  const cp = c?.players[p.id];
  const w = view.wayfarers;
  const v = view.scenario?.variants;
  const items: ReactNode[] = [];
  if (cp) {
    items.push(<li key="goods">Goods: {(["cloth", "coin", "paper"] as const).map((k) => `${cp.commodities[k]} ${COMMODITY_LABEL[k].toLowerCase()}`).join(", ")}</li>);
    const held: ProgressCard[] = isHiddenProgress(cp.progress) ? cp.progress.revealed : cp.progress.map((h) => h.card);
    const hiddenCount = isHiddenProgress(cp.progress) ? cp.progress.count - cp.progress.revealed.length : 0;
    items.push(
      <li key="progress">
        Progress cards: {held.length ? held.map((card) => PROGRESS_CARD_LABEL[card]).join(", ") : "none"}
        {hiddenCount > 0 ? ` (+${hiddenCount} hidden)` : ""}
      </li>,
    );
    items.push(<li key="tracks">{TRACKS.map((t) => `${TRACK_LABEL[t]} ${cp.tracks[t]}/${MAX_LEVEL}${cp.metropolises[t] ? " (metropolis)" : ""}`).join(" · ")}</li>);
    items.push(<li key="ability">{TRACKS.filter((t) => cp.tracks[t] >= 3).map((t) => TRACK_ABILITY[t]).join(" ") || "No track abilities yet"}</li>);
    items.push(
      <li key="walls">
        Walls {cp.walls.length}/{MAX_WALLS} (discard limit {7 + 2 * cp.walls.length})
      </li>,
    );
    if (cp.defenderChips > 0) items.push(<li key="def">Defender of the Realm ×{cp.defenderChips}</li>);
    if (c?.merchant?.playerId === p.id) items.push(<li key="merchant">Holds the merchant (+1)</li>);
  } else {
    items.push(<li key="army">Knights played: {p.playedKnights}</li>);
    if (view.largestArmy.playerId === p.id) items.push(<li key="la">{HUD_COPY.titles.largestArmy}</li>);
  }
  if (view.longestRoad.playerId === p.id) items.push(<li key="lr">Longest road: {view.longestRoad.length}</li>);
  items.push(
    <li key="pieces">
      Pieces left: {p.pieces.roads} roads, {p.pieces.settlements} settlements, {p.pieces.cities} cities
      {view.scenario?.tides ? `, ${p.pieces.ships} ships` : ""}
    </li>,
  );
  if (p.islandChips.length > 0) items.push(<li key="islands">Islands settled: {p.islandChips.length}</li>);
  if (w && v) {
    if (v.fishing && w.fishing) items.push(<li key="fish">Fish: {w.fishing.fish[p.id] ?? 0}{w.fishing.boot === p.id ? " · holds the old boot" : ""}</li>);
    if (v.rivers && w.rivers) items.push(<li key="coins">Coins: {w.rivers.coins[p.id] ?? 0}</li>);
    if (v.raiders && w.raiders) items.push(<li key="guards">Guards {w.raiders.guards[p.id]?.length ?? 0}/{MAX_GUARDS}{w.raiders.castles[p.id] ? " · castle" : ""}</li>);
    if (v.caravans && w.caravans) items.push(<li key="spice">Spice: {w.caravans.spice[p.id] ?? 0}</li>);
    if (v.wagons && w.wagons) items.push(<li key="wagon">Deliveries: {w.wagons.points[p.id] ?? 0}</li>);
  }
  return (
    <>
      <b>{p.name}</b>
      <ul>{items}</ul>
    </>
  );
}

/** Wayfarers badges under the stat block (docs/phase10.md §5), each only under its variant. */
function WayfarersBadges({ p, view, glint }: { p: RedactedPlayer; view: RedactedState; glint: boolean }) {
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
        <span className="hud-badge" title="Fish" data-testid={`fish-${p.id}`}>
          {w.fishing.fish[p.id] ?? 0} fish
        </span>
      )}
      {variants.fishing && w.fishing?.boot === p.id && (
        <span className="hud-badge" data-dark="true" title="The old boot: −1 point until passed on with a trade" data-testid={`boot-${p.id}`}>
          Old boot −1
        </span>
      )}
      {variants.rivers && w.rivers && (
        <span className="hud-badge" title="Gold coins from riverside buildings" data-testid={`coins-${p.id}`}>
          {w.rivers.coins[p.id] ?? 0} coins
        </span>
      )}
      {chips.map((chip) => (
        <span key={chip} className={`hud-badge ${glint ? "badge-glint" : ""}`} data-dark="true" title={`${CHIP_LABEL[chip]}: ${CHIP_VP[chip] > 0 ? "+" : ""}${CHIP_VP[chip]} points`} data-testid={`chip-${chip}-${p.id}`}>
          {CHIP_LABEL[chip]} {CHIP_VP[chip] > 0 ? `+${CHIP_VP[chip]}` : CHIP_VP[chip]}
        </span>
      ))}
      {variants.raiders && w.raiders && (
        <>
          {w.raiders.castles[p.id] && (
            <span className="hud-badge" title="Castle: +1 point, never raided" data-testid={`castle-${p.id}`}>
              Castle
            </span>
          )}
          <span className="hud-badge" title="Guards posted" data-testid={`guards-${p.id}`}>
            {w.raiders.guards[p.id]?.length ?? 0}/{MAX_GUARDS} guards
          </span>
          {(w.raiders.rebuilt[p.id] ?? 0) > 0 && (
            <span className="hud-badge" title="Raided hexes rebuilt (+1 each)" data-testid={`rebuilt-${p.id}`}>
              Rebuilt {w.raiders.rebuilt[p.id]}
            </span>
          )}
        </>
      )}
      {variants.caravans && w.caravans && (
        <span className="hud-badge" title="Spice from the oases" data-testid={`spice-${p.id}`}>
          {w.caravans.spice[p.id] ?? 0} spice
        </span>
      )}
      {variants.wagons && w.wagons && (
        <>
          <span className="hud-badge" title="Delivery points" data-testid={`deliveries-${p.id}`}>
            {w.wagons.points[p.id] ?? 0} delivered
          </span>
          {wagon && (
            <span className="hud-badge inline-flex items-center gap-0.5" title={wagon.cargo.length ? `Wagon carrying ${wagon.cargo.map((g) => WAGON_GOOD_LABEL[g].toLowerCase()).join(", ")}` : "Wagon empty"} data-testid={`wagon-${p.id}`} aria-label={`wagon carrying ${wagon.cargo.length} goods`}>
              wagon
              {wagon.cargo.map((g, i) => (
                <span key={i} className="inline-block h-2.5 w-2.5 rounded-sm border border-black/50" style={{ background: GOOD_COLOR[g] }} />
              ))}
            </span>
          )}
        </>
      )}
    </>
  );
}

export function PlayerBanner({ p, view, me, seat, acting, thinking, online, botifiable, away = null, absentAfter = null, onBotify, glint, emote, onHover }: PlayerBannerProps) {
  const anchor = useAnchor(`player:${p.id}`);
  const stats = useMemo(() => bannerStats(view, p), [view, p]);
  const isBot = seat?.kind === "bot";
  const crown = view.scenario?.crown === true;
  const cp = crown ? view.crown?.players[p.id] : undefined;
  const tip = useTipHandlers(detail(view, p), 300);
  const hasExtra = Boolean(view.wayfarers && view.scenario?.variants) || p.islandChips.length > 0 || (botifiable && onBotify) || away !== null;
  return (
    <div
      className="hud-banner hud-panel"
      style={{ "--player": HUD_PLAYER_COLOR[p.color] } as CSSProperties}
      data-testid={`player-row-${p.id}`}
      data-me={p.id === me ? "true" : undefined}
      aria-current={acting ? "true" : undefined}
      aria-label={`${p.name}${p.id === me ? " (you)" : ""}, ${stats.vp} victory points`}
      {...tip}
      onMouseEnter={(e) => {
        tip.onMouseEnter(e);
        onHover?.(p.id);
      }}
      onMouseLeave={() => {
        tip.onMouseLeave();
        onHover?.(null);
      }}
    >
      <div className="hud-portrait" ref={anchor}>
        {acting && <span className="hud-turn-marker" aria-hidden data-testid={`turn-marker-${p.id}`} />}
        <span className="hud-vp" aria-label={`${stats.vp} victory points`} data-testid={`vp-${p.id}`}>
          <Numeral value={stats.vp} />
        </span>
        <div className="hud-portrait-img">
          <Avatar spec={seat?.avatar} color={p.color} name={p.name} size={64} />
        </div>
        <span className="hud-pill-row">
          {stats.pills.map((pill) => (
            <span key={pill.label} className="hud-pill" title={pill.label} aria-label={`${pill.value} ${pill.label}`}>
              <Icon name={pill.icon} size={11} />
              <Numeral value={pill.value} />
            </span>
          ))}
        </span>
        {emote && (
          <span className="hud-emote" role="status" aria-label={`emote ${emote}`} data-testid={`emote-bubble-${p.id}`}>
            {emote}
          </span>
        )}
      </div>

      <div className="hud-ribbon">
        <span className="hud-ribbon-name">
          {p.name}
          {p.id === me && <span className="ml-1 text-[10px] uppercase tracking-wider opacity-80">you</span>}
        </span>
        {isBot && (
          <span className="hud-ribbon-bot" title="Computer player">
            <Icon name="bot" size={14} />
            <small data-testid={`bot-badge-${p.id}`}>{seat?.botLevel}</small>
          </span>
        )}
        {!isBot && online !== null && seat && (
          <span aria-label={online ? "connected" : "disconnected"} title={online ? "Connected" : "Disconnected"} className={`inline-block h-2 w-2 rounded-full ${online ? "bg-[#9be07a]" : "bg-[#ff8a80]"}`} data-testid={`presence-${p.id}`} />
        )}
        {cp && <TriTrack cp={cp} id={p.id} />}
        {thinking !== null && (
          <span className="hud-progress" style={{ animationDuration: `${thinking}ms` }} aria-label={`${p.name} is thinking`} data-testid={`thinking-${p.id}`} />
        )}
      </div>

      <div className="hud-stats" role="group" aria-label={`${p.name}'s statistics`}>
        {stats.columns.map((col) => (
          <span key={col.key} className={`hud-stat ${glint && col.title ? "badge-glint" : ""}`} data-title={col.title ? "true" : "false"} data-zero={col.value === 0 && !col.title ? "true" : "false"} data-stat={col.key} title={HUD_COPY.stats[col.key === "army" ? "army" : col.key]} data-testid={col.key === "knights" ? `knights-${p.id}` : col.key === "defense" ? `defense-${p.id}` : undefined}>
            <Numeral value={col.value} label={col.label} />
            <Icon name={col.icon} />
          </span>
        ))}
      </div>

      {hasExtra && (
        <div className="hud-banner-extra">
          {p.islandChips.length > 0 && (
            <span className="hud-badge" title="Islands settled" data-testid={`pennants-${p.id}`}>
              {p.islandChips.length} islands +{p.islandChips.length * (view.scenario?.islandBonus ?? 0)}
            </span>
          )}
          <WayfarersBadges p={p} view={view} glint={glint} />
          {away !== null && (
            <span className="hud-badge" title={absentAfter ? `The host may hand this seat to a bot after ${Math.round(absentAfter / 60_000)} minutes away` : "Away"} data-testid={`away-${p.id}`}>
              away {Math.max(1, Math.round(away / 60_000))} min{absentAfter && away < absentAfter ? ` · bot at ${Math.round(absentAfter / 60_000)}` : ""}
            </span>
          )}
          {botifiable && onBotify && <BotifyButton id={p.id} name={p.name} onBotify={onBotify} />}
        </div>
      )}
    </div>
  );
}
