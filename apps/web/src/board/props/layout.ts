/**
 * Where the on-table props sit (docs/phase12.md §7), derived from the
 * board's bounds so any frame works: the bank decks along the right edge,
 * the barbarian fleet's track on a chain of sea hexes off the board's
 * top-left corner, one piece pile per seat around the table (the viewer's
 * nearest the camera) and, under Crown & Castle, each seat's improvement
 * card beside its pile. Pure, so the layout is unit tested and the flying
 * cards can find the bank and the deck through the board's projector.
 */

import { parseHexId, type HexId } from "@katan/engine";
import { hexWorld, type Bounds } from "@/board3d/layout3d";

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
  /** Where the fleet waits at step 0 (the open sea end of the chain). */
  readonly start: World;
  /** The landing, on the hex against the board. */
  readonly end: World;
  /** The marker positions for steps 1..n, the landing last. */
  readonly dots: readonly World[];
  /** The sea hexes the track runs over, from the open sea to the board. */
  readonly tiles: readonly World[];
}

/** The track runs over this many sea hexes. */
export const TRACK_TILES = 4;

/**
 * The barbarian fleet's track: a chain of sea hexes attached to the board's
 * top-left corner, the way the fleet's sea tiles hook onto a real board, the
 * fleet sailing in from the open sea at the far end to the landing on the
 * hex against the board. The chain starts at the neighbour to the left of
 * the board's top-left-most hex (the one with the smallest x + z, which no
 * board hex can be beyond) and steps left and up-left alternately, so every
 * hex of it lies outside any board; the markers are spaced evenly along the
 * chain's centre line with the landing on the near hex.
 *
 * It used to be a straight lane along the bottom edge beside the dice tray;
 * the top-left corner is where the table expects it, and the camera now
 * looks squarely at the board so the corner is in view.
 */
export function barbarianTrackLayout(hexes: readonly HexId[], steps = 7): TrackLayout {
  let corner = hexes[0] ?? ("0,0" as HexId);
  let best = Infinity;
  for (const h of hexes) {
    const w = hexWorld(h);
    const k = w.x + w.z;
    if (k < best - 1e-9 || (Math.abs(k - best) < 1e-9 && w.z < hexWorld(corner).z)) {
      best = k;
      corner = h;
    }
  }
  let { q, r } = parseHexId(corner);
  const near: World[] = [];
  for (let i = 0; i < TRACK_TILES; i++) {
    if (i % 2 === 0) q -= 1;
    else r -= 1;
    near.push(hexWorld(`${q},${r}` as HexId));
  }
  // From the open sea to the board.
  const tiles = [...near].reverse();
  const first = tiles[0]!;
  const last = tiles[tiles.length - 1]!;
  // Evenly along the polyline of tile centres: the start at the far end, the landing on the near hex.
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < tiles.length; i++) {
    const l = Math.hypot(tiles[i]!.x - tiles[i - 1]!.x, tiles[i]!.z - tiles[i - 1]!.z);
    lengths.push(l);
    total += l;
  }
  const at = (d: number): World => {
    let left = d;
    for (let i = 0; i < lengths.length; i++) {
      const l = lengths[i]!;
      if (left <= l || i === lengths.length - 1) {
        const k = Math.min(1, left / l);
        return { x: tiles[i]!.x + (tiles[i + 1]!.x - tiles[i]!.x) * k, z: tiles[i]!.z + (tiles[i + 1]!.z - tiles[i]!.z) * k };
      }
      left -= l;
    }
    return last;
  };
  const dots = Array.from({ length: steps }, (_, i) => at((total * (i + 1)) / steps));
  return { start: first, end: dots[steps - 1]!, dots, tiles };
}

export interface PileLayout {
  readonly origin: World;
  /** Unit vector along which items are laid out. */
  readonly along: World;
  /** Unit vector for the next row. */
  readonly across: World;
}

/**
 * One pile origin per seat, spread around the table's edges: bottom right
 * (the viewer's own, nearest the camera), the top-right corner, top (left of
 * centre), left, then the far left and the far right. The bank runs down the
 * right edge and the fleet's track hangs off the top-left corner, so no pile
 * crosses either. Seats are counted from the viewer (`seatFrom`), so every
 * player sees their own pieces in front of them.
 */
export function pileLayout(bounds: Bounds, seat: number): PileLayout {
  const m = 1.4;
  const spots: PileLayout[] = [
    { origin: { x: bounds.maxX - 1.4, z: bounds.maxZ + m }, along: { x: 1, z: 0 }, across: { x: 0, z: 1 } },
    { origin: { x: bounds.maxX + 0.3, z: bounds.minZ - m }, along: { x: -1, z: 0 }, across: { x: 0, z: -1 } },
    { origin: { x: bounds.cx - 0.2, z: bounds.minZ - m }, along: { x: -1, z: 0 }, across: { x: 0, z: -1 } },
    { origin: { x: bounds.minX - m, z: bounds.cz + 1.2 }, along: { x: 0, z: -1 }, across: { x: -1, z: 0 } },
    { origin: { x: bounds.minX - m - 2.1, z: bounds.cz + 1.2 }, along: { x: 0, z: -1 }, across: { x: -1, z: 0 } },
    { origin: { x: bounds.maxX + 3.4, z: bounds.cz + 1.6 }, along: { x: 0, z: -1 }, across: { x: 1, z: 0 } },
  ];
  return spots[seat % spots.length]!;
}

/** The seat index counted from the viewer, so the viewer's own props take seat 0 (the near edge). */
export function seatFrom(order: readonly string[], viewer: string, playerId: string): number {
  const n = order.length;
  const me = Math.max(0, order.indexOf(viewer));
  const i = order.indexOf(playerId);
  return n === 0 || i < 0 ? 0 : (i - me + n) % n;
}

/** The improvement card's size on the table (docs/phase12.md §4), flat, width across and length along the camera's view. */
export const CARD_WIDTH = 0.82;
export const CARD_LENGTH = 1.04;

/**
 * Crown & Castle: a seat's city improvement card lies just before the start
 * of its pile (against the `along` direction) and beside it (along
 * `across`), so it sits in front of the seat's pieces where the seat can
 * read its tiers and click it. Every card faces the camera.
 */
export function cardLayout(bounds: Bounds, seat: number): World {
  const pile = pileLayout(bounds, seat);
  const back = 1.0;
  const beside = 0.75;
  return { x: pile.origin.x - pile.along.x * back + pile.across.x * beside, z: pile.origin.z - pile.along.z * back + pile.across.z * beside };
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
