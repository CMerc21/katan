import { it } from "vitest";
import { builtInScenario } from "@katan/engine";
import { playBotGame, type BotLevel } from "../src/index";
it("baseline crown", () => {
  const scenario = builtInScenario("crownStandard");
  const FOUR = ["a","b","c","d"].map((id) => ({ id, name: id }));
  const levels: BotLevel[] = ["hard", "medium", "easy", "medium"];
  let ended = 0; const types = new Map<string, number>();
  const t0 = performance.now();
  for (let i = 0; i < 6; i++) {
    const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
    const g = playBotGame({ seed: `crown-${i}`, players: FOUR, scenario, levels: rotated, maxTurns: 600 });
    if (g.final.phase.kind === "ended") ended += 1;
    for (const a of g.actions) types.set(a.type, (types.get(a.type) ?? 0) + 1);
    console.log(i, g.final.phase.kind, g.turns, g.actions.length, g.final.winner);
  }
  console.log("ended", ended, "ms", Math.round(performance.now() - t0));
  console.log([...types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
}, 600_000);
