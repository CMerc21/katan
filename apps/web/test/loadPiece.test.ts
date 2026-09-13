import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PIECES, ZONE_BASE, ZONE_MIDDLE, ZONE_TOP, assemblePiece, disposePiece, parsePiece, pieceFit, pieceMaterial, zoneOf, type PieceName } from "@/board3d/loadPiece";
import { HEX_RADIUS } from "@/board3d/layout3d";

const glb = (name: PieceName): ArrayBuffer => {
  const buf = readFileSync(path.resolve(__dirname, "../public/models", `${name}.glb`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const NAMES: PieceName[] = ["robber", "settlement", "city", "road"];

describe("GLB pieces (public/models)", () => {
  it.each(NAMES)("%s.glb parses, is non-indexed with unit flat normals, and is centred about the origin", async (name) => {
    const g = await parsePiece(name, glb(name));
    const pos = g.getAttribute("position");
    expect(pos.count).toBeGreaterThan(0);
    expect(pos.count % 3).toBe(0);
    expect(g.index).toBeNull();
    const n = g.getAttribute("normal");
    expect(n.count).toBe(pos.count);
    for (let i = 0; i < n.count; i += 97) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
    const box = g.boundingBox!;
    expect(Math.abs(box.min.y + box.max.y)).toBeLessThan(0.05);
  });

  it("robber and city are one unit tall; the road is one unit long on Z, 0.46 wide, 0.10 thick", async () => {
    const robber = (await parsePiece("robber", glb("robber"))).boundingBox!;
    expect(robber.max.y - robber.min.y).toBeCloseTo(1, 2);
    const city = (await parsePiece("city", glb("city"))).boundingBox!;
    expect(city.max.y - city.min.y).toBeCloseTo(1, 2);
    const road = (await parsePiece("road", glb("road"))).boundingBox!;
    expect(road.max.z - road.min.z).toBeCloseTo(1, 2);
    expect(road.max.x - road.min.x).toBeCloseTo(0.46, 1);
    expect(road.max.y - road.min.y).toBeCloseTo(0.1, 1);
  });

  it("zoneOf classifies by the raw-space Y thresholds", () => {
    const z = PIECES.settlement.zones!;
    expect(zoneOf(z.baseMaxY, z)).toBe(ZONE_BASE);
    expect(zoneOf(z.baseMaxY - 0.01, z)).toBe(ZONE_BASE);
    expect(zoneOf(z.topMinY, z)).toBe(ZONE_TOP);
    expect(zoneOf((z.baseMaxY + z.topMinY) / 2, z)).toBe(ZONE_MIDDLE);
  });

  it.each(["settlement", "city"] as const)("%s is split into base / middle / top draw groups that honour the thresholds", async (name) => {
    const g = await parsePiece(name, glb(name));
    const zones = PIECES[name].zones!;
    const pos = g.getAttribute("position");
    expect(g.groups.map((gr) => gr.materialIndex)).toEqual([ZONE_BASE, ZONE_MIDDLE, ZONE_TOP]);
    expect(g.groups.reduce((sum, gr) => sum + gr.count, 0)).toBe(pos.count);
    for (const gr of g.groups) {
      expect(gr.count).toBeGreaterThan(0);
      for (let v = gr.start; v < gr.start + gr.count; v += 3) {
        const y = (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3;
        expect(zoneOf(y, zones)).toBe(gr.materialIndex);
      }
    }
  });

  it("robber and road are not split", async () => {
    for (const name of ["robber", "road"] as const) {
      const g = await parsePiece(name, glb(name));
      expect(g.groups).toEqual([]);
    }
  });

  it("assemblePiece puts the foot at the origin and scales height pieces to the procedural height", async () => {
    for (const name of ["robber", "settlement", "city"] as const) {
      const fit = PIECES[name].fit;
      if (!("height" in fit)) throw new Error("expected a height fit");
      const g = await parsePiece(name, glb(name));
      const group = assemblePiece(name, g, { color: "#1a1a1a", roughness: 0.8, castShadow: true });
      const mesh = group.children[0] as THREE.Mesh;
      expect(mesh.isMesh).toBe(true);
      expect(mesh.position.y).toBeCloseTo(-g.boundingBox!.min.y, 6);
      expect(mesh.castShadow).toBe(true);
      group.updateMatrixWorld(true);
      const world = new THREE.Box3().setFromObject(group);
      expect(world.min.y).toBeCloseTo(0, 5);
      expect(world.max.y).toBeCloseTo(fit.height, 5);
      // Uniform scale: width and depth shrink by the same factor as height.
      expect(group.scale.x).toBe(group.scale.y);
      expect(group.scale.z).toBe(group.scale.y);
      disposePiece(group);
    }
  });

  it("the road is scaled so Z spans the hex edge, X and Y by the same factor, lifted by half its thickness", async () => {
    const g = await parsePiece("road", glb("road"));
    const { scale, lift } = pieceFit(PIECES.road, g);
    const box = g.boundingBox!;
    expect(scale).toBeCloseTo(HEX_RADIUS / (box.max.z - box.min.z), 6);
    expect(lift).toBeCloseTo((box.max.y - box.min.y) / 2, 2);
    const group = assemblePiece("road", g, { color: "#c03030" });
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    expect(world.max.z - world.min.z).toBeCloseTo(HEX_RADIUS, 5);
    expect(world.max.x - world.min.x).toBeCloseTo(0.46 * scale, 1);
    expect(world.min.y).toBeCloseTo(0, 5);
    expect(world.max.y).toBeCloseTo(0.1 * scale, 1);
    const mesh = group.children[0] as THREE.Mesh;
    expect(Array.isArray(mesh.material)).toBe(false);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("c03030");
    disposePiece(group);
  });

  it("a zoned piece gets the player colour on base and top and the neutral in the middle", async () => {
    const g = await parsePiece("city", glb("city"));
    const group = assemblePiece("city", g, { color: "#3060c0", neutral: "#7a8798" });
    const mats = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    expect(mats).toHaveLength(3);
    expect(mats[ZONE_BASE]!.color.getHexString()).toBe("3060c0");
    expect(mats[ZONE_MIDDLE]!.color.getHexString()).toBe("7a8798");
    expect(mats[ZONE_TOP]!.color.getHexString()).toBe("3060c0");
    for (const m of mats) {
      expect(m.flatShading).toBe(true);
      expect(m.roughness).toBe(0.8);
    }
    disposePiece(group);
  });

  it("the material takes its colour from the caller and honours ghost", () => {
    const player = pieceMaterial({ color: "#ff0000" });
    expect(player.color.getHexString()).toBe("ff0000");
    expect(player.roughness).toBe(0.8);
    const ghost = pieceMaterial({ color: "#00ff00", ghost: true });
    expect(ghost.transparent).toBe(true);
    expect(ghost.opacity).toBe(0.5);
    expect(ghost.depthWrite).toBe(false);
  });
});
