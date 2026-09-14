/**
 * The tile props' models (apps/web/public/models/props/<file>.glb) and how
 * each is fitted, coloured and seated. Props are never player-coloured: one
 * material per kind, the baked texture where the export has one, otherwise a
 * flat colour from the palette. Terrain-sized props (peaks, ridges, mounds)
 * sink 0.02 into the slab so no gap shows at the base; small props 0.005.
 *
 * `loadPropModel` bakes the fit, the length-axis turn and the lift into the
 * geometry itself, so an InstancedMesh needs only position, yaw and scale
 * per instance. A kind with no file here, or whose file fails to load, is
 * logged once and drawn with its procedural fallback (`Props.tsx`).
 */

import * as THREE from "three";
import { MODEL_PATH, axisRotationY, loadModelGeometry, pieceFit, preparedData, texturedMaterial, type PieceConfig } from "./loadPiece";
import * as P from "./palette";
import type { PropKind } from "./props";

export interface PropModel {
  /** File under `/models/props/`, without the extension. */
  readonly file: string;
  readonly config: PieceConfig;
  /** Flat colour when the export carries no texture. */
  readonly color: string;
  /** How far the foot sinks into the slab, world units. */
  readonly sink: number;
  readonly roughness?: number;
}

const TERRAIN_SINK = 0.02;
const SMALL_SINK = 0.005;
const uniform = (height: number): PieceConfig => ({ zones: null, fit: { height } });
/** A model whose length runs along its local X: turned so the length is on Z, then fitted by that length. */
const longX = (length: number): PieceConfig => ({ zones: null, axis: "x", fit: { length } });

/**
 * Kinds without an entry (the pasture bush, the gold sluice, the reeds and
 * the nuggets) have no export yet and always draw procedurally.
 */
export const PROP_MODELS: Partial<Record<PropKind, PropModel>> = {
  // Forest
  tree: { file: "tree", config: uniform(0.48), color: P.OAK, sink: SMALL_SINK },
  tree2: { file: "tree_2", config: uniform(0.5), color: P.OAK_DARK, sink: SMALL_SINK },
  pine: { file: "pine", config: uniform(0.5), color: P.PINE_DARK, sink: SMALL_SINK },
  logPile: { file: "log_pile", config: longX(0.3), color: P.TRUNK, sink: SMALL_SINK },
  // Pasture (the bush has no export)
  sheep: { file: "sheep", config: longX(0.22), color: P.WOOL, sink: SMALL_SINK },
  fence: { file: "fence", config: longX(0.36), color: P.TIMBER, sink: SMALL_SINK },
  // Fields
  wheat: { file: "wheat", config: uniform(0.2), color: P.WHEAT, sink: SMALL_SINK },
  wheat2: { file: "wheat_2", config: uniform(0.2), color: P.WHEAT, sink: SMALL_SINK },
  windmill: { file: "windmill", config: uniform(0.62), color: P.TIMBER, sink: SMALL_SINK },
  hayBale: { file: "hay_bale", config: longX(0.22), color: P.WHEAT, sink: SMALL_SINK },
  // Hills
  moundTall: { file: "mound_tall", config: uniform(0.3), color: P.TERRACE_LOW, sink: TERRAIN_SINK },
  moundWide: { file: "mound_wide", config: uniform(0.14), color: P.TERRACE_LOW, sink: TERRAIN_SINK },
  moundLow: { file: "mound_low", config: longX(0.36), color: P.TERRACE_HIGH, sink: TERRAIN_SINK },
  moundTerraced: { file: "mound_terraced", config: uniform(0.28), color: P.TERRACE_HIGH, sink: TERRAIN_SINK },
  kiln: { file: "kiln", config: uniform(0.28), color: P.KILN, sink: SMALL_SINK },
  brickStack: { file: "brick_stack", config: longX(0.24), color: P.BRICK, sink: SMALL_SINK },
  // Mountains
  peak: { file: "peak", config: uniform(0.44), color: P.ROCK_GREY, sink: TERRAIN_SINK },
  ridge: { file: "ridge", config: uniform(0.32), color: P.ROCK_GREY, sink: TERRAIN_SINK },
  boulder: { file: "boulder", config: uniform(0.14), color: P.ROCK_GREY, sink: SMALL_SINK },
  rubble: { file: "rubble", config: longX(0.26), color: P.ROCK_GREY, sink: SMALL_SINK },
  // Desert
  cactus: { file: "cactus", config: uniform(0.32), color: P.CACTUS, sink: SMALL_SINK },
  dryBush: { file: "dry_bush", config: uniform(0.14), color: P.TRUNK, sink: SMALL_SINK },
  skull: { file: "skull", config: uniform(0.07), color: P.BONE, sink: SMALL_SINK },
  flatRock: { file: "flat_rock", config: uniform(0.03), color: P.DESERT_ROCK, sink: SMALL_SINK },
};

export const PROP_MODEL_PATH = `${MODEL_PATH}/props`;

/** Which kinds the scatter rules name but no model serves; logged once by the renderer. */
export function missingPropModels(kinds: Iterable<PropKind>): PropKind[] {
  return [...new Set(kinds)].filter((k) => !PROP_MODELS[k]);
}

/**
 * Bake a prepared geometry's placement into its vertices: lift the foot to
 * y = 0 in raw space, turn a local-X model so its length is on Z, then apply
 * the fit scale. What remains for the instance matrix is where it stands.
 */
export function bakePropGeometry(geometry: THREE.BufferGeometry, config: PieceConfig): THREE.BufferGeometry {
  const { scale, lift } = pieceFit(config, geometry);
  const m = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z).multiply(new THREE.Matrix4().makeRotationY(axisRotationY(config))).multiply(new THREE.Matrix4().makeTranslation(0, lift, 0));
  const baked = geometry.clone();
  baked.applyMatrix4(m);
  baked.computeBoundingBox();
  baked.computeBoundingSphere();
  baked.userData = geometry.userData;
  return baked;
}

/** One flat-shaded material per kind: the baked texture when the export has one, else the palette colour. */
export function propMaterial(model: PropModel, geometry: THREE.BufferGeometry): THREE.MeshStandardMaterial {
  const { map } = preparedData(geometry);
  const roughness = model.roughness ?? 0.9;
  return map ? texturedMaterial(map, { color: "#ffffff", roughness }) : new THREE.MeshStandardMaterial({ color: model.color, flatShading: true, roughness });
}

const baked = new Map<PropKind, Promise<THREE.BufferGeometry>>();

/** The baked, cached geometry for a prop kind; rejects when the kind has no model or the file fails. */
export function loadPropGeometry(kind: PropKind): Promise<THREE.BufferGeometry> {
  const model = PROP_MODELS[kind];
  if (!model) return Promise.reject(new Error(`no model for prop "${kind}"`));
  let pending = baked.get(kind);
  if (!pending) {
    pending = loadModelGeometry(`${PROP_MODEL_PATH}/${model.file}.glb`, model.config).then((g) => bakePropGeometry(g, model.config));
    pending.catch(() => baked.delete(kind));
    baked.set(kind, pending);
  }
  return pending;
}
