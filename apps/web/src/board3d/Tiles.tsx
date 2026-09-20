"use client";

/**
 * Tiles (docs/props.md §1, §5): two-layer land slabs with a centre recess
 * and seeded low-poly relief, faceted sea slabs that ripple, walnut frame
 * slabs, and clay number tokens with a raised rim and a recessed face that
 * bounce on a matching roll, dim and shake when the robber blocks them.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HexId, Terrain } from "@katan/engine";
import { hexWorld, tileJitter } from "./layout3d";
import { TOKEN_CLAY, TOKEN_HOT } from "./palette";
import { LAND_HEIGHT, RECESS_DEPTH, SEA_SLAB_HEIGHT, SEA_VARIANTS, TERRAIN_LIFT, buildSlab, seaVariant, type SlabSpec } from "./slab";
import { tokenTexture } from "./textures";

export interface TileInfo {
  readonly id: HexId;
  readonly kind: "land" | "sea" | "frame";
  readonly terrain: Terrain | null;
  readonly token: number | null;
}

export const TOKEN_RADIUS = 0.2;
export const TOKEN_HEIGHT = 0.04;

function useSlabMaterials(): { land: THREE.MeshStandardMaterial; sea: THREE.MeshStandardMaterial } {
  return useMemo(
    () => ({
      land: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
      sea: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35 }),
    }),
    [],
  );
}

/** One geometry per land tile, cached by id and terrain and disposed with the board. */
function useLandGeometries(tiles: TileInfo[]): Map<HexId, THREE.BufferGeometry> {
  const cache = useRef(new Map<string, THREE.BufferGeometry>());
  const out = useMemo(() => {
    const map = new Map<HexId, THREE.BufferGeometry>();
    const live = new Set<string>();
    for (const t of tiles) {
      if (t.kind !== "land") continue;
      const key = `${t.id}:${t.terrain ?? "-"}`;
      live.add(key);
      let g = cache.current.get(key);
      if (!g) {
        const spec: SlabSpec = { kind: "land", terrain: t.terrain, seed: t.id };
        g = buildSlab(spec).geometry;
        cache.current.set(key, g);
      }
      map.set(t.id, g);
    }
    for (const [key, g] of cache.current) {
      if (!live.has(key)) {
        g.dispose();
        cache.current.delete(key);
      }
    }
    return map;
  }, [tiles]);
  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const g of c.values()) g.dispose();
      c.clear();
    };
  }, []);
  return out;
}

interface SeaSet {
  readonly geometries: THREE.BufferGeometry[];
  readonly base: Float32Array[];
}

/** Three seeded sea variants shared by every sea tile (docs/props.md §3: ripple 0.01 R at 0.6 Hz). */
function useSeaGeometries(): SeaSet {
  const set = useMemo<SeaSet>(() => {
    const geometries: THREE.BufferGeometry[] = [];
    const base: Float32Array[] = [];
    for (let v = 0; v < SEA_VARIANTS; v++) {
      const g = buildSlab({ kind: "sea", terrain: null, seed: `sea:${v}` }).geometry;
      geometries.push(g);
      base.push(Float32Array.from(g.attributes.position!.array as Float32Array));
    }
    return { geometries, base };
  }, []);
  useEffect(() => () => set.geometries.forEach((g) => g.dispose()), [set]);
  return set;
}

function SeaRipple({ sea, idle }: { sea: SeaSet; idle: boolean }) {
  useFrame(({ clock }) => {
    if (!idle) return;
    const t = clock.getElapsedTime() * Math.PI * 2 * 0.6;
    sea.geometries.forEach((g, v) => {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const base = sea.base[v]!;
      for (let i = 0; i < arr.length; i += 3) {
        const y = base[i + 1]!;
        if (y < SEA_SLAB_HEIGHT - 0.04) continue; // walls' feet stay put
        arr[i + 1] = y + Math.sin(t + base[i]! * 3.1 + base[i + 2]! * 2.3) * 0.01;
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
    });
  });
  return null;
}

function Token({ n, x, z, y, bounceKey, dim }: { n: number; x: number; z: number; y: number; bounceKey: number | null; dim: boolean }) {
  const group = useRef<THREE.Group>(null);
  const hot = n === 6 || n === 8;
  const texture = useMemo(() => tokenTexture(n), [n]);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: hot ? TOKEN_HOT : TOKEN_CLAY, roughness: 0.9, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, transparent: true });
    return { side, top, body: [side, top, side] };
  }, [texture, hot]);
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
    materials.top.opacity += ((dim ? 0.35 : 1) - materials.top.opacity) * 0.2;
  });
  return (
    <group ref={group} position={[x, y, z]} name={`token:${n}`}>
      <mesh material={materials.body} position={[0, TOKEN_HEIGHT * 0.375, 0]} castShadow>
        <cylinderGeometry args={[TOKEN_RADIUS, TOKEN_RADIUS, TOKEN_HEIGHT * 0.75, 24]} />
      </mesh>
      {/* Raised rim 0.01 R above the recessed face. */}
      <mesh material={materials.side} position={[0, TOKEN_HEIGHT * 0.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TOKEN_RADIUS - 0.012, 0.012, 6, 24]} />
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
          position={[dx, 0.03, dz]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.035, 5]} />
          <meshBasicMaterial color="#fff2b0" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Tiles({ tiles, robberHex, rolled, rollKey, blockedHex, shadows, idle = false }: { tiles: TileInfo[]; robberHex: HexId; rolled: number | null; rollKey: number | null; blockedHex: HexId | null; shadows: boolean; idle?: boolean }) {
  const materials = useSlabMaterials();
  const land = useLandGeometries(tiles);
  const sea = useSeaGeometries();
  const frame = useMemo(() => buildSlab({ kind: "frame", terrain: null, seed: "frame" }).geometry, []);
  useEffect(() => () => frame.dispose(), [frame]);
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
      <SeaRipple sea={sea} idle={idle} />
      {tiles.map((tile) => {
        const c = hexWorld(tile.id);
        const j = tileJitter(tile.id);
        const isSea = tile.kind === "sea";
        const isFrame = tile.kind === "frame";
        let geometry: THREE.BufferGeometry | undefined;
        let turn = 0;
        if (isSea) {
          const v = seaVariant(tile.id);
          geometry = sea.geometries[v.variant];
          turn = (v.turns * Math.PI) / 3;
        } else if (isFrame) geometry = frame;
        else geometry = land.get(tile.id);
        if (!geometry) return null;
        const height = (isSea || isFrame ? SEA_SLAB_HEIGHT : LAND_HEIGHT) * j.height;
        // The tile's interior rides its terrain's centre lift, so anything
        // standing at the middle of the hex has to rise with it.
        const lift = tile.kind === "land" && tile.terrain ? TERRAIN_LIFT[tile.terrain] : 0;
        const blocked = blockedHex === tile.id;
        const slab = <mesh geometry={geometry} material={isSea ? materials.sea : materials.land} position={[c.x, 0, c.z]} rotation={[0, j.rotation + turn, 0]} scale={[1, j.height, 1]} receiveShadow={shadows} castShadow={shadows && !isSea} name={`tile:${tile.id}`} />;
        const token = tile.token !== null && tile.kind === "land" ? <Token n={tile.token} x={c.x} z={c.z} y={height + (lift - RECESS_DEPTH) * j.height} bounceKey={rolled === tile.token && tile.id !== robberHex ? rollKey : null} dim={blocked} /> : null;
        const glitter = tile.terrain === "gold" ? <GoldGlitter x={c.x} z={c.z} y={height + lift * j.height} /> : null;
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
