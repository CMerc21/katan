import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import type { GameEvent } from "../src/events";
import { beginnerDefinition } from "../src/frames";
import { createGame } from "../src/game";
import { GEOMETRY, type VertexId } from "../src/geometry";
import type { HarbormasterState } from "../src/modules/types";
import { HARBORMASTER_MIN, HARBORMASTER_VP, harborPoints } from "../src/modules/wayfarers/harbormaster";
import type { Scenario } from "../src/scenario";
import { COSTS, getPlayer, handSize, victoryPoints } from "../src/state";
import type { GameState, Player } from "../src/types";
import { ACTION_PHASE, FOUR, finishSetup, give, inPhase, place, playRandomGame } from "./helpers";

const MODULE_EVENT_KINDS: readonly GameEvent["kind"][] = ["deckReshuffled", "neighborlyGave", "taxCollected", "chipMoved", "bridgeBuilt", "coinsAwarded"];

function scenario(harbormaster: boolean): Scenario {
  return { id: "t", name: "t", board: beginnerDefinition(), modules: {}, variants: { harbormaster }, victoryPoints: 10 };
}

function game(seed = "harbor"): GameState {
  return createGame({ seed, players: FOUR, scenario: scenario(true) });
}

function chip(state: GameState): HarbormasterState {
  return state.wayfarers!.harbormaster!;
}

function harborVertices(state: GameState): VertexId[] {
  return state.board.ports.flatMap((p) => [...p.vertices]);
}

/** `n` harbour vertices that keep the distance rule among themselves and against `taken`. */
function pickHarborVertices(state: GameState, n: number, taken: readonly VertexId[] = []): VertexId[] {
  const out: VertexId[] = [];
  for (const v of harborVertices(state)) {
    if (out.length === n) break;
    const near = new Set([...taken, ...out].flatMap((x) => [x, ...(GEOMETRY.vertexNeighbors[x] ?? [])]));
    if (!near.has(v)) out.push(v);
  }
  if (out.length < n) throw new Error("not enough harbour vertices");
  return out;
}

/** An empty edge at `v` (so a settlement there touches a road). */
function edgeAt(state: GameState, v: VertexId) {
  const taken = new Set(state.players.flatMap((p) => p.roads));
  const e = (GEOMETRY.vertexEdges[v] ?? []).find((x) => !taken.has(x));
  if (!e) throw new Error("no free edge");
  return e;
}

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

/** Independent VP recount: buildings, special cards, VP cards, plus 2 for the Harbormaster. */
function recount(state: GameState, p: Player): number {
  let vp = p.settlements.length + 2 * p.cities.length;
  if (state.longestRoad.playerId === p.id) vp += 2;
  if (state.largestArmy.playerId === p.id) vp += 2;
  if (state.wayfarers?.harbormaster?.playerId === p.id) vp += HARBORMASTER_VP;
  return vp + p.devCards.filter((c) => c.type === "victoryPoint").length;
}

function totalCards(state: GameState): number {
  return handSize(state.bank) + state.players.reduce((n, p) => n + handSize(p.hand), 0);
}

describe("docs/phase10.md §4 Harbormaster", () => {
  it("docs/phase10.md §4 harbour points: 1 per settlement and 2 per city on a harbour vertex, nothing inland; setup settlements count", () => {
    const fresh = game();
    expect(chip(fresh)).toEqual({ playerId: null, points: 0 });
    expect(fresh.wayfarers).toEqual({ eventDeck: null, fishing: null, rivers: null, harbormaster: { playerId: null, points: 0 }, raiders: null, caravans: null, wagons: null });
    const base = inPhase(fresh, ACTION_PHASE, "a");
    const [v1, v2, v3] = pickHarborVertices(base, 3) as [VertexId, VertexId, VertexId];
    const harbour = new Set(harborVertices(base));
    const inland = GEOMETRY.vertices.find((v) => !harbour.has(v) && ![v1, v2, v3].some((h) => h === v || GEOMETRY.vertexNeighbors[h]?.includes(v)))!;
    const s = place(base, "a", { settlements: [v1, inland], cities: [v2] });
    expect(harborPoints(s, getPlayer(s, "a"))).toBe(3);
    expect(harborPoints(s, getPlayer(s, "b"))).toBe(0);
    const sb = place(s, "b", { settlements: [v3] });
    expect(harborPoints(sb, getPlayer(sb, "b"))).toBe(1);
    // Setup placements count too (at most 2 points each, so nobody reaches the chip in setup).
    const done = finishSetup(game());
    for (const p of done.players) {
      const expected = p.settlements.filter((v) => harbour.has(v)).length;
      expect(harborPoints(done, p)).toBe(expected);
      expect(expected).toBeLessThan(HARBORMASTER_MIN);
    }
    expect(chip(done).playerId).toBeNull();
  });

  it("docs/phase10.md §4 the first player to 3 harbour points takes the Harbormaster (+2 VP); it moves only when another player strictly exceeds the holder", () => {
    let s = inPhase(game(), ACTION_PHASE, "a");
    const [a1, a2, a3, b1, b2, b3] = pickHarborVertices(s, 6) as [VertexId, VertexId, VertexId, VertexId, VertexId, VertexId];
    s = place(s, "a", { settlements: [a1, a2], roads: [edgeAt(s, a3)] });
    s = give(s, "a", COSTS.settlement);
    expect(chip(s)).toEqual({ playerId: null, points: 0 }); // nothing evaluated yet
    const { state: s1, events: e1 } = applyActionWithEvents(s, { type: "BUILD_SETTLEMENT", playerId: "a", vertex: a3 });
    expect(harborPoints(s1, getPlayer(s1, "a"))).toBe(3);
    expect(chip(s1)).toEqual({ playerId: "a", points: 3 });
    expect(e1).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "harbormaster", from: null, to: "a" }));
    expect(s1.log.at(-1)?.text).toBe("Ada takes Harbormaster");
    expect(victoryPoints(s1, getPlayer(s1, "a"))).toEqual({ publicVP: 5, hiddenVP: 0, total: 5 });
    expect(victoryPoints(s1, getPlayer(s1, "b")).total).toBe(0);
    // b reaches 3 as well: a tie never transfers.
    let t = inPhase(s1, ACTION_PHASE, "b");
    t = place(t, "b", { settlements: [b1, b2], roads: [edgeAt(t, b3)] });
    t = give(t, "b", COSTS.settlement);
    const { state: t1, events: te } = applyActionWithEvents(t, { type: "BUILD_SETTLEMENT", playerId: "b", vertex: b3 });
    expect(harborPoints(t1, getPlayer(t1, "b"))).toBe(3);
    expect(chip(t1)).toEqual({ playerId: "a", points: 3 });
    expect(te.some((e) => e.kind === "chipMoved")).toBe(false);
    // b upgrades a harbour settlement: 4 > 3, the chip moves.
    const u = give(t1, "b", COSTS.city);
    const { state: u1, events: ue } = applyActionWithEvents(u, { type: "BUILD_CITY", playerId: "b", vertex: b1 });
    expect(chip(u1)).toEqual({ playerId: "b", points: 4 });
    expect(ue).toContainEqual(expect.objectContaining({ kind: "chipMoved", chip: "harbormaster", from: "a", to: "b" }));
    expect(u1.log.at(-1)?.text).toBe("Bo takes Harbormaster from Ada");
    expect(victoryPoints(u1, getPlayer(u1, "b")).total).toBe(2 + 2 + HARBORMASTER_VP);
    expect(victoryPoints(u1, getPlayer(u1, "a")).total).toBe(3);
    // a matches 4 with a city of their own: still b's.
    const w = give(inPhase(u1, ACTION_PHASE, "a"), "a", COSTS.city);
    const w1 = applyAction(w, { type: "BUILD_CITY", playerId: "a", vertex: a1 });
    expect(harborPoints(w1, getPlayer(w1, "a"))).toBe(4);
    expect(chip(w1)).toEqual({ playerId: "b", points: 4 });
    // An inland city changes nothing.
    const harbour = new Set(harborVertices(w1));
    const inland = GEOMETRY.vertices.find((v) => !harbour.has(v) && [a1, a2, a3, b1, b2, b3].every((h) => h !== v && !GEOMETRY.vertexNeighbors[h]?.includes(v)))!;
    const x = give(place(w1, "a", { settlements: [inland] }), "a", COSTS.city);
    const { state: x1, events: xe } = applyActionWithEvents(x, { type: "BUILD_CITY", playerId: "a", vertex: inland });
    expect(chip(x1)).toEqual({ playerId: "b", points: 4 });
    expect(xe.some((e) => e.kind === "chipMoved")).toBe(false);
    // a takes a fifth point: 5 > 4, back to a.
    const y = give(x1, "a", COSTS.city);
    const y1 = applyAction(y, { type: "BUILD_CITY", playerId: "a", vertex: a2 });
    expect(chip(y1)).toEqual({ playerId: "a", points: 5 });
  });

  it("docs/phase10.md §4 random play: 20 games end, conserve resources and keep the VP math with the chip", () => {
    let chipSeen = false;
    for (let i = 0; i < 20; i++) {
      const seed = `harbor-${i}`;
      const played = playRandomGame(seed, {
        scenario: scenario(true),
        onStep: (s) => {
          check(totalCards(s) === 95, `resources not conserved (${seed})`);
          const hm = chip(s);
          const points = new Map(s.players.map((p) => [p.id, harborPoints(s, p)]));
          const max = Math.max(...points.values());
          if (hm.playerId === null) {
            check(hm.points === 0, `points without a holder (${seed})`);
            check(max < HARBORMASTER_MIN, `unclaimed chip with ${max} points (${seed})`);
          } else {
            chipSeen = true;
            check(hm.points === points.get(hm.playerId) && hm.points >= HARBORMASTER_MIN, `holder points wrong (${seed})`);
            check(max === hm.points, `someone exceeds the holder (${seed})`);
          }
          for (const p of s.players) check(victoryPoints(s, p).total === recount(s, p), `VP mismatch for ${p.id} (${seed})`);
        },
      });
      expect(played.final.phase.kind).toBe("ended");
      expect(played.final.winner).not.toBeNull();
    }
    expect(chipSeen).toBe(true);
  }, 60_000);

  it("docs/phase10.md §4 with the variant off the base game is untouched: no chip state, no module events, base VP only", () => {
    const off = scenario(false);
    expect(createGame({ seed: "x", players: FOUR, scenario: off }).wayfarers).toBeNull();
    const played = playRandomGame("harbor-off", { scenario: off, maxTurns: 80 });
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
