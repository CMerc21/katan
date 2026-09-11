import { describe, expect, it } from "vitest";
import { RESOURCES } from "../src/board";
import { applyAction, replay } from "../src/actions";
import { createGame } from "../src/game";
import { legalActions } from "../src/legal";
import { redact } from "../src/redact";
import { currentPlayerId, getPlayer, handSize, victoryPoints } from "../src/state";
import type { Action, GameState } from "../src/types";
import { FOUR, playRandomGame } from "./helpers";

/**
 * A scripted, fully deterministic policy on the beginner board: every player
 * follows the same priority list (city > settlement > road > dev card >
 * useful maritime trade > play knight > end turn), always taking the first
 * legal instance. No randomness beyond the seeded dice.
 */
function scriptedPolicy(state: GameState): Action {
  const me = currentPlayerId(state);
  const legal = legalActions(state, me);
  if (state.phase.kind === "discard") {
    const owing = state.players.find((p) => state.pendingDiscards[p.id] !== undefined)!;
    return legalActions(state, owing.id)[0]!;
  }
  const first = (type: Action["type"]) => legal.find((a) => a.type === type);
  const hand = getPlayer(state, me).hand;
  const most = RESOURCES.reduce((best, r) => (hand[r] > hand[best] ? r : best), RESOURCES[0]);
  const wanted = RESOURCES.find((r) => hand[r] === 0 && r !== most);
  const useful = legal.find(
    (a) => a.type === "MARITIME_TRADE" && a.give === most && a.receive === wanted && hand[most] - a.giveCount >= 2,
  );
  return (
    first("BUILD_CITY") ??
    first("BUILD_SETTLEMENT") ??
    first("BUILD_ROAD") ??
    first("BUY_DEV_CARD") ??
    useful ??
    first("PLAY_KNIGHT") ??
    first("ROLL") ??
    first("MOVE_ROBBER") ??
    first("STEAL") ??
    first("END_TURN") ??
    legal[0]!
  );
}

describe("integration", () => {
  it("a scripted 4-player game on the beginner board reaches a win with consistent VP", () => {
    const initial = createGame({ seed: "scripted", players: FOUR, board: "beginner" });
    let state = initial;
    const log: Action[] = [];
    while (state.phase.kind !== "ended") {
      if (state.turn > 600) throw new Error("scripted game did not finish");
      const action = scriptedPolicy(state);
      log.push(action);
      state = applyAction(state, action);
    }
    expect(state.winner).not.toBeNull();
    const winner = getPlayer(state, state.winner!);
    const vp = victoryPoints(state, winner);
    expect(vp.total).toBeGreaterThanOrEqual(10);
    expect(vp.total).toBe(
      winner.settlements.length +
        2 * winner.cities.length +
        (state.longestRoad.playerId === winner.id ? 2 : 0) +
        (state.largestArmy.playerId === winner.id ? 2 : 0) +
        winner.devCards.filter((c) => c.type === "victoryPoint").length,
    );
    // Only the winner may have 10+.
    for (const p of state.players) {
      if (p.id !== winner.id) expect(victoryPoints(state, p).total).toBeLessThan(10 + 2);
    }
    // The winner won on their own turn.
    expect(currentPlayerId(state)).toBe(winner.id);
    expect(log.length).toBeGreaterThan(50);
    expect(state.actionIndex).toBe(log.length);

    // Replay from seed reproduces the final state exactly.
    expect(replay(initial, log)).toEqual(state);
  });

  it("replaying a random game's action log from the seed yields an identical final state", () => {
    const game = playRandomGame("replay-me");
    const again = replay(createGame({ seed: "replay-me", players: FOUR, board: "random" }), game.actions);
    expect(again).toEqual(game.final);
  });

  it("redacted views never leak hidden information and agree with public state", () => {
    const game = playRandomGame("redact-me", { maxTurns: 40 });
    const state = game.final;
    for (const viewer of state.players) {
      const view = redact(state, viewer.id);
      expect(view.viewer).toBe(viewer.id);
      expect("seed" in view).toBe(false);
      expect(view.devDeck).toEqual({ count: state.devDeck.length });
      for (const p of view.players) {
        const real = getPlayer(state, p.id);
        const vp = victoryPoints(state, real);
        expect(p.publicVP).toBe(vp.publicVP);
        if (p.id === viewer.id) {
          expect(p.hand).toEqual(real.hand);
          expect(p.devCards).toEqual(real.devCards);
          expect(p.privateVP).toBe(vp.hiddenVP);
        } else {
          expect(p.hand).toEqual({ count: handSize(real.hand) });
          expect(p.devCards).toEqual({ count: real.devCards.length });
          expect(p.privateVP).toBeNull();
        }
      }
      expect(JSON.stringify(view)).not.toContain(state.seed);
    }
  });
});
