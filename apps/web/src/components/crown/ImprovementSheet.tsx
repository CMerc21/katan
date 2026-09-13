"use client";

/**
 * The city improvement sheet (docs/rules.md §16.3, §16.7): the three tracks
 * with the current level, what the next level costs (one less with a
 * crane), the level-3 ability, the metropolis at 4 and 5, and a build button
 * per track that the engine lists as legal.
 */

import { MAX_LEVEL, METROPOLIS_LEVEL, TRACKS, TRACK_COMMODITY, type Action, type Track } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { COMMODITY_LABEL, TRACK_ABILITY, TRACK_HELP, TRACK_LABEL, playerName } from "@/game/labels";
import { TRACK_COLOR } from "@/game/theme";
import { CommodityCardFace } from "../cards";
import { Button, Modal } from "../ui";

export function ImprovementSheet({ view, me, legal, onDispatch, onClose }: { view: RedactedState; me: string; legal: Action[]; onDispatch: (a: Action) => void; onClose: () => void }) {
  const c = view.crown;
  const cp = c?.players[me];
  const player = view.players.find((p) => p.id === me);
  if (!c || !cp || !player) return null;
  const reason = (track: Track): string | null => {
    if (legal.some((a) => a.type === "BUILD_IMPROVEMENT" && a.track === track)) return null;
    if (view.phase.kind !== "action") return "Only on your turn, after rolling";
    if (player.cities.length === 0) return "You need a city first";
    if (cp.tracks[track] >= MAX_LEVEL) return "This track is complete";
    return `Needs ${costOf(track)} ${COMMODITY_LABEL[TRACK_COMMODITY[track]].toLowerCase()}`;
  };
  const costOf = (track: Track): number => {
    const next = cp.tracks[track] + 1;
    return cp.crane ? Math.max(1, next - 1) : next;
  };
  return (
    <Modal title="City improvements" onClose={onClose} wide>
      <p className="mb-3 text-sm text-ink-soft">
        Level n costs n of the track&apos;s commodity and needs a city. Level 3 grants an ability; the first to level 4 founds the track&apos;s metropolis (+2), and level 5 can take it from a level-4 holder.
        {cp.crane && <strong className="ml-1" data-testid="crane-note">Your crane makes the next improvement one commodity cheaper.</strong>}
      </p>
      <ul className="space-y-2" data-testid="improvement-tracks">
        {TRACKS.map((track) => {
          const why = reason(track);
          const level = cp.tracks[track];
          const holder = c.metropolis[track];
          const commodity = TRACK_COMMODITY[track];
          return (
            <li key={track} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-2" data-testid={`track-${track}`} data-level={level}>
              <CommodityCardFace commodity={commodity} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: TRACK_COLOR[track] }}>
                    {TRACK_LABEL[track]}
                  </span>
                  <span className="flex gap-0.5" aria-label={`level ${level} of ${MAX_LEVEL}`}>
                    {Array.from({ length: MAX_LEVEL }, (_, i) => (
                      <span key={i} className="inline-block h-2.5 w-3 rounded-sm border border-ink/30" style={{ background: i < level ? TRACK_COLOR[track] : "transparent" }} />
                    ))}
                  </span>
                  <span className="text-xs text-ink-soft tabular-nums">
                    {level}/{MAX_LEVEL}
                  </span>
                </span>
                <span className="block text-xs text-ink-soft">{TRACK_HELP[track]}</span>
                <span className={`block text-xs ${level >= 3 ? "font-semibold" : "text-ink-soft"}`}>{TRACK_ABILITY[track]}</span>
                <span className="block text-xs text-ink-soft">
                  {holder === null ? `Metropolis unclaimed (level ${METROPOLIS_LEVEL})` : holder === me ? "You hold the metropolis" : `${playerName(view, holder)} holds the metropolis (level ${c.players[holder]?.tracks[track] ?? METROPOLIS_LEVEL})`}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="text-xs tabular-nums">
                  you hold {cp.commodities[commodity]} {COMMODITY_LABEL[commodity].toLowerCase()}
                </span>
                <Button size="sm" variant={why ? "secondary" : "primary"} disabled={why !== null} reason={why} onClick={() => onDispatch({ type: "BUILD_IMPROVEMENT", playerId: me, track })} data-testid={`improve-${track}`}>
                  {level >= MAX_LEVEL ? "Complete" : `Build level ${level + 1} (${costOf(track)} ${COMMODITY_LABEL[commodity].toLowerCase()})`}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
