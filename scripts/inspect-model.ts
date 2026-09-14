/**
 * Print the mesh islands of a GLB so their ids can be mapped to parts by hand
 * (the `playerColorIslands` lists in apps/web/src/board3d/loadPiece.ts).
 *
 *   pnpm inspect:model apps/web/public/models/city.glb
 *   node scripts/inspect-model.ts docs/art/models/Meshy_AI_model.glb
 *
 * Per island: id, triangle count, Y range, XZ radius range, centroid — all in
 * the model's raw space, before any fit or lift. Ids follow the same
 * deterministic order the loader uses, so they are stable across runs.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GLTFLoader, type GLTF } from "../apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { findIslands } from "../apps/web/src/board3d/islands.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/inspect-model.ts <model.glb>");
  process.exit(2);
}
const buf = readFileSync(resolve(file));
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const gltf = await new Promise<GLTF>((ok, fail) => new GLTFLoader().parse(bytes, "", ok, fail));
let mesh: { geometry: import("three").BufferGeometry; material: unknown } | null = null;
gltf.scene.traverse((o) => {
  if (!mesh && (o as { isMesh?: boolean }).isMesh) mesh = o as typeof mesh;
});
if (!mesh) {
  console.error("no mesh in file");
  process.exit(1);
}
const geometry = (mesh as { geometry: import("three").BufferGeometry }).geometry;
const { islands } = findIslands(geometry);
const box = (geometry.computeBoundingBox(), geometry.boundingBox!);
const attrs = Object.keys(geometry.attributes).join(", ");
const textured = !!(mesh as { material?: { map?: unknown } }).material?.map;

const f = (n: number, w = 6) => n.toFixed(3).padStart(w);
console.log(`${file}`);
console.log(`  bounds x ${f(box.min.x)}..${f(box.max.x)}  y ${f(box.min.y)}..${f(box.max.y)}  z ${f(box.min.z)}..${f(box.max.z)}`);
console.log(`  attributes: ${attrs}${textured ? "  (baked texture present)" : "  (no texture)"}`);
console.log(`  ${islands.length} island(s)${islands.length < 3 ? "  — fewer than 3: the loader will use height bands for this model" : ""}`);
console.log("   id   tris      y range            xz radius        centroid");
for (const i of islands) {
  console.log(`  ${String(i.id).padStart(3)}  ${String(i.triangles).padStart(5)}   ${f(i.minY)}..${f(i.maxY)}   ${f(i.minRadius)}..${f(i.maxRadius)}   (${f(i.centroid.x)}, ${f(i.centroid.y)}, ${f(i.centroid.z)})`);
}
