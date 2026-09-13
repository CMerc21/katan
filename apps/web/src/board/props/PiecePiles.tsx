"use client";

/**
 * Each player's unplaced pieces (docs/phase12.md §7) as small clusters by
 * their seat edge: roads as planks, settlements as cubes, cities as taller
 * blocks, knights (Crown & Castle) as shield discs, ships (Tides) as slivers,
 * all in the player's tint. The piles shrink as pieces reach the board.
 */

import { KNIGHTS_PER_LEVEL, type PlayerColor } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { Bounds } from "@/board3d/layout3d";
import { PLAYER_FILL } from "@/game/theme";
import { pileLayout, pileSlot, type PileLayout } from "./layout";

function Items({ layout, row, count, color, size, gap, shadows }: { layout: PileLayout; row: number; count: number; color: string; size: [number, number, number]; gap: number; shadows: boolean }) {
  const perRow = 8;
  return (
    <>
      {Array.from({ length: Math.max(0, Math.min(count, 16)) }, (_, i) => {
        const p = pileSlot(layout, i, perRow, gap, 0.16);
        return (
          <mesh key={i} position={[p.x + layout.across.x * row * 0.42, size[1] / 2, p.z + layout.across.z * row * 0.42]} rotation={[0, Math.atan2(layout.along.x, layout.along.z), 0]} castShadow={shadows}>
            <boxGeometry args={size} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        );
      })}
    </>
  );
}

export function PiecePiles({ view, bounds, shadows }: { view: RedactedState; bounds: Bounds; shadows: boolean }) {
  const crown = view.scenario?.crown === true ? view.crown : null;
  return (
    <group name="piles">
      {view.players.map((p, seat) => {
        const layout = pileLayout(bounds, seat);
        const color = PLAYER_FILL[p.color as PlayerColor];
        const onBoard = crown ? crown.knights.filter((k) => k.owner === p.id).length : 0;
        const knightsLeft = crown ? KNIGHTS_PER_LEVEL * 3 - onBoard : 0;
        return (
          <group key={p.id} name={`pile:${p.id}`}>
            <Items layout={layout} row={0} count={p.pieces.roads} color={color} size={[0.05, 0.04, 0.26]} gap={0.11} shadows={shadows} />
            <Items layout={layout} row={1} count={p.pieces.settlements} color={color} size={[0.12, 0.1, 0.12]} gap={0.17} shadows={shadows} />
            <Items layout={layout} row={2} count={p.pieces.cities} color={color} size={[0.13, 0.18, 0.13]} gap={0.19} shadows={shadows} />
            {view.scenario?.tides && <Items layout={layout} row={3} count={p.pieces.ships} color={color} size={[0.08, 0.05, 0.24]} gap={0.14} shadows={shadows} />}
            {crown && <Items layout={layout} row={3} count={knightsLeft} color={color} size={[0.11, 0.03, 0.11]} gap={0.15} shadows={shadows} />}
          </group>
        );
      })}
    </group>
  );
}
