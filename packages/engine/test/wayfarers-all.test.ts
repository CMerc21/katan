import { describe, expect, it } from "vitest";
import { RESOURCES } from "../src/board";
import { hexEdge } from "../src/geometry";
import type { HexDef } from "../src/definition";
import { createGame } from "../src/game";
import { FISH_BAG_TOTAL } from "../src/modules/wayfarers/fishing";
import { SPICE_BANK } from "../src/modules/types";
import type { Scenario } from "../src/scenario";
import { greatLakeBoard } from "../src/scenarios";
import { handSize, victoryPoints } from "../src/state";
import { BANK_PER_RESOURCE, type GameState } from "../src/types";
import { hasErrors } from "../src/validation";
import { validateScenario } from "../src/scenario";
import { FOUR, playRandomGame } from "./helpers";

/** Every Wayfarers variant at once: the Great Lake board with a river along the middle column and three oases. */
export function everythingScenario(): Scenario {
  const base = greatLakeBoard();
  const oases = new Set(["1,-2", "-2,1", "1,1"]);
  const river = [];
  for (let r = 2; r >= -2; r--) {
    river.push({ edge: hexEdge({ q: 0, r }, 0), kind: "river" as const });
    river.push({ edge: hexEdge({ q: 0, r }, 1), kind: "river" as const });
  }
  return {
    id: "everything",
    name: "Everything",
    board: {
      ...base,
      hexes: base.hexes.map((h): HexDef => (oases.has(`${h.at.q},${h.at.r}`) ? { ...h, extras: { oasis: true } } : h)),
      edges: [...(base.edges ?? []), ...river],
    },
    modules: {},
    variants: { eventDeck: true, fishing: true, rivers: true, harbormaster: true, raiders: true, caravans: true, wagons: true },
    victoryPoints: 13,
  };
}

/** VP recount from public state only, independent of the module hooks. */
function recount(state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId)!;
  const w = state.wayfarers!;
  let vp = p.settlements.length + 2 * p.cities.length;
  if (state.longestRoad.playerId === playerId) vp += 2;
  if (state.largestArmy.playerId === playerId) vp += 2;
  vp += p.devCards.filter((c) => c.type === "victoryPoint").length;
  if (w.fishing?.boot === playerId) vp -= 1;
  if (w.rivers?.bridgeBuilder.playerId === playerId) vp += 1;
  if (w.rivers?.poorSettler === playerId) vp -= 2;
  if (w.harbormaster?.playerId === playerId) vp += 2;
  if (w.raiders?.castles[playerId]) vp += 1;
  vp += w.raiders?.rebuilt[playerId] ?? 0;
  vp += w.wagons?.points[playerId] ?? 0;
  return vp;
}

describe("docs/phase10.md §9 every variant on at once", () => {
  it("the combined scenario validates and initialises every variant", () => {
    const s = everythingScenario();
    expect(hasErrors(validateScenario(s))).toBe(false);
    const game = createGame({ seed: "all", players: FOUR, scenario: s });
    const w = game.wayfarers!;
    for (const key of ["eventDeck", "fishing", "rivers", "harbormaster", "raiders", "caravans", "wagons"] as const) expect(w[key], key).not.toBeNull();
    expect(game.board.oases).toHaveLength(3);
    expect(game.board.rivers).toHaveLength(10);
    expect(game.board.fishingGrounds).toHaveLength(3);
  });

  it("100 random legal-action games keep resources, spice, fish, pieces and VP consistent", () => {
    const scenario = everythingScenario();
    let ended = 0;
    const stalled: string[] = [];
    for (let i = 0; i < 100; i++) {
      const game = playRandomGame(`all-${i}`, {
        scenario,
        maxTurns: 1000,
        onStep: (state) => {
          const w = state.wayfarers!;
          let total = 0;
          for (const r of RESOURCES) {
            let n = state.bank[r];
            for (const p of state.players) n += p.hand[r];
            if (n !== BANK_PER_RESOURCE) throw new Error(`resource ${r} not conserved: ${n}`);
            total += n;
          }
          if (total !== 95) throw new Error("total cards");
          const spice = w.caravans!.spiceBank + Object.values(w.caravans!.spice).reduce((n, x) => n + x, 0);
          if (spice !== SPICE_BANK) throw new Error(`spice not conserved: ${spice}`);
          const fish = w.fishing!.bag.reduce((n, x) => n + x, 0) + Object.values(w.fishing!.fish).reduce((n, x) => n + x, 0) + w.fishing!.spent;
          if (fish !== FISH_BAG_TOTAL) throw new Error(`fish not conserved: ${fish}`);
          for (const p of state.players) {
            if (p.roads.length + p.pieces.roads !== 15) throw new Error("roads");
            if (p.settlements.length + p.pieces.settlements !== 5) throw new Error("settlements");
            if (p.cities.length + p.pieces.cities !== 4) throw new Error("cities");
            if ((w.raiders!.guards[p.id]?.length ?? 0) > 6) throw new Error("guards");
            if (victoryPoints(state, p).total !== recount(state, p.id)) throw new Error(`VP mismatch for ${p.id}`);
          }
          for (const t of w.caravans!.tracks) if (t.edges.length > 3) throw new Error("caravan too long");
          void handSize;
        },
      });
      if (game.final.phase.kind === "ended") ended += 1;
      else stalled.push(`all-${i} (turn ${game.turnsPlayed}, top VP ${Math.max(...game.final.players.map((p) => victoryPoints(game.final, p).total))})`);
    }
    expect(stalled, stalled.join("; ")).toEqual([]);
    expect(ended).toBe(100);
  }, 300_000);
});
