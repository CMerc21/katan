import { describe, expect, it } from "vitest";
import { GEOMETRY, createGame, legalActions, parseEdgeId, type Action, type HexId } from "@katan/engine";
import { createLayout } from "@/board/layout";
import { boardBounds, edgeWorld, framingDistance, hexCornerWorld, hexWorld, shorelineEdges, tileJitter, vertexWorld } from "@/board3d/layout3d";
import { computeTargets, targetName, wagonMoveFor } from "@/board3d/Interaction";
import { FrameWatchdog, QUALITY_PRESETS, detectQuality, resolveDpr, stepDown } from "@/board3d/quality";
import { FOOTPRINT, HERO_PROP, propsForHex, type PropKind, type PropTerrain } from "@/board3d/props";
import { RECESS_RADIUS, propBoundary } from "@/board3d/slab";

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

  it("tile jitter is seeded, small, and different per tile (docs/props.md §1: ±0.4°, ±1.5%)", () => {
    const a = tileJitter("0,0");
    expect(tileJitter("0,0")).toEqual(a);
    expect(tileJitter("1,0")).not.toEqual(a);
    const deg = Math.PI / 180;
    for (const h of GEOMETRY.hexes) {
      const j = tileJitter(h);
      expect(Math.abs(j.rotation)).toBeLessThanOrEqual(0.4 * deg);
      expect(Math.abs(j.height - 1)).toBeLessThanOrEqual(0.015);
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
    // Board-first building: with no mode chosen in the action phase, every affordable build is a target.
    const builds: Action[] = [
      { type: "BUILD_ROAD", playerId: "a", edge: "0,0|1,0" },
      { type: "BUILD_SHIP", playerId: "a", edge: "0,0|1,0" },
      { type: "BUILD_SHIP", playerId: "a", edge: "0,0|0,1" },
      { type: "BUILD_SETTLEMENT", playerId: "a", vertex: "s1" },
      { type: "BUILD_CITY", playerId: "a", vertex: "c1" },
      { type: "BUY_DEV_CARD", playerId: "a" },
    ];
    const idle = computeTargets(builds, "action", null);
    expect([...idle.vertices.keys()].sort()).toEqual(["c1", "s1"]);
    // An edge that could take a road or a ship shows the road; a ship-only edge shows the ship.
    expect(idle.edges.get("0,0|1,0")?.type).toBe("BUILD_ROAD");
    expect(idle.edges.get("0,0|0,1")?.type).toBe("BUILD_SHIP");
    expect(idle.hexes.size).toBe(0);
    // A chosen mode narrows the targets to that kind.
    const roads = computeTargets(builds, "action", "road");
    expect([...roads.edges.keys()]).toEqual(["0,0|1,0"]);
    expect(roads.vertices.size).toBe(0);
    const ships = computeTargets(builds, "action", "ship");
    expect([...ships.edges.keys()].sort()).toEqual(["0,0|0,1", "0,0|1,0"]);
    expect([...computeTargets(builds, "action", "city").vertices.keys()]).toEqual(["c1"]);
    // Outside the action and special build phases nothing is offered without a mode.
    expect(computeTargets(builds, "roll", null).edges.size + computeTargets(builds, "discard", null).vertices.size).toBe(0);
    expect(computeTargets(builds, "specialBuild", null).edges.size).toBe(2);
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

describe("docs/props.md §3 props", () => {
  const boundaryAt = (x: number, z: number) => propBoundary(Math.atan2(z, x));

  it("are seeded per tile, respect the density, and keep off the recess and the edge margin", () => {
    const a = propsForHex("0,0", "forest", 1);
    expect(propsForHex("0,0", "forest", 1)).toEqual(a);
    expect(propsForHex("1,0", "forest", 1)).not.toEqual(a);
    expect(a.filter((p) => p.kind === "pine").length).toBeGreaterThanOrEqual(6);
    const low = propsForHex("0,0", "forest", 0.4);
    expect(low.length).toBeLessThan(a.length);
    for (const terrain of ["forest", "meadow", "farmland", "claypit", "mountain", "wasteland", "gold"] as const) {
      for (const p of propsForHex("2,-1", terrain, 1)) {
        const r = Math.hypot(p.x, p.z);
        const foot = FOOTPRINT[p.kind];
        expect(r).toBeGreaterThan(RECESS_RADIUS);
        expect(r + foot).toBeLessThanOrEqual(boundaryAt(p.x, p.z) + 1e-9);
      }
    }
    for (const p of propsForHex("0,1", "sea", 1)) expect(Math.hypot(p.x, p.z) + FOOTPRINT[p.kind]).toBeLessThanOrEqual(boundaryAt(p.x, p.z) + 1e-9);
  });

  it("every terrain keeps its hero prop at every density, and the counts follow the brief at High", () => {
    for (const [terrain, hero] of Object.entries(HERO_PROP) as [PropTerrain, PropKind][]) {
      for (const density of [1, 0.7, 0.4]) {
        const kinds = propsForHex("0,0", terrain, density).map((p) => p.kind);
        expect(kinds.filter((k) => k === hero).length).toBe(1);
      }
    }
    const counts = (terrain: PropTerrain, kind: PropKind, hex = "0,0") => propsForHex(hex, terrain, 1).filter((p) => p.kind === kind).length;
    expect(counts("meadow", "sheep")).toBeGreaterThanOrEqual(5);
    expect(counts("meadow", "sheep")).toBeLessThanOrEqual(6);
    expect(counts("meadow", "fence")).toBe(2);
    expect(counts("claypit", "mound")).toBeGreaterThanOrEqual(2);
    expect(counts("mountain", "peak")).toBeGreaterThanOrEqual(2);
    expect(counts("mountain", "goldNugget")).toBe(2);
    expect(counts("wasteland", "rock")).toBeGreaterThanOrEqual(4);
    expect(counts("gold", "goldNugget")).toBeGreaterThanOrEqual(5);
    expect(counts("gold", "peak")).toBe(2);
    expect(counts("sea", "crest")).toBe(2);
    expect(counts("lake", "reed")).toBeGreaterThanOrEqual(4);
    // The gull only appears at Medium and above.
    expect(propsForHex("0,0", "sea", 0.4).some((p) => p.kind === "gull")).toBe(false);
  });

  it("fields lay four wheat rows evenly around the recess, each turned along its ring", () => {
    const rows = propsForHex("0,0", "farmland", 1).filter((p) => p.kind === "wheat");
    expect(rows).toHaveLength(4);
    const angles = rows.map((p) => Math.atan2(p.z, p.x));
    for (let i = 0; i < 4; i++) {
      const r = Math.hypot(rows[i]!.x, rows[i]!.z);
      expect(r).toBeGreaterThan(0.49);
      expect(r).toBeLessThan(0.55);
      // The row's long axis (local +x under a Y rotation) is tangent to the ring.
      const dx = Math.cos(rows[i]!.rot);
      const dz = -Math.sin(rows[i]!.rot);
      expect(Math.abs(dx * Math.cos(angles[i]!) + dz * Math.sin(angles[i]!))).toBeLessThan(1e-9);
    }
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 1; i < 4; i++) expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(Math.PI / 2, 6);
    expect(propsForHex("0,0", "farmland", 0.4).filter((p) => p.kind === "windmill")).toHaveLength(1);
  });
});

describe("docs/props.md §3 shoreline", () => {
  it("returns each land/sea edge once, and nothing for land/land or sea/sea", () => {
    // One land hex at the origin with sea on two of its six sides.
    const land = new Set<HexId>(["0,0", "1,0"]);
    const sea = new Set<HexId>(["0,-1", "-1,0"]);
    const edges = shorelineEdges(land, sea);
    expect(edges).toHaveLength(2);
    // Sorted and unique.
    expect([...edges].sort()).toEqual(edges);
    expect(new Set(edges).size).toBe(edges.length);
    // The edge between the two land hexes is not a shoreline.
    for (const e of edges) {
      const [a, b] = parseEdgeId(e);
      const ids = [`${a.q},${a.r}`, `${b.q},${b.r}`] as HexId[];
      expect(ids.filter((h) => land.has(h))).toHaveLength(1);
      expect(ids.filter((h) => sea.has(h))).toHaveLength(1);
    }
  });

  it("counts a shoreline edge once even though both its hexes see it", () => {
    const land = new Set<HexId>(["0,0"]);
    const sea = new Set<HexId>(["0,-1", "1,-1", "1,0", "0,1", "-1,1", "-1,0"]);
    // All six sides are sea, and no edge is reported twice.
    expect(shorelineEdges(land, sea)).toHaveLength(6);
    // An all-sea or all-land board has no shoreline at all.
    expect(shorelineEdges(new Set(), sea)).toHaveLength(0);
    expect(shorelineEdges(land, new Set())).toHaveLength(0);
  });
});

describe("docs/phase7-5.md §6 quality", () => {
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
    // Contact shadows are a second pass over the scene: High alone.
    expect(QUALITY_PRESETS.high.contactShadows).toBe(true);
    expect(QUALITY_PRESETS.medium.contactShadows).toBe(false);
    expect(QUALITY_PRESETS.low.contactShadows).toBe(false);
    // Bloom is its own blur chain, so it rides with the contact shadows on High.
    expect(QUALITY_PRESETS.high.bloom).toBe(true);
    expect(QUALITY_PRESETS.medium.bloom).toBe(false);
    expect(QUALITY_PRESETS.low.bloom).toBe(false);
    // High and Medium carry the image-based light. Low does not: sampling it
    // costs a lookup per fragment, and Low is the preset auto-detection picks
    // for software renderers, where it measured 2.3x the frame time.
    expect(QUALITY_PRESETS.high.envIntensity).toBeGreaterThan(0);
    expect(QUALITY_PRESETS.medium.envIntensity).toBeGreaterThan(0);
    expect(QUALITY_PRESETS.low.envIntensity).toBe(0);
  });

  it("high and medium render at the true device pixel ratio capped at 2; low at 1", () => {
    expect(resolveDpr("high", 2)).toBe(2);
    expect(resolveDpr("medium", 2)).toBe(2);
    expect(resolveDpr("medium", 1.25)).toBe(1.25);
    expect(resolveDpr("high", 3)).toBe(2);
    expect(resolveDpr("low", 2)).toBe(1);
    expect(resolveDpr("high", 0.5)).toBe(1);
    expect(resolveDpr("high", Number.NaN)).toBe(1);
    expect(QUALITY_PRESETS.low.postfx).toBe(false);
    // Post-FX runs on Medium too (docs/phase7-5.md §6); only Low goes without.
    expect(QUALITY_PRESETS.medium.postfx).toBe(true);
  });

  it("the watchdog ignores the warm-up, a single hitch and an occasional slow frame", () => {
    const dog = new FrameWatchdog({ thresholdMs: 33, windowMs: 5000, warmupMs: 5000 });
    let now = 0;
    // Load: 6 s of 200 ms frames while shaders compile: the first 5 s are warm-up, so no verdict yet.
    for (let i = 0; i < 30; i++) expect(dog.sample(200, (now += 200))).toBe(false);
    // Then a steady 60 fps with one 400 ms hitch: never fires.
    for (let i = 0; i < 300; i++) expect(dog.sample(16, (now += 16))).toBe(false);
    expect(dog.sample(400, (now += 400))).toBe(false);
    for (let i = 0; i < 300; i++) expect(dog.sample(16, (now += 16))).toBe(false);
    // A third of the frames slow: still not sustained.
    for (let i = 0; i < 600; i++) {
      const slow = i % 3 === 0;
      expect(dog.sample(slow ? 40 : 16, (now += slow ? 40 : 16))).toBe(false);
    }
  });

  it("the watchdog fires once after 5 s of mostly slow frames, then warms up again", () => {
    const dog = new FrameWatchdog({ thresholdMs: 33, windowMs: 5000, warmupMs: 5000 });
    let now = 0;
    for (let i = 0; i < 400; i++) expect(dog.sample(16, (now += 16))).toBe(false); // warm-up and a bit of play
    // 40 ms frames with the odd fast one in between: a fast frame does not reset the window.
    let fired = 0;
    for (let i = 0; i < 150; i++) {
      const fast = i % 10 === 0;
      if (dog.sample(fast ? 16 : 40, (now += fast ? 16 : 40))) fired++;
    }
    expect(fired).toBe(1);
    expect(now).toBeLessThan(400 * 16 + 6000);
    // Right after firing the new preset compiles: 3 s of slow frames are ignored.
    for (let i = 0; i < 75; i++) expect(dog.sample(40, (now += 40))).toBe(false);
  });

  it("the watchdog treats a stall (a hidden tab) as no signal", () => {
    const dog = new FrameWatchdog({ thresholdMs: 33, windowMs: 5000, warmupMs: 0 });
    let now = 0;
    for (let i = 0; i < 100; i++) expect(dog.sample(40, (now += 40))).toBe(false);
    expect(dog.sample(30_000, (now += 30_000))).toBe(false);
    // The window starts over: another 4 s of slow frames is not yet sustained.
    for (let i = 0; i < 100; i++) expect(dog.sample(40, (now += 40))).toBe(false);
  });
});
