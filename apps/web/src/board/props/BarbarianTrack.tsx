"use client";

/**
 * The barbarian fleet's track on the table (docs/phase12.md §4, docs/rules.md
 * §16.6): a chain of sea hexes hooked onto the board's top-left corner, the
 * way the fleet's tiles attach to a real board, seven markers from the open
 * sea at the far end to a stone landing on the hex against the board, a
 * barbarian longship (docs/props.md §5) that eases (600 ms) one marker per
 * fleet step, and a pill group anchored in screen space above the far end:
 * the fleet's step, active knights and barbarian strength. The DOM pills
 * carry the `fleet-track` attributes the specs read.
 */

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FLEET_STEPS, type HexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { LongshipFigure } from "@/board3d/Crown3d";
import { SEA_HEIGHT, type Bounds } from "@/board3d/layout3d";
import { EVENT_DIE_LABEL } from "@/game/labels";
import { HUD_COPY } from "@/hud/hudCopy";
import { Icon } from "@/hud/icons";
import * as P from "@/board3d/palette";
import { barbarianTrackLayout } from "./layout";

const MOVE_MS = 600;
/** The track's hexes are drawn a hair inside the grid so they read as separate tiles. */
const TILE_INSET = 0.985;

/*
 * Keeping the pills on screen. They are anchored to a world point above the
 * track's open-sea end. On a large Phase 8 board, or after the camera is
 * dragged, that point can project outside the canvas and the pills were
 * clipped by the window edge — "Active knights" rendered as "ctive knights".
 * `pillPosition` below keeps drei's projection but holds the result inside
 * the viewport, clear of the HUD's bands, the left rail and the dice widget.
 */
/** Room the pill block needs; the longest is "Barbarian strength NN". */
const PILL_WIDTH = 190;
const PILL_HEIGHT = 84;
/** Clear of the left rail (80) and the top band (`--hud-top` + `--hud-margin`). */
const GUTTER_LEFT = 96;
const GUTTER_TOP = 124;
const GUTTER_RIGHT = 16;
/** The bottom band plus the dice widget that hangs above the tray. */
const GUTTER_BOTTOM = 190;

const projected = new THREE.Vector3();

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
}

function pillPosition(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): number[] {
  projected.setFromMatrixPosition(el.matrixWorld).project(camera);
  const halfW = size.width / 2;
  const halfH = size.height / 2;
  // Behind the camera, `project` mirrors the point; the clamp below parks it
  // at the near edge either way, which is what we want for a status readout.
  const x = projected.x * halfW + halfW;
  const y = -(projected.y * halfH) + halfH;
  return [clamp(x, GUTTER_LEFT, size.width - PILL_WIDTH - GUTTER_RIGHT), clamp(y, GUTTER_TOP, size.height - GUTTER_BOTTOM - PILL_HEIGHT)];
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function FleetShip({ from, to, key_ }: { from: { x: number; z: number }; to: { x: number; z: number }; key_: number }) {
  const group = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const seen = useRef(key_);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const now = clock.getElapsedTime() * 1000;
    if (seen.current !== key_) {
      seen.current = key_;
      start.current = now;
    }
    const t = start.current === null ? 1 : Math.min(1, (now - start.current) / MOVE_MS);
    const k = easeInOut(t);
    g.position.x = from.x + (to.x - from.x) * k;
    g.position.z = from.z + (to.z - from.z) * k;
    g.position.y = SEA_HEIGHT + 0.005 + Math.sin(k * Math.PI) * 0.18 + Math.sin(now / 600) * 0.01;
    // The longship's hull runs along its local x axis; it keeps its last heading while at rest.
    if (to.x !== from.x || to.z !== from.z) g.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
  });
  return (
    <group ref={group} position={[to.x, SEA_HEIGHT + 0.005, to.z]} rotation={[0, -Math.PI / 4, 0]} name="fleet-ship">
      <LongshipFigure />
    </group>
  );
}

/** The stone landing on the hex against the board: a squat tower on a red disc. */
function Landing({ x, z, shadows }: { x: number; z: number; shadows: boolean }) {
  const y = SEA_HEIGHT;
  return (
    <group position={[x, y, z]} name="fleet-landing">
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 20]} />
        <meshStandardMaterial color="#9b2226" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.13, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.08, 0.1, 0.26, 8]} />
        <meshStandardMaterial color={P.KEEP_WALL} flatShading />
      </mesh>
      <mesh position={[0, 0.31, 0]} castShadow={shadows}>
        <coneGeometry args={[0.105, 0.1, 8]} />
        <meshStandardMaterial color={P.KEEP_CAP} flatShading />
      </mesh>
    </group>
  );
}

export function BarbarianTrack({ view, bounds, shadows = true }: { view: RedactedState; bounds: Bounds; shadows?: boolean }) {
  void bounds;
  const c = view.crown;
  const hexes = useMemo<HexId[]>(() => [...(Object.keys(view.board.hexes) as HexId[]), ...view.board.sea, ...view.board.frame], [view.board]);
  const layout = useMemo(() => barbarianTrackLayout(hexes, FLEET_STEPS), [hexes]);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: P.SEA_SIDE, roughness: 0.6, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ color: P.SEA_TOP, roughness: 0.45, flatShading: true });
    return [side, top, side];
  }, []);
  const previous = useRef(0);
  if (!view.scenario?.crown || !c) return null;
  const strength = view.players.reduce((n, p) => n + p.cities.length, 0);
  const defence = c.knights.filter((k) => k.active).reduce((n, k) => n + k.level, 0);
  const at = (step: number) => (step <= 0 ? layout.start : layout.dots[Math.min(step, FLEET_STEPS) - 1]!);
  const from = at(previous.current);
  const to = at(c.fleet);
  if (previous.current !== c.fleet) previous.current = c.fleet;
  return (
    <group name="barbarian-track">
      {/* The track's sea hexes, from the open sea to the board's corner. */}
      {layout.tiles.map((t, i) => (
        <mesh key={i} material={materials} position={[t.x, SEA_HEIGHT / 2, t.z]} receiveShadow={shadows} name={`fleet-tile:${i}`}>
          <cylinderGeometry args={[TILE_INSET, TILE_INSET, SEA_HEIGHT, 6]} />
        </mesh>
      ))}
      {/* The course: a dotted line of markers, gold once the fleet has passed them. */}
      {layout.dots.map((d, i) => {
        const step = i + 1;
        if (step === FLEET_STEPS) return <Landing key={i} x={d.x} z={d.z} shadows={shadows} />;
        return (
          <mesh key={i} position={[d.x, SEA_HEIGHT + 0.006, d.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.12, 18]} />
            <meshStandardMaterial color={step <= c.fleet ? "#d9a437" : "#efe8d8"} />
          </mesh>
        );
      })}
      <FleetShip from={from} to={to} key_={c.fleet} />
      {/* The pills hang below the chain's far hex, off the table to the left of the board, where nothing else is drawn. */}
      <Html position={[layout.start.x - 0.4, 0.2, layout.start.z + 1.25]} zIndexRange={[5, 0]} calculatePosition={pillPosition} style={{ pointerEvents: "none" }}>
        <div
          className="flex w-max flex-col items-start gap-1"
          role="group"
          aria-label={`Barbarian fleet at step ${c.fleet} of ${FLEET_STEPS}; ${c.attacks} attacks so far`}
          title={`${HUD_COPY.table.barbarians} Strength ${strength} (cities) against defence ${defence} (active knights).`}
          data-testid="fleet-track"
          data-position={c.fleet}
          data-attacks={c.attacks}
        >
          <span className="hud-scene-pill">
            <Icon name="sail" size={12} /> Barbarian fleet <b>{c.fleet}</b>/{FLEET_STEPS}
          </span>
          <span className="hud-scene-pill">
            <Icon name="knight" size={12} /> Active knights <b>{defence}</b>
          </span>
          <span className="hud-scene-pill">
            <Icon name="sail" size={12} /> Barbarian strength <b>{strength}</b>
          </span>
          {c.fleet > 0 && <span className="sr-only" data-testid="fleet-ship">the fleet is at sea</span>}
          <span className="sr-only" data-testid="fleet-odds">
            {strength} vs {defence}
          </span>
          <span className="sr-only" data-testid="fleet-attacks">
            {c.attacks} attack{c.attacks === 1 ? "" : "s"}
          </span>
          {c.lastEvent && (
            <span className="hud-scene-pill" data-testid="last-event-die" title={`Event die: ${EVENT_DIE_LABEL[c.lastEvent]}`}>
              {EVENT_DIE_LABEL[c.lastEvent]}
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}
