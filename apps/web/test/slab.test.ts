import { describe, expect, it } from "vitest";
import { GEOMETRY } from "@katan/engine";
import { CORNER_RADIUS, LAND_HEIGHT, LAND_RELIEF, RECESS_DEPTH, RECESS_RADIUS, SEA_RELIEF, SEA_SLAB_HEIGHT, SLAB_RADIUS, buildSlab, propBoundary, roundedHexOutline, roundedHexRadius, seaVariant, slabJitter } from "@/board3d/slab";

const deg = Math.PI / 180;

describe("docs/props.md §1 slab", () => {
  it("the rounded outline stays inside the hex and rounds the corners by 0.03 R", () => {
    // Along an edge normal the outline is the apothem; along a corner it is shorter than the sharp corner.
    expect(roundedHexRadius(0)).toBeCloseTo(SLAB_RADIUS * Math.cos(Math.PI / 6), 6);
    const corner = roundedHexRadius(Math.PI / 6);
    expect(corner).toBeLessThan(SLAB_RADIUS);
    expect(corner).toBeGreaterThan(SLAB_RADIUS - CORNER_RADIUS);
    for (const p of roundedHexOutline()) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(SLAB_RADIUS + 1e-9);
    // Sampled by angle, the outline never exceeds the ray-cast radius.
    for (let k = 0; k < 360; k += 7) {
      const r = roundedHexRadius(k * deg);
      expect(r).toBeGreaterThan(0.8);
      expect(r).toBeLessThanOrEqual(SLAB_RADIUS + 1e-9);
    }
  });

  it("a land slab is 0.22 R tall with a 0.03 R recess and ±0.02 R relief, and every top face points up", () => {
    const { geometry, height } = buildSlab({ kind: "land", terrain: "forest", seed: "0,0" });
    expect(height).toBeCloseTo(LAND_HEIGHT, 9);
    const pos = geometry.attributes.position!;
    const nrm = geometry.attributes.normal!;
    expect(geometry.attributes.color!.count).toBe(pos.count);
    let minY = Infinity;
    let maxY = -Infinity;
    let floorSeen = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(SLAB_RADIUS + 1e-6);
      if (Math.hypot(x, z) < RECESS_RADIUS - 1e-6 && y > 0.01) {
        expect(y).toBeCloseTo(LAND_HEIGHT - RECESS_DEPTH, 6);
        floorSeen = true;
      }
    }
    expect(floorSeen).toBe(true);
    expect(minY).toBeCloseTo(0, 9);
    expect(maxY).toBeLessThanOrEqual(LAND_HEIGHT + LAND_RELIEF + 1e-6);
    expect(maxY).toBeGreaterThan(LAND_HEIGHT);
    // Faces on the top plane face up, the walls face out.
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const ny = nrm.getY(i);
      if (y > LAND_HEIGHT - 0.005) expect(ny).toBeGreaterThan(0.5);
      else if (y < LAND_HEIGHT - RECESS_DEPTH - 0.01) {
        const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
        const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        expect(nrm.getX(i) * cx + nrm.getZ(i) * cz).toBeGreaterThan(0);
      }
    }
  });

  it("relief is seeded per tile and differs between tiles", () => {
    const a = buildSlab({ kind: "land", terrain: "meadow", seed: "1,0" }).geometry.attributes.position!.array;
    const b = buildSlab({ kind: "land", terrain: "meadow", seed: "1,0" }).geometry.attributes.position!.array;
    const c = buildSlab({ kind: "land", terrain: "meadow", seed: "0,1" }).geometry.attributes.position!.array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("sea slabs are 0.15 R with ±0.03 R facets and no recess; frame slabs are flat", () => {
    const sea = buildSlab({ kind: "sea", terrain: null, seed: "sea:0" });
    expect(sea.height).toBe(SEA_SLAB_HEIGHT);
    const pos = sea.geometry.attributes.position!;
    let maxY = -Infinity;
    let minTop = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      maxY = Math.max(maxY, y);
      if (y > SEA_SLAB_HEIGHT - SEA_RELIEF - 1e-6) minTop = Math.min(minTop, y);
    }
    expect(maxY).toBeLessThanOrEqual(SEA_SLAB_HEIGHT + SEA_RELIEF + 1e-6);
    expect(maxY).toBeGreaterThan(SEA_SLAB_HEIGHT + 0.005);
    expect(minTop).toBeLessThan(SEA_SLAB_HEIGHT - 0.005);
    const frame = buildSlab({ kind: "frame", terrain: null, seed: "f" });
    const fp = frame.geometry.attributes.position!;
    for (let i = 0; i < fp.count; i++) expect(Math.abs(fp.getY(i)) < 1e-6 || Math.abs(fp.getY(i) - frame.height) < 1e-6).toBe(true);
  });

  it("jitter is ±0.4° and ±1.5%, seeded; sea variants and turns spread across neighbours", () => {
    for (const h of GEOMETRY.hexes) {
      const j = slabJitter(h);
      expect(Math.abs(j.rotation)).toBeLessThanOrEqual(0.4 * deg + 1e-12);
      expect(Math.abs(j.height - 1)).toBeLessThanOrEqual(0.015 + 1e-12);
      expect(slabJitter(h)).toEqual(j);
    }
    const seen = new Set(GEOMETRY.hexes.map((h) => `${seaVariant(h).variant}:${seaVariant(h).turns}`));
    expect(seen.size).toBeGreaterThan(6);
  });

  it("the prop boundary keeps a 0.06 R margin inside the slab edge", () => {
    for (let k = 0; k < 360; k += 5) expect(propBoundary(k * deg)).toBeCloseTo(roundedHexRadius(k * deg) - 0.06, 9);
  });
});
