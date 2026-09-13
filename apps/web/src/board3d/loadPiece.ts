/**
 * GLB figurines. Meshy exports (apps/web/public/models/<name>.glb) are a
 * single mesh about the origin with no normals and no material.
 * `loadPiece(name, options)` fetches one through GLTFLoader, caches the
 * prepared geometry by name (one download, one normal pass and one zone
 * split per piece for the whole session), and returns a fresh Group per
 * call: the mesh is raised so its foot sits at the group's origin, and the
 * group is scaled uniformly to `PIECES[name].fit` (the procedural piece's
 * height in the unscaled piece frame Pieces.tsx uses before `PIECE_SCALE`,
 * or, for roads, the hex edge length along the model's Z axis).
 *
 * Colour comes from the caller so one helper serves the robber and the
 * player-coloured pieces. A piece with `zones` is split by vertex Y in the
 * raw model space: the base (y ≤ baseMaxY) and the top (y ≥ topMinY) take
 * the caller's `color`, the middle takes `neutral` (plaster, stone). A
 * piece without zones is one material in `color`.
 *
 * A failed fetch or parse rejects; `usePiece` turns that into `null` so the
 * caller can keep the procedural figure as a fallback.
 */

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HEX_RADIUS } from "./layout3d";

export type PieceName = "robber" | "settlement" | "city" | "road";

/** Y thresholds in the raw model's local space (before scaling). */
export interface PieceZones {
  /** Triangles at or below this are the base. */
  baseMaxY: number;
  /** Triangles at or above this are the top. */
  topMinY: number;
}

export interface PieceConfig {
  zones: PieceZones | null;
  /** The whole model in the caller's colour (roads). */
  fullPlayerColor?: boolean;
  /** Scale the model's height (Y extent) to this, or its length (Z extent) to this. */
  fit: { height: number } | { length: number };
}

export const PIECES: Record<PieceName, PieceConfig> = {
  // Base disc, cone body and the tip of the tilted hood cone: 0.27 + 0.05·cos(0.25).
  robber: { zones: null, fit: { height: 0.32 } },
  // Base ring to the crown of the thatched roof: 0.12 + 0.8·0.08.
  settlement: { zones: { baseMaxY: -0.34, topMinY: -0.11 }, fit: { height: 0.18 } },
  // Base ring to the top of the keep's flag pole: 0.2 + 0.14.
  city: { zones: { baseMaxY: -0.41, topMinY: 0.27 }, fit: { height: 0.34 } },
  // 1.0 long on local Z, 0.46 wide, 0.10 thick, centred; Z becomes the hex edge (world units, no PIECE_SCALE).
  road: { zones: null, fullPlayerColor: true, fit: { length: HEX_RADIUS } },
};

/** Material slot order for a zoned piece. */
export const ZONE_BASE = 0;
export const ZONE_MIDDLE = 1;
export const ZONE_TOP = 2;

export const MODEL_PATH = "/models";

export interface PieceMaterialOptions {
  /** The piece's colour: the player's for pieces, near-black for the robber. */
  color: string;
  /** The middle zone's colour on a zoned piece (walls, stone); defaults to `color`. */
  neutral?: string;
  roughness?: number;
  metalness?: number;
  /** Translucent placement preview, as `Mat`'s `ghost`. */
  ghost?: boolean;
}

export interface PieceOptions extends PieceMaterialOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

const loader = new GLTFLoader();
const geometries = new Map<PieceName, Promise<THREE.BufferGeometry>>();

/** The first mesh in a parsed scene; Meshy files hold exactly one. */
function firstMesh(gltf: GLTF): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  if (!found) throw new Error("GLB has no mesh");
  return found;
}

/** Which zone a triangle belongs to, by the Y of its centroid in raw model space. */
export function zoneOf(y: number, zones: PieceZones): number {
  if (y <= zones.baseMaxY) return ZONE_BASE;
  if (y >= zones.topMinY) return ZONE_TOP;
  return ZONE_MIDDLE;
}

/**
 * Reorder a non-indexed geometry's triangles into base / middle / top runs and
 * register one draw group per zone, so a material array colours them apart.
 */
export function splitZones(geometry: THREE.BufferGeometry, zones: PieceZones): THREE.BufferGeometry {
  const pos = geometry.getAttribute("position");
  const tris = pos.count / 3;
  const buckets: number[][] = [[], [], []];
  for (let t = 0; t < tris; t++) {
    const y = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3;
    buckets[zoneOf(y, zones)]!.push(t);
  }
  const out = new Float32Array(pos.count * 3);
  const src = pos.array as ArrayLike<number>;
  let cursor = 0;
  const result = new THREE.BufferGeometry();
  for (let zone = 0; zone < 3; zone++) {
    const start = cursor;
    for (const t of buckets[zone]!) {
      for (let k = 0; k < 9; k++) out[cursor * 3 + k] = src[t * 9 + k]!;
      cursor += 3;
    }
    result.addGroup(start, cursor - start, zone);
  }
  result.setAttribute("position", new THREE.BufferAttribute(out, 3));
  return result;
}

/** Bake the node transform in, keep positions only, split zones, and add the flat normals the export lacks. */
export function preparePieceGeometry(gltf: GLTF, config: PieceConfig): THREE.BufferGeometry {
  const mesh = firstMesh(gltf);
  mesh.updateWorldMatrix(true, false);
  let geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  for (const name of Object.keys(geometry.attributes)) if (name !== "position") geometry.deleteAttribute(name);
  // Non-indexed: one vertex per corner, so normals are per face (flat) and triangles can be regrouped.
  if (geometry.index) geometry = geometry.toNonIndexed();
  if (config.zones) geometry = splitZones(geometry, config.zones);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Parse a GLB already in memory (tests, or preloaded bytes) into a piece geometry. */
export function parsePiece(name: PieceName, buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        try {
          resolve(preparePieceGeometry(gltf, PIECES[name]));
        } catch (err) {
          reject(err);
        }
      },
      reject,
    );
  });
}

/** The cached geometry for `name`, fetched from `/models/<name>.glb` on first use. */
export function loadPieceGeometry(name: PieceName): Promise<THREE.BufferGeometry> {
  let pending = geometries.get(name);
  if (!pending) {
    pending = new Promise<THREE.BufferGeometry>((resolve, reject) => {
      loader.load(
        `${MODEL_PATH}/${name}.glb`,
        (gltf) => {
          try {
            resolve(preparePieceGeometry(gltf, PIECES[name]));
          } catch (err) {
            reject(err);
          }
        },
        undefined,
        reject,
      );
    });
    // Forget a failed load so a later mount can retry instead of caching the error.
    pending.catch(() => geometries.delete(name));
    geometries.set(name, pending);
  }
  return pending;
}

export function pieceMaterial({ color, roughness = 0.8, metalness = 0, ghost = false }: PieceMaterialOptions): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true, transparent: ghost, opacity: ghost ? 0.5 : 1, depthWrite: !ghost });
}

/** One material for an unzoned piece; base / middle / top for a zoned one. */
export function pieceMaterials(config: PieceConfig, options: PieceMaterialOptions): THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] {
  if (!config.zones || config.fullPlayerColor) return pieceMaterial(options);
  const player = pieceMaterial(options);
  const middle = pieceMaterial({ ...options, color: options.neutral ?? options.color });
  return [player, middle, player.clone()];
}

/** Uniform scale that fits the geometry's extent to the config, and the lift that puts its foot at y = 0. */
export function pieceFit(config: PieceConfig, geometry: THREE.BufferGeometry): { scale: number; lift: number } {
  const box = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox!);
  const extent = "height" in config.fit ? box.max.y - box.min.y : box.max.z - box.min.z;
  const target = "height" in config.fit ? config.fit.height : config.fit.length;
  return { scale: target / extent, lift: -box.min.y };
}

/** Wrap a prepared geometry: mesh lifted so the foot is at the origin, group scaled to the piece's fit. */
export function assemblePiece(name: PieceName, geometry: THREE.BufferGeometry, options: PieceOptions): THREE.Group {
  const config = PIECES[name];
  const mesh = new THREE.Mesh(geometry, pieceMaterials(config, options));
  const { scale, lift } = pieceFit(config, geometry);
  mesh.position.y = lift;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  mesh.name = `${name}-mesh`;
  const group = new THREE.Group();
  group.name = `${name}-glb`;
  group.scale.setScalar(scale);
  group.add(mesh);
  return group;
}

/** A fresh Group holding a Mesh of the cached geometry in flat-shaded standard materials coloured per `options`. */
export async function loadPiece(name: PieceName, options: PieceOptions): Promise<THREE.Group> {
  return assemblePiece(name, await loadPieceGeometry(name), options);
}

/** Dispose everything a `loadPiece` group owns except the shared geometry. */
export function disposePiece(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
}

/**
 * The loaded piece for React: `null` while loading and after a failure, so
 * the caller renders its procedural figure instead. Rebuilt (cheaply, the
 * geometry is cached) when the material options change.
 */
export function usePiece(name: PieceName, options: PieceOptions): THREE.Group | null {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const { color, neutral = color, roughness = 0.8, metalness = 0, ghost = false, castShadow = false, receiveShadow = false } = options;
  useEffect(() => {
    let live = true;
    let built: THREE.Group | null = null;
    loadPiece(name, { color, neutral, roughness, metalness, ghost, castShadow, receiveShadow })
      .then((g) => {
        if (!live) return disposePiece(g);
        built = g;
        setGroup(g);
      })
      .catch((err: unknown) => {
        if (live) console.warn(`[board3d] ${name}.glb failed to load, using the procedural piece`, err);
      });
    return () => {
      live = false;
      setGroup((cur) => (cur === built ? null : cur));
      if (built) disposePiece(built);
    };
  }, [name, color, neutral, roughness, metalness, ghost, castShadow, receiveShadow]);
  return group;
}
