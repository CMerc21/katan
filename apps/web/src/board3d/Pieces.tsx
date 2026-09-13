"use client";

/**
 * Figurines (docs/props.md §4): every settlement, city and ship sits on a
 * base ring in the player's colour; thatched cottages with a door and two
 * windows, stone keeps with crenellations, a second tower, a gatehouse and a
 * flag, flat roads with a clay top and player-coloured sides, the hooded
 * robber with a face plate and a sack, ships with a curved sail, the pirate
 * with a black square sail. All at 1.5× true scale. Fresh pieces animate in
 * (scale overshoot, plank drop with a dust ring, keep rise with a flag unfurl).
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { EdgeId, PlayerColor, VertexId } from "@katan/engine";
import { PLAYER_FILL } from "@/game/theme";
import { easeOutBack, easeOutCubic, progress } from "./geo";
import { SEA_HEIGHT, SLAB_HEIGHT, edgeWorld, vertexWorld } from "./layout3d";
import { usePiece } from "./loadPiece";
import * as P from "./palette";
import { RECESS_DEPTH } from "./slab";

export const PIECE_SCALE = 1.5;

function colorOf(color: PlayerColor): string {
  return PLAYER_FILL[color];
}

export function Mat({ color, ghost = false, side }: { color: string; ghost?: boolean; side?: THREE.Side }) {
  return <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={ghost ? 0.5 : 1} depthWrite={!ghost} side={side ?? THREE.FrontSide} />;
}

/** The recolourable base ring under settlements, cities, ships and knights: radius 0.11 R, 0.02 R tall. */
export function BaseRing({ color, radius = 0.11, ghost = false, shadows = true, dim = false }: { color: string; radius?: number; ghost?: boolean; shadows?: boolean; dim?: boolean }) {
  const c = useMemo(() => (dim ? new THREE.Color(color).multiplyScalar(0.55).getStyle() : color), [color, dim]);
  return (
    <mesh position={[0, 0.01, 0]} receiveShadow={shadows} castShadow={shadows && !ghost}>
      <cylinderGeometry args={[radius, radius + 0.006, 0.02, 18]} />
      <Mat color={c} ghost={ghost} />
    </mesh>
  );
}

const FLAG_SHAPE = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.075, 0.022);
  s.lineTo(0, 0.044);
  s.closePath();
  return s;
})();

/** A short pole with a triangular flag in the player's colour (docs/props.md §5); on cities and the island pennant. */
export function FlagFigure({ color, height = 0.12, ghost = false, scaleX = 1 }: { color: PlayerColor | string; height?: number; ghost?: boolean; scaleX?: number }) {
  const fill = color in PLAYER_FILL ? PLAYER_FILL[color as PlayerColor] : color;
  return (
    <group name="flag">
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.005, 0.005, height, 5]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      <mesh position={[0.005, height - 0.048, 0]} scale={[scaleX, 1, 1]}>
        <shapeGeometry args={[FLAG_SHAPE]} />
        <Mat color={fill} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Ease-in wrapper: scale from 0 with overshoot (settlements), or a custom motion. */
function useEntrance(fresh: boolean, seq: number | null, ms: number) {
  const started = useRef<number | null>(null);
  const key = useRef<number | null>(null);
  const value = useRef(1);
  useFrame(({ clock }) => {
    const now = clock.getElapsedTime() * 1000;
    if (fresh && seq !== null && key.current !== seq) {
      key.current = seq;
      started.current = now;
    }
    value.current = started.current === null ? 1 : progress(started.current, ms, now);
  });
  return value;
}

export function SettlementFigure({ vertex, color, fresh = false, seq = null, ghost = false, shadows = true }: { vertex: VertexId; color: PlayerColor; fresh?: boolean; seq?: number | null; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const group = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.Mesh>(null);
  const t = useEntrance(fresh, seq, 300);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = fresh && t.current < 1 ? easeOutBack(t.current) : 1;
    g.scale.setScalar(PIECE_SCALE * Math.max(0.001, s));
    if (smoke.current) {
      const puff = fresh && t.current < 1 ? t.current : 0;
      smoke.current.visible = puff > 0;
      smoke.current.position.y = 0.2 + puff * 0.2;
      smoke.current.scale.setScalar(0.02 + puff * 0.05);
      (smoke.current.material as THREE.MeshStandardMaterial).opacity = 0.6 * (1 - puff);
    }
  });
  const cast = shadows && !ghost;
  return (
    <group ref={group} position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`settlement:${vertex}`}>
      <BaseRing color={colorOf(color)} ghost={ghost} shadows={shadows} />
      <mesh position={[0, 0.07, 0]} castShadow={cast}>
        <boxGeometry args={[0.14, 0.1, 0.1]} />
        <Mat color={P.WALL_PLASTER} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.045, 0.052]}>
        <boxGeometry args={[0.035, 0.05, 0.006]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      {[-0.072, 0.072].map((x) => (
        <mesh key={x} position={[x, 0.078, 0]}>
          <boxGeometry args={[0.006, 0.022, 0.022]} />
          <Mat color={P.DARK} ghost={ghost} />
        </mesh>
      ))}
      <mesh position={[0, 0.12, 0]} scale={[1, 0.8, 0.72]} castShadow={cast}>
        <sphereGeometry args={[0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Mat color={P.THATCH} ghost={ghost} />
      </mesh>
      <mesh ref={smoke} visible={false} position={[0.04, 0.2, 0]}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshStandardMaterial color={P.SMOKE} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Crenellations({ radius, y, count, size, ghost }: { radius: number; y: number; count: number; size: number; ghost: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, y, Math.sin(a) * radius]} rotation={[0, -a, 0]}>
            <boxGeometry args={[size, size, size]} />
            <Mat color={P.KEEP_STONE} ghost={ghost} />
          </mesh>
        );
      })}
    </>
  );
}

export function CityFigure({ vertex, color, fresh = false, seq = null, ghost = false, shadows = true }: { vertex: VertexId; color: PlayerColor; fresh?: boolean; seq?: number | null; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const group = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Group>(null);
  const t = useEntrance(fresh, seq, 300);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const k = fresh && t.current < 1 ? easeOutCubic(t.current) : 1;
    g.position.y = SLAB_HEIGHT - (1 - k) * 0.25;
    if (flag.current) flag.current.scale.x = Math.max(0.001, fresh ? Math.min(1, Math.max(0, (t.current - 0.5) * 2)) : 1);
  });
  const cast = shadows && !ghost;
  return (
    <group ref={group} position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`city:${vertex}`}>
      <BaseRing color={colorOf(color)} ghost={ghost} shadows={shadows} />
      {/* Main tower */}
      <mesh position={[-0.02, 0.1, -0.01]} castShadow={cast}>
        <cylinderGeometry args={[0.08, 0.08, 0.16, 10]} />
        <Mat color={P.KEEP_STONE} ghost={ghost} />
      </mesh>
      <group position={[-0.02, 0.195, -0.01]}>
        <Crenellations radius={0.068} y={0} count={8} size={0.028} ghost={ghost} />
      </group>
      {/* Second, half-height tower */}
      <mesh position={[0.075, 0.06, 0.045]} castShadow={cast}>
        <cylinderGeometry args={[0.05, 0.05, 0.08, 8]} />
        <Mat color={P.KEEP_STONE} ghost={ghost} />
      </mesh>
      <group position={[0.075, 0.112, 0.045]}>
        <Crenellations radius={0.042} y={0} count={6} size={0.022} ghost={ghost} />
      </group>
      {/* Gatehouse with an arch */}
      <mesh position={[0.03, 0.045, -0.075]} castShadow={cast}>
        <boxGeometry args={[0.08, 0.05, 0.06]} />
        <Mat color={P.KEEP_STONE} ghost={ghost} />
      </mesh>
      <mesh position={[0.03, 0.035, -0.106]}>
        <boxGeometry args={[0.03, 0.04, 0.006]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      <mesh position={[0.03, 0.055, -0.106]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.006, 8]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      <group ref={flag} position={[-0.02, 0.2, -0.01]}>
        <FlagFigure color={color} height={0.14} ghost={ghost} />
      </group>
    </group>
  );
}

export function RoadFigure({ edge, color, fresh = false, seq = null, ghost = false, shadows = true }: { edge: EdgeId; color: PlayerColor; fresh?: boolean; seq?: number | null; ghost?: boolean; shadows?: boolean }) {
  const { mid, angle } = edgeWorld(edge);
  const group = useRef<THREE.Group>(null);
  const dust = useRef<THREE.Mesh>(null);
  const t = useEntrance(fresh, seq, 300);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const k = fresh && t.current < 1 ? easeOutCubic(Math.min(1, t.current * 1.4)) : 1;
    g.position.y = SLAB_HEIGHT + (1 - k) * 0.5;
    if (dust.current) {
      const d = fresh && t.current > 0.6 && t.current < 1 ? (t.current - 0.6) / 0.4 : 0;
      dust.current.visible = d > 0;
      dust.current.scale.setScalar(0.2 + d * 0.6);
      (dust.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - d);
    }
  });
  return (
    <group ref={group} position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]} name={`road:${edge}`}>
      <mesh position={[0, 0.03, 0]} castShadow={shadows && !ghost}>
        <boxGeometry args={[0.8, 0.06, 0.15]} />
        <Mat color={colorOf(color)} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.062, 0]}>
        <boxGeometry args={[0.78, 0.008, 0.13]} />
        <Mat color={P.ROAD_TOP} ghost={ghost} />
      </mesh>
      {[-0.3, 0.3].flatMap((x) =>
        [-0.045, 0.045].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.068, z]}>
            <cylinderGeometry args={[0.008, 0.008, 0.006, 5]} />
            <Mat color={P.DARK} ghost={ghost} />
          </mesh>
        )),
      )}
      <mesh ref={dust} visible={false} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.8, 24]} />
        <meshBasicMaterial color="#d9c9a0" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A hull with a curved sail on a base ring (docs/props.md §4). `centred` draws it relative to a parent already at the edge; `fresh` bobs it in. */
export function ShipFigure({ edge, color, ghost = false, shadows = true, black = false, centred = false, fresh = false, seq = null }: { edge: EdgeId; color: PlayerColor; ghost?: boolean; shadows?: boolean; black?: boolean; centred?: boolean; fresh?: boolean; seq?: number | null }) {
  const { mid, angle } = edgeWorld(edge);
  const group = useRef<THREE.Group>(null);
  const t = useEntrance(fresh, seq, 450);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const k = fresh && t.current < 1 ? easeOutCubic(t.current) : 1;
    const bob = Math.sin(clock.getElapsedTime() * 1.6 + mid.x) * 0.008;
    g.position.y = SEA_HEIGHT + bob - (1 - k) * 0.3;
    g.rotation.z = Math.sin(clock.getElapsedTime() * 1.1 + mid.z) * 0.03;
  });
  const sail = black ? P.PIRATE_SAIL : colorOf(color);
  const hull = black ? P.PIRATE_HULL : P.HULL;
  const cast = shadows && !ghost;
  return (
    <group ref={group} position={centred ? [0, SEA_HEIGHT, 0] : [mid.x, SEA_HEIGHT, mid.z]} rotation={[0, centred ? 0 : -angle, 0]} scale={PIECE_SCALE * 0.85} name={`ship:${edge}`}>
      <BaseRing color={colorOf(color)} radius={0.14} ghost={ghost} shadows={shadows} />
      <mesh position={[0, 0.055, 0]} castShadow={cast}>
        <boxGeometry args={[0.44, 0.07, 0.16]} />
        <Mat color={hull} ghost={ghost} />
      </mesh>
      <mesh position={[0.24, 0.055, 0]} rotation={[0, Math.PI / 4, 0]} castShadow={cast}>
        <boxGeometry args={[0.11, 0.07, 0.11]} />
        <Mat color={hull} ghost={ghost} />
      </mesh>
      <mesh position={[-0.18, 0.075, 0]} castShadow={cast}>
        <boxGeometry args={[0.14, 0.11, 0.17]} />
        <Mat color={hull} ghost={ghost} />
      </mesh>
      <mesh position={[0.02, 0.095, 0]}>
        <boxGeometry args={[0.36, 0.01, 0.12]} />
        <Mat color={P.LOG_END} ghost={ghost} />
      </mesh>
      <mesh position={[0.02, 0.26, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.34, 5]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      <mesh position={[0.05, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.28, 5]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      {/* A gently curved sail bulging forward. */}
      <mesh position={[-0.18, 0.28, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.24, 8, 1, true, Math.PI / 2 - 0.5, 1]} />
        <Mat color={sail} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * The robber: the GLB figure (public/models/robber.glb) in a near-black
 * material, or the procedural hooded figure until it loads and whenever it
 * cannot. Same group name, scale and foot origin either way, so placement,
 * the hover ghost and the hop animation do not care which one is showing.
 * The group is positioned by the caller (it hops).
 */
export function RobberFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  const cast = shadows && !ghost;
  const model = usePiece("robber", { color: P.ROBBER_MODEL, roughness: 0.8, ghost, castShadow: cast, receiveShadow: shadows });
  if (model) {
    return (
      <group scale={PIECE_SCALE} name="robber">
        <primitive object={model} />
      </group>
    );
  }
  return <ProceduralRobberFigure ghost={ghost} shadows={shadows} />;
}

/** A hooded figure with a face plate and a sack (docs/props.md §4); the fallback when the GLB is unavailable. */
export function ProceduralRobberFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  const cast = shadows && !ghost;
  return (
    <group scale={PIECE_SCALE} name="robber">
      <mesh position={[0, 0.0075, 0]}>
        <cylinderGeometry args={[0.1, 0.105, 0.015, 12]} />
        <Mat color={P.ROBBER_BASE} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.125, 0]} castShadow={cast}>
        <coneGeometry args={[0.1, 0.22, 8]} />
        <Mat color={P.ROBBER} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.27, 0.005]} rotation={[0.25, 0, 0]}>
        <coneGeometry args={[0.065, 0.1, 8]} />
        <Mat color={P.ROBBER} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.225, 0.05]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.05, 0.035, 0.008]} />
        <Mat color={P.WOOL} ghost={ghost} />
      </mesh>
      {[-0.012, 0.012].map((x) => (
        <mesh key={x} position={[x, 0.228, 0.057]}>
          <sphereGeometry args={[0.006, 5, 4]} />
          <Mat color={P.DARK} ghost={ghost} />
        </mesh>
      ))}
      <mesh position={[0.1, 0.06, 0.02]} castShadow={cast}>
        <sphereGeometry args={[0.045, 7, 5]} />
        <Mat color={P.ROBBER_SACK} ghost={ghost} />
      </mesh>
    </group>
  );
}

/** Where the robber stands on a hex: in the recess on the desert (no token), beside the token elsewhere. */
export function robberOffset(centred = false): { dx: number; dz: number; dy: number } {
  return centred ? { dx: 0, dz: 0, dy: -RECESS_DEPTH } : { dx: 0.42, dz: 0.22, dy: 0 };
}

/** The pirate: a dark hull with a square black sail and a pennant, no base ring (docs/props.md §5). */
export function PirateFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  const cast = shadows && !ghost;
  return (
    <group scale={PIECE_SCALE * 0.95} rotation={[0, 0.6, 0]} name="pirate">
      <mesh position={[0, 0.04, 0]} castShadow={cast}>
        <boxGeometry args={[0.46, 0.08, 0.17]} />
        <Mat color={P.PIRATE_HULL} ghost={ghost} />
      </mesh>
      <mesh position={[0.25, 0.04, 0]} rotation={[0, Math.PI / 4, 0]} castShadow={cast}>
        <boxGeometry args={[0.12, 0.08, 0.12]} />
        <Mat color={P.PIRATE_HULL} ghost={ghost} />
      </mesh>
      <mesh position={[-0.19, 0.065, 0]} castShadow={cast}>
        <boxGeometry args={[0.12, 0.13, 0.18]} />
        <Mat color={P.PIRATE_HULL} ghost={ghost} />
      </mesh>
      <mesh position={[0.02, 0.3, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 0.48, 5]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      <mesh position={[0.05, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.26, 5]} />
        <Mat color={P.DARK} ghost={ghost} />
      </mesh>
      <mesh position={[0.06, 0.31, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.24, 0.22]} />
        <Mat color={P.PIRATE_SAIL} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.025, 0.5, 0]}>
        <shapeGeometry args={[FLAG_SHAPE]} />
        <Mat color={P.PIRATE_SAIL} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Where the pirate floats on a sea hex. */
export function pirateOffset(): { dx: number; dz: number } {
  return { dx: -0.3, dz: -0.15 };
}

export function useMemoColor(color: string): THREE.Color {
  return useMemo(() => new THREE.Color(color), [color]);
}
