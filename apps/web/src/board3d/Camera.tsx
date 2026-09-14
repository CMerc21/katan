"use client";

/**
 * Camera rig (docs/phase7-5.md §3): damped orbit around the board centroid
 * with elevation and zoom limits, reset, an optional gentle "follow turns"
 * move, and a hero angle at the end of the game. Touch: one finger orbits,
 * two fingers zoom and pan.
 */

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { easeInOut } from "./geo";
import { DEFAULT_AZIMUTH, DEFAULT_ELEVATION, framingDistance, type Bounds, type World } from "./layout3d";

export { DEFAULT_AZIMUTH, DEFAULT_ELEVATION } from "./layout3d";
export const MIN_ELEVATION = (20 * Math.PI) / 180;
export const MAX_ELEVATION = (80 * Math.PI) / 180;
export const FOV = 40;

export function defaultCameraPosition(bounds: Bounds, aspect: number): THREE.Vector3 {
  const d = framingDistance(bounds.radius, FOV, aspect, 0.1);
  return new THREE.Vector3(bounds.cx + d * Math.cos(DEFAULT_ELEVATION) * Math.sin(DEFAULT_AZIMUTH), d * Math.sin(DEFAULT_ELEVATION), bounds.cz + d * Math.cos(DEFAULT_ELEVATION) * Math.cos(DEFAULT_AZIMUTH));
}

interface Move {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  ms: number;
}

export interface CameraRigProps {
  bounds: Bounds;
  /** Bump to reset the view. */
  resetToken: number;
  /** A world point to ease toward (follow turns); null to leave the view alone. */
  focus: World | null;
  /** A world point to frame closely at the end of the game. */
  hero: World | null;
  onMoved?: () => void;
  /** Editor mode (docs/phase7-5.md §8): straight down, elevation locked, orbit disabled. */
  topDown?: boolean;
}

export function CameraRig({ bounds, resetToken, focus, hero, onMoved, topDown = false }: CameraRigProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera, size } = useThree();
  const move = useRef<Move | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  const defaultPos = useMemo(() => {
    if (!topDown) return defaultCameraPosition(bounds, aspect);
    const d = framingDistance(bounds.radius, FOV, aspect, 0.15);
    return new THREE.Vector3(bounds.cx, d, bounds.cz + 0.001);
  }, [bounds, aspect, topDown]);
  const defaultDistance = useMemo(() => framingDistance(bounds.radius, FOV, aspect, 0.1), [bounds, aspect]);
  const target = useMemo(() => new THREE.Vector3(bounds.cx, 0, bounds.cz), [bounds]);

  useEffect(() => {
    camera.layers.enable(1);
  }, [camera]);

  const startMove = (toPos: THREE.Vector3, toTarget: THREE.Vector3, ms: number) => {
    const c = controls.current;
    move.current = { fromPos: camera.position.clone(), toPos, fromTarget: (c ? c.target : target).clone(), toTarget, start: performance.now(), ms };
  };

  // Reset (initial and on demand).
  const lastReset = useRef<number | null>(null);
  const lastTopDown = useRef(topDown);
  useEffect(() => {
    if (lastReset.current === null) {
      lastReset.current = resetToken;
      camera.position.copy(defaultPos);
      controls.current?.target.copy(target);
      controls.current?.update();
      return;
    }
    if (lastReset.current !== resetToken || lastTopDown.current !== topDown) {
      lastReset.current = resetToken;
      lastTopDown.current = topDown;
      startMove(defaultPos.clone(), target.clone(), 400);
    }
  }, [resetToken, defaultPos, target, topDown]);

  // Follow turns: move the orbit target 35% toward the player's side, keeping the offset.
  const lastFocus = useRef<World | null>(null);
  useEffect(() => {
    if (!focus || focus === lastFocus.current) return;
    lastFocus.current = focus;
    const c = controls.current;
    if (!c) return;
    const t = c.target.clone().lerp(new THREE.Vector3(focus.x, 0, focus.z), 0.35);
    const offset = camera.position.clone().sub(c.target);
    startMove(t.clone().add(offset), t, 600);
  }, [focus]);

  // Hero angle on the winner's cluster.
  const lastHero = useRef<World | null>(null);
  useEffect(() => {
    if (!hero || hero === lastHero.current) return;
    lastHero.current = hero;
    const t = new THREE.Vector3(hero.x, 0.1, hero.z);
    const d = defaultDistance * 0.55;
    const az = DEFAULT_AZIMUTH + 0.4;
    const el = (35 * Math.PI) / 180;
    startMove(new THREE.Vector3(t.x + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), t.z + d * Math.cos(el) * Math.cos(az)), t, 1400);
  }, [hero]);

  useFrame(() => {
    const m = move.current;
    const c = controls.current;
    if (m && c) {
      const k = easeInOut(Math.min(1, (performance.now() - m.start) / m.ms));
      camera.position.lerpVectors(m.fromPos, m.toPos, k);
      c.target.lerpVectors(m.fromTarget, m.toTarget, k);
      c.update();
      if (k >= 1) move.current = null;
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault fov={FOV} near={0.1} far={100} position={defaultPos.toArray()} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={topDown ? 0 : Math.PI / 2 - MAX_ELEVATION}
        maxPolarAngle={topDown ? 0.001 : Math.PI / 2 - MIN_ELEVATION}
        enableRotate={!topDown}
        minDistance={defaultDistance * 0.4}
        maxDistance={defaultDistance * 2.2}
        target={target}
        enablePan
        panSpeed={0.6}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        onChange={() => onMoved?.()}
        onStart={() => {
          move.current = null;
        }}
      />
    </>
  );
}
