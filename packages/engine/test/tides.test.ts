import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { boardGeometry, RESOURCES } from "../src/board";
import { createGame } from "../src/game";
import { hexCorner, type EdgeId, type HexId, type VertexId } from "../src/geometry";
import {
  goldChoices,
  isOpenEndShip,
  isSeaEdge,
  legalActions,
  legalSetupSettlementVertices,
  legalSetupShipEdges,
  legalShipEdges,
  legalShipMoves,
  movableShips,
  pirateStealTargets,
} from "../src/legal";
import { redact, viewToState } from "../src/redact";
import { isScenario, scenarioRules, validateScenario } from "../src/scenario";
import { BUILT_IN_SCENARIO_IDS, builtInScenario } from "../src/scenarios";
import { longestRoadLength } from "../src/specialCards";
import { getPlayer, handSize, hand, nextActor, victoryPoints } from "../src/state";
import type { GameState, PlayerId } from "../src/types";
import { hasErrors } from "../src/validation";
import { ACTION_PHASE, FOUR, expectRule, finishSetup, give, inPhase, mut, playRandomGame, withNextRoll } from "./helpers";

function scenarioGame(id: "acrossTheStrait" | "archipelago" | "goldCoast", seed = "tides"): GameState {
  return createGame({ seed, players: FOUR, scenario: builtInScenario(id) });
}

/** A coastal land vertex (touches a sea edge) with no building on or beside it. */
function freeCoastalVertex(state: GameState, avoid: readonly VertexId[] = []): VertexId {
  const geo = boardGeometry(state.board);
  const v = legalSetupSettlementVertices(state).find((x) => !avoid.includes(x) && (geo.vertexEdges[x] ?? []).some((e) => isSeaEdge(state, e, geo)));
  if (!v) throw new Error("no free coastal vertex");
  return v;
}

function seaEdgesAt(state: GameState, v: VertexId): EdgeId[] {
  const geo = boardGeometry(state.board);
  return (geo.vertexEdges[v] ?? []).filter((e) => isSeaEdge(state, e, geo));
}

function other(state: GameState, e: EdgeId, v: VertexId): VertexId {
  const [a, b] = boardGeometry(state.board).edgeVertices[e] as [VertexId, VertexId];
  return a === v ? b : a;
}

/** Put player `id` in the action phase with a settlement on a free coastal vertex and a full hand. */
function coastalStart(state: GameState, id: PlayerId): { state: GameState; at: VertexId } {
  const at = freeCoastalVertex(state);
  const next = mut(inPhase(state, ACTION_PHASE, id), (s) => {
    const p = getPlayer(s, id);
    p.settlements.push(at);
    p.pieces.settlements -= 1;
  });
  return { state: give(next, id, { wood: 6, wool: 6, clay: 6, grain: 6, ore: 6 }), at };
}

describe("docs/rules.md §14 Tides", () => {
  it("§14.1 scenarios load: built-ins validate, the guard rejects junk, and a base game has no scenario", () => {
    for (const id of BUILT_IN_SCENARIO_IDS) {
      const s = builtInScenario(id);
      expect(isScenario(s)).toBe(true);
      expect(hasErrors(validateScenario(s))).toBe(false);
      const game = createGame({ seed: "x", players: FOUR, scenario: s });
      expect(game.scenario).toEqual(scenarioRules(s));
      expect(game.board.seaPlayable).toBe(true);
      expect(game.board.islands.length).toBeGreaterThan(0);
      expect(game.boardKind).toBe("custom");
    }
    expect(isScenario({ id: "x", name: "y", board: {} , modules: {}, victoryPoints: 10 })).toBe(false);
    expectRule(() => createGame({ seed: "x", players: FOUR, scenario: { ...builtInScenario("goldCoast"), victoryPoints: 99 } }), "INVALID_SCENARIO");
    const base = createGame({ seed: "x", players: FOUR, board: "beginner" });
    expect(base.scenario).toBeNull();
    expect(base.pirateHex).toBeNull();
    expect(base.board.seaPlayable).toBe(false);
    expect(base.board.islands).toHaveLength(1);
  });

  it("§14.1 islands are the land components; Archipelago has five and the pirate starts on the sea (or not at all)", () => {
    const arch = scenarioGame("archipelago");
    expect(arch.board.islands).toHaveLength(5);
    expect(arch.board.islands.flatMap((i) => i.hexes).sort()).toEqual(Object.keys(arch.board.hexes).sort());
    expect(arch.pirateHex).toBeNull(); // pirate: false
    const strait = scenarioGame("acrossTheStrait");
    expect(strait.board.islands).toHaveLength(2);
    expect(strait.pirateHex).not.toBeNull();
    expect(strait.board.sea).toContain(strait.pirateHex);
    const gold = scenarioGame("goldCoast");
    expect(Object.values(gold.board.hexes).filter((h) => h.terrain === "gold")).toHaveLength(2);
    expect(Object.values(gold.board.hexes).filter((h) => h.terrain === "gold").every((h) => h.token !== null)).toBe(true);
  });

  it("§14.6 Across the Strait restricts setup settlements to the main island", () => {
    const state = scenarioGame("acrossTheStrait");
    const main = state.board.islands.find((i) => i.id === 0)!;
    const geo = boardGeometry(state.board);
    const legal = legalSetupSettlementVertices(state);
    expect(legal.length).toBeGreaterThan(20);
    for (const v of legal) expect((geo.vertexHexes[v] ?? []).some((h) => main.hexes.includes(h))).toBe(true);
    const far = state.board.islands.find((i) => i.id === 1)!;
    const farVertex = geo.vertices.find((v) => (geo.vertexHexes[v] ?? []).every((h) => far.hexes.includes(h) || state.board.hexes[h] === undefined) && (geo.vertexHexes[v] ?? []).some((h) => far.hexes.includes(h)))!;
    expectRule(() => applyAction(state, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: farVertex }), "INVALID_VERTEX");
    // After setup every player's start islands are recorded.
    const done = finishSetup(state);
    for (const p of done.players) expect(p.startIslands).toEqual([0]);
  });

  it("§14.2 a ship costs wood + wool, sits on a sea edge, and connects to a building or ship but never to a road", () => {
    const { state, at } = coastalStart(scenarioGame("goldCoast"), "a");
    const legal = legalActions(state, "a");
    const ships = legal.filter((x) => x.type === "BUILD_SHIP");
    expect(ships.length).toBeGreaterThan(0);
    for (const s of ships) if (s.type === "BUILD_SHIP") expect(isSeaEdge(state, s.edge)).toBe(true);
    const e1 = seaEdgesAt(state, at)[0]!;
    const before = handSize(getPlayer(state, "a").hand);
    const { state: s1, events } = applyActionWithEvents(state, { type: "BUILD_SHIP", playerId: "a", edge: e1 });
    const a1 = getPlayer(s1, "a");
    expect(a1.ships).toEqual([e1]);
    expect(a1.pieces.ships).toBe(14);
    expect(handSize(a1.hand)).toBe(before - 2);
    expect(a1.hand.wood).toBe(5);
    expect(a1.hand.wool).toBe(5);
    expect(a1.shipsBuiltThisTurn).toEqual([e1]);
    expect(events.some((e) => e.kind === "shipBuilt")).toBe(true);
    expect(s1.log.at(-1)?.text).toBe("Ada built a ship");
    // Chain: a ship connected to the first ship's far end.
    const far = other(s1, e1, at);
    const e2 = seaEdgesAt(s1, far).find((e) => e !== e1)!;
    const s2 = applyAction(s1, { type: "BUILD_SHIP", playerId: "a", edge: e2 });
    expect(getPlayer(s2, "a").ships).toEqual([e1, e2]);
    // A road's far end is not a connection for a ship.
    const geo = boardGeometry(s2.board);
    const landEdge = (geo.vertexEdges[at] ?? []).find((e) => !isSeaEdge(s2, e, geo) && (geo.edgeHexes[e] ?? []).some((h) => s2.board.hexes[h] !== undefined))!;
    const s3 = applyAction(s2, { type: "BUILD_ROAD", playerId: "a", edge: landEdge });
    const roadEnd = other(s3, landEdge, at);
    const seaOffRoad = seaEdgesAt(s3, roadEnd).filter((e) => !getPlayer(s3, "a").ships.includes(e) && legalShipEdges(s3, "a").indexOf(e) < 0);
    for (const e of seaOffRoad) expectRule(() => applyAction(s3, { type: "BUILD_SHIP", playerId: "a", edge: e }), "SHIP_NOT_CONNECTED");
    // Occupied and land-only edges are refused; so is a ship without the module.
    expectRule(() => applyAction(s3, { type: "BUILD_SHIP", playerId: "a", edge: e1 }), "EDGE_OCCUPIED");
    expectRule(() => applyAction(s3, { type: "BUILD_SHIP", playerId: "a", edge: landEdge }), "INVALID_EDGE");
    const base = inPhase(createGame({ seed: "b", players: FOUR, board: "beginner" }), ACTION_PHASE, "a");
    expectRule(() => applyAction(base, { type: "BUILD_SHIP", playerId: "a", edge: e1 }), "TIDES_OFF");
    expect(legalActions(base, "a").some((x) => x.type === "BUILD_SHIP" || x.type === "MOVE_SHIP")).toBe(false);
    // A road may not start from a ship's far end either.
    const shipEnd = other(s3, e2, far);
    const landAtShipEnd = (geo.vertexEdges[shipEnd] ?? []).filter((e) => !isSeaEdge(s3, e, geo));
    for (const e of landAtShipEnd) expectRule(() => applyAction(s3, { type: "BUILD_ROAD", playerId: "a", edge: e }), "ROAD_NOT_CONNECTED");
  });

  it("§14.2 a settlement may be built at the end of a shipping route, and ships count for the road-adjacency rule", () => {
    const { state, at } = coastalStart(scenarioGame("goldCoast"), "a");
    const e1 = seaEdgesAt(state, at)[0]!;
    const s1 = applyAction(state, { type: "BUILD_SHIP", playerId: "a", edge: e1 });
    const far = other(s1, e1, at);
    const e2 = seaEdgesAt(s1, far).find((e) => e !== e1)!;
    const s2 = applyAction(s1, { type: "BUILD_SHIP", playerId: "a", edge: e2 });
    const end = other(s2, e2, far);
    const spots = legalActions(s2, "a").filter((x) => x.type === "BUILD_SETTLEMENT").map((x) => (x.type === "BUILD_SETTLEMENT" ? x.vertex : ""));
    // The far end of the route is two away from the settlement, so the distance rule allows it when it is land.
    const geo = boardGeometry(s2.board);
    const endIsLand = (geo.vertexHexes[end] ?? []).some((h) => s2.board.hexes[h] !== undefined);
    if (endIsLand) {
      expect(spots).toContain(end);
      const s3 = applyAction(s2, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: end });
      expect(getPlayer(s3, "a").settlements).toContain(end);
    } else {
      expect(spots).not.toContain(end);
    }
  });

  it("§14.2 only the ship at the open end of a route moves, once per turn, not on the turn it was built, never beside the pirate", () => {
    const { state, at } = coastalStart(scenarioGame("goldCoast"), "a");
    const e1 = seaEdgesAt(state, at)[0]!;
    const s1 = applyAction(state, { type: "BUILD_SHIP", playerId: "a", edge: e1 });
    const far = other(s1, e1, at);
    const e2 = seaEdgesAt(s1, far).find((e) => e !== e1)!;
    const s2 = applyAction(s1, { type: "BUILD_SHIP", playerId: "a", edge: e2 });
    expect(isOpenEndShip(s2, "a", e1)).toBe(false);
    expect(isOpenEndShip(s2, "a", e2)).toBe(true);
    expect(movableShips(s2, "a")).toEqual([]); // both built this turn
    const target = legalShipEdges(s2, "a", e2).find((e) => e !== e2)!;
    expectRule(() => applyAction(s2, { type: "MOVE_SHIP", playerId: "a", from: e2, to: target }), "SHIP_TOO_NEW");
    // Next turn (flags cleared): the open end moves, the inner ship does not, and only once.
    const next = mut(s2, (s) => {
      for (const p of s.players) {
        p.shipsBuiltThisTurn = [];
        p.shipMovedThisTurn = false;
      }
    });
    expect(movableShips(next, "a")).toEqual([e2]);
    expect(legalShipMoves(next, "a").length).toBeGreaterThan(0);
    expectRule(() => applyAction(next, { type: "MOVE_SHIP", playerId: "a", from: e1, to: target }), "NOT_OPEN_END");
    expectRule(() => applyAction(next, { type: "MOVE_SHIP", playerId: "b", from: e2, to: target }), "NOT_YOUR_TURN");
    const to = legalShipMoves(next, "a")[0]!.to;
    const { state: moved, events } = applyActionWithEvents(next, { type: "MOVE_SHIP", playerId: "a", from: e2, to });
    expect(getPlayer(moved, "a").ships).toEqual([e1, to]);
    expect(getPlayer(moved, "a").shipMovedThisTurn).toBe(true);
    expect(events.some((e) => e.kind === "shipMoved")).toBe(true);
    expectRule(() => applyAction(moved, { type: "MOVE_SHIP", playerId: "a", from: to, to: e2 }), "SHIP_ALREADY_MOVED");
    expect(legalActions(moved, "a").some((x) => x.type === "MOVE_SHIP")).toBe(false);
    // The pirate beside the open-end ship pins it.
    const geo = boardGeometry(next.board);
    const pirateHex = (geo.edgeHexes[e2] ?? []).find((h) => next.board.sea.includes(h))!;
    const pinned = mut(next, (s) => void (s.pirateHex = pirateHex));
    expectRule(() => applyAction(pinned, { type: "MOVE_SHIP", playerId: "a", from: e2, to: target }), "PIRATE_BLOCKS");
    expect(movableShips(pinned, "a")).toEqual([]);
    // Ending the turn for real clears the flags for the next turn.
    const ended = applyAction(s2, { type: "END_TURN", playerId: "a" });
    expect(getPlayer(ended, "a").shipsBuiltThisTurn).toEqual([]);
  });

  it("§14.2 longest route counts roads and ships joined only through an own settlement or city", () => {
    const { state, at } = coastalStart(scenarioGame("goldCoast"), "a");
    const geo = boardGeometry(state.board);
    // Two ships out to sea from the settlement, three roads inland.
    const e1 = seaEdgesAt(state, at)[0]!;
    const e2 = seaEdgesAt(state, other(state, e1, at)).find((e) => e !== e1)!;
    const landEdges: EdgeId[] = [];
    let v = at;
    for (let i = 0; i < 3; i++) {
      const e = (geo.vertexEdges[v] ?? []).find((x) => !isSeaEdge(state, x, geo) && !landEdges.includes(x) && (geo.edgeHexes[x] ?? []).some((h) => state.board.hexes[h] !== undefined));
      if (!e) break;
      landEdges.push(e);
      v = other(state, e, v);
    }
    expect(landEdges).toHaveLength(3);
    const joined = mut(state, (s) => {
      const p = getPlayer(s, "a");
      p.ships.push(e1, e2);
      p.roads.push(...landEdges);
    });
    expect(longestRoadLength(joined, "a")).toBe(5);
    // Without the settlement at the junction the two trails do not connect.
    const split = mut(joined, (s) => {
      const p = getPlayer(s, "a");
      p.settlements.splice(p.settlements.indexOf(at), 1);
    });
    expect(longestRoadLength(split, "a")).toBe(3);
    // A city joins them just as well.
    const city = mut(split, (s) => void getPlayer(s, "a").cities.push(at));
    expect(longestRoadLength(city, "a")).toBe(5);
  });

  it("§14.5 the player chooses robber or pirate; the pirate robs ships beside it and blocks their edges", () => {
    const { state, at } = coastalStart(scenarioGame("goldCoast"), "b");
    const e1 = seaEdgesAt(state, at)[0]!;
    const withShip = applyAction(state, { type: "BUILD_SHIP", playerId: "b", edge: e1 });
    const geo = boardGeometry(withShip.board);
    const seaBeside = (geo.edgeHexes[e1] ?? []).find((h) => withShip.board.sea.includes(h))!;
    const robbing = mut(withShip, (s) => {
      s.phase = { kind: "moveRobber", via: "seven", returnTo: "action" };
      s.currentPlayer = 0;
    });
    const legal = legalActions(robbing, "a");
    const pirateMoves = legal.filter((x) => x.type === "MOVE_ROBBER" && x.target === "pirate");
    const robberMoves = legal.filter((x) => x.type === "MOVE_ROBBER" && x.target !== "pirate");
    expect(pirateMoves.length).toBe(robbing.board.sea.length - 1);
    expect(robberMoves.length).toBe(Object.keys(robbing.board.hexes).length - 1);
    expectRule(() => applyAction(robbing, { type: "MOVE_ROBBER", playerId: "a", hex: seaBeside }), "INVALID_HEX");
    expectRule(() => applyAction(robbing, { type: "MOVE_ROBBER", playerId: "a", hex: robbing.pirateHex as HexId, target: "pirate" }), "ROBBER_MUST_MOVE");
    expect(pirateStealTargets(robbing, seaBeside, "a")).toEqual(["b"]);
    const { state: moved, events } = applyActionWithEvents(robbing, { type: "MOVE_ROBBER", playerId: "a", hex: seaBeside, target: "pirate" });
    expect(moved.pirateHex).toBe(seaBeside);
    expect(events.some((e) => e.kind === "pirateMoved")).toBe(true);
    expect(moved.phase).toEqual({ kind: "steal", hex: seaBeside, targets: ["b"], returnTo: "action" });
    const stolen = applyAction(moved, { type: "STEAL", playerId: "a", targetPlayerId: "b" });
    expect(handSize(getPlayer(stolen, "a").hand)).toBe(1);
    // Blocking: no ship may be built on the pirate's edges, and the pinned ship cannot move.
    const bTurn = mut(stolen, (s) => {
      s.currentPlayer = 1;
      s.phase = { kind: "action" };
      for (const p of s.players) p.shipsBuiltThisTurn = [];
    });
    const blocked = (geo.hexEdges[seaBeside] ?? []).filter((e) => e !== e1 && isSeaEdge(bTurn, e, geo));
    for (const e of legalShipEdges(bTurn, "b")) expect(blocked).not.toContain(e);
    const e1Verts: readonly VertexId[] = geo.edgeVertices[e1] ?? [];
    const adjacentToShip = blocked.find((e) => (geo.edgeVertices[e] ?? []).some((v) => e1Verts.includes(v)))!;
    expectRule(() => applyAction(bTurn, { type: "BUILD_SHIP", playerId: "b", edge: adjacentToShip }), "PIRATE_BLOCKS");
    expect(movableShips(bTurn, "b")).toEqual([]);
    // Robber target still works and a base game has no pirate choice.
    const land = Object.keys(robbing.board.hexes).find((h) => h !== robbing.robberHex)!;
    expect(applyAction(robbing, { type: "MOVE_ROBBER", playerId: "a", hex: land, target: "robber" }).robberHex).toBe(land);
    const base = inPhase(createGame({ seed: "b", players: FOUR, board: "beginner" }), { kind: "moveRobber", via: "seven", returnTo: "action" }, "a");
    expect(legalActions(base, "a").some((x) => x.type === "MOVE_ROBBER" && x.target === "pirate")).toBe(false);
    expectRule(() => applyAction(base, { type: "MOVE_ROBBER", playerId: "a", hex: "0,0", target: "pirate" }), "TIDES_OFF");
    // Archipelago has no pirate at all.
    const arch = inPhase(scenarioGame("archipelago"), { kind: "moveRobber", via: "seven", returnTo: "action" }, "a");
    expect(legalActions(arch, "a").some((x) => x.type === "MOVE_ROBBER" && x.target === "pirate")).toBe(false);
  });

  it("§14.3 gold fields owe a choice: exact count, from the bank, resolved in seat order before play continues", () => {
    const base = finishSetup(scenarioGame("goldCoast"));
    const goldHex = Object.keys(base.board.hexes).find((h) => base.board.hexes[h]!.terrain === "gold")!;
    const token = base.board.hexes[goldHex]!.token as number;
    const geo = boardGeometry(base.board);
    const corners = geo.hexVertices[goldHex] as VertexId[];
    // Player a gets a city and player b a settlement on the gold field (test setup only), robber elsewhere.
    const staged = mut(base, (s) => {
      for (const p of s.players) {
        p.settlements = [];
        p.cities = [];
        p.roads = [];
      }
      getPlayer(s, "a").cities.push(corners[0]!);
      getPlayer(s, "b").settlements.push(corners[3]!);
      s.robberHex = Object.keys(s.board.hexes).find((h) => h !== goldHex && s.board.hexes[h]!.token !== token)!;
      s.phase = { kind: "roll" };
      s.currentPlayer = 1; // b rolls; a is owed too, and b picks first
    });
    const rolled = applyAction(withNextRoll(staged, token), { type: "ROLL", playerId: "b" });
    expect(rolled.phase).toEqual({ kind: "chooseGold", owed: { a: 2, b: 1 }, returnTo: { kind: "action" } });
    expect(nextActor(rolled)).toBe("b");
    expect(legalActions(rolled, "c")).toEqual([]);
    expect(legalActions(rolled, "b").every((x) => x.type === "CHOOSE_GOLD" && x.resources.length === 1)).toBe(true);
    expect(legalActions(rolled, "a").every((x) => x.type === "CHOOSE_GOLD" && x.resources.length === 2)).toBe(true);
    expect(goldChoices(rolled, 2)).toHaveLength(15);
    expectRule(() => applyAction(rolled, { type: "CHOOSE_GOLD", playerId: "c", resources: ["ore"] }), "NO_GOLD_OWED");
    expectRule(() => applyAction(rolled, { type: "CHOOSE_GOLD", playerId: "a", resources: ["ore"] }), "WRONG_GOLD_COUNT");
    expectRule(() => applyAction(rolled, { type: "CHOOSE_GOLD", playerId: "a", resources: ["ore", "gold" as never] }), "INVALID_TRADE");
    const oreBefore = rolled.bank.ore;
    const { state: bDone, events } = applyActionWithEvents(rolled, { type: "CHOOSE_GOLD", playerId: "b", resources: ["ore"] });
    expect(getPlayer(bDone, "b").hand.ore).toBe(getPlayer(rolled, "b").hand.ore + 1);
    expect(bDone.bank.ore).toBe(oreBefore - 1);
    expect(events.some((e) => e.kind === "goldChosen")).toBe(true);
    expect(bDone.phase).toEqual({ kind: "chooseGold", owed: { a: 2 }, returnTo: { kind: "action" } });
    expect(nextActor(bDone)).toBe("a");
    const aDone = applyAction(bDone, { type: "CHOOSE_GOLD", playerId: "a", resources: ["wood", "grain"] });
    expect(aDone.phase).toEqual({ kind: "action" });
    expect(getPlayer(aDone, "a").hand.wood).toBe(getPlayer(rolled, "a").hand.wood + 1);
    // An empty bank of the chosen resource is refused; an empty bank altogether skips the choice.
    const noOre = mut(rolled, (s) => void (s.bank.ore = 0));
    expectRule(() => applyAction(noOre, { type: "CHOOSE_GOLD", playerId: "b", resources: ["ore"] }), "BANK_EMPTY");
    const empty = mut(staged, (s) => void (s.bank = hand({})));
    expect(applyAction(withNextRoll(empty, token), { type: "ROLL", playerId: "b" }).phase).toEqual({ kind: "action" });
    // The legal list matches what applyAction accepts (redacted view, too).
    const view = redact(rolled, "b");
    expect(legalActions(viewToState(view), "b")).toEqual(legalActions(rolled, "b"));
  });

  it("§14.3 a second setup settlement beside a gold field owes a choice before its road is placed", () => {
    const start = scenarioGame("goldCoast");
    const goldHex = Object.keys(start.board.hexes).find((h) => start.board.hexes[h]!.terrain === "gold")!;
    const corner = (boardGeometry(start.board).hexVertices[goldHex] as VertexId[])[0]!;
    // Round 2, player d places on the gold field's corner.
    const round2 = mut(start, (s) => {
      s.phase = { kind: "setup", round: 2, step: "settlement", lastSettlement: null };
      s.currentPlayer = 3;
    });
    const placed = applyAction(round2, { type: "BUILD_SETTLEMENT", playerId: "d", vertex: corner });
    expect(placed.phase).toEqual({ kind: "chooseGold", owed: { d: 1 }, returnTo: { kind: "setup", round: 2, step: "road", lastSettlement: corner } });
    expect(legalActions(placed, "d").every((x) => x.type === "CHOOSE_GOLD")).toBe(true);
    const chosen = applyAction(placed, { type: "CHOOSE_GOLD", playerId: "d", resources: ["clay"] });
    expect(chosen.phase).toEqual({ kind: "setup", round: 2, step: "road", lastSettlement: corner });
    expect(getPlayer(chosen, "d").hand.clay).toBeGreaterThanOrEqual(1);
  });

  it("§14.2 a setup road may be a ship when the settlement is coastal; Road Building may place ships", () => {
    const start = scenarioGame("goldCoast");
    const coastal = freeCoastalVertex(start);
    const placed = applyAction(start, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: coastal });
    const shipEdges = legalSetupShipEdges(placed, coastal);
    expect(shipEdges.length).toBeGreaterThan(0);
    expect(legalActions(placed, "a").filter((x) => x.type === "BUILD_SHIP").map((x) => (x.type === "BUILD_SHIP" ? x.edge : ""))).toEqual(shipEdges);
    const withShip = applyAction(placed, { type: "BUILD_SHIP", playerId: "a", edge: shipEdges[0]! });
    expect(getPlayer(withShip, "a").ships).toEqual([shipEdges[0]]);
    expect(getPlayer(withShip, "a").hand).toEqual(hand({})); // free in setup
    expect(withShip.phase).toEqual({ kind: "setup", round: 1, step: "settlement", lastSettlement: null });
    expect(withShip.currentPlayer).toBe(1);
    // Road Building: two ships for free.
    const { state: action, at } = coastalStart(scenarioGame("goldCoast", "rb"), "a");
    const card = mut(action, (s) => {
      getPlayer(s, "a").devCards.push({ type: "roadBuilding", boughtOnTurn: -1 });
      s.turn = 3;
    });
    const rb = applyAction(card, { type: "PLAY_ROAD_BUILDING", playerId: "a" });
    expect(rb.phase).toEqual({ kind: "roadBuilding", remaining: 2 });
    const e1 = seaEdgesAt(rb, at)[0]!;
    const one = applyAction(rb, { type: "BUILD_SHIP", playerId: "a", edge: e1 });
    expect(one.phase).toEqual({ kind: "roadBuilding", remaining: 1 });
    const e2 = seaEdgesAt(one, other(one, e1, at)).find((e) => e !== e1)!;
    const two = applyAction(one, { type: "BUILD_SHIP", playerId: "a", edge: e2 });
    expect(two.phase).toEqual({ kind: "action" });
    expect(handSize(getPlayer(two, "a").hand)).toBe(handSize(getPlayer(card, "a").hand));
  });

  it("§14.4 the island bonus is paid once per new island, never for a start island, and counts toward the win", () => {
    const start = finishSetup(scenarioGame("archipelago"));
    const a = getPlayer(start, "a");
    expect(a.startIslands.length).toBeGreaterThanOrEqual(1);
    const geo = boardGeometry(start.board);
    const target = start.board.islands.find((i) => !a.startIslands.includes(i.id))!;
    // Find a vertex on the target island that satisfies the distance rule, and a sea edge touching it; give a a ship there.
    const buildingsAll = new Set(start.players.flatMap((p) => [...p.settlements, ...p.cities]));
    const vertex = geo.vertices.find((v) => (geo.vertexHexes[v] ?? []).some((h) => target.hexes.includes(h)) && !buildingsAll.has(v) && (geo.vertexNeighbors[v] ?? []).every((n) => !buildingsAll.has(n)) && seaEdgesAt(start, v).length > 0)!;
    const ship = seaEdgesAt(start, vertex)[0]!;
    const staged = give(
      mut(inPhase(start, ACTION_PHASE, "a"), (s) => void getPlayer(s, "a").ships.push(ship)),
      "a",
      { wood: 4, clay: 4, wool: 4, grain: 4 },
    );
    const vpBefore = victoryPoints(staged, getPlayer(staged, "a")).total;
    const { state: settled, events } = applyActionWithEvents(staged, { type: "BUILD_SETTLEMENT", playerId: "a", vertex });
    const after = getPlayer(settled, "a");
    expect(after.islandChips).toEqual([target.id]);
    expect(victoryPoints(settled, after).total).toBe(vpBefore + 1 + 2);
    expect(events.find((e) => e.kind === "islandSettled")).toEqual(expect.objectContaining({ playerId: "a", island: target.id, bonus: 2 }));
    expect(settled.log.at(-1)?.text).toBe("Ada settled a new island (+2)");
    // A second settlement on the same island earns nothing more; a start-island settlement never does.
    const again = geo.vertices.find((v) => v !== vertex && (geo.vertexHexes[v] ?? []).some((h) => target.hexes.includes(h)) && !(geo.vertexNeighbors[v] ?? []).includes(vertex) && !buildingsAll.has(v) && (geo.vertexNeighbors[v] ?? []).every((n) => !buildingsAll.has(n)) && seaEdgesAt(settled, v).length > 0)!;
    const ship2 = seaEdgesAt(settled, again).find((e) => !after.ships.includes(e))!;
    const staged2 = mut(settled, (s) => void getPlayer(s, "a").ships.push(ship2));
    const settled2 = applyAction(staged2, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: again });
    expect(getPlayer(settled2, "a").islandChips).toEqual([target.id]);
    // Redacted views carry the chips and the public VP.
    const view = redact(settled2, "b");
    expect(view.players.find((p) => p.id === "a")!.islandChips).toEqual([target.id]);
    expect(view.players.find((p) => p.id === "a")!.publicVP).toBe(victoryPoints(settled2, getPlayer(settled2, "a")).publicVP);
    // The win check uses the scenario target (13 here): 12 points is not a win.
    const almost = mut(settled2, (s) => {
      const p = getPlayer(s, "a");
      p.devCards = Array.from({ length: 13 - victoryPoints(s, p).total - 1 }, () => ({ type: "victoryPoint" as const, boughtOnTurn: 0 }));
    });
    const offer = { type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ clay: 1 }) } as const;
    const notYet = applyAction(almost, offer);
    expect(notYet.winner).toBeNull();
    const enough = mut(settled2, (s) => {
      const p = getPlayer(s, "a");
      p.devCards = Array.from({ length: 13 - victoryPoints(s, p).total }, () => ({ type: "victoryPoint" as const, boughtOnTurn: 0 }));
    });
    expect(applyAction(enough, offer).winner).toBe("a");
  });

  it("§14 random legal play completes on every built-in scenario with consistent pieces, bank and events", () => {
    for (const id of BUILT_IN_SCENARIO_IDS) {
      const scenario = builtInScenario(id);
      for (let g = 0; g < 3; g++) {
        const game = playRandomGame(`${id}-${g}`, { scenario, maxTurns: 300 });
        for (const p of game.final.players) {
          expect(p.roads.length + p.pieces.roads).toBe(15);
          expect(p.ships.length + p.pieces.ships).toBe(15);
          expect(p.settlements.length + p.pieces.settlements).toBe(5);
          expect(p.cities.length + p.pieces.cities).toBe(4);
          for (const e of p.ships) expect(isSeaEdge(game.final, e)).toBe(true);
        }
        const inHands = game.final.players.reduce((n, p) => n + handSize(p.hand), 0);
        expect(inHands + handSize(game.final.bank)).toBe(RESOURCES.length * 19);
        if (game.final.phase.kind === "ended") {
          const winner = getPlayer(game.final, game.final.winner as PlayerId);
          expect(victoryPoints(game.final, winner).total).toBeGreaterThanOrEqual(scenario.victoryPoints);
        }
        const pirate = game.final.pirateHex;
        if (pirate !== null) expect(game.final.board.sea).toContain(pirate);
      }
    }
    void hexCorner;
  });
});
