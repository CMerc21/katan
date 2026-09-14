/**
 * Fitting the key light's shadow camera to the board (docs/phase7-5.md §6).
 *
 * A directional light shadows through an orthographic camera looking from the
 * light toward its target. Sized by a padded bounding radius it wastes most of
 * its texels on empty table; fitted to the board's real extents every texel
 * lands on a tile, which is what makes a 2048 map worth having.
 *
 * `fitShadowCamera` is pure: it takes the board's world extents, the light's
 * position and target, and the tallest thing standing on a tile, and returns
 * the orthographic bounds in the light's own view space — the eight corners of
 * the board's bounding box projected onto the light's right and up axes.
 */

export interface ShadowBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface ShadowFrustum {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
}

/** The tallest piece standing on a tile (the walled metropolis, 0.70) plus headroom for the robber's hop. */
export const MAX_PIECE_HEIGHT = 1.2;
/** A half-texel of slack so a tile at the very edge is not clipped by rounding. */
export const SHADOW_PADDING = 0.05;

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/**
 * The orthographic bounds that exactly contain the board's bounding box as the
 * light sees it. `height` is how far above the slab plane anything reaches.
 */
export function fitShadowCamera(box: ShadowBox, light: Vec3, target: Vec3, height = MAX_PIECE_HEIGHT, padding = SHADOW_PADDING): ShadowFrustum {
  // The light's view basis: forward toward the target, right and up across it.
  const forward = norm(sub(target, light));
  const worldUp: Vec3 = Math.abs(forward.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = norm(cross(forward, worldUp));
  const up = norm(cross(right, forward));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minD = Infinity;
  let maxD = -Infinity;
  for (const x of [box.minX, box.maxX]) {
    for (const z of [box.minZ, box.maxZ]) {
      for (const y of [0, height]) {
        const v = sub({ x, y, z }, light);
        const px = dot(v, right);
        const py = dot(v, up);
        const pd = dot(v, forward);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (pd < minD) minD = pd;
        if (pd > maxD) maxD = pd;
      }
    }
  }
  return {
    left: minX - padding,
    right: maxX + padding,
    bottom: minY - padding,
    top: maxY + padding,
    // Never start the frustum behind the light.
    near: Math.max(0.1, minD - padding),
    far: maxD + padding,
  };
}

/** One line naming the fitted frustum and the board it was fitted to. */
export function describeShadowFit(box: ShadowBox, f: ShadowFrustum): string {
  const n = (v: number) => v.toFixed(3);
  return `[board3d] shadow camera fitted: left ${n(f.left)} right ${n(f.right)} top ${n(f.top)} bottom ${n(f.bottom)} near ${n(f.near)} far ${n(f.far)} | board extents x ${n(box.minX)}..${n(box.maxX)} (${n(box.maxX - box.minX)} wide) z ${n(box.minZ)}..${n(box.maxZ)} (${n(box.maxZ - box.minZ)} deep)`;
}
