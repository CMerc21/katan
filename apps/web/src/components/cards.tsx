"use client";

/**
 * Card faces (docs/phase7.md §6): resource cards with woodcut-style
 * illustrations and development cards with a crest frame. All SVG, all
 * original.
 */

import { trackOfCard, type Commodity, type DevCardType, type ProgressCard, type Resource, type Track } from "@katan/engine";
import { COMMODITY_LABEL, DEV_CARD_LABEL, PROGRESS_CARD_LABEL, RESOURCE_LABEL } from "@/game/labels";
import { COMMODITY_COLOR, GILT, INK, PARCHMENT, RESOURCE_COLOR, TRACK_COLOR } from "@/game/theme";

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

// ---------------------------------------------------------------------------
// Crown & Castle (docs/phase11.md §11): commodity cards and progress cards.

/** The picture on each commodity card: a bolt of cloth, a struck coin, a ruled sheet. */
function CommodityArt({ commodity }: { commodity: Commodity }) {
  const c = COMMODITY_COLOR[commodity];
  switch (commodity) {
    case "cloth":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round">
          <path d="M8 16 Q14 12 20 16 T32 16 V34 Q26 38 20 34 T8 34 Z" fill={c} />
          <path d="M8 22 Q14 18 20 22 T32 22 M8 28 Q14 24 20 28 T32 28" stroke="#e9dcea" strokeWidth={1.2} />
          <path d="M12 34 V40 M28 34 V40" />
          <circle cx="12" cy="41" r="1.4" fill={INK} stroke="none" />
          <circle cx="28" cy="41" r="1.4" fill={INK} stroke="none" />
        </g>
      );
    case "coin":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round">
          <ellipse cx="16" cy="32" rx="9" ry="3.5" fill={c} />
          <ellipse cx="16" cy="29" rx="9" ry="3.5" fill={c} />
          <circle cx="23" cy="21" r="8.5" fill={c} />
          <circle cx="23" cy="21" r="5.5" fill="none" stroke="#7a4a1f" strokeWidth={1.2} />
          <path d="M23 16.5 V25.5 M20 19 L26 23 M26 19 L20 23" stroke="#7a4a1f" strokeWidth={1.4} />
        </g>
      );
    case "paper":
      return (
        <g stroke={INK} strokeWidth={1.4} strokeLinejoin="round">
          <path d="M10 12 H26 L31 17 V40 H10 Z" fill="#f4efe2" />
          <path d="M26 12 V17 H31" fill="#dfd7c4" />
          <path d="M14 22 H27 M14 27 H27 M14 32 H23" stroke={c} strokeWidth={1.6} />
          <path d="M14 36 H20" stroke="#8a4330" strokeWidth={1.6} />
        </g>
      );
    default: {
      const exhaustive: never = commodity;
      return <g>{String(exhaustive)}</g>;
    }
  }
}

export function CommodityCardFace({ commodity, size = 40, count }: { commodity: Commodity; size?: number; count?: number }) {
  const w = size;
  const h = size * 1.4;
  const c = COMMODITY_COLOR[commodity];
  return (
    <svg viewBox="0 0 40 56" width={w} height={h} aria-hidden className="shrink-0" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.35))" }}>
      <rect x="1" y="1" width="38" height="54" rx="3.5" fill={PARCHMENT} stroke={INK} strokeWidth={1.6} />
      <rect x="4" y="4" width="32" height="40" rx="2" fill={c} fillOpacity={0.18} stroke={c} strokeWidth={1} />
      <path d="M4 8 L8 4 M32 4 L36 8 M4 40 L8 44 M32 44 L36 40" stroke={GILT} strokeWidth={1.2} />
      <g transform="translate(1 4)">
        <CommodityArt commodity={commodity} />
      </g>
      <text x="20" y="52" textAnchor="middle" fontSize="6.5" fontWeight={700} fill={INK} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {count !== undefined ? `${count} ${COMMODITY_LABEL[commodity]}` : COMMODITY_LABEL[commodity]}
      </text>
    </svg>
  );
}

/** A resource or commodity face by name. */
export function CardFace({ card, size = 40, count }: { card: Resource | Commodity; size?: number; count?: number }) {
  if (card === "cloth" || card === "coin" || card === "paper") return <CommodityCardFace commodity={card} size={size} {...(count !== undefined ? { count } : {})} />;
  return <ResourceCardFace resource={card} size={size} {...(count !== undefined ? { count } : {})} />;
}

/** The emblem of a progress card's track: a bale (trade), a crown (politics), a quill (science). */
function TrackCrest({ track }: { track: Track }) {
  const c = TRACK_COLOR[track];
  switch (track) {
    case "trade":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <rect x="10" y="16" width="20" height="16" rx="2" fill={c} />
          <path d="M10 24 H30 M20 16 V32" stroke={GILT} strokeWidth={1.4} />
          <path d="M14 16 V12 H26 V16" fill="none" />
        </g>
      );
    case "politics":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M9 32 L9 18 L15 24 L20 13 L25 24 L31 18 L31 32 Z" fill={c} />
          <circle cx="20" cy="13" r="1.6" fill={GILT} />
          <circle cx="9" cy="18" r="1.4" fill={GILT} />
          <circle cx="31" cy="18" r="1.4" fill={GILT} />
        </g>
      );
    case "science":
      return (
        <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round">
          <path d="M26 11 Q30 18 20 30 L17 33 L16 30 Q22 18 26 11 Z" fill={c} />
          <path d="M16 30 L13 34" />
          <ellipse cx="12" cy="36" rx="2.4" ry="1.4" fill={INK} />
        </g>
      );
    default: {
      const exhaustive: never = track;
      return <g>{String(exhaustive)}</g>;
    }
  }
}

export function ProgressCardFace({ card, size = 40 }: { card: ProgressCard; size?: number }) {
  const track = trackOfCard(card);
  const vp = card === "constitution" || card === "printer";
  return (
    <svg viewBox="0 0 40 56" width={size} height={size * 1.4} aria-hidden className="shrink-0" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.35))" }}>
      <rect x="1" y="1" width="38" height="54" rx="3.5" fill={PARCHMENT} stroke={INK} strokeWidth={1.6} />
      <rect x="4" y="4" width="32" height="48" rx="2" fill="none" stroke={vp ? GILT : TRACK_COLOR[track]} strokeWidth={1.4} />
      <TrackCrest track={track} />
      {vp && <path d="M20 36 L21.5 40 L26 40 L22.5 42.5 L24 46.5 L20 44 L16 46.5 L17.5 42.5 L14 40 L18.5 40 Z" fill={GILT} stroke={INK} strokeWidth={0.8} />}
      <text x="20" y={vp ? 51 : 47} textAnchor="middle" fontSize="4.6" fontWeight={700} fill={INK} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {PROGRESS_CARD_LABEL[card]}
      </text>
    </svg>
  );
}
