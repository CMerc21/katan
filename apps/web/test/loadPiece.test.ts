import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GEOMETRY } from "@katan/engine";
import { CITY_HEIGHT, ISLAND_OTHER, ISLAND_PLAYER, MIN_ISLANDS, PIECES, PIECE_COLORS, WALL_FOOTPRINT, ZONE_BASE, ZONE_MIDDLE, ZONE_TOP, assemblePiece, axisRotationY, dimColor, disposePiece, parsePiece, pieceFit, pieceMaterial, pieceMaterials, prepareGeometry, preparedData, zoneOf, type PieceName } from "@/board3d/loadPiece";
import { findIslands, regroupTriangles } from "@/board3d/islands";
import { EDGE_LENGTH, HEX_RADIUS, edgeWorld } from "@/board3d/layout3d";

const MODELS = path.resolve(__dirname, "../public/models");
const glb = (name: PieceName): ArrayBuffer => {
  const buf = readFileSync(path.join(MODELS, `${name}.glb`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const ALL = Object.keys(PIECES) as PieceName[];
const ON_DISK = ALL.filter((n) => existsSync(path.join(MODELS, `${n}.glb`)));
const ZONED = ON_DISK.filter((n) => PIECES[n].zones && !PIECES[n].fullPlayerColor);

/** A centre-pivoted box like a Meshy export: raw extents (x, y, z), optionally shifted so min Y is `minY`. */
function meshyBox(x: number, y: number, z: number, minY = -y / 2): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x, y, z, 2, 2, 2);
  g.translate(0, minY + y / 2, 0);
  return g;
}

describe("edge length in the board code", () => {
  it("EDGE_LENGTH is the hex circumradius and the distance between every edge's two vertices", () => {
    expect(EDGE_LENGTH).toBe(HEX_RADIUS);
    for (const e of GEOMETRY.edges) {
      const { a, b } = edgeWorld(e);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(EDGE_LENGTH, 9);
    }
  });
});

describe("piece config (world units, hex edge = 1)", () => {
  it("every piece has positive world dimensions and a model path name", () => {
    for (const name of ALL) {
      const fit = PIECES[name].fit;
      expect("height" in fit ? fit.height : fit.length).toBeGreaterThan(0);
      if ("width" in fit) {
        expect(fit.width).toBeGreaterThan(0);
        expect(fit.length).toBeGreaterThan(0);
      }
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("pins the sizes given for the new pieces", () => {
    const dims = (n: PieceName) => {
      const f = PIECES[n].fit;
      return "width" in f ? [f.width, f.height, f.length] : "height" in f ? [f.height] : [f.length];
    };
    expect(dims("metropolis")).toEqual([0.5, 0.65, 0.5]);
    expect(dims("metropolis_walled")).toEqual([WALL_FOOTPRINT, 0.7, WALL_FOOTPRINT]);
    expect(dims("city_walled")).toEqual([WALL_FOOTPRINT, 0.56, WALL_FOOTPRINT]);
    expect(dims("ship")).toEqual([0.22, 0.26, 0.7]);
    expect(dims("barbarian_ship")).toEqual([0.3, 0.28, 0.65]);
    expect(dims("pirate")).toEqual([0.36, 0.32, 0.32]);
    expect(dims("merchant")).toEqual([0.3, 0.3, 0.3]);
    expect(dims("knight_1")).toEqual([0.18, 0.26, 0.18]);
    expect(dims("knight_2")).toEqual([0.2, 0.28, 0.2]);
    expect(dims("knight_3")).toEqual([0.23, 0.3, 0.23]);
    expect(dims("port_sign")).toEqual([0.26, 0.3, 0.24]);
    expect(dims("road")).toEqual([0.18, 0.08, 0.8]);
  });

  it("pins the zone thresholds and which pieces turn their length axis", () => {
    expect(PIECES.metropolis.zones).toEqual({ baseMaxY: -0.42, topMinY: 0.38 });
    expect(PIECES.metropolis_walled.zones).toEqual({ baseMaxY: -0.42, topMinY: 0.4 });
    expect(PIECES.city_walled.zones).toEqual({ baseMaxY: -0.32, topMinY: 0.2 });
    expect(PIECES.ship.zones).toEqual({ topMinY: 0.2 });
    expect(PIECES.barbarian_ship.zones).toEqual({ topMinY: 0.24 });
    expect(PIECES.pirate.zones).toEqual({ topMinY: 0.18 });
    expect(PIECES.merchant.zones).toBeNull();
    expect(PIECES.knight_1.zones).toEqual({ baseMaxY: -0.42, topMinY: 0.1 });
    expect(PIECES.knight_2.zones).toEqual({ baseMaxY: -0.33, topMinY: 0.22 });
    expect(PIECES.knight_3.zones).toEqual({ baseMaxY: -0.38, topMinY: 0.19 });
    expect(PIECES.port_sign.zones).toBeNull();
    expect(ALL.filter((n) => PIECES[n].axis === "x")).toEqual(["ship", "barbarian_ship", "pirate"]);
  });
});

describe("city upgrades are larger than the plain city", () => {
  const size = (n: PieceName) => {
    const f = PIECES[n].fit;
    if (!("width" in f)) throw new Error(`${n} has no per-axis fit`);
    return f;
  };

  it("both upgrades stand taller than the plain city", () => {
    expect("height" in PIECES.city.fit ? PIECES.city.fit.height : NaN).toBe(CITY_HEIGHT);
    for (const n of ["city_walled", "metropolis", "metropolis_walled"] as const) {
      expect(size(n).height).toBeGreaterThan(CITY_HEIGHT);
    }
    // The grandest piece on the board is the walled metropolis.
    expect(size("metropolis_walled").height).toBeGreaterThan(size("metropolis").height);
    expect(size("metropolis").height).toBeGreaterThan(size("city_walled").height);
  });

  it("the wall footprint is the same on a walled city and a walled metropolis, and wider than the unwalled models", () => {
    for (const n of ["city_walled", "metropolis_walled"] as const) {
      expect(size(n).width).toBe(WALL_FOOTPRINT);
      expect(size(n).length).toBe(WALL_FOOTPRINT);
    }
    expect(WALL_FOOTPRINT).toBeGreaterThan(size("metropolis").width);
  });

  it("every upgrade has a wider footprint than the plain city model as it actually loads", async () => {
    const g = await parsePiece("city", glb("city"));
    const group = assemblePiece("city", g, { color: "#3060c0", neutral: PIECE_COLORS.grey });
    group.updateMatrixWorld(true);
    const city = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(city.y).toBeCloseTo(CITY_HEIGHT, 5);
    for (const n of ["city_walled", "metropolis", "metropolis_walled"] as const) {
      expect(size(n).width).toBeGreaterThan(Math.max(city.x, city.z));
    }
    disposePiece(group);
  });
});

describe("zones", () => {
  it("zoneOf classifies by the raw-space Y thresholds", () => {
    const z = { baseMaxY: -0.34, topMinY: -0.11 };
    expect(zoneOf(z.baseMaxY, z)).toBe(ZONE_BASE);
    expect(zoneOf(z.baseMaxY - 0.01, z)).toBe(ZONE_BASE);
    expect(zoneOf(z.topMinY, z)).toBe(ZONE_TOP);
    expect(zoneOf((z.baseMaxY + z.topMinY) / 2, z)).toBe(ZONE_MIDDLE);
  });

  it("a top-only zone (ship sail) has an empty base group and colours the sail, not the hull", () => {
    const g = prepareGeometry(meshyBox(1, 0.9, 0.3, -0.455), PIECES.ship);
    expect(g.groups.map((gr) => gr.materialIndex)).toEqual([ZONE_BASE, ZONE_MIDDLE, ZONE_TOP]);
    expect(g.groups[ZONE_BASE]!.count).toBe(0);
    expect(g.groups[ZONE_MIDDLE]!.count).toBeGreaterThan(0);
    expect(g.groups[ZONE_TOP]!.count).toBeGreaterThan(0);
    const mats = pieceMaterials(PIECES.ship, { color: "#ff0000", neutral: PIECE_COLORS.wood }) as THREE.MeshStandardMaterial[];
    expect(mats[ZONE_TOP]!.color.getHexString()).toBe("ff0000");
    expect(mats[ZONE_MIDDLE]!.color.getHexString()).toBe(PIECE_COLORS.wood.slice(1));
  });

  it("dimColor multiplies a colour by 0.55 for inactive knights", () => {
    expect(dimColor("#ffffff")).toBe(`#${new THREE.Color(0.55, 0.55, 0.55).getHexString()}`);
    expect(dimColor("#000000")).toBe("#000000");
  });
});

describe("fit and lift", () => {
  it("lifts by the model's actual min Y, not an assumed -0.5 (merchant min Y -0.436)", () => {
    const g = prepareGeometry(meshyBox(0.8, 0.9, 0.8, -0.436), PIECES.merchant);
    const { lift } = pieceFit(PIECES.merchant, g);
    expect(lift).toBeCloseTo(0.436, 6);
    const group = assemblePiece("merchant", g, { color: PIECE_COLORS.merchant });
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    expect(world.min.y).toBeCloseTo(0, 6);
    expect(world.max.y).toBeCloseTo(0.3, 6);
    expect(world.max.x - world.min.x).toBeCloseTo(0.3, 6);
    expect(world.max.z - world.min.z).toBeCloseTo(0.3, 6);
    disposePiece(group);
  });

  it("an axis-x model is turned so its raw X length presents on Z, then fitted per axis (ship 0.22 × 0.26 × 0.70)", () => {
    // Raw: long on X (1.0), 0.9 tall with the hull bottom at -0.455, 0.3 wide on Z.
    const g = prepareGeometry(meshyBox(1, 0.9, 0.3, -0.455), PIECES.ship);
    expect(axisRotationY(PIECES.ship)).toBeCloseTo(-Math.PI / 2, 9);
    const { scale, lift } = pieceFit(PIECES.ship, g);
    expect(lift).toBeCloseTo(0.455, 6);
    expect(scale.z).toBeCloseTo(0.7 / 1, 6);
    expect(scale.x).toBeCloseTo(0.22 / 0.3, 6);
    expect(scale.y).toBeCloseTo(0.26 / 0.9, 6);
    const group = assemblePiece("ship", g, { color: "#3060c0", neutral: PIECE_COLORS.wood });
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    expect(world.max.z - world.min.z).toBeCloseTo(0.7, 5);
    expect(world.max.x - world.min.x).toBeCloseTo(0.22, 5);
    expect(world.max.y - world.min.y).toBeCloseTo(0.26, 5);
    expect(world.min.y).toBeCloseTo(0, 5);
    disposePiece(group);
  });

  it("the barbarian ship and pirate turn too, and the mesh's quarter turn is about Y", () => {
    for (const name of ["barbarian_ship", "pirate"] as const) {
      const g = prepareGeometry(meshyBox(1, 0.8, 0.4), PIECES[name]);
      const group = assemblePiece(name, g, { color: PIECE_COLORS.darkRed, neutral: PIECE_COLORS.nearBlack });
      const mesh = group.children[0] as THREE.Mesh;
      expect(mesh.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
      expect(mesh.rotation.x).toBe(0);
      group.updateMatrixWorld(true);
      const world = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
      const f = PIECES[name].fit;
      if (!("width" in f)) throw new Error("expected per-axis fit");
      expect(world.x).toBeCloseTo(f.width, 5);
      expect(world.y).toBeCloseTo(f.height, 5);
      expect(world.z).toBeCloseTo(f.length, 5);
      disposePiece(group);
    }
  });

  it("height-only pieces scale uniformly to world height (settlement 0.27, city 0.51, robber 0.48)", () => {
    const expected = { settlement: 0.18 * 1.5, city: 0.34 * 1.5, robber: 0.32 * 1.5 } as const;
    for (const name of Object.keys(expected) as (keyof typeof expected)[]) {
      const g = prepareGeometry(meshyBox(0.9, 1, 0.9), PIECES[name]);
      const { scale } = pieceFit(PIECES[name], g);
      expect(scale.x).toBe(scale.y);
      expect(scale.z).toBe(scale.y);
      expect(scale.y).toBeCloseTo(expected[name], 6);
    }
  });

  it("knights and the walled city are fitted per axis to their world sizes", () => {
    for (const name of ["knight_1", "knight_2", "knight_3", "metropolis", "city_walled", "port_sign"] as const) {
      const g = prepareGeometry(meshyBox(0.7, 1, 0.6), PIECES[name]);
      const group = assemblePiece(name, g, { color: "#3060c0", neutral: PIECE_COLORS.grey });
      group.updateMatrixWorld(true);
      const world = new THREE.Box3().setFromObject(group);
      const f = PIECES[name].fit;
      if (!("width" in f)) throw new Error("expected per-axis fit");
      expect(world.max.x - world.min.x).toBeCloseTo(f.width, 5);
      expect(world.max.y - world.min.y).toBeCloseTo(f.height, 5);
      expect(world.max.z - world.min.z).toBeCloseTo(f.length, 5);
      expect(world.min.y).toBeCloseTo(0, 5);
      disposePiece(group);
    }
  });
});

describe("mesh islands", () => {
  it("are welded connected components, numbered by descending triangle count then centroid Y, and stable across loads", async () => {
    const g = await parsePiece("city", glb("city"));
    const a = findIslands(g);
    const b = findIslands(g);
    expect(a.islands.map((i) => [i.id, i.triangles])).toEqual(b.islands.map((i) => [i.id, i.triangles]));
    expect(Array.from(a.triangleIsland)).toEqual(Array.from(b.triangleIsland));
    for (let i = 1; i < a.islands.length; i++) {
      const p = a.islands[i - 1]!;
      const q = a.islands[i]!;
      expect(p.triangles > q.triangles || (p.triangles === q.triangles && p.centroid.y <= q.centroid.y)).toBe(true);
    }
    expect(a.islands.reduce((n, i) => n + i.triangles, 0)).toBe(g.getAttribute("position").count / 3);
    expect(a.islands[0]!.id).toBe(0);
  });

  it("two separate boxes are two islands; one box is one", () => {
    expect(findIslands(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()).islands).toHaveLength(1);
    const big = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute("position").array as Float32Array;
    const small = new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed().translate(3, 0, 0).getAttribute("position").array as Float32Array;
    const merged = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array([...big, ...small]), 3));
    const isl = findIslands(merged).islands;
    expect(isl).toHaveLength(2);
    expect(isl[0]!.triangles).toBe(12);
    expect(isl[1]!.maxRadius).toBeGreaterThan(2.5);
  });

  it("regroupTriangles carries every attribute along, so UVs survive the shuffle", () => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const tris = g.getAttribute("position").count / 3;
    const out = regroupTriangles(g, (t) => (t % 2 === 0 ? 1 : 0), 2);
    expect(out.getAttribute("uv").count).toBe(g.getAttribute("uv").count);
    expect(out.groups.map((gr) => gr.count / 3)).toEqual([tris / 2, tris / 2]);
    const uvIn = g.getAttribute("uv");
    const uvOut = out.getAttribute("uv");
    for (let k = 0; k < 3; k++) {
      expect(uvOut.getX(k)).toBe(uvIn.getX(3 + k));
      expect(uvOut.getY(k)).toBe(uvIn.getY(3 + k));
    }
  });
});

describe("baked textures", () => {
  const map = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  it("a textured export keeps its UVs and texture, and the non-player material shows it", () => {
    const g = prepareGeometry(new THREE.BoxGeometry(1, 1, 1), PIECES.city, undefined, map);
    expect(g.getAttribute("uv")).toBeDefined();
    expect(preparedData(g).map).toBe(map);
    expect(preparedData(g).colorMode).toBe("zones"); // a box is one island: the band fallback
    const mats = pieceMaterials(PIECES.city, { color: "#3060c0", neutral: PIECE_COLORS.grey }, g) as THREE.MeshStandardMaterial[];
    expect(mats[ZONE_MIDDLE]!.map).toBe(map);
    expect(mats[ZONE_BASE]!.map).toBeNull();
    expect(mats[ZONE_BASE]!.color.getHexString()).toBe("3060c0");
    for (const m of mats) expect(m.flatShading).toBe(true);
  });
  it("an untextured export falls back to the flat neutral; a single piece takes the texture unless it is fully player-coloured", () => {
    const plain = prepareGeometry(new THREE.BoxGeometry(1, 1, 1), PIECES.city);
    expect(preparedData(plain).map).toBeNull();
    const mats = pieceMaterials(PIECES.city, { color: "#3060c0", neutral: PIECE_COLORS.grey }, plain) as THREE.MeshStandardMaterial[];
    expect(mats[ZONE_MIDDLE]!.map).toBeNull();
    expect(mats[ZONE_MIDDLE]!.color.getHexString()).toBe(PIECE_COLORS.grey.slice(1));
    const merchant = prepareGeometry(new THREE.BoxGeometry(1, 1, 1), PIECES.merchant, undefined, map);
    expect((pieceMaterials(PIECES.merchant, { color: PIECE_COLORS.merchant }, merchant) as THREE.MeshStandardMaterial).map).toBe(map);
    const road = prepareGeometry(new THREE.BoxGeometry(1, 1, 1), PIECES.road, undefined, map);
    const rm = pieceMaterials(PIECES.road, { color: "#c03030" }, road) as THREE.MeshStandardMaterial;
    expect(rm.map).toBeNull();
    expect(rm.color.getHexString()).toBe("c03030");
  });
});

describe("materials", () => {
  it("a zoned piece gets the player colour on base and top and the neutral in the middle", () => {
    const mats = pieceMaterials(PIECES.city, { color: "#3060c0", neutral: "#7a8798" }) as THREE.MeshStandardMaterial[];
    expect(mats).toHaveLength(3);
    expect(mats[ZONE_BASE]!.color.getHexString()).toBe("3060c0");
    expect(mats[ZONE_MIDDLE]!.color.getHexString()).toBe("7a8798");
    expect(mats[ZONE_TOP]!.color.getHexString()).toBe("3060c0");
    for (const m of mats) {
      expect(m.flatShading).toBe(true);
      expect(m.roughness).toBe(0.8);
    }
  });

  it("unzoned and fully player-coloured pieces get one material", () => {
    expect(Array.isArray(pieceMaterials(PIECES.road, { color: "#c03030" }))).toBe(false);
    expect(Array.isArray(pieceMaterials(PIECES.merchant, { color: "#c9b58a" }))).toBe(false);
  });

  it("the material takes its colour and roughness from the caller and honours ghost", () => {
    const player = pieceMaterial({ color: "#ff0000" });
    expect(player.color.getHexString()).toBe("ff0000");
    expect(player.roughness).toBe(0.8);
    expect(pieceMaterial({ color: "#ff0000", roughness: 1 }).roughness).toBe(1);
    const ghost = pieceMaterial({ color: "#00ff00", ghost: true });
    expect(ghost.transparent).toBe(true);
    expect(ghost.opacity).toBe(0.5);
    expect(ghost.depthWrite).toBe(false);
  });
});

describe("GLB files in public/models", () => {
  it("lists which models are present (the rest fall back to the procedural figures)", () => {
    const missing = ALL.filter((n) => !ON_DISK.includes(n));
    console.info(`[models] present: ${ON_DISK.join(", ")}; missing: ${missing.join(", ") || "none"}`);
    expect(ON_DISK.length).toBeGreaterThan(0);
  });

  it.each(ON_DISK)("%s.glb parses, is non-indexed with unit flat normals, and is centre-pivoted", async (name) => {
    const g = await parsePiece(name, glb(name));
    const pos = g.getAttribute("position");
    expect(pos.count).toBeGreaterThan(0);
    expect(pos.count % 3).toBe(0);
    expect(g.index).toBeNull();
    const n = g.getAttribute("normal");
    expect(n.count).toBe(pos.count);
    for (let i = 0; i < n.count; i += 97) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
    const box = g.boundingBox!;
    expect(Math.abs(box.min.y + box.max.y)).toBeLessThan(0.1);
  });

  it.each(ZONED)("%s colours its hand-mapped islands, or falls back to height bands below the island minimum", async (name) => {
    const g = await parsePiece(name, glb(name));
    const config = PIECES[name];
    const pos = g.getAttribute("position");
    const { islands, triangleIsland } = findIslands(g);
    const { colorMode } = preparedData(g);
    expect(g.groups.reduce((sum, gr) => sum + gr.count, 0)).toBe(pos.count);
    if (config.playerColorIslands && islands.length >= MIN_ISLANDS) {
      expect(colorMode).toBe("islands");
      expect(g.groups.map((gr) => gr.materialIndex)).toEqual([ISLAND_PLAYER, ISLAND_OTHER]);
      const listed = new Set(config.playerColorIslands);
      for (const gr of g.groups) {
        expect(gr.count).toBeGreaterThan(0);
        for (let v = gr.start; v < gr.start + gr.count; v += 3) expect(listed.has(triangleIsland[v / 3]!)).toBe(gr.materialIndex === ISLAND_PLAYER);
      }
      for (const id of config.playerColorIslands) expect(id).toBeLessThan(islands.length);
    } else {
      expect(colorMode).toBe("zones");
      expect(g.groups.map((gr) => gr.materialIndex)).toEqual([ZONE_BASE, ZONE_MIDDLE, ZONE_TOP]);
      for (const gr of g.groups) {
        // A threshold that misses the model would leave a zone empty and drop the colour it carries.
        if (gr.materialIndex === ZONE_MIDDLE || (gr.materialIndex === ZONE_BASE && config.zones!.baseMaxY !== undefined) || (gr.materialIndex === ZONE_TOP && config.zones!.topMinY !== undefined)) expect(gr.count).toBeGreaterThan(0);
        for (let v = gr.start; v < gr.start + gr.count; v += 3) {
          const y = (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3;
          expect(zoneOf(y, config.zones!)).toBe(gr.materialIndex);
        }
      }
    }
  });

  it("every piece with a hand-mapped island list really has at least the island minimum", async () => {
    for (const name of ZONED) {
      if (!PIECES[name].playerColorIslands) continue;
      const g = await parsePiece(name, glb(name));
      expect(findIslands(g).islands.length).toBeGreaterThanOrEqual(MIN_ISLANDS);
    }
  });

  it.each(ON_DISK)("%s assembles with its foot at y = 0 and the configured world size", async (name) => {
    const g = await parsePiece(name, glb(name));
    const group = assemblePiece(name, g, { color: "#1a1a1a", neutral: "#888888", castShadow: true });
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.position.y).toBeCloseTo(-g.boundingBox!.min.y, 6);
    expect(mesh.castShadow).toBe(true);
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    expect(world.min.y).toBeCloseTo(0, 5);
    const f = PIECES[name].fit;
    if (!("height" in f)) throw new Error("pieces fit by height");
    expect(world.max.y).toBeCloseTo(f.height, 5);
    if ("width" in f) {
      expect(world.max.x - world.min.x).toBeCloseTo(f.width, 5);
      expect(world.max.z - world.min.z).toBeCloseTo(f.length, 5);
    } else {
      expect(group.scale.x).toBe(group.scale.y);
      expect(group.scale.z).toBe(group.scale.y);
    }
    disposePiece(group);
  });

  it("road.glb is one unit long on Z, 0.46 wide, 0.10 thick, and its lift is half its thickness", async () => {
    const g = await parsePiece("road", glb("road"));
    const box = g.boundingBox!;
    expect(box.max.z - box.min.z).toBeCloseTo(1, 2);
    expect(box.max.x - box.min.x).toBeCloseTo(0.46, 1);
    expect(box.max.y - box.min.y).toBeCloseTo(0.1, 1);
    expect(pieceFit(PIECES.road, g).lift).toBeCloseTo((box.max.y - box.min.y) / 2, 2);
  });
});
