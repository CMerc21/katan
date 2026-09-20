import { describe, expect, it } from "vitest";
import { GEOMETRY } from "@katan/engine";
import { CORNER_RADIUS, LAND_HEIGHT, LAND_RELIEF, RECESS_DEPTH, RECESS_RADIUS, SEA_RELIEF, SEA_SLAB_HEIGHT, SLAB_RADIUS, TERRAIN_LIFT, buildSlab, propBoundary, roundedHexOutline, roundedHexRadius, seaVariant, slabJitter } from "@/board3d/slab";

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

  it("a land slab is 0.22 R tall with a 0.03 R recess and ±0.05 R relief, and every top face points up", () => {
    // Forest carries a centre lift, so the recess floor and the top sit that
    // much higher; the rim stays at LAND_HEIGHT, which is the plane pieces use.
    const lift = TERRAIN_LIFT.forest;
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
        expect(y).toBeCloseTo(LAND_HEIGHT + lift - RECESS_DEPTH, 6);
        floorSeen = true;
      }
    }
    expect(floorSeen).toBe(true);
    expect(minY).toBeCloseTo(0, 9);
    expect(maxY).toBeLessThanOrEqual(LAND_HEIGHT + lift + LAND_RELIEF + 1e-6);
    expect(maxY).toBeGreaterThan(LAND_HEIGHT);
    // Faces on the top plane face up, the walls face out.
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const ny = nrm.getY(i);
      // The ring between the recess floor and the surface is a deliberately
      // near-vertical wall. Classifying faces by height alone put it on the
      // top plane once the recess started riding the terrain's centre lift.
      const onRecessWall = Math.abs(Math.hypot(cx, cz) - RECESS_RADIUS) < 0.02;
      if (!onRecessWall && y > LAND_HEIGHT - 0.005) expect(ny).toBeGreaterThan(0.5);
      else if (y < LAND_HEIGHT - RECESS_DEPTH - 0.01) {
        expect(nrm.getX(i) * cx + nrm.getZ(i) * cz).toBeGreaterThan(0);
      }
    }
  });

  it("docs/props.md §1 lights the outer band of a land tile, and leaves the sea alone", () => {
    /**
     * Mean brightness of top faces whose centroid falls in a band, measured as
     * a fraction of the distance from the centre to the tile's outline at that
     * angle. A raw radius band is wrong here: the outline is at 0.853 R along
     * the flat edges and 0.985 R at the corners, so a band near 0.985 catches
     * only corners and misses the edges entirely.
     */
    const bandMean = (spec: Parameters<typeof buildSlab>[0], lo: number, hi: number) => {
      const g = buildSlab(spec).geometry;
      const pos = g.attributes.position!;
      const col = g.attributes.color!;
      const nrm = g.attributes.normal!;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < pos.count; i += 3) {
        // Top faces only, picked by normal: the side walls carry their own
        // layer colours, and picking by height instead misses top faces that
        // the relief has pushed down.
        if (nrm.getY(i) < 0.5) continue;
        const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
        const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        const frac = Math.hypot(cx, cz) / roundedHexRadius(Math.atan2(cz, cx));
        if (frac < lo || frac > hi) continue;
        sum += col.getX(i) + col.getY(i) + col.getZ(i);
        n++;
      }
      return n > 0 ? sum / n : 0;
    };

    const land = { kind: "land", terrain: "meadow", seed: "0,0" } as const;
    const inner = bandMean(land, 0.45, 0.65);
    const rim = bandMean(land, 0.94, 1);
    expect(inner).toBeGreaterThan(0);
    // The band used to be the same colour as the tile body, so tiles met the
    // dark gap between them with no edge at all.
    expect(rim).toBeGreaterThan(inner * 1.05);

    // The sea stays uniform, or the rims would draw a grid across open water.
    const sea = { kind: "sea", terrain: null, seed: "0,0" } as const;
    const seaInner = bandMean(sea, 0.45, 0.65);
    const seaRim = bandMean(sea, 0.94, 1);
    expect(seaInner).toBeGreaterThan(0);
    expect(Math.abs(seaRim - seaInner)).toBeLessThan(seaInner * 0.05);
  });

  it("docs/props.md §1 shades each face separately, so a tile is not one flat colour", () => {
    const { geometry } = buildSlab({ kind: "land", terrain: "meadow", seed: "0,0" });
    const colors = geometry.attributes.color!;
    // One colour per triangle: the buffer is non-indexed and `tri` writes the
    // same value three times, so sample the first vertex of each face.
    const shades: number[] = [];
    for (let i = 0; i < colors.count; i += 3) shades.push(colors.getX(i) + colors.getY(i) + colors.getZ(i));
    const min = Math.min(...shades);
    const max = Math.max(...shades);
    // Every face used to carry the identical `topColor`, which is what made the
    // tiles read as flat card however much relief the mesh had.
    expect(max - min).toBeGreaterThan(0.05);
    const distinct = new Set(shades.map((v) => v.toFixed(4)));
    expect(distinct.size).toBeGreaterThan(shades.length / 4);
  });

  it("shades faces deterministically, so two tiles of one terrain still differ", () => {
    const read = (seed: string) => {
      const c = buildSlab({ kind: "land", terrain: "meadow", seed }).geometry.attributes.color!;
      return Array.from({ length: c.count }, (_, i) => c.getX(i));
    };
    expect(read("0,0")).toEqual(read("0,0"));
    expect(read("0,0")).not.toEqual(read("1,0"));
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
