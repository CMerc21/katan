import { describe, expect, it } from "vitest";
import { applyAction, applyActionWithEvents } from "../src/actions";
import { legalActions } from "../src/legal";
import { defenseOf, fleetStrength } from "../src/modules/crown/fleet";
import { getPlayer, nextActor, victoryPoints } from "../src/state";
import type { GameState } from "../src/types";
import { ROLL_PHASE, expectRule, give, inPhase, mut, place } from "./helpers";
import { A, B, C, D, addKnight, crownGame, crownOf, giveCommodities, setTrack, withNextCrownRoll } from "./crown-helpers";

/** meadow 4, mountain 8, claypit 4. */
const V1 = "1,0|1,1|2,0";
/** mountain 9, meadow 6, forest 9. */
const V3 = "1,-1|2,-2|2,-1";
/** farmland 5, farmland 3, wasteland. */
const V4 = "-1,0|-1,1|0,0";
/** forest 5 corner, far from the others. */
const V6 = "-3,0|-2,-1|-2,0";
const K1 = "0,1|1,0|1,1";
const K2 = "0,0|0,1|1,0";
const K3 = "-2,1|-1,0|-1,1";

/** The fleet one step from attacking, A to roll. */
function nearAttack(state = crownGame()): GameState {
  return mut(inPhase(state, ROLL_PHASE, A), (s) => void (crownOf(s).fleet = 6));
}

function rollFleet(state: GameState, total = 5) {
  return applyActionWithEvents(withNextCrownRoll(state, total, "fleet"), { type: "ROLL", playerId: A });
}

describe("docs/phase11.md §6 barbarian fleet", () => {
  it("docs/phase11.md §6 each fleet face advances the track one step; the seventh attacks and resets it", () => {
    const s = inPhase(crownGame(), ROLL_PHASE, A);
    const { state: one, events } = rollFleet(s);
    expect(crownOf(one).fleet).toBe(1);
    expect(events.some((e) => e.kind === "fleetAdvanced" && e.position === 1)).toBe(true);
    expect(events.some((e) => e.kind === "fleetAttacked")).toBe(false);
    const { state: attacked, events: attackEvents } = rollFleet(nearAttack());
    expect(crownOf(attacked).fleet).toBe(0);
    expect(crownOf(attacked).attacks).toBe(1);
    expect(attackEvents.map((e) => e.kind)).toEqual(["diceRolled", "fleetAdvanced", "fleetAttacked", "knightsDeactivated"]);
    const attack = attackEvents.find((e) => e.kind === "fleetAttacked");
    // No cities, no knights: 0 vs 0 is a defence with nobody to honour.
    expect(attack).toMatchObject({ strength: 0, defense: 0, result: "defended", defenders: [], losers: [] });
  });

  it("docs/phase11.md §6 strength counts cities (metropolises too); defense sums the levels of active knights", () => {
    let s = place(place(crownGame(), A, { cities: [V1, V3] }), B, { cities: [V4] });
    s = mut(s, (x) => void (crownOf(x).players[A]!.metropolises.trade = V1));
    expect(fleetStrength(s)).toBe(3);
    s = addKnight(addKnight(addKnight(s, A, K1, 2, true), A, K2, 3, false), B, K3, 1, true);
    expect(defenseOf(s, A)).toBe(2);
    expect(defenseOf(s, B)).toBe(1);
    expect(defenseOf(s, C)).toBe(0);
  });

  it("docs/phase11.md §6 defended with a single top defender: a Defender of the Realm chip (+1 VP) while the supply of six lasts", () => {
    let s = place(nearAttack(), A, { cities: [V1] });
    s = addKnight(addKnight(s, A, K1, 1, true), B, K3, 1, false);
    const before = victoryPoints(s, getPlayer(s, A)).total;
    const { state: after, events } = rollFleet(s);
    expect(events.find((e) => e.kind === "fleetAttacked")).toMatchObject({ strength: 1, defense: 1, result: "defended", defenders: [A], losers: [] });
    expect(events.some((e) => e.kind === "defenderAwarded" && e.playerId === A && e.chip === true)).toBe(true);
    expect(crownOf(after).players[A]!.defenderChips).toBe(1);
    expect(crownOf(after).defenderSupply).toBe(5);
    expect(victoryPoints(after, getPlayer(after, A)).total).toBe(before + 1);
    // Every knight stands down afterwards, including inactive ones' owners' others.
    expect(crownOf(after).knights.every((k) => !k.active)).toBe(true);
    expect(events.some((e) => e.kind === "knightsDeactivated")).toBe(true);
    // Supply exhausted: nothing is awarded.
    const dry = mut(s, (x) => void (crownOf(x).defenderSupply = 0));
    const { state: nothing, events: dryEvents } = rollFleet(dry);
    expect(crownOf(nothing).players[A]!.defenderChips).toBe(0);
    expect(dryEvents.some((e) => e.kind === "defenderAwarded")).toBe(false);
    expect(dryEvents.find((e) => e.kind === "fleetAttacked")).toMatchObject({ result: "defended", defenders: [A] });
  });

  it("docs/phase11.md §6 a tie for top defender: each tied player draws a progress card of their strongest track instead", () => {
    let s = place(nearAttack(), A, { cities: [V1] });
    s = addKnight(addKnight(s, A, K1, 1, true), B, K3, 1, true);
    s = setTrack(setTrack(s, A, "science", 2), B, "politics", 1);
    s = mut(s, (x) => {
      crownOf(x).decks.science = ["crane"];
      crownOf(x).decks.politics = ["spy"];
    });
    const { state: after, events } = rollFleet(s);
    expect(events.find((e) => e.kind === "fleetAttacked")).toMatchObject({ strength: 1, defense: 2, result: "defended", defenders: [A, B] });
    expect(events.filter((e) => e.kind === "defenderAwarded").map((e) => e.kind === "defenderAwarded" && [e.playerId, e.chip])).toEqual([
      [A, false],
      [B, false],
    ]);
    expect(crownOf(after).players[A]!.progress).toEqual([{ card: "crane", revealed: false }]);
    expect(crownOf(after).players[B]!.progress).toEqual([{ card: "spy", revealed: false }]);
    expect(crownOf(after).defenderSupply).toBe(6);
    expect(crownOf(after).players[A]!.defenderChips).toBe(0);
    // Ties go to trade first when the levels are equal.
    const flat = mut(s, (x) => {
      crownOf(x).players[A]!.tracks = { trade: 0, politics: 0, science: 0 };
      crownOf(x).decks.trade = ["merchant"];
    });
    expect(crownOf(rollFleet(flat).state).players[A]!.progress).toEqual([{ card: "merchant", revealed: false }]);
    // A drawn card over the hand limit must be discarded.
    const full = mut(s, (x) => void (crownOf(x).players[B]!.progress = [{ card: "bishop", revealed: false }, { card: "bishop", revealed: false }, { card: "warlord", revealed: false }, { card: "wedding", revealed: false }]));
    const { state: over } = rollFleet(full);
    expect(over.phase.kind).toBe("modulePrompt");
    if (over.phase.kind !== "modulePrompt") throw new Error("unreachable");
    expect(over.phase.prompt).toEqual({ kind: "discardProgress", playerId: B, count: 1 });
  });

  it("docs/phase11.md §6 raided: the city holders with the lowest defense each lose a city (auto with one, chosen with more); walls go with it", () => {
    let s = place(place(nearAttack(), A, { cities: [V1, V3] }), B, { cities: [V4] });
    s = place(s, C, { settlements: [V6] });
    s = addKnight(s, A, K1, 1, true); // A defends 1, B 0, C (no city) 0, D (nothing) 0
    s = mut(s, (x) => void crownOf(x).players[B]!.walls.push(V4));
    const { state: after, events } = rollFleet(s);
    expect(events.find((e) => e.kind === "fleetAttacked")).toMatchObject({ strength: 3, defense: 1, result: "raided", defenders: [], losers: [B] });
    expect(events.some((e) => e.kind === "cityDowngraded" && e.playerId === B && e.vertex === V4)).toBe(true);
    expect(after.phase).toEqual({ kind: "action" });
    const b = getPlayer(after, B);
    expect(b.cities).toEqual([]);
    expect(b.settlements).toEqual([V4]);
    expect(b.pieces).toMatchObject({ cities: 4, settlements: 4 });
    expect(crownOf(after).players[B]!.walls).toEqual([]);
    expect(getPlayer(after, A).cities).toEqual([V1, V3]);
    expect(getPlayer(after, C).settlements).toEqual([V6]);
    // With nobody defending, A (two cities) chooses and B loses automatically; prompts chain in seat order.
    const idle = mut(s, (x) => void (crownOf(x).knights = []));
    const { state: asked, events: askedEvents } = rollFleet(idle);
    expect(askedEvents.find((e) => e.kind === "fleetAttacked")).toMatchObject({ result: "raided", losers: [A, B] });
    expect(asked.phase.kind).toBe("modulePrompt");
    if (asked.phase.kind !== "modulePrompt") throw new Error("unreachable");
    expect(asked.phase.prompt).toEqual({ kind: "downgradeCity", playerId: A, pending: [] });
    expect(nextActor(asked)).toBe(A);
    expect(getPlayer(asked, B).cities).toEqual([]);
    expect(legalActions(asked, A).map((a) => a.type === "CHOOSE_DOWNGRADE" && a.vertex).sort()).toEqual([V1, V3].sort());
    expectRule(() => applyAction(asked, { type: "CHOOSE_DOWNGRADE", playerId: A, vertex: V4 }), "NOT_A_CITY");
    expectRule(() => applyAction(asked, { type: "CHOOSE_DOWNGRADE", playerId: B, vertex: V1 }), "NOT_YOUR_PROMPT");
    const chosen = applyAction(asked, { type: "CHOOSE_DOWNGRADE", playerId: A, vertex: V3 });
    expect(chosen.phase).toEqual({ kind: "action" });
    expect(getPlayer(chosen, A).cities).toEqual([V1]);
    expect(getPlayer(chosen, A).settlements).toEqual([V3]);
    // Two players choosing: the prompt chain visits both.
    const both = place(idle, B, { cities: [V6] });
    const twice = mut(both, (x) => void (getPlayer(x, C).settlements.splice(0)));
    const { state: chain } = rollFleet(twice);
    if (chain.phase.kind !== "modulePrompt") throw new Error("expected a prompt");
    expect(chain.phase.prompt).toEqual({ kind: "downgradeCity", playerId: A, pending: [B] });
    const second = applyAction(chain, { type: "CHOOSE_DOWNGRADE", playerId: A, vertex: V1 });
    if (second.phase.kind !== "modulePrompt") throw new Error("expected B's prompt");
    expect(second.phase.prompt).toEqual({ kind: "downgradeCity", playerId: B, pending: [] });
    expect(applyAction(second, { type: "CHOOSE_DOWNGRADE", playerId: B, vertex: V6 }).phase).toEqual({ kind: "action" });
  });

  it("docs/phase11.md §6 a metropolis is immune and does not count when picking the losers; players without cities are immune", () => {
    let s = place(place(nearAttack(), A, { cities: [V1, V3] }), B, { cities: [V4] });
    s = mut(s, (x) => {
      crownOf(x).players[A]!.metropolises.trade = V1;
      crownOf(x).metropolis.trade = A;
    });
    s = addKnight(s, B, K3, 1, true); // B defends 1, A 0: A loses; V1 is safe, so V3 goes automatically
    const { state: after, events } = rollFleet(s);
    expect(events.find((e) => e.kind === "fleetAttacked")).toMatchObject({ strength: 3, defense: 1, result: "raided", losers: [A] });
    expect(after.phase).toEqual({ kind: "action" });
    expect(getPlayer(after, A).cities).toEqual([V1]);
    expect(getPlayer(after, A).settlements).toEqual([V3]);
    expect(crownOf(after).players[A]!.metropolises.trade).toBe(V1);
    // Only a metropolis city: not a candidate at all, so the next-lowest holder loses instead.
    const onlyMetro = mut(s, (x) => void (getPlayer(x, A).cities = [V1]));
    const { state: spared, events: sparedEvents } = rollFleet(mut(onlyMetro, (x) => void (crownOf(x).knights = [])));
    expect(sparedEvents.find((e) => e.kind === "fleetAttacked")).toMatchObject({ strength: 2, defense: 0, result: "raided", losers: [B] });
    expect(getPlayer(spared, A).cities).toEqual([V1]);
    expect(getPlayer(spared, B).cities).toEqual([]);
    // A prompt never offers the metropolis city.
    const three = place(mut(s, (x) => void (crownOf(x).knights = [])), A, { cities: [V6] });
    const { state: asked } = rollFleet(three);
    if (asked.phase.kind !== "modulePrompt") throw new Error("expected a prompt");
    expect(legalActions(asked, A).map((a) => a.type === "CHOOSE_DOWNGRADE" && a.vertex).sort()).toEqual([V3, V6].sort());
    expectRule(() => applyAction(asked, { type: "CHOOSE_DOWNGRADE", playerId: A, vertex: V1 }), "INVALID_CHOICE");
  });

  it("docs/phase11.md §6 an attack on a seven wraps the discard phase, and lifts the robber lock for later sevens", () => {
    let s = place(place(nearAttack(), A, { cities: [V1, V3] }), B, { cities: [V4] });
    s = give(s, D, { wood: 8 });
    s = giveCommodities(s, D, { cloth: 1 });
    const { state: seven } = rollFleet(s, 7);
    expect(seven.phase.kind).toBe("modulePrompt");
    if (seven.phase.kind !== "modulePrompt") throw new Error("unreachable");
    expect(seven.phase.prompt).toMatchObject({ kind: "downgradeCity", playerId: A });
    expect(seven.phase.returnTo).toEqual({ kind: "discard", returnTo: { kind: "action" } });
    expect(seven.pendingDiscards[D]).toBe(4);
    const chosen = applyAction(seven, { type: "CHOOSE_DOWNGRADE", playerId: A, vertex: V1 });
    expect(chosen.phase.kind).toBe("discard");
    expect(nextActor(chosen)).toBe(D);
    expect(crownOf(chosen).attacks).toBe(1);
    // The next seven moves the robber.
    const later = inPhase(mut(chosen, (x) => void (x.pendingDiscards = {})), ROLL_PHASE, A);
    const rolled = applyAction(withNextCrownRoll(later, 7, "trade"), { type: "ROLL", playerId: A });
    expect(rolled.phase).toEqual({ kind: "discard", returnTo: { kind: "moveRobber", via: "seven", returnTo: "action" } });
  });
});
