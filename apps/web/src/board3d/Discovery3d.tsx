"use client";

/**
 * Face-down tiles on the diorama (docs/rules.md §17): a walnut tile back
 * with a gilt "?" lies on each hidden hex, the same for every tile so the
 * terrain underneath never shows. When a tile is turned over, its back
 * flips up and away over FLIP_MS while the real tile appears beneath.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { HexId } from "@katan/engine";
import { HEX_RADIUS, hexWorld } from "./layout3d";
import { LAND_HEIGHT } from "./slab";
import { faceDownTexture } from "./textures";

export const FLIP_MS = 900;
/** The back sits a little above the land slab and covers the recess and relief. */
const BACK_LIFT = 0.16;
const BACK_THICKNESS = 0.06;

function useBackGeometry(): THREE.BufferGeometry {
  const g = useMemo(() => {
    const shape = new THREE.Shape();
    for (let k = 0; k < 6; k++) {
      const a = ((30 + 60 * k) * Math.PI) / 180;
      const x = HEX_RADIUS * 0.97 * Math.cos(a);
      const y = HEX_RADIUS * 0.97 * Math.sin(a);
      if (k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: BACK_THICKNESS, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    // Planar UVs over the top face so the texture fills the hex.
    const pos = geo.attributes.position!;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / (2 * HEX_RADIUS) + 0.5;
      uv[i * 2 + 1] = -pos.getZ(i) / (2 * HEX_RADIUS) + 0.5;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return geo;
  }, []);
  useEffect(() => () => g.dispose(), [g]);
  return g;
}

function Back({ hex, geometry, material, flipping, shadows }: { hex: HexId; geometry: THREE.BufferGeometry; material: THREE.Material; flipping: number | null; shadows: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const c = hexWorld(hex);
  const base = LAND_HEIGHT + BACK_LIFT;
  useFrame(() => {
    const g = ref.current;
    if (!g || flipping === null) return;
    const t = Math.min(1, (performance.now() - flipping) / FLIP_MS);
    // Up, over and away: lift, turn half over about the x axis, shrink.
    g.position.y = base + Math.sin(t * Math.PI) * 0.9;
    g.rotation.x = t * Math.PI;
    const s = 1 - t * t * 0.9;
    g.scale.set(s, s, s);
  });
  return (
    <group ref={ref} position={[c.x, base, c.z]} name={`face-down:${hex}`}>
      <mesh geometry={geometry} material={material} castShadow={shadows} receiveShadow={shadows} />
    </group>
  );
}

/** Backs on every hidden hex, plus the ones still flipping away after a reveal. */
export function FaceDownTiles({ hidden, shadows }: { hidden: readonly HexId[]; shadows: boolean }) {
  const geometry = useBackGeometry();
  const material = useMemo(() => new THREE.MeshStandardMaterial({ map: faceDownTexture(), roughness: 0.7, metalness: 0.05 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const previous = useRef<readonly HexId[]>(hidden);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [flipping, setFlipping] = useState<Record<HexId, number>>({});

  useEffect(() => {
    const gone = previous.current.filter((h) => !hidden.includes(h));
    previous.current = hidden;
    if (gone.length === 0) return;
    const now = performance.now();
    setFlipping((f) => ({ ...f, ...Object.fromEntries(gone.map((h) => [h, now])) }));
    timers.current.push(setTimeout(() => setFlipping((f) => Object.fromEntries(Object.entries(f).filter(([h]) => !gone.includes(h)))), FLIP_MS + 50));
  }, [hidden]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <group name="face-down-tiles">
      {hidden.map((h) => (
        <Back key={h} hex={h} geometry={geometry} material={material} flipping={null} shadows={shadows} />
      ))}
      {Object.entries(flipping).map(([h, start]) => (
        <Back key={`flip:${h}`} hex={h} geometry={geometry} material={material} flipping={start} shadows={shadows} />
      ))}
    </group>
  );
}
