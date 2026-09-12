"use client";

/**
 * The diorama board (docs/phase7-5.md §2): one Canvas with the camera rig,
 * lights, table, tiles, props, harbours, pieces, robber, interaction layer,
 * dice, projector and quality-gated post-processing. Accessible target
 * buttons are laid over the canvas at projected positions so keyboard and
 * assistive users (and the e2e specs) can act without raycasting.
 */

import { EffectComposer, TiltShift2, Vignette } from "@react-three/postprocessing";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Action, EdgeId, HexId, PlayerColor, Terrain } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { useAnchors } from "@/components/anim/anchors";
import { CameraRig } from "./Camera";
import { AnimatedPirate, AnimatedRobber, DiceTray3D, Projector, projectWorld, type CameraSnapshot } from "./Effects3d";
import { Harbor } from "./Harbor";
import { INTERACTION_LAYER, InteractionLayer, computeTargets, type TargetMode } from "./Interaction";
import { boardBounds, hexWorld, edgeWorld, vertexWorld, SLAB_HEIGHT, type World } from "./layout3d";
import { CityFigure, RoadFigure, SettlementFigure, ShipFigure } from "./Pieces";
import { Props } from "./Props";
import { FrameWatchdog, QUALITY_PRESETS, detectQuality, readDeviceInfo, type Quality } from "./quality";
import { woodTexture } from "./textures";
import { Tiles, type TileInfo } from "./Tiles";

export type { TargetMode };

export interface Board3DProps {
  view: RedactedState;
  legal: Action[];
  mode: TargetMode;
  /** Move-ship mode: the ship picked so far (docs/phase9.md §8). */
  moveFrom?: EdgeId | null;
  onPickShip?: (edge: EdgeId) => void;
  meColor: PlayerColor;
  onAction: (action: Action) => void;
  step?: Step | null;
  onSkip?: (() => void) | undefined;
  /** Esc / tap on empty table cancels targeting mode. */
  onCancelMode?: () => void;
  /** Effective quality (after auto-detection and step-downs). */
  quality: Quality;
  /** The watchdog asked for one step down (docs/phase7-5.md §7). */
  onDegrade?: (next: Quality) => void;
  /** Auto-detection result on first load, when the setting is "auto". */
  onDetected?: (q: Quality) => void;
  followTurns?: boolean;
  /** HTML anchored to a hex (the steal popover). */
  overlay?: { hex: HexId; node: ReactNode } | null;
  /** Editor mode: top-down orthographic-ish framing and ghost cells (Phase 8). */
  children?: ReactNode;
}

function Lights({ shadows, bounds }: { shadows: boolean; bounds: { cx: number; cz: number; radius: number } }) {
  const r = bounds.radius * 1.6;
  return (
    <>
      <hemisphereLight args={["#cfe3f0", "#4a3a2a", 0.55]} />
      <directionalLight
        position={[bounds.cx - r * 0.9, r * 1.1, bounds.cz - r * 0.6]}
        intensity={2.1}
        color="#fff1d6"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={0.5}
        shadow-camera-far={r * 4}
      />
    </>
  );
}

function Table({ bounds, shadows, onTap, onDoubleTap }: { bounds: { cx: number; cz: number; radius: number }; shadows: boolean; onTap: () => void; onDoubleTap: () => void }) {
  const texture = useMemo(() => woodTexture(), []);
  const size = bounds.radius * 8;
  return (
    <mesh position={[bounds.cx, -0.02, bounds.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows} layers={INTERACTION_LAYER} onClick={onTap} onDoubleClick={onDoubleTap} name="table">
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={texture} roughness={0.9} color="#a58a70" />
    </mesh>
  );
}

function Watchdog({ onDegrade }: { onDegrade: () => void }) {
  const dog = useMemo(() => new FrameWatchdog(33, 3000), []);
  const fired = useRef(false);
  useFrame((_, delta) => {
    if (fired.current) return;
    if (dog.sample(delta * 1000, performance.now())) {
      fired.current = true;
      onDegrade();
      setTimeout(() => (fired.current = false), 10_000);
    }
  });
  return null;
}

function Detector({ onDetected }: { onDetected: (q: Quality) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const ctx = gl.getContext();
    onDetected(detectQuality(readDeviceInfo(ctx)));
  }, [gl, onDetected]);
  return null;
}

export function Board3D(props: Board3DProps) {
  const { view, legal, mode, moveFrom = null, onPickShip, meColor, onAction, step = null, onSkip, onCancelMode, quality, onDegrade, onDetected, followTurns = false, overlay = null, children } = props;
  const preset = QUALITY_PRESETS[quality];
  const anchors = useAnchors();
  const [resetToken, setResetToken] = useState(0);
  const snapshot = useRef<CameraSnapshot | null>(null);
  const [camVersion, setCamVersion] = useState(0);
  const bumpCamera = useCallback(() => setCamVersion((v) => v + 1), []);

  const hexIds = useMemo(() => Object.keys(view.board.hexes) as HexId[], [view.board]);
  const tiles: TileInfo[] = useMemo(
    () => [
      ...hexIds.map((id) => {
        const t = view.board.hexes[id]!;
        return { id, kind: "land" as const, terrain: t.terrain as Terrain | "gold", token: t.token };
      }),
      ...view.board.sea.map((id) => ({ id, kind: "sea" as const, terrain: null, token: null })),
      ...view.board.frame.map((id) => ({ id, kind: "frame" as const, terrain: null, token: null })),
    ],
    [hexIds, view.board],
  );
  const landHexes = useMemo(() => tiles.filter((t) => t.kind === "land" && t.terrain).map((t) => ({ id: t.id, terrain: t.terrain as Terrain | "gold" })), [tiles]);
  const landSet = useMemo(() => new Set(hexIds), [hexIds]);
  const bounds = useMemo(() => boardBounds([...hexIds, ...view.board.sea]), [hexIds, view.board.sea]);
  const centre = useMemo<World>(() => ({ x: bounds.cx, z: bounds.cz }), [bounds]);
  const targets = useMemo(() => computeTargets(legal, view.phase.kind, mode, moveFrom), [legal, view.phase.kind, mode, moveFrom]);

  // Anchors: hex/vertex/edge → viewport through the camera (flying cards).
  useEffect(() => {
    anchors.setProjector((key) => {
      const [kind, id] = key.split(":", 2);
      const snap = snapshot.current;
      if (!id || !snap) return null;
      const world = kind === "hex" ? hexWorld(id) : kind === "vertex" ? vertexWorld(id) : kind === "edge" ? edgeWorld(id).mid : null;
      if (!world) return null;
      const p = projectWorld(snap, world, SLAB_HEIGHT + 0.2);
      return p.visible ? { x: snap.rect.left + p.x, y: snap.rect.top + p.y } : null;
    });
    return () => anchors.setProjector(null);
  }, [anchors]);

  // Overlay buttons for every target (accessibility and tests).
  const points = useMemo(() => {
    const out: { key: string; world: World; y: number }[] = [];
    for (const v of targets.vertices.keys()) out.push({ key: `target-vertex-${v}`, world: vertexWorld(v), y: SLAB_HEIGHT + 0.1 });
    for (const e of targets.edges.keys()) out.push({ key: `target-edge-${e}`, world: edgeWorld(e).mid, y: SLAB_HEIGHT + 0.05 });
    for (const h of targets.hexes.keys()) out.push({ key: `target-hex-${h}`, world: hexWorld(h), y: SLAB_HEIGHT + 0.1 });
    for (const e of targets.ships) out.push({ key: `target-ship-${e}`, world: edgeWorld(e).mid, y: SLAB_HEIGHT + 0.2 });
    if (overlay) out.push({ key: "overlay", world: hexWorld(overlay.hex), y: SLAB_HEIGHT + 0.3 });
    return out;
  }, [targets, overlay]);
  // Synchronous projection: overlay buttons change in the same render as the legal targets.
  const projected = useMemo(() => {
    const snap = snapshot.current;
    void camVersion;
    if (!snap) return [];
    const v = new THREE.Vector3();
    return points.map((p) => ({ key: p.key, ...projectWorld(snap, p.world, p.y, v) }));
  }, [points, camVersion]);
  const actionFor = useCallback(
    (key: string): Action | null => {
      if (key.startsWith("target-vertex-")) return targets.vertices.get(key.slice("target-vertex-".length)) ?? null;
      if (key.startsWith("target-edge-")) return targets.edges.get(key.slice("target-edge-".length)) ?? null;
      if (key.startsWith("target-hex-")) return targets.hexes.get(key.slice("target-hex-".length)) ?? null;
      return null;
    },
    [targets],
  );

  // Animation cues.
  const event = step?.kind === "event" ? step.event : null;
  const justBuilt = event?.kind === "built" ? event : null;
  const freshShip = event?.kind === "shipBuilt" ? { at: event.at, seq: event.seq } : event?.kind === "shipMoved" ? { at: event.to, seq: event.seq } : null;
  const rolled = event?.kind === "diceRolled" ? event.dice[0] + event.dice[1] : null;
  const rollKey = event?.kind === "diceRolled" ? event.seq : null;
  const blockedHex = event?.kind === "productionBlocked" ? event.hex : null;
  const focus = useMemo<World | null>(() => {
    if (!followTurns || event?.kind !== "turnStarted" || event.playerId === view.viewer) return null;
    const p = view.players.find((x) => x.id === event.playerId);
    if (!p) return null;
    const spots = [...p.settlements, ...p.cities].map(vertexWorld);
    if (spots.length === 0) return null;
    return { x: spots.reduce((n, s) => n + s.x, 0) / spots.length, z: spots.reduce((n, s) => n + s.z, 0) / spots.length };
  }, [followTurns, event, view]);
  const hero = useMemo<World | null>(() => {
    if (view.phase.kind !== "ended" || !view.winner) return null;
    const p = view.players.find((x) => x.id === view.winner);
    const spots = p ? [...p.settlements, ...p.cities].map(vertexWorld) : [];
    if (spots.length === 0) return null;
    return { x: spots.reduce((n, s) => n + s.x, 0) / spots.length, z: spots.reduce((n, s) => n + s.z, 0) / spots.length };
  }, [view]);

  const me = view.players.find((p) => p.id === view.viewer);
  const myVertices = useMemo(() => new Set([...(me?.settlements ?? []), ...(me?.cities ?? [])]), [me]);
  const layers = useMemo(() => {
    const l = new THREE.Layers();
    l.set(INTERACTION_LAYER);
    return l;
  }, []);

  const overlayPos = projected.find((p) => p.key === "overlay");

  return (
    <div className="relative h-full w-full" data-testid="board3d" data-quality={quality}>
      <Canvas
        shadows={preset.shadows ? { type: THREE.PCFSoftShadowMap } : false}
        dpr={[1, preset.dpr]}
        raycaster={{ layers }}
        gl={{ antialias: quality !== "low", powerPreference: "high-performance" }}
        onPointerMissed={() => {
          if (onSkip) onSkip();
          else onCancelMode?.();
        }}
        style={{ touchAction: "none" }}
      >
        <color attach="background" args={["#2a1c13"]} />
        <CameraRig bounds={bounds} resetToken={resetToken} focus={focus} hero={hero} />
        <Lights shadows={preset.shadows} bounds={bounds} />
        <Table bounds={bounds} shadows={preset.shadows} onTap={() => (onSkip ? onSkip() : onCancelMode?.())} onDoubleTap={() => setResetToken((t) => t + 1)} />
        <group name="board">
          <Tiles tiles={tiles} robberHex={view.robberHex} rolled={rolled} rollKey={rollKey} blockedHex={blockedHex} shadows={preset.shadows} />
          <Props hexes={landHexes} density={preset.propDensity} idle={preset.idleMotion} shadows={preset.shadows} />
          {view.board.ports.map((port) => (
            <Harbor key={port.edge} port={port} centre={centre} owned={port.vertices.some((v) => myVertices.has(v))} shadows={preset.shadows} land={landSet} />
          ))}
          <group name="pieces">
            {view.players.flatMap((p) => [
              ...p.roads.map((e) => <RoadFigure key={`r:${e}`} edge={e} color={p.color} fresh={justBuilt?.piece === "road" && justBuilt.at === e} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />),
              ...p.settlements.map((v) => <SettlementFigure key={`s:${v}`} vertex={v} color={p.color} fresh={justBuilt?.piece === "settlement" && justBuilt.at === v} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />),
              ...p.cities.map((v) => <CityFigure key={`c:${v}`} vertex={v} color={p.color} fresh={justBuilt?.piece === "city" && justBuilt.at === v} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />),
              ...p.ships.map((e) => <ShipFigure key={`sh:${e}`} edge={e} color={p.color} fresh={freshShip?.at === e} seq={freshShip?.seq ?? null} shadows={preset.shadows} />),
            ])}
          </group>
          <AnimatedRobber hex={view.robberHex} shadows={preset.shadows} />
          {view.pirateHex !== null && <AnimatedPirate hex={view.pirateHex} shadows={preset.shadows} />}
          <InteractionLayer targets={targets} color={meColor} onAction={onAction} {...(onPickShip ? { onPickShip } : {})} />
          <DiceTray3D bounds={bounds} dice={view.lastRoll} rollKey={rollKey} shadows={preset.shadows} />
          {children}
        </group>
        <Projector snapshot={snapshot} onChange={bumpCamera} />
        {onDetected && <Detector onDetected={onDetected} />}
        {onDegrade && <Watchdog onDegrade={() => onDegrade(quality)} />}
        {preset.postfx && (
          <EffectComposer enabled multisampling={0}>
            <Vignette offset={0.32} darkness={0.5} />
            <TiltShift2 blur={0.12} taper={0.7} start={[0, 0.42]} end={[0, 0.58]} samples={6} />
          </EffectComposer>
        )}
      </Canvas>

      {/* A text summary of the pieces for assistive tech (and the specs count them here). */}
      <ul className="sr-only" data-testid="board" aria-label="Pieces on the board">
        {view.players.flatMap((p) => [
          ...p.roads.map((e) => (
            <li key={`r:${e}`} data-piece="road" data-color={p.color}>
              {p.name} road on {e}
            </li>
          )),
          ...p.settlements.map((v) => (
            <li key={`s:${v}`} data-piece="settlement" data-color={p.color}>
              {p.name} settlement at {v}
            </li>
          )),
          ...p.cities.map((v) => (
            <li key={`c:${v}`} data-piece="city" data-color={p.color}>
              {p.name} city at {v}
            </li>
          )),
          ...p.ships.map((e) => (
            <li key={`sh:${e}`} data-piece="ship" data-color={p.color}>
              {p.name} ship on {e}
            </li>
          )),
        ])}
        <li data-piece="robber">Robber on {view.robberHex}</li>
        {view.pirateHex !== null && <li data-piece="pirate">Pirate on {view.pirateHex}</li>}
      </ul>

      {/* Accessible targets over the canvas: same actions as the raycast layer. */}
      <div className="pointer-events-none absolute inset-0" data-testid="targets">
        {projected
          .filter((p) => p.visible && p.key !== "overlay")
          .map((p) => {
            if (p.key.startsWith("target-ship-")) {
              const edge = p.key.slice("target-ship-".length);
              return (
                <button
                  key={p.key}
                  type="button"
                  className="pointer-events-auto absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                  style={{ left: p.x, top: p.y }}
                  aria-label={`Move the ship on ${edge}`}
                  data-testid={p.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickShip?.(edge);
                  }}
                />
              );
            }
            const action = actionFor(p.key);
            if (!action) return null;
            const label =
              action.type === "BUILD_CITY"
                ? `Upgrade to city at ${p.key.slice(14)}`
                : action.type === "BUILD_SETTLEMENT"
                  ? `Build settlement at ${p.key.slice(14)}`
                  : action.type === "BUILD_ROAD"
                    ? `Build road on ${p.key.slice(12)}`
                    : action.type === "BUILD_SHIP"
                      ? `Build ship on ${p.key.slice(12)}`
                      : action.type === "MOVE_SHIP"
                        ? `Move ship to ${p.key.slice(12)}`
                        : action.type === "MOVE_ROBBER" && action.target === "pirate"
                          ? `Move pirate to sea hex ${p.key.slice(11)}`
                          : `Move robber to hex ${p.key.slice(11)}`;
            return (
              <button
                key={p.key}
                type="button"
                className="pointer-events-auto absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                style={{ left: p.x, top: p.y }}
                aria-label={label}
                data-testid={p.key}
                data-target={action.type === "MOVE_ROBBER" ? (action.target ?? "robber") : action.type}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(action);
                }}
              />
            );
          })}
      </div>

      {overlay && overlayPos?.visible && (
        <div className="absolute z-20 -translate-x-1/2" style={{ left: overlayPos.x, top: overlayPos.y }}>
          {overlay.node}
        </div>
      )}

      <button type="button" className="parchment absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-xs" onClick={() => setResetToken((t) => t + 1)} data-testid="reset-view" title="Reset view">
        Reset view
      </button>
    </div>
  );
}
