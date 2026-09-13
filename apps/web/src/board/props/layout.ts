/**
 * Where the on-table props sit (docs/phase12.md §7), derived from the
 * board's bounds so any frame works: the bank decks along the right edge,
 * the barbarian track beside the top-left sea edge, and one piece pile per
 * seat around the table. Pure, so the layout is unit tested and the flying
 * cards can find the bank and the deck through the board's projector.
 */

import type { Bounds } from "@/board3d/layout3d";

export interface World {
  readonly x: number;
  readonly z: number;
}

export interface BankLayout {
  /** The first resource stack; stacks step along +z. */
  readonly origin: World;
  readonly step: number;
  /** The development / progress deck. */
  readonly deck: World;
  /** The centre of the whole arrangement (the "bank" anchor for card flights). */
  readonly centre: World;
}

export function bankLayout(bounds: Bounds, stacks: number): BankLayout {
  const x = bounds.maxX + 1.7;
  const step = 0.62;
  const z0 = bounds.cz - ((stacks - 1) * step) / 2 - 0.6;
  return {
    origin: { x, z: z0 },
    step,
    deck: { x, z: z0 + stacks * step + 0.25 },
    centre: { x, z: z0 + ((stacks - 1) * step) / 2 },
  };
}

export interface TrackLayout {
  readonly centre: World;
  readonly radius: number;
  /** The seven dot positions, the landing spot last. */
  readonly dots: readonly World[];
}

/** A circle of seven markers off the board's top-left corner, the fleet sailing clockwise into the landing. */
export function barbarianTrackLayout(bounds: Bounds, steps = 7): TrackLayout {
  const centre = { x: bounds.minX - 1.4, z: bounds.minZ - 0.6 };
  const radius = 0.85;
  const dots = Array.from({ length: steps }, (_, i) => {
    const a = -Math.PI / 2 + ((i + 1) / steps) * Math.PI * 2;
    return { x: centre.x + Math.cos(a) * radius, z: centre.z + Math.sin(a) * radius };
  });
  return { centre, radius, dots };
}

export interface PileLayout {
  readonly origin: World;
  /** Unit vector along which items are laid out. */
  readonly along: World;
  /** Unit vector for the next row. */
  readonly across: World;
}

/**
 * One pile origin per seat, spread around the table's edges: bottom right,
 * the top-right corner, top (left of centre), left, then bottom left and the
 * far right. The bank runs down the right edge and the barbarian track sits
 * off the top-left corner, so no pile crosses either.
 */
export function pileLayout(bounds: Bounds, seat: number): PileLayout {
  const m = 1.4;
  const spots: PileLayout[] = [
    { origin: { x: bounds.maxX - 1.4, z: bounds.maxZ + m }, along: { x: 1, z: 0 }, across: { x: 0, z: 1 } },
    { origin: { x: bounds.maxX + 0.3, z: bounds.minZ - m }, along: { x: -1, z: 0 }, across: { x: 0, z: -1 } },
    { origin: { x: bounds.cx - 0.2, z: bounds.minZ - m }, along: { x: -1, z: 0 }, across: { x: 0, z: -1 } },
    { origin: { x: bounds.minX - m, z: bounds.cz + 0.7 }, along: { x: 0, z: -1 }, across: { x: -1, z: 0 } },
    { origin: { x: bounds.minX + 0.3, z: bounds.maxZ + m + 0.2 }, along: { x: 1, z: 0 }, across: { x: 0, z: 1 } },
    { origin: { x: bounds.maxX + 3.4, z: bounds.cz + 1.6 }, along: { x: 0, z: -1 }, across: { x: 1, z: 0 } },
  ];
  return spots[seat % spots.length]!;
}

/** The nth item of a pile, `perRow` per row with `gap` between items. */
export function pileSlot(layout: PileLayout, index: number, perRow: number, gap: number, rowGap: number): World {
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  return {
    x: layout.origin.x + layout.along.x * col * gap + layout.across.x * row * rowGap,
    z: layout.origin.z + layout.along.z * col * gap + layout.across.z * row * rowGap,
  };
}
