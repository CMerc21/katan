"use client";

/**
 * Event animations in the scene (docs/phase7-5.md §5, docs/props.md §5):
 * rounded bone dice with indented pips tumbling into a soft leather tray at
 * the near edge (the red number die and the event die with its solid faces
 * under Crown & Castle), the robber hopping in a parabola with
 * squash-and-stretch, and the projector that turns world points into screen
 * coordinates for the DOM flights and target buttons.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { EventDie, HexId } from "@katan/engine";
import { easeInOut, easeOutCubic } from "./geo";
import { SEA_HEIGHT, SLAB_HEIGHT, hexWorld, type Bounds, type World } from "./layout3d";
import * as P from "./palette";
import { PirateFigure, RobberFigure, pirateOffset, robberOffset } from "./Pieces";
import { fleetFaceTexture } from "./textures";

// ---------------------------------------------------------------------------
// Robber

/** The robber hops between hexes; `centred` stands it in the recess (the desert has no token). */
export function AnimatedRobber({ hex, shadows, centred = false, liftOf = () => 0 }: { hex: HexId; shadows: boolean; centred?: boolean; liftOf?: (hex: HexId) => number }) {
  const group = useRef<THREE.Group>(null);
  const from = useRef<(World & { y: number }) | null>(null);
  const to = useRef<HexId>(hex);
  const toCentred = useRef(centred);
  const start = useRef(0);
  const dest = (h: HexId, c: boolean): World & { y: number } => {
    const at = hexWorld(h);
    const o = robberOffset(c);
    return { x: at.x + o.dx, z: at.z + o.dz, y: SLAB_HEIGHT + liftOf(h) + o.dy };
  };
  useEffect(() => {
    if (to.current !== hex) {
      from.current = dest(to.current, toCentred.current);
      to.current = hex;
      toCentred.current = centred;
      start.current = performance.now();
    } else toCentred.current = centred;
  }, [hex, centred]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const end = dest(to.current, toCentred.current);
    const f = from.current;
    if (!f) {
      g.position.set(end.x, end.y, end.z);
      return;
    }
    const t = Math.min(1, (performance.now() - start.current) / 450);
    const k = easeInOut(t);
    const arc = Math.sin(t * Math.PI) * 0.6;
    g.position.set(f.x + (end.x - f.x) * k, f.y + (end.y - f.y) * k + arc, f.z + (end.z - f.z) * k);
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
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const end = dest(to.current);
    const f = from.current;
    const bob = Math.sin(clock.getElapsedTime() * 1.4 + end.x) * 0.008;
    if (!f) {
      g.position.set(end.x, SEA_HEIGHT + bob, end.z);
      return;
    }
    const t = Math.min(1, (performance.now() - start.current) / 450);
    const k = easeInOut(t);
    const arc = Math.sin(t * Math.PI) * 0.25;
    g.position.set(f.x + (end.x - f.x) * k, SEA_HEIGHT + arc, f.z + (end.z - f.z) * k);
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

/** Crown & Castle (docs/rules.md §16.2): the event die's faces 1–3 are the fleet, 4 trade, 5 politics, 6 science. */
export function eventDieFace(event: EventDie): number {
  switch (event) {
    case "fleet":
      return 1;
    case "trade":
      return 4;
    case "politics":
      return 5;
    case "science":
      return 6;
    default: {
      const exhaustive: never = event;
      throw new Error(String(exhaustive));
    }
  }
}

/** Dice are 0.18 R at the pieces' 1.5× scale. */
export const DIE_SIZE = 0.27;
/** Face order of a box geometry's material groups. */
const FACE_ORDER = [3, 4, 1, 6, 2, 5] as const;

/** Pip spots on a face in [-1, 1]² for each value. */
export function pipSpots(n: number): [number, number][] {
  switch (n) {
    case 1:
      return [[0, 0]];
    case 2:
      return [
        [-1, -1],
        [1, 1],
      ];
    case 3:
      return [
        [-1, -1],
        [0, 0],
        [1, 1],
      ];
    case 4:
      return [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ];
    case 5:
      return [
        [-1, -1],
        [1, -1],
        [0, 0],
        [-1, 1],
        [1, 1],
      ];
    default:
      return [
        [-1, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, 1],
      ];
  }
}

/** Every pip of a die as a position on its faces (21 in total), sunk `sink` into the face. */
export function diePips(size: number, sink: number): THREE.Vector3[] {
  const half = size / 2 - sink;
  const spread = size * 0.27;
  const out: THREE.Vector3[] = [];
  FACE_ORDER.forEach((n, face) => {
    for (const [u, v] of pipSpots(n)) {
      const a = u * spread;
      const b = v * spread;
      switch (face) {
        case 0:
          out.push(new THREE.Vector3(half, a, b));
          break;
        case 1:
          out.push(new THREE.Vector3(-half, a, b));
          break;
        case 2:
          out.push(new THREE.Vector3(a, half, b));
          break;
        case 3:
          out.push(new THREE.Vector3(a, -half, b));
          break;
        case 4:
          out.push(new THREE.Vector3(a, b, half));
          break;
        default:
          out.push(new THREE.Vector3(a, b, -half));
          break;
      }
    }
  });
  return out;
}

function Pips({ color }: { color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => diePips(DIE_SIZE, 0.014), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    spots.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [spots, dummy]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]}>
      <sphereGeometry args={[0.03, 8, 6]} />
      <meshStandardMaterial color={color} roughness={0.5} />
    </instancedMesh>
  );
}

function Die({ index, value, rollKey, rest, kind = "number", red = false, shadows }: { index: number; value: number; rollKey: number | null; rest: THREE.Vector3; kind?: "number" | "event"; red?: boolean; shadows: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_SIZE * 0.18), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const materials = useMemo(() => {
    if (kind === "event") {
      const fleet = fleetFaceTexture();
      return FACE_ORDER.map((n) => (n <= 3 ? new THREE.MeshStandardMaterial({ map: fleet, roughness: 0.6 }) : new THREE.MeshStandardMaterial({ color: n === 4 ? P.EVENT_TRADE : n === 5 ? P.EVENT_POLITICS : P.EVENT_SCIENCE, roughness: 0.6 })));
    }
    return new THREE.MeshStandardMaterial({ color: red ? P.DIE_RED : P.DIE_BONE, roughness: 0.6 });
  }, [kind, red]);
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
    m.position.set(rest.x - (1 - k) * 0.9 * (index === 0 ? 1 : -0.6), rest.y + Math.sin(k * Math.PI) * 0.7 * (1 - k) + DIE_SIZE / 2, rest.z - (1 - k) * 1.2);
  });
  return (
    <mesh ref={mesh} geometry={geometry} material={materials} position={[rest.x, rest.y + DIE_SIZE / 2, rest.z]} castShadow={shadows}>
      {kind === "number" && <Pips color={red ? P.DIE_BONE : P.DARK} />}
    </mesh>
  );
}

/** A soft leather tray: a rounded floor and four flared rims, no hard corners. */
function Tray({ x, z, w, shadows }: { x: number; z: number; w: number; shadows: boolean }) {
  const d = 0.7;
  const floor = useMemo(() => new RoundedBoxGeometry(w, 0.05, d, 3, 0.02), [w]);
  const long = useMemo(() => new RoundedBoxGeometry(w + 0.04, 0.09, 0.05, 3, 0.02), [w]);
  const short = useMemo(() => new RoundedBoxGeometry(0.05, 0.09, d + 0.04, 3, 0.02), []);
  useEffect(
    () => () => {
      floor.dispose();
      long.dispose();
      short.dispose();
    },
    [floor, long, short],
  );
  const mat = <meshStandardMaterial color={P.TRAY_LEATHER} roughness={0.95} />;
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={floor} position={[0, 0.025, 0]} receiveShadow={shadows}>
        {mat}
      </mesh>
      <mesh geometry={long} position={[0, 0.06, -d / 2]} rotation={[-0.22, 0, 0]}>
        {mat}
      </mesh>
      <mesh geometry={long} position={[0, 0.06, d / 2]} rotation={[0.22, 0, 0]}>
        {mat}
      </mesh>
      <mesh geometry={short} position={[-w / 2, 0.06, 0]} rotation={[0, 0, 0.22]}>
        {mat}
      </mesh>
      <mesh geometry={short} position={[w / 2, 0.06, 0]} rotation={[0, 0, -0.22]}>
        {mat}
      </mesh>
    </group>
  );
}

/** The dice tray; under Crown & Castle it is wider, the first die is red and the event die lands beside the number dice (docs/phase11.md §11). */
export function DiceTray3D({ bounds, dice, rollKey, shadows, eventDie = null, redDie = false }: { bounds: Bounds; dice: [number, number] | null; rollKey: number | null; shadows: boolean; eventDie?: EventDie | null; redDie?: boolean }) {
  const three = eventDie !== null;
  const x = bounds.cx - (three ? 1.1 : 0.9);
  const z = bounds.maxZ + 1.3;
  const w = three ? 1.6 : 1.2;
  if (!dice) return null;
  const floor = 0.05;
  return (
    <group name="dice-tray">
      <Tray x={x} z={z} w={w} shadows={shadows} />
      <Die index={0} value={dice[0]} rollKey={rollKey} rest={new THREE.Vector3(x - (three ? 0.5 : 0.25), floor, z)} red={redDie} shadows={shadows} />
      <Die index={1} value={dice[1]} rollKey={rollKey} rest={new THREE.Vector3(x + (three ? 0 : 0.25), floor, z + 0.04)} shadows={shadows} />
      {eventDie !== null && <Die index={2} value={eventDieFace(eventDie)} rollKey={rollKey} rest={new THREE.Vector3(x + 0.5, floor, z - 0.03)} kind="event" shadows={shadows} />}
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
