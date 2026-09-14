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
import type { Action, EdgeId, HexId, PlayerColor, ProgressCard, VertexId } from "@katan/engine";
import { PLAYER_FILL } from "@/game/theme";
import { SLAB_HEIGHT, edgeWorld, hexWorld, vertexWorld } from "./layout3d";
import { CityFigure, PirateFigure, RobberFigure, SettlementFigure, ShipFigure, pirateOffset, robberOffset } from "./Pieces";
import { CastleFigure, GuardFigure, WagonFigure, guardOffset } from "./Wayfarers3d";
import { CrownCityFigure, KnightFigure, MerchantFigure, merchantOffset } from "./Crown3d";

/**
 * Targeting modes: the base builds, Tides' ships, the Wayfarers modes
 * (docs/phase10.md): `guard` / `rebuild` (hexes), `caravan` (edges), `wagon`
 * (step-by-step vertices), `fishRobber` / `fishRoad` / `fishCity` (the fish
 * favours that need a spot), and the Crown & Castle modes (docs/phase11.md
 * §11): `knight` (hire), `knightAct` (pick one of your knights),
 * `knightMove` / `knightDisplace` (its destination), `wall`, the prompt
 * hints `metropolis` / `downgrade` / `retreat`, and `progress:<card>` for
 * the cards whose payload is a spot on the board.
 */
export type CrownMode = "knight" | "knightAct" | "knightMove" | "knightDisplace" | "wall" | "metropolis" | "downgrade" | "retreat" | `progress:${ProgressCard}`;
export type TargetMode = "road" | "settlement" | "city" | "ship" | "moveShip" | "guard" | "rebuild" | "caravan" | "wagon" | "fishRobber" | "fishRoad" | "fishCity" | CrownMode | null;

/** Crown & Castle picks made so far: the knight being moved, and the first of a two-step payload (Inventor, Diplomat, Smith). */
export interface CrownPick {
  readonly from: VertexId | null;
  readonly first: string | null;
}

export const NO_PICK: CrownPick = { from: null, first: null };

export interface Targets {
  readonly vertices: ReadonlyMap<VertexId, Action>;
  readonly edges: ReadonlyMap<EdgeId, Action>;
  readonly hexes: ReadonlyMap<HexId, Action>;
  /** Move-ship mode, first step: the player's movable ships (docs/phase9.md §8). */
  readonly ships: ReadonlySet<EdgeId>;
  /** Wagon mode: the next stops along the legal paths from the path picked so far (docs/phase10.md §7). */
  readonly steps: ReadonlySet<VertexId>;
  /** Crown & Castle: the player's own knights that can do something (click one for its menu). */
  readonly knights: ReadonlySet<VertexId>;
  /** Crown & Castle: the first pick of a two-step card payload. */
  readonly picks: { readonly vertices: ReadonlySet<VertexId>; readonly edges: ReadonlySet<EdgeId>; readonly hexes: ReadonlySet<HexId> };
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
    // Crown & Castle (docs/phase11.md §11)
    case "KNIGHT_MOVE":
      return "knightMove";
    case "KNIGHT_DISPLACE":
      return "knightDisplace";
    case "BUILD_WALL":
      return "wall";
    case "PLACE_METROPOLIS":
      return "metropolis";
    case "CHOOSE_DOWNGRADE":
      return "downgrade";
    case "RETREAT_KNIGHT":
      return "retreat";
    case "CHOOSE_DESERTER":
      return "deserter";
    case "PLACE_FREE_KNIGHT":
      return "freeKnight";
    case "PLAY_PROGRESS":
      return `progress:${action.card}`;
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
    // Crown & Castle (docs/phase11.md §11)
    case "KNIGHT_MOVE":
      return `Move the knight to ${id}`;
    case "KNIGHT_DISPLACE":
      return `Drive off the knight at ${id}`;
    case "BUILD_WALL":
      return `Wall the city at ${id}`;
    case "PLACE_METROPOLIS":
      return `Place the metropolis on the city at ${id}`;
    case "CHOOSE_DOWNGRADE":
      return `Give up the city at ${id}`;
    case "RETREAT_KNIGHT":
      return `Retreat the knight to ${id}`;
    case "CHOOSE_DESERTER":
      return `Desert the knight at ${id}`;
    case "PLACE_FREE_KNIGHT":
      return `Place the free knight at ${id}`;
    case "PLAY_PROGRESS": {
      const p = action.payload ?? {};
      if (action.card === "inventor" && p.hexes) return `Swap the tokens of ${p.hexes[0]} and ${p.hexes[1]}`;
      if (action.card === "diplomat") return p.relocateTo ? `Move the road from ${p.edge} to ${id}` : `Remove the road on ${id}`;
      if (action.card === "smith") return `Promote the knight${(p.vertices?.length ?? 0) > 1 ? "s" : ""} at ${(p.vertices ?? []).join(" and ")}`;
      if (action.card === "bishop") return `Bishop: move the robber to hex ${id}`;
      if (action.card === "merchant") return `Place the merchant on hex ${id}`;
      if (action.card === "intrigue") return `Remove the knight at ${id}`;
      if (action.card === "engineer") return `Wall the city at ${id} for free`;
      if (action.card === "medicine") return `Upgrade the settlement at ${id}`;
      return `Play ${action.card} at ${id}`;
    }
    default:
      return `${action.type} ${id}`;
  }
}

/** The knight a `BUILD_KNIGHT` (vertex) or a knight action stands on, for the knight pick set. */
function knightVertexOf(a: Action): VertexId | null {
  switch (a.type) {
    case "ACTIVATE_KNIGHT":
    case "PROMOTE_KNIGHT":
    case "KNIGHT_CHASE_ROBBER":
      return a.vertex;
    case "KNIGHT_MOVE":
    case "KNIGHT_DISPLACE":
      return a.from;
    default:
      return null;
  }
}

/**
 * Which legal actions become targets, given the targeting mode (and, in
 * move-ship mode, the ship picked so far; in wagon mode, the stops picked so
 * far after the wagon's own vertex).
 */
export function computeTargets(legal: readonly Action[], phase: string, mode: TargetMode, moveFrom: EdgeId | null = null, wagonPath: readonly VertexId[] = [], crown: CrownPick = NO_PICK): Targets {
  const vertices = new Map<VertexId, Action>();
  const edges = new Map<EdgeId, Action>();
  const hexes = new Map<HexId, Action>();
  const ships = new Set<EdgeId>();
  const steps = new Set<VertexId>();
  const knights = new Set<VertexId>();
  const picks = { vertices: new Set<VertexId>(), edges: new Set<EdgeId>(), hexes: new Set<HexId>() };
  const wantSettlement = phase === "setup" || mode === "settlement";
  const wantCity = mode === "city";
  const wantRoad = phase === "setup" || phase === "roadBuilding" || mode === "road";
  const wantShip = phase === "setup" || phase === "roadBuilding" || mode === "ship";
  // Crown & Castle (docs/phase11.md §11): your knights are clickable whenever nothing else is being targeted.
  const wantKnights = phase === "action" && (mode === null || mode === "knightAct");
  const card = mode !== null && mode.startsWith("progress:") ? (mode.slice("progress:".length) as ProgressCard) : null;
  const cardActions = card ? legal.filter((a): a is Extract<Action, { type: "PLAY_PROGRESS" }> => a.type === "PLAY_PROGRESS" && a.card === card) : [];
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
    // Crown & Castle (docs/phase11.md §11)
    else if (a.type === "BUILD_KNIGHT" && mode === "knight" && a.vertex !== undefined) vertices.set(a.vertex, a);
    else if (a.type === "KNIGHT_MOVE" && mode === "knightMove" && a.from === crown.from) vertices.set(a.to, a);
    else if (a.type === "KNIGHT_DISPLACE" && mode === "knightDisplace" && a.from === crown.from) vertices.set(a.to, a);
    else if (a.type === "BUILD_WALL" && mode === "wall") vertices.set(a.vertex, a);
    // Prompt answers with a spot on the board are always offered (the prompt is the mode).
    else if (a.type === "PLACE_METROPOLIS" || a.type === "CHOOSE_DOWNGRADE" || a.type === "CHOOSE_DESERTER") vertices.set(a.vertex, a);
    else if ((a.type === "RETREAT_KNIGHT" || a.type === "PLACE_FREE_KNIGHT") && a.vertex !== null) vertices.set(a.vertex, a);
    if (wantKnights) {
      const v = knightVertexOf(a);
      if (v !== null) knights.add(v);
    }
  }
  for (const a of cardActions) {
    const p = a.payload ?? {};
    switch (a.card) {
      case "merchant":
      case "bishop":
        if (p.hex !== undefined) hexes.set(p.hex, a);
        break;
      case "intrigue":
      case "engineer":
      case "medicine":
        if (p.vertex !== undefined) vertices.set(p.vertex, a);
        break;
      case "inventor": {
        // Two tokens: the first pick narrows the second to the pairs it is in.
        if (!p.hexes) break;
        const [x, y] = p.hexes;
        if (crown.first === null) {
          picks.hexes.add(x);
          picks.hexes.add(y);
        } else if (x === crown.first) hexes.set(y, a);
        else if (y === crown.first) hexes.set(x, a);
        break;
      }
      case "diplomat": {
        // A road with relocation options is picked first; one without is removed at once.
        if (p.edge === undefined) break;
        const relocatable = cardActions.some((b) => b.payload?.edge === p.edge && b.payload?.relocateTo !== undefined);
        if (crown.first === null) {
          if (relocatable) picks.edges.add(p.edge);
          else if (p.relocateTo === undefined) edges.set(p.edge, a);
        } else if (p.edge === crown.first && p.relocateTo !== undefined) edges.set(p.relocateTo, a);
        break;
      }
      case "smith": {
        // One knight, or two: a knight that could pair up is picked first.
        const vs = p.vertices ?? [];
        const [x, y] = vs;
        if (x === undefined) break;
        if (crown.first === null) {
          const pairable = cardActions.some((b) => (b.payload?.vertices?.length ?? 0) === 2 && b.payload?.vertices?.includes(x));
          if (vs.length === 1) {
            if (pairable) picks.vertices.add(x);
            else vertices.set(x, a);
          }
        } else if (vs.length === 2 && y !== undefined) {
          if (x === crown.first) vertices.set(y, a);
          else if (y === crown.first) vertices.set(x, a);
        }
        break;
      }
      default:
        break;
    }
  }
  return { vertices, edges, hexes, ships, steps, knights, picks };
}

/** Crown & Castle: the single-payload card action for a first pick that may also stand alone (Smith with one knight, Diplomat without relocation). */
export function soloCardAction(legal: readonly Action[], mode: TargetMode, first: string | null): Action | undefined {
  if (mode === null || !mode.startsWith("progress:") || first === null) return undefined;
  const card = mode.slice("progress:".length);
  return legal.find((a) => {
    if (a.type !== "PLAY_PROGRESS" || a.card !== card) return false;
    const p = a.payload ?? {};
    if (card === "smith") return p.vertices?.length === 1 && p.vertices[0] === first;
    if (card === "diplomat") return p.edge === first && p.relocateTo === undefined;
    return false;
  });
}

/** The legal wagon move whose stops are exactly `wagonPath` (docs/phase10.md §7), if any. */
export function wagonMoveFor(legal: readonly Action[], wagonPath: readonly VertexId[]): Extract<Action, { type: "MOVE_WAGON" }> | undefined {
  return legal.find((a): a is Extract<Action, { type: "MOVE_WAGON" }> => a.type === "MOVE_WAGON" && a.path.length === wagonPath.length + 1 && wagonPath.every((v, i) => a.path[i + 1] === v));
}

type Hover = { kind: "vertex"; id: VertexId } | { kind: "edge"; id: EdgeId } | { kind: "hex"; id: HexId } | { kind: "ship"; id: EdgeId } | { kind: "step"; id: VertexId } | { kind: "knight"; id: VertexId } | { kind: "pick"; id: string } | null;

/** The ghost piece shown on a hovered vertex target (docs/phase7-5.md §5). */
function VertexGhost({ action, vertex, color }: { action: Action; vertex: VertexId; color: PlayerColor }) {
  switch (action.type) {
    case "BUILD_CITY":
    case "SPEND_FISH":
      return <CityFigure vertex={vertex} color={color} ghost />;
    case "BUILD_CASTLE":
      return <CastleFigure vertex={vertex} color={color} ghost />;
    // Crown & Castle (docs/phase11.md §11)
    case "BUILD_KNIGHT":
    case "PLACE_FREE_KNIGHT":
    case "RETREAT_KNIGHT":
      return <KnightFigure vertex={vertex} color={color} level={1} active={false} ghost />;
    case "KNIGHT_MOVE":
    case "KNIGHT_DISPLACE":
      return <KnightFigure vertex={vertex} color={color} level={1} active ghost />;
    case "BUILD_WALL":
      return <CrownCityFigure vertex={vertex} color={color} walled metropolis={null} ghost />;
    case "PLACE_METROPOLIS":
      return <CrownCityFigure vertex={vertex} color={color} walled={false} metropolis="trade" ghost />;
    case "CHOOSE_DOWNGRADE":
      return <SettlementFigure vertex={vertex} color={color} ghost />;
    case "CHOOSE_DESERTER":
      return null;
    case "PLAY_PROGRESS":
      if (action.card === "engineer") return <CrownCityFigure vertex={vertex} color={color} walled metropolis={null} ghost />;
      if (action.card === "medicine") return <CityFigure vertex={vertex} color={color} ghost />;
      return null;
    default:
      return <SettlementFigure vertex={vertex} color={color} ghost />;
  }
}

export function InteractionLayer({ targets, color, onAction, onHover, onPickShip, onPickStep, onPickKnight, onPick }: { targets: Targets; color: PlayerColor; onAction: (a: Action) => void; onHover?: (h: Hover) => void; onPickShip?: (edge: EdgeId) => void; onPickStep?: (vertex: VertexId) => void; onPickKnight?: (vertex: VertexId) => void; onPick?: (id: string) => void }) {
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
  const releaseKnight = (key: string, vertex: VertexId) => (e: ThreeEvent<PointerEvent>) => {
    stop(e);
    if (pressed.current === key) onPickKnight?.(vertex);
    pressed.current = null;
  };
  const releasePick = (key: string, id: string) => (e: ThreeEvent<PointerEvent>) => {
    stop(e);
    if (pressed.current === key) onPick?.(id);
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
            {hovered && <VertexGhost action={action} vertex={v} color={color} />}
          </group>
        );
      })}
      {/* Crown & Castle (docs/phase11.md §11): your knights, and the first pick of a two-step card. */}
      {[...targets.knights].map((v) => {
        const p = vertexWorld(v);
        const key = `k:${v}`;
        const hovered = hover?.kind === "knight" && hover.id === v;
        return (
          <group key={key} position={[p.x, SLAB_HEIGHT, p.z]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={releaseKnight(key, v)} onClick={stop} onPointerOver={(e) => (stop(e), set({ kind: "knight", id: v }))} onPointerOut={() => set(null)} position={[0, 0.25, 0]} userData={{ target: key }}>
              <sphereGeometry args={[0.3, 10, 8]} />
              {invisible}
            </mesh>
            <mesh
              ref={(el) => {
                if (el) rings.current.push(el);
              }}
              position={[0, 0.01, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.28, 0.36, 28]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.5} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {[...targets.picks.vertices].map((v) => {
        const p = vertexWorld(v);
        const key = `pv:${v}`;
        const hovered = hover?.kind === "pick" && hover.id === v;
        return (
          <group key={key} position={[p.x, SLAB_HEIGHT, p.z]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={releasePick(key, v)} onClick={stop} onPointerOver={(e) => (stop(e), set({ kind: "pick", id: v }))} onPointerOut={() => set(null)} position={[0, 0.2, 0]} userData={{ target: key }}>
              <sphereGeometry args={[0.28, 10, 8]} />
              {invisible}
            </mesh>
            <mesh
              ref={(el) => {
                if (el) rings.current.push(el);
              }}
              position={[0, 0.01, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.24, 0.34, 28]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.6} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {[...targets.picks.edges].map((e) => {
        const { mid, angle } = edgeWorld(e);
        const key = `pe:${e}`;
        const hovered = hover?.kind === "pick" && hover.id === e;
        return (
          <group key={key} position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={releasePick(key, e)} onClick={stop} onPointerOver={(ev) => (stop(ev), set({ kind: "pick", id: e }))} onPointerOut={() => set(null)} position={[0, 0.08, 0]} userData={{ target: key }}>
              <boxGeometry args={[0.8, 0.22, 0.3]} />
              {invisible}
            </mesh>
            <mesh position={[0, 0.09, 0]}>
              <boxGeometry args={[0.82, 0.03, 0.2]} />
              <meshStandardMaterial color={accent} transparent opacity={hovered ? 0.85 : 0.45} emissive={accent} emissiveIntensity={hovered ? 0.6 : 0.25} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {[...targets.picks.hexes].map((h) => {
        const c = hexWorld(h);
        const key = `ph:${h}`;
        const hovered = hover?.kind === "pick" && hover.id === h;
        return (
          <group key={key} position={[c.x, SLAB_HEIGHT + 0.005, c.z]}>
            <mesh layers={INTERACTION_LAYER} onPointerDown={press(key)} onPointerUp={releasePick(key, h)} onClick={stop} onPointerOver={(ev) => (stop(ev), set({ kind: "pick", id: h }))} onPointerOut={() => set(null)} rotation={[-Math.PI / 2, 0, 0]} userData={{ target: key }}>
              <circleGeometry args={[0.9, 6]} />
              {invisible}
            </mesh>
            <mesh rotation={[-Math.PI / 2, Math.PI / 6, 0]} position={[0, 0.01, 0]}>
              <ringGeometry args={[0.8, 0.96, 6]} />
              <meshBasicMaterial color={accent} transparent opacity={hovered ? 0.95 : 0.6} depthWrite={false} />
            </mesh>
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
        const merchant = action.type === "PLAY_PROGRESS" && action.card === "merchant";
        const o = pirate ? pirateOffset() : guard ? guardOffset(0) : merchant ? merchantOffset() : robberOffset();
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
            {hovered && action.type !== "REBUILD_HEX" && !(action.type === "PLAY_PROGRESS" && action.card === "inventor") && (
              <group position={[o.dx, 0, o.dz]}>
                {pirate ? <PirateFigure ghost /> : guard ? <GuardFigure color={color} ghost /> : merchant ? <MerchantFigure ghost /> : <RobberFigure ghost />}
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
