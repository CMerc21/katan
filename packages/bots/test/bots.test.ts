import { describe, expect, it } from "vitest";
import { createGame, legalActions, nextActor, redact, rng, type GameState } from "@katan/engine";
import { BOT_LEVELS, botStep, createBot, playBotGame, type BotLevel } from "../src/index";

const FOUR = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
  { id: "d", name: "D" },
];

describe("§6.7 bots", () => {
  for (const level of BOT_LEVELS) {
    it(`${level} completes 100 seeded games with no illegal action and no stall`, async () => {
      let maxTurns = 0;
      let maxActions = 0;
      for (let i = 0; i < 100; i++) {
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0)); // let the worker heartbeat
        const seed = `${level}-${i}`;
        const g = playBotGame({ seed, players: FOUR, board: "random", levels: [level, level, level, level] });
        expect(g.final.phase.kind, `seed ${seed} stalled at turn ${g.turns}`).toBe("ended");
        maxTurns = Math.max(maxTurns, g.turns);
        maxActions = Math.max(maxActions, g.actions.length);
      }
      expect(maxTurns).toBeLessThan(400);
      expect(maxActions).toBeLessThan(20_000);
    }, 120_000);
  }

  it("tournament: hard beats medium beats easy (loosely, over 100 games)", async () => {
    const wins = { hard: 0, medium: 0, easy: 0 };
    const levels: BotLevel[] = ["hard", "medium", "easy", "easy"];
    for (let i = 0; i < 100; i++) {
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
      // Rotate seats so seat order is not a confound.
      const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
      const g = playBotGame({ seed: `tourney-${i}`, players: FOUR, board: "random", levels: rotated });
      const winnerSeat = FOUR.findIndex((p) => p.id === g.final.winner);
      if (winnerSeat >= 0) wins[rotated[winnerSeat]!] += 1;
    }
    // Easy has two seats; compare per-seat rates.
    const easyPerSeat = wins.easy / 2;
    expect(wins.hard).toBeGreaterThan(wins.medium);
    expect(wins.medium).toBeGreaterThan(easyPerSeat);
  }, 240_000);

  it("is deterministic: same seed and same opponent actions give the same bot action log", () => {
    for (const level of BOT_LEVELS) {
      const a = playBotGame({ seed: "det", players: FOUR, board: "random", levels: [level, "easy", "medium", "hard"] });
      const b = playBotGame({ seed: "det", players: FOUR, board: "random", levels: [level, "easy", "medium", "hard"] });
      expect(b.actions).toEqual(a.actions);
      expect(b.final).toEqual(a.final);
    }
  }, 60_000);

  it("only ever receives a redacted view and chooses from the legal list", () => {
    const state: GameState = createGame({ seed: "boundary", players: FOUR, board: "beginner" });
    const spy = {
      level: "easy" as const,
      chooseAction(view: Parameters<ReturnType<typeof createBot>["chooseAction"]>[0], legal: ReturnType<typeof legalActions>) {
        expect("seed" in view).toBe(false);
        expect(view.viewer).toBe(nextActor(state));
        expect(view).toEqual(redact(state, view.viewer));
        return legal[0]!;
      },
    };
    const action = botStep(state, nextActor(state), spy);
    expect(legalActions(state, "a")).toContainEqual(action);
    // A policy returning something outside the legal list is rejected.
    const rogue = { level: "easy" as const, chooseAction: () => ({ type: "END_TURN" as const, playerId: "a" }) };
    expect(() => botStep(state, "a", rogue)).toThrow(/illegal action/);
  });

  it("hard chooses within budget on a mid-game position", () => {
    const g = playBotGame({ seed: "budget", players: FOUR, board: "random", levels: ["hard", "hard", "hard", "hard"], maxTurns: 25 });
    const state = g.final;
    const actor = nextActor(state);
    const view = redact(state, actor);
    const legal = legalActions(state, actor);
    const bot = createBot("hard");
    const draw = rng("budget", 1);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) bot.chooseAction(view, legal, () => draw.next());
    const perCall = (performance.now() - t0) / 20;
    expect(perCall).toBeLessThan(50);
  });
});

describe("docs/phase8.md §6 bots on arbitrary boards", () => {
  const SIX = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id.toUpperCase() }));
  for (const [name, board, count] of [
    ["Standard", "random", 4],
    ["Large (6 players)", "large", 6],
    ["Long strip", "longStrip", 4],
  ] as const) {
    it(`tournament on ${name}: 30 mixed games finish with no illegal action and no stall`, async () => {
      const { builtInBoard } = await import("@katan/engine");
      const levels: BotLevel[] = (["hard", "medium", "easy", "easy", "medium", "easy"] as BotLevel[]).slice(0, count);
      const def = board === "random" ? "random" : builtInBoard(board);
      let wins = 0;
      for (let i = 0; i < 30; i++) {
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        const rotated = levels.map((_, j) => levels[(j + i) % count]!);
        const g = playBotGame({ seed: `${board}-${i}`, players: SIX.slice(0, count), board: def, levels: rotated });
        expect(g.final.phase.kind, `${name} seed ${i} stalled at turn ${g.turns}`).toBe("ended");
        if (g.final.winner) wins += 1;
        if (count > 4) expect(g.actions.some((a) => a.type === "SPECIAL_BUILD_DONE")).toBe(true);
      }
      expect(wins).toBe(30);
    }, 240_000);
  }
});

describe("docs/phase9.md §9 bots on the Tides scenarios", () => {
  for (const id of ["acrossTheStrait", "archipelago", "goldCoast"] as const) {
    it(`${id}: 50 mixed games finish with no illegal action and no stall, and ships get built`, async () => {
      const { builtInScenario } = await import("@katan/engine");
      const scenario = builtInScenario(id);
      const levels: BotLevel[] = ["hard", "medium", "easy", "medium"];
      let ships = 0;
      let islandBonuses = 0;
      let goldChoices = 0;
      let pirateMoves = 0;
      for (let i = 0; i < 50; i++) {
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
        const g = playBotGame({ seed: `${id}-${i}`, players: FOUR, scenario, levels: rotated });
        expect(g.final.phase.kind, `${id} seed ${i} stalled at turn ${g.turns}`).toBe("ended");
        ships += g.actions.filter((a) => a.type === "BUILD_SHIP").length;
        goldChoices += g.actions.filter((a) => a.type === "CHOOSE_GOLD").length;
        pirateMoves += g.actions.filter((a) => a.type === "MOVE_ROBBER" && a.target === "pirate").length;
        islandBonuses += g.final.players.reduce((n, p) => n + p.islandChips.length, 0);
      }
      expect(ships).toBeGreaterThan(50);
      expect(goldChoices).toBeGreaterThan(0);
      if (scenario.pirate !== false) expect(pirateMoves).toBeGreaterThan(0);
      if ((scenario.islandBonus ?? 0) > 0) expect(islandBonuses).toBeGreaterThan(0);
    }, 300_000);
  }
});

describe("docs/phase7.md §5 bot names", () => {
  it("is deterministic and never repeats a name within a game", async () => {
    const { generateBotNames, isGeneratedBotName, FIRST_NAMES, EPITHETS, PLACES } = await import("../src/names");
    const { createRng } = await import("@katan/engine");
    const a = generateBotNames(() => createRng("names", 1).next(), 6);
    void a;
    const stream = () => {
      const r = createRng("names-2", 7);
      return () => r.next();
    };
    const x = generateBotNames(stream(), 6, ["Ada"]);
    const y = generateBotNames(stream(), 6, ["Ada"]);
    expect(x).toEqual(y);
    expect(new Set(x.map((n) => n.toLowerCase())).size).toBe(6);
    for (const n of x) expect(isGeneratedBotName(n)).toBe(true);
    // Difficulty never appears in the name.
    for (const n of x) expect(n).not.toMatch(/easy|medium|hard|bot/i);
    expect(FIRST_NAMES.length).toBeGreaterThanOrEqual(60);
    expect(EPITHETS.length).toBeGreaterThanOrEqual(40);
    expect(PLACES.length).toBeGreaterThanOrEqual(30);
    expect(isGeneratedBotName("Bot (easy)")).toBe(false);
  });
});
