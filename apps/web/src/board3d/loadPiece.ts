/**
 * GLB figurines. Meshy exports (apps/web/public/models/<name>.glb) are a
 * single mesh pivoted at its centre with no normals and no material.
 * `loadPiece(name, options)` fetches one through GLTFLoader, caches the
 * prepared geometry by name (one download, one normal pass and one zone
 * split per piece for the whole session), and returns a fresh Group per
 * call: the mesh is lifted by the model's actual minimum Y so its foot sits
 * at the group's origin (never an assumed -0.5), and the group is scaled to
 * `PIECES[name].fit` in world units (hex edge = 1): uniformly to a height,
 * or per axis to explicit width (x), height (y) and length (z).
 *
 * A model whose length runs along its local X (`axis: "x"`) is turned a
 * quarter turn about Y inside the group so X maps to Z; every piece then
 * presents its length on Z and the road orientation logic applies.
 *
 * Colour comes from the caller so one helper serves every piece. A piece
 * with `zones` is split by vertex Y in the raw model space (before scale):
 * the base (y ≤ baseMaxY) and the top (y ≥ topMinY) take the caller's
 * `color`, the middle takes `neutral` (plaster, stone, wood, hull). Either
 * threshold may be omitted (a ship colours only its sail). A piece without
 * zones is one material in `color`.
 *
 * A zone set with `detail` splits the middle band again by which way each
 * triangle faces: level faces (|ny| > 0.85) are the cap (wall tops,
 * battlements, terraces), sloped faces (0.3 < |ny| ≤ 0.85) are the roof, and
 * the rest stay the wall. The city models are one grey mass otherwise; with
 * the roofs in the player's colour and the caps a lighter stone they read as
 * buildings, and whose they are, from the default camera.
 *
 * A failed fetch or parse rejects; `usePiece` turns that into `null` so the
 * caller can keep the procedural figure as a fallback.
 */

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EDGE_LENGTH } from "./layout3d";

export type PieceName = "robber" | "settlement" | "city" | "road" | "metropolis" | "metropolis_walled" | "city_walled" | "ship" | "barbarian_ship" | "pirate" | "merchant" | "knight_1" | "knight_2" | "knight_3" | "port_sign";

/** Y thresholds in the raw model's local space (before scaling). */
export interface PieceZones {
  /** Triangles at or below this are the base; omit for no base zone. */
  baseMaxY?: number;
  /** Triangles at or above this are the top; omit for no top zone. */
  topMinY?: number;
  /** Split the middle band by facing into wall, roof and cap (see the header). */
  detail?: boolean;
}

export interface PieceConfig {
  zones: PieceZones | null;
  /** The whole model in the caller's colour (roads). */
  fullPlayerColor?: boolean;
  /** The model's length runs along its local X; turn it so the length is on Z. */
  axis?: "x";
  /** World units: scale uniformly so the Y extent is `height`, or per axis so X, Y and Z extents are `width`, `height`, `length`. */
  fit: { height: number } | { width: number; height: number; length: number };
}

/**
 * The 2× the procedural figures are drawn at (docs/props.md §4), already
 * folded into the world sizes below. It was 1.5×, at which a settlement
 * (0.27 tall) stood lower than the cabin on the forest tile beside it and a
 * level-1 knight (0.26) vanished among the sheep; the terrain props are now
 * drawn at `PROP_SCALE` (0.72) as well, so the pieces are the biggest things
 * on the land.
 */
const FIGURE_SCALE = 2;
/**
 * The plain city's world height. Both upgrades stand taller than it, and the
 * walled models share one footprint so the wall ring reads the same size on a
 * walled city and a walled metropolis.
 */
export const CITY_HEIGHT = 0.31 * FIGURE_SCALE;
export const WALL_FOOTPRINT = 0.72;
const GREY = "#8a8f99";
const WOOD = "#8b6a45";
const NEAR_BLACK = "#1a1a1a";
const DARK_RED = "#7a2a2a";

/** Neutral colours the figures pass as `neutral` / `color`, kept next to the zones they colour. */
export const PIECE_COLORS = { grey: GREY, wood: WOOD, nearBlack: NEAR_BLACK, darkRed: DARK_RED, merchant: "#c9b58a" } as const;

export const PIECES: Record<PieceName, PieceConfig> = {
  // Base disc, cone body and the tip of the tilted hood cone: (0.27 + 0.05·cos(0.25)) × 2.
  robber: { zones: null, fit: { height: 0.28 * FIGURE_SCALE } },
  // Base ring to the crown of the thatched roof: (0.12 + 0.8·0.08) × 2.
  settlement: { zones: { baseMaxY: -0.34, topMinY: -0.11 }, fit: { height: 0.18 * FIGURE_SCALE } },
  // Base ring to the top of the keep's flag pole. Roofs and caps split out (`detail`).
  city: { zones: { baseMaxY: -0.41, topMinY: 0.27, detail: true }, fit: { height: CITY_HEIGHT } },
  // 0.8 long on local Z, 0.22 wide, 0.1 thick. Stops short of the vertices where settlements sit.
  road: { zones: null, fullPlayerColor: true, fit: { width: 0.22 * EDGE_LENGTH, height: 0.1 * EDGE_LENGTH, length: 0.8 * EDGE_LENGTH } },
  // Replaces the city at a metropolis vertex: taller than the plain city (CITY_HEIGHT), the crown is the top zone.
  metropolis: { zones: { baseMaxY: -0.42, topMinY: 0.38, detail: true }, fit: { width: 0.62, height: 0.78, length: 0.62 } },
  // Replaces the city when the vertex has a wall: the wall ring makes it wider (WALL_FOOTPRINT) and it stands taller than the plain city.
  city_walled: { zones: { baseMaxY: -0.32, topMinY: 0.2, detail: true }, fit: { width: WALL_FOOTPRINT, height: 0.68, length: WALL_FOOTPRINT } },
  // A metropolis that also has a wall: one model, the same wall footprint as `city_walled`, the tallest piece on the board.
  // Thresholds read off the model's own profile: the base disc sits below -0.42 (radius 0.45 against the wall's 0.39) and
  // the crown above 0.42, with no geometry at all between 0.34 and 0.42.
  metropolis_walled: { zones: { baseMaxY: -0.42, topMinY: 0.4, detail: true }, fit: { width: WALL_FOOTPRINT, height: 0.84, length: WALL_FOOTPRINT } },
  // Sea-edge piece, length on local X; only the sail takes the player colour, the hull bottom (raw Y -0.455) sits on the water.
  ship: { zones: { topMinY: 0.2 }, axis: "x", fit: { width: 0.26, height: 0.32, length: 0.76 } },
  // The fleet's longboat on the table track, length on local X: dark red sail over a near-black hull.
  barbarian_ship: { zones: { topMinY: 0.24 }, axis: "x", fit: { width: 0.3, height: 0.28, length: 0.65 } },
  // Sea hex centre, length on local X, laid along the hex's flat sides.
  pirate: { zones: { topMinY: 0.18 }, axis: "x", fit: { width: 0.42, height: 0.38, length: 0.38 } },
  // Hex centre like the robber, lifted by its own min Y (-0.436). Green base disc and hat over a warm tan coat,
  // so the figure reads as the merchant (docs/props.md §5) rather than a lump of the tile's colour.
  merchant: { zones: { baseMaxY: -0.39, topMinY: 0.3 }, fit: { width: 0.36, height: 0.36, length: 0.36 } },
  // Vertex pieces; the level is which model loads. Base and top in the player colour, body grey.
  // A knight stands with the settlement (0.36): at the old 0.26 it was the smallest thing on the land.
  knight_1: { zones: { baseMaxY: -0.42, topMinY: 0.1 }, fit: { width: 0.28, height: 0.4, length: 0.28 } },
  knight_2: { zones: { baseMaxY: -0.33, topMinY: 0.22 }, fit: { width: 0.31, height: 0.44, length: 0.31 } },
  knight_3: { zones: { baseMaxY: -0.38, topMinY: 0.19 }, fit: { width: 0.35, height: 0.48, length: 0.35 } },
  // At each port's edge midpoint on the sea side, facing the land hex.
  port_sign: { zones: null, fit: { width: 0.3, height: 0.36, length: 0.28 } },
};

/** Material slot order for a zoned piece; a `detail` piece adds the roof and cap slots. */
export const ZONE_BASE = 0;
export const ZONE_MIDDLE = 1;
export const ZONE_TOP = 2;
export const ZONE_ROOF = 3;
export const ZONE_CAP = 4;
/** Facing thresholds for the `detail` split: |ny| above the first is a cap, above the second a roof. */
export const CAP_NY = 0.85;
export const ROOF_NY = 0.3;

export function zoneCount(zones: PieceZones): number {
  return zones.detail ? 5 : 3;
}

export const MODEL_PATH = "/models";

export interface PieceMaterialOptions {
  /** The piece's colour: the player's for pieces, the sail's for ships, near-black for the robber. */
  color: string;
  /** The middle zone's colour on a zoned piece (walls, stone, wood, hull); defaults to `color`. */
  neutral?: string;
  /** `detail` pieces: the sloped faces; defaults to `neutral`. */
  roof?: string;
  /** `detail` pieces: the level faces of the middle band; defaults to `neutral`. */
  cap?: string;
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

/** Which zone a triangle belongs to, by the Y of its centroid in raw model space and, on a `detail` piece, its normal's Y. */
export function zoneOf(y: number, zones: PieceZones, ny = 0): number {
  if (zones.baseMaxY !== undefined && y <= zones.baseMaxY) return ZONE_BASE;
  if (zones.topMinY !== undefined && y >= zones.topMinY) return ZONE_TOP;
  if (zones.detail) {
    const k = Math.abs(ny);
    if (k > CAP_NY) return ZONE_CAP;
    if (k > ROOF_NY) return ZONE_ROOF;
  }
  return ZONE_MIDDLE;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** The Y component of triangle `t`'s unit normal (0 for a degenerate triangle). */
function triangleNormalY(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, t: number): number {
  _a.fromBufferAttribute(pos, t * 3);
  _b.fromBufferAttribute(pos, t * 3 + 1);
  _c.fromBufferAttribute(pos, t * 3 + 2);
  _b.sub(_a);
  _c.sub(_a);
  _b.cross(_c);
  const len = _b.length();
  return len === 0 ? 0 : _b.y / len;
}

/**
 * Reorder a non-indexed geometry's triangles into base / middle / top (and,
 * with `detail`, roof / cap) runs and register one draw group per zone, so a
 * material array colours them apart.
 */
export function splitZones(geometry: THREE.BufferGeometry, zones: PieceZones): THREE.BufferGeometry {
  const pos = geometry.getAttribute("position");
  const tris = pos.count / 3;
  const zonesTotal = zoneCount(zones);
  const buckets: number[][] = Array.from({ length: zonesTotal }, () => []);
  for (let t = 0; t < tris; t++) {
    const y = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3;
    buckets[zoneOf(y, zones, zones.detail ? triangleNormalY(pos, t) : 0)]!.push(t);
  }
  const out = new Float32Array(pos.count * 3);
  const src = pos.array as ArrayLike<number>;
  let cursor = 0;
  const result = new THREE.BufferGeometry();
  for (let zone = 0; zone < zonesTotal; zone++) {
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
export function prepareGeometry(raw: THREE.BufferGeometry, config: PieceConfig, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  let geometry = raw.clone();
  if (matrix) geometry.applyMatrix4(matrix);
  for (const name of Object.keys(geometry.attributes)) if (name !== "position") geometry.deleteAttribute(name);
  // Non-indexed: one vertex per corner, so normals are per face (flat) and triangles can be regrouped.
  if (geometry.index) geometry = geometry.toNonIndexed();
  if (config.zones) geometry = splitZones(geometry, config.zones);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export function preparePieceGeometry(gltf: GLTF, config: PieceConfig): THREE.BufferGeometry {
  const mesh = firstMesh(gltf);
  mesh.updateWorldMatrix(true, false);
  return prepareGeometry(mesh.geometry, config, mesh.matrixWorld);
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

/** One material for an unzoned piece; base / middle / top for a zoned one, plus roof / cap for a `detail` one. */
export function pieceMaterials(config: PieceConfig, options: PieceMaterialOptions): THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] {
  if (!config.zones || config.fullPlayerColor) return pieceMaterial(options);
  const player = pieceMaterial(options);
  const neutral = options.neutral ?? options.color;
  const middle = pieceMaterial({ ...options, color: neutral });
  if (!config.zones.detail) return [player, middle, player.clone()];
  return [player, middle, player.clone(), pieceMaterial({ ...options, color: options.roof ?? neutral }), pieceMaterial({ ...options, color: options.cap ?? neutral })];
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
  const s = config.fit.height / size.y;
  return { scale: new THREE.Vector3(s, s, s), lift };
}

const logged = new Set<PieceName>();

/** Report a piece's fitted world size once per session. */
function logFit(name: PieceName, group: THREE.Group): void {
  if (logged.has(name)) return;
  logged.add(name);
  group.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const fmt = (n: number) => n.toFixed(3);
  console.info(`[board3d] ${name}.glb world size: x ${fmt(size.x)} × y ${fmt(size.y)} × z ${fmt(size.z)}`);
}

/** Wrap a prepared geometry: mesh turned for its length axis and lifted so the foot is at the origin, group scaled to the piece's fit. */
export function assemblePiece(name: PieceName, geometry: THREE.BufferGeometry, options: PieceOptions): THREE.Group {
  const config = PIECES[name];
  const mesh = new THREE.Mesh(geometry, pieceMaterials(config, options));
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
 * geometry is cached) when the name or the material options change.
 */
export function usePiece(name: PieceName, options: PieceOptions): THREE.Group | null {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const { color, neutral = color, roof = neutral, cap = neutral, roughness = 0.8, metalness = 0, ghost = false, castShadow = false, receiveShadow = false } = options;
  useEffect(() => {
    let live = true;
    let built: THREE.Group | null = null;
    loadPiece(name, { color, neutral, roof, cap, roughness, metalness, ghost, castShadow, receiveShadow })
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
  }, [name, color, neutral, roof, cap, roughness, metalness, ghost, castShadow, receiveShadow]);
  return group;
}
