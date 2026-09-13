import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import type { EdgeDef } from "../src/definition";
import type { GameEvent } from "../src/events";
import { standardFrame } from "../src/frames";
import { createGame } from "../src/game";
import { GEOMETRY, hexEdgesOf, hexRing, type EdgeId, type VertexId } from "../src/geometry";
import { legalActions, roadCostOf } from "../src/legal";
import type { RiversState } from "../src/modules/types";
import { BRIDGE_BUILDER_MIN, BRIDGE_BUILDER_VP, POOR_SETTLER_VP, isRiverside, riverRoadCount, riversideCoins } from "../src/modules/wayfarers/rivers";
import type { Scenario } from "../src/scenario";
import { COSTS, getPlayer, hand, handSize, victoryPoints } from "../src/state";
import type { GameState, Player } from "../src/types";
import { ACTION_PHASE, FOUR, around, centerCorner, clearStart, expectRule, give, inPhase, mut, pathEdges, place, playRandomGame, vertexPath } from "./helpers";

const MODULE_EVENT_KINDS: readonly GameEvent["kind"][] = ["deckReshuffled", "neighborlyGave", "taxCollected", "chipMoved", "bridgeBuilt", "coinsAwarded"];

// Three disjoint river paths of five edges, far enough apart for the distance rule.
const PATH_A = vertexPath(centerCorner(0), 5);
const PATH_B = vertexPath(clearStart(5, around(PATH_A)), 5, around(PATH_A));
const PATH_C = vertexPath(clearStart(5, around([...PATH_A, ...PATH_B])), 5, around([...PATH_A, ...PATH_B]));
const EDGES_A = pathEdges(PATH_A);
const EDGES_B = pathEdges(PATH_B);
const EDGES_C = pathEdges(PATH_C);
const RIVERS: EdgeId[] = [...EDGES_A, ...EDGES_B, ...EDGES_C];
/** A vertex out of reach of every path (its edges are dry). */
const DRY_VERTEX: VertexId = clearStart(1, around([...PATH_A, ...PATH_B, ...PATH_C]));
const DRY_EDGE: EdgeId = GEOMETRY.vertexEdges[DRY_VERTEX]![0]!;

/** A denser river net for random play: every edge of the six ring-1 hexes. */
const MANY_RIVERS: EdgeId[] = [...new Set(hexRing(1).flatMap((c) => hexEdgesOf(c)))];

function scenario(rivers: boolean, edges: readonly EdgeId[] = RIVERS): Scenario {
  const board = { ...standardFrame(), edges: edges.map((edge): EdgeDef => ({ edge, kind: "river" })) };
  return { id: "t", name: "t", board, modules: {}, variants: { rivers }, victoryPoints: 10 };
}

function game(seed = "rivers"): GameState {
  return createGame({ seed, players: FOUR, scenario: scenario(true) });
}

function rv(state: GameState): RiversState {
  return state.wayfarers!.rivers!;
}

/** Everyone in the action phase with `id` current, a at the head of path A, b of B, c of C and d on dry land. */
function seated(id = "a"): GameState {
  let s = inPhase(game(), ACTION_PHASE, id);
  s = place(s, "a", { settlements: [PATH_A[0]!] });
  s = place(s, "b", { settlements: [PATH_B[0]!] });
  s = place(s, "c", { settlements: [PATH_C[0]!] });
  s = place(s, "d", { settlements: [DRY_VERTEX] });
  return s;
}

const bridgeCost = hand({ wood: 1, clay: 2 });

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

/** Independent VP recount: buildings, special cards, VP cards, +1 Bridge Builder, -2 Poor Settler. */
function recount(state: GameState, p: Player): number {
  let vp = p.settlements.length + 2 * p.cities.length;
  if (state.longestRoad.playerId === p.id) vp += 2;
  if (state.largestArmy.playerId === p.id) vp += 2;
  const r = state.wayfarers?.rivers;
  if (r?.bridgeBuilder.playerId === p.id) vp += BRIDGE_BUILDER_VP;
  if (r?.poorSettler === p.id) vp -= POOR_SETTLER_VP;
  return vp + p.devCards.filter((c) => c.type === "victoryPoint").length;
}

function totalCards(state: GameState): number {
  return handSize(state.bank) + state.players.reduce((n, p) => n + handSize(p.hand), 0);
}

describe("docs/phase10.md §3 Rivers", () => {
  it("docs/phase10.md §3 the board keeps the river edges and a fresh game starts with no coins and no chips", () => {
    const state = game();
    expect([...state.board.rivers].sort()).toEqual([...RIVERS].sort());
    expect(rv(state)).toEqual({ bridgeBuilder: { playerId: null, count: 0 }, coins: { a: 0, b: 0, c: 0, d: 0 }, poorSettler: null });
    expect(state.wayfarers).toEqual({ eventDeck: null, fishing: null, rivers: rv(state), harbormaster: null, raiders: null, caravans: null, wagons: null });
    expect(isRiverside(state, PATH_A[0]!)).toBe(true);
    expect(isRiverside(state, PATH_A[5]!)).toBe(true);
    expect(isRiverside(state, DRY_VERTEX)).toBe(false);
  });

  it("docs/phase10.md §3 a road on a river edge is a bridge: one extra clay, refused when the player cannot pay it, bridgeBuilt after built; other roads cost the usual", () => {
    const s = seated();
    const river = EDGES_A[0]!;
    const dry = GEOMETRY.vertexEdges[PATH_A[0]!]!.find((e) => !RIVERS.includes(e))!;
    expect(roadCostOf(s, river)).toEqual(bridgeCost);
    expect(roadCostOf(s, dry)).toEqual(COSTS.road);
    const poor = give(s, "a", COSTS.road);
    expectRoads(poor, "a", { has: [dry], lacks: [river] });
    expectRule(() => applyAction(poor, { type: "BUILD_ROAD", playerId: "a", edge: river }), "INSUFFICIENT_RESOURCES");
    const rich = give(s, "a", bridgeCost);
    expectRoads(rich, "a", { has: [dry, river], lacks: [] });
    const { state: s1, events } = applyActionWithEvents(rich, { type: "BUILD_ROAD", playerId: "a", edge: river });
    expect(getPlayer(s1, "a").hand).toEqual(hand({}));
    expect(s1.bank.clay).toBe(rich.bank.clay + 2);
    expect(getPlayer(s1, "a").roads).toEqual([river]);
    const kinds = events.map((e) => e.kind);
    expect(kinds.indexOf("bridgeBuilt")).toBeGreaterThan(kinds.indexOf("built"));
    expect(events).toContainEqual(expect.objectContaining({ kind: "bridgeBuilt", playerId: "a", edge: river }));
    expect(s1.log.at(-1)?.text).toBe("Ada built a bridge");
    expect(riverRoadCount(s1, getPlayer(s1, "a"))).toBe(1);
    expect(rv(s1).bridgeBuilder).toEqual({ playerId: null, count: 0 });
    // An ordinary road on a dry edge.
    const { state: s2, events: e2 } = applyActionWithEvents(give(s, "a", COSTS.road), { type: "BUILD_ROAD", playerId: "a", edge: dry });
    expect(getPlayer(s2, "a").hand).toEqual(hand({}));
    expect(e2.some((e) => e.kind === "bridgeBuilt")).toBe(false);
    expect(riverRoadCount(s2, getPlayer(s2, "a"))).toBe(0);
  });

  it("docs/phase10.md §3 Bridge Builder: most river roads with at least 3 (+1 VP); transfers on a strict exceed, lost below 3 or when tied challengers exceed the holder", () => {
    let s = seated();
    s = place(s, "a", { roads: [EDGES_A[0]!, EDGES_A[1]!] });
    s = place(s, "b", { roads: [EDGES_B[0]!, EDGES_B[1]!] });
    expect(rv(s).bridgeBuilder).toEqual({ playerId: null, count: 0 });
    // a builds a third river road: takes the chip.
    const { state: s1, events: e1 } = applyActionWithEvents(give(s, "a", bridgeCost), { type: "BUILD_ROAD", playerId: "a", edge: EDGES_A[2]! });
    expect(rv(s1).bridgeBuilder).toEqual({ playerId: "a", count: BRIDGE_BUILDER_MIN });
    expect(e1).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "bridgeBuilder", from: null, to: "a" }));
    expect(s1.log.at(-1)?.text).toBe("Ada takes Bridge Builder");
    expect(victoryPoints(s1, getPlayer(s1, "a"))).toEqual({ publicVP: 2, hiddenVP: 0, total: 2 });
    expect(victoryPoints(s1, getPlayer(s1, "b")).total).toBe(1);
    // b reaches 3 as well: a tie never transfers.
    const { state: s1b, events: e1b } = applyActionWithEvents(give(inPhase(s1, ACTION_PHASE, "b"), "b", bridgeCost), { type: "BUILD_ROAD", playerId: "b", edge: EDGES_B[2]! });
    expect(riverRoadCount(s1b, getPlayer(s1b, "b"))).toBe(3);
    expect(rv(s1b).bridgeBuilder).toEqual({ playerId: "a", count: 3 });
    expect(e1b.some((e) => e.kind === "chipMoved")).toBe(false);
    // A fourth: 4 > 3, b takes it.
    const { state: s2, events: e2 } = applyActionWithEvents(give(s1b, "b", bridgeCost), { type: "BUILD_ROAD", playerId: "b", edge: EDGES_B[3]! });
    expect(rv(s2).bridgeBuilder).toEqual({ playerId: "b", count: 4 });
    expect(e2).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "bridgeBuilder", from: "a", to: "b" }));
    expect(victoryPoints(s2, getPlayer(s2, "b")).total).toBe(2);
    expect(victoryPoints(s2, getPlayer(s2, "a")).total).toBe(1);
    // a ties at 4: b keeps it.
    const { state: s3, events: e3 } = applyActionWithEvents(give(inPhase(s2, ACTION_PHASE, "a"), "a", bridgeCost), { type: "BUILD_ROAD", playerId: "a", edge: EDGES_A[3]! });
    expect(rv(s3).bridgeBuilder).toEqual({ playerId: "b", count: 4 });
    expect(e3.some((e) => e.kind === "chipMoved")).toBe(false);
    // The holder drops below 3 (roads gone): the unique player with the most, a, takes it at the next re-evaluation.
    const lost = mut(s3, (x) => {
      const b = getPlayer(x, "b");
      b.pieces.roads += b.roads.length - 1;
      b.roads = [EDGES_B[0]!];
    });
    const dRoad = (x: GameState) => applyActionWithEvents(give(inPhase(x, ACTION_PHASE, "d"), "d", COSTS.road), { type: "BUILD_ROAD", playerId: "d", edge: DRY_EDGE });
    const { state: s4, events: e4 } = dRoad(lost);
    expect(rv(s4).bridgeBuilder).toEqual({ playerId: "a", count: 4 });
    expect(e4).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "bridgeBuilder", from: "b", to: "a" }));
    // Everyone below 3: nobody holds it.
    const nobody = mut(lost, (x) => {
      const a = getPlayer(x, "a");
      a.pieces.roads += a.roads.length - 2;
      a.roads = [EDGES_A[0]!, EDGES_A[1]!];
    });
    const { state: s5, events: e5 } = dRoad(nobody);
    expect(rv(s5).bridgeBuilder).toEqual({ playerId: null, count: 0 });
    expect(e5).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "bridgeBuilder", from: "b", to: null }));
    expect(s5.log.some((l) => l.text === "Bridge Builder is unclaimed")).toBe(true);
    // Two challengers exceed the holder with the same count: nobody holds it.
    const tied = mut(s2, (x) => {
      const a = getPlayer(x, "a");
      a.roads = EDGES_A.slice(0, 5);
      a.pieces.roads = 10;
      const c = getPlayer(x, "c");
      c.roads = EDGES_C.slice(0, 5);
      c.pieces.roads = 10;
    });
    const { state: s6, events: e6 } = dRoad(tied);
    expect(rv(s6).bridgeBuilder).toEqual({ playerId: null, count: 0 });
    expect(e6).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "bridgeBuilder", from: "b", to: null }));
    // A holder tied by one challenger keeps it while a second challenger exceeds both: that one takes it.
    const ahead = mut(tied, (x) => {
      const c = getPlayer(x, "c");
      c.roads = EDGES_C.slice(0, 5);
      const a = getPlayer(x, "a");
      a.roads = EDGES_A.slice(0, 4);
    });
    expect(rv(dRoad(ahead).state).bridgeBuilder).toEqual({ playerId: "c", count: 5 });
  });

  it("docs/phase10.md §3 gold coins at the end of a player's turn (1 per riverside settlement, 2 per riverside city) and the Poor Settler (-2 VP) for the unique poorest", () => {
    let s = seated();
    s = mut(s, (x) => {
      // b's riverside settlement becomes a city.
      const b = getPlayer(x, "b");
      b.settlements = [];
      b.cities = [PATH_B[0]!];
      b.pieces.settlements += 1;
      b.pieces.cities -= 1;
    });
    expect(riversideCoins(s, getPlayer(s, "a"))).toBe(1);
    expect(riversideCoins(s, getPlayer(s, "b"))).toBe(2);
    expect(riversideCoins(s, getPlayer(s, "d"))).toBe(0);
    // a ends the turn: 1 coin; b, c and d tie at 0 so nobody is the Poor Settler.
    const { state: s1, events: e1 } = applyActionWithEvents(s, { type: "END_TURN", playerId: "a" });
    expect(e1).toContainEqual(expect.objectContaining({ kind: "coinsAwarded", playerId: "a", coins: 1, total: 1 }));
    expect(s1.log.some((l) => l.text === "Ada earned 1 gold coin (1)")).toBe(true);
    expect(rv(s1).coins).toEqual({ a: 1, b: 0, c: 0, d: 0 });
    expect(rv(s1).poorSettler).toBeNull();
    expect(e1.some((e) => e.kind === "chipMoved")).toBe(false);
    // Only the player whose turn ends is paid: b's city earns 2 on b's turn end.
    const s2 = applyAction(inPhase(s1, ACTION_PHASE, "b"), { type: "END_TURN", playerId: "b" });
    expect(rv(s2).coins).toEqual({ a: 1, b: 2, c: 0, d: 0 });
    expect(rv(s2).poorSettler).toBeNull();
    // c's coin leaves d as the unique poorest.
    const { state: s3, events: e3 } = applyActionWithEvents(inPhase(s2, ACTION_PHASE, "c"), { type: "END_TURN", playerId: "c" });
    expect(rv(s3).coins).toEqual({ a: 1, b: 2, c: 1, d: 0 });
    expect(rv(s3).poorSettler).toBe("d");
    expect(e3).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "poorSettler", from: null, to: "d" }));
    expect(s3.log.at(-1)?.text).toBe("Di takes the Poor Settler");
    expect(victoryPoints(s3, getPlayer(s3, "d"))).toEqual({ publicVP: 1 - POOR_SETTLER_VP, hiddenVP: 0, total: 1 - POOR_SETTLER_VP });
    expect(victoryPoints(s3, getPlayer(s3, "a")).total).toBe(1);
    // d has nothing riverside: no coins, no event, still the Poor Settler.
    const { state: s4, events: e4 } = applyActionWithEvents(inPhase(s3, ACTION_PHASE, "d"), { type: "END_TURN", playerId: "d" });
    expect(e4.some((e) => e.kind === "coinsAwarded")).toBe(false);
    expect(rv(s4).coins.d).toBe(0);
    expect(rv(s4).poorSettler).toBe("d");
    // Coins accumulate.
    const s5 = applyAction(inPhase(s4, ACTION_PHASE, "a"), { type: "END_TURN", playerId: "a" });
    expect(rv(s5).coins).toEqual({ a: 2, b: 2, c: 1, d: 0 });
    // d catches up (coins set directly): after the next award c is the unique poorest and the chip moves.
    const rich = mut(s5, (x) => {
      rv(x).coins.d = 3;
    });
    const { state: s6, events: e6 } = applyActionWithEvents(inPhase(rich, ACTION_PHASE, "b"), { type: "END_TURN", playerId: "b" });
    expect(rv(s6).coins).toEqual({ a: 2, b: 4, c: 1, d: 3 });
    expect(rv(s6).poorSettler).toBe("c");
    expect(e6).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "poorSettler", from: "d", to: "c" }));
    // A tie for poorest clears the chip.
    const even = mut(s6, (x) => {
      rv(x).coins.a = 1;
    });
    const { state: s7, events: e7 } = applyActionWithEvents(inPhase(even, ACTION_PHASE, "b"), { type: "END_TURN", playerId: "b" });
    expect(rv(s7).poorSettler).toBeNull();
    expect(e7).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "poorSettler", from: "c", to: null }));
    expect(s7.log.some((l) => l.text === "the Poor Settler is unclaimed")).toBe(true);
    for (const p of s7.players) expect(victoryPoints(s7, p).total).toBe(recount(s7, p));
  });

  it("docs/phase10.md §3 victory points: +1 for the Bridge Builder, -2 for the Poor Settler, nothing hidden; the win check counts them", () => {
    const s = mut(seated(), (x) => {
      rv(x).bridgeBuilder = { playerId: "a", count: 3 };
      rv(x).poorSettler = "a";
      const b = getPlayer(x, "b");
      b.cities = [PATH_B[0]!, ...b.cities];
      b.settlements = [];
      b.pieces.cities -= 5;
      b.cities.push(...PATH_B.slice(1, 5));
    });
    expect(victoryPoints(s, getPlayer(s, "a"))).toEqual({ publicVP: 1 + BRIDGE_BUILDER_VP - POOR_SETTLER_VP, hiddenVP: 0, total: 0 });
    // b sits at 10 building points; as the Poor Settler that is 8, so ending the turn does not win.
    const poorB = mut(s, (x) => {
      rv(x).poorSettler = "b";
    });
    expect(victoryPoints(poorB, getPlayer(poorB, "b")).total).toBe(10 - POOR_SETTLER_VP);
    const trade = { type: "MARITIME_TRADE", playerId: "b", give: "wood", giveCount: 4, receive: "ore" } as const;
    const notYet = applyAction(give(inPhase(poorB, ACTION_PHASE, "b"), "b", { wood: 4 }), trade);
    expect(notYet.winner).toBeNull();
    expect(notYet.phase).toEqual(ACTION_PHASE);
    // Without the chip the same b wins on the next action.
    const winner = applyAction(give(inPhase(s, ACTION_PHASE, "b"), "b", { wood: 4 }), trade);
    expect(winner.winner).toBe("b");
    expect(winner.phase).toEqual({ kind: "ended" });
  });

  it("docs/phase10.md §3 random play: 20 games end, conserve resources and keep the VP, coin and chip invariants", () => {
    let bridgesSeen = 0;
    let poorSeen = 0;
    for (let i = 0; i < 20; i++) {
      const seed = `rivers-${i}`;
      const played = playRandomGame(seed, {
        scenario: scenario(true, MANY_RIVERS),
        onStep: (s) => {
          check(totalCards(s) === 95, `resources not conserved (${seed})`);
          const r = rv(s);
          const counts = new Map(s.players.map((p) => [p.id, riverRoadCount(s, p)]));
          const max = Math.max(...counts.values());
          const atMax = [...counts.values()].filter((n) => n === max).length;
          if (r.bridgeBuilder.playerId === null) {
            check(r.bridgeBuilder.count === 0, `count without a holder (${seed})`);
            check(max < BRIDGE_BUILDER_MIN || atMax > 1, `unclaimed Bridge Builder with a unique ${max} (${seed})`);
          } else {
            bridgesSeen += 1;
            check(r.bridgeBuilder.count === counts.get(r.bridgeBuilder.playerId) && r.bridgeBuilder.count >= BRIDGE_BUILDER_MIN, `holder count wrong (${seed})`);
            check(max === r.bridgeBuilder.count, `someone exceeds the Bridge Builder (${seed})`);
          }
          const coins = s.players.map((p) => r.coins[p.id] ?? -1);
          check(coins.every((n) => n >= 0), `negative coins (${seed})`);
          const min = Math.min(...coins);
          const atMin = coins.filter((n) => n === min).length;
          if (r.poorSettler === null) check(atMin > 1, `unclaimed Poor Settler with a unique poorest (${seed})`);
          else {
            poorSeen += 1;
            check(r.coins[r.poorSettler] === min && atMin === 1, `Poor Settler is not the unique poorest (${seed})`);
          }
          for (const p of s.players) check(victoryPoints(s, p).total === recount(s, p), `VP mismatch for ${p.id} (${seed})`);
        },
      });
      expect(played.final.phase.kind).toBe("ended");
      expect(played.final.winner).not.toBeNull();
    }
    expect(bridgesSeen).toBeGreaterThan(0);
    expect(poorSeen).toBeGreaterThan(0);
  }, 60_000);

  it("docs/phase10.md §3 with the variant off the base game is untouched: river edges cost nothing extra, no coins, no module events", () => {
    const off = scenario(false);
    const fresh = createGame({ seed: "x", players: FOUR, scenario: off });
    expect(fresh.wayfarers).toBeNull();
    expect(fresh.board.rivers).toHaveLength(RIVERS.length);
    expect(roadCostOf(fresh, EDGES_A[0]!)).toEqual(COSTS.road);
    const played = playRandomGame("rivers-off", { scenario: off, maxTurns: 80 });
    let state = played.initial;
    for (const action of played.actions) {
      const { state: next, events } = applyActionWithEvents(state, action);
      for (const e of events) expect(MODULE_EVENT_KINDS).not.toContain(e.kind);
      for (const p of next.players) expect(victoryPoints(next, p).total).toBe(recount(next, p));
      state = next;
    }
    expect(state.wayfarers).toBeNull();
    expect(state).toEqual(played.final);
  });
});

function expectRoads(state: GameState, id: string, want: { has: EdgeId[]; lacks: EdgeId[] }): void {
  const edges = legalActions(state, id).flatMap((x) => (x.type === "BUILD_ROAD" ? [x.edge] : []));
  for (const e of want.has) expect(edges).toContain(e);
  for (const e of want.lacks) expect(edges).not.toContain(e);
}
