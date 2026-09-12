"use client";

/**
 * Interaction layer (docs/phase7-5.md §5): invisible raycast meshes on
 * layer 1 exist only for legal targets, each with a visible highlight in
 * the acting player's colour and a ghost piece on hover. Everything else in
 * the scene is never raycast.
 */

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef, useState } from "react";
import * as THREE from "three";
import type { Action, EdgeId, HexId, PlayerColor, VertexId } from "@katan/engine";
import { PLAYER_FILL } from "@/game/theme";
import { SLAB_HEIGHT, edgeWorld, hexWorld, vertexWorld } from "./layout3d";
import { CityFigure, RobberFigure, SettlementFigure, robberOffset } from "./Pieces";

export interface Targets {
  readonly vertices: ReadonlyMap<VertexId, Action>;
  readonly edges: ReadonlyMap<EdgeId, Action>;
  readonly hexes: ReadonlyMap<HexId, Action>;
}

export const INTERACTION_LAYER = 1;

/** Which legal actions become targets, given the targeting mode (same rule as the 2D board). */
export function computeTargets(legal: readonly Action[], phase: string, mode: "road" | "settlement" | "city" | null): Targets {
  const vertices = new Map<VertexId, Action>();
  const edges = new Map<EdgeId, Action>();
  const hexes = new Map<HexId, Action>();
  const wantSettlement = phase === "setup" || mode === "settlement";
  const wantCity = mode === "city";
  const wantRoad = phase === "setup" || phase === "roadBuilding" || mode === "road";
  for (const a of legal) {
    if (a.type === "BUILD_SETTLEMENT" && wantSettlement) vertices.set(a.vertex, a);
    else if (a.type === "BUILD_CITY" && wantCity) vertices.set(a.vertex, a);
    else if (a.type === "BUILD_ROAD" && wantRoad) edges.set(a.edge, a);
    else if (a.type === "MOVE_ROBBER") hexes.set(a.hex, a);
  }
  return { vertices, edges, hexes };
}

type Hover = { kind: "vertex"; id: VertexId } | { kind: "edge"; id: EdgeId } | { kind: "hex"; id: HexId } | null;

export function InteractionLayer({ targets, color, onAction, onHover }: { targets: Targets; color: PlayerColor; onAction: (a: Action) => void; onHover?: (h: Hover) => void }) {
  const accent = PLAYER_FILL[color];
  const [hover, setHover] = useState<Hover>(null);
  const rings = useRef<THREE.Object3D[]>([]);
  rings.current = [];
  const pressed = useRef<string | null>(null);

  useFrame(({ clock }) => {
    const s = 1 + Math.sin(clock.getElapsedTime() * 4.5) * 0.12;
    for (const r of rings.current) r.scale.set(s, s, 1);
  });

  const set = (h: Hover) => {
    setHover(h);
    onHover?.(h);
  };
  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  const press = (key: string) => (e: ThreeEvent<PointerEvent>) => {
    stop(e);
    pressed.current = key;
  };
  const release = (key: string, action: Action) => (e: ThreeEvent<PointerEvent>) => {
    stop(e);
    if (pressed.current === key) onAction(action);
    pressed.current = null;
  };
  const invisible = <meshBasicMaterial transparent opacity={0} depthWrite={false} />;

  return (
    <group name="interaction">
      {[...targets.vertices.entries()].map(([v, action]) => {
        const p = vertexWorld(v);
        const key = `v:${v}`;
        const hovered = hover?.kind === "vertex" && hover.id === v;
        return (
          <group key={key} position={[p.x, SLAB_HEIGHT, p.z]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={release(key, action)} onClick={stop} onPointerOver={(e) => (stop(e), set({ kind: "vertex", id: v }))} onPointerOut={() => set(null)} position={[0, 0.15, 0]} userData={{ target: key }}>
              <sphereGeometry args={[0.24, 10, 8]} />
              {invisible}
            </mesh>
            <mesh
              ref={(el) => {
                if (el) rings.current.push(el);
              }}
              position={[0, 0.01, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.2, 0.3, 28]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.7} depthWrite={false} />
            </mesh>
            {hovered && (action.type === "BUILD_CITY" ? <CityFigure vertex={v} color={color} ghost /> : <SettlementFigure vertex={v} color={color} ghost />)}
          </group>
        );
      })}
      {[...targets.edges.entries()].map(([e, action]) => {
        const { mid, angle } = edgeWorld(e);
        const key = `e:${e}`;
        const hovered = hover?.kind === "edge" && hover.id === e;
        return (
          <group key={key} position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={release(key, action)} onClick={stop} onPointerOver={(ev) => (stop(ev), set({ kind: "edge", id: e }))} onPointerOut={() => set(null)} position={[0, 0.08, 0]} userData={{ target: key }}>
              <boxGeometry args={[0.8, 0.22, 0.3]} />
              {invisible}
            </mesh>
            <mesh position={[0, 0.04, 0]}>
              <boxGeometry args={[0.78, 0.07, 0.16]} />
              <meshStandardMaterial color={accent} transparent opacity={hovered ? 0.85 : 0.45} emissive={accent} emissiveIntensity={hovered ? 0.6 : 0.25} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {[...targets.hexes.entries()].map(([h, action]) => {
        const c = hexWorld(h);
        const key = `h:${h}`;
        const hovered = hover?.kind === "hex" && hover.id === h;
        const o = robberOffset();
        return (
          <group key={key} position={[c.x, SLAB_HEIGHT + 0.005, c.z]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={release(key, action)} onClick={stop} onPointerOver={(ev) => (stop(ev), set({ kind: "hex", id: h }))} onPointerOut={() => set(null)} rotation={[-Math.PI / 2, 0, 0]} userData={{ target: key }}>
              <circleGeometry args={[0.9, 6]} />
              {invisible}
            </mesh>
            <mesh rotation={[-Math.PI / 2, Math.PI / 6, 0]} position={[0, 0.01, 0]}>
              <ringGeometry args={[0.8, 0.96, 6]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.6} depthWrite={false} />
            </mesh>
            {hovered && (
              <group position={[o.dx, 0, o.dz]}>
                <RobberFigure ghost />
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
