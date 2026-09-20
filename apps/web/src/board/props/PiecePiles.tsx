"use client";

/**
 * Each player's unplaced pieces (docs/phase12.md §7) as the same figurines
 * that stand on the board, at 0.7 of their board size, in clusters by the
 * seat's table edge, the viewer's own at the near edge in front of them:
 * roads side by side like stacked planks, then a row of settlements, a row
 * of cities, and ships (Tides) or level-1 knights (Crown & Castle). The piles shrink as pieces reach the board, so a glance at the
 * table says what everyone has left. One GLB load per kind and colour; each
 * pile item is a clone sharing that geometry and those materials. Until a
 * model loads, or if it cannot, a plain block in the player's tint stands in.
 */

import { useMemo } from "react";
import { KNIGHTS_PER_LEVEL, type PlayerColor } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { Bounds } from "@/board3d/layout3d";
import { PIECE_COLORS, dimColor, usePiece, type PieceName, type PieceOptions } from "@/board3d/loadPiece";
import { cityPieceOptions } from "@/board3d/Pieces";
import * as P from "@/board3d/palette";
import { PLAYER_FILL } from "@/game/theme";
import { pileLayout, pileSlot, seatFrom, type PileLayout } from "./layout";

/** Pile figurines are drawn at this share of their on-board size. */
export const PILE_SCALE = 0.7;
/** Across-the-pile offset of each row: roads (long across), settlements, cities, ships or knights. */
export const PILE_ROWS = [0, 0.62, 0.96, 1.32] as const;
/** The most pieces drawn in one row before the rest are folded (a road pile holds 15). */
const PER_ROW = 16;

function Row({ layout, row, count, name, options, gap, fallback, turn = 0, shadows }: { layout: PileLayout; row: number; count: number; name: PieceName; options: PieceOptions; gap: number; fallback: [number, number, number]; /** Extra turn about Y: a quarter turn lays a road's length across the row. */ turn?: number; shadows: boolean }) {
  const n = Math.max(0, Math.min(count, PER_ROW));
  const model = usePiece(name, options);
  // Clones share the loaded geometry and materials; a new set only when the model or the count changes.
  const clones = useMemo(() => (model ? Array.from({ length: n }, () => model.clone()) : []), [model, n]);
  const heading = Math.atan2(layout.along.x, layout.along.z) + turn;
  const across = PILE_ROWS[row] ?? 0;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const p = pileSlot(layout, i, PER_ROW, gap, 0);
        const clone = clones[i];
        return (
          <group key={i} position={[p.x + layout.across.x * across, 0, p.z + layout.across.z * across]} rotation={[0, heading, 0]} scale={PILE_SCALE}>
            {clone ? (
              <primitive object={clone} />
            ) : (
              <mesh position={[0, fallback[1] / 2, 0]} castShadow={shadows}>
                <boxGeometry args={fallback} />
                <meshStandardMaterial color={options.color} flatShading />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

export function PiecePiles({ view, bounds, shadows }: { view: RedactedState; bounds: Bounds; shadows: boolean }) {
  const crown = view.scenario?.crown === true ? view.crown : null;
  const order = view.players.map((p) => p.id);
  return (
    <group name="piles">
      {view.players.map((p) => {
        const layout = pileLayout(bounds, seatFrom(order, view.viewer, p.id));
        const color = p.color as PlayerColor;
        const fill = PLAYER_FILL[color];
        const onBoard = crown ? crown.knights.filter((k) => k.owner === p.id).length : 0;
        const knightsLeft = crown ? KNIGHTS_PER_LEVEL * 3 - onBoard : 0;
        const shadow = { castShadow: shadows, receiveShadow: shadows };
        return (
          <group key={p.id} name={`pile:${p.id}`}>
            <Row layout={layout} row={0} count={p.pieces.roads} name="road" options={{ color: fill, ...shadow }} gap={0.14} fallback={[0.12, 0.06, 0.56]} turn={Math.PI / 2} shadows={shadows} />
            <Row layout={layout} row={1} count={p.pieces.settlements} name="settlement" options={{ color: fill, neutral: P.WALL_PLASTER, ...shadow }} gap={0.3} fallback={[0.22, 0.18, 0.22]} shadows={shadows} />
            <Row layout={layout} row={2} count={p.pieces.cities} name="city" options={cityPieceOptions(color, false, shadows, shadows)} gap={0.4} fallback={[0.26, 0.34, 0.26]} shadows={shadows} />
            {view.scenario?.tides && <Row layout={layout} row={3} count={p.pieces.ships} name="ship" options={{ color: fill, neutral: PIECE_COLORS.wood, ...shadow }} gap={0.28} fallback={[0.16, 0.18, 0.5]} turn={Math.PI / 2} shadows={shadows} />}
            {crown && <Row layout={layout} row={3} count={knightsLeft} name="knight_1" options={{ color: dimColor(fill), neutral: dimColor(PIECE_COLORS.grey), roughness: 1, ...shadow }} gap={0.22} fallback={[0.14, 0.2, 0.14]} shadows={shadows} />}
          </group>
        );
      })}
    </group>
  );
}
