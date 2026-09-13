"use client";

/**
 * Players panel additions for Crown & Castle (docs/phase11.md §11): the
 * improvement tri-track badge (three bars, levels 0–5, a mark at level 3
 * and a crown for a metropolis), knights and active defence, walls,
 * Defender of the Realm chips, the merchant, commodity and progress card
 * counts and face-up victory point cards; and the fleet track for the top
 * edge of the board (seven steps with the ship, and the attack count).
 */

import { FLEET_STEPS, MAX_LEVEL, MAX_WALLS, TRACKS, isHiddenProgress, type ProgressCard, type RedactedCrownPlayer } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { COMMODITY_LABEL, EVENT_DIE_LABEL, PROGRESS_CARD_LABEL, TRACK_ABILITY, TRACK_LABEL, playerName } from "@/game/labels";
import { COMMODITY_COLOR, FLEET_COLOR, GILT, INK, PARCHMENT, TRACK_COLOR } from "@/game/theme";
import { ProgressCardFace } from "../cards";

function Badge({ children, title, testId, dark = false, glint = false }: { children: React.ReactNode; title: string; testId: string; dark?: boolean; glint?: boolean }) {
  return (
    <span className={`rounded px-1 ${dark ? "bg-ink text-parchment" : "border border-line"} ${glint ? "badge-glint" : ""}`} title={title} data-testid={testId}>
      {children}
    </span>
  );
}

/** Three small bars, one per track (docs/rules.md §16.3, §16.7). */
export function TriTrack({ cp, id }: { cp: RedactedCrownPlayer; id: string }) {
  const title = TRACKS.map((t) => `${TRACK_LABEL[t]} ${cp.tracks[t]}/${MAX_LEVEL}${cp.metropolises[t] ? " (metropolis)" : ""} — ${TRACK_ABILITY[t]}`).join("\n");
  return (
    <span className="inline-flex items-end gap-0.5 align-middle" title={title} aria-label={TRACKS.map((t) => `${TRACK_LABEL[t]} level ${cp.tracks[t]}`).join(", ")} data-testid={`tracks-${id}`}>
      {TRACKS.map((t) => (
        <span key={t} className="relative flex h-5 w-2 flex-col-reverse gap-px" data-track={t} data-level={cp.tracks[t]}>
          {Array.from({ length: MAX_LEVEL }, (_, i) => (
            <span key={i} className="block h-[3px] w-full rounded-[1px]" style={{ background: i < cp.tracks[t] ? TRACK_COLOR[t] : "rgba(33,29,25,.15)", outline: i === 2 ? `1px solid ${GILT}` : undefined, outlineOffset: -1 }} />
          ))}
          {cp.metropolises[t] && (
            <svg viewBox="0 0 10 8" width={10} height={8} className="absolute -top-2 left-1/2 -translate-x-1/2" aria-hidden>
              <path d="M1 7 L1 2 L3.5 4 L5 1 L6.5 4 L9 2 L9 7 Z" fill={TRACK_COLOR[t]} stroke={INK} strokeWidth={0.6} />
            </svg>
          )}
        </span>
      ))}
    </span>
  );
}

export function CrownBadges({ p, view, glint }: { p: RedactedState["players"][number]; view: RedactedState; glint: boolean }) {
  const c = view.crown;
  const cp = c?.players[p.id];
  if (!view.scenario?.crown || !c || !cp) return null;
  const knights = c.knights.filter((k) => k.owner === p.id);
  const defence = knights.filter((k) => k.active).reduce((n, k) => n + k.level, 0);
  const goods = cp.commodities.cloth + cp.commodities.coin + cp.commodities.paper;
  const progressCount = isHiddenProgress(cp.progress) ? cp.progress.count : cp.progress.length;
  const revealed: ProgressCard[] = isHiddenProgress(cp.progress) ? cp.progress.revealed : cp.progress.filter((h) => h.revealed).map((h) => h.card);
  return (
    <>
      <TriTrack cp={cp} id={p.id} />
      <Badge title={`Commodities: ${(["cloth", "coin", "paper"] as const).map((k) => `${cp.commodities[k]} ${COMMODITY_LABEL[k].toLowerCase()}`).join(", ")}`} testId={`commodities-${p.id}`}>
        {goods} goods
      </Badge>
      <Badge title="Progress cards in hand" testId={`progress-${p.id}`}>
        {progressCount} progress
      </Badge>
      <Badge title={knights.length ? `${knights.length} knight${knights.length === 1 ? "" : "s"}; active defence ${defence}` : "No knights"} testId={`knights-${p.id}`}>
        {knights.length} knights · def {defence}
      </Badge>
      {cp.walls.length > 0 && (
        <Badge title={`City walls: discard limit ${7 + 2 * cp.walls.length}`} testId={`walls-${p.id}`}>
          {cp.walls.length}/{MAX_WALLS} walls
        </Badge>
      )}
      {cp.defenderChips > 0 && (
        <Badge title="Defender of the Realm: +1 point each" testId={`defender-${p.id}`} dark glint={glint}>
          Defender +{cp.defenderChips}
        </Badge>
      )}
      {c.merchant?.playerId === p.id && (
        <Badge title={`The merchant on hex ${c.merchant.hex}: +1 point and 2:1 for its resource`} testId={`merchant-${p.id}`} dark glint={glint}>
          Merchant +1
        </Badge>
      )}
      {revealed.map((card, i) => (
        <span key={`${card}-${i}`} className="inline-flex items-center gap-0.5" title={`${PROGRESS_CARD_LABEL[card]}: +1 point`} data-testid={`vp-card-${p.id}-${card}`}>
          <ProgressCardFace card={card} size={14} />
          <span>+1</span>
        </span>
      ))}
    </>
  );
}

/** The barbarian fleet's seven-step track (docs/rules.md §16.6), laid along the top edge of the board. */
export function FleetTrack({ view }: { view: RedactedState }) {
  const c = view.crown;
  if (!view.scenario?.crown || !c) return null;
  const strength = view.players.reduce((n, p) => n + p.cities.length, 0);
  const defence = c.knights.filter((k) => k.active).reduce((n, k) => n + k.level, 0);
  return (
    <div
      className="parchment pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md px-2 py-1 text-xs"
      role="group"
      aria-label={`Barbarian fleet at step ${c.fleet} of ${FLEET_STEPS}; ${c.attacks} attacks so far`}
      data-testid="fleet-track"
      data-position={c.fleet}
      data-attacks={c.attacks}
      title={`Fleet strength ${strength} (cities) against the realm's defence ${defence} (active knights)`}
    >
      <span className="font-display font-semibold">Fleet</span>
      <span className="flex items-center gap-0.5" role="progressbar" aria-valuemin={0} aria-valuemax={FLEET_STEPS} aria-valuenow={c.fleet}>
        {Array.from({ length: FLEET_STEPS }, (_, i) => {
          const step = i + 1;
          const here = c.fleet === step;
          const last = step === FLEET_STEPS;
          return (
            <span key={i} className="relative grid h-5 w-5 place-items-center rounded-sm border border-ink/40" style={{ background: step <= c.fleet ? "rgba(31,26,23,.25)" : PARCHMENT }} data-testid={`fleet-step-${step}`}>
              {last && <span className="text-[9px] font-semibold text-clay">!</span>}
              {here && (
                <svg viewBox="0 0 16 16" width={16} height={16} className="absolute" aria-label="the fleet" data-testid="fleet-ship">
                  <path d="M8 2 V11 L14 9.5 Z" fill={FLEET_COLOR} />
                  <path d="M2 12 H14 L12 15 H4 Z" fill="#8a6a44" stroke={INK} strokeWidth={0.6} />
                </svg>
              )}
            </span>
          );
        })}
      </span>
      <span className="tabular-nums text-ink-soft" data-testid="fleet-odds">
        {strength} vs {defence}
      </span>
      <span className="tabular-nums" data-testid="fleet-attacks">
        {c.attacks} attack{c.attacks === 1 ? "" : "s"}
      </span>
      {c.lastEvent && (
        <span className="rounded px-1 text-[10px] uppercase tracking-wide" style={{ background: c.lastEvent === "fleet" ? FLEET_COLOR : COMMODITY_COLOR[c.lastEvent === "trade" ? "cloth" : c.lastEvent === "politics" ? "coin" : "paper"], color: PARCHMENT }} data-testid="last-event-die" title={`Event die: ${EVENT_DIE_LABEL[c.lastEvent]}`}>
          {EVENT_DIE_LABEL[c.lastEvent]}
        </span>
      )}
      {c.merchant && <span className="sr-only">{playerName(view, c.merchant.playerId)} holds the merchant</span>}
    </div>
  );
}
