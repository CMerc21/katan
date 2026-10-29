/**
 * A standing, full-body figure for the same AvatarSpec (docs/phase13.md §2):
 * the portrait's head on a body whose outfit follows `garment`, with the
 * accessory carried in hand (or the hawk on a shoulder). Same flat shapes and
 * ink outline as the portrait; viewBox 0 0 120 228, feet on y 212.
 */

import { INK, SKIN_TONES, darken, headLayers } from "./render";
import { normalizeAvatar, type AvatarSpec } from "./spec";

const STROKE = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;
const PARCHMENT = "#efe8d8";
const GOLD = "#d9a21b";
const LEATHER = "#6b4a2b";
const BOOT = "#4a2f1c";

export const FIGURE_VIEWBOX = "0 0 120 228";

export interface FigureOptions {
  /** The outfit colour (the player's colour). */
  readonly color?: string;
  /** Rendered height; width follows the viewBox ratio. */
  readonly height?: number;
  /** Draw the soft ground shadow under the feet (default true). */
  readonly shadow?: boolean;
  readonly attrs?: string;
}

function legs(color: string, long: boolean): string {
  const hose = darken(color, 0.55);
  const boots = `<path d="M44 196 L56 196 L57 212 L40 212 Q40 204 44 196 Z" fill="${BOOT}" ${STROKE}/><path d="M64 196 L76 196 Q80 204 80 212 L63 212 Z" fill="${BOOT}" ${STROKE}/>`;
  if (long) return boots;
  return `<rect x="46" y="144" width="11" height="56" rx="3" fill="${hose}" ${STROKE}/><rect x="63" y="144" width="11" height="56" rx="3" fill="${hose}" ${STROKE}/>${boots}`;
}

function arms(color: string, skin: string): string {
  const sleeve = darken(color, 0.12);
  return [
    `<path d="M40 70 Q28 78 26 104 L24 132 L34 134 L37 106 Q40 90 46 84 Z" fill="${sleeve}" ${STROKE}/>`,
    `<path d="M80 70 Q92 78 94 104 L96 132 L86 134 L83 106 Q80 90 74 84 Z" fill="${sleeve}" ${STROKE}/>`,
    `<circle cx="29" cy="138" r="6" fill="${skin}" ${STROKE}/>`,
    `<circle cx="91" cy="138" r="6" fill="${skin}" ${STROKE}/>`,
  ].join("");
}

const TUNIC = "M38 68 Q60 60 82 68 L90 150 Q60 158 30 150 Z";

function belt(y: number): string {
  return `<path d="M33 ${y} Q60 ${y + 6} 87 ${y} L87.6 ${y + 7} Q60 ${y + 13} 32.4 ${y + 7} Z" fill="${LEATHER}" ${STROKE}/><rect x="55" y="${y + 3}" width="10" height="8" rx="1.5" fill="${GOLD}" ${STROKE}/>`;
}

/** Body and outfit; `behind` is drawn before the legs (the cloak). */
function outfit(kind: number, color: string): { behind: string; body: string; long: boolean } {
  const dark = darken(color, 0.3);
  const neck = `<path d="M50 66 L60 80 L70 66" fill="none" ${STROKE}/>`;
  switch (kind) {
    case 0: // tunic
      return { behind: "", long: false, body: `<path d="${TUNIC}" fill="${color}" ${STROKE}/>${belt(110)}${neck}<path d="M34 146 Q60 152 86 146" fill="none" stroke="${dark}" stroke-width="2"/>` };
    case 1: // robe, to the ankle
      return {
        behind: "",
        long: true,
        body: `<path d="M36 68 Q60 58 84 68 L98 202 Q60 210 22 202 Z" fill="${color}" ${STROKE}/><path d="M48 112 L42 202 M72 112 L78 202" fill="none" stroke="${dark}" stroke-width="2"/><path d="M34 108 Q60 116 86 108 L86 116 Q60 124 34 116 Z" fill="${GOLD}" ${STROKE}/>${neck}`,
      };
    case 2: // gambeson, quilted
      return {
        behind: "",
        long: false,
        body: `<path d="M36 68 Q60 58 84 68 L92 148 Q60 156 28 148 Z" fill="${color}" ${STROKE}/>${[88, 100, 112, 124, 136].map((y) => `<path d="M${33 + (y - 88) * 0.05} ${y} Q60 ${y + 5} ${87 - (y - 88) * 0.05} ${y}" fill="none" stroke="${dark}" stroke-width="1.6" stroke-dasharray="3 2"/>`).join("")}<path d="M60 74 L60 150" fill="none" stroke="${dark}" stroke-width="1.6"/>${neck}`,
      };
    case 3: // cloak over a tunic
      return {
        behind: `<path d="M32 66 Q60 54 88 66 L104 204 Q60 214 16 204 Z" fill="${dark}" ${STROKE}/>`,
        long: false,
        body: `<path d="M42 70 Q60 64 78 70 L84 150 Q60 156 36 150 Z" fill="${color}" ${STROKE}/>${belt(112)}<path d="M36 66 Q60 80 84 66" fill="none" stroke="${dark}" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="74" r="4" fill="${GOLD}" ${STROKE}/>`,
      };
    default: // apron over a tunic
      return {
        behind: "",
        long: false,
        body: `<path d="${TUNIC}" fill="${color}" ${STROKE}/>${neck}<path d="M44 92 L76 92 L80 162 Q60 168 40 162 Z" fill="${PARCHMENT}" ${STROKE}/><path d="M44 92 L40 72 M76 92 L80 72" fill="none" ${STROKE}/><rect x="52" y="120" width="16" height="12" rx="2" fill="none" stroke="${LEATHER}" stroke-width="1.8"/>`,
      };
  }
}

/** The accessory: held in the right hand (viewer's right) or, for the hawk, on the shoulder. */
function carried(kind: number): { behind: string; front: string } {
  switch (kind) {
    case 0: // quill
      return { behind: "", front: `<path d="M90 140 L106 96" fill="none" ${STROKE}/><path d="M100 112 Q116 92 110 84 Q100 90 98 116 Z" fill="${PARCHMENT}" ${STROKE}/>` };
    case 1: // tankard
      return { behind: "", front: `<rect x="84" y="126" width="18" height="22" rx="2" fill="${LEATHER}" ${STROKE}/><path d="M102 131 Q110 137 102 143" fill="none" ${STROKE}/><path d="M84 128 Q93 120 102 128" fill="#fff" ${STROKE}/>` };
    case 2: // lantern, hanging from the hand
      return { behind: "", front: `<path d="M91 140 L91 150" fill="none" ${STROKE}/><path d="M85 156 L91 148 L97 156" fill="none" ${STROKE}/><rect x="83" y="156" width="16" height="20" rx="2" fill="${GOLD}" ${STROKE}/><circle cx="91" cy="166" r="4" fill="#fff4c2"/>` };
    case 3: // hawk on the right shoulder
      return { behind: "", front: `<ellipse cx="88" cy="58" rx="7" ry="11" fill="${LEATHER}" ${STROKE}/><circle cx="88" cy="45" r="5.5" fill="${LEATHER}" ${STROKE}/><path d="M93 45 L98 46 L93 48 Z" fill="${GOLD}" ${STROKE}/><circle cx="89.5" cy="44" r="1.1" fill="${INK}"/><path d="M85 68 L84 72 M91 68 L92 72" fill="none" ${STROKE}/>` };
    default:
      return { behind: "", front: "" };
  }
}

/** Render a spec as a standing figure (viewBox 0 0 120 228). */
export function renderFigure(specIn: AvatarSpec, options: FigureOptions = {}): string {
  const spec = normalizeAvatar(specIn);
  const color = options.color ?? "#7d8089";
  const skin = SKIN_TONES[spec.skin] ?? SKIN_TONES[0];
  const head = headLayers(spec, color);
  const dress = outfit(spec.garment, color);
  const item = carried(spec.accessory);
  const size = options.height === undefined ? "" : ` width="${Math.round((options.height * 120) / 228)}" height="${options.height}"`;
  const shadow = options.shadow === false ? "" : `<ellipse cx="60" cy="213" rx="38" ry="7" fill="${INK}" opacity="0.28"/>`;
  const body = [
    shadow,
    dress.behind,
    `<g transform="translate(12 0)">${head.back}</g>`,
    legs(color, dress.long),
    dress.body,
    item.behind,
    arms(color, skin),
    `<g transform="translate(12 0)">${head.front}</g>`,
    item.front,
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FIGURE_VIEWBOX}"${size} ${options.attrs ?? ""} role="img" aria-label="character">${body}</svg>`;
}
