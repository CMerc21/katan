import { describe, expect, it } from "vitest";
import { builtInScenario, createGame, legalActions, redact, type Action, type HexId } from "@katan/engine";
import { boardBounds, hexWorld } from "@/board3d/layout3d";
import type { RedactedState } from "@/driver/types";
import { TRACK_TILES, bankLayout, barbarianTrackLayout, cardLayout, pileLayout, pileSlot, seatFrom } from "@/board/props/layout";
import { HUD_COPY } from "@/hud/hudCopy";
import { bannerStats, costRows, handSize, onlyEndTurnLeft, pushRoll, rollHistogram, waitingText } from "@/hud/model";

const PLAYERS = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];

describe("docs/phase12.md §1 banner statistics", () => {
  it("base game: five columns ending with the hand, army and longest road pills, hand size for others is the hidden count", () => {
    const state = createGame({ seed: "hud-1", players: PLAYERS, board: "beginner" });
    const view = redact(state, "a");
    const mine = bannerStats(view, view.players[0]!);
    expect(mine.columns.map((c) => c.key)).toEqual(["roads", "army", "knights", "dev", "hand"]);
    expect(mine.pills[0].icon).toBe("army");
    expect(mine.vp).toBe(0);
    const other = view.players[1]!;
    expect(handSize(other)).toBe(0);
    expect(bannerStats(view, other).columns.every((c) => c.value === 0)).toBe(true);
  });

  it("Crown & Castle: five columns with defence, knights, progress and the hand (the tracks ride the ribbon)", () => {
    const state = createGame({ seed: "hud-2", players: PLAYERS, scenario: builtInScenario("crownStandard") });
    const view = redact(state, "a");
    const stats = bannerStats(view, view.players[0]!);
    expect(stats.columns.map((c) => c.key)).toEqual(["roads", "defense", "knights", "progress", "hand"]);
    expect(stats.pills.map((p) => p.icon)).toEqual(["knight", "shield"]);
    expect(stats.columns.every((c) => c.title === false)).toBe(true);
  });
});

describe("docs/phase12.md §4 build cost card rows", () => {
  it("base game rows in order, all off before the roll with a reason, no Crown rows", () => {
    const state = createGame({ seed: "hud-3", players: PLAYERS, board: "beginner" });
    const view = redact(state, "a");
    const rows = costRows(view, "a", { wood: 1, clay: 1, wool: 1, grain: 1, ore: 0 }, []);
    expect(rows.map((r) => r.key)).toEqual(["road", "settlement", "city", "devCard"]);
    expect(rows.every((r) => !r.affordable)).toBe(true);
    // A fresh game is in setup: the starting pieces go on the board, not through the card.
    expect(rows[0]!.reason).toBe("Place your starting pieces on the board");
    expect(rows[0]!.cost).toEqual(["wood", "clay"]);
    const rolling = costRows({ ...view, phase: { kind: "roll" } } as RedactedState, "a", { wood: 1, clay: 1, wool: 1, grain: 1, ore: 0 }, []);
    expect(rolling[0]!.reason).toBe("Only after rolling");
  });

  it("Crown rows replace the development card and explain themselves", () => {
    const state = createGame({ seed: "hud-4", players: PLAYERS, scenario: builtInScenario("crownStandard") });
    const view = redact(state, "a");
    const rows = costRows(view, "a", { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 }, []);
    expect(rows.map((r) => r.key)).toEqual(["road", "settlement", "city", "wall", "knight", "promote", "improvement"]);
    expect(rows.find((r) => r.key === "wall")!.reason).toBe("Only on your turn, after rolling");
    expect(rows.find((r) => r.key === "improvement")!.opens).toBe("improve");
    expect(rows.find((r) => r.key === "devCard")).toBeUndefined();
  });

  it("a legal build is affordable and carries its mode; a legal buy carries its action", () => {
    const state = createGame({ seed: "hud-5", players: PLAYERS, board: "beginner" });
    const view = { ...redact(state, "a"), phase: { kind: "action" } } as RedactedState;
    const legal: Action[] = [
      { type: "BUILD_ROAD", playerId: "a", edge: "x" },
      { type: "BUY_DEV_CARD", playerId: "a" },
    ];
    const rows = costRows(view, "a", { wood: 1, clay: 1, wool: 1, grain: 1, ore: 1 }, legal);
    expect(rows.find((r) => r.key === "road")).toMatchObject({ affordable: true, reason: null, mode: "road" });
    expect(rows.find((r) => r.key === "devCard")).toMatchObject({ affordable: true, action: { type: "BUY_DEV_CARD" } });
  });

  it("every row has copy", () => {
    for (const key of ["road", "ship", "settlement", "city", "devCard", "wall", "knight", "promote", "improvement"] as const) {
      expect(HUD_COPY.costs[key].name.length).toBeGreaterThan(0);
      expect(HUD_COPY.costs[key].help.length).toBeGreaterThan(0);
    }
  });
});

describe("docs/phase12.md §5 end turn pulse and the status line", () => {
  it("pulses only when nothing but END_TURN is left", () => {
    expect(onlyEndTurnLeft([{ type: "END_TURN", playerId: "a" }])).toBe(true);
    expect(onlyEndTurnLeft([{ type: "END_TURN", playerId: "a" }, { type: "BUILD_ROAD", playerId: "a", edge: "e" }])).toBe(false);
    expect(onlyEndTurnLeft([])).toBe(false);
  });

  it("names who the game waits for", () => {
    const state = createGame({ seed: "hud-6", players: PLAYERS, board: "beginner" });
    const view = redact(state, "b");
    expect(waitingText(view, "b", "a", [{ playerId: "a", kind: "bot" }])).toBe("Waiting for Ada (bot) to place a settlement");
    expect(waitingText(view, "a", "a", undefined)).toBeNull();
  });

  it("the setup legal list drives the cost rows off during setup", () => {
    const state = createGame({ seed: "hud-7", players: PLAYERS, board: "beginner" });
    const view = redact(state, "a");
    const rows = costRows(view, "a", { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 }, legalActions(state, "a"));
    expect(rows.every((r) => !r.affordable)).toBe(true);
  });
});

describe("docs/phase12.md §3 dice history", () => {
  it("keeps the last six, ignores repeats, and counts a histogram", () => {
    let h = pushRoll([], { seq: 1, dice: [3, 4], event: null });
    h = pushRoll(h, { seq: 1, dice: [3, 4], event: null });
    expect(h).toHaveLength(1);
    for (let i = 2; i <= 8; i++) h = pushRoll(h, { seq: i, dice: [1, i % 6 || 6], event: "fleet" });
    expect(h).toHaveLength(6);
    expect(h[0]!.seq).toBe(3);
    const all = pushRoll(h, { seq: 9, dice: [6, 6], event: null }, Infinity);
    expect(all).toHaveLength(7);
    expect(rollHistogram(all)[12]).toBe(1);
  });
});

describe("docs/phase12.md §7 on-table prop layout", () => {
  const state = createGame({ seed: "hud-8", players: PLAYERS, board: "beginner" });
  const bounds = boardBounds([...Object.keys(state.board.hexes), ...state.board.sea]);

  it("bank stacks sit past the right edge, the deck after the last stack, the centre between them", () => {
    const b = bankLayout(bounds, 5);
    expect(b.origin.x).toBeGreaterThan(bounds.maxX);
    expect(b.deck.z).toBeGreaterThan(b.origin.z + 4 * b.step);
    expect(b.centre.z).toBeCloseTo(b.origin.z + 2 * b.step);
  });

  it("the barbarian track is a chain of sea hexes hooked onto the board's top-left corner, the fleet sailing in toward the board", () => {
    const hexes = [...Object.keys(state.board.hexes), ...state.board.sea, ...state.board.frame] as HexId[];
    const t = barbarianTrackLayout(hexes);
    expect(t.tiles).toHaveLength(TRACK_TILES);
    expect(t.dots).toHaveLength(7);
    // Every track hex lies beyond the board's top-left-most hex (the smallest x + z), so none overlaps the board.
    const edge = Math.min(...hexes.map((h) => hexWorld(h).x + hexWorld(h).z));
    for (const tile of t.tiles) expect(tile.x + tile.z).toBeLessThan(edge - 1e-9);
    // The chain is contiguous: consecutive hexes are grid neighbours (√3 apart).
    for (let i = 1; i < t.tiles.length; i++) expect(Math.hypot(t.tiles[i]!.x - t.tiles[i - 1]!.x, t.tiles[i]!.z - t.tiles[i - 1]!.z)).toBeCloseTo(Math.sqrt(3));
    // The near hex touches the corner hex; the far end is the open sea.
    const corner = hexes.reduce((best, h) => (hexWorld(h).x + hexWorld(h).z < hexWorld(best).x + hexWorld(best).z ? h : best));
    const near = t.tiles[t.tiles.length - 1]!;
    expect(Math.hypot(near.x - hexWorld(corner).x, near.z - hexWorld(corner).z)).toBeCloseTo(Math.sqrt(3));
    expect(t.start).toEqual(t.tiles[0]);
    // The landing is the near hex's centre and the markers close in on it in order.
    expect(t.end).toEqual(t.dots[6]);
    expect(t.end.x).toBeCloseTo(near.x);
    expect(t.end.z).toBeCloseTo(near.z);
    const toEnd = (p: { x: number; z: number }) => Math.hypot(p.x - t.end.x, p.z - t.end.z);
    for (let i = 1; i < t.dots.length; i++) expect(toEnd(t.dots[i]!)).toBeLessThan(toEnd(t.dots[i - 1]!));
    // Every marker stands on a track hex.
    for (const d of t.dots) expect(t.tiles.some((tile) => Math.hypot(d.x - tile.x, d.z - tile.z) < 1)).toBe(true);
  });

  it("seats are counted from the viewer, so every player's own props take the near edge", () => {
    expect(seatFrom(["a", "b", "c"], "a", "a")).toBe(0);
    expect(seatFrom(["a", "b", "c"], "b", "b")).toBe(0);
    expect(seatFrom(["a", "b", "c"], "b", "c")).toBe(1);
    expect(seatFrom(["a", "b", "c"], "b", "a")).toBe(2);
    // An unknown viewer (a spectator) sees the table from seat a.
    expect(seatFrom(["a", "b", "c"], "zz", "c")).toBe(2);
  });

  it("each seat's improvement card lies just before its pile and beside it, outside the board, every seat distinct", () => {
    const spots = new Set<string>();
    for (const seat of [0, 1, 2, 3]) {
      const pile = pileLayout(bounds, seat);
      const card = cardLayout(bounds, seat);
      // Behind the pile's origin along its row direction.
      expect((card.x - pile.origin.x) * pile.along.x + (card.z - pile.origin.z) * pile.along.z).toBeLessThan(0);
      expect(card.x < bounds.minX || card.x > bounds.maxX || card.z < bounds.minZ || card.z > bounds.maxZ).toBe(true);
      spots.add(`${card.x.toFixed(2)},${card.z.toFixed(2)}`);
    }
    expect(spots.size).toBe(4);
  });

  it("piles are outside the board and every seat gets a distinct spot", () => {
    const spots = [0, 1, 2, 3, 4, 5].map((seat) => pileLayout(bounds, seat));
    const keys = new Set(spots.map((s) => `${s.origin.x.toFixed(2)},${s.origin.z.toFixed(2)}`));
    expect(keys.size).toBe(6);
    for (const s of spots) expect(s.origin.x < bounds.minX || s.origin.x > bounds.maxX || s.origin.z < bounds.minZ || s.origin.z > bounds.maxZ).toBe(true);
    const first = pileSlot(spots[0]!, 0, 8, 0.2, 0.3);
    const ninth = pileSlot(spots[0]!, 8, 8, 0.2, 0.3);
    expect(first.x).toBe(spots[0]!.origin.x);
    expect(ninth.z).toBeCloseTo(spots[0]!.origin.z + 0.3);
  });
});
