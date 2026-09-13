"use client";

/**
 * Harbours (docs/props.md §5): two posts and a plank pier reaching 0.35 R
 * over the water from the coast edge, a tall post with a gallows-style
 * crossbar at the landward end, and a small sign hanging from the crossbar
 * with the ratio and resource (readable from both sides).
 */

import { useMemo } from "react";
import * as THREE from "three";
import type { Port } from "@katan/engine";
import { SEA_HEIGHT, SLAB_HEIGHT, edgeWorld, outwardWorld, type World } from "./layout3d";
import * as P from "./palette";
import { signTexture } from "./textures";

export function Harbor({ port, centre, owned, shadows, land }: { port: Port; centre: World; owned: boolean; shadows: boolean; land: ReadonlySet<string> }) {
  const { mid } = edgeWorld(port.edge);
  const out = outwardWorld(port.edge, centre, land);
  const angle = Math.atan2(out.z, out.x);
  const texture = useMemo(() => signTexture(port.kind), [port.kind]);
  const deck = SLAB_HEIGHT - 0.01;
  return (
    <group position={[mid.x, 0, mid.z]} rotation={[0, -angle, 0]} name={`harbor:${port.edge}`}>
      {/* Planks running outward from the coast, 0.35 R over the water. */}
      {[0.05, 0.13, 0.21, 0.29].map((x) => (
        <mesh key={x} position={[x, deck, 0]} castShadow={shadows}>
          <boxGeometry args={[0.07, 0.025, 0.26]} />
          <meshStandardMaterial color={P.TIMBER} flatShading />
        </mesh>
      ))}
      {[-0.1, 0.1].map((z) => (
        <mesh key={z} position={[0.31, (SEA_HEIGHT - 0.06 + deck) / 2, z]}>
          <cylinderGeometry args={[0.018, 0.018, deck - SEA_HEIGHT + 0.08, 6]} />
          <meshStandardMaterial color={P.TRUNK} flatShading />
        </mesh>
      ))}
      {/* Gallows post at the landward end with a crossbar reaching over the pier. */}
      <mesh position={[-0.02, SLAB_HEIGHT + 0.24, -0.11]} castShadow={shadows}>
        <cylinderGeometry args={[0.016, 0.018, 0.5, 6]} />
        <meshStandardMaterial color={P.TRUNK} flatShading />
      </mesh>
      <mesh position={[-0.02, SLAB_HEIGHT + 0.48, 0]}>
        <boxGeometry args={[0.03, 0.025, 0.26]} />
        <meshStandardMaterial color={P.TRUNK} flatShading />
      </mesh>
      <mesh position={[-0.02, SLAB_HEIGHT + 0.43, -0.05]} rotation={[Math.PI / 4, 0, 0]}>
        <boxGeometry args={[0.02, 0.02, 0.11]} />
        <meshStandardMaterial color={P.TRUNK} flatShading />
      </mesh>
      {/* The sign hangs from the crossbar's far end, facing along the coast. */}
      <group position={[-0.02, SLAB_HEIGHT + 0.36, 0.09]}>
        {[-0.03, 0.03].map((z) => (
          <mesh key={z} position={[0, 0.09, z]}>
            <cylinderGeometry args={[0.003, 0.003, 0.06, 4]} />
            <meshStandardMaterial color={P.DARK} />
          </mesh>
        ))}
        <mesh position={[0.003, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.17, 0.115]} />
          <meshBasicMaterial map={texture} side={THREE.FrontSide} />
        </mesh>
        <mesh position={[-0.003, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[0.17, 0.115]} />
          <meshBasicMaterial map={texture} side={THREE.FrontSide} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.004, 0.115, 0.17]} />
          <meshStandardMaterial color={P.TIMBER} />
        </mesh>
        {owned && (
          <mesh position={[0, -0.075, 0]}>
            <boxGeometry args={[0.012, 0.014, 0.16]} />
            <meshBasicMaterial color="#c9a227" />
          </mesh>
        )}
      </group>
    </group>
  );
}
