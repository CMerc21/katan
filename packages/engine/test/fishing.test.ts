import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { RESOURCES, boardGeometry } from "../src/board";
import type { BoardDefinition } from "../src/definition";
import { beginnerDefinition } from "../src/frames";
import { createGame } from "../src/game";
import { edgeVerticesOf, type EdgeId, type HexId, type VertexId } from "../src/geometry";
import { legalActions, legalRoadEdges } from "../src/legal";
import { FISH_BAG, FISH_BAG_TOTAL } from "../src/modules/wayfarers/fishing";
import type { FishOption, FishingState } from "../src/modules/types";
import { createRng } from "../src/rng";
import type { Scenario } from "../src/scenario";
import { getPlayer, hand, handSize, victoryPoints } from "../src/state";
import type { Action, GameState, PlayerId, SpendFishAction } from "../src/types";
import { coastalEdges } from "../src/validation";
import { ACTION_PHASE, FOUR, expectRule, give, inPhase, mut, pathEdges, place, playRandomGame, vertexPath, withNextRoll } from "./helpers";

// ---------------------------------------------------------------------------
// A fishing board: the beginner layout with a lake in the centre and two
// fishing grounds on the coast (tokens 5 and 9).

const GROUND_TOKENS = [5, 9] as const;

function fishingBoard(): BoardDefinition {
  const base = beginnerDefinition();
  const hexes = base.hexes.map((h) => (h.terrain === "wasteland" ? { at: h.at, kind: h.kind, terrain: "lake" as const } : h));
  const coast = coastalEdges(base);
  const grounds = GROUND_TOKENS.map((token, i) => ({ edge: coast[i * 5] as EdgeId, kind: "fishingGround" as const, token }));
  return { ...base, name: "Fishing test", hexes, edges: grounds };
}

function fishingScenario(fishing = true): Scenario {
  return { id: "fishing-test", name: "Fishing test", board: fishingBoard(), modules: {}, variants: { fishing }, victoryPoints: 10 };
}

function newFishingGame(seed = "fish", fishing = true): GameState {
  return createGame({ seed, players: FOUR, scenario: fishingScenario(fishing) });
}

function fishing(state: GameState): FishingState {
  const f = state.wayfarers?.fishing;
  if (!f) throw new Error("fishing is off");
  return f;
}

function lakeHex(state: GameState): HexId {
  const hex = Object.keys(state.board.hexes).find((h) => state.board.hexes[h]?.terrain === "lake");
  if (!hex) throw new Error("no lake");
  return hex;
}

function groundEdge(state: GameState, token: number): EdgeId {
  const g = state.board.fishingGrounds.find((x) => x.token === token);
  if (!g) throw new Error(`no fishing ground ${token}`);
  return g.edge;
}

/** A producing land hex that is not the lake (somewhere to park the robber). */
function someLandHex(state: GameState): HexId {
  const hex = Object.keys(state.board.hexes).find((h) => state.board.hexes[h]?.terrain !== "lake");
  if (!hex) throw new Error("no land");
  return hex;
}

/** In the action phase with `id` current, the robber off the lake, and a fish purse of `fish`. */
function readyToSpend(state: GameState, id: PlayerId, fish: number): GameState {
  return mut(inPhase(state, ACTION_PHASE, id), (s) => {
    s.robberHex = someLandHex(s);
    fishing(s).fish[id] = fish;
  });
}

function spend(state: GameState, action: Omit<SpendFishAction, "type">): GameState {
  return applyAction(state, { type: "SPEND_FISH", ...action });
}

function fishActions(state: GameState, id: PlayerId, option?: FishOption): SpendFishAction[] {
  return legalActions(state, id).filter((a): a is SpendFishAction => a.type === "SPEND_FISH" && (option === undefined || a.option === option));
}

/** Independent VP recount: buildings, special cards, VP cards and the boot. */
function recount(state: GameState, id: PlayerId): number {
  const p = getPlayer(state, id);
  let vp = p.settlements.length + 2 * p.cities.length + p.devCards.filter((c) => c.type === "victoryPoint").length;
  if (state.longestRoad.playerId === id) vp += 2;
  if (state.largestArmy.playerId === id) vp += 2;
  if (state.wayfarers?.fishing?.boot === id) vp -= 1;
  return vp;
}

describe("docs/phase10.md §2 Fishing", () => {
  it("docs/phase10.md §2 the variant is off by default: no wayfarers state, SPEND_FISH and the boot are refused", () => {
    const off = newFishingGame("fish", false);
    expect(off.wayfarers).toBeNull();
    expect(off.scenario?.variants.fishing).toBe(false);
    expect(off.board.fishingGrounds).toHaveLength(2);
    const base = createGame({ seed: "fish", players: FOUR, board: "beginner" });
    expect(base.wayfarers).toBeNull();
    const s = inPhase(off, ACTION_PHASE, "a");
    expectRule(() => spend(s, { playerId: "a", option: "bankResource", resource: "wood" }), "MODULE_OFF");
    expectRule(() => applyAction(give(s, "a", { wood: 1 }), { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ clay: 1 }), boot: true }), "NO_BOOT");
  });

  it("docs/phase10.md §2 the board carries the lake and the grounds; the robber starts on the lake when there is no wasteland", () => {
    const state = newFishingGame();
    const lake = lakeHex(state);
    expect(state.board.hexes[lake]?.token).toBeNull();
    expect(state.robberHex).toBe(lake);
    expect(state.board.fishingGrounds.map((g) => g.token).sort()).toEqual([5, 9]);
    const coast = new Set(coastalEdges(fishingBoard()));
    for (const g of state.board.fishingGrounds) expect(coast.has(g.edge)).toBe(true);
  });

  it("docs/phase10.md §2 the bag holds 11×1, 10×2, 8×3 and the boot, shuffled by the seed; every player starts with no fish", () => {
    const state = newFishingGame("bag-seed");
    const f = fishing(state);
    expect(f.boot).toBeNull();
    expect(f.spent).toBe(0);
    for (const p of state.players) expect(f.fish[p.id]).toBe(0);
    expect(f.bag).toHaveLength(30);
    const count = (v: number) => f.bag.filter((x) => x === v).length;
    expect(count(1)).toBe(11);
    expect(count(2)).toBe(10);
    expect(count(3)).toBe(8);
    expect(count(0)).toBe(1);
    expect(f.bag.reduce((n, x) => n + x, 0)).toBe(FISH_BAG_TOTAL);
    expect(f.bag).toEqual(createRng("bag-seed", "fishing:bag").shuffle(FISH_BAG));
    expect(fishing(newFishingGame("bag-seed")).bag).toEqual(f.bag);
    expect(fishing(newFishingGame("other-seed")).bag).not.toEqual(f.bag);
  });

  it("docs/phase10.md §2 a fishing ground draws on its token: a settlement 1 token, a city 2, in seat order from the current player", () => {
    const start = newFishingGame();
    const edge = groundEdge(start, 5);
    const [v1, v2] = edgeVerticesOf(edge);
    // Bo (seat 1) has a city on one end, Ada (seat 0) a settlement on the other; Cy is current so Cy, Di, Ada, Bo is the seat order.
    let state = place(start, "a", { settlements: [v1] });
    state = place(state, "b", { cities: [v2] });
    state = withNextRoll(inPhase(state, { kind: "roll" }, "c"), 5);
    const bag = [...fishing(state).bag];
    const { state: next, events } = applyActionWithEvents(state, { type: "ROLL", playerId: "c" });
    const drawn = events.filter((e) => e.kind === "fishDrawn");
    expect(drawn.map((e) => (e.kind === "fishDrawn" ? e.playerId : ""))).toEqual(["a", "b", "b"]);
    for (const e of drawn) if (e.kind === "fishDrawn") expect(e.source).toBe(edge);
    const f = fishing(next);
    expect(f.bag).toEqual(bag.slice(3));
    const value = (i: number) => bag[i] as number;
    const bootAt = bag.slice(0, 3).indexOf(0);
    expect(f.fish.a).toBe(value(0));
    expect(f.fish.b).toBe(value(1) + value(2));
    expect(f.boot).toBe(bootAt < 0 ? null : (["a", "b", "b"][bootAt] as PlayerId));
    expect(f.fish.c).toBe(0);
    expect(f.fish.d).toBe(0);
    expect(next.phase.kind).toBe("action");
    // A different total draws nothing from this ground.
    const s2 = withNextRoll(inPhase(state, { kind: "roll" }, "c"), 6);
    const r2 = applyActionWithEvents(s2, { type: "ROLL", playerId: "c" });
    expect(r2.events.some((e) => e.kind === "fishDrawn")).toBe(false);
    expect(fishing(r2.state).bag).toEqual(bag);
  });

  it("docs/phase10.md §2 the lake draws on 2, 3, 11 and 12 for every adjacent building; the robber on the lake blocks it", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const corners = boardGeometry(start.board).hexVertices[lake] as readonly VertexId[];
    let state = place(start, "a", { settlements: [corners[0] as VertexId] });
    state = place(state, "b", { cities: [corners[2] as VertexId] });
    for (const total of [2, 3, 11, 12]) {
      const s = withNextRoll(mut(inPhase(state, { kind: "roll" }, "a"), (x) => void (x.robberHex = someLandHex(x))), total);
      const bag = [...fishing(s).bag];
      const { state: next, events } = applyActionWithEvents(s, { type: "ROLL", playerId: "a" });
      const drawn = events.filter((e) => e.kind === "fishDrawn");
      expect(drawn.map((e) => (e.kind === "fishDrawn" ? e.playerId : ""))).toEqual(["a", "b", "b"]);
      for (const e of drawn) if (e.kind === "fishDrawn") expect(e.source).toBe(lake);
      expect(fishing(next).bag).toEqual(bag.slice(3));
      const f = fishing(next);
      expect((f.fish.a ?? 0) + (f.fish.b ?? 0)).toBe(bag.slice(0, 3).reduce((n, x) => n + x, 0));
    }
    // 4 is not a lake number.
    const s4 = withNextRoll(mut(inPhase(state, { kind: "roll" }, "a"), (x) => void (x.robberHex = someLandHex(x))), 4);
    expect(applyActionWithEvents(s4, { type: "ROLL", playerId: "a" }).events.some((e) => e.kind === "fishDrawn")).toBe(false);
    // The robber on the lake blocks the lake (it starts there).
    const blocked = withNextRoll(inPhase(state, { kind: "roll" }, "a"), 11);
    expect(blocked.robberHex).toBe(lake);
    const r = applyActionWithEvents(blocked, { type: "ROLL", playerId: "a" });
    expect(r.events.some((e) => e.kind === "fishDrawn")).toBe(false);
    expect(fishing(r.state).bag).toEqual(fishing(blocked).bag);
  });

  it("docs/phase10.md §2 drawing the boot marks its holder; an empty bag draws nothing", () => {
    const start = newFishingGame();
    const edge = groundEdge(start, 9);
    const [v1] = edgeVerticesOf(edge);
    let state = place(start, "a", { settlements: [v1] });
    state = withNextRoll(inPhase(state, { kind: "roll" }, "a"), 9);
    // Put the boot on top.
    const withBoot = mut(state, (s) => void (fishing(s).bag = [0, 3, 2]));
    const { state: next, events } = applyActionWithEvents(withBoot, { type: "ROLL", playerId: "a" });
    const drawn = events.find((e) => e.kind === "fishDrawn");
    expect(drawn).toEqual(expect.objectContaining({ playerId: "a", fish: 0, boot: true, source: edge }));
    expect(fishing(next).boot).toBe("a");
    expect(fishing(next).fish.a).toBe(0);
    expect(fishing(next).bag).toEqual([3, 2]);
    expect(next.log.at(-1)?.text).toBe("Ada hauled up the old boot");
    // Empty bag: nothing drawn, no event, no refill.
    const empty = mut(state, (s) => void (fishing(s).bag = []));
    const r = applyActionWithEvents(empty, { type: "ROLL", playerId: "a" });
    expect(r.events.some((e) => e.kind === "fishDrawn")).toBe(false);
    expect(fishing(r.state).bag).toEqual([]);
    expect(fishing(r.state).fish.a).toBe(0);
  });

  it("docs/phase10.md §2 fish are spent only by the current player in the action phase, and only with enough fish", () => {
    const state = readyToSpend(newFishingGame(), "a", 1);
    expectRule(() => spend(state, { playerId: "a", option: "bankResource", resource: "wood" }), "NO_FISH");
    expectRule(() => spend(state, { playerId: "b", option: "bankResource", resource: "wood" }), "NOT_YOUR_TURN");
    const rich = mut(state, (s) => void (fishing(s).fish.a = 20));
    expectRule(() => spend(inPhase(rich, { kind: "roll" }), { playerId: "a", option: "bankResource", resource: "wood" }), "WRONG_PHASE");
    expectRule(() => spend(rich, { playerId: "a", option: "gold" as never, resource: "wood" }), "INVALID_CHOICE");
    expect(fishActions(state, "a")).toHaveLength(0);
    expect(fishActions(inPhase(rich, { kind: "roll" }), "a")).toHaveLength(0);
    expect(fishActions(rich, "b")).toHaveLength(0);
    // Any number of spends per turn.
    const twice = spend(spend(rich, { playerId: "a", option: "bankResource", resource: "wood" }), { playerId: "a", option: "bankResource", resource: "ore" });
    expect(fishing(twice).fish.a).toBe(12);
    expect(fishing(twice).spent).toBe(8);
    expect(getPlayer(twice, "a").hand).toEqual(hand({ wood: 1, ore: 1 }));
  });

  it("docs/phase10.md §2 2 fish move the robber to a hex that produces nothing, with no steal", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const corners = boardGeometry(start.board).hexVertices[lake] as readonly VertexId[];
    let state = place(start, "b", { settlements: [corners[0] as VertexId] });
    state = give(readyToSpend(state, "a", 2), "b", { wood: 3 });
    const from = state.robberHex;
    const legal = fishActions(state, "a");
    expect(legal).toEqual([{ type: "SPEND_FISH", playerId: "a", option: "moveRobber", hex: lake }]);
    const { state: next, events } = applyActionWithEvents(state, { type: "SPEND_FISH", playerId: "a", option: "moveRobber", hex: lake });
    expect(next.robberHex).toBe(lake);
    expect(next.phase).toEqual(ACTION_PHASE);
    expect(fishing(next).fish.a).toBe(0);
    expect(events.map((e) => e.kind)).toEqual(["fishSpent", "robberMoved"]);
    expect(events[0]).toEqual(expect.objectContaining({ playerId: "a", fish: 2, option: "moveRobber" }));
    expect(events[1]).toEqual(expect.objectContaining({ from, to: lake, by: "a" }));
    expect(handSize(getPlayer(next, "b").hand)).toBe(3);
    // A producing hex, or the robber's own hex, is refused; when the robber already sits on the only lake the option is gone.
    expectRule(() => spend(state, { playerId: "a", option: "moveRobber", hex: from }), "INVALID_HEX");
    expectRule(() => spend(state, { playerId: "a", option: "moveRobber", hex: "9,9" }), "INVALID_HEX");
    const onLake = mut(state, (s) => void (s.robberHex = lake));
    expectRule(() => spend(onLake, { playerId: "a", option: "moveRobber", hex: lake }), "ROBBER_MUST_MOVE");
    expect(fishActions(onLake, "a").filter((a) => a.option === "moveRobber")).toHaveLength(0);
  });

  it("docs/phase10.md §2 3 fish steal a random card from any player holding one", () => {
    let state = readyToSpend(newFishingGame(), "a", 3);
    state = give(state, "c", { grain: 2 });
    expect(fishActions(state, "a", "steal")).toEqual([{ type: "SPEND_FISH", playerId: "a", option: "steal", targetPlayerId: "c" }]);
    const { state: next, events } = applyActionWithEvents(state, { type: "SPEND_FISH", playerId: "a", option: "steal", targetPlayerId: "c" });
    expect(events.map((e) => e.kind)).toEqual(["fishSpent", "stole"]);
    expect(getPlayer(next, "a").hand.grain).toBe(1);
    expect(getPlayer(next, "c").hand.grain).toBe(1);
    expect(fishing(next).fish.a).toBe(0);
    expectRule(() => spend(state, { playerId: "a", option: "steal", targetPlayerId: "b" }), "INVALID_STEAL_TARGET");
    expectRule(() => spend(state, { playerId: "a", option: "steal", targetPlayerId: "a" }), "INVALID_STEAL_TARGET");
    expectRule(() => spend(state, { playerId: "a", option: "steal", targetPlayerId: "zz" }), "INVALID_STEAL_TARGET");
    expectRule(() => spend(state, { playerId: "a", option: "steal" }), "INVALID_STEAL_TARGET");
  });

  it("docs/phase10.md §2 4 fish take a resource from the bank", () => {
    const state = readyToSpend(newFishingGame(), "a", 4);
    expect(fishActions(state, "a", "bankResource").map((a) => a.resource)).toEqual([...RESOURCES]);
    const { state: next, events } = applyActionWithEvents(state, { type: "SPEND_FISH", playerId: "a", option: "bankResource", resource: "ore" });
    expect(getPlayer(next, "a").hand.ore).toBe(1);
    expect(next.bank.ore).toBe(18);
    expect(fishing(next).fish.a).toBe(0);
    expect(events[1]).toEqual(expect.objectContaining({ kind: "resourcesTaken", playerId: "a", cards: hand({ ore: 1 }), reason: "fish" }));
    expect(next.log.at(-1)?.text).toBe("Ada took 1 ore from the bank");
    const noOre = mut(state, (s) => void (s.bank.ore = 0));
    expectRule(() => spend(noOre, { playerId: "a", option: "bankResource", resource: "ore" }), "BANK_EMPTY");
    expect(fishActions(noOre, "a", "bankResource").map((a) => a.resource)).not.toContain("ore");
    expectRule(() => spend(state, { playerId: "a", option: "bankResource", resource: "gold" as never }), "INVALID_CHOICE");
    expectRule(() => spend(state, { playerId: "a", option: "bankResource" }), "INVALID_CHOICE");
  });

  it("docs/phase10.md §2 5 fish build a road for free on a connected edge", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const v = (boardGeometry(start.board).hexVertices[lake] as readonly VertexId[])[0] as VertexId;
    let state = place(start, "a", { settlements: [v] });
    state = readyToSpend(state, "a", 5);
    const edges = legalRoadEdges(state, "a");
    expect(edges.length).toBeGreaterThan(0);
    expect(fishActions(state, "a", "freeRoad").map((a) => a.edge)).toEqual(edges);
    const edge = edges[0] as EdgeId;
    const { state: next, events } = applyActionWithEvents(state, { type: "SPEND_FISH", playerId: "a", option: "freeRoad", edge });
    const a = getPlayer(next, "a");
    expect(a.roads).toEqual([edge]);
    expect(a.pieces.roads).toBe(14);
    expect(handSize(a.hand)).toBe(0);
    expect(next.bank).toEqual(state.bank);
    expect(fishing(next).fish.a).toBe(0);
    expect(events.map((e) => e.kind)).toEqual(["fishSpent", "built"]);
    // Unconnected, occupied and off-board edges are refused; so is a player out of road pieces.
    const far = boardGeometry(state.board).edges.find((e) => !edges.includes(e)) as EdgeId;
    expectRule(() => spend(state, { playerId: "a", option: "freeRoad", edge: far }), "ROAD_NOT_CONNECTED");
    expectRule(() => spend(next, { playerId: "a", option: "freeRoad", edge }), "NO_FISH");
    expectRule(() => spend(mut(next, (s) => void (fishing(s).fish.a = 5)), { playerId: "a", option: "freeRoad", edge }), "EDGE_OCCUPIED");
    expectRule(() => spend(state, { playerId: "a", option: "freeRoad", edge: "nope" }), "INVALID_EDGE");
    expectRule(() => spend(state, { playerId: "a", option: "freeRoad" }), "INVALID_EDGE");
    const noRoads = mut(state, (s) => void (getPlayer(s, "a").pieces.roads = 0));
    expectRule(() => spend(noRoads, { playerId: "a", option: "freeRoad", edge }), "NO_PIECES_LEFT");
    expect(fishActions(noRoads, "a", "freeRoad")).toHaveLength(0);
    // Five free roads in a chain earn Longest Road like any others.
    let s = mut(state, (x) => void (fishing(x).fish.a = 25));
    for (const e of pathEdges(vertexPath(v, 5))) s = spend(s, { playerId: "a", option: "freeRoad", edge: e });
    expect(getPlayer(s, "a").roads).toHaveLength(5);
    expect(fishing(s).fish.a).toBe(0);
    expect(s.longestRoad.playerId).toBe("a");
  });

  it("docs/phase10.md §2 7 fish buy a development card for free, or upgrade a settlement when the deck is empty", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const v = (boardGeometry(start.board).hexVertices[lake] as readonly VertexId[])[0] as VertexId;
    let state = place(start, "a", { settlements: [v] });
    state = readyToSpend(state, "a", 7);
    expect(fishActions(state, "a", "freeDevCard")).toEqual([{ type: "SPEND_FISH", playerId: "a", option: "freeDevCard" }]);
    const top = state.devDeck[0];
    const { state: next, events } = applyActionWithEvents(state, { type: "SPEND_FISH", playerId: "a", option: "freeDevCard" });
    expect(getPlayer(next, "a").devCards).toEqual([{ type: top, boughtOnTurn: state.turn }]);
    expect(next.devDeck).toHaveLength(24);
    expect(handSize(getPlayer(next, "a").hand)).toBe(0);
    expect(fishing(next).fish.a).toBe(0);
    expect(events.map((e) => e.kind)).toEqual(["fishSpent", "devCardBought"]);
    // Empty deck: a free city instead.
    const empty = mut(state, (s) => void (s.devDeck = []));
    expect(fishActions(empty, "a", "freeDevCard")).toEqual([{ type: "SPEND_FISH", playerId: "a", option: "freeDevCard", vertex: v }]);
    const { state: city, events: cityEvents } = applyActionWithEvents(empty, { type: "SPEND_FISH", playerId: "a", option: "freeDevCard", vertex: v });
    expect(getPlayer(city, "a").cities).toEqual([v]);
    expect(getPlayer(city, "a").settlements).toEqual([]);
    expect(getPlayer(city, "a").pieces).toEqual(expect.objectContaining({ cities: 3, settlements: 5 }));
    expect(cityEvents.map((e) => e.kind)).toEqual(["fishSpent", "built"]);
    expect(fishing(city).fish.a).toBe(0);
    expectRule(() => spend(empty, { playerId: "a", option: "freeDevCard" }), "INVALID_CHOICE");
    expectRule(() => spend(empty, { playerId: "a", option: "freeDevCard", vertex: "nope" }), "NOT_YOUR_SETTLEMENT");
    const noCities = mut(empty, (s) => void (getPlayer(s, "a").pieces.cities = 0));
    expectRule(() => spend(noCities, { playerId: "a", option: "freeDevCard", vertex: v }), "NO_PIECES_LEFT");
    expect(fishActions(noCities, "a", "freeDevCard")).toHaveLength(0);
  });

  it("docs/phase10.md §2 legalActions lists every affordable option and nothing more", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const v = (boardGeometry(start.board).hexVertices[lake] as readonly VertexId[])[0] as VertexId;
    let state = place(start, "a", { settlements: [v] });
    state = give(readyToSpend(state, "a", 6), "b", { wool: 1 });
    const options = new Set(fishActions(state, "a").map((a) => a.option));
    expect(options).toEqual(new Set(["moveRobber", "steal", "bankResource", "freeRoad"]));
    const four = mut(state, (s) => void (fishing(s).fish.a = 4));
    expect(new Set(fishActions(four, "a").map((a) => a.option))).toEqual(new Set(["moveRobber", "steal", "bankResource"]));
    for (const action of fishActions(state, "a")) expect(() => applyAction(state, action)).not.toThrow();
  });

  it("docs/phase10.md §2 the old boot is worth -1 VP while held and shows in the public score", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const v = (boardGeometry(start.board).hexVertices[lake] as readonly VertexId[])[0] as VertexId;
    const state = place(start, "a", { settlements: [v] });
    expect(victoryPoints(state, getPlayer(state, "a")).total).toBe(1);
    const booted = mut(state, (s) => void (fishing(s).boot = "a"));
    const vp = victoryPoints(booted, getPlayer(booted, "a"));
    expect(vp).toEqual({ publicVP: 0, hiddenVP: 0, total: 0 });
    expect(victoryPoints(booted, getPlayer(booted, "b")).total).toBe(0);
  });

  it("docs/phase10.md §2 the boot rides along with the holder's offer to a player with at least as many points", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const corners = boardGeometry(start.board).hexVertices[lake] as readonly VertexId[];
    let state = place(start, "a", { settlements: [corners[0] as VertexId] });
    state = place(state, "b", { settlements: [corners[2] as VertexId] });
    state = place(state, "c", { settlements: [corners[4] as VertexId] });
    state = mut(inPhase(state, ACTION_PHASE, "a"), (s) => void (fishing(s).boot = "a"));
    state = give(give(state, "a", { wood: 1 }), "b", { clay: 1 });
    state = give(state, "c", { clay: 1 });
    const offer: Action = { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ clay: 1 }), boot: true };
    expect(legalActions(state, "a")).toContainEqual(offer);
    const pending = applyAction(state, offer);
    expect(pending.pendingTrade?.boot).toBe(true);
    expect(legalActions(pending, "b")).toContainEqual({ type: "ACCEPT_TRADE", playerId: "b" });
    const { state: done, events } = applyActionWithEvents(pending, { type: "ACCEPT_TRADE", playerId: "b" });
    expect(fishing(done).boot).toBe("b");
    expect(events.map((e) => e.kind)).toEqual(["tradeAccepted", "bootPassed"]);
    expect(events[1]).toEqual(expect.objectContaining({ from: "a", to: "b" }));
    expect(done.log.at(-1)?.text).toBe("Ada passed the old boot to Bo");
    expect(getPlayer(done, "a").hand).toEqual(hand({ clay: 1 }));
    expect(getPlayer(done, "b").hand).toEqual(hand({ wood: 1 }));
    expect(victoryPoints(done, getPlayer(done, "a")).total).toBe(1);
    expect(victoryPoints(done, getPlayer(done, "b")).total).toBe(0);
    // Not the holder: refused at offer time. A receiver with fewer points: refused at accept time.
    expectRule(() => applyAction(mut(state, (s) => void (fishing(s).boot = "c")), offer), "NO_BOOT");
    expect(legalActions(mut(state, (s) => void (fishing(s).boot = null)), "a")).not.toContainEqual(offer);
    const poorer = mut(pending, (s) => void getPlayer(s, "b").settlements.pop());
    expectRule(() => applyAction(poorer, { type: "ACCEPT_TRADE", playerId: "b" }), "BOOT_NOT_ALLOWED");
    // Nobody eligible: the boot offer is not suggested.
    const richest = place(state, "a", { settlements: [corners[3] as VertexId] });
    expect(legalActions(richest, "a").some((a) => a.type === "OFFER_TRADE" && a.boot === true)).toBe(false);
  });

  it("docs/phase10.md §2 the boot rides along with the holder's acceptance to an offerer with at least as many points", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const corners = boardGeometry(start.board).hexVertices[lake] as readonly VertexId[];
    let state = place(start, "a", { settlements: [corners[0] as VertexId] });
    state = place(state, "b", { settlements: [corners[2] as VertexId] });
    state = mut(inPhase(state, ACTION_PHASE, "a"), (s) => void (fishing(s).boot = "b"));
    state = give(give(state, "a", { wood: 1 }), "b", { clay: 1 });
    const pending = applyAction(state, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ clay: 1 }) });
    expect(pending.pendingTrade?.boot).toBeUndefined();
    const legal = legalActions(pending, "b");
    expect(legal).toContainEqual({ type: "ACCEPT_TRADE", playerId: "b" });
    expect(legal).toContainEqual({ type: "ACCEPT_TRADE", playerId: "b", boot: true });
    const { state: done, events } = applyActionWithEvents(pending, { type: "ACCEPT_TRADE", playerId: "b", boot: true });
    expect(fishing(done).boot).toBe("a");
    expect(events.map((e) => e.kind)).toEqual(["tradeAccepted", "bootPassed"]);
    expect(events[1]).toEqual(expect.objectContaining({ from: "b", to: "a" }));
    // Plain acceptance keeps the boot.
    expect(fishing(applyAction(pending, { type: "ACCEPT_TRADE", playerId: "b" })).boot).toBe("b");
    // Not the holder, or the offerer has fewer points: refused, and not suggested.
    expectRule(() => applyAction(mut(pending, (s) => void (fishing(s).boot = "c")), { type: "ACCEPT_TRADE", playerId: "b", boot: true }), "NO_BOOT");
    expect(legalActions(mut(pending, (s) => void (fishing(s).boot = "c")), "b")).not.toContainEqual({ type: "ACCEPT_TRADE", playerId: "b", boot: true });
    const poorer = mut(pending, (s) => void getPlayer(s, "a").settlements.pop());
    expectRule(() => applyAction(poorer, { type: "ACCEPT_TRADE", playerId: "b", boot: true }), "BOOT_NOT_ALLOWED");
    expect(legalActions(poorer, "b")).not.toContainEqual({ type: "ACCEPT_TRADE", playerId: "b", boot: true });
    expect(legalActions(poorer, "b")).toContainEqual({ type: "ACCEPT_TRADE", playerId: "b" });
  });

  it("docs/phase10.md §2 the win check counts the boot: ten points with the boot is nine, passing it wins", () => {
    const start = newFishingGame();
    const lake = lakeHex(start);
    const corners = boardGeometry(start.board).hexVertices[lake] as readonly VertexId[];
    const geo = boardGeometry(start.board);
    // Ada: four cities on the far corners plus two settlements = 10 VP.
    const spots = geo.vertices.filter((v) => !(geo.vertexNeighbors[v] ?? []).some((n) => corners.includes(n)) && !corners.includes(v));
    const mine: VertexId[] = [];
    for (const v of spots) {
      if (mine.some((m) => m === v || (geo.vertexNeighbors[m] ?? []).includes(v))) continue;
      mine.push(v);
      if (mine.length === 6) break;
    }
    let state = place(start, "a", { cities: mine.slice(0, 4), settlements: mine.slice(4) });
    state = place(state, "b", { cities: [corners[0] as VertexId, corners[2] as VertexId, corners[4] as VertexId], settlements: [] });
    state = mut(inPhase(state, ACTION_PHASE, "a"), (s) => void (fishing(s).boot = "a"));
    state = give(give(state, "a", { wood: 1 }), "b", { clay: 1 });
    expect(victoryPoints(state, getPlayer(state, "a")).total).toBe(9);
    // No win yet, even after an action.
    const still = applyAction(state, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ clay: 1 }) });
    expect(still.phase.kind).toBe("action");
    expect(still.winner).toBeNull();
    const cancelled = applyAction(still, { type: "CANCEL_TRADE", playerId: "a" });
    // Pass the boot to Bo (6 VP < Ada's 10): refused. Give Bo more points first.
    const pending = applyAction(cancelled, { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ clay: 1 }), boot: true });
    expectRule(() => applyAction(pending, { type: "ACCEPT_TRADE", playerId: "b" }), "BOOT_NOT_ALLOWED");
    const bRich = mut(pending, (s) => {
      const b = getPlayer(s, "b");
      b.devCards.push({ type: "victoryPoint", boughtOnTurn: 0 }, { type: "victoryPoint", boughtOnTurn: 0 }, { type: "victoryPoint", boughtOnTurn: 0 }, { type: "victoryPoint", boughtOnTurn: 0 });
    });
    expect(victoryPoints(bRich, getPlayer(bRich, "b")).total).toBe(10);
    const won = applyAction(bRich, { type: "ACCEPT_TRADE", playerId: "b" });
    expect(fishing(won).boot).toBe("b");
    expect(won.phase.kind).toBe("ended");
    expect(won.winner).toBe("a");
  });

  it("docs/phase10.md §2 random play: 20 games end with fish, resources and points conserved", () => {
    const scenario = fishingScenario();
    let spends = 0;
    let passes = 0;
    let drawn = 0;
    for (let n = 0; n < 20; n++) {
      const seed = `fishing-${n}`;
      const game = playRandomGame(seed, {
        scenario,
        onStep: (state, action) => {
          const f = fishing(state);
          // Resources: bank + hands = 95.
          let cards = 0;
          for (const r of RESOURCES) {
            cards += state.bank[r];
            for (const p of state.players) cards += p.hand[r];
          }
          expect(cards).toBe(95);
          // Fish: bag values + purses + spent = 55; the boot is in the bag or held by exactly one player; nothing negative.
          const inBag = f.bag.reduce((s, x) => s + x, 0);
          const held = state.players.reduce((s, p) => s + (f.fish[p.id] ?? 0), 0);
          expect(inBag + held + f.spent).toBe(FISH_BAG_TOTAL);
          expect(f.spent).toBeGreaterThanOrEqual(0);
          for (const p of state.players) expect(f.fish[p.id]).toBeGreaterThanOrEqual(0);
          const bootInBag = f.bag.filter((x) => x === 0).length;
          expect(bootInBag + (f.boot === null ? 0 : 1)).toBe(1);
          if (f.boot !== null) expect(state.players.some((p) => p.id === f.boot)).toBe(true);
          expect(f.bag.every((x) => x >= 0 && x <= 3)).toBe(true);
          // Points: the engine's total matches an independent recount.
          for (const p of state.players) expect(victoryPoints(state, p).total).toBe(recount(state, p.id));
          if (action.type === "SPEND_FISH") spends += 1;
          if (state.log.at(-1)?.text.includes("passed the old boot")) passes += 1;
        },
      });
      expect(game.final.phase.kind).toBe("ended");
      expect(game.final.winner).not.toBeNull();
      const winner = getPlayer(game.final, game.final.winner as PlayerId);
      expect(victoryPoints(game.final, winner).total).toBeGreaterThanOrEqual(10);
      expect(victoryPoints(game.final, winner).total).toBe(recount(game.final, winner.id));
      drawn += 30 - fishing(game.final).bag.length;
    }
    expect(drawn).toBeGreaterThan(0);
    expect(spends).toBeGreaterThan(0);
    expect(passes).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("docs/phase10.md §2 the same seed replays to the same fish", () => {
    const scenario = fishingScenario();
    const g1 = playRandomGame("fish-replay", { scenario, maxTurns: 60 });
    const g2 = playRandomGame("fish-replay", { scenario, maxTurns: 60 });
    expect(g2.final).toEqual(g1.final);
    expect(fishing(g1.final).bag).toEqual(fishing(g2.final).bag);
  });
});
