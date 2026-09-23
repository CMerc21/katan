import { describe, expect, it } from "vitest";
import { applyActionWithEvents } from "../src/actions";
import { GEOMETRY } from "../src/geometry";
import { TERRAIN_RESOURCE } from "../src/board";
import { legalActions } from "../src/legal";
import { nextActor } from "../src/state";
import type { GameEvent } from "../src/events";
import type { Action, GameState } from "../src/types";
import { hand } from "../src/state";
import { crownGame } from "./crown-helpers";

function runSetup(start: GameState): { state: GameState; log: Action[]; events: GameEvent[] } {
  let state = start;
  const log: Action[] = [];
  const events: GameEvent[] = [];
  while (state.phase.kind === "setup") {
    const action = legalActions(state, nextActor(state))[0];
    if (!action) throw new Error("no legal setup action");
    const r = applyActionWithEvents(state, action);
    state = r.state;
    events.push(...r.events);
    log.push(action);
  }
  return { state, log, events };
}

describe("docs/rules.md §16.9 setup under Crown & Castle", () => {
  it("§16.9 the second placement is a city: one settlement and one city per player, pieces adjusted", () => {
    const { state, log } = runSetup(crownGame());
    for (const p of state.players) {
      const mine = log.filter((a) => a.playerId === p.id && a.type === "BUILD_SETTLEMENT");
      expect(mine).toHaveLength(2);
      const [first, second] = mine as [Extract<Action, { type: "BUILD_SETTLEMENT" }>, Extract<Action, { type: "BUILD_SETTLEMENT" }>];
      expect(p.settlements).toEqual([first.vertex]);
      expect(p.cities).toEqual([second.vertex]);
      expect(p.pieces.settlements).toBe(4);
      expect(p.pieces.cities).toBe(3);
    }
  });

  it("§16.9 the city still receives one resource per adjacent producing hex and no commodities", () => {
    const { state, log } = runSetup(crownGame());
    for (const p of state.players) {
      const second = log.filter((a) => a.playerId === p.id && a.type === "BUILD_SETTLEMENT")[1]!;
      if (second.type !== "BUILD_SETTLEMENT") throw new Error("unreachable");
      const expected = hand({});
      for (const h of GEOMETRY.vertexHexes[second.vertex]!) {
        const r = TERRAIN_RESOURCE[state.board.hexes[h]!.terrain];
        if (r) expected[r] += 1;
      }
      expect(p.hand).toEqual(expected);
      expect(state.crown!.players[p.id]!.commodities).toEqual({ cloth: 0, coin: 0, paper: 0 });
    }
  });

  it("§16.9 the client sees the settlement go down and then become a city", () => {
    const { events } = runSetup(crownGame());
    const built = events.filter((e): e is Extract<GameEvent, { kind: "built" }> => e.kind === "built");
    const cities = built.filter((e) => e.piece === "city");
    expect(cities).toHaveLength(4);
    for (const c of cities) {
      const idx = built.findIndex((e) => e.piece === "settlement" && e.at === c.at && e.playerId === c.playerId);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(built.indexOf(c));
    }
  });

  it("§16.9 the first placement stays a settlement", () => {
    let state = crownGame();
    const a = nextActor(state);
    const first = legalActions(state, a)[0]!;
    state = applyActionWithEvents(state, first).state;
    const p = state.players.find((x) => x.id === a)!;
    expect(p.settlements).toHaveLength(1);
    expect(p.cities).toHaveLength(0);
  });
});
