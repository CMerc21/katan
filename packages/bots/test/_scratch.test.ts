import { it } from "vitest";
import { applyActionWithEvents, builtInScenario, createGame, nextActor, victoryPoints, type Action, type GameEvent, type PlayerId } from "@katan/engine";
import { CROWN_WEIGHTS, botStep, createBot, playBotGame, type BotLevel, type BotPolicy } from "../src/index";

const FOUR = ["a","b","c","d"].map((id) => ({ id, name: id }));
function play(seed: string, levels: BotLevel[], scenario = builtInScenario("crownStandard")) {
  const policies = new Map<PlayerId, BotPolicy>();
  FOUR.forEach((p, i) => policies.set(p.id, createBot(levels[i]!)));
  let state = createGame({ seed, players: FOUR, scenario });
  const actions: Action[] = []; const events: GameEvent[] = [];
  const attacks: { defence: Record<string, number>; strength: number; losers: string[]; fleetAt: Record<string, number> }[] = [];
  const chaseFleet: Record<string, number[]> = {};
  while (state.phase.kind !== "ended" && state.turn < 600 && actions.length < 20000) {
    const actor = nextActor(state);
    const action = botStep(state, actor, policies.get(actor)!);
    if (action.type === "KNIGHT_CHASE_ROBBER") (chaseFleet[actor] ??= []).push(state.crown!.fleet);
    const r = applyActionWithEvents(state, action);
    const att = r.events.find((e) => e.kind === "fleetAttacked");
    if (att && att.kind === "fleetAttacked") {
      const defence: Record<string, number> = {};
      for (const p of state.players) defence[p.id] = state.crown!.knights.filter((k) => k.owner === p.id && k.active).reduce((n, k) => n + k.level, 0);
      attacks.push({ defence, strength: att.strength, losers: att.losers, fleetAt: {} });
    }
    state = r.state; actions.push(action); events.push(...r.events);
  }
  return { final: state, actions, events, attacks, chaseFleet };
}

function playBase(seed: string, levels: BotLevel[]) {
  const g = playBotGame({ seed, players: FOUR, board: "random", levels, maxTurns: 600 });
  return { final: g.final, actions: g.actions, events: [] as GameEvent[] };
}
it.skip("stats", () => {
  const levels: BotLevel[] = ["hard", "hard", "medium", "medium"];
  const per: Record<string, Record<string, number>> = {};
  const ev = new Map<string, number>();
  let ended = 0; const t0 = performance.now(); let turns = 0;
  for (let i = 0; i < 20; i++) {
    const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
    const g = play(`crown-tourney-v3-${i}`, rotated);
    if (g.final.phase.kind === "ended") ended += 1;
    turns += g.final.turn;
    for (const a of g.actions) {
      const lvl = rotated[FOUR.findIndex((p) => p.id === a.playerId)]!;
      per[lvl] ??= {}; per[lvl]![a.type] = (per[lvl]![a.type] ?? 0) + 1;
      if (a.type === "MARITIME_TRADE") { const k = `TRADE_${["cloth","coin","paper"].includes(a.give) ? "C" : "R"}>${["cloth","coin","paper"].includes(a.receive) ? "C" : "R"}@${a.giveCount}`; per[lvl]![k] = (per[lvl]![k] ?? 0) + 1; }
      if (a.type === "PLAY_PROGRESS") { const k = `P_${a.card}`; per[lvl]![k] = (per[lvl]![k] ?? 0) + 1; }
    }
    for (const e of g.events) ev.set(e.kind, (ev.get(e.kind) ?? 0) + 1);
    for (const e of g.events) {
      const pid = "playerId" in e ? (e as { playerId?: string }).playerId : undefined;
      if (!pid) continue;
      const lvl = rotated[FOUR.findIndex((p) => p.id === pid)]; if (!lvl) continue;
      if (e.kind === "cityDowngraded" || e.kind === "defenderAwarded" || e.kind === "metropolisPlaced" || e.kind === "knightRemoved" || e.kind === "discarded") per[lvl]![`E_${e.kind}`] = (per[lvl]![`E_${e.kind}`] ?? 0) + 1;
    }
    for (const a of g.attacks) for (const p of FOUR) {
      const lvl = rotated[FOUR.findIndex((x) => x.id === p.id)]!;
      per[lvl]!["ATT_DEF"] = (per[lvl]!["ATT_DEF"] ?? 0) + (a.defence[p.id] ?? 0);
      per[lvl]!["ATT_N"] = (per[lvl]!["ATT_N"] ?? 0) + 1;
      if (a.losers.includes(p.id)) per[lvl]!["ATT_LOST"] = (per[lvl]!["ATT_LOST"] ?? 0) + 1;
      if ((a.defence[p.id] ?? 0) === 0) per[lvl]!["ATT_ZERO"] = (per[lvl]!["ATT_ZERO"] ?? 0) + 1;
    }
    for (const [pid, fl] of Object.entries(g.chaseFleet)) { const lvl = rotated[FOUR.findIndex((x) => x.id === pid)]!; per[lvl]!["CHASE_FLEET_SUM"] = (per[lvl]!["CHASE_FLEET_SUM"] ?? 0) + fl.reduce((n, x) => n + x, 0); }
    for (const e of g.events) if (e.kind === "progressDrawn") { const lvl = rotated[FOUR.findIndex((p) => p.id === e.playerId)]!; per[lvl]!["DRAWN"] = (per[lvl]!["DRAWN"] ?? 0) + 1; }
    for (const p of g.final.players) {
      const lvl = rotated[FOUR.findIndex((x) => x.id === p.id)]!; const cp = g.final.crown!.players[p.id]!;
      per[lvl]!["VP"] = (per[lvl]!["VP"] ?? 0) + p.settlements.length + 2 * p.cities.length;
      per[lvl]!["TOTALVP"] = (per[lvl]!["TOTALVP"] ?? 0) + victoryPoints(g.final, p).total;
      per[lvl]!["ROADS_END"] = (per[lvl]!["ROADS_END"] ?? 0) + p.roads.length;
      if (g.final.longestRoad.playerId === p.id) per[lvl]!["LR"] = (per[lvl]!["LR"] ?? 0) + 1;
      per[lvl]!["LEVELS"] = (per[lvl]!["LEVELS"] ?? 0) + cp.tracks.trade + cp.tracks.politics + cp.tracks.science;
      per[lvl]!["CHIPS"] = (per[lvl]!["CHIPS"] ?? 0) + cp.defenderChips;
      per[lvl]!["METRO"] = (per[lvl]!["METRO"] ?? 0) + Object.values(cp.metropolises).filter((v) => v !== null).length;
      per[lvl]!["KNIGHTS_END"] = (per[lvl]!["KNIGHTS_END"] ?? 0) + g.final.crown!.knights.filter((k) => k.owner === p.id).length;
    }
    const w = g.final.winner; if (w) { const lvl = rotated[FOUR.findIndex((p) => p.id === w)]!; per[lvl]!["WIN"] = (per[lvl]!["WIN"] ?? 0) + 1; }
  }
  console.log("ended", ended, "avg turns", turns / 40, "ms", Math.round(performance.now() - t0));
  for (const [lvl, c] of Object.entries(per)) console.log(lvl, Object.entries(c).filter(([k]) => !/ROLL|END_TURN|REJECT|STEAL|GOLD|DISCARD$|MOVE_ROBBER/.test(k)).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log([...ev.entries()].filter(([k]) => /fleet|city|defender|knight|metropolis|improvement|progress/i.test(k)).map(([k, v]) => `${k}=${v}`).join(" "));
}, 600_000);

const VARIANTS: Record<string, Partial<typeof CROWN_WEIGHTS>> = JSON.parse(process.env.VARIANTS ?? '{"base":{}}');
for (const [name, over] of Object.entries(VARIANTS)) {
  it(`tournament ${name}`, () => {
    const saved = { ...CROWN_WEIGHTS };
    Object.assign(CROWN_WEIGHTS, over);
    const levels: BotLevel[] = ["hard", "hard", "medium", "medium"];
    const wins = { hard: 0, medium: 0, easy: 0 };
    const t0 = performance.now();
    const n = Number(process.env.GAMES ?? 80);
    for (let i = 0; i < n; i++) {
      const rotated = levels.map((_, j) => levels[(j + i) % 4]!);
      const g = process.env.BASEGAME ? playBase(`${process.env.PREFIX ?? "crown-tourney-v3"}-${i}`, rotated) : play(`${process.env.PREFIX ?? "crown-tourney-v3"}-${i}`, rotated);
      const seat = FOUR.findIndex((p) => p.id === g.final.winner);
      if (seat >= 0) wins[rotated[seat]!] += 1;
    }
    console.log("tournament", name, JSON.stringify(wins), "ms", Math.round(performance.now() - t0));
    Object.assign(CROWN_WEIGHTS, saved);
  }, 900_000);
}
