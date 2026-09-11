/**
 * Pure SVG pieces for the board (docs/phase3.md §4.2). All art is original,
 * drawn with simple strokes; no raster images.
 */

import type { PlayerColor, PortKind, Resource, Terrain } from "@katan/engine";
import { HOT_TOKEN, INK, PARCHMENT, PLAYER_FILL, RESOURCE_COLOR, TERRAIN_FILL, TERRAIN_MARK } from "@/game/theme";
import { RESOURCE_SHORT, portLabel } from "@/game/labels";

/** Hand-drawn-style pattern per terrain. Sized in user units for R ≈ 50. */
export function TerrainDefs() {
  const s = 22;
  const p = (t: Terrain, children: React.ReactNode) => (
    <pattern id={`pat-${t}`} key={t} width={s} height={s} patternUnits="userSpaceOnUse">
      <rect width={s} height={s} fill={TERRAIN_FILL[t]} />
      <g stroke={TERRAIN_MARK[t]} strokeWidth={1.4} strokeLinecap="round" fill="none">
        {children}
      </g>
    </pattern>
  );
  return (
    <defs>
      {p(
        "forest",
        <>
          <path d="M6 16 L6 10 M3 12 L6 7 L9 12" />
          <path d="M16 20 L16 14 M13 16 L16 11 L19 16" />
        </>,
      )}
      {p(
        "claypit",
        <>
          <path d="M1 6 H10 M12 6 H21 M1 14 H8 M10 14 H21" />
          <path d="M5 10 H15 M17 10 H21 M1 18 H4 M6 18 H16" strokeWidth={1} />
        </>,
      )}
      {p(
        "meadow",
        <>
          <path d="M4 14 q1 -4 2 -6 M7 15 q0 -3 2 -5 M15 8 q1 -3 2 -5 M18 9 q0 -2 2 -4" />
        </>,
      )}
      {p(
        "farmland",
        <>
          <path d="M3 5 H19 M3 11 H19 M3 17 H19" strokeWidth={1} strokeDasharray="3 2" />
        </>,
      )}
      {p(
        "mountain",
        <>
          <path d="M2 18 L8 8 L12 14 M9 18 L15 6 L21 18" />
        </>,
      )}
      {p("wasteland", null)}
    </defs>
  );
}

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

export function NumberToken({ x, y, n, R }: { x: number; y: number; n: number; R: number }) {
  const hot = n === 6 || n === 8;
  const r = R * 0.3;
  const pips = PIPS[n] ?? 0;
  const pipGap = r * 0.28;
  return (
    <g aria-label={`token ${n}`}>
      <circle cx={x} cy={y} r={r} fill={PARCHMENT} stroke={INK} strokeWidth={1.5} />
      <text
        x={x}
        y={y + r * 0.12}
        textAnchor="middle"
        fontSize={r * 1.05}
        fontWeight={700}
        fill={hot ? HOT_TOKEN : INK}
      >
        {n}
      </text>
      <g fill={hot ? HOT_TOKEN : INK}>
        {Array.from({ length: pips }, (_, i) => (
          <circle key={i} cx={x + (i - (pips - 1) / 2) * pipGap} cy={y + r * 0.62} r={r * 0.07} />
        ))}
      </g>
    </g>
  );
}

export function Robber({ x, y, R }: { x: number; y: number; R: number }) {
  const s = R * 0.22;
  return (
    <g aria-label="robber" transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={s * 1.6} rx={s * 1.1} ry={s * 0.35} fill="rgba(0,0,0,.25)" />
      <path
        d={`M ${-s} ${s * 1.4} Q ${-s * 1.1} ${-s * 0.2} 0 ${-s * 0.4} Q ${s * 1.1} ${-s * 0.2} ${s} ${s * 1.4} Z`}
        fill="#2a2622"
        stroke={INK}
        strokeWidth={1}
      />
      <circle cx={0} cy={-s * 0.9} r={s * 0.65} fill="#2a2622" stroke={INK} strokeWidth={1} />
    </g>
  );
}

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
  const r = R * 0.34;
  const fill = kind === "any" ? PARCHMENT : RESOURCE_COLOR[kind];
  const text = kind === "any" ? INK : "#fff";
  return (
    <g aria-label={`harbor ${portLabel(kind)} ${kind}`}>
      {ends.map((e, i) => (
        <line key={i} x1={x} y1={y} x2={e.x} y2={e.y} stroke={PARCHMENT} strokeWidth={2.5} strokeDasharray="4 3" opacity={0.85} />
      ))}
      <circle cx={x} cy={y} r={r} fill={fill} stroke={INK} strokeWidth={1.5} />
      <text x={x} y={y + r * 0.05} textAnchor="middle" fontSize={r * 0.72} fontWeight={700} fill={text}>
        {portLabel(kind)}
      </text>
      <text x={x} y={y + r * 0.62} textAnchor="middle" fontSize={r * 0.42} fontWeight={600} fill={text}>
        {kind === "any" ? "any" : RESOURCE_SHORT[kind as Resource]}
      </text>
      {owned && <line x1={x - r * 0.6} y1={y + r * 0.8} x2={x + r * 0.6} y2={y + r * 0.8} stroke={text} strokeWidth={1.5} />}
    </g>
  );
}

export function SettlementGlyph({ x, y, color, R }: { x: number; y: number; color: PlayerColor; R: number }) {
  const s = R * 0.24;
  const pts = [
    [-s, s * 0.9],
    [-s, -s * 0.1],
    [0, -s],
    [s, -s * 0.1],
    [s, s * 0.9],
  ]
    .map(([px, py]) => `${x + px!},${y + py!}`)
    .join(" ");
  return <polygon points={pts} fill={PLAYER_FILL[color]} stroke={INK} strokeWidth={2} strokeLinejoin="round" />;
}

export function CityGlyph({ x, y, color, R }: { x: number; y: number; color: PlayerColor; R: number }) {
  const s = R * 0.32;
  const pts = [
    [-s, s * 0.9],
    [-s, -s * 0.9],
    [-s * 0.6, -s * 1.15],
    [-s * 0.2, -s * 0.9],
    [-s * 0.2, -s * 0.2],
    [s * 0.3, -s * 0.2],
    [s * 0.6, -s * 0.6],
    [s, -s * 0.2],
    [s, s * 0.9],
  ]
    .map(([px, py]) => `${x + px!},${y + py!}`)
    .join(" ");
  return <polygon points={pts} fill={PLAYER_FILL[color]} stroke={INK} strokeWidth={2} strokeLinejoin="round" />;
}
