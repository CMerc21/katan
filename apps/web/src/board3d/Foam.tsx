"use client";

/**
 * Foam where the land meets open sea (docs/props.md §3). The sea and the land
 * are separate slabs that simply butt together, which read as a hard colour
 * change; a band of broken white along the shoreline is what makes the coast
 * look like water meeting a shore rather than two tiles abutting.
 *
 * One instanced strip per shoreline edge, in three seeded variants so a long
 * coast does not repeat. The strip is symmetric across the edge line and is
 * nudged seaward: the half that falls behind the edge sits inside the land
 * slab, which is taller than the sea, so it is hidden. That symmetry is
 * deliberate — it makes the strip look the same whichever way the edge is
 * wound, so the geometry needs no per-edge orientation test.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { EdgeId, HexId } from "@katan/engine";
import { FOAM } from "./palette";
import { SEA_HEIGHT, edgeWorld, outwardWorld, shorelineEdges, type World } from "./layout3d";

export const FOAM_VARIANTS = 3;
/** Total width of the band across the edge; about half of it shows. */
export const FOAM_WIDTH = 0.15;
/** How far the band is pushed seaward, so its inner half hides in the land slab. */
export const FOAM_OFFSET = FOAM_WIDTH * 0.42;
const SEGMENTS = 7;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A wavy band along local X, symmetric about z = 0, flat at y = 0. */
export function buildFoamStrip(variant: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = FOAM_WIDTH / 2;
  const widthAt = (i: number) => half * (0.45 + 0.55 * hash(variant * 977 + i * 31));
  for (let i = 0; i < SEGMENTS; i++) {
    const x0 = -0.5 + i / SEGMENTS;
    const x1 = -0.5 + (i + 1) / SEGMENTS;
    const w0 = widthAt(i);
    const w1 = widthAt(i + 1);
    // Two triangles per segment. The winding matters: with the two far
    // vertices the other way round the face normals come out pointing down
    // and every strip is backface-culled from the only angle anyone sees it.
    positions.push(x0, 0, -w0, x1, 0, w1, x1, 0, -w1);
    positions.push(x0, 0, -w0, x0, 0, w0, x1, 0, w1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function variantOf(edge: EdgeId): number {
  let h = 0;
  for (let i = 0; i < edge.length; i++) h = (Math.imul(h, 31) + edge.charCodeAt(i)) | 0;
  return ((h % FOAM_VARIANTS) + FOAM_VARIANTS) % FOAM_VARIANTS;
}

function FoamVariant({ edges, variant, centre, land }: { edges: readonly EdgeId[]; variant: number; centre: World; land: ReadonlySet<HexId> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => buildFoamStrip(variant), [variant]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(FOAM), flatShading: true, roughness: 0.75 }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    edges.forEach((e, i) => {
      const { mid, angle } = edgeWorld(e);
      const out = outwardWorld(e, centre, land);
      dummy.position.set(mid.x + out.x * FOAM_OFFSET, SEA_HEIGHT + 0.006, mid.z + out.z * FOAM_OFFSET);
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [edges, centre, land, dummy]);

  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, edges.length)]} frustumCulled={false} />;
}

export function Foam({ land, sea, centre }: { land: ReadonlySet<HexId>; sea: ReadonlySet<HexId>; centre: World }) {
  const byVariant = useMemo(() => {
    const groups: EdgeId[][] = Array.from({ length: FOAM_VARIANTS }, () => []);
    for (const e of shorelineEdges(land, sea)) groups[variantOf(e)]!.push(e);
    return groups;
  }, [land, sea]);

  return (
    <group name="foam">
      {byVariant.map((edges, v) => (edges.length > 0 ? <FoamVariant key={v} edges={edges} variant={v} centre={centre} land={land} /> : null))}
    </group>
  );
}
