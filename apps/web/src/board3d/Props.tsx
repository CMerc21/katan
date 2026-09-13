"use client";

/**
 * Terrain props (docs/props.md §3): every static kind is one merged,
 * face-coloured geometry drawn as an InstancedMesh; windmill sails, kiln
 * smoke and the gull animate on their own. Sheep bob and turn, wheat rows
 * sway; idle motion is gated by the quality preset. Props stand on the
 * slab's relief (`reliefField`), never in the recess or the edge margin.
 */

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HexId } from "@katan/engine";
import { box, cone, cyl, dodeca, facetedCone, halfSphere, ico, merge, octa, part, prism, sphere, torus } from "./geo";
import { SEA_HEIGHT, SLAB_HEIGHT, hexWorld } from "./layout3d";
import * as P from "./palette";
import { INSTANCED_KINDS, propsForHex, type PropInstance, type PropKind, type PropTerrain } from "./props";
import { reliefField } from "./slab";

/** Build the merged geometry for one prop kind. Base sits at y = 0. */
export function buildPropGeometry(kind: PropKind): THREE.BufferGeometry {
  switch (kind) {
    case "pine": {
      const radii = [0.14, 0.11, 0.08];
      const heights = [0.18, 0.15, 0.12];
      const colors = [P.PINE_LIGHT, P.PINE_DARK, P.PINE_LIGHT];
      let base = 0.07;
      const tiers = radii.map((r, i) => {
        const h = heights[i]!;
        const g = part(cone(r, h, 6), colors[i]!, { y: base + h / 2, ry: (i * Math.PI) / 6 });
        base += h * 0.75;
        return g;
      });
      return merge([part(cyl(0.025, 0.03, 0.08, 6), P.TRUNK, { y: 0.04 }), ...tiers]);
    }
    case "oak":
      return merge([
        part(cyl(0.03, 0.045, 0.2, 6), P.TRUNK, { y: 0.1 }),
        part(ico(0.16), P.OAK, { y: 0.32 }),
        part(ico(0.09), P.OAK_DARK, { x: 0.11, y: 0.26, z: 0.06 }),
        part(ico(0.085), P.OAK_DARK, { x: -0.1, y: 0.28, z: -0.05 }),
        part(ico(0.08), P.OAK_DARK, { x: 0.02, y: 0.25, z: -0.12 }),
      ]);
    case "cabin":
      return merge([
        part(box(0.26, 0.14, 0.2), P.CABIN, { y: 0.07 }),
        ...[0.03, 0.06, 0.09, 0.12].map((y) => part(box(0.264, 0.006, 0.204), P.CABIN_GROOVE, { y })),
        part(prism(0.3, 0.1, 0.24), P.CABIN_ROOF, { y: 0.14 }),
        part(box(0.04, 0.1, 0.04), P.STONE_WALL, { x: 0.07, y: 0.19, z: 0.04 }),
        part(box(0.05, 0.08, 0.008), P.DARK, { y: 0.04, z: 0.104 }),
      ]);
    case "logPile": {
      const log = (y: number, z: number) => [
        part(cyl(0.03, 0.03, 0.2, 6), P.CABIN, { y, z, rz: Math.PI / 2 }),
        ...[-0.1, 0.1].map((x) => part(cyl(0.031, 0.031, 0.004, 6), P.LOG_END, { x, y, z, rz: Math.PI / 2 })),
      ];
      return merge([...log(0.03, -0.032), ...log(0.03, 0.032), ...log(0.082, 0)]);
    }
    case "stump":
      return merge([part(cyl(0.05, 0.06, 0.05, 7), P.TRUNK, { y: 0.025 }), part(cyl(0.048, 0.048, 0.006, 7), P.LOG_END, { y: 0.053 })]);
    case "fallenLog":
      return merge([part(cyl(0.035, 0.035, 0.26, 6), P.TRUNK, { y: 0.035, rz: Math.PI / 2 }), ...[-0.13, 0.13].map((x) => part(cyl(0.036, 0.036, 0.004, 6), P.LOG_END, { x, y: 0.035, rz: Math.PI / 2 })), part(sphere(0.02, 5, 4), P.TRUNK, { x: 0.04, y: 0.06 })]);
    case "sheep":
      return merge([
        part(ico(0.09), P.WOOL, { y: 0.115, sx: 1.15, sz: 0.95 }),
        part(sphere(0.045, 8, 6), P.SHEEP_FACE, { x: 0.1, y: 0.12 }),
        ...[-0.05, 0.05].flatMap((x) => [-0.035, 0.035].map((z) => part(box(0.025, 0.05, 0.025), P.SHEEP_FACE, { x, y: 0.025, z }))),
      ]);
    case "shepherdHut":
      return merge([part(box(0.22, 0.13, 0.18), P.STONE_WALL, { y: 0.065 }), part(halfSphere(0.15, 8, 4), P.THATCH, { y: 0.13, sy: 0.6, sz: 0.85 }), part(box(0.05, 0.08, 0.008), P.DARK, { y: 0.04, z: 0.093 })]);
    case "fence":
      return merge([...[0, 1, 2, 3, 4, 5].map((k) => part(cyl(0.01, 0.01, 0.1, 5), P.TIMBER, { x: -0.225 + 0.09 * k, y: 0.05 })), part(box(0.46, 0.014, 0.012), P.TIMBER, { y: 0.045 }), part(box(0.46, 0.014, 0.012), P.TIMBER, { y: 0.08 })]);
    case "rope":
      return merge([part(torus(0.035, 0.012, 5, 10), P.LOG_END, { y: 0.012, rx: Math.PI / 2 }), part(torus(0.016, 0.01, 5, 8), P.LOG_END, { y: 0.01, rx: Math.PI / 2 })]);
    case "crook":
      return merge([part(cyl(0.006, 0.006, 0.18, 5), P.TIMBER, { x: 0.01, y: 0.09, rz: -0.15 }), part(torus(0.02, 0.006, 5, 8, Math.PI), P.TIMBER, { x: 0.005, y: 0.18 })]);
    case "wheat": {
      const heads = [-0.15, -0.09, -0.03, 0.03, 0.09, 0.15].flatMap((x) => [-0.03, 0.03].flatMap((z) => [part(cyl(0.006, 0.006, 0.06, 4), P.TIMBER, { x, y: 0.05, z }), part(sphere(0.028, 6, 5), P.WHEAT, { x, y: 0.1, z, sy: 1.8 })]));
      return merge([part(box(0.4, 0.03, 0.11), P.TIMBER, { y: 0.015 }), ...heads]);
    }
    case "mound":
      return merge([part(cyl(0.2, 0.22, 0.045, 7), P.TERRACE_LOW, { y: 0.0225, sx: 1.25 }), part(cyl(0.14, 0.16, 0.04, 7), "#E08A55", { x: 0.02, y: 0.065, sx: 1.25, ry: 0.3 }), part(cyl(0.08, 0.1, 0.035, 7), P.TERRACE_HIGH, { x: 0.03, y: 0.1, sx: 1.2, ry: 0.6 })]);
    case "kiln":
      return merge([
        part(halfSphere(0.14, 8, 4), P.KILN, {}),
        ...[0.4, 1.3, 2.4, 3.6, 4.6].map((a) => part(box(0.035, 0.02, 0.006), P.BRICK, { x: Math.cos(a) * 0.123, y: 0.07, z: Math.sin(a) * 0.123, ry: Math.PI / 2 - a })),
        part(box(0.06, 0.07, 0.01), P.DARK, { y: 0.035, z: 0.132 }),
        part(cyl(0.03, 0.03, 0.01, 8), P.DARK, { y: 0.07, z: 0.132, rx: Math.PI / 2 }),
        part(box(0.05, 0.28, 0.05), P.KILN, { x: 0.1, y: 0.14, z: -0.04 }),
        part(box(0.06, 0.02, 0.06), P.BRICK_DARK, { x: 0.1, y: 0.29, z: -0.04 }),
      ]);
    case "brickStack": {
      const brick = (x: number, y: number, z: number, ry: number, dark: boolean) => part(box(0.05, 0.028, 0.1), dark ? P.BRICK_DARK : P.BRICK, { x, y, z, ry });
      return merge([
        brick(-0.055, 0.014, 0, 0, false),
        brick(0, 0.014, 0, 0, true),
        brick(0.055, 0.014, 0, 0, false),
        brick(0, 0.042, -0.055, Math.PI / 2, true),
        brick(0, 0.042, 0, Math.PI / 2, false),
        brick(0, 0.042, 0.055, Math.PI / 2, true),
        brick(-0.03, 0.07, 0, 0, false),
        brick(0.03, 0.07, 0, 0, true),
      ]);
    }
    case "cart":
      return merge([
        part(box(0.2, 0.07, 0.12), P.TIMBER, { y: 0.1 }),
        ...[-0.065, 0.065].map((z) => part(box(0.2, 0.05, 0.01), P.CABIN, { y: 0.15, z })),
        ...[-0.07, 0.07].map((z) => part(cyl(0.055, 0.055, 0.02, 8), P.TRUNK, { y: 0.055, z, rx: Math.PI / 2 })),
        ...[-0.04, 0.04].map((z) => part(cyl(0.01, 0.01, 0.16, 5), P.TIMBER, { x: 0.16, y: 0.1, z, rz: Math.PI / 2 })),
      ]);
    case "peak": {
      const jitter = (ring: number, seg: number) => (Math.sin(ring * 7.3 + seg * 3.1) * 0.5 + Math.cos(ring * 2.7 - seg * 5.9) * 0.5) * 0.1;
      return facetedCone(0.22, 0.48, 6, 5, jitter, (t) => (t >= 0.68 ? P.SNOW : P.ROCK_GREY));
    }
    case "mine":
      return merge([
        part(ico(0.2), P.ROCK_GREY, { y: 0.06, sx: 1.1, sy: 0.75, sz: 0.9 }),
        ...[-0.055, 0.055].map((x) => part(box(0.03, 0.14, 0.03), P.MINE_FRAME, { x, y: 0.07, z: 0.17 })),
        part(box(0.15, 0.03, 0.035), P.MINE_FRAME, { y: 0.15, z: 0.17 }),
        part(box(0.09, 0.13, 0.02), P.DARK, { y: 0.065, z: 0.16 }),
      ]);
    case "goldNugget":
      return merge([part(octa(0.065), P.GOLD, { y: 0.05, rx: 0.2, ry: 0.4 })]);
    case "silverNugget":
      return merge([part(octa(0.06), P.SILVER, { y: 0.046, rx: 0.3, ry: 0.9 })]);
    case "cactus":
      return merge([
        part(cyl(0.03, 0.035, 0.3, 6), P.CACTUS, { y: 0.15 }),
        part(sphere(0.03, 6, 5), P.CACTUS, { y: 0.3 }),
        part(cyl(0.02, 0.02, 0.07, 5), P.CACTUS, { x: 0.05, y: 0.15, rz: Math.PI / 2 }),
        part(cyl(0.02, 0.02, 0.12, 5), P.CACTUS, { x: 0.085, y: 0.2 }),
        part(sphere(0.02, 5, 4), P.CACTUS, { x: 0.085, y: 0.26 }),
        part(cyl(0.02, 0.02, 0.07, 5), P.CACTUS, { x: -0.05, y: 0.2, rz: Math.PI / 2 }),
        part(cyl(0.02, 0.02, 0.1, 5), P.CACTUS, { x: -0.085, y: 0.24 }),
        part(sphere(0.02, 5, 4), P.CACTUS, { x: -0.085, y: 0.29 }),
      ]);
    case "rock":
      return merge([part(dodeca(0.045), P.DESERT_ROCK, { y: 0.03, sy: 0.7 })]);
    case "bonePile": {
      const bone = (ry: number, dx: number, dz: number) => [
        part(cyl(0.008, 0.008, 0.1, 5), P.BONE, { x: dx, y: 0.013, z: dz, ry, rz: Math.PI / 2 }),
        ...[-0.05, 0.05].map((x) => part(sphere(0.013, 5, 4), P.BONE, { x: dx + Math.cos(ry) * x, y: 0.013, z: dz - Math.sin(ry) * x })),
      ];
      return merge([...bone(0, 0, 0), ...bone(1.0, 0.02, 0.03), ...bone(2.2, -0.02, 0.02)]);
    }
    case "coin":
      return merge([part(cyl(0.02, 0.02, 0.006, 8), P.GOLD, { y: 0.003 })]);
    case "crest":
      return merge([part(ico(0.05), P.CREST, { y: 0.02, sx: 1.5, sy: 0.5, sz: 0.7 })]);
    case "sluice":
      return merge([
        part(box(0.36, 0.03, 0.1), P.TIMBER, { y: 0.12, rz: 0.2 }),
        ...[-0.05, 0.05].map((z) => part(box(0.36, 0.04, 0.012), P.CABIN, { y: 0.14, z, rz: 0.2 })),
        ...[-0.04, 0.04].map((z) => part(cyl(0.012, 0.012, 0.146, 5), P.TIMBER, { x: 0.13, y: 0.073, z })),
        ...[-0.04, 0.04].map((z) => part(cyl(0.012, 0.012, 0.094, 5), P.TIMBER, { x: -0.13, y: 0.047, z })),
      ]);
    case "reed": {
      const stalks: [number, number, number][] = [
        [0, 0, 0.1],
        [0.02, 0.015, -0.12],
        [-0.018, 0.01, 0.05],
      ];
      return merge(stalks.flatMap(([x, z, tilt]) => [part(cyl(0.005, 0.007, 0.2, 4), P.REED, { x, y: 0.1, z, rz: tilt }), part(sphere(0.009, 5, 4), P.DARK, { x: x - Math.sin(tilt) * 0.2, y: 0.2, z })]));
    }
    case "windmill":
    case "gull":
      // Animated components (below), never instanced.
      return new THREE.BufferGeometry();
    default: {
      const exhaustive: never = kind;
      throw new Error(String(exhaustive));
    }
  }
}

const SWAYING: ReadonlySet<PropKind> = new Set(["wheat"]);
const BOBBING: ReadonlySet<PropKind> = new Set(["sheep"]);

interface Placed extends PropInstance {
  readonly hex: HexId;
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
}

export interface PropHex {
  readonly id: HexId;
  readonly terrain: PropTerrain;
}

/** All props of every tile, grouped by kind, each standing on its tile's relief. */
export function layoutProps(hexes: readonly PropHex[], density: number): Map<PropKind, Placed[]> {
  const out = new Map<PropKind, Placed[]>();
  for (const h of hexes) {
    const c = hexWorld(h.id);
    const sea = h.terrain === "sea";
    const relief = reliefField({ kind: sea ? "sea" : "land", terrain: sea ? null : h.terrain, seed: h.id });
    for (const p of propsForHex(h.id, h.terrain, density)) {
      const list = out.get(p.kind) ?? [];
      // Sea crests ride the ripple; land props sit a hair into the facet so no gap shows on a slope.
      const wy = (sea ? SEA_HEIGHT : SLAB_HEIGHT) + relief(p.x, p.z) - (sea ? 0 : 0.006);
      list.push({ ...p, hex: h.id, wx: c.x + p.x, wy, wz: c.z + p.z });
      out.set(p.kind, list);
    }
  }
  return out;
}

function PropKindMesh({ kind, items, idle, shadows }: { kind: PropKind; items: Placed[]; idle: boolean; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => buildPropGeometry(kind), [kind]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: kind === "goldNugget" || kind === "silverNugget" || kind === "coin" ? 0.45 : 0.9,
        metalness: kind === "goldNugget" || kind === "silverNugget" || kind === "coin" ? 0.5 : 0,
        emissive: new THREE.Color(kind === "goldNugget" ? P.GOLD : "#000000"),
        emissiveIntensity: kind === "goldNugget" ? 0.2 : 0,
      }),
    [kind],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((p, i) => {
      dummy.position.set(p.wx, p.wy, p.wz);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, dummy]);

  const animated = idle && (SWAYING.has(kind) || BOBBING.has(kind));
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || !animated) return;
    const t = clock.getElapsedTime();
    items.forEach((p, i) => {
      dummy.position.set(p.wx, p.wy, p.wz);
      if (SWAYING.has(kind)) {
        // Wheat rows sway ±2° about their long axis.
        const a = Math.sin(t * 1.1 + p.seed * 6.28) * ((2 * Math.PI) / 180);
        dummy.rotation.set(0, p.rot, 0);
        dummy.rotateX(a);
      } else {
        // Sheep bob 0.01 R at a random phase; every few seconds one turns 15°.
        dummy.position.y += Math.abs(Math.sin(t * 2 + p.seed * 6.28)) * 0.01;
        const cycle = (t * 0.2 + p.seed * 5) % 5;
        const turn = cycle < 0.6 ? Math.sin((cycle / 0.6) * Math.PI) * ((15 * Math.PI) / 180) : 0;
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

/** A stone-based windmill with four lattice sails turning at 0.15 rad/s (docs/props.md §3). */
function Windmill({ x, y, z, rot, idle, shadows }: { x: number; y: number; z: number; rot: number; idle: boolean; shadows: boolean }) {
  const sails = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (sails.current && idle) sails.current.rotation.z -= dt * 0.15;
  });
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} name="windmill">
      <mesh position={[0, 0.06, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.09, 0.1, 0.12, 8]} />
        <meshStandardMaterial color={P.STONE_WALL} flatShading />
      </mesh>
      <mesh position={[0, 0.24, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.06, 0.085, 0.24, 8]} />
        <meshStandardMaterial color={P.TIMBER} flatShading />
      </mesh>
      <mesh position={[0, 0.395, 0]}>
        <coneGeometry args={[0.075, 0.07, 8]} />
        <meshStandardMaterial color={P.CABIN} flatShading />
      </mesh>
      <mesh position={[0, 0.06, 0.092]}>
        <boxGeometry args={[0.04, 0.06, 0.01]} />
        <meshStandardMaterial color={P.DARK} />
      </mesh>
      <group ref={sails} position={[0, 0.34, 0.1]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.03, 8]} />
          <meshStandardMaterial color={P.CABIN} flatShading />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
            <mesh position={[0.15, 0, 0]}>
              <boxGeometry args={[0.28, 0.012, 0.008]} />
              <meshStandardMaterial color={P.TIMBER} />
            </mesh>
            <mesh position={[0.18, 0.06, 0]}>
              <boxGeometry args={[0.2, 0.01, 0.006]} />
              <meshStandardMaterial color={P.TIMBER} />
            </mesh>
            {[0.1, 0.17, 0.24].map((rx) => (
              <mesh key={rx} position={[rx, 0.03, 0]}>
                <boxGeometry args={[0.012, 0.07, 0.006]} />
                <meshStandardMaterial color={P.WOOL} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </group>
  );
}

/** A puff leaves the kiln's chimney every 4 s and drifts up for 3 s. */
function Smoke({ x, y, z, rot, scale, seed }: { x: number; y: number; z: number; rot: number; scale: number; seed: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  // The chimney top in local kiln space is (0.1, 0.3, -0.04); rotate it with the instance.
  const cx = x + (Math.cos(rot) * 0.1 + Math.sin(rot) * -0.04) * scale;
  const cz = z + (-Math.sin(rot) * 0.1 + Math.cos(rot) * -0.04) * scale;
  const cy = y + 0.3 * scale;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    refs.current.forEach((m, i) => {
      if (!m) return;
      const phase = ((t + seed * 4 + i * 2) % 4) / 3;
      m.visible = phase < 1;
      if (!m.visible) return;
      m.position.set(cx + Math.sin(phase * 5 + i) * 0.02, cy + phase * 0.3, cz);
      m.scale.setScalar(0.018 + phase * 0.05);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - phase);
    });
  });
  return (
    <>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <sphereGeometry args={[1, 6, 5]} />
          <meshStandardMaterial color={P.SMOKE} transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** A gull circling a sea tile at Medium and above (docs/props.md §3). */
function Gull({ x, y, z, seed, idle }: { x: number; y: number; z: number; seed: number; idle: boolean }) {
  const group = useRef<THREE.Group>(null);
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = idle ? clock.getElapsedTime() : 0;
    const a = t * 0.5 + seed * 6.28;
    g.position.set(x + Math.cos(a) * 0.3, y + 0.55 + Math.sin(t * 1.3 + seed) * 0.03, z + Math.sin(a) * 0.3);
    g.rotation.y = -a;
    const flap = Math.sin(t * 6 + seed * 3) * 0.5;
    if (left.current) left.current.rotation.z = 0.3 + flap;
    if (right.current) right.current.rotation.z = -0.3 - flap;
  });
  return (
    <group ref={group} name="gull">
      <mesh ref={left} position={[0, 0, 0]}>
        <boxGeometry args={[0.06, 0.004, 0.012]} />
        <meshStandardMaterial color={P.WOOL} />
      </mesh>
      <mesh ref={right} position={[0, 0, 0]}>
        <boxGeometry args={[0.06, 0.004, 0.012]} />
        <meshStandardMaterial color={P.WOOL} />
      </mesh>
    </group>
  );
}

export function Props({ hexes, density, idle, shadows }: { hexes: readonly PropHex[]; density: number; idle: boolean; shadows: boolean }) {
  const groups = useMemo(() => layoutProps(hexes, density), [hexes, density]);
  const windmills = groups.get("windmill") ?? [];
  const kilns = groups.get("kiln") ?? [];
  const gulls = groups.get("gull") ?? [];
  return (
    <group name="props">
      {INSTANCED_KINDS.map((kind) => {
        const items = groups.get(kind);
        return items && items.length > 0 ? <PropKindMesh key={kind} kind={kind} items={items} idle={idle} shadows={shadows} /> : null;
      })}
      {windmills.map((w) => (
        <Windmill key={w.hex} x={w.wx} y={w.wy} z={w.wz} rot={w.rot} idle={idle} shadows={shadows} />
      ))}
      {idle && kilns.map((k) => <Smoke key={k.hex} x={k.wx} y={k.wy} z={k.wz} rot={k.rot} scale={k.scale} seed={k.seed} />)}
      {gulls.map((g) => (
        <Gull key={g.hex} x={g.wx} y={g.wy} z={g.wz} seed={g.seed} idle={idle} />
      ))}
    </group>
  );
}
