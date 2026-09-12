import { describe, expect, it } from "vitest";
import { RESOURCES, type Resource } from "../src/board";
import { isRuleError } from "../src/errors";
import { GEOMETRY } from "../src/geometry";
import { applyAction } from "../src/actions";
import { legalActions } from "../src/legal";
import { createRng, type Rng } from "../src/rng";
import { hand } from "../src/state";
import { ACTION_TYPES, type Action, type GameState } from "../src/types";
import { allLegalActions, pickWeighted, playRandomGame } from "./helpers";

/** A random, possibly illegal action of a random type. */
function randomAction(state: GameState, rng: Rng): Action {
  const pick = <T>(xs: readonly T[]): T => xs[rng.int(xs.length)] as T;
  const playerId = pick(state.players).id;
  const type = pick(ACTION_TYPES);
  const resource = (): Resource => pick(RESOURCES);
  const randomHand = () => {
    const h = hand({});
    for (let i = rng.int(3); i > 0; i--) h[resource()] += 1;
    return h;
  };
  switch (type) {
    case "ROLL":
    case "BUY_DEV_CARD":
    case "PLAY_KNIGHT":
    case "PLAY_ROAD_BUILDING":
    case "ACCEPT_TRADE":
    case "REJECT_TRADE":
    case "CANCEL_TRADE":
    case "END_TURN":
      return { type, playerId };
    case "DISCARD":
      return { type, playerId, cards: randomHand() };
    case "MOVE_ROBBER":
      return { type, playerId, hex: pick(GEOMETRY.hexes) };
    case "STEAL":
      return { type, playerId, targetPlayerId: pick(state.players).id };
    case "BUILD_ROAD":
    case "BUILD_SHIP":
      return { type, playerId, edge: pick(GEOMETRY.edges) };
    case "MOVE_SHIP":
      return { type, playerId, from: pick(GEOMETRY.edges), to: pick(GEOMETRY.edges) };
    case "CHOOSE_GOLD":
      return { type, playerId, resources: [resource()] };
    case "BUILD_SETTLEMENT":
    case "BUILD_CITY":
      return { type, playerId, vertex: pick(GEOMETRY.vertices) };
    case "PLAY_INVENTION":
      return { type, playerId, resources: [resource(), resource()] };
    case "PLAY_MONOPOLY":
      return { type, playerId, resource: resource() };
    case "SPECIAL_BUILD_DONE":
      return { type, playerId };
    case "OFFER_TRADE":
      return { type, playerId, give: randomHand(), receive: randomHand() };
    case "MARITIME_TRADE":
      return { type, playerId, give: resource(), giveCount: pick([4, 3, 2] as const), receive: resource() };
    default: {
      const exhaustive: never = type;
      throw new Error(String(exhaustive));
    }
  }
}

const FULLY_ENUMERATED: ReadonlySet<Action["type"]> = new Set(
  ACTION_TYPES.filter((t) => t !== "OFFER_TRADE" && t !== "DISCARD"),
);

function includesAction(list: Action[], action: Action): boolean {
  const key = JSON.stringify(action);
  return list.some((a) => JSON.stringify(a) === key);
}

describe("§12 engine contract", () => {
  it("§12 applyAction never mutates its input", () => {
    const rng = createRng("contract-immutable");
    let state = playRandomGame("contract-0", { maxTurns: 0 }).final; // a fresh game
    for (let i = 0; i < 300 && state.phase.kind !== "ended"; i++) {
      const legal = allLegalActions(state);
      const action = pickWeighted(state, legal, rng);
      const before = JSON.stringify(state);
      applyAction(state, action);
      expect(JSON.stringify(state)).toBe(before);
      state = applyAction(state, action);
      // Illegal actions do not mutate either.
      const bad = randomAction(state, rng);
      const snapshot = JSON.stringify(state);
      try {
        applyAction(state, bad);
      } catch (err) {
        if (!isRuleError(err)) throw err;
      }
      expect(JSON.stringify(state)).toBe(snapshot);
    }
  });

  it("§12 every action in legalActions is accepted by applyAction", () => {
    const rng = createRng("contract-legal");
    for (const seed of ["contract-1", "contract-2"]) {
      const states: GameState[] = [];
      playRandomGame(seed, { onStep: (s) => void (states.length < 400 && states.push(s)) });
      for (const state of states.filter((_, i) => i % 7 === 0)) {
        for (const p of state.players) {
          for (const action of legalActions(state, p.id)) {
            expect(() => applyAction(state, action)).not.toThrow();
          }
        }
      }
      void rng;
    }
  });

  it("§12 every action rejected by applyAction is absent from legalActions (and accepted ones present)", () => {
    const rng = createRng("contract-reject");
    let checked = 0;
    let rejected = 0;
    for (const seed of ["contract-3", "contract-4", "contract-5"]) {
      const states: GameState[] = [];
      playRandomGame(seed, { onStep: (s) => void states.push(s) });
      for (const state of states.filter((_, i) => i % 5 === 0)) {
        for (let k = 0; k < 6; k++) {
          const action = randomAction(state, rng);
          const legal = legalActions(state, action.playerId);
          let ok = true;
          try {
            applyAction(state, action);
          } catch (err) {
            if (!isRuleError(err)) throw err;
            ok = false;
          }
          checked++;
          if (!ok) {
            rejected++;
            expect(includesAction(legal, action)).toBe(false);
          } else if (FULLY_ENUMERATED.has(action.type)) {
            expect(includesAction(legal, action)).toBe(true);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(rejected).toBeGreaterThan(100);
    expect(rejected).toBeLessThan(checked);
  });

  it("§12 the same seed and action log always reproduce the same state", () => {
    const g1 = playRandomGame("contract-replay");
    const g2 = playRandomGame("contract-replay");
    expect(g2.final).toEqual(g1.final);
    expect(g2.actions).toEqual(g1.actions);
  });
});
