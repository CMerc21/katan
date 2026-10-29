"use client";

/**
 * The home lobby's backdrop (docs/phase13.md §1): a late-afternoon valley in
 * flat painted layers — sky, sun, drifting clouds, two mountain ranges, a
 * walled town on the rise, a cobbled road running down to the viewer and
 * wheat on either side. Original art, drawn here; every scatter comes from a
 * fixed seed so the server and the client render identical markup.
 */

import { memo } from "react";

const W = 1600;
const H = 1000;
const HORIZON = 640;
/** The road's vanishing point and its width at the bottom edge. */
const ROAD_TOP = { x: 800, y: 600, half: 26 };
const ROAD_BOTTOM_HALF = 330;

/** mulberry32: a fixed stream for the scatters (no Math.random, so SSR matches). */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function r1(n: number): string {
  return n.toFixed(1);
}

/** Road half-width at height y (linear perspective from the vanishing point). */
function roadHalf(y: number): number {
  const t = (y - ROAD_TOP.y) / (H - ROAD_TOP.y);
  return ROAD_TOP.half + t * (ROAD_BOTTOM_HALF - ROAD_TOP.half);
}

/** Road centre drifts a little left as it nears the viewer. */
function roadX(y: number): number {
  const t = (y - ROAD_TOP.y) / (H - ROAD_TOP.y);
  return ROAD_TOP.x - Math.sin(t * Math.PI * 0.9) * 40;
}

function roadPath(): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let y = ROAD_TOP.y; y <= H + 40; y += 20) {
    left.push(`${r1(roadX(y) - roadHalf(y))} ${y}`);
    right.unshift(`${r1(roadX(y) + roadHalf(y))} ${y}`);
  }
  return `M${left.join(" L")} L${right.join(" L")} Z`;
}

function cobbles(): string[] {
  const next = stream(7);
  const out: string[] = [];
  let y = ROAD_TOP.y + 8;
  while (y < H + 20) {
    const t = (y - ROAD_TOP.y) / (H - ROAD_TOP.y);
    const size = 3 + t * 26;
    const half = roadHalf(y);
    const cx = roadX(y);
    const count = Math.max(2, Math.floor((half * 2) / (size * 1.25)));
    for (let i = 0; i < count; i++) {
      const x = cx - half + ((i + 0.5 + (next() - 0.5) * 0.5) / count) * half * 2;
      out.push(`<ellipse cx="${r1(x)}" cy="${r1(y + (next() - 0.5) * size * 0.3)}" rx="${r1(size * (0.5 + next() * 0.15))}" ry="${r1(size * 0.32)}"/>`);
    }
    y += size * 0.75;
  }
  return out;
}

interface Stalk {
  readonly d: string;
  readonly ear: string;
  readonly group: number;
  readonly shade: number;
}

/** Wheat on one side of the road: stalks get taller and sparser toward the viewer. */
function wheat(side: -1 | 1, seed: number): Stalk[] {
  const next = stream(seed);
  const out: Stalk[] = [];
  for (let i = 0; i < 260; i++) {
    const t = Math.pow(next(), 0.7);
    const y = HORIZON + 10 + t * (H - HORIZON + 40);
    const edge = roadX(y) + side * (roadHalf(y) + 6 + t * 24);
    const span = side < 0 ? edge : W - edge;
    if (span <= 0) continue;
    const x = side < 0 ? next() * edge : edge + next() * span;
    const h = 10 + t * 110 * (0.7 + next() * 0.5);
    const lean = (next() - 0.5) * h * 0.25;
    const top = { x: x + lean, y: y - h };
    out.push({
      d: `M${r1(x)} ${r1(y)} Q${r1(x + lean * 0.2)} ${r1(y - h * 0.6)} ${r1(top.x)} ${r1(top.y)}`,
      ear: `<ellipse cx="${r1(top.x)}" cy="${r1(top.y + h * 0.06)}" rx="${r1(1 + t * 3.4)}" ry="${r1(3 + t * 9)}" transform="rotate(${r1((lean / h) * 40)} ${r1(top.x)} ${r1(top.y)})"/>`,
      group: Math.floor(next() * 4),
      shade: next(),
    });
  }
  return out.sort((a, b) => Number(a.d.split(" ")[1]) - Number(b.d.split(" ")[1]));
}

function mountains(seed: number, base: number, peak: number, count: number): string {
  const next = stream(seed);
  let d = `M0 ${base}`;
  const step = W / count;
  for (let i = 0; i <= count; i++) {
    const x = i * step;
    // Lower in the middle so the sun and the town stay clear.
    const middle = 1 - Math.exp(-Math.pow((x - W / 2) / (W * 0.22), 2));
    const y = base - (peak * (0.45 + next() * 0.55)) * (0.25 + 0.75 * middle);
    d += ` L${r1(x - step / 2)} ${r1(y + (next() * peak) / 3)} L${r1(x)} ${r1(y)}`;
  }
  return `${d} L${W} ${base} Z`;
}

/** The walled town on the rise: curtain wall, towers, a keep, pennants. */
function Town() {
  const towers = [
    { x: 610, w: 34, h: 70, cone: true },
    { x: 680, w: 26, h: 50, cone: false },
    { x: 740, w: 40, h: 120, cone: true },
    { x: 800, w: 56, h: 150, cone: false },
    { x: 866, w: 38, h: 104, cone: true },
    { x: 930, w: 28, h: 56, cone: false },
    { x: 990, w: 34, h: 78, cone: true },
  ];
  const wallTop = 560;
  const ground = 600;
  return (
    <g opacity="0.9">
      <path d={`M560 ${ground + 8} Q800 ${ground - 30} 1040 ${ground + 8} L1040 ${ground + 30} L560 ${ground + 30} Z`} fill="#a98a44" />
      <rect x="590" y={wallTop} width="420" height={ground - wallTop} fill="#9c7f4a" />
      <path d={Array.from({ length: 21 }, (_, i) => `M${590 + i * 20} ${wallTop} h12 v-8 h-12 Z`).join(" ")} fill="#9c7f4a" />
      <rect x="590" y={wallTop + 8} width="420" height="5" fill="#7d6538" opacity="0.6" />
      {towers.map((t) => {
        const top = ground - t.h;
        return (
          <g key={t.x}>
            <rect x={t.x - t.w / 2} y={top} width={t.w} height={t.h} fill="#a88a52" />
            <rect x={t.x - t.w / 2} y={top} width={t.w * 0.35} height={t.h} fill="#8c7142" opacity="0.55" />
            {t.cone ? (
              <path d={`M${t.x - t.w / 2 - 4} ${top} L${t.x} ${top - t.w * 1.1} L${t.x + t.w / 2 + 4} ${top} Z`} fill="#7a4f34" />
            ) : (
              <path d={Array.from({ length: Math.floor(t.w / 10) }, (_, i) => `M${t.x - t.w / 2 + i * 10} ${top} h6 v-7 h-6 Z`).join(" ")} fill="#a88a52" />
            )}
            <rect x={t.x - 3} y={top + t.h * 0.3} width="6" height="10" rx="3" fill="#4d3a22" opacity="0.8" />
            {t.h > 90 && <rect x={t.x - 3} y={top + t.h * 0.55} width="6" height="10" rx="3" fill="#4d3a22" opacity="0.8" />}
            {t.cone && (
              <g>
                <path d={`M${t.x} ${top - t.w * 1.1} v-22`} stroke="#5a4030" strokeWidth="2" />
                <path className="lb-flag" d={`M${t.x} ${top - t.w * 1.1 - 22} l22 5 l-22 6 Z`} fill={t.x === 740 ? "#b83a2c" : "#2a4d8f"} />
              </g>
            )}
          </g>
        );
      })}
      <path d="M786 600 v-26 a14 14 0 0 1 28 0 v26 Z" fill="#4d3a22" opacity="0.85" />
    </g>
  );
}

function Scene() {
  const left = wheat(-1, 11);
  const right = wheat(1, 23);
  const stones = cobbles();
  const shades = ["#e9c25a", "#d9a640", "#c58d2c", "#f3d478"];
  const ears = (side: Stalk[], group: number) => side.filter((s) => s.group === group);
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" data-testid="lobby-scene">
      <defs>
        <linearGradient id="lb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9481b" />
          <stop offset="0.3" stopColor="#e27a26" />
          <stop offset="0.55" stopColor="#f3b443" />
          <stop offset="0.68" stopColor="#fbdc87" />
        </linearGradient>
        <radialGradient id="lb-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset="0.55" stopColor="#fff0a0" />
          <stop offset="0.8" stopColor="#ffe27a" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffd25a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lb-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff3b0" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffcf5a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lb-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8964a" />
          <stop offset="1" stopColor="#efc070" />
        </linearGradient>
        <linearGradient id="lb-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b98236" />
          <stop offset="1" stopColor="#d6a84e" />
        </linearGradient>
        <linearGradient id="lb-meadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c5a548" />
          <stop offset="0.45" stopColor="#9c8a34" />
          <stop offset="1" stopColor="#5f5a22" />
        </linearGradient>
        <linearGradient id="lb-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6b36e" />
          <stop offset="1" stopColor="#9c7a46" />
        </linearGradient>
        <linearGradient id="lb-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe6a0" stopOpacity="0" />
          <stop offset="1" stopColor="#ffe6a0" stopOpacity="0.55" />
        </linearGradient>
        <filter id="lb-soft" x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <radialGradient id="lb-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#2a1406" stopOpacity="0.55" />
        </radialGradient>
      </defs>

      <rect width={W} height={H} fill="url(#lb-sky)" />
      <circle className="lb-sun" cx="800" cy="430" r="520" fill="url(#lb-glow)" />
      <circle cx="800" cy="440" r="230" fill="url(#lb-sun)" />

      <g className="lb-cloud" fill="#c4602a" opacity="0.5" filter="url(#lb-soft)">
        <ellipse cx="300" cy="150" rx="260" ry="34" />
        <ellipse cx="420" cy="128" rx="160" ry="30" />
        <ellipse cx="1240" cy="110" rx="300" ry="30" />
      </g>
      <g className="lb-cloud-slow" fill="#9e3f1a" opacity="0.4" filter="url(#lb-soft)">
        <ellipse cx="560" cy="250" rx="220" ry="22" />
        <ellipse cx="1150" cy="300" rx="180" ry="18" />
        <ellipse cx="160" cy="320" rx="160" ry="16" />
      </g>
      <g fill="none" stroke="#5a2c12" strokeWidth="2.5" strokeLinecap="round" opacity="0.55">
        <path className="lb-bird" d="M60 230 q8 -8 16 0 q8 -8 16 0" />
        <path className="lb-bird" style={{ animationDelay: "-12s" }} d="M20 270 q6 -6 12 0 q6 -6 12 0" />
      </g>

      <path d={mountains(3, HORIZON - 40, 260, 9)} fill="url(#lb-far)" opacity="0.85" />
      <rect y={HORIZON - 260} width={W} height="240" fill="url(#lb-haze)" />
      <path d={mountains(5, HORIZON + 10, 170, 13)} fill="url(#lb-near)" />
      <path d={`M0 ${HORIZON - 10} Q220 ${HORIZON - 70} 470 ${HORIZON - 20} T900 ${HORIZON - 30} T1600 ${HORIZON - 40} L1600 ${HORIZON + 40} L0 ${HORIZON + 40} Z`} fill="#b39343" opacity="0.9" />

      <Town />

      <g fill="#6f6a2a" opacity="0.85">
        {[60, 140, 220, 300, 380, 1240, 1320, 1400, 1480, 1560].map((x, i) => (
          <ellipse key={x} cx={x} cy={HORIZON + 6 - (i % 3) * 6} rx={46 + (i % 4) * 8} ry={30 + (i % 3) * 7} />
        ))}
      </g>

      <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#lb-meadow)" />
      <path d={roadPath()} fill="url(#lb-road)" />
      <g fill="#ecd399" stroke="#8a6a3a" strokeWidth="1.2" opacity="0.9" dangerouslySetInnerHTML={{ __html: stones.join("") }} />

      {[left, right].map((side, s) => (
        <g key={s}>
          {[0, 1, 2, 3].map((group) => (
            <g key={group} className="lb-sway" style={{ animationDelay: `${-group * 1.1 - s * 0.6}s` }}>
              <g fill="none" strokeLinecap="round">
                {ears(side, group).map((st, i) => (
                  <path key={i} d={st.d} stroke={shades[Math.floor(st.shade * 4)] ?? shades[0]} strokeWidth={1.6 + st.shade} opacity={0.9} />
                ))}
              </g>
              <g dangerouslySetInnerHTML={{ __html: ears(side, group).map((st) => st.ear.replace("<ellipse", `<ellipse fill="${shades[Math.floor(st.shade * 4)] ?? shades[0]}"`)).join("") }} />
            </g>
          ))}
        </g>
      ))}

      <rect width={W} height={H} fill="url(#lb-vignette)" />
    </svg>
  );
}

export const LobbyScene = memo(Scene);
