import { describe, expect, it } from "vitest";
import { PROGRESS_DECKS, TRACKS, builtInScenario, createGame, redact, type Action, type ProgressCard } from "@katan/engine";
import { NO_PICK, computeTargets, soloCardAction, targetLabel, targetName } from "@/board3d/Interaction";
import { PROGRESS_CARD_HELP, PROGRESS_CARD_LABEL, actionLabel, bannerText, progressTiming } from "@/game/labels";
import { progressReason } from "@/components/crown/ProgressSheet";

const PLAYERS = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];

const EVERY_CARD: ProgressCard[] = TRACKS.flatMap((t) => PROGRESS_DECKS[t].map(([card]) => card));

describe("docs/phase11.md §11 Crown & Castle targeting modes", () => {
  const knightAt = (vertex: string): Action[] => [
    { type: "BUILD_KNIGHT", playerId: "a", vertex },
    { type: "ACTIVATE_KNIGHT", playerId: "a", vertex: "k1" },
    { type: "KNIGHT_MOVE", playerId: "a", from: "k1", to: "m1" },
    { type: "KNIGHT_MOVE", playerId: "a", from: "k2", to: "m2" },
    { type: "KNIGHT_DISPLACE", playerId: "a", from: "k1", to: "d1" },
    { type: "BUILD_WALL", playerId: "a", vertex: "c1" },
    { type: "BUILD_ROAD", playerId: "a", edge: "e1" },
  ];

  it("hire, move, displace and wall are separate modes; your knights are clickable when nothing is targeted", () => {
    const legal = knightAt("v1");
    const idle = computeTargets(legal, "action", null);
    expect(idle.vertices.size + idle.edges.size + idle.hexes.size).toBe(0);
    expect([...idle.knights].sort()).toEqual(["k1", "k2"]);
    expect([...computeTargets(legal, "action", "knight").vertices.keys()]).toEqual(["v1"]);
    expect(computeTargets(legal, "action", "knight").knights.size).toBe(0);
    expect([...computeTargets(legal, "action", "knightAct").knights].sort()).toEqual(["k1", "k2"]);
    const move = computeTargets(legal, "action", "knightMove", null, [], { from: "k1", first: null });
    expect([...move.vertices.keys()]).toEqual(["m1"]);
    const displace = computeTargets(legal, "action", "knightDisplace", null, [], { from: "k1", first: null });
    expect([...displace.vertices.keys()]).toEqual(["d1"]);
    expect([...computeTargets(legal, "action", "wall").vertices.keys()]).toEqual(["c1"]);
    // Road mode never shows knight picks.
    expect(computeTargets(legal, "action", "road").knights.size).toBe(0);
  });

  it("prompt answers on the board are always targets, with their own names", () => {
    const legal: Action[] = [
      { type: "PLACE_METROPOLIS", playerId: "a", vertex: "c1" },
      { type: "RETREAT_KNIGHT", playerId: "a", vertex: "r1" },
      { type: "RETREAT_KNIGHT", playerId: "a", vertex: null },
      { type: "PLACE_FREE_KNIGHT", playerId: "a", vertex: null },
    ];
    const t = computeTargets(legal, "modulePrompt", null);
    expect([...t.vertices.keys()].sort()).toEqual(["c1", "r1"]);
    expect(targetName(t.vertices.get("c1")!)).toBe("metropolis");
    expect(targetName(t.vertices.get("r1")!)).toBe("retreat");
    expect(targetLabel(t.vertices.get("r1")!, "r1")).toBe("Retreat the knight to r1");
    expect(targetName({ type: "CHOOSE_DOWNGRADE", playerId: "a", vertex: "x" })).toBe("downgrade");
    expect(targetName({ type: "BUILD_KNIGHT", playerId: "a", vertex: "x" })).toBe("knight");
    expect(targetName({ type: "PLAY_PROGRESS", playerId: "a", card: "bishop", payload: { hex: "0,0" } })).toBe("progress:bishop");
  });

  it("the Inventor picks two tokens, the Diplomat an open road then a relocation, the Smith one or two knights", () => {
    const inventor: Action[] = [
      { type: "PLAY_PROGRESS", playerId: "a", card: "inventor", payload: { hexes: ["h1", "h2"] } },
      { type: "PLAY_PROGRESS", playerId: "a", card: "inventor", payload: { hexes: ["h1", "h3"] } },
    ];
    const first = computeTargets(inventor, "action", "progress:inventor");
    expect([...first.picks.hexes].sort()).toEqual(["h1", "h2", "h3"]);
    expect(first.hexes.size).toBe(0);
    const second = computeTargets(inventor, "action", "progress:inventor", null, [], { from: null, first: "h3" });
    expect([...second.hexes.keys()]).toEqual(["h1"]);
    expect(second.hexes.get("h1")).toMatchObject({ payload: { hexes: ["h1", "h3"] } });

    const diplomat: Action[] = [
      { type: "PLAY_PROGRESS", playerId: "a", card: "diplomat", payload: { edge: "own" } },
      { type: "PLAY_PROGRESS", playerId: "a", card: "diplomat", payload: { edge: "own", relocateTo: "r1" } },
      { type: "PLAY_PROGRESS", playerId: "a", card: "diplomat", payload: { edge: "theirs" } },
    ];
    const d1 = computeTargets(diplomat, "action", "progress:diplomat");
    expect([...d1.picks.edges]).toEqual(["own"]);
    expect([...d1.edges.keys()]).toEqual(["theirs"]);
    const d2 = computeTargets(diplomat, "action", "progress:diplomat", null, [], { from: null, first: "own" });
    expect([...d2.edges.keys()]).toEqual(["r1"]);
    expect(soloCardAction(diplomat, "progress:diplomat", "own")).toMatchObject({ payload: { edge: "own" } });
    expect(soloCardAction(diplomat, "progress:diplomat", "theirs")).toMatchObject({ payload: { edge: "theirs" } });

    const smith: Action[] = [
      { type: "PLAY_PROGRESS", playerId: "a", card: "smith", payload: { vertices: ["k1"] } },
      { type: "PLAY_PROGRESS", playerId: "a", card: "smith", payload: { vertices: ["k2"] } },
      { type: "PLAY_PROGRESS", playerId: "a", card: "smith", payload: { vertices: ["k1", "k2"] } },
      { type: "PLAY_PROGRESS", playerId: "a", card: "smith", payload: { vertices: ["k3"] } },
    ];
    const s1 = computeTargets(smith, "action", "progress:smith");
    expect([...s1.picks.vertices].sort()).toEqual(["k1", "k2"]);
    expect([...s1.vertices.keys()]).toEqual(["k3"]);
    const s2 = computeTargets(smith, "action", "progress:smith", null, [], { from: null, first: "k2" });
    expect([...s2.vertices.keys()]).toEqual(["k1"]);
    expect(soloCardAction(smith, "progress:smith", "k2")).toMatchObject({ payload: { vertices: ["k2"] } });
    expect(soloCardAction(smith, null, "k2")).toBeUndefined();
    expect(computeTargets(smith, "action", null, null, [], NO_PICK).picks.vertices.size).toBe(0);
  });
});

describe("docs/phase11.md §11 Crown & Castle copy", () => {
  it("every progress card has a name, a help line and a timing", () => {
    for (const card of EVERY_CARD) {
      expect(PROGRESS_CARD_LABEL[card].length).toBeGreaterThan(0);
      expect(PROGRESS_CARD_HELP[card].length).toBeGreaterThan(10);
      expect(["before the roll only", "before or after the roll", "after the roll"]).toContain(progressTiming(card));
    }
    expect(progressTiming("alchemist")).toBe("before the roll only");
    expect(progressTiming("bishop")).toBe("before or after the roll");
    expect(progressTiming("crane")).toBe("after the roll");
    expect(actionLabel({ type: "BUILD_IMPROVEMENT", playerId: "a", track: "science" })).toBe("Improve science");
    expect(actionLabel({ type: "RETREAT_KNIGHT", playerId: "a", vertex: null })).toBe("Lose the knight");
  });

  it("the prompts have banners and the progress reasons explain a card that cannot be played", () => {
    const state = createGame({ seed: "crown-ui", players: PLAYERS, scenario: builtInScenario("crownStandard") });
    const view = redact(state, "a");
    expect(view.scenario?.crown).toBe(true);
    expect(view.crown?.decks).toEqual({ trade: 18, politics: 18, science: 17 });
    expect(bannerText({ ...view, phase: { kind: "modulePrompt", prompt: { kind: "spy", playerId: "a", target: "b" }, returnTo: { kind: "action" } } }, "a")).toBe("Take one of their progress cards");
    expect(bannerText({ ...view, phase: { kind: "modulePrompt", prompt: { kind: "knightRetreat", playerId: "b", level: 1, active: false, from: "x", pending: [] }, returnTo: { kind: "action" } } }, "a")).toBe("Waiting for Bo: choose where your knight retreats");
    expect(progressReason(view, "a", "constitution", true, [])).toBe("Counts automatically");
    expect(progressReason({ ...view, phase: { kind: "roll" } }, "a", "crane", false, [])).toBe("Only after rolling");
    expect(progressReason({ ...view, phase: { kind: "action" } }, "a", "alchemist", false, [])).toBe("Only before rolling");
    expect(progressReason({ ...view, phase: { kind: "action" } }, "a", "bishop", false, [])).toBe("The robber stays home until the barbarians have attacked once");
    expect(progressReason({ ...view, phase: { kind: "action" } }, "b", "bishop", false, [])).toBe("Not your turn");
    expect(progressReason({ ...view, phase: { kind: "action" } }, "a", "crane", false, [{ type: "PLAY_PROGRESS", playerId: "a", card: "crane" }])).toBeNull();
  });
});
