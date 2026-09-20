"use client";

/**
 * Harbours (docs/props.md §5): two posts and a plank pier reaching 0.35 R
 * over the water from the coast edge, a tall post with a gallows-style
 * crossbar at the landward end, and a small sign hanging from the crossbar
 * with the ratio and resource (readable from both sides). The signpost GLB
 * (port_sign.glb, wood) stands at the pier's seaward end facing the land
 * hex.
 *
 * The identifier the table reads is the port disc: a number-token-sized
 * disc on the sea `PORT_DISC_OUT` R beyond the pier, its face in the
 * resource's colour with the ratio large, turned to face the camera like
 * the number tokens, and a run of plank dashes from the disc to each of the
 * port's two vertices, so which corners the port serves is drawn on the
 * water the way a board prints it. The pier and the hanging sign were the
 * only markers before, and at the table view a pier is a sliver.
 */

import { useMemo } from "react";
import * as THREE from "three";
import type { Port } from "@katan/engine";
import { LABEL_TURN } from "./Camera";
import { SEA_HEIGHT, SLAB_HEIGHT, edgeWorld, outwardWorld, vertexWorld, type World } from "./layout3d";
import { PIECE_COLORS, usePiece } from "./loadPiece";
import * as P from "./palette";
import { portTokenTexture, signTexture } from "./textures";

/** The disc's centre lies this far out to sea from the coast edge's midpoint (the pier ends at 0.33). */
export const PORT_DISC_OUT = 0.62;
export const PORT_DISC_RADIUS = 0.24;
const DISC_HEIGHT = 0.05;
/** Dashes run from each port vertex toward the disc, over this share of the way (the rest is the disc and the coast). */
const DASH_FROM = 0.28;
const DASH_TO = 0.72;
const DASHES = 3;

/** The port disc and its dashes, in world space (the pier's group is turned to the edge; the disc must face the camera). */
function PortDisc({ port, at, owned, shadows }: { port: Port; at: World; owned: boolean; shadows: boolean }) {
  const texture = useMemo(() => portTokenTexture(port.kind), [port.kind]);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: P.TIMBER, roughness: 0.9, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
    return [side, top, side];
  }, [texture]);
  const y = SEA_HEIGHT + 0.01;
  return (
    <group name={`port-disc:${port.edge}`}>
      <group position={[at.x, y, at.z]} rotation={[0, LABEL_TURN, 0]}>
        <mesh material={materials} position={[0, DISC_HEIGHT / 2, 0]} castShadow={shadows}>
          <cylinderGeometry args={[PORT_DISC_RADIUS, PORT_DISC_RADIUS, DISC_HEIGHT, 28]} />
        </mesh>
        {owned && (
          <mesh position={[0, DISC_HEIGHT + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[PORT_DISC_RADIUS - 0.03, PORT_DISC_RADIUS, 28]} />
            <meshBasicMaterial color="#c9a227" />
          </mesh>
        )}
      </group>
      {port.vertices.map((v) => {
        const p = vertexWorld(v);
        const dx = at.x - p.x;
        const dz = at.z - p.z;
        const heading = Math.atan2(dx, dz);
        return Array.from({ length: DASHES }, (_, i) => {
          const k = DASH_FROM + ((DASH_TO - DASH_FROM) * (i + 0.5)) / DASHES;
          return (
            <mesh key={`${v}:${i}`} position={[p.x + dx * k, y + 0.012, p.z + dz * k]} rotation={[0, heading, 0]}>
              <boxGeometry args={[0.06, 0.024, 0.13]} />
              <meshStandardMaterial color={P.TIMBER} roughness={0.9} flatShading />
            </mesh>
          );
        });
      })}
    </group>
  );
}

export function Harbor({ port, centre, owned, shadows, land }: { port: Port; centre: World; owned: boolean; shadows: boolean; land: ReadonlySet<string> }) {
  const { mid } = edgeWorld(port.edge);
  const out = outwardWorld(port.edge, centre, land);
  const angle = Math.atan2(out.z, out.x);
  const texture = useMemo(() => signTexture(port.kind), [port.kind]);
  const deck = SLAB_HEIGHT - 0.01;
  const sign = usePiece("port_sign", { color: PIECE_COLORS.wood, castShadow: shadows, receiveShadow: shadows });
  const disc = useMemo<World>(() => ({ x: mid.x + out.x * PORT_DISC_OUT, z: mid.z + out.z * PORT_DISC_OUT }), [mid.x, mid.z, out.x, out.z]);
  return (
    <>
    <PortDisc port={port} at={disc} owned={owned} shadows={shadows} />
    <group position={[mid.x, 0, mid.z]} rotation={[0, -angle, 0]} name={`harbor:${port.edge}`}>
      {/* The group's +X points out to sea; the signpost stands on the pier's far end and turns its face (the model's +Z) back toward the land hex. */}
      {sign && (
        <group position={[0.3, deck + 0.0125, 0.16]} rotation={[0, -Math.PI / 2, 0]} name="port-sign">
          <primitive object={sign} />
        </group>
      )}
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
    </>
  );
}
