import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PIECE_HEIGHTS, assemblePiece, disposePiece, parsePiece, pieceMaterial } from "@/board3d/loadPiece";

const glb = (name: string): ArrayBuffer => {
  const buf = readFileSync(path.resolve(__dirname, "../public/models", `${name}.glb`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

describe("GLB pieces (public/models)", () => {
  it("robber.glb parses, gets flat normals, and is one unit tall about its centre", async () => {
    const g = await parsePiece(glb("robber"));
    expect(g.getAttribute("position").count).toBeGreaterThan(0);
    const n = g.getAttribute("normal");
    expect(n).toBeDefined();
    expect(n.count).toBe(g.getAttribute("position").count);
    // A normal somewhere is non-zero (computeVertexNormals ran on real triangles).
    let mag = 0;
    for (let i = 0; i < n.count; i++) mag = Math.max(mag, Math.hypot(n.getX(i), n.getY(i), n.getZ(i)));
    expect(mag).toBeCloseTo(1, 3);
    const box = g.boundingBox!;
    expect(box.min.y).toBeCloseTo(-0.5, 2);
    expect(box.max.y).toBeCloseTo(0.5, 2);
  });

  it("assemblePiece puts the foot at the origin and scales to the procedural height", async () => {
    const g = await parsePiece(glb("robber"));
    const group = assemblePiece("robber", g, { color: "#1a1a1a", roughness: 0.8, castShadow: true });
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.position.y).toBe(0.5);
    expect(mesh.castShadow).toBe(true);
    expect(group.scale.toArray()).toEqual([PIECE_HEIGHTS.robber, PIECE_HEIGHTS.robber, PIECE_HEIGHTS.robber]);
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    expect(world.min.y).toBeCloseTo(0, 5);
    expect(world.max.y).toBeCloseTo(PIECE_HEIGHTS.robber, 5);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.flatShading).toBe(true);
    expect(mat.roughness).toBe(0.8);
    expect(mat.color.getHexString()).toBe("1a1a1a");
    expect(mat.transparent).toBe(false);
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
