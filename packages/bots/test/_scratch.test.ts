import { it } from "vitest";
import { applyActionWithEvents, builtInScenario, createGame, nextActor, type Action, type GameEvent, type PlayerId } from "@katan/engine";
import { botStep, createBot, type BotLevel, type BotPolicy } from "../src/index";

const FOUR = ["a","b","c","d"].map((id) => ({ id, name: id }));
function play(seed: string, levels: BotLevel[], scenario = builtInScenario("crownStandard")) {
  const policies = new Map<PlayerId, BotPolicy>();
  FOUR.forEach((p, i) => policies.set(p.id, createBot(levels[i]!)));
  let state = createGame({ seed, players: FOUR, scenario });
  const actions: Action[] = []; const events: GameEvent[] = [];
  while (state.phase.kind !== "ended" && state.turn < 600 && actions.length < 20000) {
    const actor = nextActor(state);
    const action = botStep(state, actor, policies.get(actor)!);
    const r = applyActionWithEvents(state, action);
    state = r.state; actions.push(action); events.push(...r.events);
  }
  return { final: state, actions, events };
}

it("stats", () => {
  const levels: BotLevel[] = ["hard", "medium", "easy", "medium"];
  const per: Record<string, Record<string, number>> = {};
  const ev = new Map<string, number>();
  let ended = 0; const t0 = performance.now(); let turns = 0;
  for (let i = 0; i < 20; i++) {
    const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
    const g = play(`crown-${i}`, rotated);
    if (g.final.phase.kind === "ended") ended += 1;
    turns += g.final.turn;
    for (const a of g.actions) {
      const lvl = rotated[FOUR.findIndex((p) => p.id === a.playerId)]!;
      per[lvl] ??= {}; per[lvl]![a.type] = (per[lvl]![a.type] ?? 0) + 1;
      if (a.type === "MARITIME_TRADE") { const k = `TRADE_${["cloth","coin","paper"].includes(a.give) ? "C" : "R"}>${["cloth","coin","paper"].includes(a.receive) ? "C" : "R"}@${a.giveCount}`; per[lvl]![k] = (per[lvl]![k] ?? 0) + 1; }
      if (a.type === "PLAY_PROGRESS") { const k = `P_${a.card}`; per[lvl]![k] = (per[lvl]![k] ?? 0) + 1; }
    }
    for (const e of g.events) ev.set(e.kind, (ev.get(e.kind) ?? 0) + 1);
    const w = g.final.winner; if (w) { const lvl = rotated[FOUR.findIndex((p) => p.id === w)]!; per[lvl]!["WIN"] = (per[lvl]!["WIN"] ?? 0) + 1; }
  }
  console.log("ended", ended, "avg turns", turns / 20, "ms", Math.round(performance.now() - t0));
  for (const [lvl, c] of Object.entries(per)) console.log(lvl, Object.entries(c).filter(([k]) => !/ROLL|END_TURN|REJECT|STEAL|GOLD|DISCARD$|MOVE_ROBBER/.test(k)).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log([...ev.entries()].filter(([k]) => /fleet|city|defender|knight|metropolis|improvement|progress/i.test(k)).map(([k, v]) => `${k}=${v}`).join(" "));
}, 600_000);

it.skip("tournament", () => {
  const levels: BotLevel[] = ["hard", "hard", "medium", "medium"];
  const wins = { hard: 0, medium: 0, easy: 0 };
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) {
    const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
    const g = play(`crown-tourney-${i}`, rotated);
    const seat = FOUR.findIndex((p) => p.id === g.final.winner);
    if (seat >= 0) wins[rotated[seat]!] += 1;
  }
  console.log("tournament", JSON.stringify(wins), "ms", Math.round(performance.now() - t0));
}, 600_000);
