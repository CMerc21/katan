import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { isScenario, scenarioModuleLabels, scenarioRules, scenarioSummary, validateScenario } from "../src/scenario";
import { BUILT_IN_SCENARIO_IDS, builtInScenario } from "../src/scenarios";
import { hasErrors } from "../src/validation";
import { FOUR } from "./helpers";

const SIX = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id.toUpperCase() }));

describe("docs/phase10.md §8 and docs/phase11.md §13 built-in scenarios", () => {
  it("every built-in validates, loads and carries its module switches into the state", () => {
    for (const id of BUILT_IN_SCENARIO_IDS) {
      const s = builtInScenario(id);
      expect(isScenario(s)).toBe(true);
      const issues = validateScenario(s);
      expect(hasErrors(issues), `${id}: ${JSON.stringify(issues)}`).toBe(false);
      const players = s.board.seats.max >= 6 ? SIX : FOUR;
      const game = createGame({ seed: "built-in", players, scenario: s });
      expect(game.scenario).toEqual(scenarioRules(s));
      expect(game.scenario?.crown).toBe(s.modules.crown === true);
      expect(game.crown !== null).toBe(s.modules.crown === true);
      const anyVariant = Object.values(s.variants ?? {}).some(Boolean);
      expect(game.wayfarers !== null).toBe(anyVariant);
    }
  });

  it("The Great Lake has a lake, three fishing grounds and fixed harbours; River Country a connected river; Salt Road three oases", () => {
    const lake = createGame({ seed: "x", players: FOUR, scenario: builtInScenario("greatLake") });
    expect(lake.board.hexes["0,0"]?.terrain).toBe("lake");
    expect(lake.board.hexes["0,0"]?.token).toBeNull();
    expect(lake.robberHex).toBe("0,0");
    expect(lake.board.fishingGrounds).toHaveLength(3);
    expect(lake.board.ports).toHaveLength(9);
    const river = createGame({ seed: "x", players: FOUR, scenario: builtInScenario("riverCountry") });
    expect(river.board.rivers).toHaveLength(10);
    const salt = createGame({ seed: "x", players: SIX, scenario: builtInScenario("saltRoad") });
    expect(salt.board.oases).toHaveLength(3);
    for (const o of salt.board.oases) expect(salt.board.hexes[o]?.token).not.toBeNull();
    const crown = createGame({ seed: "x", players: FOUR, scenario: builtInScenario("crownStandard") });
    expect(crown.devDeck).toHaveLength(0);
  });

  it("summaries name the modules and variants", () => {
    expect(scenarioModuleLabels(builtInScenario("greatLake"))).toEqual(["Fishing", "Harbormaster"]);
    expect(scenarioSummary(builtInScenario("goldCoast"))).toBe("Tides · 11 points to win");
    expect(scenarioSummary(builtInScenario("crownStandard"))).toBe("Crown & Castle · 13 points to win");
    expect(validateScenario({ ...builtInScenario("crownStandard"), variants: { raiders: true } }).some((i) => i.code === "SCENARIO_MODULES")).toBe(true);
  });
});
