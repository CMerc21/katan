"use client";

/**
 * Tiles (docs/phase7-5.md §1): thick bevelled hex slabs with seeded tilt and
 * height jitter, thinner translucent sea tiles, clay number tokens that
 * bounce on a matching roll, dim and shake when the robber blocks them.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { HexId, Terrain } from "@katan/engine";
import { TERRAIN_FILL, WATER } from "@/game/theme";
import { hexShape } from "./geo";
import { HEX_RADIUS, SEA_HEIGHT, SLAB_HEIGHT, hexWorld, tileJitter } from "./layout3d";
import { tokenTexture } from "./textures";

export interface TileInfo {
  readonly id: HexId;
  readonly kind: "land" | "sea" | "frame";
  readonly terrain: Terrain | "gold" | null;
  readonly token: number | null;
}

function useSlabGeometry(depth: number): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const g = new THREE.ExtrudeGeometry(hexShape(HEX_RADIUS - 0.02), { depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2, steps: 1 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [depth]);
}

const TERRAIN_COLORS: Record<Terrain | "gold", string> = { ...TERRAIN_FILL, gold: "#e0b43a" };

function useTerrainMaterials(): Record<Terrain | "gold" | "sea" | "frame", THREE.MeshStandardMaterial> {
  return useMemo(() => {
    const out = {} as Record<Terrain | "gold" | "sea" | "frame", THREE.MeshStandardMaterial>;
    for (const [t, c] of Object.entries(TERRAIN_COLORS)) out[t as Terrain | "gold"] = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.95 });
    out.sea = new THREE.MeshStandardMaterial({ color: WATER, flatShading: true, roughness: 0.4, transparent: true, opacity: 0.85 });
    out.frame = new THREE.MeshStandardMaterial({ color: "#5a4030", flatShading: true, roughness: 0.95 });
    return out;
  }, []);
}

function Token({ n, x, z, y, bounceKey, dim }: { n: number; x: number; z: number; y: number; bounceKey: number | null; dim: boolean }) {
  const group = useRef<THREE.Group>(null);
  const texture = useMemo(() => tokenTexture(n), [n]);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: "#b8905f", roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, transparent: true });
    return [side, top, side];
  }, [texture]);
  const lastKey = useRef<number | null>(null);
  const started = useRef(0);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const now = clock.getElapsedTime() * 1000;
    if (bounceKey !== null && bounceKey !== lastKey.current) {
      lastKey.current = bounceKey;
      started.current = now;
    }
    const t = Math.min(1, (now - started.current) / 400);
    const lift = bounceKey !== null && t < 1 ? Math.sin(t * Math.PI) * 0.1 : 0;
    g.position.y = y + lift;
    (materials[1] as THREE.MeshStandardMaterial).opacity += ((dim ? 0.35 : 1) - (materials[1] as THREE.MeshStandardMaterial).opacity) * 0.2;
  });
  return (
    <group ref={group} position={[x, y, z]}>
      <mesh material={materials} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 32]} />
      </mesh>
    </group>
  );
}

/** Gold fields glitter (docs/phase9.md §8): three tiny specks that twinkle out of phase. */
function GoldGlitter({ x, z, y }: { x: number; z: number; y: number }) {
  const specks = useRef<THREE.Mesh[]>([]);
  specks.current = [];
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    specks.current.forEach((m, i) => {
      const k = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 2.1 + x);
      m.scale.setScalar(0.5 + k);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.35 + k * 0.6;
    });
  });
  const spots: [number, number][] = [
    [0.45, 0.2],
    [-0.5, 0.35],
    [0.1, -0.55],
  ];
  return (
    <group position={[x, y, z]}>
      {spots.map(([dx, dz], i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) specks.current.push(el);
          }}
          position={[dx, 0.02, dz]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.035, 5]} />
          <meshBasicMaterial color="#fff2b0" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Tiles({ tiles, robberHex, rolled, rollKey, blockedHex, shadows }: { tiles: TileInfo[]; robberHex: HexId; rolled: number | null; rollKey: number | null; blockedHex: HexId | null; shadows: boolean }) {
  const land = useSlabGeometry(SLAB_HEIGHT);
  const sea = useSlabGeometry(SEA_HEIGHT);
  const materials = useTerrainMaterials();
  const shaking = useRef<THREE.Group>(null);
  const shakeStart = useRef(0);
  const shakeKey = useRef<string | null>(null);
  useFrame(({ clock }) => {
    const g = shaking.current;
    if (!g) return;
    const now = clock.getElapsedTime() * 1000;
    if (blockedHex && shakeKey.current !== `${blockedHex}:${rollKey}`) {
      shakeKey.current = `${blockedHex}:${rollKey}`;
      shakeStart.current = now;
    }
    const t = (now - shakeStart.current) / 300;
    const a = t < 1 ? (1 - t) * 0.03 : 0;
    g.position.x = Math.sin(now / 12) * a;
    g.position.z = Math.cos(now / 9) * a;
  });

  return (
    <group name="tiles">
      {tiles.map((tile) => {
        const c = hexWorld(tile.id);
        const j = tileJitter(tile.id);
        const isSea = tile.kind === "sea";
        const isFrame = tile.kind === "frame";
        const mat = isSea ? materials.sea : isFrame ? materials.frame : materials[tile.terrain ?? "wasteland"];
        const top = (isSea ? SEA_HEIGHT : SLAB_HEIGHT) * j.height;
        const blocked = blockedHex === tile.id;
        const slab = (
          <mesh geometry={isSea ? sea : land} material={mat} position={[c.x, isSea ? -0.04 : 0, c.z]} rotation={[j.tiltX, 0, j.tiltZ]} scale={[1, j.height, 1]} receiveShadow={shadows} castShadow={shadows} />
        );
        const token = tile.token !== null && !isSea ? <Token n={tile.token} x={c.x} z={c.z} y={top + 0.02} bounceKey={rolled === tile.token && tile.id !== robberHex ? rollKey : null} dim={blocked} /> : null;
        const glitter = tile.terrain === "gold" ? <GoldGlitter x={c.x} z={c.z} y={top} /> : null;
        return blocked ? (
          <group key={tile.id} ref={shaking}>
            {slab}
            {token}
            {glitter}
          </group>
        ) : (
          <group key={tile.id}>
            {slab}
            {token}
            {glitter}
          </group>
        );
      })}
    </group>
  );
}
