/**
 * Where the on-table props sit (docs/phase12.md §7), derived from the
 * board's bounds so any frame works: the bank decks along the right edge,
 * the barbarian fleet's lane along the bottom-left edge, one piece pile per
 * seat around the table and, under Crown & Castle, each seat's improvement
 * books beside its pile. Pure, so the layout is unit tested and the flying
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
  /** Where the fleet waits at step 0 (the open sea end of the lane). */
  readonly start: World;
  /** The landing, at the coast end of the lane. */
  readonly end: World;
  /** The marker positions for steps 1..n, the landing last. */
  readonly dots: readonly World[];
  /** Spacing between markers. */
  readonly step: number;
  /** The lane slab's width across (z). */
  readonly width: number;
}

/** The lane never squeezes its markers closer than this, whatever the board's width. */
export const TRACK_MIN_STEP = 0.42;
/** Room the dice tray needs left of the board centre (`DiceTray3D`: centre cx − 1.1, width 1.6). */
const TRAY_CLEARANCE = 2.3;

/**
 * The barbarian fleet's lane: a straight strip along the board's bottom-left
 * edge, just past the coast and left of the dice tray, the fleet sailing
 * from the open sea at the left end toward the landing at the right. It used
 * to be a ring of markers off the top-left corner, which the top band and the
 * left rail covered on most viewports; here it sits in the near foreground
 * beside the board, and its status pills have room above it.
 */
export function barbarianTrackLayout(bounds: Bounds, steps = 7): TrackLayout {
  const z = bounds.maxZ + 1.35;
  const endX = bounds.cx - TRAY_CLEARANCE;
  const naturalStep = (endX - (bounds.minX - 0.6)) / steps;
  const step = Math.max(TRACK_MIN_STEP, Math.min(0.62, naturalStep));
  const start = { x: endX - step * steps, z };
  const dots = Array.from({ length: steps }, (_, i) => ({ x: start.x + step * (i + 1), z }));
  return { start, end: dots[steps - 1]!, dots, step, width: 0.7 };
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
 * the top-right corner, top (left of centre), left, then the far left and the
 * far right. The bank runs down the right edge and the fleet's lane runs
 * along the bottom-left edge, so no pile crosses either.
 */
export function pileLayout(bounds: Bounds, seat: number): PileLayout {
  const m = 1.4;
  const spots: PileLayout[] = [
    { origin: { x: bounds.maxX - 1.4, z: bounds.maxZ + m }, along: { x: 1, z: 0 }, across: { x: 0, z: 1 } },
    { origin: { x: bounds.maxX + 0.3, z: bounds.minZ - m }, along: { x: -1, z: 0 }, across: { x: 0, z: -1 } },
    { origin: { x: bounds.cx - 0.2, z: bounds.minZ - m }, along: { x: -1, z: 0 }, across: { x: 0, z: -1 } },
    { origin: { x: bounds.minX - m, z: bounds.cz + 0.7 }, along: { x: 0, z: -1 }, across: { x: -1, z: 0 } },
    { origin: { x: bounds.minX - m - 2.1, z: bounds.cz + 0.7 }, along: { x: 0, z: -1 }, across: { x: -1, z: 0 } },
    { origin: { x: bounds.maxX + 3.4, z: bounds.cz + 1.6 }, along: { x: 0, z: -1 }, across: { x: 1, z: 0 } },
  ];
  return spots[seat % spots.length]!;
}

/** Spacing between a seat's three improvement books, across the pile. */
export const BOOK_GAP = 0.38;

/**
 * Crown & Castle: a seat's three improvement books lie just before the start
 * of its pile (against the `along` direction), one per track, stepping
 * across the pile the way its rows do.
 */
export function booksLayout(bounds: Bounds, seat: number): PileLayout {
  const pile = pileLayout(bounds, seat);
  const back = 0.85;
  return { origin: { x: pile.origin.x - pile.along.x * back, z: pile.origin.z - pile.along.z * back }, along: pile.along, across: pile.across };
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
