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
  const layout = createLayout(R);
  const hexes = Object.keys(board.hexes);
  return (
    <svg viewBox={layout.viewBox} width={size} height={size} role="img" aria-label="Board thumbnail" className="rounded-md">
      <TerrainDefs />
      <polygon points={waterPoints(layout)} fill={WATER} stroke={WATER_DEEP} strokeWidth={6} strokeLinejoin="round" />
      {board.ports.map((port) => {
        const m = layout.edgeMid(port.edge);
        const o = layout.outward(port.edge);
        return <HarborMarker key={port.edge} x={m.x + o.x * R * 0.78} y={m.y + o.y * R * 0.78} ends={layout.edge(port.edge)} kind={port.kind} R={R} owned={false} />;
      })}
      {hexes.map((hex) => (
        <polygon key={hex} points={hexPoints(layout, hex, 1.5)} fill={`url(#pat-${board.hexes[hex]!.terrain})`} stroke={SAND} strokeWidth={3} strokeLinejoin="round" />
      ))}
      {showTokens &&
        hexes.map((hex) => {
          const t = board.hexes[hex]!;
          const c = layout.hex(hex);
          return t.token === null ? null : <NumberToken key={hex} x={c.x} y={c.y} n={t.token} R={R} />;
        })}
    </svg>
  );
}
