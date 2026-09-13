import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { RESOURCES } from "../src/board";
import { standardFrame } from "../src/frames";
import { createGame } from "../src/game";
import { GEOMETRY, type EdgeId, type VertexId } from "../src/geometry";
import { legalActions } from "../src/legal";
import { CITY_STOCK_CAP, WAGON_CAPACITY, WAGON_FREE_STEPS, WAGON_GOODS, type WagonGood } from "../src/modules/types";
import { createRng } from "../src/rng";
import type { Scenario } from "../src/scenario";
import { buildingAt, getPlayer, handSize, roadOwner, victoryPoints } from "../src/state";
import type { Action, GameState, PlayerId } from "../src/types";
import { ACTION_PHASE, FOUR, expectRule, finishSetup, give, inPhase, mut, pathEdges, playRandomGame, vertexPath } from "./helpers";

function wagonScenario(overrides: Partial<Scenario> = {}): Scenario {
  return { id: "wagons-test", name: "Wagons test", board: standardFrame(), modules: {}, variants: { wagons: true }, victoryPoints: 12, ...overrides };
}

function game(seed = "wagons"): GameState {
  return createGame({ seed, players: FOUR, scenario: wagonScenario() });
}

function wagons(state: GameState) {
  const w = state.wayfarers?.wagons;
  if (!w) throw new Error("wagons off");
  return w;
}

/** Pave `path` with roads of `owner` wherever nobody has one yet (test setup only). */
function pave(state: GameState, owner: PlayerId, path: VertexId[]): GameState {
  return mut(state, (s) => {
    for (const e of pathEdges(path)) if (roadOwner(s, e) === null) getPlayer(s, owner).roads.push(e);
  });
}

/** Put `playerId`'s wagon at `at` (test setup only). */
function parkWagon(state: GameState, playerId: PlayerId, at: VertexId): GameState {
  return mut(state, (s) => void (wagons(s).wagons[playerId] = { at, cargo: [], stepsUsed: 0 }));
}

function move(state: GameState, playerId: PlayerId, path: VertexId[], extra: { grain?: number; toll?: "wood" | "clay" | "wool" | "grain" | "ore" } = {}): GameState {
  return applyAction(state, { type: "MOVE_WAGON", playerId, path, ...extra });
}

/** A's setup done, a in the action phase with a fat hand, and a four-vertex road path from a's wagon paved by b. */
function roadTrip(): { state: GameState; path: VertexId[] } {
  let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
  const start = wagons(s).wagons.a!.at;
  const path = vertexPath(start, 3);
  s = give(pave(s, "b", path), "a", { wood: 3, clay: 3, wool: 3, grain: 3, ore: 3 });
  return { state: s, path };
}

/** A city of `owner` at a vertex reachable by nobody's road, with a's wagon parked on it. */
function atCity(owner: PlayerId, stock: WagonGood[], demand: WagonGood): { state: GameState; city: VertexId } {
  let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
  const city = GEOMETRY.vertices.find((v) => buildingAt(s, v) === null && GEOMETRY.vertexNeighbors[v]!.every((n) => buildingAt(s, n) === null))!;
  s = mut(s, (x) => {
    const p = getPlayer(x, owner);
    p.cities.push(city);
    p.pieces.cities -= 1;
    wagons(x).stock[city] = [...stock];
    wagons(x).demand[city] = demand;
  });
  return { state: parkWagon(s, "a", city), city };
}

const movesOf = (state: GameState, who: PlayerId) => legalActions(state, who).filter((x): x is Extract<Action, { type: "MOVE_WAGON" }> => x.type === "MOVE_WAGON");

describe("docs/phase10.md §7 Wagons", () => {
  it("docs/phase10.md §7 init: empty stock, demand and points; off leaves wayfarers null", () => {
    const s = game();
    const w = wagons(s);
    expect(w.wagons).toEqual({});
    expect(w.stock).toEqual({});
    expect(w.demand).toEqual({});
    for (const p of s.players) expect(w.points[p.id]).toBe(0);
    expect(createGame({ seed: "x", players: FOUR, scenario: wagonScenario({ variants: {} }) }).wayfarers).toBeNull();
  });

  it("docs/phase10.md §7 each wagon starts on its owner's second setup settlement, empty", () => {
    const s = finishSetup(game());
    for (const p of s.players) {
      expect(wagons(s).wagons[p.id]).toEqual({ at: p.settlements[1], cargo: [], stepsUsed: 0 });
    }
    // Not yet during round 1.
    let r1 = game();
    r1 = applyAction(r1, legalActions(r1, "a")[0]!);
    expect(wagons(r1).wagons.a).toBeUndefined();
  });

  it("docs/phase10.md §7 MOVE_WAGON walks any player's roads: two free steps per turn, then one grain per step, reset at turn start", () => {
    const { state: s, path } = roadTrip();
    const [v0, v1, v2, v3] = path as [VertexId, VertexId, VertexId, VertexId];
    const grain = getPlayer(s, "a").hand.grain;

    const { state: s1, events } = applyActionWithEvents(s, { type: "MOVE_WAGON", playerId: "a", path: [v0, v1, v2] });
    expect(wagons(s1).wagons.a).toEqual({ at: v2, cargo: [], stepsUsed: 2 });
    expect(getPlayer(s1, "a").hand.grain).toBe(grain);
    expect(events).toContainEqual(expect.objectContaining({ kind: "wagonMoved", playerId: "a", path: [v0, v1, v2], grain: 0, toll: null }));

    // The third step costs a grain, and the payment must be declared.
    expectRule(() => move(s1, "a", [v2, v3]), "WAGON_NO_STEPS");
    expectRule(() => move(s1, "a", [v2, v3], { grain: 2 }), "WAGON_NO_STEPS");
    const s2 = move(s1, "a", [v2, v3], { grain: 1 });
    expect(wagons(s2).wagons.a!.at).toBe(v3);
    expect(wagons(s2).wagons.a!.stepsUsed).toBe(3);
    expect(getPlayer(s2, "a").hand.grain).toBe(grain - 1);
    expect(s2.bank.grain).toBe(s1.bank.grain + 1);
    const broke = mut(s1, (x) => void (getPlayer(x, "a").hand.grain = 0));
    expectRule(() => move(broke, "a", [v2, v3], { grain: 1 }), "INSUFFICIENT_RESOURCES");

    // Paying grain for a free step is refused; steps come back next turn.
    expectRule(() => move(s, "a", [v0, v1], { grain: 1 }), "WAGON_NO_STEPS");
    const next = applyAction(s2, { type: "END_TURN", playerId: "a" });
    expect(wagons(next).wagons.a!.stepsUsed).toBe(0);
    // A move all the way back in one go: 3 steps = 2 free + 1 grain.
    const back = move(inPhase(next, ACTION_PHASE, "a"), "a", [v3, v2, v1, v0], { grain: 1 });
    expect(wagons(back).wagons.a!.at).toBe(v0);
    expect(WAGON_FREE_STEPS).toBe(2);
  });

  it("docs/phase10.md §7 MOVE_WAGON rejections: bad paths, missing roads, ships, wrong phase or turn, variant off", () => {
    const { state: s, path } = roadTrip();
    const [v0, v1, v2] = path as [VertexId, VertexId, VertexId];
    expectRule(() => move(s, "a", [v1, v2]), "WAGON_BAD_PATH");
    expectRule(() => move(s, "a", [v0]), "WAGON_BAD_PATH");
    expectRule(() => move(s, "a", []), "WAGON_BAD_PATH");
    expectRule(() => move(s, "a", [v0, v2]), "WAGON_BAD_PATH");
    expectRule(() => move(s, "a", [v0, v0]), "WAGON_BAD_PATH");
    expectRule(() => move(s, "a", [v0, v1, v0]), "WAGON_BAD_PATH");
    // Take the road away: no road, no path; a ship on the edge does not help.
    const e01 = pathEdges([v0, v1])[0] as EdgeId;
    const bare = mut(s, (x) => {
      for (const p of x.players) p.roads = p.roads.filter((e) => e !== e01);
    });
    expectRule(() => move(bare, "a", [v0, v1]), "WAGON_BAD_PATH");
    const shipped = mut(bare, (x) => void getPlayer(x, "b").ships.push(e01));
    expectRule(() => move(shipped, "a", [v0, v1]), "WAGON_BAD_PATH");
    expectRule(() => move(inPhase(s, { kind: "roll" }), "a", [v0, v1]), "WRONG_PHASE");
    expectRule(() => move(inPhase(s, ACTION_PHASE, "b"), "a", [v0, v1]), "NOT_YOUR_TURN");
    const off = inPhase(finishSetup(createGame({ seed: "x", players: FOUR, scenario: wagonScenario({ variants: {} }) })), ACTION_PHASE, "a");
    expectRule(() => move(off, "a", [v0, v1]), "MODULE_OFF");
  });

  it("docs/phase10.md §7 entering a vertex held by an opponent's wagon costs a toll of one resource paid to its owner", () => {
    const { state: s0, path } = roadTrip();
    const [v0, v1, v2] = path as [VertexId, VertexId, VertexId];
    const s = parkWagon(s0, "b", v1);
    expectRule(() => move(s, "a", [v0, v1, v2]), "WAGON_BLOCKED");
    expectRule(() => move(s, "a", [v0, v1]), "WAGON_BLOCKED");
    const { state: paid, events } = applyActionWithEvents(s, { type: "MOVE_WAGON", playerId: "a", path: [v0, v1, v2], toll: "wood" });
    expect(getPlayer(paid, "a").hand.wood).toBe(getPlayer(s, "a").hand.wood - 1);
    expect(getPlayer(paid, "b").hand.wood).toBe(getPlayer(s, "b").hand.wood + 1);
    expect(wagons(paid).wagons.a!.at).toBe(v2);
    expect(events).toContainEqual(expect.objectContaining({ kind: "wagonMoved", playerId: "a", toll: "b", grain: 0 }));
    const noWood = mut(s, (x) => void (getPlayer(x, "a").hand.wood = 0));
    expectRule(() => move(noWood, "a", [v0, v1, v2], { toll: "wood" }), "INSUFFICIENT_RESOURCES");
    // Two blockers on one path cannot both be paid.
    const two = parkWagon(s, "c", v2);
    expectRule(() => move(two, "a", [v0, v1, v2], { toll: "wood" }), "WAGON_BLOCKED");
    // A toll offered with nobody in the way is not charged.
    const free = move(s0, "a", [v0, v1], { toll: "wood" });
    expect(getPlayer(free, "a").hand.wood).toBe(getPlayer(s0, "a").hand.wood);
    // The blocked player still has other legal moves (with the toll filled in).
    const legal = movesOf(s, "a");
    expect(legal.length).toBeGreaterThan(0);
    for (const m of legal) if (m.path.includes(v1)) expect(RESOURCES).toContain(m.toll);
  });

  it("docs/phase10.md §7 LOAD_COMMODITY takes a stocked good at any city into a wagon holding at most two", () => {
    const { state: s, city } = atCity("b", ["marble", "glass"], "sand");
    const { state: s1, events } = applyActionWithEvents(s, { type: "LOAD_COMMODITY", playerId: "a", good: "marble" });
    expect(wagons(s1).wagons.a!.cargo).toEqual(["marble"]);
    expect(wagons(s1).stock[city]).toEqual(["glass"]);
    expect(events).toContainEqual(expect.objectContaining({ kind: "goodLoaded", playerId: "a", vertex: city, good: "marble" }));
    expectRule(() => applyAction(s1, { type: "LOAD_COMMODITY", playerId: "a", good: "marble" }), "NO_GOODS");
    const s2 = applyAction(s1, { type: "LOAD_COMMODITY", playerId: "a", good: "glass" });
    expect(wagons(s2).wagons.a!.cargo).toHaveLength(WAGON_CAPACITY);
    const full = mut(s2, (x) => void (wagons(x).stock[city] = ["tools"]));
    expectRule(() => applyAction(full, { type: "LOAD_COMMODITY", playerId: "a", good: "tools" }), "WAGON_FULL");
    // Own cities stock and load too; a settlement or an empty vertex does not.
    const { state: mine } = atCity("a", ["sand"], "sand");
    expect(wagons(applyAction(mine, { type: "LOAD_COMMODITY", playerId: "a", good: "sand" })).wagons.a!.cargo).toEqual(["sand"]);
    const settlement = mut(s, (x) => {
      const b = getPlayer(x, "b");
      b.cities = b.cities.filter((v) => v !== city);
      b.settlements.push(city);
    });
    expectRule(() => applyAction(settlement, { type: "LOAD_COMMODITY", playerId: "a", good: "marble" }), "NOT_A_CITY");
    expectRule(() => applyAction(s, { type: "LOAD_COMMODITY", playerId: "a", good: "gold" as WagonGood }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(inPhase(s, { kind: "roll" }), { type: "LOAD_COMMODITY", playerId: "a", good: "marble" }), "WRONG_PHASE");
    expect(legalActions(s, "a").filter((x) => x.type === "LOAD_COMMODITY")).toEqual([
      { type: "LOAD_COMMODITY", playerId: "a", good: "marble" },
      { type: "LOAD_COMMODITY", playerId: "a", good: "glass" },
    ]);
  });

  it("docs/phase10.md §7 DELIVER at an opponent's city scores 1 VP, 2 when the good matches its demand, and rotates the demand", () => {
    const { state: s0, city } = atCity("b", [], "glass");
    const s = mut(s0, (x) => void (wagons(x).wagons.a!.cargo = ["glass", "marble"]));
    expect(legalActions(s, "a").filter((x) => x.type === "DELIVER")).toEqual([
      { type: "DELIVER", playerId: "a", good: "glass" },
      { type: "DELIVER", playerId: "a", good: "marble" },
    ]);
    const before = victoryPoints(s, getPlayer(s, "a")).publicVP;
    const { state: s1, events } = applyActionWithEvents(s, { type: "DELIVER", playerId: "a", good: "glass" });
    expect(wagons(s1).points.a).toBe(2);
    expect(wagons(s1).wagons.a!.cargo).toEqual(["marble"]);
    expect(wagons(s1).demand[city]).toBe("sand");
    expect(victoryPoints(s1, getPlayer(s1, "a")).publicVP).toBe(before + 2);
    expect(events).toContainEqual(expect.objectContaining({ kind: "delivered", playerId: "a", vertex: city, good: "glass", points: 2 }));
    const s2 = applyAction(s1, { type: "DELIVER", playerId: "a", good: "marble" });
    expect(wagons(s2).points.a).toBe(3);
    expect(wagons(s2).demand[city]).toBe("tools");
    expectRule(() => applyAction(s2, { type: "DELIVER", playerId: "a", good: "marble" }), "NO_CARGO");
    // Demand wraps round the list; the last good comes before the first.
    const wrap = mut(s2, (x) => {
      wagons(x).wagons.a!.cargo = ["tools"];
    });
    expect(wagons(applyAction(wrap, { type: "DELIVER", playerId: "a", good: "tools" })).demand[city]).toBe(WAGON_GOODS[0]);
    // Own city: no delivery. Not standing on a city: none either.
    const { state: mine } = atCity("a", [], "glass");
    expectRule(() => applyAction(mut(mine, (x) => void (wagons(x).wagons.a!.cargo = ["glass"])), { type: "DELIVER", playerId: "a", good: "glass" }), "NOT_A_CITY");
    expectRule(() => applyAction(s, { type: "DELIVER", playerId: "a", good: "sand" }), "NO_CARGO");
    expectRule(() => applyAction(inPhase(s, ACTION_PHASE, "b"), { type: "DELIVER", playerId: "a", good: "glass" }), "NOT_YOUR_TURN");
  });

  it("docs/phase10.md §7 deliveries win games", () => {
    const { state: s0 } = atCity("b", [], "glass");
    const s = mut(s0, (x) => {
      wagons(x).wagons.a!.cargo = ["glass"];
      const a = getPlayer(x, "a");
      a.devCards = Array.from({ length: 10 - victoryPoints(x, a).total }, () => ({ type: "victoryPoint" as const, boughtOnTurn: 0 }));
    });
    expect(victoryPoints(s, getPlayer(s, "a")).total).toBe(10);
    const won = applyAction(s, { type: "DELIVER", playerId: "a", good: "glass" });
    expect(won.winner).toBe("a");
    expect(won.phase.kind).toBe("ended");
  });

  it("docs/phase10.md §7 every city stocks one seeded good at each turn end, up to two, and takes its seeded demand", () => {
    let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
    const city = GEOMETRY.vertices.find((v) => buildingAt(s, v) === null && GEOMETRY.vertexNeighbors[v]!.every((n) => buildingAt(s, n) === null))!;
    s = mut(s, (x) => void getPlayer(x, "c").cities.push(city));
    const good = WAGON_GOODS[createRng(s.seed, `wagon:${city}`).int(4)];
    const demand = WAGON_GOODS[createRng(s.seed, `demand:${city}`).int(4)];
    expect(wagons(s).stock[city]).toBeUndefined();

    const { state: s1, events } = applyActionWithEvents(s, { type: "END_TURN", playerId: "a" });
    expect(wagons(s1).stock[city]).toEqual([good]);
    expect(wagons(s1).demand[city]).toBe(demand);
    expect(events).toContainEqual(expect.objectContaining({ kind: "goodsStocked", stocked: expect.arrayContaining([{ vertex: city, good }]) }));
    // Settlements never stock.
    for (const p of s1.players) for (const v of p.settlements) expect(wagons(s1).stock[v]).toBeUndefined();

    const s2 = applyAction(inPhase(s1, ACTION_PHASE, "b"), { type: "END_TURN", playerId: "b" });
    expect(wagons(s2).stock[city]).toEqual([good, good]);
    const { state: s3, events: e3 } = applyActionWithEvents(inPhase(s2, ACTION_PHASE, "c"), { type: "END_TURN", playerId: "c" });
    expect(wagons(s3).stock[city]).toHaveLength(CITY_STOCK_CAP);
    expect(e3.some((e) => e.kind === "goodsStocked" && e.stocked.some((g) => g.vertex === city))).toBe(false);
    // A newly built city gets its demand token straight away.
    const richer = give(mut(s3, (x) => void (x.currentPlayer = 0)), "a", { grain: 2, ore: 3 });
    const upgrade = getPlayer(richer, "a").settlements[0]!;
    const built = applyAction(inPhase(richer, ACTION_PHASE, "a"), { type: "BUILD_CITY", playerId: "a", vertex: upgrade });
    expect(wagons(built).demand[upgrade]).toBe(WAGON_GOODS[createRng(s.seed, `demand:${upgrade}`).int(4)]);
    expect(wagons(built).stock[upgrade]).toEqual([]);
  });

  it("docs/phase10.md §7 legalActions lists every one- and two-step wagon path along roads, plus a grain-paid step when affordable", () => {
    const { state: s, path } = roadTrip();
    const [v0, v1, v2, v3] = path as [VertexId, VertexId, VertexId, VertexId];
    const moves = movesOf(s, "a");
    expect(moves).toContainEqual({ type: "MOVE_WAGON", playerId: "a", path: [v0, v1] });
    expect(moves).toContainEqual({ type: "MOVE_WAGON", playerId: "a", path: [v0, v1, v2] });
    expect(moves).toContainEqual({ type: "MOVE_WAGON", playerId: "a", path: [v0, v1, v2, v3], grain: 1 });
    for (const m of moves) {
      expect(m.path[0]).toBe(v0);
      expect(new Set(m.path).size).toBe(m.path.length);
      expect(m.path.length).toBeLessThanOrEqual(4);
      for (const e of pathEdges(m.path)) expect(roadOwner(s, e)).not.toBeNull();
      expect(applyAction(s, m).wayfarers?.wagons?.wagons.a?.at).toBe(m.path[m.path.length - 1]);
    }
    const noGrain = mut(s, (x) => void (getPlayer(x, "a").hand.grain = 0));
    expect(movesOf(noGrain, "a").every((m) => m.path.length <= 3 && m.grain === undefined)).toBe(true);
    const spent = mut(s, (x) => void (wagons(x).wagons.a!.stepsUsed = 2));
    expect(movesOf(spent, "a").every((m) => m.path.length === 2 && m.grain === 1)).toBe(true);
    expect(movesOf(noGrain, "b")).toEqual([]);
    expect(movesOf(inPhase(s, { kind: "roll" }), "a")).toEqual([]);
  });

  it("docs/phase10.md §7 random play with wagons ends with goods, cards and victory points consistent", () => {
    const scenario = wagonScenario();
    const check = (state: GameState): void => {
      const w = wagons(state);
      const inHands = state.players.reduce((n, p) => n + handSize(p.hand), 0);
      expect(inHands + handSize(state.bank)).toBe(RESOURCES.length * 19);
      for (const [v, goods] of Object.entries(w.stock)) {
        expect(goods.length).toBeLessThanOrEqual(CITY_STOCK_CAP);
        if (goods.length > 0) expect(buildingAt(state, v)?.kind).toBe("city");
      }
      for (const p of state.players) {
        const wagon = w.wagons[p.id];
        if (state.phase.kind !== "setup") expect(wagon).toBeDefined();
        if (wagon) {
          expect(GEOMETRY.vertices).toContain(wagon.at);
          expect(wagon.cargo.length).toBeLessThanOrEqual(WAGON_CAPACITY);
          expect(wagon.stepsUsed).toBeGreaterThanOrEqual(0);
        }
        expect(w.points[p.id]).toBeGreaterThanOrEqual(0);
        let expected = p.settlements.length + 2 * p.cities.length + p.devCards.filter((d) => d.type === "victoryPoint").length + (w.points[p.id] ?? 0);
        if (state.longestRoad.playerId === p.id) expected += 2;
        if (state.largestArmy.playerId === p.id) expected += 2;
        expect(victoryPoints(state, p).total).toBe(expected);
      }
    };
    let delivered = 0;
    let moved = 0;
    for (let g = 0; g < 20; g++) {
      const played = playRandomGame(`wagons-${g}`, {
        scenario,
        onStep: (state, action) => {
          if (action.type === "DELIVER") delivered += 1;
          if (action.type === "MOVE_WAGON") moved += 1;
          check(state);
        },
      });
      expect(played.final.phase.kind).toBe("ended");
      expect(played.final.winner).not.toBeNull();
      expect(victoryPoints(played.final, getPlayer(played.final, played.final.winner as PlayerId)).total).toBeGreaterThanOrEqual(scenario.victoryPoints);
    }
    expect(moved).toBeGreaterThan(0);
    expect(delivered).toBeGreaterThan(0);
  }, 120_000);
});
