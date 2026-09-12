"use client";

/**
 * Event animations in the scene (docs/phase7-5.md §6): scripted dice
 * tumbling into a tray at the near edge, the robber hopping in a parabola
 * with squash-and-stretch, and the projector that turns world points into
 * screen coordinates for the DOM flights and target buttons.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HexId } from "@katan/engine";
import { LEATHER } from "@/game/theme";
import { easeInOut, easeOutCubic } from "./geo";
import { SLAB_HEIGHT, hexWorld, type Bounds, type World } from "./layout3d";
import { PirateFigure, RobberFigure, pirateOffset, robberOffset } from "./Pieces";
import { dieFaceTexture } from "./textures";

// ---------------------------------------------------------------------------
// Robber

export function AnimatedRobber({ hex, shadows }: { hex: HexId; shadows: boolean }) {
  const group = useRef<THREE.Group>(null);
  const from = useRef<World | null>(null);
  const to = useRef<HexId>(hex);
  const start = useRef(0);
  const o = robberOffset();
  const dest = (h: HexId): World => {
    const c = hexWorld(h);
    return { x: c.x + o.dx, z: c.z + o.dz };
  };
  useEffect(() => {
    if (to.current !== hex) {
      from.current = dest(to.current);
      to.current = hex;
      start.current = performance.now();
    }
  }, [hex]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const end = dest(to.current);
    const f = from.current;
    if (!f) {
      g.position.set(end.x, SLAB_HEIGHT, end.z);
      return;
    }
    const t = Math.min(1, (performance.now() - start.current) / 450);
    const k = easeInOut(t);
    const arc = Math.sin(t * Math.PI) * 0.6;
    g.position.set(f.x + (end.x - f.x) * k, SLAB_HEIGHT + arc, f.z + (end.z - f.z) * k);
    // Squash on take-off and landing, stretch mid-air.
    const stretch = 1 + Math.sin(t * Math.PI) * 0.25;
    g.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    if (t >= 1) {
      from.current = null;
      g.scale.set(1, 1, 1);
    }
  });
  return (
    <group ref={group}>
      <RobberFigure shadows={shadows} />
    </group>
  );
}

/** The pirate sails between sea hexes (docs/phase9.md §8): same hop as the robber, lower arc. */
export function AnimatedPirate({ hex, shadows }: { hex: HexId; shadows: boolean }) {
  const group = useRef<THREE.Group>(null);
  const from = useRef<World | null>(null);
  const to = useRef<HexId>(hex);
  const start = useRef(0);
  const o = pirateOffset();
  const dest = (h: HexId): World => {
    const c = hexWorld(h);
    return { x: c.x + o.dx, z: c.z + o.dz };
  };
  useEffect(() => {
    if (to.current !== hex) {
      from.current = dest(to.current);
      to.current = hex;
      start.current = performance.now();
    }
  }, [hex]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const end = dest(to.current);
    const f = from.current;
    if (!f) {
      g.position.set(end.x, SLAB_HEIGHT, end.z);
      return;
    }
    const t = Math.min(1, (performance.now() - start.current) / 450);
    const k = easeInOut(t);
    const arc = Math.sin(t * Math.PI) * 0.25;
    g.position.set(f.x + (end.x - f.x) * k, SLAB_HEIGHT + arc, f.z + (end.z - f.z) * k);
    // Squash on take-off and landing, stretch mid-air.
    const stretch = 1 + Math.sin(t * Math.PI) * 0.25;
    g.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    if (t >= 1) {
      from.current = null;
      g.scale.set(1, 1, 1);
    }
  });
  return (
    <group ref={group}>
      <PirateFigure shadows={shadows} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Dice

/** Rotation that brings face `n` up, given the material order [+x:3, -x:4, +y:1, -y:6, +z:2, -z:5]. */
export function faceUpQuaternion(n: number, yaw: number): THREE.Quaternion {
  const e = new THREE.Euler();
  switch (n) {
    case 1:
      e.set(0, 0, 0);
      break;
    case 6:
      e.set(Math.PI, 0, 0);
      break;
    case 2:
      e.set(-Math.PI / 2, 0, 0);
      break;
    case 5:
      e.set(Math.PI / 2, 0, 0);
      break;
    case 3:
      e.set(0, 0, Math.PI / 2);
      break;
    default:
      e.set(0, 0, -Math.PI / 2);
      break;
  }
  const q = new THREE.Quaternion().setFromEuler(e);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(q);
}

/** Verify a quaternion puts the wanted face up (used by tests and as a self-check). */
export function faceUp(q: THREE.Quaternion): number {
  const normals: [number, THREE.Vector3][] = [
    [3, new THREE.Vector3(1, 0, 0)],
    [4, new THREE.Vector3(-1, 0, 0)],
    [1, new THREE.Vector3(0, 1, 0)],
    [6, new THREE.Vector3(0, -1, 0)],
    [2, new THREE.Vector3(0, 0, 1)],
    [5, new THREE.Vector3(0, 0, -1)],
  ];
  let best = 1;
  let bestY = -Infinity;
  for (const [n, v] of normals) {
    const y = v.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = n;
    }
  }
  return best;
}

function Die({ index, value, rollKey, rest }: { index: number; value: number; rollKey: number | null; rest: THREE.Vector3 }) {
  const mesh = useRef<THREE.Mesh>(null);
  const materials = useMemo(() => [3, 4, 1, 6, 2, 5].map((n) => new THREE.MeshStandardMaterial({ map: dieFaceTexture(n), roughness: 0.6 })), []);
  const lastKey = useRef<number | null>(null);
  const start = useRef(0);
  const finalQ = useMemo(() => faceUpQuaternion(value, ((rollKey ?? 0) * 0.7 + index * 1.3) % (Math.PI * 2)), [value, rollKey, index]);
  const spinAxis = useMemo(() => new THREE.Vector3(1, 0.4 + index * 0.3, 0.6).normalize(), [index]);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    if (rollKey !== null && rollKey !== lastKey.current) {
      lastKey.current = rollKey;
      start.current = now + index * 120;
    }
    const t = rollKey === null ? 1 : Math.min(1, Math.max(0, (now - start.current) / 800));
    const k = easeOutCubic(t);
    const spin = new THREE.Quaternion().setFromAxisAngle(spinAxis, (1 - k) * (1 - k) * Math.PI * 5);
    m.quaternion.copy(spin.multiply(finalQ));
    m.position.set(rest.x - (1 - k) * 0.9 * (index === 0 ? 1 : -0.6), rest.y + Math.sin(k * Math.PI) * 0.7 * (1 - k) + 0.16, rest.z - (1 - k) * 1.2);
  });
  return (
    <mesh ref={mesh} material={materials} position={[rest.x, rest.y + 0.16, rest.z]} castShadow>
      <boxGeometry args={[0.32, 0.32, 0.32]} />
    </mesh>
  );
}

export function DiceTray3D({ bounds, dice, rollKey, shadows }: { bounds: Bounds; dice: [number, number] | null; rollKey: number | null; shadows: boolean }) {
  const x = bounds.cx - 0.9;
  const z = bounds.maxZ + 1.35;
  if (!dice) return null;
  return (
    <group name="dice-tray">
      <mesh position={[x, 0.04, z]} receiveShadow={shadows}>
        <boxGeometry args={[1.5, 0.08, 0.9]} />
        <meshStandardMaterial color={LEATHER} roughness={0.95} />
      </mesh>
      {[
        [-0.75, 0],
        [0.75, 0],
        [0, -0.45],
        [0, 0.45],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[x + dx!, 0.1, z + dz!]}>
          <boxGeometry args={[dx === 0 ? 1.5 : 0.06, 0.12, dz === 0 ? 0.9 : 0.06]} />
          <meshStandardMaterial color="#2e1c10" />
        </mesh>
      ))}
      <Die index={0} value={dice[0]} rollKey={rollKey} rest={new THREE.Vector3(x - 0.3, 0.08, z)} />
      <Die index={1} value={dice[1]} rollKey={rollKey} rest={new THREE.Vector3(x + 0.3, 0.08, z + 0.05)} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Projector: keeps the latest camera for synchronous world → screen projection
// (overlay buttons update in the same render as the legal targets) and bumps a
// version whenever the camera or canvas size changes.

export interface CameraSnapshot {
  readonly camera: THREE.Camera;
  readonly width: number;
  readonly height: number;
  readonly rect: DOMRect;
}

export function projectWorld(snap: CameraSnapshot, world: World, y: number, v = new THREE.Vector3()): { x: number; y: number; visible: boolean } {
  v.set(world.x, y, world.z).project(snap.camera);
  return { x: ((v.x + 1) / 2) * snap.width, y: ((1 - v.y) / 2) * snap.height, visible: v.z <= 1 };
}

export function Projector({ snapshot, onChange }: { snapshot: { current: CameraSnapshot | null }; onChange: () => void }) {
  const { camera, gl, size } = useThree();
  const last = useRef<string>("");
  useFrame(() => {
    const m = camera.matrixWorldInverse.elements;
    const p = camera.projectionMatrix.elements;
    const sig = `${size.width}x${size.height}:${m.map((n) => n.toFixed(4)).join(",")}:${p[0]!.toFixed(4)},${p[5]!.toFixed(4)}`;
    if (sig !== last.current) {
      last.current = sig;
      snapshot.current = { camera, width: size.width, height: size.height, rect: gl.domElement.getBoundingClientRect() };
      onChange();
    }
  });
  return null;
}
