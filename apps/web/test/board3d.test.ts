import { describe, expect, it } from "vitest";
import { GEOMETRY, createGame, legalActions, type Action } from "@katan/engine";
import { createLayout } from "@/board/layout";
import { boardBounds, edgeWorld, framingDistance, hexCornerWorld, hexWorld, tileJitter, vertexWorld } from "@/board3d/layout3d";
import { computeTargets, targetName, wagonMoveFor } from "@/board3d/Interaction";
import { FrameWatchdog, QUALITY_PRESETS, detectQuality, stepDown } from "@/board3d/quality";
import { propsForHex } from "@/board3d/props";

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

describe("docs/phase7-5.md §2 world layout agrees with the 2D layout", () => {
  it("every vertex and edge ID maps to the same point in both (y → z)", () => {
    const R = 50;
    const layout = createLayout(R);
    for (const v of GEOMETRY.vertices) {
      const p2 = layout.vertex(v);
      const p3 = vertexWorld(v);
      expect(close(p2.x / R, p3.x)).toBe(true);
      expect(close(p2.y / R, p3.z)).toBe(true);
    }
    for (const e of GEOMETRY.edges) {
      const m2 = layout.edgeMid(e);
      const m3 = edgeWorld(e).mid;
      expect(close(m2.x / R, m3.x)).toBe(true);
      expect(close(m2.y / R, m3.z)).toBe(true);
    }
    for (const h of GEOMETRY.hexes) {
      const c2 = layout.hex(h);
      const c3 = hexWorld(h);
      expect(close(c2.x / R, c3.x)).toBe(true);
      expect(close(c2.y / R, c3.z)).toBe(true);
      for (let k = 0; k < 6; k++) {
        const k2 = layout.corner(h, k);
        const k3 = hexCornerWorld(h, k);
        expect(close(k2.x / R, k3.x, 1e-6)).toBe(true);
        expect(close(k2.y / R, k3.z, 1e-6)).toBe(true);
      }
    }
  });

  it("bounds enclose every corner and the framing distance grows with the radius", () => {
    const b = boardBounds([...GEOMETRY.hexes]);
    expect(close(b.cx, 0, 1e-9)).toBe(true);
    expect(close(b.cz, 0, 1e-9)).toBe(true);
    for (const h of GEOMETRY.hexes) for (let k = 0; k < 6; k++) {
      const p = hexCornerWorld(h, k);
      expect(Math.hypot(p.x - b.cx, p.z - b.cz)).toBeLessThanOrEqual(b.radius + 1e-9);
    }
    expect(framingDistance(10, 40, 1.6)).toBeGreaterThan(framingDistance(5, 40, 1.6));
    expect(framingDistance(5, 40, 0.5)).toBeGreaterThan(framingDistance(5, 40, 1.6));
  });

  it("tile jitter is seeded, small, and different per tile", () => {
    const a = tileJitter("0,0");
    expect(tileJitter("0,0")).toEqual(a);
    expect(tileJitter("1,0")).not.toEqual(a);
    const deg = Math.PI / 180;
    for (const h of GEOMETRY.hexes) {
      const j = tileJitter(h);
      expect(Math.abs(j.tiltX)).toBeLessThanOrEqual(0.5 * deg);
      expect(Math.abs(j.tiltZ)).toBeLessThanOrEqual(0.5 * deg);
      expect(Math.abs(j.height - 1)).toBeLessThanOrEqual(0.02);
    }
  });
});

describe("docs/phase7-5.md §5 interaction layer", () => {
  it("enables exactly the legal targets for the phase and mode", () => {
    const state = createGame({ seed: "targets", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], board: "beginner" });
    const legal = legalActions(state, "a");
    const t = computeTargets(legal, "setup", null);
    expect(t.vertices.size).toBe(54);
    expect(t.edges.size).toBe(0);
    expect(t.hexes.size).toBe(0);
    for (const [v, a] of t.vertices) expect(a).toMatchObject({ type: "BUILD_SETTLEMENT", vertex: v });
    // In the action phase nothing is a target until a build mode is chosen.
    const none = computeTargets(legal, "action", null);
    expect(none.vertices.size + none.edges.size + none.hexes.size).toBe(0);
    const roads = computeTargets([{ type: "BUILD_ROAD", playerId: "a", edge: "0,0|1,0" }], "action", "road");
    expect([...roads.edges.keys()]).toEqual(["0,0|1,0"]);
    const robber = computeTargets([{ type: "MOVE_ROBBER", playerId: "a", hex: "1,0" }], "moveRobber", null);
    expect([...robber.hexes.keys()]).toEqual(["1,0"]);
  });
});

describe("docs/phase10.md §5 Wayfarers target modes", () => {
  const legal: Action[] = [
    { type: "BUILD_KNIGHT", playerId: "a", hex: "0,0" },
    { type: "REBUILD_HEX", playerId: "a", hex: "1,0" },
    { type: "EXTEND_CARAVAN", playerId: "a", caravan: 0, edge: "0,0|1,0" },
    { type: "EXTEND_CARAVAN", playerId: "a", caravan: 1, edge: "0,0|1,0" },
    { type: "SPEND_FISH", playerId: "a", option: "moveRobber", hex: "0,1" },
    { type: "SPEND_FISH", playerId: "a", option: "freeRoad", edge: "0,0|0,1" },
    { type: "SPEND_FISH", playerId: "a", option: "freeDevCard", vertex: "v1" },
    { type: "SPEND_FISH", playerId: "a", option: "steal", targetPlayerId: "b" },
    { type: "BUILD_CASTLE", playerId: "a", vertex: "v2" },
    { type: "MOVE_WAGON", playerId: "a", path: ["w0", "w1"] },
    { type: "MOVE_WAGON", playerId: "a", path: ["w0", "w1", "w2"] },
    { type: "MOVE_WAGON", playerId: "a", path: ["w0", "w1", "w3"], grain: 1 },
    { type: "MOVE_WAGON", playerId: "a", path: ["w0", "w4"] },
  ];

  it("each mode exposes exactly its own targets, and the castle prompt needs no mode", () => {
    const none = computeTargets(legal, "action", null);
    expect(none.hexes.size + none.edges.size + none.steps.size).toBe(0);
    expect([...none.vertices.keys()]).toEqual(["v2"]);
    expect([...computeTargets(legal, "action", "guard").hexes.keys()]).toEqual(["0,0"]);
    expect([...computeTargets(legal, "action", "rebuild").hexes.keys()]).toEqual(["1,0"]);
    const caravan = computeTargets(legal, "action", "caravan");
    expect([...caravan.edges.keys()]).toEqual(["0,0|1,0"]);
    expect(caravan.edges.get("0,0|1,0")).toMatchObject({ caravan: 0 });
    expect([...computeTargets(legal, "action", "fishRobber").hexes.keys()]).toEqual(["0,1"]);
    expect([...computeTargets(legal, "action", "fishRoad").edges.keys()]).toEqual(["0,0|0,1"]);
    expect([...computeTargets(legal, "action", "fishCity").vertices.keys()].sort()).toEqual(["v1", "v2"]);
  });

  it("wagon mode offers the next stops along the legal paths and Go resolves the exact path", () => {
    expect([...computeTargets(legal, "action", "wagon").steps].sort()).toEqual(["w1", "w4"]);
    expect([...computeTargets(legal, "action", "wagon", null, ["w1"]).steps].sort()).toEqual(["w2", "w3"]);
    expect(computeTargets(legal, "action", "wagon", null, ["w4"]).steps.size).toBe(0);
    expect(wagonMoveFor(legal, [])).toBeUndefined();
    expect(wagonMoveFor(legal, ["w1"])).toMatchObject({ path: ["w0", "w1"] });
    expect(wagonMoveFor(legal, ["w1", "w3"])).toMatchObject({ grain: 1 });
  });

  it("overlay buttons carry a data-target name per action", () => {
    expect(legal.map(targetName)).toEqual(["guard", "rebuild", "caravan", "caravan", "fishRobber", "fishRoad", "fishCity", "fish", "castle", "MOVE_WAGON", "MOVE_WAGON", "MOVE_WAGON", "MOVE_WAGON"]);
    expect(targetName({ type: "MOVE_ROBBER", playerId: "a", hex: "0,0", target: "pirate" })).toBe("pirate");
    expect(targetName({ type: "BUILD_KNIGHT", playerId: "a", vertex: "v" })).toBe("knight");
  });
});

describe("docs/phase7-5.md §4 props", () => {
  it("are seeded per tile, respect the density, and stay inside the tile", () => {
    const a = propsForHex("0,0", "forest", 1);
    expect(propsForHex("0,0", "forest", 1)).toEqual(a);
    expect(propsForHex("1,0", "forest", 1)).not.toEqual(a);
    expect(a.filter((p) => p.kind === "pine").length).toBeGreaterThanOrEqual(5);
    const low = propsForHex("0,0", "forest", 0.4);
    expect(low.length).toBeLessThan(a.length);
    for (const p of [...a, ...propsForHex("2,-1", "meadow", 1), ...propsForHex("0,1", "mountain", 1)]) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(0.86);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(0.36);
    }
  });
});

describe("docs/phase7-5.md §7 quality", () => {
  it("auto-detects conservatively and steps down one level at a time", () => {
    expect(detectQuality({ maxTextureSize: 16384, maxRenderbufferSize: 16384, dpr: 2, cores: 12, mobile: false, software: false })).toBe("high");
    expect(detectQuality({ maxTextureSize: 8192, maxRenderbufferSize: 8192, dpr: 2, cores: 4, mobile: false, software: false })).toBe("medium");
    expect(detectQuality({ maxTextureSize: 8192, maxRenderbufferSize: 8192, dpr: 3, cores: 8, mobile: true, software: false })).toBe("medium");
    expect(detectQuality({ maxTextureSize: 4096, maxRenderbufferSize: 4096, dpr: 2, cores: 4, mobile: true, software: false })).toBe("low");
    expect(detectQuality({ maxTextureSize: 16384, maxRenderbufferSize: 16384, dpr: 1, cores: 16, mobile: false, software: true })).toBe("low");
    expect(stepDown("high")).toBe("medium");
    expect(stepDown("medium")).toBe("low");
    expect(stepDown("low")).toBeNull();
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
    expect(QUALITY_PRESETS.high.postfx).toBe(true);
    expect(QUALITY_PRESETS.medium.propDensity).toBe(0.7);
  });

  it("the watchdog fires after 3 s of slow frames and not on a brief hitch", () => {
    const dog = new FrameWatchdog(33, 3000);
    let now = 0;
    // 2.9 s of 40 ms frames: not yet.
    for (let i = 0; i < 72; i++) expect(dog.sample(40, (now += 40))).toBe(false);
    // One fast frame resets the window.
    expect(dog.sample(16, (now += 16))).toBe(false);
    for (let i = 0; i < 75; i++) expect(dog.sample(40, (now += 40))).toBe(false);
    // Crossing 3 s continuous fires exactly once, then resets.
    expect(dog.sample(40, (now += 40))).toBe(true);
    expect(dog.sample(40, (now += 40))).toBe(false);
  });
});
