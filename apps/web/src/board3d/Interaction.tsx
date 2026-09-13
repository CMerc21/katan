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
import { CityFigure, PirateFigure, RobberFigure, SettlementFigure, ShipFigure, pirateOffset, robberOffset } from "./Pieces";
import { CastleFigure, GuardFigure, WagonFigure, guardOffset } from "./Wayfarers3d";

/**
 * Targeting modes: the base builds, Tides' ships, and the Wayfarers modes
 * (docs/phase10.md): `guard` / `rebuild` (hexes), `caravan` (edges), `wagon`
 * (step-by-step vertices), `fishRobber` / `fishRoad` / `fishCity` (the fish
 * favours that need a spot).
 */
export type TargetMode = "road" | "settlement" | "city" | "ship" | "moveShip" | "guard" | "rebuild" | "caravan" | "wagon" | "fishRobber" | "fishRoad" | "fishCity" | null;

export interface Targets {
  readonly vertices: ReadonlyMap<VertexId, Action>;
  readonly edges: ReadonlyMap<EdgeId, Action>;
  readonly hexes: ReadonlyMap<HexId, Action>;
  /** Move-ship mode, first step: the player's movable ships (docs/phase9.md §8). */
  readonly ships: ReadonlySet<EdgeId>;
  /** Wagon mode: the next stops along the legal paths from the path picked so far (docs/phase10.md §7). */
  readonly steps: ReadonlySet<VertexId>;
}

export const INTERACTION_LAYER = 1;

/** The `data-target` name of an overlay button for `action` (tests and assistive tech read it). */
export function targetName(action: Action): string {
  switch (action.type) {
    case "MOVE_ROBBER":
      return action.target ?? "robber";
    case "BUILD_KNIGHT":
      return action.hex !== undefined ? "guard" : "knight";
    case "REBUILD_HEX":
      return "rebuild";
    case "EXTEND_CARAVAN":
      return "caravan";
    case "BUILD_CASTLE":
      return "castle";
    case "SPEND_FISH":
      return action.option === "moveRobber" ? "fishRobber" : action.option === "freeRoad" ? "fishRoad" : action.option === "freeDevCard" ? "fishCity" : "fish";
    default:
      return action.type;
  }
}

/** The accessible label of an overlay button. */
export function targetLabel(action: Action, id: string): string {
  switch (action.type) {
    case "BUILD_CITY":
      return `Upgrade to city at ${id}`;
    case "BUILD_SETTLEMENT":
      return `Build settlement at ${id}`;
    case "BUILD_ROAD":
      return `Build road on ${id}`;
    case "BUILD_SHIP":
      return `Build ship on ${id}`;
    case "MOVE_SHIP":
      return `Move ship to ${id}`;
    case "MOVE_ROBBER":
      return action.target === "pirate" ? `Move pirate to sea hex ${id}` : `Move robber to hex ${id}`;
    case "BUILD_KNIGHT":
      return `Post a guard on hex ${id}`;
    case "REBUILD_HEX":
      return `Rebuild hex ${id}`;
    case "EXTEND_CARAVAN":
      return `Lead caravan ${action.caravan + 1} along ${id}`;
    case "BUILD_CASTLE":
      return `Raise your castle at ${id}`;
    case "SPEND_FISH":
      return action.option === "moveRobber" ? `Send the robber to hex ${id}` : action.option === "freeRoad" ? `Free road on ${id}` : `Upgrade the settlement at ${id}`;
    default:
      return `${action.type} ${id}`;
  }
}

/**
 * Which legal actions become targets, given the targeting mode (and, in
 * move-ship mode, the ship picked so far; in wagon mode, the stops picked so
 * far after the wagon's own vertex).
 */
export function computeTargets(legal: readonly Action[], phase: string, mode: TargetMode, moveFrom: EdgeId | null = null, wagonPath: readonly VertexId[] = []): Targets {
  const vertices = new Map<VertexId, Action>();
  const edges = new Map<EdgeId, Action>();
  const hexes = new Map<HexId, Action>();
  const ships = new Set<EdgeId>();
  const steps = new Set<VertexId>();
  const wantSettlement = phase === "setup" || mode === "settlement";
  const wantCity = mode === "city";
  const wantRoad = phase === "setup" || phase === "roadBuilding" || mode === "road";
  const wantShip = phase === "setup" || phase === "roadBuilding" || mode === "ship";
  for (const a of legal) {
    if (a.type === "BUILD_SETTLEMENT" && wantSettlement) vertices.set(a.vertex, a);
    else if (a.type === "BUILD_CITY" && wantCity) vertices.set(a.vertex, a);
    else if (a.type === "BUILD_ROAD" && wantRoad) edges.set(a.edge, a);
    else if (a.type === "BUILD_SHIP" && wantShip) edges.set(a.edge, a);
    else if (a.type === "MOVE_SHIP" && mode === "moveShip") {
      if (moveFrom === null) ships.add(a.from);
      else if (a.from === moveFrom) edges.set(a.to, a);
    } else if (a.type === "MOVE_ROBBER") hexes.set(a.hex, a);
    // Wayfarers (docs/phase10.md)
    else if (a.type === "BUILD_CASTLE") vertices.set(a.vertex, a);
    else if (a.type === "BUILD_KNIGHT" && mode === "guard" && a.hex !== undefined) hexes.set(a.hex, a);
    else if (a.type === "REBUILD_HEX" && mode === "rebuild") hexes.set(a.hex, a);
    else if (a.type === "EXTEND_CARAVAN" && mode === "caravan" && !edges.has(a.edge)) edges.set(a.edge, a);
    else if (a.type === "SPEND_FISH") {
      if (mode === "fishRobber" && a.option === "moveRobber" && a.hex !== undefined) hexes.set(a.hex, a);
      else if (mode === "fishRoad" && a.option === "freeRoad" && a.edge !== undefined) edges.set(a.edge, a);
      else if (mode === "fishCity" && a.option === "freeDevCard" && a.vertex !== undefined) vertices.set(a.vertex, a);
    } else if (a.type === "MOVE_WAGON" && mode === "wagon") {
      // The path's first vertex is the wagon itself; the picked stops follow it.
      const tail = a.path.slice(1);
      if (tail.length > wagonPath.length && wagonPath.every((v, i) => tail[i] === v)) steps.add(tail[wagonPath.length] as VertexId);
    }
  }
  return { vertices, edges, hexes, ships, steps };
}

/** The legal wagon move whose stops are exactly `wagonPath` (docs/phase10.md §7), if any. */
export function wagonMoveFor(legal: readonly Action[], wagonPath: readonly VertexId[]): Extract<Action, { type: "MOVE_WAGON" }> | undefined {
  return legal.find((a): a is Extract<Action, { type: "MOVE_WAGON" }> => a.type === "MOVE_WAGON" && a.path.length === wagonPath.length + 1 && wagonPath.every((v, i) => a.path[i + 1] === v));
}

type Hover = { kind: "vertex"; id: VertexId } | { kind: "edge"; id: EdgeId } | { kind: "hex"; id: HexId } | { kind: "ship"; id: EdgeId } | { kind: "step"; id: VertexId } | null;

export function InteractionLayer({ targets, color, onAction, onHover, onPickShip, onPickStep }: { targets: Targets; color: PlayerColor; onAction: (a: Action) => void; onHover?: (h: Hover) => void; onPickShip?: (edge: EdgeId) => void; onPickStep?: (vertex: VertexId) => void }) {
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
  const releaseShip = (key: string, edge: EdgeId) => (e: ThreeEvent<PointerEvent>) => {
    stop(e);
    if (pressed.current === key) onPickShip?.(edge);
    pressed.current = null;
  };
  const releaseStep = (key: string, vertex: VertexId) => (e: ThreeEvent<PointerEvent>) => {
    stop(e);
    if (pressed.current === key) onPickStep?.(vertex);
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
            {hovered && (action.type === "BUILD_CITY" || action.type === "SPEND_FISH" ? <CityFigure vertex={v} color={color} ghost /> : action.type === "BUILD_CASTLE" ? <CastleFigure vertex={v} color={color} ghost /> : <SettlementFigure vertex={v} color={color} ghost />)}
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
            {hovered && (action.type === "BUILD_SHIP" || action.type === "MOVE_SHIP") && <ShipFigure edge={e} color={color} ghost centred />}
          </group>
        );
      })}
      {[...targets.ships].map((e) => {
        const { mid, angle } = edgeWorld(e);
        const key = `s:${e}`;
        const hovered = hover?.kind === "ship" && hover.id === e;
        return (
          <group key={key} position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={releaseShip(key, e)} onClick={stop} onPointerOver={(ev) => (stop(ev), set({ kind: "ship", id: e }))} onPointerOut={() => set(null)} position={[0, 0.2, 0]} userData={{ target: key }}>
              <boxGeometry args={[0.8, 0.5, 0.4]} />
              {invisible}
            </mesh>
            <mesh
              ref={(el) => {
                if (el) rings.current.push(el);
              }}
              position={[0, 0.01, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.32, 0.42, 28]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.7} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {[...targets.steps].map((v) => {
        const p = vertexWorld(v);
        const key = `w:${v}`;
        const hovered = hover?.kind === "step" && hover.id === v;
        return (
          <group key={key} position={[p.x, SLAB_HEIGHT, p.z]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={releaseStep(key, v)} onClick={stop} onPointerOver={(e) => (stop(e), set({ kind: "step", id: v }))} onPointerOut={() => set(null)} position={[0, 0.15, 0]} userData={{ target: key }}>
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
              <ringGeometry args={[0.14, 0.24, 20]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.7} depthWrite={false} />
            </mesh>
            {hovered && <WagonFigure vertex={v} color={color} cargo={[]} ghost />}
          </group>
        );
      })}
      {[...targets.hexes.entries()].map(([h, action]) => {
        const c = hexWorld(h);
        const key = `h:${h}`;
        const hovered = hover?.kind === "hex" && hover.id === h;
        const pirate = action.type === "MOVE_ROBBER" && action.target === "pirate";
        const guard = action.type === "BUILD_KNIGHT";
        const o = pirate ? pirateOffset() : guard ? guardOffset(0) : robberOffset();
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
            {hovered && action.type !== "REBUILD_HEX" && (
              <group position={[o.dx, 0, o.dz]}>
                {pirate ? <PirateFigure ghost /> : guard ? <GuardFigure color={color} ghost /> : <RobberFigure ghost />}
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
