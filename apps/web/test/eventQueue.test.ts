import { describe, expect, it } from "vitest";
import { applyActionWithEvents, boardGeometry, builtInScenario, createGame, edgeVerticesOf, greatLakeBoard, hexEdge, legalActions, nextActor, redact, type Action, type BoardDefinition, type EdgeDef, type GameEvent, type GameState, type HexDef, type Scenario } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { EventQueue, applyEventToView, planSteps, scaleDuration, totalDuration, type QueueState, type Step } from "@/game/eventQueue";
import type { AnimationSpeed } from "@/game/settings";

const PLAYERS = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];

/** A fake clock: timers fire in order when `run()` is called. */
function clock() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  return {
    now: () => now,
    setTimer(fn: () => void, ms: number): unknown {
      const t = { at: now + ms, fn, id: ++id };
      timers.push(t);
      return t.id;
    },
    clearTimer(handle: unknown) {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
    /** Advance until no timers remain, returning elapsed ms. */
    run(): number {
      const start = now;
      while (timers.length) {
        timers.sort((x, y) => x.at - y.at);
        const t = timers.shift()!;
        now = t.at;
        t.fn();
      }
      return now - start;
    },
    pending: () => timers.length,
  };
}

/** Play `n` actions and return each emitted view (as a driver would emit them), all for viewer `a`. */
function play(n: number, seed = "queue", tides = false): { views: RedactedState[]; events: GameEvent[] } {
  let state: GameState = tides ? createGame({ seed, players: PLAYERS, scenario: builtInScenario("goldCoast") }) : createGame({ seed, players: PLAYERS, board: "beginner" });
  const views: RedactedState[] = [redact(state, "a")];
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const actor = nextActor(state);
    const action = legalActions(state, actor)[0]!;
    const r = applyActionWithEvents(state, action);
    state = r.state;
    events.push(...r.events);
    views.push(redact(state, "a", r.events));
  }
  return { views, events };
}

function makeQueue(initial: RedactedState, c: ReturnType<typeof clock>, speed: () => AnimationSpeed, isBot = (id: string) => id !== "a") {
  const states: QueueState[] = [];
  const steps: Step[] = [];
  const q = new EventQueue(initial, {
    speed,
    isBot,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    onChange: (s) => states.push(s),
    onStep: (s) => steps.push(s),
  });
  return { q, states, steps };
}

describe("docs/phase7.md §2 event queue", () => {
  it("applies events one at a time, in order, and snaps to the server view at the end of a batch", () => {
    const { views } = play(3);
    const c = clock();
    const { q, states, steps } = makeQueue(views[0]!, c, () => "normal");
    for (const v of views.slice(1)) q.push(v);
    c.run();
    const played = steps.filter((s): s is Extract<Step, { kind: "event" }> => s.kind === "event").map((s) => s.event.seq);
    expect(played).toEqual(played.map((_, i) => i));
    // Rendered views only ever move forward, and finish exactly on the last server view.
    const seqs = states.map((s) => s.rendered.eventSeq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThanOrEqual(seqs[i - 1]!);
    expect(q.state().rendered).toEqual(views.at(-1));
    expect(q.state().draining).toBe(false);
  });

  it("docs/phase9.md §8: ships, the pirate, gold and island pennants apply event by event on a Tides scenario", () => {
    // Prefer ships, gold choices and pirate moves so the Tides events actually occur.
    let state: GameState = createGame({ seed: "tides-queue", players: PLAYERS, scenario: builtInScenario("goldCoast") });
    let view = redact(state, "a");
    const kinds = new Set<string>();
    for (let i = 0; i < 260 && state.phase.kind !== "ended"; i++) {
      const actor = nextActor(state);
      const legal = legalActions(state, actor);
      const preferred = legal.find((a) => a.type === "BUILD_SHIP") ?? legal.find((a) => a.type === "MOVE_SHIP") ?? legal.find((a) => a.type === "MOVE_ROBBER" && a.target === "pirate") ?? legal.find((a) => a.type === "CHOOSE_GOLD") ?? legal.find((a) => a.type === "BUILD_SETTLEMENT") ?? legal.find((a) => a.type === "ROLL") ?? legal.find((a) => a.type === "END_TURN") ?? legal[0]!;
      const r = applyActionWithEvents(state, preferred);
      state = r.state;
      for (const e of r.events) {
        kinds.add(e.kind);
        view = applyEventToView(view, e);
      }
    }
    expect(kinds.has("shipBuilt")).toBe(true);
    const final = redact(state, "a");
    for (const p of final.players) {
      const r = view.players.find((x) => x.id === p.id)!;
      expect(r.ships).toEqual(p.ships);
      expect(r.roads).toEqual(p.roads);
      expect(r.pieces).toEqual(p.pieces);
      expect(r.islandChips).toEqual(p.islandChips);
      expect(r.publicVP).toBe(p.publicVP);
      expect(r.hand).toEqual(p.hand);
    }
    expect(view.pirateHex).toBe(final.pirateHex);
    expect(view.robberHex).toBe(final.robberHex);
    expect(view.bank).toEqual(final.bank);
  });

  it("the rendered view between events matches what the engine produced (pieces, counts, robber)", () => {
    const { views, events } = play(12);
    // Reconstruct by applying every event to the initial view; the public parts must equal the final redacted view.
    let view = views[0]!;
    for (const e of events) view = applyEventToView(view, e);
    const final = views.at(-1)!;
    for (const p of final.players) {
      const r = view.players.find((x) => x.id === p.id)!;
      expect(r.roads).toEqual(p.roads);
      expect(r.settlements).toEqual(p.settlements);
      expect(r.cities).toEqual(p.cities);
      expect(r.pieces).toEqual(p.pieces);
      expect(r.publicVP).toBe(p.publicVP);
      expect(r.hand).toEqual(p.hand);
    }
    expect(view.robberHex).toBe(final.robberHex);
    expect(view.currentPlayer).toBe(final.currentPlayer);
    expect(view.eventSeq).toBe(final.eventSeq);
    expect(view.log.map((l) => l.text)).toEqual(final.log.map((l) => l.text));
  });

  it("skip fast-forwards the remaining steps at 5× and input stays disabled until the queue is empty", () => {
    const { views } = play(6);
    const c = clock();
    const { q } = makeQueue(views[0]!, c, () => "normal");
    const batch = views.slice(1);
    for (const v of batch) q.push(v);
    expect(q.state().draining).toBe(true);
    const full = totalDuration(batch.flatMap((v) => planSteps(v.events, "a", (id) => id !== "a")));
    q.skip();
    const elapsed = c.run();
    expect(elapsed).toBeLessThan(full / 4);
    expect(q.state().draining).toBe(false);
    expect(q.state().rendered).toEqual(views.at(-1));
  });

  it("Off applies every view instantly with no timers", () => {
    const { views } = play(5);
    const c = clock();
    const { q, states } = makeQueue(views[0]!, c, () => "off");
    for (const v of views.slice(1)) q.push(v);
    expect(c.pending()).toBe(0);
    expect(q.state().draining).toBe(false);
    expect(q.state().rendered).toEqual(views.at(-1));
    expect(states.every((s) => s.current === null)).toBe(true);
  });

  it("Fast is about three times quicker than Normal", () => {
    const { views } = play(4);
    const time = (speed: AnimationSpeed) => {
      const c = clock();
      const { q } = makeQueue(views[0]!, c, () => speed);
      for (const v of views.slice(1)) q.push(v);
      return c.run();
    };
    const normal = time("normal");
    const fast = time("fast");
    expect(normal).toBeGreaterThan(fast * 2.5);
    expect(normal).toBeLessThan(fast * 3.5);
    expect(scaleDuration(900, "fast", false)).toBe(300);
    expect(scaleDuration(900, "normal", true)).toBe(180);
  });

  it("snaps to the server view and clears the queue when events do not line up or cannot be applied", () => {
    const { views } = play(4);
    const c = clock();
    const { q } = makeQueue(views[0]!, c, () => "normal");
    // A view whose events start beyond what we have rendered (a missed update): snap immediately.
    q.push(views[3]!);
    expect(q.state().draining).toBe(false);
    expect(q.state().rendered).toEqual(views[3]);
    // A contiguous view whose events are impossible (a road placed twice): snap mid-batch.
    const bogus: RedactedState = {
      ...views[4]!,
      events: [
        { seq: views[3]!.eventSeq, kind: "built", playerId: "zz", piece: "road", at: "x" },
        ...views[4]!.events.map((e, i) => ({ ...e, seq: views[3]!.eventSeq + 1 + i })),
      ],
    };
    q.push(bogus);
    c.run(); // the bot's thinking pause plays, then the impossible event snaps
    expect(q.state().draining).toBe(false);
    expect(q.state().rendered).toEqual(bogus);
    expect(c.pending()).toBe(0);
  });

  it("inserts a seeded thinking pause before a bot's first event of a turn, and beats before builds and end turn", () => {
    const { views } = play(20, "pacing");
    const all = views.slice(1).flatMap((v) => v.events);
    const steps = planSteps(all, "a", (id) => id !== "a");
    const thinking = steps.filter((s) => s.kind === "thinking");
    expect(thinking.length).toBeGreaterThan(0);
    for (const t of thinking) {
      expect(t.duration).toBeGreaterThanOrEqual(600);
      expect(t.duration).toBeLessThanOrEqual(1200);
    }
    // Deterministic: the same events plan the same pauses on every client.
    expect(planSteps(all, "a", (id) => id !== "a")).toEqual(steps);
    // Humans never think.
    expect(planSteps(all, "a", () => false).every((s) => s.kind === "event")).toBe(true);
    // A thinking step precedes the bot's first event after each turnStarted, never a human's.
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.kind === "thinking") {
        const nextEvent = steps[i + 1]!;
        expect(nextEvent.kind).toBe("event");
        expect(s.playerId).not.toBe("a");
      }
    }
  });

  it("a bot's turn on Normal lands in the 2–8 s budget and under 200 ms on Off (docs/phase7.md §3)", () => {
    // A full bot turn: turnStarted, roll, production, a build, end turn.
    const seqs = (kinds: GameEvent[]) => kinds.map((e, i) => ({ ...e, seq: i }));
    const turn: GameEvent[] = seqs([
      { seq: 0, kind: "turnStarted", playerId: "b", turn: 5 },
      { seq: 0, kind: "diceRolled", playerId: "b", dice: [3, 4] },
      { seq: 0, kind: "produced", gains: [{ playerId: "b", hex: "0,0", resource: "wood", count: 1 }, { playerId: "a", hex: "0,0", resource: "ore", count: 1 }] },
      { seq: 0, kind: "built", playerId: "b", piece: "road", at: "0,0|1,0" },
      { seq: 0, kind: "turnEnded", playerId: "b" },
      { seq: 0, kind: "turnStarted", playerId: "c", turn: 6 },
    ]);
    const steps = planSteps(turn, "a", (id) => id !== "a");
    const normal = steps.reduce((n, s) => n + scaleDuration(s.duration, "normal", false), 0);
    const fast = steps.reduce((n, s) => n + scaleDuration(s.duration, "fast", false), 0);
    const off = steps.reduce((n, s) => n + scaleDuration(s.duration, "off", false), 0);
    expect(normal).toBeGreaterThanOrEqual(2000);
    expect(normal).toBeLessThanOrEqual(8000);
    expect(fast).toBeGreaterThanOrEqual(700);
    expect(fast).toBeLessThanOrEqual(2500);
    expect(off).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wayfarers (docs/phase10.md): every variant's events keep the rendered view in step with the engine.

/** The Great Lake's board with a river down the middle column and two oases: every variant has something to do. */
function everythingBoard(): BoardDefinition {
  const base = greatLakeBoard();
  const oases = new Set(["1,-2", "-2,1"]);
  const river: EdgeDef[] = [];
  for (let r = 2; r >= -2; r--) river.push({ edge: hexEdge({ q: 0, r }, 0), kind: "river" }, { edge: hexEdge({ q: 0, r }, 1), kind: "river" });
  return {
    ...base,
    name: "Everything",
    hexes: base.hexes.map((h): HexDef => (oases.has(`${h.at.q},${h.at.r}`) ? { ...h, extras: { oasis: true } } : h)),
    edges: [...(base.edges ?? []), ...river],
  };
}

const EVERYTHING: Scenario = {
  id: "everything",
  name: "Everything",
  board: everythingBoard(),
  modules: {},
  variants: { eventDeck: true, fishing: true, rivers: true, harbormaster: true, raiders: true, caravans: true, wagons: true },
  victoryPoints: 30,
};

/** A small seeded picker so the walk is deterministic without the engine's RNG. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Action types the walk reaches for, in order, each with the chance it is taken when available. */
const PREFERRED: [Action["type"], number][] = [
  ["BUILD_CASTLE", 1],
  ["NEIGHBORLY_GIVE", 1],
  ["CHOOSE_GOLD", 1],
  ["ACCEPT_TRADE", 1],
  ["BUILD_CITY", 0.9],
  ["BUILD_SETTLEMENT", 0.9],
  ["SPEND_FISH", 0.8],
  ["REBUILD_HEX", 0.8],
  ["EXTEND_CARAVAN", 0.8],
  ["DELIVER", 0.9],
  ["LOAD_COMMODITY", 0.9],
  ["BUILD_KNIGHT", 0.5],
  ["BUILD_ROAD", 0.3],
  ["MOVE_WAGON", 0.3],
];

/** Setup settlements go riverside, on a fishing ground, by the lake or on a harbour when possible, so every variant's events actually fire. */
function preferSpots(state: GameState, options: Action[]): Action[] {
  const geo = boardGeometry(state.board);
  const lakes = Object.keys(state.board.hexes).filter((h) => state.board.hexes[h]?.terrain === "lake");
  const tiers = [
    new Set(state.board.rivers.flatMap((e) => edgeVerticesOf(e))),
    new Set([...state.board.fishingGrounds.flatMap((g) => edgeVerticesOf(g.edge)), ...lakes.flatMap((h) => geo.hexVertices[h] ?? [])]),
    new Set(state.board.ports.flatMap((p) => [...p.vertices])),
  ];
  for (const tier of tiers) {
    const good = options.filter((a) => a.type === "BUILD_SETTLEMENT" && tier.has(a.vertex));
    if (good.length > 0) return good;
  }
  return options;
}

/** Walk a scenario game with a variant-hungry policy, applying every event to the viewer's rendered view. */
function walk(scenario: Scenario, seed: string, steps: number, players = PLAYERS): { view: RedactedState; final: RedactedState; kinds: Set<string>; tolled: boolean } {
  let state: GameState = createGame({ seed, players, scenario });
  let view = redact(state, "a");
  const kinds = new Set<string>();
  let tolled = false;
  const rnd = lcg(seed.length * 7919 + steps);
  for (let i = 0; i < steps && state.phase.kind !== "ended"; i++) {
    const actor = nextActor(state);
    const legal = legalActions(state, actor);
    let action: Action | undefined;
    for (const [type, chance] of PREFERRED) {
      let options = legal.filter((a) => a.type === type && (type !== "ACCEPT_TRADE" || a.boot === true) && (type !== "MOVE_WAGON" || !a.grain));
      if (type === "BUILD_SETTLEMENT" && state.phase.kind === "setup") options = preferSpots(state, options);
      if (options.length > 0 && rnd() < chance) {
        action = options[Math.floor(rnd() * options.length)];
        break;
      }
    }
    action ??= legal.find((a) => a.type === "ROLL") ?? legal.find((a) => a.type === "END_TURN") ?? legal[Math.floor(rnd() * legal.length)];
    if (!action) throw new Error("no legal action");
    const r = applyActionWithEvents(state, action);
    state = r.state;
    for (const e of r.events) {
      kinds.add(e.kind);
      // A toll's resource is not in the event (docs/phase10.md): the viewer's own hand waits for the snap after one.
      if (e.kind === "wagonMoved" && e.toll !== null && (e.playerId === "a" || e.toll === "a")) tolled = true;
      view = applyEventToView(view, e);
    }
  }
  return { view, final: redact(state, "a"), kinds, tolled };
}

function expectInStep(view: RedactedState, final: RedactedState, tolled = false): void {
  for (const p of final.players) {
    const r = view.players.find((x) => x.id === p.id)!;
    expect(r.roads).toEqual(p.roads);
    expect(r.settlements).toEqual(p.settlements);
    expect(r.cities).toEqual(p.cities);
    expect(r.pieces).toEqual(p.pieces);
    expect(r.publicVP).toBe(p.publicVP);
    if (!tolled || p.id !== "a") expect(r.hand).toEqual(p.hand);
  }
  if (!tolled) expect(view.bank).toEqual(final.bank);
  expect(view.robberHex).toBe(final.robberHex);
  expect(view.eventSeq).toBe(final.eventSeq);
  const w = view.wayfarers;
  const f = final.wayfarers;
  expect(w === null).toBe(f === null);
  if (!w || !f) return;
  expect(w.eventDeck).toEqual(f.eventDeck);
  expect(w.fishing).toEqual(f.fishing);
  expect(w.rivers).toEqual(f.rivers);
  expect(w.harbormaster).toEqual(f.harbormaster);
  expect(w.raiders).toEqual(f.raiders);
  expect(w.caravans).toEqual(f.caravans);
  if (w.wagons && f.wagons) {
    expect(w.wagons.wagons).toEqual(f.wagons.wagons);
    expect(w.wagons.points).toEqual(f.wagons.points);
    expect(w.wagons.stock).toEqual(f.wagons.stock);
    // A city's first demand token is seeded, so the rendered view only learns it at the snap; rotations it saw must agree.
    for (const [v, good] of Object.entries(w.wagons.demand)) expect(f.wagons.demand[v]).toBe(good);
  }
}

describe("docs/phase10.md Wayfarers events apply event by event", () => {
  it("The Great Lake: fish, the old boot and the Harbormaster", () => {
    const { view, final, kinds } = walk(builtInScenario("greatLake"), "lake-queue", 700);
    for (const k of ["fishDrawn", "fishSpent"]) expect(kinds.has(k), k).toBe(true);
    expectInStep(view, final);
  });

  it("River Country: bridges, coins, chips and the event deck", () => {
    const { view, final, kinds } = walk(builtInScenario("riverCountry"), "river-queue", 700);
    for (const k of ["coinsAwarded", "bridgeBuilt", "chipMoved", "deckReshuffled"]) expect(kinds.has(k), k).toBe(true);
    expectInStep(view, final);
  });

  it("Coastal Watch: castles, guards, the raider counter and rebuilt hexes", () => {
    const seen = new Set<string>();
    for (const seed of ["raid-1", "raid-2", "raid-3"]) {
      const { view, final, kinds } = walk(builtInScenario("coastalWatch"), seed, 1200, [...PLAYERS, { id: "d", name: "Di" }]);
      for (const k of kinds) seen.add(k);
      expectInStep(view, final);
    }
    for (const k of ["castleBuilt", "guardPlaced", "raidersAdvanced", "raid", "hexRebuilt"]) expect(seen.has(k), k).toBe(true);
  });

  it("Salt Road: spice, caravans, wagons, goods and deliveries", () => {
    const { view, final, kinds, tolled } = walk(builtInScenario("saltRoad"), "salt-queue", 900);
    for (const k of ["spiceProduced", "wagonMoved", "goodsStocked"]) expect(kinds.has(k), k).toBe(true);
    expectInStep(view, final, tolled);
  });

  it("every variant at once stays in step over a long walk", () => {
    const seen = new Set<string>();
    for (const seed of ["all-1", "all-2", "all-3"]) {
      const { view, final, kinds, tolled } = walk(EVERYTHING, seed, 900);
      for (const k of kinds) seen.add(k);
      expectInStep(view, final, tolled);
    }
    for (const k of ["fishDrawn", "fishSpent", "castleBuilt", "guardPlaced", "coinsAwarded", "spiceProduced", "wagonMoved", "goodsStocked"]) expect(seen.has(k), k).toBe(true);
  });
});
