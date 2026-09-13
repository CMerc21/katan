"use client";

/**
 * A small static rendering of a board (docs/phase7-5.md §2): the 2D SVG
 * board without an interaction layer, for lobby and editor thumbnails.
 */

import type { Board } from "@katan/engine";
import { createLayout, hexPoints, waterPoints } from "@/board/layout";
import { SAND, WATER, WATER_DEEP } from "@/game/theme";
import { HarborMarker, NumberToken, TerrainDefs } from "./parts";

const R = 50;

export function BoardThumbnail({ board, size = 240, showTokens = true }: { board: Board; size?: number; showTokens?: boolean }) {
  const hexes = Object.keys(board.hexes);
  const layout = createLayout(R, [...hexes, ...board.sea, ...board.frame]);
  return (
    <svg viewBox={layout.viewBox} width={size} height={size} role="img" aria-label="Board thumbnail" className="rounded-md">
      <TerrainDefs />
      <polygon points={waterPoints(layout)} fill={WATER} stroke={WATER_DEEP} strokeWidth={6} strokeLinejoin="round" />
      {board.frame.map((hex) => (
        <polygon key={hex} points={hexPoints(layout, hex, 1.5)} fill="#5a4030" stroke="#3b2a1e" strokeWidth={3} strokeLinejoin="round" />
      ))}
      {board.sea.map((hex) => (
        <polygon key={hex} points={hexPoints(layout, hex, 1.5)} fill={WATER_DEEP} stroke={WATER} strokeWidth={3} strokeLinejoin="round" />
      ))}
      {board.ports.map((port) => {
        const m = layout.edgeMid(port.edge);
        const o = layout.outward(port.edge);
        return <HarborMarker key={port.edge} x={m.x + o.x * R * 0.78} y={m.y + o.y * R * 0.78} ends={layout.edge(port.edge)} kind={port.kind} R={R} owned={false} />;
      })}
      {hexes.map((hex) => (
        <polygon key={hex} points={hexPoints(layout, hex, 1.5)} fill={`url(#pat-${board.hexes[hex]!.terrain})`} stroke={SAND} strokeWidth={3} strokeLinejoin="round" />
      ))}
      {/* Wayfarers (docs/phase10.md): river segments, oasis marks and fishing ground tokens. */}
      {board.rivers.map((edge) => {
        const [a, b] = layout.edge(edge);
        return <line key={edge} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={WATER} strokeWidth={R * 0.16} strokeLinecap="round" data-river={edge} />;
      })}
      {board.oases.map((hex) => {
        const c = layout.hex(hex);
        return (
          <g key={hex} data-oasis={hex} transform={`translate(${c.x - R * 0.42} ${c.y - R * 0.4})`}>
            <circle r={R * 0.16} fill={WATER} stroke={SAND} strokeWidth={2} />
            <path d={`M0 0 v${-R * 0.38}`} stroke="#8a6a44" strokeWidth={3} strokeLinecap="round" />
            {[-40, -10, 20, 50].map((deg) => (
              <path key={deg} d={`M0 ${-R * 0.38} l${Math.cos(((deg - 90) * Math.PI) / 180) * R * 0.22} ${Math.sin(((deg - 90) * Math.PI) / 180) * R * 0.22}`} stroke="#3e6b46" strokeWidth={3} strokeLinecap="round" />
            ))}
          </g>
        );
      })}
      {showTokens &&
        board.fishingGrounds.map((g) => {
          const m = layout.edgeMid(g.edge);
          const o = layout.outward(g.edge);
          return (
            <g key={g.edge} data-fishing={g.edge}>
              <circle cx={m.x + o.x * R * 0.55} cy={m.y + o.y * R * 0.55} r={R * 0.3} fill={WATER_DEEP} />
              <NumberToken x={m.x + o.x * R * 0.55} y={m.y + o.y * R * 0.55} n={g.token} R={R * 0.8} />
            </g>
          );
        })}
      {showTokens &&
        hexes.map((hex) => {
          const t = board.hexes[hex]!;
          const c = layout.hex(hex);
          return t.token === null ? null : <NumberToken key={hex} x={c.x} y={c.y} n={t.token} R={R} />;
        })}
    </svg>
  );
}
