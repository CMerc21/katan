import { it } from "vitest";
import { builtInScenario } from "@katan/engine";
import { playBotGame, type BotLevel } from "../src/index";
const SIX = ["a","b","c","d","e","f"].map((id) => ({ id, name: id }));
for (const id of ["greatLake","riverCountry","coastalWatch","saltRoad"] as const) {
  it(`probe ${id}`, () => {
    const scenario = builtInScenario(id);
    const count = id === "saltRoad" ? 6 : 4;
    const levels: BotLevel[] = (["hard","medium","easy","medium","hard","easy"] as BotLevel[]).slice(0, count);
    const t0 = performance.now();
    const counts: Record<string, number> = {};
    let stalled = 0; let turns = 0; let landings = 0; let bootDrawn = 0; let coins = 0; let bridges = 0; let hm = 0; let wins: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      const rotated = levels.map((_, j) => levels[(j + i) % count]!);
      const g = playBotGame({ seed: `${id}-${i}`, players: SIX.slice(0, count), scenario, levels: rotated, maxTurns: 600 });
      if (g.final.phase.kind !== "ended") stalled++;
      turns += g.turns;
      for (const a of g.actions) counts[a.type] = (counts[a.type] ?? 0) + 1;
      landings += g.final.wayfarers?.raiders?.landings ?? 0;
      if (g.final.wayfarers?.fishing && !g.final.wayfarers.fishing.bag.includes(0)) bootDrawn++;
      coins += Object.values(g.final.wayfarers?.rivers?.coins ?? {}).reduce((n, c) => n + c, 0);
      bridges += g.final.players.reduce((n, p) => n + p.roads.filter((e) => g.final.board.rivers.includes(e)).length, 0);
      if (g.final.wayfarers?.harbormaster?.playerId) hm++;
      const seat = SIX.findIndex((p) => p.id === g.final.winner); if (seat >= 0) wins[rotated[seat]!] = (wins[rotated[seat]!] ?? 0) + 1;
    }
    console.log(id, "ms", Math.round(performance.now() - t0), "stalled", stalled, "avgTurns", turns / 10, "landings", landings, "bootDrawn", bootDrawn, "coins", coins, "bridges", bridges, "hm", hm, JSON.stringify(wins));
    console.log(id, JSON.stringify(counts));
  }, 600_000);
}
