import { describe, expect, it } from "vitest";
import { hand, type Action, type GameState } from "@katan/engine";
import { HotseatDriver, actingPlayer } from "@/driver/hotseat";
import type { RedactedState } from "@/driver/types";

const PLAYERS = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
  { id: "d", name: "Di" },
];

function driver(seed = "hotseat"): HotseatDriver {
  return HotseatDriver.create({ seed, players: PLAYERS, board: "beginner" });
}

/** Apply the first legal action (or the first of a given type) for whoever is acting. */
async function step(d: HotseatDriver, type?: Action["type"]): Promise<Action> {
  const legal = d.legalActions();
  const action = type ? legal.find((a) => a.type === type) : legal[0];
  if (!action) throw new Error(`no legal ${type ?? "action"} for ${d.me()} in ${d.snapshot().phase.kind}`);
  const result = await d.dispatch(action);
  if (!result.ok) throw result.error;
  return action;
}

/** Replace the driver's state (test only) to build scenarios quickly. */
function withState(d: HotseatDriver, fn: (s: GameState) => void): void {
  const s = structuredClone(d.snapshot());
  fn(s);
  (d as unknown as { state: GameState; acting: string }).state = s;
  (d as unknown as { state: GameState; acting: string }).acting = actingPlayer(s);
}

describe("HotseatDriver", () => {
  it("emits a redacted view for me() immediately and on every action", async () => {
    const d = driver();
    const views: RedactedState[] = [];
    const unsubscribe = d.subscribe((v) => views.push(v));
    expect(views).toHaveLength(1);
    expect(views[0]!.viewer).toBe("a");
    expect("seed" in views[0]!).toBe(false);
    await step(d);
    expect(views).toHaveLength(2);
    unsubscribe();
    await step(d);
    expect(views).toHaveLength(2);
  });

  it("docs/phase7.md §1.2: each emitted view carries the events since the previous one, bots included", async () => {
    const d = HotseatDriver.create({ seed: "events", players: PLAYERS, board: "beginner", bots: { b: "easy", c: "easy", d: "easy" } });
    const views: RedactedState[] = [];
    d.subscribe((v) => views.push(v));
    expect(views[0]!.events).toEqual([]);
    await step(d); // a's settlement: one built event, a still acts (her road)
    expect(views[1]!.events.map((e) => e.kind)).toEqual(["built"]);
    await step(d); // a's road, then the bots place both rounds
    const events = views[2]!.events;
    expect(events.filter((e) => e.kind === "built").length).toBe(1 + 12);
    expect(events[0]!.seq).toBe(views[1]!.events.at(-1)!.seq + 1);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => events[0]!.seq + i));
    // Third parties never see discard contents or stolen cards in their events.
    expect(events.every((e) => e.kind !== "stole" || e.resource === null || e.to === "a" || e.from === "a")).toBe(true);
    // Acknowledging a handoff re-emits with no events.
    d.acknowledgeHandoff();
    expect(views[3]!.events).toEqual([]);
  });

  it("me() follows the setup snake and lands on seat 0 for the first roll", async () => {
    const d = driver();
    const seen: string[] = [];
    for (let i = 0; i < 16; i++) {
      seen.push(d.me());
      await step(d);
    }
    expect(seen.join("")).toBe("aabbccddddccbbaa");
    expect(d.me()).toBe("a");
    expect(d.snapshot().phase).toEqual({ kind: "roll" });
    expect(d.legalActions()).toEqual([{ type: "ROLL", playerId: "a" }]);
  });

  it("rejects illegal actions with a RuleError result and leaves state untouched", async () => {
    const d = driver();
    const before = d.snapshot();
    const result = await d.dispatch({ type: "ROLL", playerId: "a" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_PHASE");
    expect(d.snapshot()).toBe(before);
    const wrongPlayer = await d.dispatch({ type: "BUILD_SETTLEMENT", playerId: "b", vertex: "0,0|0,1|1,0" });
    expect(wrongPlayer.ok).toBe(false);
  });

  it("cycles me() through every player who owes a discard, then back to the roller", async () => {
    const d = driver();
    withState(d, (s) => {
      s.phase = { kind: "discard" };
      s.pendingDiscards = { b: 4, d: 5 };
      s.players[1]!.hand = hand({ wood: 8 });
      s.players[3]!.hand = hand({ ore: 10 });
      s.bank.wood -= 8;
      s.bank.ore -= 10;
    });
    expect(d.me()).toBe("b");
    expect(d.legalActions()[0]).toMatchObject({ type: "DISCARD", playerId: "b" });
    await step(d, "DISCARD");
    expect(d.me()).toBe("d");
    await step(d, "DISCARD");
    expect(d.me()).toBe("a");
    expect(d.snapshot().phase.kind).toBe("moveRobber");
  });

  it("cycles me() through opponents for a trade response, skipping those who declined", async () => {
    const d = driver();
    withState(d, (s) => {
      s.phase = { kind: "action" };
      s.players[0]!.hand = hand({ wood: 2 });
      s.players[2]!.hand = hand({ ore: 1 });
      s.bank.wood -= 2;
      s.bank.ore -= 1;
    });
    expect(d.me()).toBe("a");
    const offer = await d.dispatch({ type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) });
    expect(offer.ok).toBe(true);
    expect(d.me()).toBe("b");
    expect(d.legalActions().map((a) => a.type)).toEqual(["REJECT_TRADE"]);
    await step(d, "REJECT_TRADE");
    expect(d.me()).toBe("c");
    expect(d.legalActions().map((a) => a.type)).toEqual(["ACCEPT_TRADE", "REJECT_TRADE"]);
    await step(d, "REJECT_TRADE");
    expect(d.me()).toBe("d");
    await step(d, "REJECT_TRADE");
    // Everyone declined: offer cleared, back to the offerer.
    expect(d.me()).toBe("a");
    expect(d.snapshot().pendingTrade).toBeNull();
  });

  it("an accepted trade returns control to the offerer", async () => {
    const d = driver();
    withState(d, (s) => {
      s.phase = { kind: "action" };
      s.players[0]!.hand = hand({ wood: 1 });
      s.players[1]!.hand = hand({ ore: 1 });
      s.bank.wood -= 1;
      s.bank.ore -= 1;
    });
    await d.dispatch({ type: "OFFER_TRADE", playerId: "a", give: hand({ wood: 1 }), receive: hand({ ore: 1 }) });
    expect(d.me()).toBe("b");
    await step(d, "ACCEPT_TRADE");
    expect(d.me()).toBe("a");
    expect(d.snapshot().players[0]!.hand).toEqual(hand({ ore: 1 }));
  });

  it("end turn hands me() to the next seat", async () => {
    const d = driver();
    withState(d, (s) => void (s.phase = { kind: "action" }));
    await step(d, "END_TURN");
    expect(d.me()).toBe("b");
    expect(d.snapshot().phase).toEqual({ kind: "roll" });
    withState(d, (s) => void (s.phase = { kind: "action" }));
    await step(d, "END_TURN");
    expect(d.me()).toBe("c");
  });
});
