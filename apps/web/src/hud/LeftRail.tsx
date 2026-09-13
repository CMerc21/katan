"use client";

/**
 * The left rail (docs/phase12.md §3): seven square icon buttons, top to
 * bottom Chat, Emote, Log, Stats, Rules, Settings, Leave. The open one shows
 * a gold glyph and left border. Each opens a SidePanel; only one is open at
 * a time.
 */

import { HUD_COPY } from "./hudCopy";
import { Icon, type IconName } from "./icons";
import { useTipHandlers } from "./HelpTip";

export type RailKey = "chat" | "emote" | "log" | "stats" | "info" | "settings" | "leave";

export const RAIL_ORDER: readonly RailKey[] = ["chat", "emote", "log", "stats", "info", "settings", "leave"];

const RAIL_ICON: Record<RailKey, IconName> = { chat: "chat", emote: "emote", log: "log", stats: "stats", info: "info", settings: "settings", leave: "leave" };

function RailButton({ id, open, dot, onToggle }: { id: RailKey; open: boolean; dot: boolean; onToggle: (key: RailKey) => void }) {
  const copy = HUD_COPY.rail[id];
  const tip = useTipHandlers(
    <>
      <b>{copy.label}</b>
      <div>{copy.help}</div>
    </>,
    400,
  );
  return (
    <button type="button" className="hud-rail-btn" aria-label={copy.label} aria-expanded={open} data-dot={dot ? "true" : undefined} data-testid={id === "settings" ? "settings" : `rail-${id}`} onClick={() => onToggle(id)} {...tip}>
      <Icon name={RAIL_ICON[id]} />
    </button>
  );
}

export function LeftRail({ open, onToggle, dots }: { open: RailKey | null; onToggle: (key: RailKey) => void; dots?: Partial<Record<RailKey, boolean>> }) {
  return (
    <nav className="hud-rail" aria-label="Game menu" data-testid="left-rail">
      {RAIL_ORDER.map((id) => (
        <RailButton key={id} id={id} open={open === id} dot={dots?.[id] ?? false} onToggle={onToggle} />
      ))}
    </nav>
  );
}
