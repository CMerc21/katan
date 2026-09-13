import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { RESOURCES, TERRAIN_RESOURCE, type HexTile, type Terrain } from "../src/board";
import { standardFrame } from "../src/frames";
import { createGame } from "../src/game";
import { edgeId, hexCorner, hexEdge, hexVerticesOf, neighbor, otherVertex, parseHexId, GEOMETRY, type EdgeId, type HexId, type VertexId } from "../src/geometry";
import { legalActions } from "../src/legal";
import { CARAVAN_LENGTH, SPICE_BANK } from "../src/modules/types";
import type { Scenario } from "../src/scenario";
import { longestRoadLength } from "../src/specialCards";
import { buildingAt, getPlayer, handSize, victoryPoints } from "../src/state";
import type { Action, GameState, PlayerId } from "../src/types";
import { ACTION_PHASE, FOUR, expectRule, finishSetup, inPhase, mut, playRandomGame, withNextRoll } from "./helpers";

const OASES: HexId[] = ["0,0", "2,-2", "-2,2"];

function caravanScenario(overrides: Partial<Scenario> = {}): Scenario {
  const frame = standardFrame();
  return {
    id: "caravans-test",
    name: "Caravans test",
    board: { ...frame, hexes: frame.hexes.map((h) => (OASES.includes(`${h.at.q},${h.at.r}`) ? { ...h, extras: { oasis: true } } : h)) },
    modules: {},
    variants: { caravans: true },
    victoryPoints: 12,
    ...overrides,
  };
}

function game(seed = "caravans"): GameState {
  return createGame({ seed, players: FOUR, scenario: caravanScenario() });
}

/** Pin a hex's terrain and token, retokening every other hex that carried `token` so a roll of it only hits `hex`. */
function isolate(state: GameState, hex: HexId, terrain: Terrain, token: number): GameState {
  return mut(state, (s) => {
    const hexes = s.board.hexes as Record<HexId, HexTile>;
    for (const [id, t] of Object.entries(hexes)) {
      if (id !== hex && t.token === token) hexes[id] = { ...t, token: token === 2 ? 12 : 2 };
    }
    hexes[hex] = { terrain, token };
    if (s.robberHex === hex) s.robberHex = Object.keys(hexes).find((id) => id !== hex && !s.board.oases.includes(id)) as HexId;
  });
}

function caravans(state: GameState) {
  const c = state.wayfarers?.caravans;
  if (!c) throw new Error("caravans off");
  return c;
}

function giveSpice(state: GameState, playerId: PlayerId, n: number): GameState {
  return mut(state, (s) => {
    const c = caravans(s);
    c.spice[playerId] = (c.spice[playerId] ?? 0) + n;
    c.spiceBank -= n;
  });
}

/** Take every building off the corners of `hex` (test setup only). */
function clearCorners(state: GameState, hex: HexId): GameState {
  const corners = hexVerticesOf(parseHexId(hex));
  return mut(state, (s) => {
    for (const p of s.players) {
      p.settlements = p.settlements.filter((v) => !corners.includes(v));
      p.cities = p.cities.filter((v) => !corners.includes(v));
    }
  });
}

/** A free corner of `hex` (no building on it). */
function freeCorner(state: GameState, hex: HexId, skip = 0): VertexId {
  const free = hexVerticesOf(parseHexId(hex)).filter((v) => buildingAt(state, v) === null);
  const v = free[skip];
  if (!v) throw new Error("no free corner");
  return v;
}

const CENTER = parseHexId("0,0");

/** Three edges of player `a` in a line: the centre oasis's edge 0, then two edges leading away from it. */
function lineFromOasis(): [EdgeId, EdgeId, EdgeId] {
  const e0 = hexEdge(CENTER, 0);
  const c0 = hexCorner(CENTER, 0);
  const e1 = edgeId(neighbor(CENTER, 0), neighbor(CENTER, 1));
  const w = otherVertex(e1, c0);
  const e2 = GEOMETRY.vertexEdges[w]!.find((e) => e !== e1 && !GEOMETRY.edgeVertices[e]!.includes(c0))!;
  return [e0, e1, e2];
}

/** Hand pieces to `playerId` directly, taking them off anyone who held those spots (test setup only). */
function own(state: GameState, playerId: PlayerId, pieces: { roads?: EdgeId[]; settlements?: VertexId[]; cities?: VertexId[] }): GameState {
  return mut(state, (x) => {
    const spots = [...(pieces.settlements ?? []), ...(pieces.cities ?? [])];
    for (const p of x.players) {
      p.roads = p.roads.filter((e) => !(pieces.roads ?? []).includes(e));
      p.settlements = p.settlements.filter((v) => !spots.includes(v));
      p.cities = p.cities.filter((v) => !spots.includes(v));
    }
    const me = getPlayer(x, playerId);
    me.roads.push(...(pieces.roads ?? []));
    me.settlements.push(...(pieces.settlements ?? []));
    me.cities.push(...(pieces.cities ?? []));
  });
}

function extend(state: GameState, playerId: PlayerId, caravan: number, edge: EdgeId): GameState {
  return applyAction(state, { type: "EXTEND_CARAVAN", playerId, caravan, edge });
}

describe("docs/phase10.md §6 Caravans", () => {
  it("docs/phase10.md §6 init: one empty track per oasis in board order, an empty spice bank of 19; off leaves wayfarers null", () => {
    const s = game();
    expect(s.board.oases).toHaveLength(3);
    const c = caravans(s);
    expect(c.tracks.map((t) => t.oasis)).toEqual([...s.board.oases]);
    expect(c.tracks.every((t) => t.edges.length === 0)).toBe(true);
    expect(c.spiceBank).toBe(SPICE_BANK);
    for (const p of s.players) expect(c.spice[p.id]).toBe(0);
    const off = createGame({ seed: "x", players: FOUR, scenario: caravanScenario({ variants: {} }) });
    expect(off.wayfarers).toBeNull();
    expect(off.board.oases).toHaveLength(3);
  });

  it("docs/phase10.md §6 an oasis yields spice, not its resource: 1 per settlement and 2 per city on its number", () => {
    const oasis = "0,0";
    let s = clearCorners(isolate(finishSetup(game()), oasis, "farmland", 9), oasis);
    const va = freeCorner(s, oasis, 0);
    const vb = freeCorner(s, oasis, 1);
    s = mut(s, (x) => {
      getPlayer(x, "a").settlements.push(va);
      getPlayer(x, "b").cities.push(vb);
    });
    const before = s;
    const { state: after, events } = applyActionWithEvents(withNextRoll(s, 9), { type: "ROLL", playerId: "a" });
    for (const p of after.players) expect(p.hand).toEqual(getPlayer(before, p.id).hand);
    expect(handSize(after.bank)).toBe(handSize(before.bank));
    expect(caravans(after).spice.a).toBe(1);
    expect(caravans(after).spice.b).toBe(2);
    expect(caravans(after).spiceBank).toBe(SPICE_BANK - 3);
    const spice = events.filter((e) => e.kind === "spiceProduced");
    expect(spice).toHaveLength(1);
    expect(spice[0]).toMatchObject({ gains: expect.arrayContaining([{ playerId: "a", hex: oasis, count: 1 }, { playerId: "b", hex: oasis, count: 2 }]) });
    expect(events.some((e) => e.kind === "produced")).toBe(false);
  });

  it("docs/phase10.md §6 the robber on the oasis blocks spice", () => {
    const oasis = "0,0";
    let s = isolate(finishSetup(game()), oasis, "farmland", 9);
    s = mut(s, (x) => {
      getPlayer(x, "a").settlements.push(freeCorner(x, oasis));
      x.robberHex = oasis;
    });
    const after = applyAction(withNextRoll(s, 9), { type: "ROLL", playerId: "a" });
    expect(caravans(after).spice.a).toBe(0);
    expect(caravans(after).spiceBank).toBe(SPICE_BANK);
  });

  it("docs/phase10.md §6 the spice bank runs dry in seat order from the current player", () => {
    const oasis = "0,0";
    let s = clearCorners(isolate(finishSetup(game()), oasis, "farmland", 9), oasis);
    s = mut(s, (x) => {
      getPlayer(x, "a").cities.push(freeCorner(x, oasis, 0));
      getPlayer(x, "b").cities.push(freeCorner(x, oasis, 1));
      getPlayer(x, "d").settlements.push(freeCorner(x, oasis, 2));
    });
    // Current player is d (roll phase): d first, then a, then b.
    s = inPhase(s, { kind: "roll" }, "d");
    s = mut(s, (x) => {
      caravans(x).spiceBank = 2;
      caravans(x).spice.c = SPICE_BANK - 2;
    });
    const { state: after, events } = applyActionWithEvents(withNextRoll(s, 9), { type: "ROLL", playerId: "d" });
    const c = caravans(after);
    expect(c.spice.d).toBe(1);
    expect(c.spice.a).toBe(1);
    expect(c.spice.b).toBe(0);
    expect(c.spiceBank).toBe(0);
    const spice = events.find((e) => e.kind === "spiceProduced");
    expect(spice).toMatchObject({ gains: [{ playerId: "d", hex: oasis, count: 1 }, { playerId: "a", hex: oasis, count: 1 }] });
  });

  it("docs/phase10.md §6 the second setup settlement takes no starting resource from an oasis", () => {
    let s = game();
    const oasis = "0,0";
    const corners = hexVerticesOf(CENTER);
    // Drive setup by hand; the last settlement (a, round 2) goes on an oasis corner when one is legal.
    let placedOnOasis: VertexId | null = null;
    while (s.phase.kind === "setup") {
      const who = s.players[s.currentPlayer]!.id;
      const actions = legalActions(s, who);
      let action = actions[0]!;
      if (s.phase.round === 2 && s.phase.step === "settlement" && who === "a") {
        const onOasis = actions.find((x): x is Extract<Action, { type: "BUILD_SETTLEMENT" }> => x.type === "BUILD_SETTLEMENT" && corners.includes(x.vertex));
        if (onOasis) {
          action = onOasis;
          placedOnOasis = onOasis.vertex;
        }
      }
      s = applyAction(s, action);
    }
    expect(placedOnOasis).not.toBeNull();
    const expected = GEOMETRY.vertexHexes[placedOnOasis!]!.filter((h) => h !== oasis && TERRAIN_RESOURCE[s.board.hexes[h]!.terrain] !== null).length;
    expect(handSize(getPlayer(s, "a").hand)).toBe(expected);
    expect(caravans(s).spice.a).toBe(0);
  });

  it("docs/phase10.md §6 EXTEND_CARAVAN: 1 spice pulls a track one step along an own road, from the oasis outwards, three steps at most", () => {
    const [e0, e1, e2] = lineFromOasis();
    const idx = game().board.oases.indexOf("0,0");
    let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
    s = giveSpice(own(s, "a", { roads: [e0, e1, e2, hexEdge(CENTER, 3)] }), "a", 4);

    // Off the oasis first.
    expectRule(() => extend(s, "a", idx, e1), "CARAVAN_NOT_ADJACENT");
    const { state: s1, events } = applyActionWithEvents(s, { type: "EXTEND_CARAVAN", playerId: "a", caravan: idx, edge: e0 });
    expect(caravans(s1).tracks[idx]!.edges).toEqual([e0]);
    expect(caravans(s1).spice.a).toBe(3);
    expect(caravans(s1).spiceBank).toBe(SPICE_BANK - 3);
    expect(events).toContainEqual(expect.objectContaining({ kind: "caravanExtended", playerId: "a", caravan: idx, edge: e0 }));

    // Then along a chain of edges sharing a vertex with the last one.
    expectRule(() => extend(s1, "a", idx, hexEdge(CENTER, 3)), "CARAVAN_NOT_ADJACENT");
    expectRule(() => extend(s1, "a", idx, e0), "CARAVAN_NOT_ADJACENT");
    const s2 = extend(s1, "a", idx, e1);
    const s3 = extend(s2, "a", idx, e2);
    expect(caravans(s3).tracks[idx]!.edges).toEqual([e0, e1, e2]);
    expect(caravans(s3).tracks[idx]!.edges).toHaveLength(CARAVAN_LENGTH);
    const s4 = mut(s3, (x) => {
      const a = getPlayer(x, "a");
      const e3 = GEOMETRY.vertexEdges[otherVertex(e2, otherVertex(e1, hexCorner(CENTER, 0)))]!.find((e) => e !== e2)!;
      a.roads.push(e3);
    });
    const e3 = getPlayer(s4, "a").roads[getPlayer(s4, "a").roads.length - 1]!;
    expectRule(() => extend(s4, "a", idx, e3), "CARAVAN_COMPLETE");
  });

  it("docs/phase10.md §6 EXTEND_CARAVAN rejections: no spice, not your road, wrong phase, wrong turn, bad index, variant off", () => {
    const [e0] = lineFromOasis();
    const idx = game().board.oases.indexOf("0,0");
    let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
    s = own(own(s, "a", { roads: [e0] }), "b", { roads: [hexEdge(CENTER, 3)] });
    expectRule(() => extend(s, "a", idx, e0), "NO_SPICE");
    const rich = giveSpice(s, "a", 1);
    expectRule(() => extend(rich, "a", idx, hexEdge(CENTER, 3)), "INVALID_EDGE");
    expectRule(() => extend(rich, "a", idx, hexEdge(CENTER, 4)), "INVALID_EDGE");
    expectRule(() => extend(rich, "a", 7, e0), "INVALID_PAYLOAD");
    expectRule(() => extend(rich, "b", idx, e0), "NOT_YOUR_TURN");
    expectRule(() => extend(inPhase(rich, { kind: "roll" }), "a", idx, e0), "WRONG_PHASE");
    const off = inPhase(finishSetup(createGame({ seed: "x", players: FOUR, scenario: caravanScenario({ variants: {} }) })), ACTION_PHASE, "a");
    expectRule(() => extend(off, "a", 0, e0), "MODULE_OFF");
  });

  it("docs/phase10.md §6 legalActions lists EXTEND_CARAVAN per (caravan, adjacent own road) only while holding spice", () => {
    const [e0, e1] = lineFromOasis();
    const idx = game().board.oases.indexOf("0,0");
    let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
    s = own(own(s, "a", { roads: [e0, e1, hexEdge(CENTER, 3)] }), "b", { roads: [hexEdge(CENTER, 4)] });
    const extendsOf = (state: GameState, who: PlayerId) => legalActions(state, who).filter((x): x is Extract<Action, { type: "EXTEND_CARAVAN" }> => x.type === "EXTEND_CARAVAN");
    expect(extendsOf(s, "a")).toEqual([]);
    const rich = giveSpice(s, "a", 1);
    const list = extendsOf(rich, "a");
    expect(list.map((x) => [x.caravan, x.edge]).sort()).toEqual([[idx, e0], [idx, hexEdge(CENTER, 3)]].sort());
    expect(extendsOf(rich, "b")).toEqual([]);
    const after = extend(rich, "a", idx, e0);
    expect(extendsOf(giveSpice(after, "a", 1), "a").map((x) => x.edge)).toEqual([e1]);
    expect(extendsOf(inPhase(rich, { kind: "roll" }), "a")).toEqual([]);
  });

  it("docs/phase10.md §6 roads on or touching a caravan track count double for Longest Road", () => {
    const [e0, e1, e2] = lineFromOasis();
    const idx = game().board.oases.indexOf("0,0");
    let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
    s = own(s, "a", { roads: [e0, e1, e2] });
    expect(longestRoadLength(s, "a")).toBe(3);
    expect(s.longestRoad.playerId).toBeNull();
    const others = s.players.filter((p) => p.id !== "a").map((p) => [p.id, longestRoadLength(s, p.id)] as const);
    const after = extend(giveSpice(s, "a", 1), "a", idx, e0);
    // e0 lies on the track (2), e1 shares its vertex (2), e2 does not (1).
    expect(longestRoadLength(after, "a")).toBe(5);
    expect(after.longestRoad).toEqual({ playerId: "a", length: 5 });
    for (const [id, len] of others) expect(longestRoadLength(after, id)).toBe(len);
  });

  it("docs/phase10.md §6 a building on a track vertex gets +1 from each adjacent producing hex on its number, bank permitting", () => {
    const [e0] = lineFromOasis();
    const idx = game().board.oases.indexOf("0,0");
    const c0 = hexCorner(CENTER, 0);
    const n0 = `${neighbor(CENTER, 0).q},${neighbor(CENTER, 0).r}`;
    const n1 = `${neighbor(CENTER, 1).q},${neighbor(CENTER, 1).r}`;
    let s = inPhase(finishSetup(game()), ACTION_PHASE, "a");
    s = isolate(isolate(s, n0, "farmland", 9), n1, "forest", 4);
    // Nobody else on the track's vertices, so the bonus below is a's alone.
    s = clearCorners(own(s, "a", { roads: [e0] }), "0,0");
    s = own(s, "a", { settlements: [c0] });
    const tracked = inPhase(extend(giveSpice(s, "a", 1), "a", idx, e0), { kind: "roll" }, "a");
    const grain = getPlayer(tracked, "a").hand.grain;

    const { state: after, events } = applyActionWithEvents(withNextRoll(tracked, 9), { type: "ROLL", playerId: "a" });
    expect(getPlayer(after, "a").hand.grain).toBe(grain + 2);
    const produced = events.filter((e) => e.kind === "produced");
    expect(produced).toHaveLength(2);
    expect(produced[1]).toMatchObject({ gains: [{ playerId: "a", hex: n0, resource: "grain", count: 1 }] });
    expect(events.filter((e) => e.kind === "spiceProduced")).toHaveLength(0);

    // Without the track: plain production.
    const plain = applyAction(withNextRoll(inPhase(s, { kind: "roll" }, "a"), 9), { type: "ROLL", playerId: "a" });
    expect(getPlayer(plain, "a").hand.grain).toBe(grain + 1);

    // The bank pays the base card first; no bonus when it is empty.
    const poor = mut(tracked, (x) => {
      const held = x.bank.grain - 1;
      x.bank.grain = 1;
      getPlayer(x, "c").hand.grain += held;
    });
    expect(getPlayer(applyAction(withNextRoll(poor, 9), { type: "ROLL", playerId: "a" }), "a").hand.grain).toBe(grain + 1);

    // The robber blocks base and bonus; the oasis itself never gives a bonus.
    const robbed = mut(tracked, (x) => void (x.robberHex = n0));
    expect(getPlayer(applyAction(withNextRoll(robbed, 9), { type: "ROLL", playerId: "a" }), "a").hand.grain).toBe(grain);
  });

  it("docs/phase10.md §6 random play with caravans ends with spice, cards, tracks and victory points consistent", () => {
    const scenario = caravanScenario();
    const check = (state: GameState): void => {
      const c = caravans(state);
      const inHands = state.players.reduce((n, p) => n + handSize(p.hand), 0);
      expect(inHands + handSize(state.bank)).toBe(RESOURCES.length * 19);
      const spice = state.players.reduce((n, p) => n + (c.spice[p.id] ?? 0), 0);
      expect(spice + c.spiceBank).toBe(SPICE_BANK);
      for (const p of state.players) expect(c.spice[p.id]).toBeGreaterThanOrEqual(0);
      expect(c.tracks).toHaveLength(state.board.oases.length);
      for (const t of c.tracks) {
        expect(t.edges.length).toBeLessThanOrEqual(CARAVAN_LENGTH);
        expect(new Set(t.edges).size).toBe(t.edges.length);
        for (const e of t.edges) expect(state.players.some((p) => p.roads.includes(e))).toBe(true);
      }
      for (const p of state.players) {
        let expected = p.settlements.length + 2 * p.cities.length + p.devCards.filter((d) => d.type === "victoryPoint").length;
        if (state.longestRoad.playerId === p.id) expected += 2;
        if (state.largestArmy.playerId === p.id) expected += 2;
        expect(victoryPoints(state, p).total).toBe(expected);
      }
    };
    let extended = 0;
    for (let g = 0; g < 20; g++) {
      const played = playRandomGame(`caravans-${g}`, {
        scenario,
        onStep: (state, action) => {
          if (action.type === "EXTEND_CARAVAN") extended += 1;
          check(state);
        },
      });
      expect(played.final.phase.kind).toBe("ended");
      expect(played.final.winner).not.toBeNull();
      expect(victoryPoints(played.final, getPlayer(played.final, played.final.winner as PlayerId)).total).toBeGreaterThanOrEqual(scenario.victoryPoints);
    }
    expect(extended).toBeGreaterThan(0);
  }, 120_000);
});
