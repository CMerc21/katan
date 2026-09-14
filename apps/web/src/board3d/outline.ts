/**
 * Inverted-hull outlines for the figurines and the tile props.
 *
 * A second copy of the mesh is drawn with `side: BackSide` and its vertices
 * pushed out along their normals, so only the silhouette survives in front of
 * the real mesh. The push is a **fixed world-space offset**, not a scale: a
 * 1.03 hull is proportional, so a road gets a hairline and a metropolis gets a
 * slab, and at this camera distance the thin end vanishes. Offsetting in view
 * space instead gives every piece the same weight of line whatever its size.
 *
 * The offset is applied in `onBeforeCompile` because `MeshBasicMaterial` only
 * compiles the normal chunks under an env map or skinning, so the shader has
 * no view-space normal of its own: we build one from the `normal` attribute
 * (folding in `instanceMatrix` for instanced props) and add along it after the
 * model-view transform, where one unit is one world unit.
 *
 * Tiles are deliberately left alone — an outline on every slab reads as a grid
 * and fights the board.
 */

import * as THREE from "three";

/** How far the hull stands off the mesh, in world units. */
export const OUTLINE_OFFSET = 0.008;
export const OUTLINE_COLOR = "#2a2320";

const PROJECT = `
  vec3 outlineNormal = normal;
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mat3 im = mat3( instanceMatrix );
    outlineNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
    outlineNormal = im * outlineNormal;
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  // normalMatrix is the inverse transpose of the model-view basis, so this is a
  // unit normal in view space; the view transform is rigid, so adding along it
  // moves the vertex by exactly OUTLINE_OFFSET world units at any object scale.
  mvPosition.xyz += normalize( normalMatrix * outlineNormal ) * OUTLINE_OFFSET;
  gl_Position = projectionMatrix * mvPosition;
`;

/**
 * The hull material. `depthWrite: false` keeps it out of the depth buffer so it
 * never occludes anything; `BackSide` means only the far faces draw, which the
 * real mesh then covers except at the silhouette.
 */
export function outlineMaterial(offset = OUTLINE_OFFSET, color = OUTLINE_COLOR): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", PROJECT.replace(/OUTLINE_OFFSET/g, offset.toFixed(5)));
  };
  // Materials with different shader edits must not share a compiled program.
  material.customProgramCacheKey = () => `katan-outline:${offset}`;
  return material;
}

/** The hull for one mesh: same geometry, drawn just before it. */
export function outlineMesh(geometry: THREE.BufferGeometry, offset?: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, outlineMaterial(offset));
  mesh.name = "outline";
  // Never casts or receives: it is a silhouette, not a solid.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Dispose an outline's material (its geometry is shared with the mesh it wraps). */
export function disposeOutline(object: THREE.Object3D): void {
  object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name === "outline") (m.material as THREE.Material).dispose();
  });
}
