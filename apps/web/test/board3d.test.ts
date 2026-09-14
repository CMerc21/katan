import { describe, expect, it } from "vitest";
import { GEOMETRY, createGame, legalActions, type Action } from "@katan/engine";
import { createLayout } from "@/board/layout";
import { boardBounds, edgeWorld, framingDistance, hexCornerWorld, hexWorld, tileJitter, vertexWorld } from "@/board3d/layout3d";
import { computeTargets, targetName, wagonMoveFor } from "@/board3d/Interaction";
import { FrameWatchdog, QUALITY_PRESETS, detectQuality, resolveDpr, stepDown } from "@/board3d/quality";
import { BAR_HALF_LENGTH, FENCE_RADIUS, HEX_AXES, PROP_INNER, propBounds, propLimit, propsForHex, type PropKind, type PropTerrain } from "@/board3d/props";
import { BACK } from "@/board3d/layout3d";

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

describe("docs/props.md §3 props", () => {
  const LAND: PropTerrain[] = ["forest", "meadow", "farmland", "claypit", "mountain", "wasteland", "gold", "lake"];
  const HEXES = ["0,0", "2,-1", "-1,2", "1,1"];
  const of = (t: PropTerrain, kinds: readonly PropKind[], hex = "0,0", density = 1) => propsForHex(hex, t, density).filter((p) => (kinds as readonly string[]).includes(p.kind));
  const count = (t: PropTerrain, kind: PropKind, hex = "0,0", density = 1) => of(t, [kind], hex, density).length;
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

  it("are seeded per tile and identical on every call", () => {
    const a = propsForHex("0,0", "forest", 1);
    expect(propsForHex("0,0", "forest", 1)).toEqual(a);
    expect(propsForHex("1,0", "forest", 1)).not.toEqual(a);
  });

  it("keep a 0.30 clear circle at the token and 0.08 inside the slab edge, the ends of long props included", () => {
    expect(PROP_INNER).toBeGreaterThanOrEqual(0.3);
    for (const terrain of LAND) {
      for (const hex of HEXES) {
        const props = propsForHex(hex, terrain, 1);
        expect(props.length).toBeGreaterThan(0);
        for (const p of props) {
          for (const b of propBounds(p)) {
            const r = Math.hypot(b.x, b.z);
            expect(r - b.r).toBeGreaterThanOrEqual((terrain === "lake" ? 0 : 0.3) - 1e-9);
            expect(r + b.r).toBeLessThanOrEqual(propLimit(Math.atan2(b.z, b.x)) + 1e-9);
          }
        }
      }
    }
    for (const density of [1, 0.7, 0.4]) expect(propsForHex("0,1", "sea", density)).toEqual([]);
  });

  it("forest: two clusters of 3–5 trees mixing round and pine, scale 0.85–1.15, and a log pile", () => {
    for (const hex of HEXES) {
      const trees = of("forest", ["tree", "tree2", "pine"], hex);
      expect(trees.length).toBeGreaterThanOrEqual(5);
      expect(trees.length).toBeLessThanOrEqual(10);
      expect(trees.some((p) => p.kind === "pine")).toBe(true);
      expect(trees.some((p) => p.kind !== "pine")).toBe(true);
      for (const t of trees) {
        expect(t.scale).toBeGreaterThanOrEqual(0.85);
        expect(t.scale).toBeLessThanOrEqual(1.15);
        // Every tree has a neighbour close by (a cluster), and the two clusters sit apart.
        expect(trees.some((o) => o !== t && dist(o, t) < 0.4)).toBe(true);
      }
      expect(Math.max(...trees.flatMap((a) => trees.map((b) => dist(a, b))))).toBeGreaterThan(0.7);
      expect(count("forest", "logPile", hex)).toBe(1);
    }
  });

  it("pasture: 4–6 sheep in a group, 2–3 fence sections along one edge, a bush or two", () => {
    for (const hex of HEXES) {
      const sheep = of("meadow", ["sheep"], hex);
      expect(sheep.length).toBeGreaterThanOrEqual(4);
      expect(sheep.length).toBeLessThanOrEqual(6);
      for (const s of sheep) expect(sheep.some((o) => o !== s && dist(o, s) < 0.45)).toBe(true);
      const fences = of("meadow", ["fence"], hex);
      expect(fences.length).toBeGreaterThanOrEqual(2);
      expect(fences.length).toBeLessThanOrEqual(3);
      // One run: every section turned the same way, all at the fence radius along the edge's direction.
      const phi = -fences[0]!.rot;
      for (const f of fences) {
        expect(f.rot).toBeCloseTo(fences[0]!.rot, 9);
        expect(f.x * Math.cos(phi) + f.z * Math.sin(phi)).toBeCloseTo(FENCE_RADIUS, 6);
      }
      expect(count("meadow", "bush", hex)).toBeGreaterThanOrEqual(1);
      expect(count("meadow", "bush", hex)).toBeLessThanOrEqual(2);
    }
  });

  /** The rows' axis and their offsets across it, if the sheaves lie in 3–4 parallel rows on a hex axis. */
  function rowsOf(sheaves: { x: number; z: number }[]): { axis: number; rows: number[][] } | null {
    for (const axis of HEX_AXES) {
      const offsets = sheaves.map((p) => -p.x * Math.sin(axis) + p.z * Math.cos(axis)).sort((a, b) => a - b);
      const rows: number[][] = [];
      for (const o of offsets) {
        const last = rows[rows.length - 1];
        if (last && o - last[last.length - 1]! < 0.12) last.push(o);
        else rows.push([o]);
      }
      const tight = rows.every((r) => r[r.length - 1]! - r[0]! < 0.1);
      if (tight && (rows.length === 3 || rows.length === 4)) return { axis, rows };
    }
    return null;
  }

  it("fields: sheaves in 3–4 parallel rows on a hex axis, the windmill off-centre, a hay bale past a row end", () => {
    for (const hex of HEXES) {
      const sheaves = of("farmland", ["wheat", "wheat2"], hex);
      expect(sheaves.length).toBeGreaterThanOrEqual(9);
      const found = rowsOf(sheaves);
      expect(found).not.toBeNull();
      for (const row of found!.rows) expect(row.length).toBeGreaterThanOrEqual(2);
      const mills = of("farmland", ["windmill"], hex);
      expect(mills).toHaveLength(1);
      expect(Math.hypot(mills[0]!.x, mills[0]!.z)).toBeGreaterThan(0.45);
      expect(count("farmland", "hayBale", hex)).toBeLessThanOrEqual(1);
    }
    expect(count("farmland", "hayBale", "0,0") + count("farmland", "hayBale", "2,-1") + count("farmland", "hayBale", "-1,2") + count("farmland", "hayBale", "1,1")).toBeGreaterThanOrEqual(1);
  });

  it("hills: 2–3 clay mounds mixing tall and wide, a kiln on one side with a brick stack beside it", () => {
    for (const hex of HEXES) {
      const mounds = of("claypit", ["moundTall", "moundWide", "moundLow", "moundTerraced"], hex);
      expect(mounds.length).toBeGreaterThanOrEqual(2);
      expect(mounds.length).toBeLessThanOrEqual(3);
      expect(mounds.some((m) => m.kind === "moundTall" || m.kind === "moundTerraced")).toBe(true);
      expect(mounds.some((m) => m.kind === "moundWide" || m.kind === "moundLow")).toBe(true);
      const kiln = of("claypit", ["kiln"], hex);
      expect(kiln).toHaveLength(1);
      const bricks = of("claypit", ["brickStack"], hex);
      expect(bricks).toHaveLength(1);
      expect(dist(bricks[0]!, kiln[0]!)).toBeLessThan(0.36);
    }
  });

  it("mountains: one peak centre-back, two ridges flanking it at 0.8–1.0 and different turns, boulders at the feet in front", () => {
    const back = (p: { x: number; z: number }) => p.x * BACK.x + p.z * BACK.z;
    for (const hex of HEXES) {
      const peak = of("mountain", ["peak"], hex);
      expect(peak).toHaveLength(1);
      expect(back(peak[0]!)).toBeGreaterThan(0.3);
      const ridges = of("mountain", ["ridge"], hex);
      expect(ridges).toHaveLength(2);
      for (const r of ridges) {
        expect(r.scale).toBeGreaterThanOrEqual(0.8);
        expect(r.scale).toBeLessThanOrEqual(1);
        expect(dist(r, peak[0]!)).toBeLessThan(0.6);
      }
      expect(ridges[0]!.rot).not.toBeCloseTo(ridges[1]!.rot, 3);
      const feet = of("mountain", ["boulder", "rubble"], hex);
      expect(feet.length).toBeGreaterThanOrEqual(1);
      for (const f of feet) expect(back(f)).toBeLessThan(0);
    }
  });

  it("desert: one cactus, dry bush, skull and flat rock, sparse and spread out", () => {
    for (const hex of HEXES) {
      const props = propsForHex(hex, "wasteland", 1);
      expect(props.map((p) => p.kind).sort()).toEqual(["cactus", "dryBush", "flatRock", "skull"]);
      for (const a of props) for (const b of props) if (a !== b) expect(dist(a, b)).toBeGreaterThan(0.4);
    }
  });

  it("gold and lake keep their props", () => {
    expect(count("gold", "peak")).toBe(2);
    expect(count("gold", "sluice")).toBe(1);
    expect(count("gold", "goldNugget")).toBeGreaterThanOrEqual(4);
    expect(count("lake", "reed")).toBeGreaterThanOrEqual(4);
  });

  it("the Low preset halves the clusters and drops scale jitter but keeps every terrain dressed", () => {
    for (const terrain of LAND) {
      const low = propsForHex("0,0", terrain, 0.4);
      const full = propsForHex("0,0", terrain, 1);
      expect(low.length, terrain).toBeGreaterThan(0);
      expect(low.length, terrain).toBeLessThan(full.length);
      // No jitter variants: at most one scale per kind.
      const byKind = new Map<PropKind, Set<number>>();
      for (const p of low) byKind.set(p.kind, (byKind.get(p.kind) ?? new Set()).add(p.scale));
      for (const scales of byKind.values()) expect(scales.size).toBe(1);
    }
    expect(of("forest", ["tree", "tree2", "pine"], "0,0", 0.4).length).toBeLessThanOrEqual(4);
    expect(rowsOf(of("farmland", ["wheat", "wheat2"], "0,0", 0.4))?.rows).toHaveLength(3);
    expect(of("meadow", ["fence"], "0,0", 0.4)).toHaveLength(2);
  });

  it("long props report both ends so the edge check sees their real reach", () => {
    const p = { kind: "fence" as const, x: 0.3, z: 0.4, rot: 0, scale: 1, seed: 0 };
    const b = propBounds(p);
    expect(b).toHaveLength(2);
    expect(b[0]!.z).toBeCloseTo(0.4 - BAR_HALF_LENGTH.fence!, 9);
    expect(b[1]!.z).toBeCloseTo(0.4 + BAR_HALF_LENGTH.fence!, 9);
    expect(propBounds({ ...p, kind: "cactus" })).toHaveLength(1);
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
    expect(QUALITY_PRESETS.medium.postfx).toBe(false);
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
