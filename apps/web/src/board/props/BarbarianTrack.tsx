"use client";

/**
 * The barbarian fleet's track on the table (docs/phase12.md §7, docs/rules.md
 * §16.6): seven dot markers on a circle beside the top-left sea edge, a
 * barbarian longship (docs/props.md §5) that eases (600 ms) one dot per fleet step, and two pills
 * anchored in screen space: active knights and barbarian strength. The DOM
 * pills carry the `fleet-track` attributes the specs read.
 */

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FLEET_STEPS } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { LongshipFigure } from "@/board3d/Crown3d";
import type { Bounds } from "@/board3d/layout3d";
import { EVENT_DIE_LABEL } from "@/game/labels";
import { HUD_COPY } from "@/hud/hudCopy";
import { Icon } from "@/hud/icons";
import { barbarianTrackLayout } from "./layout";

const MOVE_MS = 600;

/*
 * Keeping the pills on screen. They are anchored to a world point beside the
 * track, which sits off the board's top-left corner (`barbarianTrackLayout`).
 * On a wide viewport, or a large Phase 8 board, that point projects outside
 * the canvas and the pills were clipped by the window edge — "Active knights"
 * rendered as "ctive knights". `pillPosition` below keeps drei's projection
 * but holds the result inside the viewport, clear of the HUD's top band and
 * left rail.
 */
/** Room the pill block needs; the longest is "Barbarian strength NN". */
const PILL_WIDTH = 190;
const PILL_HEIGHT = 56;
/** Clear of the left rail (80) and the top band (`--hud-top` + `--hud-margin`). */
const GUTTER_LEFT = 96;
const GUTTER_TOP = 112;
const GUTTER_RIGHT = 16;
const GUTTER_BOTTOM = 120;

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
  return [clamp(x, GUTTER_LEFT, size.width - PILL_WIDTH - GUTTER_RIGHT), clamp(y, GUTTER_TOP + PILL_HEIGHT / 2, size.height - GUTTER_BOTTOM)];
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
    g.position.y = 0.06 + Math.sin(k * Math.PI) * 0.18 + Math.sin(now / 600) * 0.01;
    // The longship's hull runs along its local x axis.
    g.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
  });
  return (
    <group ref={group} position={[to.x, 0.06, to.z]} name="fleet-ship">
      <LongshipFigure />
    </group>
  );
}

export function BarbarianTrack({ view, bounds }: { view: RedactedState; bounds: Bounds }) {
  const c = view.crown;
  const layout = useMemo(() => barbarianTrackLayout(bounds, FLEET_STEPS), [bounds]);
  const previous = useRef(0);
  if (!view.scenario?.crown || !c) return null;
  const strength = view.players.reduce((n, p) => n + p.cities.length, 0);
  const defence = c.knights.filter((k) => k.active).reduce((n, k) => n + k.level, 0);
  const at = (step: number) => (step <= 0 ? layout.centre : layout.dots[Math.min(step, FLEET_STEPS) - 1]!);
  const from = at(previous.current);
  const to = at(c.fleet);
  if (previous.current !== c.fleet) previous.current = c.fleet;
  return (
    <group name="barbarian-track">
      <mesh position={[layout.centre.x, 0.005, layout.centre.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[layout.radius - 0.03, layout.radius + 0.03, 48]} />
        <meshStandardMaterial color="#2e2318" roughness={1} />
      </mesh>
      {layout.dots.map((d, i) => {
        const step = i + 1;
        const last = step === FLEET_STEPS;
        return (
          <mesh key={i} position={[d.x, 0.015, d.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[last ? 0.16 : 0.1, 16]} />
            <meshStandardMaterial color={last ? "#9b2226" : step <= c.fleet ? "#d9a437" : "#efe8d8"} />
          </mesh>
        );
      })}
      <FleetShip from={from} to={to} key_={c.fleet} />
      <Html position={[layout.centre.x + layout.radius + 0.25, 0.25, layout.centre.z]} zIndexRange={[5, 0]} calculatePosition={pillPosition} style={{ pointerEvents: "none", transform: "translateY(-50%)" }}>
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
