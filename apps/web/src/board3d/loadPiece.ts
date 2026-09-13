/**
 * GLB figurines. Meshy exports (apps/web/public/models/<name>.glb) are a
 * single mesh, 1 unit tall with the pivot at the vertical centre, and carry
 * no normals or material. `loadPiece(name)` fetches one through GLTFLoader,
 * caches the geometry by name (one download and one normal pass per piece
 * for the whole session), and returns a fresh Group per call: the mesh sits
 * +0.5 up so the group's origin is the piece's foot, and the group is scaled
 * uniformly so the model is as tall as the procedural piece it replaces
 * (`PIECE_HEIGHTS`, in the same unscaled piece frame the figures in
 * Pieces.tsx use before `PIECE_SCALE`). Colour and roughness come from the
 * caller so the same helper serves player-coloured pieces.
 *
 * A failed fetch or parse rejects; `usePiece` turns that into `null` so the
 * caller can keep the procedural figure as a fallback.
 */

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export type PieceName = "robber";

/** Height of each procedural figure in Pieces.tsx (before `PIECE_SCALE`); the GLB is scaled to match. */
export const PIECE_HEIGHTS: Record<PieceName, number> = {
  // Base disc, cone body and the tip of the tilted hood cone: 0.27 + 0.05·cos(0.25).
  robber: 0.32,
};

export const MODEL_PATH = "/models";

export interface PieceMaterialOptions {
  color: string;
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

/** Bake the node transform in, drop attributes we do not use, and add the flat normals the export lacks. */
export function preparePieceGeometry(gltf: GLTF): THREE.BufferGeometry {
  const mesh = firstMesh(gltf);
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Parse a GLB already in memory (tests, or preloaded bytes) into a piece geometry. */
export function parsePiece(buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        try {
          resolve(preparePieceGeometry(gltf));
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
      loader.load(`${MODEL_PATH}/${name}.glb`, (gltf) => {
        try {
          resolve(preparePieceGeometry(gltf));
        } catch (err) {
          reject(err);
        }
      }, undefined, reject);
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

/** Wrap a prepared geometry: mesh raised +0.5 so the foot is at the origin, group scaled to the piece height. */
export function assemblePiece(name: PieceName, geometry: THREE.BufferGeometry, options: PieceOptions): THREE.Group {
  const mesh = new THREE.Mesh(geometry, pieceMaterial(options));
  mesh.position.y = 0.5;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  mesh.name = `${name}-mesh`;
  const group = new THREE.Group();
  group.name = `${name}-glb`;
  const h = PIECE_HEIGHTS[name];
  group.scale.set(h, h, h);
  group.add(mesh);
  return group;
}

/** A fresh Group holding a Mesh of the cached geometry in a flat-shaded standard material of `options.color`. */
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
  const { color, roughness = 0.8, metalness = 0, ghost = false, castShadow = false, receiveShadow = false } = options;
  useEffect(() => {
    let live = true;
    let built: THREE.Group | null = null;
    loadPiece(name, { color, roughness, metalness, ghost, castShadow, receiveShadow })
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
  }, [name, color, roughness, metalness, ghost, castShadow, receiveShadow]);
  return group;
}
