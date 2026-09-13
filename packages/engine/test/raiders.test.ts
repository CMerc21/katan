import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { boardGeometry, RESOURCES, TERRAIN_RESOURCE } from "../src/board";
import { createGame } from "../src/game";
import type { HexId, VertexId } from "../src/geometry";
import { legalActions } from "../src/legal";
import { standardFrame } from "../src/frames";
import { coastalHexes, GUARD_COST, hexDefense, hexStrength, raidersState, REBUILD_COST } from "../src/modules/wayfarers/raiders";
import { MAX_GUARDS, RAIDER_LANDING } from "../src/modules/types";
import type { Scenario } from "../src/scenario";
import { getPlayer, handSize, nextActor, victoryPoints } from "../src/state";
import type { Action, GameState, PlayerId } from "../src/types";
import { ACTION_PHASE, FOUR, ROLL_PHASE, expectRule, finishSetup, give, inPhase, mut, newGame, place, playRandomGame, withNextRoll } from "./helpers";

const scenario: Scenario = {
  id: "raiders-test",
  name: "Raiders test",
  board: standardFrame(),
  modules: {},
  variants: { raiders: true },
  victoryPoints: 12,
};

function raidersGame(seed = "raiders"): GameState {
  return createGame({ seed, players: FOUR, scenario });
}

/** Setup including the castle prompts: whoever must act takes the first legal action until the first roll. */
function completeSetup(start: GameState): GameState {
  let state = start;
  let guard = 0;
  while (state.phase.kind !== "roll") {
    const who = nextActor(state);
    const action = legalActions(state, who)[0];
    if (!action) throw new Error(`no legal action for ${who} in ${state.phase.kind}`);
    state = applyAction(state, action);
    if (++guard > 200) throw new Error("setup did not finish");
  }
  return state;
}

/** Play setup until the first castle prompt appears. */
function untilCastlePrompt(start: GameState): GameState {
  let state = start;
  while (state.phase.kind !== "modulePrompt") {
    const who = nextActor(state);
    const action = legalActions(state, who)[0];
    if (!action) throw new Error("no legal action");
    state = applyAction(state, action);
  }
  return state;
}

/** A corner of `hex` that touches no other board hex (every coastal hex of the standard frame has one). */
function exclusiveCorner(state: GameState, hex: HexId): VertexId {
  const geo = boardGeometry(state.board);
  const v = (geo.hexVertices[hex] ?? []).find((x) => (geo.vertexHexes[x] ?? []).length === 1);
  if (!v) throw new Error(`no exclusive corner on ${hex}`);
  return v;
}

/** Coastal hexes with a number token that are not under the robber. */
function tokenedCoast(state: GameState): HexId[] {
  return coastalHexes(state).filter((h) => state.board.hexes[h]?.token !== null && h !== state.robberHex);
}

/** Independent VP recount: buildings, special cards, castle, rebuilt hexes, VP cards. */
function recount(state: GameState, id: PlayerId): number {
  const p = getPlayer(state, id);
  const r = raidersState(state);
  let n = p.settlements.length + 2 * p.cities.length;
  if (state.longestRoad.playerId === id) n += 2;
  if (state.largestArmy.playerId === id) n += 2;
  if (r.castles[id] !== null && r.castles[id] !== undefined) n += 1;
  n += r.rebuilt[id] ?? 0;
  n += p.devCards.filter((c) => c.type === "victoryPoint").length;
  return n;
}

function cardsInPlay(state: GameState): number {
  return handSize(state.bank) + state.players.reduce((n, p) => n + handSize(p.hand), 0);
}

/**
 * The landing position (docs/phase10.md §5): four coastal hexes with a
 * building each, one inland settlement, guards and a castle, the counter
 * two steps short of a landing (the two cities on the board close the gap).
 */
function landingPosition(): { state: GameState; undefended: HexId; defended: HexId; castle: HexId; weak: HexId; inland: HexId } {
  const base = raidersGame("landing");
  const [undefended, defended, castle, weak] = tokenedCoast(base) as [HexId, HexId, HexId, HexId];
  const geo = boardGeometry(base.board);
  const inland = "0,0";
  const inlandCorner = geo.hexVertices[inland]?.[0] as VertexId;
  let state = place(base, "a", { settlements: [exclusiveCorner(base, undefended), inlandCorner] });
  state = place(state, "b", { cities: [exclusiveCorner(base, defended)] });
  state = place(state, "c", { settlements: [exclusiveCorner(base, castle)] });
  state = place(state, "d", { cities: [exclusiveCorner(base, weak)] });
  state = mut(state, (s) => {
    const r = raidersState(s);
    r.castles.c = exclusiveCorner(s, castle);
    r.guards.b = [defended];
    r.guards.c = [defended, castle];
    r.guards.d = [weak];
    r.counter = RAIDER_LANDING - 2;
  });
  return { state: inPhase(state, ROLL_PHASE, "a"), undefended, defended, castle, weak, inland };
}

describe("docs/phase10.md §5 Raiders", () => {
  it("docs/phase10.md §5 the variant off leaves wayfarers null and never asks for a castle", () => {
    const state = newGame();
    expect(state.wayfarers).toBeNull();
    const done = finishSetup(state);
    expect(done.phase.kind).toBe("roll");
    expect(done.wayfarers).toBeNull();
    expect(legalActions(done, "a").some((a) => a.type === "BUILD_CASTLE" || a.type === "BUILD_KNIGHT" || a.type === "REBUILD_HEX")).toBe(false);
    expectRule(() => applyAction(inPhase(done, ACTION_PHASE, "a"), { type: "BUILD_KNIGHT", playerId: "a", hex: "0,0" }), "MODULE_OFF");
  });

  it("docs/phase10.md §5 the variant starts with an empty raiders state and twelve coastal hexes", () => {
    const state = raidersGame();
    const r = raidersState(state);
    expect(r.counter).toBe(0);
    expect(r.landings).toBe(0);
    expect(r.raided).toEqual([]);
    for (const p of state.players) {
      expect(r.castles[p.id]).toBeNull();
      expect(r.guards[p.id]).toEqual([]);
      expect(r.rebuilt[p.id]).toBe(0);
    }
    expect(coastalHexes(state)).toHaveLength(12);
    expect(coastalHexes(state)).not.toContain("0,0");
  });

  it("docs/phase10.md §5 after the second setup settlement the player picks a castle before the road", () => {
    const state = untilCastlePrompt(raidersGame());
    expect(state.phase.kind).toBe("modulePrompt");
    if (state.phase.kind !== "modulePrompt") return;
    const prompt = state.phase.prompt;
    expect(prompt.kind).toBe("placeCastle");
    // Round 2 starts with the last seat; the prompt wraps the pending road step.
    expect(prompt.playerId).toBe("d");
    expect(nextActor(state)).toBe("d");
    expect(state.phase.returnTo).toEqual({ kind: "setup", round: 2, step: "road", lastSettlement: getPlayer(state, "d").settlements[1] });

    const legal = legalActions(state, "d");
    expect(legal).toHaveLength(2);
    expect(legal.every((a) => a.type === "BUILD_CASTLE")).toBe(true);
    expect(legalActions(state, "a")).toEqual([]);
    expect(legalActions(state, "d").some((a) => a.type === "BUILD_ROAD")).toBe(false);

    const own = getPlayer(state, "d").settlements[0] as VertexId;
    const foreign = getPlayer(state, "a").settlements[0] as VertexId;
    expectRule(() => applyAction(state, { type: "BUILD_CASTLE", playerId: "a", vertex: foreign }), "NOT_YOUR_PROMPT");
    expectRule(() => applyAction(state, { type: "BUILD_CASTLE", playerId: "d", vertex: foreign }), "NOT_YOUR_SETTLEMENT");
    expectRule(() => applyAction(state, { type: "BUILD_ROAD", playerId: "d", edge: "x" }), "WRONG_PHASE");

    const { state: next, events } = applyActionWithEvents(state, { type: "BUILD_CASTLE", playerId: "d", vertex: own });
    expect(events.some((e) => e.kind === "castleBuilt" && e.playerId === "d" && e.vertex === own)).toBe(true);
    expect(raidersState(next).castles.d).toBe(own);
    expect(next.phase).toEqual({ kind: "setup", round: 2, step: "road", lastSettlement: getPlayer(next, "d").settlements[1] });
    expect(getPlayer(next, "d").settlements).toContain(own); // still a settlement
    expect(victoryPoints(next, getPlayer(next, "d"))).toEqual({ publicVP: 3, hiddenVP: 0, total: 3 });
    // Outside the prompt a castle cannot be built.
    expectRule(() => applyAction(next, { type: "BUILD_CASTLE", playerId: "d", vertex: own }), "WRONG_PHASE");
  });

  it("docs/phase10.md §5 every player ends setup with a castle worth one point that may still become a city", () => {
    const done = completeSetup(raidersGame());
    expect(done.phase.kind).toBe("roll");
    const r = raidersState(done);
    for (const p of done.players) {
      expect(p.settlements).toContain(r.castles[p.id]);
      expect(victoryPoints(done, p).total).toBe(3);
    }
    const castle = r.castles.a as VertexId;
    const rich = give(inPhase(done, ACTION_PHASE, "a"), "a", { grain: 2, ore: 3 });
    const upgraded = applyAction(rich, { type: "BUILD_CITY", playerId: "a", vertex: castle });
    expect(getPlayer(upgraded, "a").cities).toContain(castle);
    expect(raidersState(upgraded).castles.a).toBe(castle);
    expect(victoryPoints(upgraded, getPlayer(upgraded, "a")).total).toBe(4);
  });

  it("docs/phase10.md §5 a seven advances the counter by the number of cities on the board", () => {
    const done = completeSetup(raidersGame());
    // No cities yet: a seven leaves the counter alone and the robber still moves.
    const quiet = applyActionWithEvents(withNextRoll(inPhase(done, ROLL_PHASE, "a"), 7), { type: "ROLL", playerId: "a" });
    expect(raidersState(quiet.state).counter).toBe(0);
    expect(quiet.events.some((e) => e.kind === "raidersAdvanced")).toBe(false);
    expect(["discard", "moveRobber"]).toContain(quiet.state.phase.kind);

    const geo = boardGeometry(done.board);
    const free = geo.vertices.filter((v) => done.players.every((p) => !p.settlements.includes(v) && !p.cities.includes(v)));
    const withCities = place(place(done, "a", { cities: [free[0] as VertexId, free[1] as VertexId] }), "b", { cities: [free[2] as VertexId] });
    const { state, events } = applyActionWithEvents(withNextRoll(inPhase(withCities, ROLL_PHASE, "a"), 7), { type: "ROLL", playerId: "a" });
    expect(raidersState(state).counter).toBe(3);
    expect(raidersState(state).landings).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ kind: "raidersAdvanced", steps: 3, counter: 3 }));
    expect(["discard", "moveRobber"]).toContain(state.phase.kind);
    // A non-seven never moves the counter.
    const eight = applyAction(withNextRoll(inPhase(withCities, ROLL_PHASE, "a"), 8), { type: "ROLL", playerId: "a" });
    expect(raidersState(eight).counter).toBe(0);
  });

  it("docs/phase10.md §5 at fifteen the raiders land: undefended coast is raided, guarded hexes hold, castles are immune", () => {
    const { state, undefended, defended, castle, weak, inland } = landingPosition();
    expect(hexStrength(state, undefended)).toBe(1);
    expect(hexStrength(state, defended)).toBe(2);
    expect(hexDefense(state, defended)).toBe(2);
    expect(hexStrength(state, castle)).toBe(0);
    expect(hexStrength(state, weak)).toBe(2);
    expect(hexDefense(state, weak)).toBe(1);

    const { state: after, events } = applyActionWithEvents(withNextRoll(state, 7), { type: "ROLL", playerId: "a" });
    const r = raidersState(after);
    expect(events).toContainEqual(expect.objectContaining({ kind: "raidersAdvanced", steps: 2, counter: RAIDER_LANDING }));
    const raid = events.find((e) => e.kind === "raid");
    expect(raid).toBeDefined();
    if (!raid || raid.kind !== "raid") return;
    expect([...raid.raided].sort()).toEqual([undefended, weak].sort());
    expect(raid.defended).toEqual([defended]);
    expect(raid.guardsLost).toEqual([{ playerId: "d", hex: weak }]);
    expect([...r.raided].sort()).toEqual([undefended, weak].sort());
    expect(r.raided).not.toContain(inland);
    expect(r.raided).not.toContain(castle);
    expect(r.guards.d).toEqual([]);
    expect(r.guards.b).toEqual([defended]);
    expect(r.guards.c).toEqual([defended, castle]);
    expect(r.counter).toBe(0);
    expect(r.landings).toBe(1);
    expect(after.phase.kind).toBe("moveRobber");
    // The raid comes after the counter event and before the robber.
    const order = events.map((e) => e.kind);
    expect(order.indexOf("raidersAdvanced")).toBeLessThan(order.indexOf("raid"));
  });

  it("docs/phase10.md §5 a raided hex produces nothing until someone rebuilds it for one ore and one wool (+1 VP)", () => {
    const base = raidersGame("rebuild");
    const [hex, other] = tokenedCoast(base) as [HexId, HexId];
    const tile = base.board.hexes[hex]!;
    const token = tile.token as number;
    const resource = TERRAIN_RESOURCE[tile.terrain] as keyof GameState["bank"];
    const corner = exclusiveCorner(base, hex);
    const raided = mut(place(base, "a", { settlements: [corner] }), (s) => void raidersState(s).raided.push(hex));

    const blocked = applyAction(withNextRoll(inPhase(raided, ROLL_PHASE, "a"), token), { type: "ROLL", playerId: "a" });
    expect(handSize(getPlayer(blocked, "a").hand)).toBe(0);

    const acting = inPhase(raided, ACTION_PHASE, "a");
    expect(legalActions(acting, "a").some((a) => a.type === "REBUILD_HEX")).toBe(false); // cannot afford
    expectRule(() => applyAction(acting, { type: "REBUILD_HEX", playerId: "a", hex }), "INSUFFICIENT_RESOURCES");
    const rich = give(acting, "a", { ore: 1, wool: 1 });
    expect(legalActions(rich, "a").filter((a) => a.type === "REBUILD_HEX")).toEqual([{ type: "REBUILD_HEX", playerId: "a", hex }]);
    expectRule(() => applyAction(rich, { type: "REBUILD_HEX", playerId: "a", hex: other }), "NOT_RAIDED");
    expectRule(() => applyAction(rich, { type: "REBUILD_HEX", playerId: "b", hex }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(inPhase(rich, ROLL_PHASE, "a"), { type: "REBUILD_HEX", playerId: "a", hex }), "WRONG_PHASE");

    const { state: rebuilt, events } = applyActionWithEvents(rich, { type: "REBUILD_HEX", playerId: "a", hex });
    expect(events).toContainEqual(expect.objectContaining({ kind: "hexRebuilt", playerId: "a", hex }));
    expect(raidersState(rebuilt).raided).toEqual([]);
    expect(raidersState(rebuilt).rebuilt.a).toBe(1);
    expect(handSize(getPlayer(rebuilt, "a").hand)).toBe(0);
    expect(cardsInPlay(rebuilt)).toBe(95);
    expect(victoryPoints(rebuilt, getPlayer(rebuilt, "a")).publicVP).toBe(2); // settlement + rebuilt hex
    expectRule(() => applyAction(give(rebuilt, "a", REBUILD_COST), { type: "REBUILD_HEX", playerId: "a", hex }), "NOT_RAIDED");

    const producing = applyAction(withNextRoll(inPhase(rebuilt, ROLL_PHASE, "a"), token), { type: "ROLL", playerId: "a" });
    expect(getPlayer(producing, "a").hand[resource]).toBeGreaterThanOrEqual(1);

    // Any player may rebuild any raided hex, not only those who touch it.
    const foreign = give(inPhase(raided, ACTION_PHASE, "b"), "b", { ore: 1, wool: 1 });
    const byB = applyAction(foreign, { type: "REBUILD_HEX", playerId: "b", hex });
    expect(raidersState(byB).rebuilt.b).toBe(1);
    expect(victoryPoints(byB, getPlayer(byB, "b")).total).toBe(1);
  });

  it("docs/phase10.md §5 guards cost one ore and one wool and stand on a land hex the player touches", () => {
    const done = completeSetup(raidersGame());
    const geo = boardGeometry(done.board);
    const a = getPlayer(done, "a");
    const touched = new Set<HexId>();
    for (const v of a.settlements) for (const h of geo.vertexHexes[v] ?? []) if (done.board.hexes[h]) touched.add(h);
    const untouched = Object.keys(done.board.hexes).find((h) => !touched.has(h)) as HexId;
    const hex = [...touched][0] as HexId;

    const poor = inPhase(done, ACTION_PHASE, "a");
    expect(legalActions(poor, "a").some((x) => x.type === "BUILD_KNIGHT")).toBe(false);
    expectRule(() => applyAction(poor, { type: "BUILD_KNIGHT", playerId: "a", hex }), "INSUFFICIENT_RESOURCES");

    const rich = give(poor, "a", { ore: 2, wool: 2 });
    const listed = legalActions(rich, "a").filter((x): x is Extract<Action, { type: "BUILD_KNIGHT" }> => x.type === "BUILD_KNIGHT");
    expect(new Set(listed.map((x) => x.hex))).toEqual(touched);
    expectRule(() => applyAction(rich, { type: "BUILD_KNIGHT", playerId: "a", hex: untouched }), "HEX_NOT_TOUCHED");
    expectRule(() => applyAction(rich, { type: "BUILD_KNIGHT", playerId: "a", hex: "9,9" }), "INVALID_HEX");
    expectRule(() => applyAction(rich, { type: "BUILD_KNIGHT", playerId: "a" }), "INVALID_PAYLOAD");
    expectRule(() => applyAction(rich, { type: "BUILD_KNIGHT", playerId: "b", hex }), "NOT_YOUR_TURN");
    expectRule(() => applyAction(inPhase(rich, ROLL_PHASE, "a"), { type: "BUILD_KNIGHT", playerId: "a", hex }), "WRONG_PHASE");

    const { state: one, events } = applyActionWithEvents(rich, { type: "BUILD_KNIGHT", playerId: "a", hex });
    expect(events).toContainEqual(expect.objectContaining({ kind: "guardPlaced", playerId: "a", hex }));
    expect(raidersState(one).guards.a).toEqual([hex]);
    expect(getPlayer(one, "a").hand).toEqual({ ...getPlayer(rich, "a").hand, ore: getPlayer(rich, "a").hand.ore - GUARD_COST.ore, wool: getPlayer(rich, "a").hand.wool - GUARD_COST.wool });
    expect(cardsInPlay(one)).toBe(95);
    expect(hexDefense(one, hex)).toBe(1);
    // Several guards may share a hex.
    const two = applyAction(one, { type: "BUILD_KNIGHT", playerId: "a", hex });
    expect(raidersState(two).guards.a).toEqual([hex, hex]);
    expect(hexDefense(two, hex)).toBe(2);
    // A raided hex must be rebuilt before it can be guarded.
    const ravaged = mut(give(one, "a", { ore: 1, wool: 1 }), (s) => void raidersState(s).raided.push(hex));
    expect(legalActions(ravaged, "a").some((x) => x.type === "BUILD_KNIGHT" && x.hex === hex)).toBe(false);
    expectRule(() => applyAction(ravaged, { type: "BUILD_KNIGHT", playerId: "a", hex }), "INVALID_HEX");
    // The special build phase (5–6 players) allows guards too.
    const special = give(inPhase(done, { kind: "specialBuild", order: ["b"], index: 0 }, "a"), "b", { ore: 1, wool: 1 });
    const bHex = geo.vertexHexes[getPlayer(done, "b").settlements[0] as VertexId]?.find((h) => done.board.hexes[h] !== undefined) as HexId;
    expect(legalActions(special, "b").some((x) => x.type === "BUILD_KNIGHT" && x.hex === bHex)).toBe(true);
    expect(raidersState(applyAction(special, { type: "BUILD_KNIGHT", playerId: "b", hex: bHex })).guards.b).toEqual([bHex]);
  });

  it("docs/phase10.md §5 a player has at most six guards", () => {
    const done = completeSetup(raidersGame());
    const geo = boardGeometry(done.board);
    const hex = geo.vertexHexes[getPlayer(done, "a").settlements[0] as VertexId]?.find((h) => done.board.hexes[h] !== undefined) as HexId;
    let state = give(inPhase(done, ACTION_PHASE, "a"), "a", { ore: MAX_GUARDS + 1, wool: MAX_GUARDS + 1 });
    for (let i = 0; i < MAX_GUARDS; i++) state = applyAction(state, { type: "BUILD_KNIGHT", playerId: "a", hex });
    expect(raidersState(state).guards.a).toHaveLength(MAX_GUARDS);
    expect(legalActions(state, "a").some((x) => x.type === "BUILD_KNIGHT")).toBe(false);
    expectRule(() => applyAction(state, { type: "BUILD_KNIGHT", playerId: "a", hex }), "NO_KNIGHTS_LEFT");
    // Guards lost in a raid return to the supply.
    const ravaged = mut(state, (s) => {
      const r = raidersState(s);
      r.guards.a = [];
      r.raided.push(hex);
    });
    const other = geo.vertexHexes[getPlayer(done, "a").settlements[1] as VertexId]?.find((h) => done.board.hexes[h] !== undefined && h !== hex) as HexId;
    expect(raidersState(applyAction(ravaged, { type: "BUILD_KNIGHT", playerId: "a", hex: other })).guards.a).toEqual([other]);
  });

  it("docs/phase10.md §5 random legal play with raiders keeps the bank, the guard supply and the VP math consistent", () => {
    let landings = 0;
    let raids = 0;
    const check = (state: GameState): void => {
      const r = raidersState(state);
      if (cardsInPlay(state) !== 95) throw new Error("invariant: total cards");
      const coast = new Set(coastalHexes(state));
      for (const h of r.raided) if (!coast.has(h)) throw new Error(`invariant: raided inland hex ${h}`);
      if (new Set(r.raided).size !== r.raided.length) throw new Error("invariant: hex raided twice");
      for (const p of state.players) {
        const guards = r.guards[p.id] ?? [];
        if (guards.length > MAX_GUARDS) throw new Error(`invariant: ${p.id} has ${guards.length} guards`);
        for (const h of guards) {
          if (state.board.hexes[h] === undefined) throw new Error(`invariant: guard at sea ${h}`);
          if (r.raided.includes(h)) throw new Error(`invariant: guard on raided hex ${h}`);
        }
        const castle = r.castles[p.id];
        if (castle && !p.settlements.includes(castle) && !p.cities.includes(castle)) throw new Error(`invariant: ${p.id} lost the castle`);
        if (victoryPoints(state, p).total !== recount(state, p.id)) throw new Error(`invariant: VP of ${p.id}`);
      }
      if (r.counter < 0 || r.counter >= RAIDER_LANDING) throw new Error(`invariant: counter ${r.counter}`);
      landings = Math.max(landings, r.landings);
      raids = Math.max(raids, r.raided.length);
    };
    let ended = 0;
    for (let n = 0; n < 20; n++) {
      const game = playRandomGame(`raiders-${n}`, { scenario, onStep: check });
      check(game.final);
      if (game.final.phase.kind === "ended") {
        ended += 1;
        const winner = getPlayer(game.final, game.final.winner as PlayerId);
        expect(victoryPoints(game.final, winner).total).toBeGreaterThanOrEqual(scenario.victoryPoints);
      }
      for (const p of game.final.players) expect(raidersState(game.final).castles[p.id]).not.toBeNull();
      const inHands = game.final.players.reduce((k, p) => k + handSize(p.hand), 0);
      expect(inHands + handSize(game.final.bank)).toBe(RESOURCES.length * 19);
    }
    expect(ended).toBe(20);
    expect(landings).toBeGreaterThan(0);
    expect(raids).toBeGreaterThan(0);
  }, 60_000);
});
