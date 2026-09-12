"use client";

/**
 * Figurines (docs/phase7-5.md §1, §6): chunky houses and keeps with a base
 * ring in the player's colour, timber planks with stakes, ships, the hooded
 * robber and the pirate. Fresh pieces animate in (scale overshoot, plank
 * drop with a dust ring, keep rise with a flag unfurl).
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { EdgeId, PlayerColor, VertexId } from "@katan/engine";
import { PLAYER_FILL } from "@/game/theme";
import { easeOutBack, easeOutCubic, progress } from "./geo";
import { SLAB_HEIGHT, edgeWorld, vertexWorld } from "./layout3d";

const PIECE_SCALE = 1.5;
const WALL = "#efe2c4";
const STRAW = "#d9b258";
const STONE = "#a9a59b";
const STONE_DARK = "#8f8b82";
const TIMBER = "#8a6a44";
const INK = "#211d19";

function colorOf(color: PlayerColor): string {
  return PLAYER_FILL[color];
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
      smoke.current.position.y = 0.32 + puff * 0.25;
      smoke.current.scale.setScalar(0.03 + puff * 0.06);
      (smoke.current.material as THREE.MeshStandardMaterial).opacity = 0.6 * (1 - puff);
    }
  });
  const opacity = ghost ? 0.5 : 1;
  const mat = (color: string) => <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={opacity} depthWrite={!ghost} />;
  return (
    <group ref={group} position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`settlement:${vertex}`}>
      <mesh position={[0, 0.012, 0]} receiveShadow={shadows}>
        <cylinderGeometry args={[0.2, 0.22, 0.025, 20]} />
        {mat(colorOf(color))}
      </mesh>
      <mesh position={[0, 0.12, 0]} castShadow={shadows && !ghost}>
        <boxGeometry args={[0.24, 0.19, 0.2]} />
        {mat(WALL)}
      </mesh>
      <mesh position={[0, 0.27, 0]} rotation={[0, Math.PI / 4, 0]} castShadow={shadows && !ghost}>
        <coneGeometry args={[0.2, 0.14, 4]} />
        {mat(STRAW)}
      </mesh>
      <mesh position={[0, 0.07, 0.101]}>
        <boxGeometry args={[0.06, 0.09, 0.01]} />
        {mat(colorOf(color))}
      </mesh>
      <mesh ref={smoke} visible={false} position={[0.06, 0.32, 0]}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshStandardMaterial color="#d8d3c8" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function CityFigure({ vertex, color, fresh = false, seq = null, ghost = false, shadows = true }: { vertex: VertexId; color: PlayerColor; fresh?: boolean; seq?: number | null; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const group = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Mesh>(null);
  const t = useEntrance(fresh, seq, 300);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const k = fresh && t.current < 1 ? easeOutCubic(t.current) : 1;
    g.position.y = SLAB_HEIGHT - (1 - k) * 0.25;
    if (flag.current) flag.current.scale.x = Math.max(0.001, fresh ? Math.min(1, Math.max(0, (t.current - 0.5) * 2)) : 1);
  });
  const opacity = ghost ? 0.5 : 1;
  const mat = (color: string) => <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={opacity} depthWrite={!ghost} />;
  return (
    <group ref={group} position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`city:${vertex}`}>
      <mesh position={[0, 0.012, 0]} receiveShadow={shadows}>
        <cylinderGeometry args={[0.24, 0.26, 0.025, 20]} />
        {mat(colorOf(color))}
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow={shadows && !ghost}>
        <boxGeometry args={[0.3, 0.28, 0.26]} />
        {mat(STONE)}
      </mesh>
      {[-0.1, 0.1].flatMap((x) =>
        [-0.09, 0.09].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.33, z]}>
            <boxGeometry args={[0.06, 0.06, 0.06]} />
            {mat(STONE)}
          </mesh>
        )),
      )}
      <mesh position={[0.08, 0.36, -0.04]} castShadow={shadows && !ghost}>
        <cylinderGeometry args={[0.07, 0.08, 0.34, 8]} />
        {mat(STONE_DARK)}
      </mesh>
      <mesh position={[0.08, 0.62, -0.04]}>
        <cylinderGeometry args={[0.008, 0.008, 0.2, 5]} />
        {mat(INK)}
      </mesh>
      <mesh ref={flag} position={[0.14, 0.68, -0.04]}>
        <boxGeometry args={[0.12, 0.07, 0.01]} />
        {mat(colorOf(color))}
      </mesh>
      <mesh position={[0, 0.06, 0.131]}>
        <boxGeometry args={[0.08, 0.1, 0.01]} />
        {mat(INK)}
      </mesh>
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
  const opacity = ghost ? 0.5 : 1;
  const mat = (color: string) => <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={opacity} depthWrite={!ghost} />;
  return (
    <group ref={group} position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]} name={`road:${edge}`}>
      <mesh position={[0, 0.035, 0]} castShadow={shadows && !ghost}>
        <boxGeometry args={[0.78, 0.07, 0.16]} />
        {mat(TIMBER)}
      </mesh>
      <mesh position={[0, 0.072, 0]}>
        <boxGeometry args={[0.72, 0.01, 0.07]} />
        {mat(colorOf(color))}
      </mesh>
      {[-0.28, 0.28].map((x) => (
        <mesh key={x} position={[x, 0.06, 0.1]}>
          <cylinderGeometry args={[0.02, 0.02, 0.12, 5]} />
          {mat(INK)}
        </mesh>
      ))}
      <mesh ref={dust} visible={false} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.8, 24]} />
        <meshBasicMaterial color="#d9c9a0" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function ShipFigure({ edge, color, ghost = false, shadows = true, black = false }: { edge: EdgeId; color: PlayerColor; ghost?: boolean; shadows?: boolean; black?: boolean }) {
  const { mid, angle } = edgeWorld(edge);
  const opacity = ghost ? 0.5 : 1;
  const sail = black ? "#1f1a17" : colorOf(color);
  const hull = black ? "#2a2622" : TIMBER;
  const mat = (color: string, side: THREE.Side = THREE.FrontSide) => <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={opacity} depthWrite={!ghost} side={side} />;
  return (
    <group position={[mid.x, SLAB_HEIGHT - 0.06, mid.z]} rotation={[0, -angle, 0]} scale={PIECE_SCALE * 0.8} name={`ship:${edge}`}>
      <mesh position={[0, 0.04, 0]} castShadow={shadows && !ghost}>
        <boxGeometry args={[0.44, 0.08, 0.16]} />
        {mat(hull)}
      </mesh>
      <mesh position={[0.22, 0.06, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.1, 0.1, 0.14]} />
        {mat(hull)}
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 0.34, 5]} />
        {mat(INK)}
      </mesh>
      <mesh position={[0.07, 0.24, 0]} rotation={[0, Math.PI / 2, 0]}>
        <shapeGeometry args={[useTriangle()]} />
        {mat(sail, THREE.DoubleSide)}
      </mesh>
    </group>
  );
}

const TRIANGLE = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, -0.14);
  s.lineTo(0, 0.14);
  s.lineTo(0.22, -0.1);
  s.closePath();
  return s;
})();
function useTriangle(): THREE.Shape {
  return TRIANGLE;
}

/** A hooded figure with a sack; the group is positioned by the caller (it hops). */
export function RobberFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  const opacity = ghost ? 0.5 : 1;
  const mat = (color: string) => <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={opacity} depthWrite={!ghost} />;
  return (
    <group scale={PIECE_SCALE} name="robber">
      <mesh position={[0, 0.2, 0]} castShadow={shadows && !ghost}>
        <coneGeometry args={[0.15, 0.4, 8]} />
        {mat("#2a2622")}
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        {mat("#2a2622")}
      </mesh>
      <mesh position={[0, 0.42, 0.02]} rotation={[0.3, 0, 0]}>
        <coneGeometry args={[0.1, 0.12, 8]} />
        {mat("#1f1a17")}
      </mesh>
      <mesh position={[0.15, 0.16, 0.02]}>
        <sphereGeometry args={[0.08, 7, 5]} />
        {mat("#8a6a44")}
      </mesh>
    </group>
  );
}

/** Where the robber stands on a hex: offset from the token, like the 2D board. */
export function robberOffset(): { dx: number; dz: number } {
  return { dx: 0.42, dz: 0.22 };
}

export const pieceMaterialCache = new Map<string, THREE.Material>();
export function useMemoColor(color: string): THREE.Color {
  return useMemo(() => new THREE.Color(color), [color]);
}
