/**
 * Draw an AvatarSpec as an SVG string (docs/phase7.md §4): flat shapes,
 * thick ink outline, 96×96 viewBox. Everything is original line art built
 * from primitives; nothing is loaded from outside.
 */

import { normalizeAvatar, type AvatarSpec } from "./spec";

export const INK = "#211d19";
const STROKE = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;

export const SKIN_TONES = ["#f3d9c4", "#e8c39e", "#d1a37a", "#b98157", "#8d5a3a", "#5b3a26"] as const;
export const HAIR_COLORS = ["#1f1a17", "#5a3a22", "#8a4b2a", "#d8b45a", "#b8452a", "#a9a39b"] as const;
const PARCHMENT = "#efe8d8";
const GOLD = "#d9a21b";
const STEEL = "#9a9ea6";
const LEATHER = "#6b4a2b";
const STRAW = "#d9c26a";

export interface RenderOptions {
  /** The player's colour; used for the garment (and hood). */
  readonly color?: string;
  /** Rendered width/height attribute; the viewBox is always 96. */
  readonly size?: number;
  /** Background disc colour; omit for transparent. */
  readonly background?: string;
  /** Extra attributes on the root element (e.g. class="…"). */
  readonly attrs?: string;
}

function darken(hex: string, amount = 0.25): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Layers. Each returns SVG markup; `back` parts are drawn behind the face.

function garment(kind: number, color: string): string {
  const dark = darken(color, 0.3);
  switch (kind) {
    case 0: // tunic
      return `<path d="M18 96 L24 72 Q48 62 72 72 L78 96 Z" fill="${color}" ${STROKE}/><path d="M40 70 L48 82 L56 70" fill="none" ${STROKE}/>`;
    case 1: // robe
      return `<path d="M14 96 L22 70 Q48 60 74 70 L82 96 Z" fill="${color}" ${STROKE}/><path d="M38 74 L36 96 M58 74 L60 96" fill="none" stroke="${dark}" stroke-width="2"/>`;
    case 2: // gambeson
      return `<path d="M18 96 L24 72 Q48 62 72 72 L78 96 Z" fill="${color}" ${STROKE}/><path d="M23 80 H73 M22 87 H74 M21 94 H75" fill="none" stroke="${dark}" stroke-width="1.6" stroke-dasharray="3 2"/>`;
    case 3: // cloak
      return `<path d="M12 96 L20 68 Q48 58 76 68 L84 96 Z" fill="${dark}" ${STROKE}/><path d="M30 96 L34 74 Q48 68 62 74 L66 96 Z" fill="${color}" ${STROKE}/><circle cx="48" cy="71" r="3.2" fill="${GOLD}" ${STROKE}/>`;
    default: // apron
      return `<path d="M18 96 L24 72 Q48 62 72 72 L78 96 Z" fill="${color}" ${STROKE}/><rect x="34" y="74" width="28" height="22" rx="3" fill="${PARCHMENT}" ${STROKE}/><path d="M38 74 L36 68 M58 74 L60 68" fill="none" ${STROKE}/>`;
  }
}

function face(kind: number, skin: string): string {
  const body = `<rect x="41" y="54" width="14" height="14" fill="${skin}" ${STROKE}/>`;
  const ears = `<circle cx="28" cy="43" r="4.5" fill="${skin}" ${STROKE}/><circle cx="68" cy="43" r="4.5" fill="${skin}" ${STROKE}/>`;
  switch (kind) {
    case 0:
      return `${body}${ears}<ellipse cx="48" cy="42" rx="19" ry="21" fill="${skin}" ${STROKE}/>`;
    case 1:
      return `${body}${ears}<ellipse cx="48" cy="42" rx="17" ry="24" fill="${skin}" ${STROKE}/>`;
    default:
      return `${body}${ears}<rect x="30" y="20" width="36" height="44" rx="11" fill="${skin}" ${STROKE}/>`;
  }
}

function eyes(kind: number): string {
  switch (kind) {
    case 0:
      return `<circle cx="40" cy="40" r="2.3" fill="${INK}"/><circle cx="56" cy="40" r="2.3" fill="${INK}"/>`;
    case 1:
      return `<circle cx="40" cy="40" r="4" fill="#fff" ${STROKE}/><circle cx="56" cy="40" r="4" fill="#fff" ${STROKE}/><circle cx="41" cy="40.5" r="1.8" fill="${INK}"/><circle cx="57" cy="40.5" r="1.8" fill="${INK}"/>`;
    case 2:
      return `<path d="M36 40 L44 40 M52 40 L60 40" fill="none" ${STROKE}/>`;
    default:
      return `<path d="M36 41 Q40 36 44 41 M52 41 Q56 36 60 41" fill="none" ${STROKE}/>`;
  }
}

function brows(kind: number): string {
  switch (kind) {
    case 0:
      return `<path d="M35 33 L45 33 M51 33 L61 33" fill="none" ${STROKE}/>`;
    case 1:
      return `<path d="M35 34 Q40 29 45 34 M51 34 Q56 29 61 34" fill="none" ${STROKE}/>`;
    default:
      return `<path d="M34 33 L45 34 M51 34 L62 33" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
  }
}

function mouth(kind: number): string {
  switch (kind) {
    case 0:
      return `<path d="M41 51 Q48 57 55 51" fill="none" ${STROKE}/>`;
    case 1:
      return `<path d="M42 52 L54 52" fill="none" ${STROKE}/>`;
    case 2:
      return `<path d="M40 50 Q48 60 56 50 Z" fill="#fff" ${STROKE}/><path d="M43 50 L53 50" stroke="${INK}" stroke-width="1.5"/>`;
    default:
      return `<path d="M41 54 Q48 48 55 54" fill="none" ${STROKE}/>`;
  }
}

function facialHair(kind: number, color: string): string {
  switch (kind) {
    case 1:
      return `<path d="M39 49 Q44 44 48 49 Q52 44 57 49" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
    case 2:
      return `<path d="M43 56 Q48 68 53 56 Z" fill="${color}" ${STROKE}/>`;
    case 3:
      return `<path d="M30 44 Q30 70 48 70 Q66 70 66 44 Q60 58 48 58 Q36 58 30 44 Z" fill="${color}" ${STROKE}/>`;
    case 4:
      return `<g fill="${color}">${[34, 40, 46, 52, 58, 37, 43, 49, 55, 61]
        .map((x, i) => `<circle cx="${x}" cy="${i < 5 ? 55 : 59}" r="1.1"/>`)
        .join("")}</g>`;
    case 5:
      return `<path d="M32 46 Q34 80 48 86 Q62 80 64 46 Q58 60 48 60 Q38 60 32 46 Z" fill="${color}" ${STROKE}/><path d="M42 66 L41 80 M54 66 L55 80" fill="none" stroke="${darken(color)}" stroke-width="1.5"/>`;
    default:
      return "";
  }
}

function hair(kind: number, color: string): { back: string; front: string } {
  const cap = `<path d="M29 34 Q48 12 67 34 Q48 25 29 34 Z" fill="${color}" ${STROKE}/>`;
  switch (kind) {
    case 0:
      return { back: "", front: cap };
    case 1:
      return { back: "", front: `<path d="M27 40 Q48 6 69 40 L69 36 Q48 20 27 36 Z" fill="${color}" ${STROKE}/>` };
    case 2:
      return {
        back: `<path d="M26 40 Q26 10 48 10 Q70 10 70 40 L73 76 L23 76 Z" fill="${color}" ${STROKE}/>`,
        front: cap,
      };
    case 3: {
      const curls = [
        [30, 32],
        [36, 22],
        [48, 16],
        [60, 22],
        [66, 32],
        [26, 44],
        [70, 44],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${color}" ${STROKE}/>`)
        .join("");
      return { back: curls, front: `<path d="M30 36 Q48 20 66 36 Q48 30 30 36 Z" fill="${color}" ${STROKE}/>` };
    }
    case 4:
      return {
        back: `<path d="M31 44 L28 80 M65 44 L68 80" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/><path d="M31 44 L28 80 M65 44 L68 80" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
        front: cap,
      };
    case 5:
      return { back: `<circle cx="48" cy="18" r="7.5" fill="${color}" ${STROKE}/>`, front: cap };
    case 6:
      return { back: "", front: `<path d="M29 40 Q30 26 38 24 M58 24 Q66 26 67 40" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/><path d="M29 40 Q30 26 38 24 M58 24 Q66 26 67 40" fill="none" stroke="${INK}" stroke-width="1.5"/>` };
    case 7:
      return { back: "", front: `<path d="M28 38 Q30 26 40 26 L38 34 Z M68 38 Q66 26 56 26 L58 34 Z" fill="${color}" ${STROKE}/>` };
    case 8:
      return {
        back: "",
        front: `<path d="M27 36 L31 22 L37 30 L42 14 L48 26 L54 14 L59 30 L65 22 L69 36 Q48 30 27 36 Z" fill="${color}" ${STROKE}/>`,
      };
    default:
      return { back: "", front: "" };
  }
}

function headwear(kind: number, color: string): { back: string; front: string } {
  switch (kind) {
    case 0: // hood, in the player's colour
      return {
        back: `<path d="M20 74 Q14 12 48 8 Q82 12 76 74 Z" fill="${darken(color, 0.15)}" ${STROKE}/>`,
        front: `<path d="M26 74 Q24 30 48 26 Q72 30 70 74" fill="none" ${STROKE}/>`,
      };
    case 1: // coif
      return {
        back: `<path d="M26 60 Q26 12 48 12 Q70 12 70 60 Z" fill="${PARCHMENT}" ${STROKE}/>`,
        front: `<path d="M30 40 Q32 22 48 22 Q64 22 66 40" fill="none" ${STROKE}/><path d="M38 62 L36 70 M58 62 L60 70" fill="none" ${STROKE}/>`,
      };
    case 2: // cap
      return { back: "", front: `<path d="M26 30 Q48 8 70 30 L74 32 L22 32 Z" fill="${LEATHER}" ${STROKE}/>` };
    case 3: // circlet
      return { back: "", front: `<path d="M30 28 Q48 20 66 28" fill="none" stroke="${GOLD}" stroke-width="3.5"/><path d="M30 28 Q48 20 66 28" fill="none" stroke="${INK}" stroke-width="1"/><circle cx="48" cy="23" r="2.2" fill="#b83a2c" ${STROKE}/>` };
    case 4: // kettle helm
      return { back: "", front: `<path d="M22 30 Q48 4 74 30 L80 32 L16 32 Z" fill="${STEEL}" ${STROKE}/><circle cx="36" cy="27" r="1.3" fill="${INK}"/><circle cx="48" cy="24" r="1.3" fill="${INK}"/><circle cx="60" cy="27" r="1.3" fill="${INK}"/>` };
    case 5: // wimple
      return {
        back: `<path d="M24 30 Q48 6 72 30 L78 78 L18 78 Z" fill="${PARCHMENT}" ${STROKE}/>`,
        front: `<path d="M30 34 Q48 16 66 34" fill="none" ${STROKE}/>`,
      };
    case 6: // crown
      return { back: "", front: `<path d="M30 30 L34 14 L41 25 L48 10 L55 25 L62 14 L66 30 Z" fill="${GOLD}" ${STROKE}/><circle cx="48" cy="26" r="1.8" fill="#2f5f9d"/>` };
    case 7: // straw hat
      return { back: "", front: `<path d="M32 30 Q34 10 48 10 Q62 10 64 30 Z" fill="${STRAW}" ${STROKE}/><ellipse cx="48" cy="30" rx="31" ry="7" fill="${STRAW}" ${STROKE}/><path d="M34 26 H62" stroke="${LEATHER}" stroke-width="3"/>` };
    default:
      return { back: "", front: "" };
  }
}

function accessory(kind: number): string {
  switch (kind) {
    case 0: // quill
      return `<path d="M76 92 L90 64" fill="none" ${STROKE}/><path d="M84 76 Q96 62 92 58 Q84 60 82 78 Z" fill="${PARCHMENT}" ${STROKE}/>`;
    case 1: // tankard
      return `<rect x="72" y="74" width="15" height="18" rx="2" fill="${LEATHER}" ${STROKE}/><path d="M87 78 Q94 83 87 88" fill="none" ${STROKE}/><path d="M72 76 Q80 70 87 76" fill="#fff" ${STROKE}/>`;
    case 2: // lantern
      return `<rect x="75" y="72" width="13" height="16" rx="2" fill="${GOLD}" ${STROKE}/><path d="M77 72 L81.5 66 L86 72" fill="none" ${STROKE}/><circle cx="81.5" cy="80" r="3" fill="#fff4c2"/>`;
    case 3: // hawk on the shoulder
      return `<ellipse cx="80" cy="72" rx="6" ry="9" fill="${LEATHER}" ${STROKE}/><circle cx="80" cy="62" r="4.5" fill="${LEATHER}" ${STROKE}/><path d="M84 62 L88 63 L84 65 Z" fill="${GOLD}" ${STROKE}/><circle cx="81" cy="61" r="1" fill="${INK}"/><path d="M78 80 L77 84 M82 80 L83 84" fill="none" ${STROKE}/>`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------

/** Render a spec to a complete `<svg>` element (viewBox 0 0 96 96). */
export function renderAvatar(specIn: AvatarSpec, options: RenderOptions = {}): string {
  const spec = normalizeAvatar(specIn);
  const color = options.color ?? "#7d8089";
  const skin = SKIN_TONES[spec.skin] ?? SKIN_TONES[0];
  const hairColor = HAIR_COLORS[spec.hairColor] ?? HAIR_COLORS[0];
  const h = hair(spec.hair, hairColor);
  const w = headwear(spec.headwear, color);
  const size = options.size === undefined ? "" : ` width="${options.size}" height="${options.size}"`;
  const bg = options.background ? `<circle cx="48" cy="48" r="47" fill="${options.background}"/>` : "";
  const body = [
    bg,
    w.back,
    h.back,
    garment(spec.garment, color),
    face(spec.face, skin),
    facialHair(spec.facialHair, hairColor),
    eyes(spec.eyes),
    brows(spec.brows),
    mouth(spec.mouth),
    h.front,
    w.front,
    accessory(spec.accessory),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"${size} ${options.attrs ?? ""} role="img" aria-label="portrait">${body}</svg>`;
}
