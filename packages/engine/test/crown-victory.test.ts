import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { redact } from "../src/redact";
import { getPlayer, victoryPoints, winningVP } from "../src/state";
import { ACTION_PHASE, inPhase, mut, place } from "./helpers";
import { A, B, D, crownGame, crownOf } from "./crown-helpers";

const V1 = "1,0|1,1|2,0";
const V3 = "1,-1|2,-2|2,-1";
const V4 = "-1,0|-1,1|0,0";
const V6 = "-3,0|-2,-1|-2,0";
const V7 = "-2,2|-1,1|-1,2";

describe("docs/phase11.md §8 victory", () => {
  it("docs/phase11.md §8 metropolises, defender chips, revealed VP cards and the merchant add public points; nothing is hidden", () => {
    let s = place(crownGame(), A, { settlements: [V4, V6, V7], cities: [V1, V3] });
    const vp = (x = s) => victoryPoints(x, getPlayer(x, A));
    expect(vp()).toEqual({ publicVP: 7, hiddenVP: 0, total: 7 });
    s = mut(s, (x) => {
      crownOf(x).players[A]!.metropolises.trade = V1;
      crownOf(x).metropolis.trade = A;
    });
    expect(vp().total).toBe(9);
    s = mut(s, (x) => void (crownOf(x).players[A]!.defenderChips = 2));
    expect(vp().total).toBe(11);
    s = mut(s, (x) => void crownOf(x).players[A]!.progress.push({ card: "constitution", revealed: true }, { card: "spy", revealed: false }));
    expect(vp().total).toBe(12);
    s = mut(s, (x) => void (crownOf(x).merchant = { playerId: A, hex: "1,0" }));
    expect(vp()).toEqual({ publicVP: 13, hiddenVP: 0, total: 13 });
    expect(victoryPoints(s, getPlayer(s, B)).total).toBe(0);
    // Largest Army does not exist: knights played never count.
    const army = mut(s, (x) => void (getPlayer(x, B).playedKnights = 5));
    expect(victoryPoints(army, getPlayer(army, B)).total).toBe(0);
    expect(redact(s, B).players.find((p) => p.id === A)!.publicVP).toBe(13);
    expect(winningVP(s)).toBe(13);
  });

  it("docs/phase11.md §8 the game ends when the current player reaches 13", () => {
    let s = place(inPhase(crownGame(), ACTION_PHASE, D), A, { settlements: [V4, V6, V7], cities: [V1, V3] });
    s = mut(s, (x) => {
      const cp = crownOf(x).players[A]!;
      cp.metropolises.trade = V1;
      crownOf(x).metropolis.trade = A;
      cp.defenderChips = 3;
      cp.progress.push({ card: "printer", revealed: true });
    });
    expect(victoryPoints(s, getPlayer(s, A)).total).toBe(13);
    // Not A's turn: the game goes on until A becomes the current player.
    expect(s.phase).toEqual({ kind: "action" });
    const { state: ended, events } = applyActionWithEvents(s, { type: "END_TURN", playerId: D });
    expect(ended.phase).toEqual({ kind: "ended" });
    expect(ended.winner).toBe(A);
    const end = events.find((e) => e.kind === "gameEnded");
    expect(end?.kind === "gameEnded" && end.scores[A]).toBe(13);
    // One point short: play continues.
    const short = mut(s, (x) => void (crownOf(x).players[A]!.defenderChips = 2));
    expect(applyAction(short, { type: "END_TURN", playerId: D }).phase).toEqual({ kind: "roll" });
  });
});
