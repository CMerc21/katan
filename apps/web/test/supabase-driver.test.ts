import { describe, expect, it } from "vitest";
import { applyAction, createGame, legalActions, redact, type Action, type GameState } from "@katan/engine";
import { SupabaseDriver, type GameApi, type Reply, type ViewRow } from "@/driver/supabase";
import type { ConnectionState, GameDriver, SeatInfo } from "@/driver/types";

const PLAYERS = [
  { id: "seat-0", name: "Ada" },
  { id: "seat-1", name: "Bo" },
  { id: "seat-2", name: "Cy" },
];

const SEATS: SeatInfo[] = PLAYERS.map((p, i) => ({
  playerId: p.id,
  userId: `user-${i}`,
  seat: i,
  name: p.name,
  color: (["red", "blue", "orange"] as const)[i]!,
  kind: "human",
  botLevel: null,
  ready: true,
  lastSeenAt: null,
}));

/** A fake transport with a real engine behind it, so views and versions behave like the server. */
function fakeApi(seed = "driver") {
  let state: GameState = createGame({ seed, players: PLAYERS, board: "beginner" });
  let version = 0;
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  let handlers: Parameters<GameApi["subscribeGame"]>[2] | null = null;
  let nextReply: Reply | null = null;
  let failNext: Error | null = null;
  const row = (): ViewRow => ({ view: redact(state, "seat-0"), version });
  const api: GameApi = {
    fetchView: async () => row(),
    fetchSeats: async () => SEATS,
    invoke: async (fn, body) => {
      calls.push({ fn, body });
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      if (nextReply) {
        const r = nextReply;
        nextReply = null;
        return r;
      }
      if (fn !== "apply-action") return { ok: true };
      if (body.expectedVersion !== version) return { ok: false, code: "VERSION_CONFLICT", message: "stale" };
      try {
        state = applyAction(state, body.action as Action);
      } catch (err) {
        return { ok: false, code: (err as { code: string }).code, message: String(err) };
      }
      version += 1;
      handlers?.onView(row()); // the Realtime event
      return { ok: true, version };
    },
    subscribeGame: (_g, _p, h) => {
      handlers = h;
      h.onStatus("live");
      return () => void (handlers = null);
    },
  };
  return {
    api,
    calls,
    /** Advance the server without telling the client (a missed event). */
    serverAdvance() {
      const action = legalActions(state, "seat-0")[0]!;
      state = applyAction(state, action);
      version += 1;
    },
    setReply(r: Reply) {
      nextReply = r;
    },
    failNext(e: Error) {
      failNext = e;
    },
    handlers: () => handlers,
    version: () => version,
  };
}

describe("SupabaseDriver", () => {
  it("connects as the seat of the logged-in user and exposes legal actions from the redacted view", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    expect(d.me()).toBe("seat-0");
    expect(d.currentVersion()).toBe(0);
    expect(d.legalActions().length).toBe(54);
    await expect(SupabaseDriver.connect(f.api, "g1", "nobody")).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
    d.close();
  });

  it("dispatch sends expectedVersion = current view version and applies the Realtime update", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    const views: number[] = [];
    d.subscribe((v) => views.push(v.actionIndex));
    const result = await d.dispatch(d.legalActions()[0]!);
    expect(result.ok).toBe(true);
    expect(f.calls[0]).toMatchObject({ fn: "apply-action", body: { gameId: "g1", expectedVersion: 0 } });
    expect(d.currentVersion()).toBe(1);
    expect(views).toEqual([0, 1]);
    d.close();
  });

  it("on VERSION_CONFLICT it refetches the view and reports the conflict instead of retrying", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    const stale = d.legalActions()[0]!;
    f.serverAdvance(); // someone else moved; no event reached us
    const result = await d.dispatch(stale);
    expect(result).toEqual({ ok: false, error: { code: "VERSION_CONFLICT", message: "stale" } });
    // Exactly one apply-action call: no automatic retry.
    expect(f.calls.filter((c) => c.fn === "apply-action")).toHaveLength(1);
    // But the view was refetched.
    expect(d.currentVersion()).toBe(1);
    d.close();
  });

  it("rule errors come back as codes and leave the version alone", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    const result = await d.dispatch({ type: "ROLL", playerId: "seat-0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_PHASE");
    expect(d.currentVersion()).toBe(0);
    d.close();
  });

  it("network failures surface as NETWORK, flip the connection state and trigger a refetch", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    const states: ConnectionState[] = [];
    d.subscribeConnection((s) => states.push(s));
    f.failNext(new Error("fetch failed"));
    const result = await d.dispatch(d.legalActions()[0]!);
    expect(result).toMatchObject({ ok: false, error: { code: "NETWORK" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(states).toEqual(["live", "reconnecting", "live"]);
    d.close();
  });

  it("re-subscribing (reconnect) refetches so a missed event is caught up", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    f.serverAdvance();
    expect(d.currentVersion()).toBe(0);
    f.handlers()!.onStatus("live");
    await new Promise((r) => setTimeout(r, 0));
    expect(d.currentVersion()).toBe(1);
    // Stale events (older version) are ignored.
    f.handlers()!.onView({ view: redact(createGame({ seed: "driver", players: PLAYERS, board: "beginner" }), "seat-0"), version: 0 });
    expect(d.currentVersion()).toBe(1);
    d.close();
  });

  it("does not offer a hotseat handoff", async () => {
    const f = fakeApi();
    const d = await SupabaseDriver.connect(f.api, "g1", "user-0");
    expect((d as GameDriver).pendingHandoff).toBeUndefined();
    d.close();
  });
});
