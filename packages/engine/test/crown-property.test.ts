import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RESOURCES } from "../src/board";
import { COMMODITIES, COMMODITY_BANK, KNIGHTS_PER_LEVEL, MAX_WALLS, PROGRESS_DECKS, PROGRESS_HAND_LIMIT, TRACKS, VP_PROGRESS_CARDS } from "../src/modules/types";
import { buildingAt, victoryPoints } from "../src/state";
import { BANK_PER_RESOURCE, type Action, type GameState } from "../src/types";
import { playRandomGame } from "./helpers";
import { CROWN_RANDOM, crownOf } from "./crown-helpers";

function assertEq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) throw new Error(`invariant: ${what} expected ${String(expected)} got ${String(actual)}`);
}

/** Cheap invariant checks for Crown & Castle games (docs/phase11.md §12). */
export function checkCrownInvariants(state: GameState, action?: Action): void {
  void action;
  const crown = crownOf(state);

  // Resource conservation (95) and piece supplies.
  let total = 0;
  for (const r of RESOURCES) {
    let n = state.bank[r];
    for (const p of state.players) {
      if (p.hand[r] < 0) throw new Error(`invariant: ${p.id} ${r} negative`);
      n += p.hand[r];
    }
    assertEq(n, BANK_PER_RESOURCE, `total ${r}`);
    total += n;
  }
  assertEq(total, 95, "total resources");
  for (const p of state.players) {
    assertEq(p.roads.length + p.pieces.roads, 15, `${p.id} roads`);
    assertEq(p.settlements.length + p.pieces.settlements, 5, `${p.id} settlements`);
    assertEq(p.cities.length + p.pieces.cities, 4, `${p.id} cities`);
  }
  assertEq(state.devDeck.length, 0, "dev deck");

  // Commodity conservation: bank + hands = 36.
  let commodities = 0;
  for (const c of COMMODITIES) {
    let n = crown.bank[c];
    if (n < 0) throw new Error(`invariant: commodity bank ${c} negative`);
    for (const cp of Object.values(crown.players)) {
      if (cp.commodities[c] < 0) throw new Error(`invariant: ${c} negative`);
      n += cp.commodities[c];
    }
    assertEq(n, COMMODITY_BANK, `total ${c}`);
    commodities += n;
  }
  assertEq(commodities, 3 * COMMODITY_BANK, "total commodities");

  // Progress cards: decks plus hands hold exactly the printed cards; nobody holds more than the limit outside a discard prompt.
  const held = Object.values(crown.players).flatMap((cp) => cp.progress.map((c) => c.card));
  assertEq(held.length + TRACKS.reduce((n, t) => n + crown.decks[t].length, 0), TRACKS.reduce((n, t) => n + PROGRESS_DECKS[t].reduce((m, [, k]) => m + k, 0), 0), "progress cards");
  if (state.phase.kind !== "modulePrompt" || state.phase.prompt.kind !== "discardProgress") {
    for (const cp of Object.values(crown.players)) {
      if (cp.progress.filter((c) => !c.revealed).length > PROGRESS_HAND_LIMIT) throw new Error("invariant: progress hand over the limit");
    }
  }

  // Knights: at most two per level per player, one per vertex, never on a building.
  const seen = new Set<string>();
  for (const p of state.players) {
    for (const level of [1, 2, 3] as const) {
      const n = crown.knights.filter((k) => k.owner === p.id && k.level === level).length;
      if (n > KNIGHTS_PER_LEVEL) throw new Error(`invariant: ${p.id} has ${n} level-${level} knights`);
    }
  }
  for (const k of crown.knights) {
    if (seen.has(k.at)) throw new Error(`invariant: two knights at ${k.at}`);
    seen.add(k.at);
    if (buildingAt(state, k.at) !== null) throw new Error(`invariant: knight on a building at ${k.at}`);
  }

  // Walls: at most three, only on own cities. Metropolises: on the holder's cities, holder recorded.
  for (const p of state.players) {
    const cp = crown.players[p.id]!;
    if (cp.walls.length > MAX_WALLS) throw new Error(`invariant: ${p.id} has ${cp.walls.length} walls`);
    for (const v of cp.walls) if (!p.cities.includes(v)) throw new Error(`invariant: wall off a city at ${v}`);
    assertEq(new Set(cp.walls).size, cp.walls.length, `${p.id} distinct walls`);
    for (const t of TRACKS) {
      const v = cp.metropolises[t];
      if (v === null) continue;
      if (!p.cities.includes(v)) throw new Error(`invariant: ${t} metropolis of ${p.id} at ${v} is not a city`);
      assertEq(crown.metropolis[t], p.id, `${t} metropolis holder`);
      if (cp.tracks[t] < 4) throw new Error(`invariant: ${p.id} holds the ${t} metropolis below level 4`);
    }
    for (const t of TRACKS) if (cp.tracks[t] < 0 || cp.tracks[t] > 5) throw new Error(`invariant: ${p.id} ${t} level ${cp.tracks[t]}`);
  }
  for (const t of TRACKS) {
    const holder = crown.metropolis[t];
    if (holder !== null && crown.players[holder]!.metropolises[t] === null) throw new Error(`invariant: ${t} metropolis holder without a city`);
  }
  if (crown.fleet < 0 || crown.fleet > 6) throw new Error(`invariant: fleet at ${crown.fleet}`);
  if (crown.defenderSupply + state.players.reduce((n, p) => n + crown.players[p.id]!.defenderChips, 0) !== 6) throw new Error("invariant: defender chips");
  assertEq(state.largestArmy.playerId, null, "largest army");

  // Victory points match an independent recount.
  for (const p of state.players) {
    const cp = crown.players[p.id]!;
    let expected = p.settlements.length + 2 * p.cities.length;
    if (state.longestRoad.playerId === p.id) expected += 2;
    expected += 2 * TRACKS.filter((t) => cp.metropolises[t] !== null).length;
    expected += cp.defenderChips;
    expected += cp.progress.filter((c) => c.revealed && VP_PROGRESS_CARDS.includes(c.card)).length;
    if (crown.merchant?.playerId === p.id) expected += 1;
    const vp = victoryPoints(state, p);
    assertEq(vp.total, expected, `${p.id} victory points`);
    assertEq(vp.hiddenVP, 0, `${p.id} hidden points`);
  }

  if (state.phase.kind === "ended" && state.winner === null) throw new Error("invariant: ended without winner");
}

describe("docs/phase11.md §12 property-based random play with Crown & Castle", () => {
  // A random driver at 13 VP is slow (median ~270 turns, a tail past 1000: raids keep sacking
  // undefended cities and no progress card is played yet), so the cap is wider than the base suite's 400.
  const MAX_TURNS = 1500;

  it(`docs/phase11.md §12 50 random legal-action games end within ${MAX_TURNS} turns with commodity, knight, wall, metropolis and VP invariants intact`, () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => {
        const game = playRandomGame(`crown-${n}`, { scenario: CROWN_RANDOM, maxTurns: MAX_TURNS, onStep: checkCrownInvariants });
        expect(game.final.phase.kind).toBe("ended");
        expect(game.final.winner).not.toBeNull();
        expect(game.turnsPlayed).toBeLessThan(MAX_TURNS);
        expect(crownOf(game.final).attacks).toBeGreaterThan(0);
      }),
      { numRuns: 50, seed: 11 },
    );
  }, 600_000);
});
