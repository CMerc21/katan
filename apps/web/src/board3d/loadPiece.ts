/**
 * GLB figurines. Meshy exports (apps/web/public/models/<name>.glb) are a
 * single mesh pivoted at its centre with no normals; the first batch also has
 * no material and no UVs, the textured re-exports carry a baked texture.
 * `loadPiece(name, options)` fetches one through GLTFLoader, caches the
 * prepared geometry by name (one download, one normal pass and one colour
 * split per piece for the whole session), and returns a fresh Group per
 * call: the mesh is lifted by the model's actual minimum Y so its foot sits
 * at the group's origin (never an assumed -0.5), and the group is scaled to
 * `PIECES[name].fit` in world units (hex edge = 1).
 *
 * A model whose length runs along its local X (`axis: "x"`) is turned a
 * quarter turn about Y inside the group so X maps to Z; every piece then
 * presents its length on Z and the road orientation logic applies.
 *
 * Colour comes from the caller so one helper serves every piece. Which
 * triangles take the player colour is decided one of three ways:
 *
 *  - **Islands** (`playerColorIslands`): the mesh is split into connected
 *    components (`islands.ts`), numbered deterministically; the listed ones
 *    get a solid player-colour material and every other island keeps the
 *    model's baked texture, or a flat `neutral` when the export has none.
 *    The ids are mapped to parts by hand with `scripts/inspect-model.ts`.
 *  - **Height bands** (`zones`): the fallback for a model with fewer than
 *    three islands, or none listed. Triangles at or below `baseMaxY` and at
 *    or above `topMinY` (raw model space) take the player colour.
 *  - **Single**: no zones at all — one material, the baked texture when there
 *    is one (the robber, the merchant, the signpost), or `color` when there is
 *    not or the piece is `fullPlayerColor` (roads).
 *
 * Every material keeps `flatShading: true`. A failed fetch or parse rejects;
 * `usePiece` turns that into `null` so the caller can keep the procedural
 * figure as a fallback.
 */

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { findIslands, regroupTriangles } from "./islands";
import { EDGE_LENGTH } from "./layout3d";

export type PieceName = "robber" | "settlement" | "city" | "road" | "metropolis" | "metropolis_walled" | "city_walled" | "ship" | "barbarian_ship" | "pirate" | "merchant" | "knight_1" | "knight_2" | "knight_3" | "port_sign";

/** Y thresholds in the raw model's local space (before scaling). */
export interface PieceZones {
  /** Triangles at or below this are the base; omit for no base zone. */
  baseMaxY?: number;
  /** Triangles at or above this are the top; omit for no top zone. */
  topMinY?: number;
}

export interface PieceConfig {
  /** Height-band fallback; `null` for a single-material piece. */
  zones: PieceZones | null;
  /** Island ids (`scripts/inspect-model.ts`) that take the player colour; the rest keep the baked texture or `neutral`. */
  playerColorIslands?: readonly number[];
  /** The whole model in the caller's colour (roads), texture or not. */
  fullPlayerColor?: boolean;
  /** The model's length runs along its local X; turn it so the length is on Z. */
  axis?: "x";
  /** World units: uniform to a `height` (Y extent) or a `length` (Z extent, after the turn), or per axis. */
  fit: { height: number } | { length: number } | { width: number; height: number; length: number };
}

/** How a prepared geometry's draw groups map to materials. */
export type ColorMode = "single" | "zones" | "islands";

/** What `prepareGeometry` records on the geometry for `pieceMaterials`. */
export interface PreparedUserData {
  colorMode: ColorMode;
  /** The export's baked texture, shared by every instance; `null` for an untextured export. */
  map: THREE.Texture | null;
}

/** The 1.5× the procedural figures are drawn at (docs/props.md), already folded into the world sizes below. */
const FIGURE_SCALE = 1.5;
/**
 * The plain city's world height. Both upgrades stand taller than it, and the
 * walled models share one footprint so the wall ring reads the same size on a
 * walled city and a walled metropolis.
 */
export const CITY_HEIGHT = 0.34 * FIGURE_SCALE;
export const WALL_FOOTPRINT = 0.62;
const GREY = "#8a8f99";
const WOOD = "#8b6a45";
const NEAR_BLACK = "#1a1a1a";
const DARK_RED = "#7a2a2a";

/** Neutral colours the figures pass as `neutral` / `color`, kept next to the zones they colour. */
export const PIECE_COLORS = { grey: GREY, wood: WOOD, nearBlack: NEAR_BLACK, darkRed: DARK_RED, merchant: "#c9b58a" } as const;

/**
 * Island ids below were read off each model with `scripts/inspect-model.ts`
 * and mapped by hand; the `zones` beside them are the height-band fallback
 * and document the same intent (base disc and top accent in the player
 * colour, body neutral).
 */
export const PIECES: Record<PieceName, PieceConfig> = {
  // Base disc, cone body and the tip of the tilted hood cone: (0.27 + 0.05·cos(0.25)) × 1.5. Baked texture when present.
  robber: { zones: null, fit: { height: 0.32 * FIGURE_SCALE } },
  // Roof halves (0, 1) and base disc (2); the wall segments stay plaster. Height (0.12 + 0.8·0.08) × 1.5.
  settlement: { zones: { baseMaxY: -0.34, topMinY: -0.11 }, playerColorIslands: [0, 1, 2], fit: { height: 0.18 * FIGURE_SCALE } },
  // Base disc (2), flag (3) and its pole (4). Height (0.2 + 0.14) × 1.5.
  city: { zones: { baseMaxY: -0.41, topMinY: 0.27 }, playerColorIslands: [2, 3, 4], fit: { height: CITY_HEIGHT } },
  // 1.0 long on local Z, 0.46 wide, 0.10 thick. Stops short of the vertices where settlements sit.
  road: { zones: null, fullPlayerColor: true, fit: { width: 0.18 * EDGE_LENGTH, height: 0.08 * EDGE_LENGTH, length: 0.8 * EDGE_LENGTH } },
  // Base disc (3), crown ring (2, 4) and its ten points. Taller than the plain city (CITY_HEIGHT).
  metropolis: { zones: { baseMaxY: -0.42, topMinY: 0.38 }, playerColorIslands: [2, 3, 4, 26, 27, 28, 29, 36, 37, 38, 39, 40, 41], fit: { width: 0.5, height: 0.65, length: 0.5 } },
  // Base disc (2, radius 0.51 against the wall's 0.46 — its centroid sits just above the band cutoff, which is why it is listed by hand), flag (4) and pole (7).
  city_walled: { zones: { baseMaxY: -0.32, topMinY: 0.2 }, playerColorIslands: [2, 4, 7], fit: { width: WALL_FOOTPRINT, height: 0.56, length: WALL_FOOTPRINT } },
  // Base disc (4) and the fused crown (2); the courtyard floor at -0.41 stays grey. Same wall footprint as `city_walled`.
  metropolis_walled: { zones: { baseMaxY: -0.42, topMinY: 0.4 }, playerColorIslands: [2, 4], fit: { width: WALL_FOOTPRINT, height: 0.7, length: WALL_FOOTPRINT } },
  // The whole sail sheet (2); the yard above it and the mast stay wood. Length on local X, hull bottom (raw Y -0.455) on the water.
  ship: { zones: { topMinY: 0.2 }, playerColorIslands: [2], axis: "x", fit: { width: 0.22, height: 0.26, length: 0.7 } },
  // The tattered sail sheet (1) dark red; yard and hull near-black. Length on local X.
  barbarian_ship: { zones: { topMinY: 0.24 }, playerColorIslands: [1], axis: "x", fit: { width: 0.3, height: 0.28, length: 0.65 } },
  // Sail sheet (5) and masthead pennant (3) dark red; the rest near-black. Length on local X, laid along the hex's flat sides.
  pirate: { zones: { topMinY: 0.18 }, playerColorIslands: [3, 5], axis: "x", fit: { width: 0.36, height: 0.32, length: 0.32 } },
  // Hex centre like the robber; baked texture when present, else one warm neutral. Lifted by its own min Y (-0.436).
  merchant: { zones: null, fit: { width: 0.3, height: 0.3, length: 0.3 } },
  // Base halves (3, 4) and plume (9); the level is which model loads.
  knight_1: { zones: { baseMaxY: -0.42, topMinY: 0.1 }, playerColorIslands: [3, 4, 9], fit: { width: 0.18, height: 0.26, length: 0.18 } },
  // Base disc (7), boots (8, 10), crest (5) and its tip (18).
  knight_2: { zones: { baseMaxY: -0.33, topMinY: 0.22 }, playerColorIslands: [5, 7, 8, 10, 18], fit: { width: 0.2, height: 0.28, length: 0.2 } },
  // Base halves (2, 7) and the great helm with plume (0).
  knight_3: { zones: { baseMaxY: -0.38, topMinY: 0.19 }, playerColorIslands: [0, 2, 7], fit: { width: 0.23, height: 0.3, length: 0.23 } },
  // At each port's edge midpoint on the sea side, facing the land hex. Baked texture when present, else wood.
  port_sign: { zones: null, fit: { width: 0.26, height: 0.3, length: 0.24 } },
};

/** Material slot order for a height-band piece. In island mode the slots are 0 = player, 1 = other. */
export const ZONE_BASE = 0;
export const ZONE_MIDDLE = 1;
export const ZONE_TOP = 2;
export const ISLAND_PLAYER = 0;
export const ISLAND_OTHER = 1;
/** Below this many islands the loader falls back to height bands. */
export const MIN_ISLANDS = 3;

export const MODEL_PATH = "/models";

export interface PieceMaterialOptions {
  /** The piece's colour: the player's for pieces, the sail's for ships, near-black for the robber. */
  color: string;
  /** The colour of everything that is not player-coloured when the export has no texture; defaults to `color`. */
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

/** `color` darkened for an inactive piece (inactive knights: zone colours × 0.55). */
export function dimColor(color: string, factor = 0.55): string {
  return `#${new THREE.Color(color).multiplyScalar(factor).getHexString()}`;
}

const loader = new GLTFLoader();
const geometries = new Map<string, Promise<THREE.BufferGeometry>>();

/** The first mesh in a parsed scene; Meshy files hold exactly one. */
function firstMesh(gltf: GLTF): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  if (!found) throw new Error("GLB has no mesh");
  return found;
}

/** The baked texture on a loaded mesh, if its material carries one. */
function bakedMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const map = (m as { map?: THREE.Texture | null } | undefined)?.map;
  return map ?? null;
}

/** Which zone a triangle belongs to, by the Y of its centroid in raw model space. */
export function zoneOf(y: number, zones: PieceZones): number {
  if (zones.baseMaxY !== undefined && y <= zones.baseMaxY) return ZONE_BASE;
  if (zones.topMinY !== undefined && y >= zones.topMinY) return ZONE_TOP;
  return ZONE_MIDDLE;
}

export function preparedData(geometry: THREE.BufferGeometry): PreparedUserData {
  const d = geometry.userData as Partial<PreparedUserData>;
  return { colorMode: d.colorMode ?? "single", map: d.map ?? null };
}

/**
 * Bake the node transform in, keep positions and UVs, make the mesh
 * non-indexed (one vertex per corner: flat normals, and triangles can be
 * regrouped), split the player-coloured triangles apart by islands or by
 * height bands, and add the normals the export lacks.
 */
export function prepareGeometry(raw: THREE.BufferGeometry, config: PieceConfig, matrix?: THREE.Matrix4, map: THREE.Texture | null = null): THREE.BufferGeometry {
  let geometry = raw.clone();
  if (matrix) geometry.applyMatrix4(matrix);
  for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "uv") geometry.deleteAttribute(name);
  if (geometry.index) geometry = geometry.toNonIndexed();
  let colorMode: ColorMode = "single";
  if (config.zones && !config.fullPlayerColor) {
    const { islands, triangleIsland } = findIslands(geometry);
    if (config.playerColorIslands && islands.length >= MIN_ISLANDS) {
      const player = new Set(config.playerColorIslands);
      geometry = regroupTriangles(geometry, (t) => (player.has(triangleIsland[t]!) ? ISLAND_PLAYER : ISLAND_OTHER), 2);
      colorMode = "islands";
    } else {
      const zones = config.zones;
      const pos = geometry.getAttribute("position");
      geometry = regroupTriangles(geometry, (t) => zoneOf((pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3, zones), 3);
      colorMode = "zones";
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const data: PreparedUserData = { colorMode, map };
  geometry.userData = data;
  return geometry;
}

export function preparePieceGeometry(gltf: GLTF, config: PieceConfig): THREE.BufferGeometry {
  const mesh = firstMesh(gltf);
  mesh.updateWorldMatrix(true, false);
  return prepareGeometry(mesh.geometry, config, mesh.matrixWorld, bakedMap(mesh));
}

/** Parse a GLB already in memory (tests, or preloaded bytes) into a piece geometry. */
export function parsePiece(name: PieceName, buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return parseModel(buffer, PIECES[name]);
}

export function parseModel(buffer: ArrayBuffer, config: PieceConfig): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        try {
          resolve(preparePieceGeometry(gltf, config));
        } catch (err) {
          reject(err);
        }
      },
      reject,
    );
  });
}

/** The cached prepared geometry for a GLB at `url`, fetched on first use. Shared by pieces and the tile props. */
export function loadModelGeometry(url: string, config: PieceConfig): Promise<THREE.BufferGeometry> {
  let pending = geometries.get(url);
  if (!pending) {
    pending = new Promise<THREE.BufferGeometry>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          try {
            resolve(preparePieceGeometry(gltf, config));
          } catch (err) {
            reject(err);
          }
        },
        undefined,
        reject,
      );
    });
    // Forget a failed load so a later mount can retry instead of caching the error.
    pending.catch(() => geometries.delete(url));
    geometries.set(url, pending);
  }
  return pending;
}

/** The cached geometry for `name`, from `/models/<name>.glb`. */
export function loadPieceGeometry(name: PieceName): Promise<THREE.BufferGeometry> {
  return loadModelGeometry(`${MODEL_PATH}/${name}.glb`, PIECES[name]);
}

export function pieceMaterial({ color, roughness = 0.8, metalness = 0, ghost = false }: PieceMaterialOptions): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true, transparent: ghost, opacity: ghost ? 0.5 : 1, depthWrite: !ghost });
}

/** The export's baked texture on a flat-shaded standard material; `color` stays white so the texture shows true. */
export function texturedMaterial(map: THREE.Texture, { roughness = 0.8, metalness = 0, ghost = false }: PieceMaterialOptions): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map, color: "#ffffff", roughness, metalness, flatShading: true, transparent: ghost, opacity: ghost ? 0.5 : 1, depthWrite: !ghost });
}

/**
 * The material, or material array, matching a prepared geometry's draw
 * groups: one for a single piece; player / other for islands; base / middle /
 * top for height bands. "Other" is the baked texture when the export has one
 * and `neutral` when it does not. Without a geometry (tests, or before one
 * loads) the band layout is assumed.
 */
export function pieceMaterials(config: PieceConfig, options: PieceMaterialOptions, geometry?: THREE.BufferGeometry): THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] {
  const { colorMode, map } = geometry ? preparedData(geometry) : { colorMode: config.zones && !config.fullPlayerColor ? ("zones" as const) : ("single" as const), map: null };
  const other = () => (map ? texturedMaterial(map, options) : pieceMaterial({ ...options, color: options.neutral ?? options.color }));
  if (colorMode === "single") return map && !config.fullPlayerColor ? texturedMaterial(map, options) : pieceMaterial(options);
  if (colorMode === "islands") return [pieceMaterial(options), other()];
  return [pieceMaterial(options), other(), pieceMaterial(options)];
}

/** The mesh's quarter turn for an `axis: "x"` model: local X → Z. */
export function axisRotationY(config: PieceConfig): number {
  return config.axis === "x" ? -Math.PI / 2 : 0;
}

/**
 * Per-axis scale that fits the geometry's extents (after the axis turn) to
 * the config's world size, and the raw-space lift that puts its foot at y = 0.
 */
export function pieceFit(config: PieceConfig, geometry: THREE.BufferGeometry): { scale: THREE.Vector3; lift: number } {
  const box = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox!);
  const raw = box.getSize(new THREE.Vector3());
  // Once turned, the model's X extent presents on Z and its Z extent on X.
  const size = config.axis === "x" ? new THREE.Vector3(raw.z, raw.y, raw.x) : raw;
  const lift = -box.min.y;
  if ("width" in config.fit) return { scale: new THREE.Vector3(config.fit.width / size.x, config.fit.height / size.y, config.fit.length / size.z), lift };
  const s = "length" in config.fit ? config.fit.length / size.z : config.fit.height / size.y;
  return { scale: new THREE.Vector3(s, s, s), lift };
}

const logged = new Set<string>();

/** Report a model's fitted world size once per session. */
function logFit(name: string, group: THREE.Group): void {
  if (logged.has(name)) return;
  logged.add(name);
  group.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const fmt = (n: number) => n.toFixed(3);
  console.info(`[board3d] ${name}.glb world size: x ${fmt(size.x)} × y ${fmt(size.y)} × z ${fmt(size.z)}`);
}

/** Wrap a prepared geometry: mesh turned for its length axis and lifted so the foot is at the origin, group scaled to the piece's fit. */
export function assemblePiece(name: PieceName, geometry: THREE.BufferGeometry, options: PieceOptions): THREE.Group {
  return assembleModel(name, PIECES[name], geometry, options);
}

export function assembleModel(name: string, config: PieceConfig, geometry: THREE.BufferGeometry, options: PieceOptions): THREE.Group {
  const mesh = new THREE.Mesh(geometry, pieceMaterials(config, options, geometry));
  const { scale, lift } = pieceFit(config, geometry);
  mesh.position.y = lift;
  mesh.rotation.y = axisRotationY(config);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  mesh.name = `${name}-mesh`;
  const group = new THREE.Group();
  group.name = `${name}-glb`;
  group.scale.copy(scale);
  group.add(mesh);
  logFit(name, group);
  return group;
}

/** A fresh Group holding a Mesh of the cached geometry in flat-shaded standard materials coloured per `options`. */
export async function loadPiece(name: PieceName, options: PieceOptions): Promise<THREE.Group> {
  return assemblePiece(name, await loadPieceGeometry(name), options);
}

/** Dispose everything a `loadPiece` group owns except the shared geometry and its shared texture. */
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
 * geometry is cached) when the name or the material options change.
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
