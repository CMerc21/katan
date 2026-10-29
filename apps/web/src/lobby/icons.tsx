/**
 * Lobby icons (docs/phase13.md §1): bold filled glyphs that read at 28 px on
 * a dark plaque. Original, drawn on a 32 box in currentColor.
 */

import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg(props: P & { children: ReactNode }) {
  return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false" {...props} />;
}

export function FriendsIcon(p: P) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="10" r="5" />
      <path d="M2 26c0-6 4-9 9-9s9 3 9 9z" />
      <circle cx="22" cy="11" r="4" opacity="0.75" />
      <path d="M19 18.5c1-.4 2-.5 3-.5 4.5 0 8 2.6 8 8h-8.5c0-3-1-5.6-2.5-7.5z" opacity="0.75" />
    </Svg>
  );
}

export function WardrobeIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M11 4l5 3 5-3 8 5-3 6-3-1.5V28H9V13.5L6 15 3 9z" />
      <path d="M16 7v21" stroke="rgba(0,0,0,.35)" strokeWidth="1.5" />
    </Svg>
  );
}

export function KeyIcon(p: P) {
  return (
    <Svg {...p}>
      <circle cx="10" cy="16" r="7" />
      <circle cx="10" cy="16" r="2.6" fill="rgba(0,0,0,.45)" />
      <path d="M16 14h14v4h-3v4h-4v-4h-7z" />
    </Svg>
  );
}

export function BookIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M3 6c5-1 9 0 12 2.5V28c-3-2.5-7-3.5-12-2.5z" />
      <path d="M29 6c-5-1-9 0-12 2.5V28c3-2.5 7-3.5 12-2.5z" opacity="0.8" />
    </Svg>
  );
}

export function GearIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M13.5 2h5l.8 4 3 1.3 3.4-2.3 3.5 3.5-2.3 3.4 1.3 3 4 .8v5l-4 .8-1.3 3 2.3 3.4-3.5 3.5-3.4-2.3-3 1.3-.8 4h-5l-.8-4-3-1.3-3.4 2.3-3.5-3.5 2.3-3.4-1.3-3-4-.8v-5l4-.8 1.3-3-2.3-3.4 3.5-3.5 3.4 2.3 3-1.3z" />
      <circle cx="16" cy="16" r="5" fill="rgba(0,0,0,.5)" />
    </Svg>
  );
}

export function PersonIcon(p: P) {
  return (
    <Svg {...p}>
      <circle cx="16" cy="9" r="6" />
      <path d="M5 29c0-7 5-11 11-11s11 4 11 11z" />
    </Svg>
  );
}

export function PeopleIcon(p: P) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="10" r="5" />
      <path d="M1 28c0-6 4.5-10 10-10s10 4 10 10z" />
      <circle cx="22" cy="9" r="5" />
      <path d="M17 18.5c1.5-.4 3.2-.5 5-.5 5.5 0 9 4 9 10h-8c0-4-2-7.5-6-9.5z" />
    </Svg>
  );
}

export function AddPersonIcon(p: P) {
  return (
    <Svg {...p}>
      <circle cx="18" cy="11" r="6" />
      <path d="M7 29c0-7 5-11 11-11s11 4 11 11z" />
      <path d="M3 9h3V6h3v3h3v3H9v3H6v-3H3z" />
    </Svg>
  );
}

export function DiceIcon(p: P) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="24" height="24" rx="5" />
      <g fill="rgba(0,0,0,.6)">
        <circle cx="10.5" cy="10.5" r="2.3" />
        <circle cx="21.5" cy="10.5" r="2.3" />
        <circle cx="16" cy="16" r="2.3" />
        <circle cx="10.5" cy="21.5" r="2.3" />
        <circle cx="21.5" cy="21.5" r="2.3" />
      </g>
    </Svg>
  );
}

export function ScrollIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M7 5h17a4 4 0 0 1 4 4v1h-5v15a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-2h4V9a4 4 0 0 0-1-4z" />
      <path d="M11 12h8M11 16h8M11 20h6" stroke="rgba(0,0,0,.45)" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function ShuffleIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M3 9h6l10 14h4v-4l6 6-6 6v-4h-6L7 13H3zM3 23h6l3-4 2.4 3.3L11 27H3zM19 9h4V5l6 6-6 6v-4h-2l-2.6 3.6L16 13.3z" />
    </Svg>
  );
}

export function Chevron({ dir, ...p }: P & { dir: "left" | "right" }) {
  return (
    <Svg {...p}>
      <path d={dir === "left" ? "M20 5l3 3-8 8 8 8-3 3L9 16z" : "M12 5l-3 3 8 8-8 8 3 3 11-11z"} />
    </Svg>
  );
}
