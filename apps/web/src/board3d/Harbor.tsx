"use client";

/**
 * Harbours (docs/phase7-5.md §1): a short wooden pier off the coast edge and
 * a hanging sign showing the ratio and resource.
 */

import { Billboard } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Port } from "@katan/engine";
import { SLAB_HEIGHT, edgeWorld, outwardWorld, type World } from "./layout3d";
import { signTexture } from "./textures";

const TIMBER = "#8a6a44";
const POST = "#5a3a22";

export function Harbor({ port, centre, owned, shadows }: { port: Port; centre: World; owned: boolean; shadows: boolean }) {
  const { mid } = edgeWorld(port.edge);
  const out = outwardWorld(port.edge, centre);
  const angle = Math.atan2(out.z, out.x);
  const texture = useMemo(() => signTexture(port.kind), [port.kind]);
  return (
    <group position={[mid.x, 0, mid.z]} rotation={[0, -angle, 0]} name={`harbor:${port.edge}`}>
      {/* pier planks running outward from the coast */}
      {[0.12, 0.3, 0.48].map((x) => (
        <mesh key={x} position={[x, SLAB_HEIGHT * 0.55, 0]} castShadow={shadows}>
          <boxGeometry args={[0.16, 0.03, 0.34]} />
          <meshStandardMaterial color={TIMBER} flatShading />
        </mesh>
      ))}
      {[0.12, 0.48].flatMap((x) =>
        [-0.14, 0.14].map((z) => (
          <mesh key={`${x}${z}`} position={[x, SLAB_HEIGHT * 0.2, z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.22, 5]} />
            <meshStandardMaterial color={POST} />
          </mesh>
        )),
      )}
      {/* sign post and hanging sign */}
      <mesh position={[0.62, 0.32, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.64, 5]} />
        <meshStandardMaterial color={POST} />
      </mesh>
      <Billboard position={[0.62, 0.52, 0]} follow>
        <mesh>
          <planeGeometry args={[0.42, 0.26]} />
          <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
        </mesh>
        {owned && (
          <mesh position={[0, -0.17, 0]}>
            <planeGeometry args={[0.3, 0.03]} />
            <meshBasicMaterial color="#c9a227" side={THREE.DoubleSide} />
          </mesh>
        )}
      </Billboard>
    </group>
  );
}
