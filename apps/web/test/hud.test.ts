import { describe, expect, it } from "vitest";
import { builtInScenario, createGame, legalActions, redact, type Action } from "@katan/engine";
import { boardBounds } from "@/board3d/layout3d";
import { bankLayout, barbarianTrackLayout, pileLayout, pileSlot } from "@/board/props/layout";
import { HUD_COPY } from "@/hud/hudCopy";
import { bannerStats, costRows, handSize, onlyEndTurnLeft, pushRoll, rollHistogram, waitingText } from "@/hud/model";

const PLAYERS = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];

describe("docs/phase12.md §1 banner statistics", () => {
  it("base game: four columns, army and longest road pills, hand size for others is the hidden count", () => {
    const state = createGame({ seed: "hud-1", players: PLAYERS, board: "beginner" });
    const view = redact(state, "a");
    const mine = bannerStats(view, view.players[0]!);
    expect(mine.columns.map((c) => c.key)).toEqual(["roads", "army", "knights", "dev"]);
    expect(mine.pills[0].icon).toBe("army");
    expect(mine.vp).toBe(0);
    const other = view.players[1]!;
    expect(handSize(other)).toBe(0);
    expect(bannerStats(view, other).columns.every((c) => c.value === 0)).toBe(true);
  });

  it("Crown & Castle: five columns with defence, knights, progress and improvements", () => {
    const state = createGame({ seed: "hud-2", players: PLAYERS, scenario: builtInScenario("crownStandard") });
    const view = redact(state, "a");
    const stats = bannerStats(view, view.players[0]!);
    expect(stats.columns.map((c) => c.key)).toEqual(["roads", "defense", "knights", "progress", "improvements"]);
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
    expect(rows[0]!.reason).toBe("Only after rolling");
    expect(rows[0]!.cost).toEqual(["wood", "clay"]);
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
    const view = redact(state, "a");
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
    const rows = costRows(view, "a", { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 }, legalActions(state));
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

  it("the barbarian track has seven dots on a circle past the left edge", () => {
    const t = barbarianTrackLayout(bounds);
    expect(t.dots).toHaveLength(7);
    expect(t.centre.x).toBeLessThan(bounds.minX);
    for (const d of t.dots) expect(Math.hypot(d.x - t.centre.x, d.z - t.centre.z)).toBeCloseTo(t.radius);
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
