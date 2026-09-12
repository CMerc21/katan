"use client";

/**
 * Terrain props (docs/phase7-5.md §4): one merged, vertex-coloured geometry
 * per prop kind drawn as an InstancedMesh, plus a few animated props
 * (windmill sails, kiln smoke). Idle motion is gated by the quality preset.
 */

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HexId, Terrain } from "@katan/engine";
import { TERRAIN_FILL, TERRAIN_MARK } from "@/game/theme";
import { box, cone, cyl, halfSphere, merge, octa, part, sphere } from "./geo";
import { hexWorld, SLAB_HEIGHT } from "./layout3d";
import { INSTANCED_KINDS, propsForHex, type PropInstance, type PropKind } from "./props";

const BROWN = "#6b4a2b";
const BARK = "#4a3320";
const BONE = "#efe8d8";
const STRAW = "#d9b258";
const SNOW = "#f4f4f2";
const WHITE = "#f1eee5";
const DARK = "#2a2622";
const GOLD = "#e0b43a";

/** Build the merged geometry for one prop kind. Base sits at y = 0. */
export function buildPropGeometry(kind: PropKind): THREE.BufferGeometry {
  const F = TERRAIN_FILL;
  const M = TERRAIN_MARK;
  switch (kind) {
    case "pine":
      return merge([
        part(cyl(0.03, 0.04, 0.12, 6), BARK, { y: 0.06 }),
        part(cone(0.17, 0.2, 7), M.forest, { y: 0.2 }),
        part(cone(0.13, 0.18, 7), F.forest, { y: 0.32 }),
        part(cone(0.09, 0.16, 7), M.forest, { y: 0.44 }),
      ]);
    case "oak":
      return merge([part(cyl(0.035, 0.045, 0.16, 6), BARK, { y: 0.08 }), part(sphere(0.15, 8, 6), F.forest, { y: 0.27 }), part(sphere(0.1, 7, 5), M.forest, { x: 0.09, y: 0.3, z: 0.05 })]);
    case "stump":
      return merge([part(cyl(0.06, 0.07, 0.06, 7), BARK, { y: 0.03 }), part(cyl(0.055, 0.055, 0.01, 7), "#c9a06a", { y: 0.065 })]);
    case "hut":
      return merge([part(box(0.22, 0.14, 0.18), BONE, { y: 0.07 }), part(cone(0.19, 0.12, 4), STRAW, { y: 0.2, ry: Math.PI / 4 }), part(box(0.05, 0.07, 0.01), BROWN, { y: 0.035, z: 0.095 })]);
    case "sheep":
      return merge([
        part(sphere(0.07, 8, 6), WHITE, { y: 0.1, sx: 1.25 }),
        part(sphere(0.045, 7, 5), DARK, { x: 0.09, y: 0.11 }),
        ...[-0.045, 0.045].flatMap((x) => [-0.03, 0.03].map((z) => part(box(0.02, 0.06, 0.02), DARK, { x, y: 0.03, z }))),
      ]);
    case "fence":
      return merge([
        ...[-0.18, 0, 0.18].map((x) => part(cyl(0.012, 0.012, 0.13, 5), BROWN, { x, y: 0.065 })),
        part(box(0.42, 0.02, 0.02), BROWN, { y: 0.05 }),
        part(box(0.42, 0.02, 0.02), BROWN, { y: 0.1 }),
      ]);
    case "wheat":
      return merge([part(box(0.34, 0.05, 0.06), M.farmland, { y: 0.025 }), part(box(0.34, 0.06, 0.04), F.farmland, { y: 0.08 }), ...[-0.12, -0.04, 0.04, 0.12].map((x) => part(cone(0.02, 0.06, 5), STRAW, { x, y: 0.14 }))]);
    case "mound":
      return merge([part(sphere(0.22, 10, 7), "#ffffff", { sy: 0.38 })]); // tinted per instance
    case "kiln":
      return merge([part(halfSphere(0.14, 10), M.claypit, {}), part(cyl(0.03, 0.03, 0.2, 6), DARK, { x: 0.06, y: 0.14 }), part(box(0.06, 0.05, 0.02), DARK, { y: 0.03, z: 0.135 })]);
    case "brickPile":
      return merge([part(box(0.14, 0.05, 0.08), F.claypit, { y: 0.025 }), part(box(0.14, 0.05, 0.08), M.claypit, { y: 0.075, ry: 0.3 }), part(box(0.1, 0.05, 0.08), F.claypit, { y: 0.125, ry: -0.2 })]);
    case "cart":
      return merge([
        part(box(0.2, 0.06, 0.12), BROWN, { y: 0.1 }),
        ...[-0.06, 0.06].flatMap((x) => [-0.07, 0.07].map((z) => part(cyl(0.05, 0.05, 0.02, 8), DARK, { x, y: 0.05, z, rx: Math.PI / 2 }))),
        part(box(0.16, 0.01, 0.1), STRAW, { y: 0.135 }),
      ]);
    case "peak":
      return merge([part(cone(0.24, 0.5, 5), F.mountain, { y: 0.25 }), part(cone(0.18, 0.36, 5), M.mountain, { x: 0.12, y: 0.18, z: 0.08, ry: 0.6 }), part(cone(0.09, 0.18, 5), SNOW, { y: 0.41 })]);
    case "mine":
      return merge([part(box(0.18, 0.14, 0.14), M.mountain, { y: 0.07 }), part(box(0.08, 0.09, 0.02), DARK, { y: 0.045, z: 0.07 }), part(box(0.12, 0.02, 0.03), BROWN, { y: 0.1, z: 0.075 })]);
    case "dune":
      return merge([part(sphere(0.24, 10, 7), "#ffffff", { sy: 0.25, sz: 0.7 })]); // tinted per instance
    case "cactus":
      return merge([part(cyl(0.03, 0.03, 0.24, 6), "#5f8a4a", { y: 0.12 }), part(cyl(0.02, 0.02, 0.1, 5), "#5f8a4a", { x: 0.06, y: 0.16, rz: Math.PI / 2 }), part(cyl(0.02, 0.02, 0.08, 5), "#5f8a4a", { x: 0.1, y: 0.2 })]);
    case "ribcage":
      return merge([-0.06, -0.02, 0.02, 0.06].map((x) => part(box(0.015, 0.09, 0.02), BONE, { x, y: 0.045, rz: x > 0 ? -0.3 : 0.3 })));
    case "nugget":
      return merge([part(octa(0.04), GOLD, { y: 0.04, ry: 0.4 })]);
    case "sluice":
      return merge([part(box(0.36, 0.04, 0.09), BROWN, { y: 0.1, rz: 0.2 }), part(cyl(0.015, 0.015, 0.12, 5), BROWN, { x: -0.14, y: 0.06 }), part(cyl(0.015, 0.015, 0.2, 5), BROWN, { x: 0.14, y: 0.1 })]);
    case "windmill":
      return merge([part(cone(0.12, 0.4, 6), BONE, { y: 0.2 })]);
    default: {
      const exhaustive: never = kind;
      throw new Error(String(exhaustive));
    }
  }
}

const SWAYING: ReadonlySet<PropKind> = new Set(["pine", "oak", "wheat"]);
const BOBBING: ReadonlySet<PropKind> = new Set(["sheep"]);

interface Placed extends PropInstance {
  readonly hex: HexId;
  readonly wx: number;
  readonly wz: number;
  readonly tint: THREE.Color;
}

const TINT_WHITE = new THREE.Color("#ffffff");

/** All props of every land tile, grouped by kind. */
export function layoutProps(hexes: { id: HexId; terrain: Terrain | "gold" }[], density: number): Map<PropKind, Placed[]> {
  const out = new Map<PropKind, Placed[]>();
  for (const h of hexes) {
    const c = hexWorld(h.id);
    for (const p of propsForHex(h.id, h.terrain, density)) {
      const tint = p.kind === "mound" || p.kind === "dune" ? new THREE.Color(h.terrain === "gold" ? GOLD : TERRAIN_MARK[h.terrain as Terrain]) : TINT_WHITE;
      const list = out.get(p.kind) ?? [];
      list.push({ ...p, hex: h.id, wx: c.x + p.x, wz: c.z + p.z, tint });
      out.set(p.kind, list);
    }
  }
  return out;
}

function PropKindMesh({ kind, items, idle, shadows }: { kind: PropKind; items: Placed[]; idle: boolean; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => buildPropGeometry(kind), [kind]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: kind === "nugget" ? 0.6 : 0, emissive: kind === "nugget" ? new THREE.Color("#7a5a00") : new THREE.Color("#000000") }), [kind]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((p, i) => {
      dummy.position.set(p.wx, SLAB_HEIGHT, p.wz);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, p.tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, dummy]);

  const animated = idle && (SWAYING.has(kind) || BOBBING.has(kind));
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || !animated) return;
    const t = clock.getElapsedTime();
    items.forEach((p, i) => {
      dummy.position.set(p.wx, SLAB_HEIGHT, p.wz);
      if (SWAYING.has(kind)) {
        const a = Math.sin(t * 1.3 + p.seed * 6.28) * (1.5 * Math.PI) / 180;
        dummy.rotation.set(a, p.rot, a * 0.6);
      } else {
        dummy.position.y += Math.abs(Math.sin(t * 2 + p.seed * 6.28)) * 0.012;
        const turn = Math.sin(t * 0.25 + p.seed * 6.28) > 0.985 ? 0.4 : 0;
        dummy.rotation.set(0, p.rot + turn, 0);
      }
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, items.length)]} castShadow={shadows} receiveShadow={shadows} frustumCulled={false} />;
}

function Windmill({ x, z, idle }: { x: number; z: number; idle: boolean }) {
  const sails = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (sails.current && idle) sails.current.rotation.z += dt * 0.8;
  });
  return (
    <group position={[x, SLAB_HEIGHT, z]}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <coneGeometry args={[0.12, 0.4, 6]} />
        <meshStandardMaterial color={BONE} flatShading />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <coneGeometry args={[0.07, 0.08, 6]} />
        <meshStandardMaterial color={STRAW} flatShading />
      </mesh>
      <group ref={sails} position={[0, 0.34, 0.1]}>
        <mesh>
          <boxGeometry args={[0.44, 0.04, 0.01]} />
          <meshStandardMaterial color={BROWN} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.44, 0.04, 0.01]} />
          <meshStandardMaterial color={BROWN} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]} position={[Math.cos((i * Math.PI) / 2) * 0.13, Math.sin((i * Math.PI) / 2) * 0.13, 0.006]}>
            <planeGeometry args={[0.18, 0.08]} />
            <meshStandardMaterial color={WHITE} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Smoke({ x, z, seed }: { x: number; z: number; seed: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    refs.current.forEach((m, i) => {
      if (!m) return;
      const phase = (t * 0.35 + seed + i * 0.33) % 1;
      m.position.set(x + 0.06 + Math.sin(phase * 6) * 0.02, SLAB_HEIGHT + 0.26 + phase * 0.32, z);
      const s = 0.02 + phase * 0.05;
      m.scale.setScalar(s);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - phase);
    });
  });
  return (
    <>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <sphereGeometry args={[1, 6, 5]} />
          <meshStandardMaterial color="#d8d3c8" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

export function Props({ hexes, density, idle, shadows }: { hexes: { id: HexId; terrain: Terrain | "gold" }[]; density: number; idle: boolean; shadows: boolean }) {
  const groups = useMemo(() => layoutProps(hexes, density), [hexes, density]);
  const windmills = groups.get("windmill") ?? [];
  const kilns = groups.get("kiln") ?? [];
  return (
    <group name="props">
      {INSTANCED_KINDS.map((kind) => {
        const items = groups.get(kind);
        return items && items.length > 0 ? <PropKindMesh key={kind} kind={kind} items={items} idle={idle} shadows={shadows} /> : null;
      })}
      {windmills.map((w) => (
        <Windmill key={w.hex} x={w.wx} z={w.wz} idle={idle} />
      ))}
      {idle && kilns.map((k) => <Smoke key={k.hex} x={k.wx} z={k.wz} seed={k.seed} />)}
    </group>
  );
}
