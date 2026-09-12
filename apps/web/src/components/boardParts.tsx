/**
 * Pure SVG pieces for the 2D board (docs/phase3.md §4.2, docs/phase7.md §6,
 * docs/art-direction.md). All art is original line work; no raster images.
 * Used in play until Phase 7.5 and for thumbnails afterwards.
 */

import type { PlayerColor, PortKind, Resource, Terrain } from "@katan/engine";
import { GILT, HOT_TOKEN, INK, PARCHMENT, PLAYER_FILL, RESOURCE_COLOR, TERRAIN_FILL, TERRAIN_MARK } from "@/game/theme";
import { RESOURCE_SHORT, portLabel } from "@/game/labels";

/** Hand-drawn detail per terrain: trees with shadows, furrows, quarried faces, brick kilns, sheep. */
export function TerrainDefs() {
  const s = 26;
  const p = (t: Terrain, children: React.ReactNode) => (
    <pattern id={`pat-${t}`} key={t} width={s} height={s} patternUnits="userSpaceOnUse">
      <rect width={s} height={s} fill={TERRAIN_FILL[t]} />
      <g stroke={TERRAIN_MARK[t]} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {children}
      </g>
    </pattern>
  );
  const dark = (t: Terrain) => TERRAIN_MARK[t];
  return (
    <defs>
      {p(
        "forest",
        <>
          <ellipse cx="8" cy="17" rx="5" ry="1.6" fill="rgba(0,0,0,.18)" stroke="none" />
          <path d="M8 16 V11 M4 12 L8 5 L12 12 Z" fill={dark("forest")} />
          <ellipse cx="19" cy="24" rx="5" ry="1.6" fill="rgba(0,0,0,.18)" stroke="none" />
          <path d="M19 23 V18 M15 19 L19 12 L23 19 Z" fill={dark("forest")} />
          <path d="M20 8 a3 3 0 1 1 0.1 0" fill={dark("forest")} />
        </>,
      )}
      {p(
        "claypit",
        <>
          <path d="M1 6 H10 M12 6 H21 M1 14 H8 M10 14 H21 M5 10 H15 M17 10 H24 M1 18 H4 M6 18 H16 M18 22 H24 M2 22 H14" strokeWidth={1.1} />
          <path d="M17 14 q3 -6 6 0 v3 h-6 z" fill={dark("claypit")} />
          <path d="M22 8 v4" strokeWidth={1.6} />
        </>,
      )}
      {p(
        "meadow",
        <>
          <path d="M4 14 q1 -4 2 -6 M7 15 q0 -3 2 -5 M15 8 q1 -3 2 -5 M18 9 q0 -2 2 -4 M11 22 q1 -3 2 -5" />
          <ellipse cx="20" cy="19" rx="3" ry="2.1" fill="#f1eee5" stroke={INK} strokeWidth={0.7} />
          <circle cx="22.6" cy="18.4" r="1" fill={INK} stroke="none" />
          <path d="M18.5 21 v1.5 M21.5 21 v1.5" stroke={INK} strokeWidth={0.7} />
        </>,
      )}
      {p(
        "farmland",
        <>
          <path d="M2 5 H24 M2 11 H24 M2 17 H24 M2 23 H24" strokeWidth={1.2} strokeDasharray="4 2" />
          <path d="M6 8 v-3 M12 8 v-3 M18 8 v-3 M6 20 v-3 M12 20 v-3 M18 20 v-3" strokeWidth={1} />
        </>,
      )}
      {p(
        "mountain",
        <>
          <path d="M2 20 L8 8 L12 15 M9 20 L15 5 L21 20 Z" fill={dark("mountain")} />
          <path d="M13 9 L15 5 L17 9 Z" fill="#f4f4f2" stroke="none" />
          <path d="M16 12 L19 16 L15 16 Z" fill="#4c4f56" stroke="none" />
          <path d="M3 24 h6" strokeWidth={1.4} />
        </>,
      )}
      {p(
        "wasteland",
        <>
          <path d="M2 10 q6 -4 12 0 t12 0 M2 20 q6 -4 12 0 t12 0" strokeWidth={1} />
          <path d="M8 16 v-5 M6 13 h4" strokeWidth={0.9} />
        </>,
      )}
    </defs>
  );
}

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

/** A clay disc with an embossed numeral; 6 and 8 get a gilt ring (illuminated capital). */
export function NumberToken({ x, y, n, R, className = "" }: { x: number; y: number; n: number; R: number; className?: string }) {
  const hot = n === 6 || n === 8;
  const r = R * 0.3;
  const pips = PIPS[n] ?? 0;
  const pipGap = r * 0.28;
  const color = hot ? HOT_TOKEN : INK;
  return (
    <g aria-label={`token ${n}`} className={className} data-token={n}>
      <circle cx={x} cy={y + 1.5} r={r} fill="rgba(0,0,0,.28)" />
      <circle cx={x} cy={y} r={r} fill="#d9b58a" stroke="#8a6a44" strokeWidth={1.5} />
      <circle cx={x} cy={y} r={r * 0.82} fill="none" stroke={hot ? GILT : "#c19d70"} strokeWidth={hot ? 1.8 : 1} />
      <text x={x + 0.6} y={y + r * 0.12 + 0.6} textAnchor="middle" fontSize={r * 1.05} fontWeight={700} fill="#f6ead3" fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {n}
      </text>
      <text x={x} y={y + r * 0.12} textAnchor="middle" fontSize={r * 1.05} fontWeight={700} fill={color} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {n}
      </text>
      <g fill={color}>
        {Array.from({ length: pips }, (_, i) => (
          <circle key={i} cx={x + (i - (pips - 1) / 2) * pipGap} cy={y + r * 0.62} r={r * 0.07} />
        ))}
      </g>
    </g>
  );
}

/** A hooded figure with a sack. */
export function Robber({ x, y, R, className = "" }: { x: number; y: number; R: number; className?: string }) {
  const s = R * 0.22;
  return (
    <g aria-label="robber" className={className} style={{ transform: `translate(${x}px, ${y}px)` }} data-testid="robber">
      <ellipse cx={0} cy={s * 1.6} rx={s * 1.2} ry={s * 0.38} fill="rgba(0,0,0,.3)" />
      <path d={`M ${-s} ${s * 1.4} Q ${-s * 1.15} ${-s * 0.2} 0 ${-s * 0.5} Q ${s * 1.15} ${-s * 0.2} ${s} ${s * 1.4} Z`} fill="#2a2622" stroke={INK} strokeWidth={1} />
      <path d={`M ${-s * 0.55} ${-s * 0.75} Q 0 ${-s * 1.75} ${s * 0.55} ${-s * 0.75} Q 0 ${-s * 0.35} ${-s * 0.55} ${-s * 0.75} Z`} fill="#2a2622" stroke={INK} strokeWidth={1} />
      <path d={`M ${-s * 0.35} ${-s * 0.85} Q 0 ${-s * 0.55} ${s * 0.35} ${-s * 0.85}`} fill="none" stroke="#6a625a" strokeWidth={1} />
      <circle cx={s * 1.05} cy={s * 0.7} r={s * 0.5} fill="#8a6a44" stroke={INK} strokeWidth={1} />
      <path d={`M ${s * 0.85} ${s * 0.3} l ${s * 0.4} ${-s * 0.25}`} stroke={INK} strokeWidth={1} />
    </g>
  );
}

/** A wooden pier off the coast with a hanging sign showing the ratio. */
export function HarborMarker({
  x,
  y,
  ends,
  kind,
  R,
  owned,
}: {
  x: number;
  y: number;
  ends: readonly [{ x: number; y: number }, { x: number; y: number }];
  kind: PortKind;
  R: number;
  owned: boolean;
}) {
  const r = R * 0.3;
  const fill = kind === "any" ? PARCHMENT : RESOURCE_COLOR[kind];
  const text = kind === "any" ? INK : "#fff";
  const mx = (ends[0].x + ends[1].x) / 2;
  const my = (ends[0].y + ends[1].y) / 2;
  const ang = (Math.atan2(y - my, x - mx) * 180) / Math.PI;
  return (
    <g aria-label={`harbor ${portLabel(kind)} ${kind}`}>
      {ends.map((e, i) => (
        <line key={i} x1={mx} y1={my} x2={e.x} y2={e.y} stroke="#8a6a44" strokeWidth={3} strokeDasharray="5 3" opacity={0.9} />
      ))}
      <g transform={`translate(${mx} ${my}) rotate(${ang})`}>
        <rect x={0} y={-R * 0.09} width={R * 0.55} height={R * 0.18} fill="#8a6a44" stroke={INK} strokeWidth={1} />
        {[0.12, 0.26, 0.4].map((k) => (
          <line key={k} x1={R * k} y1={-R * 0.09} x2={R * k} y2={R * 0.09} stroke={INK} strokeWidth={0.7} />
        ))}
        <circle cx={R * 0.08} cy={R * 0.13} r={1.5} fill={INK} />
        <circle cx={R * 0.46} cy={R * 0.13} r={1.5} fill={INK} />
      </g>
      <line x1={x} y1={y - r * 1.1} x2={x} y2={y - r * 0.55} stroke={INK} strokeWidth={1.2} />
      <rect x={x - r} y={y - r * 0.55} width={r * 2} height={r * 1.25} rx={2} fill={fill} stroke={INK} strokeWidth={1.5} />
      <text x={x} y={y - r * 0.05} textAnchor="middle" fontSize={r * 0.7} fontWeight={700} fill={text} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {portLabel(kind)}
      </text>
      <text x={x} y={y + r * 0.5} textAnchor="middle" fontSize={r * 0.45} fontWeight={600} fill={text} fontFamily="Palatino Linotype, Palatino, Georgia, serif">
        {kind === "any" ? "any" : RESOURCE_SHORT[kind as Resource]}
      </text>
      {owned && <rect x={x - r * 0.7} y={y + r * 0.58} width={r * 1.4} height={2} fill={text} />}
    </g>
  );
}

/** A thatched cottage: parchment walls, straw roof, door and base ring in the player's colour. */
export function SettlementGlyph({ x, y, color, R, className = "" }: { x: number; y: number; color: PlayerColor; R: number; className?: string }) {
  const s = R * 0.26;
  const c = PLAYER_FILL[color];
  return (
    <g className={className} data-piece="settlement" data-color={color} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <ellipse cx={0} cy={s * 0.95} rx={s * 1.15} ry={s * 0.42} fill={c} stroke={INK} strokeWidth={1.5} />
      <rect x={-s * 0.85} y={-s * 0.1} width={s * 1.7} height={s * 0.95} fill="#efe2c4" stroke={INK} strokeWidth={1.5} />
      <path d={`M ${-s * 1.05} ${-s * 0.05} L 0 ${-s * 1.05} L ${s * 1.05} ${-s * 0.05} Z`} fill="#d9b258" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <path d={`M ${-s * 0.55} ${-s * 0.45} L ${s * 0.55} ${-s * 0.45}`} stroke="#b08a2c" strokeWidth={1} />
      <rect x={-s * 0.2} y={s * 0.3} width={s * 0.4} height={s * 0.55} fill={c} stroke={INK} strokeWidth={1} />
    </g>
  );
}

/** A stone keep with crenellations and a banner in the player's colour. */
export function CityGlyph({ x, y, color, R, className = "" }: { x: number; y: number; color: PlayerColor; R: number; className?: string }) {
  const s = R * 0.32;
  const c = PLAYER_FILL[color];
  return (
    <g className={className} data-piece="city" data-color={color} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <ellipse cx={0} cy={s * 0.95} rx={s * 1.25} ry={s * 0.45} fill={c} stroke={INK} strokeWidth={1.5} />
      <rect x={-s} y={-s * 0.5} width={s * 2} height={s * 1.4} fill="#a9a59b" stroke={INK} strokeWidth={1.5} />
      {[-0.9, -0.45, 0, 0.45].map((k) => (
        <rect key={k} x={s * k} y={-s * 0.75} width={s * 0.3} height={s * 0.3} fill="#a9a59b" stroke={INK} strokeWidth={1} />
      ))}
      <rect x={s * 0.25} y={-s * 1.2} width={s * 0.7} height={s * 1.1} fill="#8f8b82" stroke={INK} strokeWidth={1.5} />
      <path d={`M ${s * 0.6} ${-s * 1.2} v ${-s * 0.6} l ${s * 0.6} ${s * 0.18} l ${-s * 0.6} ${s * 0.18}`} fill={c} stroke={INK} strokeWidth={1} />
      <path d={`M ${-s * 0.6} ${s * 0.9} v ${-s * 0.5} a ${s * 0.25} ${s * 0.25} 0 0 1 ${s * 0.5} 0 v ${s * 0.5} Z`} fill={INK} />
      <path d={`M ${-s * 0.8} ${-s * 0.2} h ${s * 0.4} M ${-s * 0.7} ${s * 0.1} h ${s * 0.4}`} stroke="#6f6b63" strokeWidth={1} />
    </g>
  );
}

/** A timber plank with two stakes and a stripe in the player's colour. */
export function RoadGlyph({ a, b, color, R, className = "" }: { a: { x: number; y: number }; b: { x: number; y: number }; color: PlayerColor; R: number; className?: string }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return (
    <g className={className} data-piece="road" data-color={color} style={{ "--len": len } as React.CSSProperties}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={R * 0.24} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#8a6a44" strokeWidth={R * 0.17} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[color]} strokeWidth={R * 0.07} strokeLinecap="round" />
      <circle cx={a.x + (b.x - a.x) * 0.22} cy={a.y + (b.y - a.y) * 0.22} r={R * 0.05} fill={INK} />
      <circle cx={a.x + (b.x - a.x) * 0.78} cy={a.y + (b.y - a.y) * 0.78} r={R * 0.05} fill={INK} />
    </g>
  );
}
