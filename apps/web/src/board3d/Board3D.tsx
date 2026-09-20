"use client";

/**
 * The diorama board (docs/phase7-5.md §2): one Canvas with the camera rig,
 * lights, table, tiles, props, harbours, pieces, robber, interaction layer,
 * dice, projector and quality-gated post-processing. Accessible target
 * buttons are laid over the canvas at projected positions so keyboard and
 * assistive users (and the e2e specs) can act without raycasting.
 */

import { Bloom, EffectComposer, TiltShift2, Vignette } from "@react-three/postprocessing";
import { ContactShadows } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Action, EdgeId, HexId, PlayerColor, Terrain, VertexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { useAnchors } from "@/components/anim/anchors";
import { CameraRig } from "./Camera";
import { AnimatedPirate, AnimatedRobber, DiceTray3D, Projector, projectWorld, type CameraSnapshot } from "./Effects3d";
import { Foam } from "./Foam";
import { Harbor } from "./Harbor";
import { INTERACTION_LAYER, InteractionLayer, NO_PICK, computeTargets, targetLabel, targetName, type CrownPick, type TargetMode } from "./Interaction";
import { boardBounds, hexWorld, edgeWorld, vertexWorld, SLAB_HEIGHT, type Bounds, type World } from "./layout3d";
import { TERRAIN_LIFT } from "./slab";
import { DioramaEnvironment } from "./environment";
import { BACKDROP, KEY_LIGHT, FILL_GROUND, FILL_SKY, RIM_LIGHT } from "./palette";
import { CityFigure, RoadFigure, SettlementFigure, ShipFigure } from "./Pieces";
import { Props, type PropHex } from "./Props";
import { FrameWatchdog, QUALITY_PRESETS, detectQuality, readDeviceInfo, type Quality } from "./quality";
import { woodTexture } from "./textures";
import { bankLayout } from "@/board/props/layout";
import { Icon } from "@/hud/icons";
import { Tiles, type TileInfo } from "./Tiles";
import { WayfarersBoard, wayfarersPieceList } from "./Wayfarers3d";
import { CrownBoard, CrownCityFigure, crownCityUpgrades, crownPieceList } from "./Crown3d";

export type { CrownPick, TargetMode };

export interface Board3DProps {
  view: RedactedState;
  legal: Action[];
  mode: TargetMode;
  /** Move-ship mode: the ship picked so far (docs/phase9.md §8). */
  moveFrom?: EdgeId | null;
  onPickShip?: (edge: EdgeId) => void;
  /** Wagon mode (docs/phase10.md §7): the stops picked so far and the pick callback. */
  wagonPath?: readonly VertexId[];
  onPickStep?: (vertex: VertexId) => void;
  /** Crown & Castle (docs/phase11.md §11): the knight being moved / the first pick of a two-step card, and the pick callbacks. */
  crownPick?: CrownPick;
  onPickKnight?: (vertex: VertexId) => void;
  onPick?: (id: string) => void;
  meColor: PlayerColor;
  onAction: (action: Action) => void;
  step?: Step | null;
  onSkip?: (() => void) | undefined;
  /** Esc / tap on empty table cancels targeting mode. */
  onCancelMode?: () => void;
  /** Effective quality (after auto-detection and step-downs). */
  quality: Quality;
  /** The watchdog asked for one step down (docs/phase7-5.md §6). Omit it (a manual preset) and no watchdog runs. */
  onDegrade?: (next: Quality) => void;
  /** Auto-detection result on first load, when the setting is "auto". */
  onDetected?: (q: Quality) => void;
  followTurns?: boolean;
  /** HTML anchored to a hex (the steal popover) or a vertex (the knight menu). */
  overlay?: { hex: HexId; node: ReactNode } | { vertex: VertexId; node: ReactNode } | null;
  /** Editor mode: top-down orthographic-ish framing and ghost cells (Phase 8). */
  children?: ReactNode;
}

/**
 * Key, rim and fill (docs/props.md §6). A warm directional key from azimuth
 * −40°, elevation 42° with PCF soft shadows; a dim cool rim from the opposite
 * side, which draws a lit edge on every figurine without filling the shadows;
 * and a small hemisphere on top of the image-based light in `environment.ts`.
 *
 * The key's shadow camera is fitted to the land, not the whole board. The sea
 * and frame tiles cast nothing worth seeing, and on a board with a wide sea
 * they were taking most of the shadow map's resolution — which is why nothing
 * used to read as standing on anything.
 */
export const KEY_AZIMUTH = (-40 * Math.PI) / 180;
export const KEY_ELEVATION = (42 * Math.PI) / 180;
export const RIM_AZIMUTH = KEY_AZIMUTH + Math.PI;
export const RIM_ELEVATION = (26 * Math.PI) / 180;

/*
 * The key/ambient ratio is the "washed" dial. At key 1.35 with ambient 0.52
 * (env 0.4 + hemisphere 0.12) a lit top face came out at 1.42 against 0.52 in
 * shadow -- 2.7:1, which compresses every form into the same mid band. The
 * stylised low-poly look this board is after runs nearer 4.5:1, so the key
 * goes up and the ambient comes down; the lit value barely moves.
 */
export const KEY_INTENSITY = 1.55;
export const RIM_INTENSITY = 0.3;
export const HEMI_INTENSITY = 0.08;
/** Low has no environment map, so the hemisphere carries the ambient instead. */
export const HEMI_INTENSITY_NO_ENV = 0.34;

/** The shadow frustum reaches this far past the land's radius, so piers and coastal ships still cast. */
export const SHADOW_MARGIN = 1.5;

/**
 * `NeutralToneMapping` (Khronos PBR Neutral) replaces r3f's ACES default. ACES
 * is built for filmed footage and desaturates exactly the saturated mid-tones
 * this palette is made of — it was turning the terrain colours in `palette.ts`
 * to mud. Neutral keeps them and only rolls off the highlights.
 */
export const EXPOSURE = 1.28;
/** The contact-shadow plane clears the land tops' relief (±`LAND_RELIEF`). */
export const CONTACT_LIFT = 0.03;

/**
 * Atmospheric depth. Without fog the board is equally crisp from the near edge
 * to the far one and the table runs to a hard horizon, which flattens the
 * whole scene into a single plane. The fog colour is the backdrop, so the
 * table dissolves into the background instead of ending.
 *
 * Both distances are relative to the board's radius rather than absolute: the
 * camera frames the board by its radius (`framingDistance`), so this keeps the
 * same look on a Beginner board and on a large Phase 8 one.
 */
/*
 * These bracket a narrow range on purpose. The camera frames the board by its
 * radius (`framingDistance` at FOV 32), which puts the board centre about 4x
 * the radius away and the whole visible scene inside roughly 3.3x to 5.5x --
 * so a far plane out at 7x or 9x spreads the gradient over depth the camera
 * never shows and fogs nothing but the top corners. Measured by rendering the
 * fog in magenta and reading off what it actually covered.
 *
 * At 4.0 / 6.0 the board centre is clear, its far edge takes about a third,
 * and the table behind it dissolves into the backdrop.
 */
export const FOG_NEAR = 4;
export const FOG_FAR = 6;

function lightPosition(cx: number, cz: number, azimuth: number, elevation: number, distance: number): [number, number, number] {
  return [cx + distance * Math.cos(elevation) * Math.sin(azimuth), distance * Math.sin(elevation), cz + distance * Math.cos(elevation) * Math.cos(azimuth)];
}

function Lights({ shadows, shadowMap, bounds, landBounds, environment }: { shadows: boolean; shadowMap: number; bounds: Bounds; landBounds: Bounds; environment: boolean }) {
  const r = landBounds.radius + SHADOW_MARGIN;
  const d = Math.max(bounds.radius, r) * 2;
  // The key aims at the land's centre. Leaving the target at the world origin
  // put the shadow frustum off the board on any map not centred there.
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(landBounds.cx, 0, landBounds.cz);
    return o;
  }, [landBounds.cx, landBounds.cz]);
  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={[FILL_SKY, FILL_GROUND, environment ? HEMI_INTENSITY : HEMI_INTENSITY_NO_ENV]} />
      <directionalLight
        position={lightPosition(landBounds.cx, landBounds.cz, KEY_AZIMUTH, KEY_ELEVATION, d)}
        target={target}
        intensity={KEY_INTENSITY}
        color={KEY_LIGHT}
        castShadow={shadows}
        shadow-mapSize={[shadowMap || 1024, shadowMap || 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.012}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={0.5}
        shadow-camera-far={d * 2.5}
      />
      <directionalLight position={lightPosition(bounds.cx, bounds.cz, RIM_AZIMUTH, RIM_ELEVATION, d)} intensity={RIM_INTENSITY} color={RIM_LIGHT} />
    </>
  );
}

function Table({ bounds, shadows, onTap, onDoubleTap }: { bounds: { cx: number; cz: number; radius: number }; shadows: boolean; onTap: () => void; onDoubleTap: () => void }) {
  const texture = useMemo(() => woodTexture(), []);
  const size = bounds.radius * 8;
  return (
    <mesh position={[bounds.cx, -0.02, bounds.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows} layers={INTERACTION_LAYER} onClick={onTap} onDoubleClick={onDoubleTap} name="table">
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={texture} roughness={0.85} />
    </mesh>
  );
}

/** Steps down after sustained slow frames (docs/phase7-5.md §6); mounted only while the setting is Auto. */
function Watchdog({ onDegrade }: { onDegrade: () => void }) {
  const dog = useMemo(() => new FrameWatchdog(), []);
  useFrame((_, delta) => {
    if (dog.sample(delta * 1000, performance.now())) onDegrade();
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
  const { view, legal, mode, moveFrom = null, onPickShip, wagonPath = [], onPickStep, crownPick = NO_PICK, onPickKnight, onPick, meColor, onAction, step = null, onSkip, onCancelMode, quality, onDegrade, onDetected, followTurns = false, overlay = null, children } = props;
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
        return { id, kind: "land" as const, terrain: t.terrain as Terrain, token: t.token };
      }),
      ...view.board.sea.map((id) => ({ id, kind: "sea" as const, terrain: null, token: null })),
      ...view.board.frame.map((id) => ({ id, kind: "frame" as const, terrain: null, token: null })),
    ],
    [hexIds, view.board],
  );
  const propHexes = useMemo<PropHex[]>(() => tiles.filter((t) => (t.kind === "land" && t.terrain) || t.kind === "sea").map((t) => ({ id: t.id, terrain: t.kind === "sea" ? "sea" : (t.terrain as Terrain) })), [tiles]);
  const robberCentred = view.board.hexes[view.robberHex]?.token === null;
  const cityUpgrades = useMemo(() => crownCityUpgrades(view), [view]);
  const landSet = useMemo(() => new Set(hexIds), [hexIds]);
  const seaSet = useMemo(() => new Set(view.board.sea), [view.board.sea]);
  /**
   * A tile's interior rides its terrain's centre lift (`TERRAIN_LIFT`), so
   * everything standing at the middle of a hex has to rise with it. Sea and
   * frame cells are not in `board.hexes`, so they fall through to 0.
   */
  const liftOf = useCallback((hex: HexId) => (view.board.hexes[hex]?.terrain ? TERRAIN_LIFT[view.board.hexes[hex]!.terrain as Terrain] : 0), [view.board.hexes]);
  const bounds = useMemo(() => boardBounds([...hexIds, ...view.board.sea]), [hexIds, view.board.sea]);
  // The shadow frustum and the contact-shadow plane are fitted to the land alone.
  const landBounds = useMemo(() => boardBounds(hexIds), [hexIds]);
  const centre = useMemo<World>(() => ({ x: bounds.cx, z: bounds.cz }), [bounds]);
  const targets = useMemo(() => computeTargets(legal, view.phase.kind, mode, moveFrom, wagonPath, crownPick), [legal, view.phase.kind, mode, moveFrom, wagonPath, crownPick]);

  // Anchors: hex/vertex/edge → viewport through the camera (flying cards).
  useEffect(() => {
    anchors.setProjector((key) => {
      const snap = snapshot.current;
      if (!snap) return null;
      // The bank and the deck are props on the table (docs/phase12.md §7): flights aim at their layout spots.
      if (key === "bank" || key === "deck") {
        const layout = bankLayout(bounds, view.scenario?.crown ? 8 : 5);
        const p = projectWorld(snap, key === "bank" ? layout.centre : layout.deck, 0.2);
        return p.visible ? { x: snap.rect.left + p.x, y: snap.rect.top + p.y } : null;
      }
      const [kind, id] = key.split(":", 2);
      if (!id) return null;
      const world = kind === "hex" ? hexWorld(id) : kind === "vertex" ? vertexWorld(id) : kind === "edge" ? edgeWorld(id).mid : null;
      if (!world) return null;
      const p = projectWorld(snap, world, SLAB_HEIGHT + 0.2);
      return p.visible ? { x: snap.rect.left + p.x, y: snap.rect.top + p.y } : null;
    });
    return () => anchors.setProjector(null);
  }, [anchors, bounds, view.scenario?.crown]);

  // Overlay buttons for every target (accessibility and tests).
  const points = useMemo(() => {
    const out: { key: string; world: World; y: number }[] = [];
    for (const v of targets.vertices.keys()) out.push({ key: `target-vertex-${v}`, world: vertexWorld(v), y: SLAB_HEIGHT + 0.1 });
    for (const e of targets.edges.keys()) out.push({ key: `target-edge-${e}`, world: edgeWorld(e).mid, y: SLAB_HEIGHT + 0.05 });
    for (const h of targets.hexes.keys()) out.push({ key: `target-hex-${h}`, world: hexWorld(h), y: SLAB_HEIGHT + 0.1 });
    for (const e of targets.ships) out.push({ key: `target-ship-${e}`, world: edgeWorld(e).mid, y: SLAB_HEIGHT + 0.2 });
    for (const v of targets.steps) out.push({ key: `target-step-${v}`, world: vertexWorld(v), y: SLAB_HEIGHT + 0.1 });
    // Crown & Castle (docs/phase11.md §11)
    for (const v of targets.knights) out.push({ key: `target-knight-${v}`, world: vertexWorld(v), y: SLAB_HEIGHT + 0.3 });
    for (const v of targets.picks.vertices) out.push({ key: `target-pick-${v}`, world: vertexWorld(v), y: SLAB_HEIGHT + 0.1 });
    for (const e of targets.picks.edges) out.push({ key: `target-pick-${e}`, world: edgeWorld(e).mid, y: SLAB_HEIGHT + 0.05 });
    for (const h of targets.picks.hexes) out.push({ key: `target-pick-${h}`, world: hexWorld(h), y: SLAB_HEIGHT + 0.1 });
    if (overlay) out.push({ key: "overlay", world: "hex" in overlay ? hexWorld(overlay.hex) : vertexWorld(overlay.vertex), y: SLAB_HEIGHT + 0.3 });
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
  // Crown & Castle (docs/phase11.md §11): a knight that just arrived pops in; the event die lands with the number dice.
  const freshKnight = event?.kind === "knightBuilt" ? event.vertex : event?.kind === "knightMoved" || event?.kind === "knightDisplaced" ? event.to : event?.kind === "knightRetreated" ? event.to : null;
  const eventDie = view.scenario?.crown ? (view.crown?.lastEvent ?? null) : null;
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
        gl={{ antialias: quality !== "low", powerPreference: "high-performance", toneMapping: THREE.NeutralToneMapping, toneMappingExposure: EXPOSURE }}
        onPointerMissed={() => {
          if (onSkip) onSkip();
          else onCancelMode?.();
        }}
        style={{ touchAction: "none" }}
      >
        <color attach="background" args={[BACKDROP]} />
        <fog attach="fog" args={[BACKDROP, bounds.radius * FOG_NEAR, bounds.radius * FOG_FAR]} />
        <CameraRig bounds={bounds} resetToken={resetToken} focus={focus} hero={hero} />
        <Lights shadows={preset.shadows} shadowMap={preset.shadowMap} bounds={bounds} landBounds={landBounds} environment={preset.envIntensity > 0} />
        <DioramaEnvironment intensity={preset.envIntensity} keyAzimuth={KEY_AZIMUTH} keyElevation={KEY_ELEVATION} />
        <Table bounds={bounds} shadows={preset.shadows} onTap={() => (onSkip ? onSkip() : onCancelMode?.())} onDoubleTap={() => setResetToken((t) => t + 1)} />
        <group name="board">
          <Tiles tiles={tiles} robberHex={view.robberHex} rolled={rolled} rollKey={rollKey} blockedHex={blockedHex} shadows={preset.shadows} idle={preset.idleMotion} />
          {preset.contactShadows && (
            /* Grounding for the pieces and props: the plane sits just clear of the
               tops' relief, so the slabs themselves never darken it. */
            <ContactShadows
              position={[landBounds.cx, SLAB_HEIGHT + CONTACT_LIFT, landBounds.cz]}
              scale={(landBounds.radius + SHADOW_MARGIN) * 2}
              resolution={1024}
              far={0.9}
              blur={2.4}
              opacity={0.5}
              frames={Infinity}
            />
          )}
          <Props hexes={propHexes} density={preset.propDensity} idle={preset.idleMotion} shadows={preset.shadows} />
          <Foam land={landSet} sea={seaSet} centre={centre} />
          {view.board.ports.map((port) => (
            <Harbor key={port.edge} port={port} centre={centre} owned={port.vertices.some((v) => myVertices.has(v))} shadows={preset.shadows} land={landSet} />
          ))}
          <group name="pieces">
            {view.players.flatMap((p) => [
              ...p.roads.map((e) => <RoadFigure key={`r:${e}`} edge={e} color={p.color} fresh={justBuilt?.piece === "road" && justBuilt.at === e} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />),
              ...p.settlements.map((v) => <SettlementFigure key={`s:${v}`} vertex={v} color={p.color} fresh={justBuilt?.piece === "settlement" && justBuilt.at === v} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />),
              ...p.cities.map((v) => {
                const up = cityUpgrades.get(v);
                const fresh = justBuilt?.piece === "city" && justBuilt.at === v;
                return up ? (
                  <CrownCityFigure key={`c:${v}`} vertex={v} color={p.color} walled={up.walled} metropolis={up.metropolis} fresh={fresh} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />
                ) : (
                  <CityFigure key={`c:${v}`} vertex={v} color={p.color} fresh={fresh} seq={justBuilt?.seq ?? null} shadows={preset.shadows} />
                );
              }),
              ...p.ships.map((e) => <ShipFigure key={`sh:${e}`} edge={e} color={p.color} fresh={freshShip?.at === e} seq={freshShip?.seq ?? null} shadows={preset.shadows} />),
            ])}
          </group>
          <WayfarersBoard view={view} shadows={preset.shadows} idle={preset.idleMotion} centre={centre} land={landSet} />
          <CrownBoard view={view} shadows={preset.shadows} freshKnight={freshKnight} liftOf={liftOf} />
          <AnimatedRobber hex={view.robberHex} shadows={preset.shadows} centred={robberCentred} liftOf={liftOf} />
          {view.pirateHex !== null && <AnimatedPirate hex={view.pirateHex} shadows={preset.shadows} />}
          <InteractionLayer targets={targets} color={meColor} onAction={onAction} idle={preset.idleMotion} liftOf={liftOf} {...(onPickShip ? { onPickShip } : {})} {...(onPickStep ? { onPickStep } : {})} {...(onPickKnight ? { onPickKnight } : {})} {...(onPick ? { onPick } : {})} />
          <DiceTray3D bounds={bounds} dice={view.lastRoll} rollKey={rollKey} shadows={preset.shadows} eventDie={eventDie} redDie={view.scenario?.crown === true} />
          {children}
        </group>
        <Projector snapshot={snapshot} onChange={bumpCamera} />
        {onDetected && <Detector onDetected={onDetected} />}
        {onDegrade && <Watchdog onDegrade={() => onDegrade(quality)} />}
        {preset.postfx && (
          <EffectComposer enabled multisampling={0}>
            {/* Only the lit openings clear this threshold; the board's own
                highlights stay under it, so the bloom reads as lamplight
                rather than a haze over everything. */}
            {preset.bloom ? <Bloom intensity={0.8} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur radius={0.65} /> : <></>}
            <Vignette offset={0.55} darkness={0.22} />
            <TiltShift2 blur={0.35} taper={0.8} start={[0, 0.5]} end={[1, 0.5]} direction={[0, 1]} samples={8} />
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
        {[...wayfarersPieceList(view), ...crownPieceList(view)].map((item) => (
          <li key={item.key} data-piece={item.piece} data-color={item.color}>
            {item.text}
          </li>
        ))}
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
            // Crown & Castle (docs/phase11.md §11): knight picks and the first pick of a two-step card.
            if (p.key.startsWith("target-knight-")) {
              const vertex = p.key.slice("target-knight-".length);
              return (
                <button
                  key={p.key}
                  type="button"
                  className="pointer-events-auto absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                  style={{ left: p.x, top: p.y }}
                  aria-label={`Your knight at ${vertex}`}
                  data-testid={p.key}
                  data-target="knightAct"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickKnight?.(vertex);
                  }}
                />
              );
            }
            if (p.key.startsWith("target-pick-")) {
              const id = p.key.slice("target-pick-".length);
              return (
                <button
                  key={p.key}
                  type="button"
                  className="pointer-events-auto absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                  style={{ left: p.x, top: p.y }}
                  aria-label={`Choose ${id} first`}
                  data-testid={p.key}
                  data-target={`pick:${mode ?? ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick?.(id);
                  }}
                />
              );
            }
            if (p.key.startsWith("target-step-")) {
              const vertex = p.key.slice("target-step-".length);
              return (
                <button
                  key={p.key}
                  type="button"
                  className="pointer-events-auto absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                  style={{ left: p.x, top: p.y }}
                  aria-label={`Drive the wagon to ${vertex}`}
                  data-testid={p.key}
                  data-target="wagon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickStep?.(vertex);
                  }}
                />
              );
            }
            const action = actionFor(p.key);
            if (!action) return null;
            const id = p.key.startsWith("target-vertex-") ? p.key.slice(14) : p.key.startsWith("target-edge-") ? p.key.slice(12) : p.key.slice(11);
            return (
              <button
                key={p.key}
                type="button"
                className="pointer-events-auto absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                style={{ left: p.x, top: p.y }}
                aria-label={targetLabel(action, id)}
                data-testid={p.key}
                data-target={targetName(action)}
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

      <button type="button" className="hud-icon-btn hud-panel hud-camera" onClick={() => setResetToken((t) => t + 1)} data-testid="reset-view" title="Reset view" aria-label="Reset view">
        <Icon name="camera" />
      </button>
    </div>
  );
}
