import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { GEOMETRY, type VertexId } from "../src/geometry";
import { legalActions, legalSettlementVertices, roadConnects } from "../src/legal";
import { knightAt, knightDestinations, ownRoadVertices, reachableVertices } from "../src/modules/crown/knights";
import { longestRoadLength } from "../src/specialCards";
import { getPlayer, nextActor } from "../src/state";
import { ACTION_PHASE, ROLL_PHASE, clearStart, edgeBetween, expectRule, give, inPhase, mut, pathEdges, place, vertexPath, withNextRoll } from "./helpers";
import { A, B, addKnight, crownGame, crownOf, setTrack, withNextCrownRoll } from "./crown-helpers";

/** meadow 4, mountain 8, claypit 4 — a corner of hex 1,0. */
const V1 = "1,0|1,1|2,0";
/** The next two corners of hex 1,0 going round: K touches 0,1 / 1,0 / 1,1; R touches the wasteland 0,0. */
const K = "0,1|1,0|1,1";
const R = "0,0|0,1|1,0";
const FULL = { wood: 6, clay: 6, wool: 6, grain: 6, ore: 6 };

/** A with a settlement at V1 and roads along the first `roads` steps of a path from it. */
function network(roads: number, playerId = A): { state: ReturnType<typeof crownGame>; path: VertexId[] } {
  const path = vertexPath(V1, roads + 1);
  let s = place(inPhase(crownGame(), ACTION_PHASE, playerId), playerId, { settlements: [V1], roads: pathEdges(path.slice(0, roads + 1)) });
  s = give(s, playerId, FULL);
  return { state: s, path };
}

function offPath(v: VertexId, path: readonly VertexId[]): VertexId {
  const m = GEOMETRY.vertexNeighbors[v]!.find((n) => !path.includes(n));
  if (!m) throw new Error("no side vertex");
  return m;
}

describe("docs/phase11.md §5 knights", () => {
  it("docs/phase11.md §5 a knight costs wool + ore, stands inactive on a free vertex of the player's roads, two basic pieces per player", () => {
    const { state: s, path } = network(2);
    const [, n1, n2, n3] = path as [VertexId, VertexId, VertexId, VertexId];
    expect([...ownRoadVertices(s, A)].sort()).toEqual([V1, n1, n2].sort());
    expect(legalActions(s, A).filter((a) => a.type === "BUILD_KNIGHT").map((a) => a.type === "BUILD_KNIGHT" && a.vertex).sort()).toEqual([n1, n2].sort());
    const { state: built, events } = applyActionWithEvents(s, { type: "BUILD_KNIGHT", playerId: A, vertex: n1 });
    expect(getPlayer(built, A).hand).toEqual({ ...FULL, wool: 5, ore: 5 });
    expect(knightAt(built, n1)).toEqual({ owner: A, at: n1, level: 1, active: false, actedThisTurn: true, builtOnTurn: 0 });
    expect(events.some((e) => e.kind === "knightBuilt" && e.vertex === n1)).toBe(true);
    expectRule(() => applyAction(built, { type: "BUILD_KNIGHT", playerId: A, vertex: n1 }), "VERTEX_HAS_KNIGHT");
    expectRule(() => applyAction(built, { type: "BUILD_KNIGHT", playerId: A, vertex: V1 }), "VERTEX_OCCUPIED");
    expectRule(() => applyAction(built, { type: "BUILD_KNIGHT", playerId: A, vertex: n3 }), "KNIGHT_NOT_CONNECTED");
    expectRule(() => applyAction(built, { type: "BUILD_KNIGHT", playerId: A, vertex: "9,9|9,10|10,9" }), "INVALID_VERTEX");
    expectRule(() => applyAction(built, { type: "BUILD_KNIGHT", playerId: A, hex: "1,0" }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(built, { type: "BUILD_KNIGHT", playerId: B, vertex: n2 }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(inPhase(built, ROLL_PHASE), { type: "BUILD_KNIGHT", playerId: A, vertex: n2 }), "WRONG_PHASE");
    const poor = mut(built, (x) => void (getPlayer(x, A).hand.ore = 0));
    expectRule(() => applyAction(poor, { type: "BUILD_KNIGHT", playerId: A, vertex: n2 }), "INSUFFICIENT_RESOURCES");
    expect(legalActions(poor, A).some((a) => a.type === "BUILD_KNIGHT")).toBe(false);
    // Supply: two basic knights per player.
    const { state: longer, path: p } = network(3);
    const two = addKnight(addKnight(longer, A, p[1]!), A, p[2]!);
    expectRule(() => applyAction(two, { type: "BUILD_KNIGHT", playerId: A, vertex: p[3]! }), "NO_KNIGHTS_LEFT");
    expect(legalActions(two, A).some((a) => a.type === "BUILD_KNIGHT")).toBe(false);
  });

  it("docs/phase11.md §5 activating costs 1 grain; an activated knight acts from the next turn on", () => {
    const { state: s, path } = network(2);
    const [, n1, n2] = path as [VertexId, VertexId, VertexId];
    const idle = addKnight(s, A, n1);
    expect(legalActions(idle, A).filter((a) => a.type === "ACTIVATE_KNIGHT")).toEqual([{ type: "ACTIVATE_KNIGHT", playerId: A, vertex: n1 }]);
    expect(legalActions(idle, A).some((a) => a.type === "KNIGHT_MOVE")).toBe(false);
    const { state: active, events } = applyActionWithEvents(idle, { type: "ACTIVATE_KNIGHT", playerId: A, vertex: n1 });
    expect(getPlayer(active, A).hand.grain).toBe(5);
    expect(knightAt(active, n1)).toMatchObject({ active: true, actedThisTurn: true });
    expect(events.some((e) => e.kind === "knightActivated" && e.free === false)).toBe(true);
    expectRule(() => applyAction(active, { type: "ACTIVATE_KNIGHT", playerId: A, vertex: n1 }), "KNIGHT_ALREADY_ACTIVE");
    expectRule(() => applyAction(active, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n2 }), "KNIGHT_ACTED");
    expect(legalActions(active, A).some((a) => a.type === "KNIGHT_MOVE")).toBe(false);
    expectRule(() => applyAction(idle, { type: "ACTIVATE_KNIGHT", playerId: A, vertex: n2 }), "NO_KNIGHT");
    expectRule(() => applyAction(inPhase(idle, ACTION_PHASE, B), { type: "ACTIVATE_KNIGHT", playerId: B, vertex: n1 }), "NOT_YOUR_KNIGHT");
    expectRule(() => applyAction(idle, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n2 }), "KNIGHT_INACTIVE");
    // The flag clears when the next turn starts.
    const next = applyAction(active, { type: "END_TURN", playerId: A });
    expect(knightAt(next, n1)).toMatchObject({ active: true, actedThisTurn: false });
    expect(crownOf(next).players[A]!.progressPlayedThisTurn).toBe(0);
  });

  it("docs/phase11.md §5 promotion costs wool + ore per level; level 3 needs politics 3; two pieces per level", () => {
    const { state: s, path } = network(3);
    const [, n1, n2, n3] = path as [VertexId, VertexId, VertexId, VertexId];
    const one = addKnight(s, A, n1);
    const { state: two, events } = applyActionWithEvents(one, { type: "PROMOTE_KNIGHT", playerId: A, vertex: n1 });
    expect(knightAt(two, n1)!.level).toBe(2);
    expect(getPlayer(two, A).hand).toEqual({ ...FULL, wool: 5, ore: 5 });
    expect(events.some((e) => e.kind === "knightPromoted" && e.level === 2)).toBe(true);
    expectRule(() => applyAction(two, { type: "PROMOTE_KNIGHT", playerId: A, vertex: n1 }), "NEEDS_POLITICS");
    expect(legalActions(two, A).some((a) => a.type === "PROMOTE_KNIGHT")).toBe(false);
    const politics = setTrack(two, A, "politics", 3);
    expect(legalActions(politics, A).some((a) => a.type === "PROMOTE_KNIGHT" && a.vertex === n1)).toBe(true);
    const three = applyAction(politics, { type: "PROMOTE_KNIGHT", playerId: A, vertex: n1 });
    expect(knightAt(three, n1)!.level).toBe(3);
    expectRule(() => applyAction(three, { type: "PROMOTE_KNIGHT", playerId: A, vertex: n1 }), "KNIGHT_MAX_LEVEL");
    // Both strong pieces out: a basic knight cannot become strong.
    const full = addKnight(addKnight(addKnight(s, A, n1), A, n2, 2), A, n3, 2);
    expectRule(() => applyAction(full, { type: "PROMOTE_KNIGHT", playerId: A, vertex: n1 }), "NO_KNIGHTS_LEFT");
    expect(legalActions(full, A).some((a) => a.type === "PROMOTE_KNIGHT")).toBe(false);
  });

  it("docs/phase11.md §5 an active knight moves along the player's roads to a free vertex and is spent for the turn", () => {
    const { state: s, path } = network(3);
    const [, n1, n2, n3, n4] = path as [VertexId, VertexId, VertexId, VertexId, VertexId];
    const ready = addKnight(s, A, n1, 1, true);
    expect(knightDestinations(ready, A, n1).sort()).toEqual([n2, n3].sort());
    expect(legalActions(ready, A).filter((a) => a.type === "KNIGHT_MOVE").map((a) => a.type === "KNIGHT_MOVE" && a.to).sort()).toEqual([n2, n3].sort());
    const { state: moved, events } = applyActionWithEvents(ready, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n3 });
    expect(knightAt(moved, n1)).toBeNull();
    expect(knightAt(moved, n3)).toMatchObject({ owner: A, active: false, actedThisTurn: true });
    expect(events.some((e) => e.kind === "knightMoved" && e.from === n1 && e.to === n3)).toBe(true);
    expectRule(() => applyAction(ready, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n4 }), "KNIGHT_NOT_CONNECTED");
    expectRule(() => applyAction(ready, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: V1 }), "VERTEX_OCCUPIED");
    expectRule(() => applyAction(ready, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n1 }), "INVALID_VERTEX");
    // An opposing knight on the way blocks the road; an own knight does not.
    const blocked = addKnight(ready, B, n2);
    expect([...reachableVertices(blocked, A, n1)].sort()).toEqual([V1, n2].sort());
    expect(knightDestinations(blocked, A, n1)).toEqual([]);
    expectRule(() => applyAction(blocked, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n2 }), "VERTEX_HAS_KNIGHT");
    expectRule(() => applyAction(blocked, { type: "KNIGHT_MOVE", playerId: A, from: n1, to: n3 }), "KNIGHT_NOT_CONNECTED");
    const own = addKnight(ready, A, n2);
    expect(knightDestinations(own, A, n1)).toEqual([n3]);
  });

  it("docs/phase11.md §5 a stronger knight displaces a weaker opposing one, which retreats along its owner's roads or is removed", () => {
    const { state: s, path } = network(2);
    const [, n1, n2] = path as [VertexId, VertexId, VertexId];
    const m = offPath(n2, path);
    let base = addKnight(addKnight(s, A, n1, 2, true), B, n2, 1, false);
    expectRule(() => applyAction(addKnight(addKnight(s, A, n1, 1, true), B, n2, 1), { type: "KNIGHT_DISPLACE", playerId: A, from: n1, to: n2 }), "NOT_STRONGER");
    expectRule(() => applyAction(addKnight(addKnight(s, A, n1, 2, true), A, n2, 1), { type: "KNIGHT_DISPLACE", playerId: A, from: n1, to: n2 }), "VERTEX_HAS_KNIGHT");
    expectRule(() => applyAction(base, { type: "KNIGHT_DISPLACE", playerId: A, from: n1, to: m }), "NO_KNIGHT");
    // No road of B's touches n2: the knight is simply removed.
    const { state: gone, events: goneEvents } = applyActionWithEvents(base, { type: "KNIGHT_DISPLACE", playerId: A, from: n1, to: n2 });
    expect(gone.phase).toEqual({ kind: "action" });
    expect(knightAt(gone, n2)).toMatchObject({ owner: A, level: 2, active: false, actedThisTurn: true });
    expect(crownOf(gone).knights).toHaveLength(1);
    expect(goneEvents.map((e) => e.kind)).toEqual(["knightDisplaced", "knightRemoved"]);
    // With a road to retreat along, B chooses.
    base = place(base, B, { roads: [edgeBetween(n2, m)] });
    expect(legalActions(base, A).some((a) => a.type === "KNIGHT_DISPLACE" && a.from === n1 && a.to === n2)).toBe(true);
    const { state: asked, events } = applyActionWithEvents(base, { type: "KNIGHT_DISPLACE", playerId: A, from: n1, to: n2 });
    expect(events.map((e) => e.kind)).toEqual(["knightDisplaced"]);
    expect(asked.phase.kind).toBe("modulePrompt");
    if (asked.phase.kind !== "modulePrompt") throw new Error("unreachable");
    expect(asked.phase.prompt).toEqual({ kind: "knightRetreat", playerId: B, level: 1, active: false, from: n2, pending: [] });
    expect(nextActor(asked)).toBe(B);
    expect(legalActions(asked, B)).toEqual([
      { type: "RETREAT_KNIGHT", playerId: B, vertex: m },
      { type: "RETREAT_KNIGHT", playerId: B, vertex: null },
    ]);
    expectRule(() => applyAction(asked, { type: "RETREAT_KNIGHT", playerId: B, vertex: n1 }), "INVALID_CHOICE");
    expectRule(() => applyAction(asked, { type: "RETREAT_KNIGHT", playerId: A, vertex: m }), "NOT_YOUR_PROMPT");
    const { state: retreated, events: retreatEvents } = applyActionWithEvents(asked, { type: "RETREAT_KNIGHT", playerId: B, vertex: m });
    expect(retreated.phase).toEqual({ kind: "action" });
    expect(knightAt(retreated, m)).toMatchObject({ owner: B, level: 1, active: false });
    expect(retreatEvents.some((e) => e.kind === "knightRetreated" && e.from === n2 && e.to === m)).toBe(true);
    const removed = applyAction(asked, { type: "RETREAT_KNIGHT", playerId: B, vertex: null });
    expect(removed.phase).toEqual({ kind: "action" });
    expect(crownOf(removed).knights.filter((k) => k.owner === B)).toHaveLength(0);
  });

  it("docs/phase11.md §5 an active knight next to the robber chases it away (owner moves it), but not before the first attack", () => {
    let s = place(inPhase(crownGame(), ACTION_PHASE, A), A, { cities: [V1], roads: [edgeBetween(V1, K), edgeBetween(K, R)] });
    s = addKnight(addKnight(s, A, R, 1, true), A, K, 1, true);
    expect(s.robberHex).toBe("0,0");
    expectRule(() => applyAction(s, { type: "KNIGHT_CHASE_ROBBER", playerId: A, vertex: R }), "ROBBER_LOCKED");
    expect(legalActions(s, A).some((a) => a.type === "KNIGHT_CHASE_ROBBER")).toBe(false);
    const unlocked = mut(s, (x) => void (crownOf(x).attacks = 1));
    expect(legalActions(unlocked, A).filter((a) => a.type === "KNIGHT_CHASE_ROBBER")).toEqual([{ type: "KNIGHT_CHASE_ROBBER", playerId: A, vertex: R }]);
    expectRule(() => applyAction(unlocked, { type: "KNIGHT_CHASE_ROBBER", playerId: A, vertex: K }), "NOT_ADJACENT");
    const { state: chased, events } = applyActionWithEvents(unlocked, { type: "KNIGHT_CHASE_ROBBER", playerId: A, vertex: R });
    expect(chased.phase).toEqual({ kind: "moveRobber", via: "knight", returnTo: "action" });
    expect(knightAt(chased, R)).toMatchObject({ active: false, actedThisTurn: true });
    expect(events.some((e) => e.kind === "robberChased" && e.vertex === R)).toBe(true);
    expectRule(() => applyAction(chased, { type: "MOVE_ROBBER", playerId: A, hex: "0,0" }), "ROBBER_MUST_MOVE");
    const moved = applyAction(chased, { type: "MOVE_ROBBER", playerId: A, hex: "1,0" });
    expect(moved.robberHex).toBe("1,0");
    expect(moved.phase).toEqual({ kind: "action" });
  });

  it("docs/phase11.md §5 knights block settlements at their vertex and opposing roads through it", () => {
    const { state: s, path } = network(1);
    const [, n1, n2] = path as [VertexId, VertexId, VertexId];
    const theirs = addKnight(s, B, n1);
    expectRule(() => applyAction(theirs, { type: "BUILD_SETTLEMENT", playerId: A, vertex: n1 }), "VERTEX_HAS_KNIGHT");
    expect(legalSettlementVertices(theirs, A)).not.toContain(n1);
    expect(roadConnects(theirs, A, edgeBetween(n1, n2))).toBe(false);
    expectRule(() => applyAction(theirs, { type: "BUILD_ROAD", playerId: A, edge: edgeBetween(n1, n2) }), "ROAD_NOT_CONNECTED");
    // An own knight blocks the settlement too but not the road.
    const mine = addKnight(s, A, n1);
    expectRule(() => applyAction(mine, { type: "BUILD_SETTLEMENT", playerId: A, vertex: n1 }), "VERTEX_HAS_KNIGHT");
    expect(roadConnects(mine, A, edgeBetween(n1, n2))).toBe(true);
    expect(applyAction(mine, { type: "BUILD_ROAD", playerId: A, edge: edgeBetween(n1, n2) }).phase).toEqual({ kind: "action" });
  });

  it("docs/phase11.md §5 an opposing knight on a road breaks it: Longest Road is lost when the trail falls below five", () => {
    const start = clearStart(5, [V1]);
    const path = vertexPath(start, 5);
    let s = place(inPhase(crownGame(), ACTION_PHASE, B), A, { roads: pathEdges(path) });
    expect(s.longestRoad).toEqual({ playerId: A, length: 5 });
    const mid = path[2]!;
    const side = offPath(mid, path);
    s = place(s, B, { roads: [edgeBetween(mid, side)] });
    s = addKnight(s, B, side, 1, true);
    const { state: broken, events } = applyActionWithEvents(s, { type: "KNIGHT_MOVE", playerId: B, from: side, to: mid });
    expect(longestRoadLength(broken, A)).toBe(3);
    expect(broken.longestRoad).toEqual({ playerId: null, length: 0 });
    expect(events.some((e) => e.kind === "specialCardMoved" && e.card === "longestRoad" && e.from === A && e.to === null)).toBe(true);
    expect(roadConnects(broken, A, edgeBetween(mid, offPath(mid, [...path, side])))).toBe(false);
  });

  it("docs/phase11.md §5 first-attack rule: a seven only forces discards until the fleet has attacked once", () => {
    let s = give(inPhase(crownGame(), ROLL_PHASE, A), B, { wood: 8 });
    const locked = applyAction(withNextCrownRoll(s, 7, "trade"), { type: "ROLL", playerId: A });
    expect(locked.phase).toEqual({ kind: "discard", returnTo: { kind: "action" } });
    const quiet = applyAction(withNextRoll(inPhase(crownGame(), ROLL_PHASE, A), 7), { type: "ROLL", playerId: A });
    expect(quiet.phase).toEqual({ kind: "action" });
    s = mut(s, (x) => void (crownOf(x).attacks = 1));
    const open = applyAction(withNextCrownRoll(s, 7, "trade"), { type: "ROLL", playerId: A });
    expect(open.phase).toEqual({ kind: "discard", returnTo: { kind: "moveRobber", via: "seven", returnTo: "action" } });
  });
});
