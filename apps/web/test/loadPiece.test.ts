import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GEOMETRY } from "@katan/engine";
import { CAP_NY, CITY_HEIGHT, PIECES, PIECE_COLORS, ROOF_NY, WALL_FOOTPRINT, ZONE_BASE, ZONE_CAP, ZONE_MIDDLE, ZONE_ROOF, ZONE_TOP, assemblePiece, axisRotationY, dimColor, disposePiece, parsePiece, pieceFit, pieceMaterial, pieceMaterials, prepareGeometry, zoneCount, zoneOf, type PieceName } from "@/board3d/loadPiece";
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
      expect(fit.height).toBeGreaterThan(0);
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
      return "width" in f ? [f.width, f.height, f.length] : [f.height];
    };
    expect(dims("metropolis")).toEqual([0.62, 0.78, 0.62]);
    expect(dims("metropolis_walled")).toEqual([WALL_FOOTPRINT, 0.84, WALL_FOOTPRINT]);
    expect(dims("city_walled")).toEqual([WALL_FOOTPRINT, 0.68, WALL_FOOTPRINT]);
    expect(dims("ship")).toEqual([0.26, 0.32, 0.76]);
    expect(dims("barbarian_ship")).toEqual([0.3, 0.28, 0.65]);
    expect(dims("pirate")).toEqual([0.42, 0.38, 0.38]);
    expect(dims("merchant")).toEqual([0.36, 0.36, 0.36]);
    expect(dims("knight_1")).toEqual([0.28, 0.4, 0.28]);
    expect(dims("knight_2")).toEqual([0.31, 0.44, 0.31]);
    expect(dims("knight_3")).toEqual([0.35, 0.48, 0.35]);
    // A knight is never shorter than a settlement: at 0.26 it was the smallest thing on the land.
    expect(PIECES.knight_1.fit.height).toBeGreaterThanOrEqual(PIECES.settlement.fit.height);
    expect(dims("port_sign")).toEqual([0.3, 0.36, 0.28]);
    expect(dims("road")).toEqual([0.22, 0.1, 0.8]);
  });

  it("pins the zone thresholds and which pieces turn their length axis", () => {
    expect(PIECES.metropolis.zones).toEqual({ baseMaxY: -0.42, topMinY: 0.38, detail: true });
    expect(PIECES.metropolis_walled.zones).toEqual({ baseMaxY: -0.42, topMinY: 0.4, detail: true });
    expect(PIECES.city_walled.zones).toEqual({ baseMaxY: -0.32, topMinY: 0.2, detail: true });
    expect(PIECES.ship.zones).toEqual({ topMinY: 0.2 });
    expect(PIECES.barbarian_ship.zones).toEqual({ topMinY: 0.24 });
    expect(PIECES.pirate.zones).toEqual({ topMinY: 0.18 });
    expect(PIECES.merchant.zones).toEqual({ baseMaxY: -0.39, topMinY: 0.3 });
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
    expect(PIECES.city.fit.height).toBe(CITY_HEIGHT);
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
    // Without `detail` the facing is ignored.
    expect(zoneOf((z.baseMaxY + z.topMinY) / 2, z, 1)).toBe(ZONE_MIDDLE);
    expect(zoneCount(z)).toBe(3);
  });

  it("a detail zone set splits the middle band by facing into wall, roof and cap", () => {
    const z = { baseMaxY: -0.4, topMinY: 0.3, detail: true };
    expect(zoneCount(z)).toBe(5);
    expect(zoneOf(0, z, 0)).toBe(ZONE_MIDDLE);
    expect(zoneOf(0, z, ROOF_NY)).toBe(ZONE_MIDDLE);
    expect(zoneOf(0, z, ROOF_NY + 0.01)).toBe(ZONE_ROOF);
    expect(zoneOf(0, z, -0.6)).toBe(ZONE_ROOF);
    expect(zoneOf(0, z, CAP_NY + 0.01)).toBe(ZONE_CAP);
    expect(zoneOf(0, z, -1)).toBe(ZONE_CAP);
    // Base and top still win over facing.
    expect(zoneOf(-0.45, z, 1)).toBe(ZONE_BASE);
    expect(zoneOf(0.35, z, 1)).toBe(ZONE_TOP);
  });

  it("a detail box gets its level faces in the cap group and its vertical faces in the wall group", () => {
    const g = prepareGeometry(meshyBox(1, 1, 1, -0.5), { zones: { baseMaxY: -0.4, topMinY: 0.4, detail: true }, fit: { height: 1 } });
    expect(g.groups.map((gr) => gr.materialIndex)).toEqual([ZONE_BASE, ZONE_MIDDLE, ZONE_TOP, ZONE_ROOF, ZONE_CAP]);
    // The bottom face is base, the top face is top; the four sides are wall; a box has no slopes and no level face in the middle band.
    expect(g.groups[ZONE_MIDDLE]!.count).toBe(4 * 8 * 3);
    expect(g.groups[ZONE_ROOF]!.count).toBe(0);
    expect(g.groups[ZONE_CAP]!.count).toBe(0);
    const mats = pieceMaterials({ zones: { baseMaxY: -0.4, topMinY: 0.4, detail: true }, fit: { height: 1 } }, { color: "#ff0000", neutral: "#808080", roof: "#402020", cap: "#e0e0e0" }) as THREE.MeshStandardMaterial[];
    expect(mats).toHaveLength(5);
    expect(mats[ZONE_ROOF]!.color.getHexString()).toBe("402020");
    expect(mats[ZONE_CAP]!.color.getHexString()).toBe("e0e0e0");
    expect(mats[ZONE_MIDDLE]!.color.getHexString()).toBe("808080");
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
    expect(world.max.y).toBeCloseTo(0.36, 6);
    expect(world.max.x - world.min.x).toBeCloseTo(0.36, 6);
    expect(world.max.z - world.min.z).toBeCloseTo(0.36, 6);
    disposePiece(group);
  });

  it("an axis-x model is turned so its raw X length presents on Z, then fitted per axis (ship 0.26 × 0.32 × 0.76)", () => {
    // Raw: long on X (1.0), 0.9 tall with the hull bottom at -0.455, 0.3 wide on Z.
    const g = prepareGeometry(meshyBox(1, 0.9, 0.3, -0.455), PIECES.ship);
    expect(axisRotationY(PIECES.ship)).toBeCloseTo(-Math.PI / 2, 9);
    const { scale, lift } = pieceFit(PIECES.ship, g);
    expect(lift).toBeCloseTo(0.455, 6);
    expect(scale.z).toBeCloseTo(0.76 / 1, 6);
    expect(scale.x).toBeCloseTo(0.26 / 0.3, 6);
    expect(scale.y).toBeCloseTo(0.32 / 0.9, 6);
    const group = assemblePiece("ship", g, { color: "#3060c0", neutral: PIECE_COLORS.wood });
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    expect(world.max.z - world.min.z).toBeCloseTo(0.76, 5);
    expect(world.max.x - world.min.x).toBeCloseTo(0.26, 5);
    expect(world.max.y - world.min.y).toBeCloseTo(0.32, 5);
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

  it("height-only pieces scale uniformly to world height (settlement 0.36, city 0.62, robber 0.56)", () => {
    const expected = { settlement: 0.18 * 2, city: 0.31 * 2, robber: 0.28 * 2 } as const;
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

describe("materials", () => {
  it("a zoned piece gets the player colour on base and top and the neutral in the middle", () => {
    const mats = pieceMaterials(PIECES.knight_1, { color: "#3060c0", neutral: "#7a8798" }) as THREE.MeshStandardMaterial[];
    expect(mats).toHaveLength(3);
    expect(mats[ZONE_BASE]!.color.getHexString()).toBe("3060c0");
    expect(mats[ZONE_MIDDLE]!.color.getHexString()).toBe("7a8798");
    expect(mats[ZONE_TOP]!.color.getHexString()).toBe("3060c0");
    for (const m of mats) {
      expect(m.flatShading).toBe(true);
      expect(m.roughness).toBe(0.8);
    }
  });

  it("the city models are detail pieces whose roof and cap default to the neutral", () => {
    for (const name of ["city", "city_walled", "metropolis", "metropolis_walled"] as const) {
      expect(PIECES[name].zones?.detail).toBe(true);
      const mats = pieceMaterials(PIECES[name], { color: "#3060c0", neutral: "#7a8798" }) as THREE.MeshStandardMaterial[];
      expect(mats).toHaveLength(5);
      expect(mats[ZONE_ROOF]!.color.getHexString()).toBe("7a8798");
      expect(mats[ZONE_CAP]!.color.getHexString()).toBe("7a8798");
    }
  });

  it("unzoned and fully player-coloured pieces get one material", () => {
    expect(Array.isArray(pieceMaterials(PIECES.road, { color: "#c03030" }))).toBe(false);
    expect(Array.isArray(pieceMaterials(PIECES.robber, { color: "#1a1a1a" }))).toBe(false);
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

  it.each(ZONED)("%s is split into base / middle / top (and roof / cap) draw groups that honour the thresholds", async (name) => {
    const g = await parsePiece(name, glb(name));
    const zones = PIECES[name].zones!;
    const pos = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    expect(g.groups.map((gr) => gr.materialIndex)).toEqual(zones.detail ? [ZONE_BASE, ZONE_MIDDLE, ZONE_TOP, ZONE_ROOF, ZONE_CAP] : [ZONE_BASE, ZONE_MIDDLE, ZONE_TOP]);
    expect(g.groups.reduce((sum, gr) => sum + gr.count, 0)).toBe(pos.count);
    for (const gr of g.groups) {
      for (let v = gr.start; v < gr.start + gr.count; v += 3) {
        const y = (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3;
        // The flat normal of the corner is the triangle's; the split used the same facing.
        expect(zoneOf(y, zones, normal.getY(v))).toBe(gr.materialIndex);
      }
    }
  });

  it.each(["city", "city_walled", "metropolis", "metropolis_walled"] as const)("%s has roofs and caps to colour", async (name) => {
    const g = await parsePiece(name, glb(name));
    const count = (zone: number) => g.groups.find((gr) => gr.materialIndex === zone)!.count;
    expect(count(ZONE_ROOF)).toBeGreaterThan(0);
    expect(count(ZONE_CAP)).toBeGreaterThan(0);
    expect(count(ZONE_MIDDLE)).toBeGreaterThan(0);
  });

  it.each(ZONED)("%s puts real geometry in every zone it declares", async (name) => {
    const g = await parsePiece(name, glb(name));
    const zones = PIECES[name].zones!;
    const count = (zone: number) => g.groups.find((gr) => gr.materialIndex === zone)!.count;
    // A threshold that misses the model would leave a zone empty and drop the colour it carries.
    expect(count(ZONE_MIDDLE)).toBeGreaterThan(0);
    if (zones.baseMaxY !== undefined) expect(count(ZONE_BASE)).toBeGreaterThan(0);
    else expect(count(ZONE_BASE)).toBe(0);
    if (zones.topMinY !== undefined) expect(count(ZONE_TOP)).toBeGreaterThan(0);
    else expect(count(ZONE_TOP)).toBe(0);
    // Nor should a threshold swallow the whole piece. The share can be small and still be right:
    // the cottage's walls are a thin band between a wide base disc and a big thatched roof (~14%).
    const total = g.getAttribute("position").count;
    expect(count(ZONE_MIDDLE) / total).toBeGreaterThan(0.05);
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
