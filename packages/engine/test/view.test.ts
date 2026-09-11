import { describe, expect, it } from "vitest";
import { legalActions } from "../src/legal";
import { legalActionsForView, redact, viewToState } from "../src/redact";
import { playRandomGame } from "./helpers";

describe("§12 legal actions from a redacted view", () => {
  it("match the authoritative legal actions for every player at every step of a random game", () => {
    let checked = 0;
    playRandomGame("view-legal", {
      onStep: (state) => {
        for (const p of state.players) {
          const view = redact(state, p.id);
          expect(legalActionsForView(view)).toEqual(legalActions(state, p.id));
          checked++;
        }
      },
    });
    expect(checked).toBeGreaterThan(1000);
  });

  it("viewToState never contains hidden information", () => {
    const game = playRandomGame("view-hidden", { maxTurns: 30 });
    const state = game.final;
    const view = redact(state, state.players[0]!.id);
    const rebuilt = viewToState(view);
    expect(rebuilt.seed).toBe("");
    expect(rebuilt.devDeck).toHaveLength(state.devDeck.length);
    for (const p of rebuilt.players.slice(1)) {
      expect(Object.values(p.hand).every((n) => n === 0)).toBe(true);
      expect(p.devCards).toEqual([]);
    }
    expect(rebuilt.players[0]!.hand).toEqual(state.players[0]!.hand);
  });
});
