/**
 * Monochrome HUD icon set (docs/phase12.md §2, §3). Every glyph is an
 * original 24×24 path filled with `currentColor`; nothing is loaded and no
 * commercial artwork is referenced. Resource glyphs double as the tray and
 * cost-card icons, so they carry a hint of their material colour when
 * `tint` is set.
 */

import type { SVGProps } from "react";
import type { Commodity, Resource } from "@katan/engine";
import { COMMODITY_COLOR, RESOURCE_COLOR } from "@/game/theme";

export type IconName =
  | "wood"
  | "clay"
  | "wool"
  | "grain"
  | "ore"
  | "cloth"
  | "coin"
  | "paper"
  | "road"
  | "settlement"
  | "city"
  | "ship"
  | "wall"
  | "knight"
  | "shield"
  | "army"
  | "card"
  | "tower"
  | "chat"
  | "emote"
  | "log"
  | "stats"
  | "info"
  | "settings"
  | "leave"
  | "trade"
  | "hourglass"
  | "dice"
  | "cards"
  | "camera"
  | "bot"
  | "history"
  | "fish"
  | "sail"
  | "undo";

const PATHS: Record<IconName, string> = {
  wood: "M4 6h16v3H4zM4 10.5h16v3H4zM4 15h16v3H4z M7 6.8h1.5v11.2H7zM15.5 6.8H17v11.2h-1.5z",
  clay: "M3 18h18v3H3zm2-5h6v4H5zm8 0h6v4h-6zM8 8h6v4H8zm-3 0h2v4H5zm11 0h3v4h-3z",
  wool: "M12 5a4 4 0 0 1 3.9 3.1A3.5 3.5 0 0 1 18 14.5c0 1.9-1.6 3.5-3.5 3.5H9.5A3.5 3.5 0 0 1 6 14.5a3.5 3.5 0 0 1 2.1-6.4A4 4 0 0 1 12 5zm-2 13h1.5v2H10zm2.5 0H14v2h-1.5z",
  grain: "M12 2c1.5 2 1.5 4 0 6-1.5-2-1.5-4 0-6zm0 6c1.5 2 1.5 4 0 6-1.5-2-1.5-4 0-6zm-1 6v8h2v-8zm-4-6c2 .3 3.3 1.5 3.7 3.5C8.7 11.2 7.4 10 7 8zm10 0c-.4 2-1.7 3.2-3.7 3.5.4-2 1.7-3.2 3.7-3.5zm-10 5c2 .3 3.3 1.5 3.7 3.5C8.7 16.2 7.4 15 7 13zm10 0c-.4 2-1.7 3.2-3.7 3.5.4-2 1.7-3.2 3.7-3.5z",
  ore: "M12 3l4 5-4 3-4-3zm-6 8l4 2-1 8H3zm12 0l3 10h-6l-1-8zm-6 1l3 2-1 7h-4l-1-7z",
  cloth: "M3 7c3-2 6-2 9 0s6 2 9 0v4c-3 2-6 2-9 0s-6-2-9 0zm0 7c3-2 6-2 9 0s6 2 9 0v4c-3 2-6 2-9 0s-6-2-9 0z",
  coin: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-1 2h2v2h1.5v2H13v1h1.5v2H13v1h-2v-1H9.5v-2H11v-1H9.5v-2H11z",
  paper: "M6 3h9l4 4v14H6zm2 2v14h9V8h-3V5zm2 5h5v1.5h-5zm0 3h5v1.5h-5zm0 3h3.5v1.5H10z",
  road: "M3 17l6-12h6l6 12zm4.6-2h8.8L13.7 7h-3.4zM11 8h2v2h-2zm0 3.5h2v2h-2zm0 3.5h2v2h-2z",
  settlement: "M12 3l8 7v11H4V10zm0 2.6L6 10.9V19h4v-5h4v5h4v-8.1z",
  city: "M3 21V11l4-3 4 3v2h2V7l4-2 4 2v14zm2-2h4v-7.2L7 10.4 5 11.8zm10 0h4V8.2l-2-1-2 1z",
  ship: "M4 15h16l-2 5H6zm7-12h2v11h-2zm2 1l6 8h-6z",
  wall: "M3 6h18v3H3zm0 4.5h18v3H3zm0 4.5h18v3H3zM7 6h1.5v3H7zm8 0h1.5v3H15zm-4 4.5h1.5v3H11zm-4 4.5h1.5v3H7zm8 0h1.5v3H15z",
  knight: "M12 2a6 6 0 0 1 6 6v3H6V8a6 6 0 0 1 6-6zm-6 10h12l-1 3h-4v7h-2v-7H7zm5-8v5h2V4z",
  shield: "M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5zm0 2.2L6 6.4V11c0 3.8 2.5 6.6 6 8.7 3.5-2.1 6-4.9 6-8.7V6.4z",
  army: "M12 2l7 3v5c0 4.4-3 7.7-7 10-4-2.3-7-5.6-7-10V5zm-1 5v3H8v2h3v3h2v-3h3v-2h-3V7z",
  card: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v14h10V5zm2 2h6v2H9zm0 4h6v2H9z",
  tower: "M8 3h2v2h1V3h2v2h1V3h2v5h-1v13H9V8H8zm3 8v3h2v-3zm-1 5v5h4v-5z",
  chat: "M4 4h16v11H9l-5 4zm2 2v9.5L8.3 13H18V6z",
  emote: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM9 9h2v2H9zm4 0h2v2h-2zm-5 4h8c-.5 2-2 3.3-4 3.3S8.5 15 8 13z",
  log: "M5 3h14v18H5zm2 2v14h10V5zm2 2h6v1.5H9zm0 3h6v1.5H9zm0 3h6v1.5H9zm0 3h4v1.5H9z",
  stats: "M4 20h16v1.5H4zM5 12h3v7H5zm5-6h3v13h-3zm5 3h3v10h-3z",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-1 5h2v6h-2zm0-3h2v2h-2z",
  settings: "M10.5 3h3l.4 2.2 1.5.6 1.9-1.3 2.1 2.1-1.3 1.9.6 1.5 2.2.4v3l-2.2.4-.6 1.5 1.3 1.9-2.1 2.1-1.9-1.3-1.5.6-.4 2.2h-3l-.4-2.2-1.5-.6-1.9 1.3-2.1-2.1 1.3-1.9-.6-1.5L3 13.5v-3l2.2-.4.6-1.5-1.3-1.9 2.1-2.1 1.9 1.3 1.5-.6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  leave: "M4 3h9v2H6v14h7v2H4zm11 5l5 4-5 4v-3H9v-2h6z",
  trade: "M4 8h11V5l5 4-5 4v-3H4zm16 8H9v3l-5-4 5-4v3h11z",
  hourglass: "M6 2h12v2h-1v3c0 2-1.5 3.5-3.5 5 2 1.5 3.5 3 3.5 5v3h1v2H6v-2h1v-3c0-2 1.5-3.5 3.5-5C8.5 10.5 7 9 7 7V4H6zm3 2v3c0 1.4 1.3 2.5 3 3.8 1.7-1.3 3-2.4 3-3.8V4zm3 9.2c-1.7 1.3-3 2.4-3 3.8v3h6v-3c0-1.4-1.3-2.5-3-3.8z",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  cards: "M8 4h9a1 1 0 0 1 1 1v13h-2V6H8zm-3 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1 2v10h7V9z",
  camera: "M9 4h6l1.5 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5zm3 4a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  bot: "M11 2h2v3h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4zm-4 5v9h10V7zm2 2h2v3H9zm4 0h2v3h-2zm-4 5h6v1.5H9zM3 9h1.5v5H3zm16.5 0H21v5h-1.5zM9 19h6v2H9z",
  history: "M12 3a9 9 0 1 1-8.4 12h2.2A7 7 0 1 0 5.6 9H8l-4 4-4-4h3.2A9 9 0 0 1 12 3zm-1 4h2v5.2l3.5 2-1 1.7L11 13.3z",
  undo: "M9 5l-6 6 6 6v-4h5a4 4 0 0 1 0 8h-3v2h3a6 6 0 0 0 0-12H9z",
  fish: "M3 12c3-4 7-6 11-6l3 3 4-2-2 5 2 5-4-2-3 3c-4 0-8-2-11-6zm11-1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  sail: "M12 2v14h8zm-1 15h11l-2 4H8zm-7-1h3l-1 3H3z",
};

const TINT: Partial<Record<IconName, string>> = {
  wood: RESOURCE_COLOR.wood,
  clay: RESOURCE_COLOR.clay,
  wool: "#cfd88f",
  grain: RESOURCE_COLOR.grain,
  ore: "#a9adb6",
  cloth: COMMODITY_COLOR.cloth,
  coin: COMMODITY_COLOR.coin,
  paper: COMMODITY_COLOR.paper,
};

export function Icon({ name, size = 16, tint = false, ...rest }: { name: IconName; size?: number; tint?: boolean } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const color = tint ? TINT[name] : undefined;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false" style={color ? { fill: color, color } : undefined} data-icon={name} {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function cardIcon(card: Resource | Commodity): IconName {
  return card;
}
