"use client";

/**
 * Card faces (docs/phase7.md §6): resource cards with woodcut-style
 * illustrations and development cards with a crest frame. All SVG, all
 * original.
 */

import type { DevCardType, Resource } from "@katan/engine";
import { DEV_CARD_LABEL, RESOURCE_LABEL } from "@/game/labels";
import { GILT, INK, PARCHMENT, RESOURCE_COLOR } from "@/game/theme";

/** The picture on each resource card: simple woodcut-like marks. */
function ResourceArt({ resource }: { resource: Resource }) {
  const c = RESOURCE_COLOR[resource];
  switch (resource) {
    case "wood":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round">
          <path d="M12 40 L12 24 L20 24 L20 40 Z" fill="#b9853f" />
          <path d="M14 24 L16 16 L20 8 L24 16 L26 24" fill={c} />
          <path d="M10 26 L16 12 L22 26 Z" fill={c} />
          <ellipse cx="12" cy="40" rx="6" ry="2.5" fill="#d9b276" />
          <path d="M8 40 h22" />
        </g>
      );
    case "clay":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round">
          <rect x="8" y="30" width="10" height="6" fill={c} />
          <rect x="19" y="30" width="10" height="6" fill={c} />
          <rect x="13" y="23" width="10" height="6" fill={c} />
          <rect x="24" y="23" width="6" height="6" fill={c} />
          <rect x="8" y="16" width="10" height="6" fill={c} />
          <rect x="19" y="16" width="10" height="6" fill={c} />
          <path d="M6 37 h26" />
        </g>
      );
    case "wool":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round">
          <ellipse cx="19" cy="27" rx="11" ry="8" fill="#f1eee5" />
          <circle cx="11" cy="24" r="4" fill="#f1eee5" />
          <circle cx="27" cy="23" r="4" fill="#f1eee5" />
          <circle cx="19" cy="20" r="4.5" fill="#f1eee5" />
          <circle cx="29" cy="29" r="3.5" fill={INK} />
          <path d="M12 35 v5 M17 35 v5 M22 35 v5 M27 35 v5" />
          <circle cx="30" cy="28" r="0.8" fill="#fff" stroke="none" />
        </g>
      );
    case "grain":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round">
          {[12, 19, 26].map((x, i) => (
            <g key={x}>
              <path d={`M${x} 40 V${18 + i * 2}`} />
              {[0, 1, 2, 3].map((k) => (
                <path key={k} d={`M${x} ${20 + i * 2 + k * 4} l-4 -3 M${x} ${20 + i * 2 + k * 4} l4 -3`} stroke={c} strokeWidth={2.2} />
              ))}
            </g>
          ))}
        </g>
      );
    case "ore":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round">
          <path d="M6 38 L14 18 L20 28 L26 14 L34 38 Z" fill={c} />
          <path d="M12 38 L18 24 L22 30 Z" fill="#5b5e66" />
          <path d="M24 18 L27 22" stroke="#f4f4f2" strokeWidth={2} />
          <circle cx="24" cy="32" r="1.5" fill={GILT} />
          <circle cx="16" cy="34" r="1.2" fill={GILT} />
        </g>
      );
    default: {
      const exhaustive: never = resource;
      return <g>{String(exhaustive)}</g>;
    }
  }
}

export function ResourceCardFace({ resource, size = 40, count }: { resource: Resource; size?: number; count?: number }) {
  const w = size;
  const h = size * 1.4;
  return (
    <svg viewBox="0 0 40 56" width={w} height={h} aria-hidden className="shrink-0" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.35))" }}>
      <rect x="1" y="1" width="38" height="54" rx="3.5" fill={PARCHMENT} stroke={INK} strokeWidth={1.6} />
      <rect x="4" y="4" width="32" height="40" rx="2" fill={RESOURCE_COLOR[resource]} fillOpacity={0.18} stroke={RESOURCE_COLOR[resource]} strokeWidth={1} />
      <g transform="translate(1 4)">
        <ResourceArt resource={resource} />
      </g>
      <text x="20" y="52" textAnchor="middle" fontSize="6.5" fontWeight={700} fill={INK} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {count !== undefined ? `${count} ${RESOURCE_LABEL[resource]}` : RESOURCE_LABEL[resource]}
      </text>
    </svg>
  );
}

/** A face-down card back: parchment with a gilt lozenge. */
export function CardBack({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 56" width={size} height={size * 1.4} aria-hidden className="shrink-0" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.35))" }}>
      <rect x="1" y="1" width="38" height="54" rx="3.5" fill="#7a4a1f" stroke={INK} strokeWidth={1.6} />
      <rect x="5" y="5" width="30" height="46" rx="2" fill="none" stroke={GILT} strokeWidth={1.2} />
      <path d="M20 14 L30 28 L20 42 L10 28 Z" fill="none" stroke={GILT} strokeWidth={1.4} />
      <circle cx="20" cy="28" r="3" fill={GILT} />
    </svg>
  );
}

function Crest({ type }: { type: DevCardType }) {
  switch (type) {
    case "knight":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M20 12 L30 16 V26 Q30 34 20 38 Q10 34 10 26 V16 Z" fill="#a12a1e" />
          <path d="M20 16 V34 M13 24 H27" stroke={GILT} strokeWidth={2} />
        </g>
      );
    case "victoryPoint":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M20 10 L23 19 L32 19 L25 24 L28 33 L20 28 L12 33 L15 24 L8 19 L17 19 Z" fill={GILT} />
        </g>
      );
    case "roadBuilding":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M8 34 L18 14 H22 L32 34 Z" fill="#b9853f" />
          <path d="M14 30 H26 M16 24 H24 M18 19 H22" stroke={INK} strokeWidth={1.2} />
        </g>
      );
    case "invention":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M20 10 Q30 18 20 26 Q10 18 20 10 Z" fill="#f1eee5" />
          <path d="M20 26 V36 M14 36 H26" />
          <circle cx="20" cy="18" r="2" fill={GILT} />
        </g>
      );
    case "monopoly":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <circle cx="20" cy="24" r="11" fill={GILT} />
          <path d="M20 16 V32 M15 20 Q20 18 25 20 Q20 24 15 28 Q20 30 25 28" fill="none" />
        </g>
      );
    default: {
      const exhaustive: never = type;
      return <g>{String(exhaustive)}</g>;
    }
  }
}

export function DevCardFace({ type, size = 40 }: { type: DevCardType; size?: number }) {
  return (
    <svg viewBox="0 0 40 56" width={size} height={size * 1.4} aria-hidden className="shrink-0" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.35))" }}>
      <rect x="1" y="1" width="38" height="54" rx="3.5" fill={PARCHMENT} stroke={INK} strokeWidth={1.6} />
      <rect x="4" y="4" width="32" height="48" rx="2" fill="none" stroke={GILT} strokeWidth={1.2} />
      <Crest type={type} />
      <text x="20" y="48" textAnchor="middle" fontSize="5.4" fontWeight={700} fill={INK} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {DEV_CARD_LABEL[type]}
      </text>
    </svg>
  );
}
