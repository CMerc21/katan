import { describe, expect, it } from "vitest";
import { applyActionWithEvents, createGame, legalActions, nextActor, redact, type GameEvent, type GameState } from "@katan/engine";
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
function play(n: number, seed = "queue"): { views: RedactedState[]; events: GameEvent[] } {
  let state: GameState = createGame({ seed, players: PLAYERS, board: "beginner" });
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
