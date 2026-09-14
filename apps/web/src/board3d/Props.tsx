"use client";

/**
 * Terrain props (docs/props.md §3): every kind is one InstancedMesh across
 * the whole board — nineteen tiles of trees are a handful of draw calls —
 * drawn with its GLB (`propModels.ts`) once that loads, and with a procedural
 * stand-in until then or if the model is missing (logged once per kind).
 * Props cast and receive shadows, stand on the slab's relief (`reliefField`)
 * and sink a little into it so no gap shows at the base. Sheep bob and turn,
 * wheat rows sway, kilns smoke; idle motion is gated by the quality preset.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { HexId } from "@katan/engine";
import { box, cone, cyl, dodeca, facetedCone, halfSphere, ico, merge, octa, part, sphere } from "./geo";
import { SEA_HEIGHT, SLAB_HEIGHT, hexWorld } from "./layout3d";
import * as P from "./palette";
import { outlineMaterial } from "./outline";
import { PROP_MODELS, PROP_MODEL_PATH, loadPropGeometry, propMaterial } from "./propModels";
import { ALL_KINDS, propsForHex, type PropInstance, type PropKind, type PropTerrain } from "./props";
import { reliefField } from "./slab";

/** A long stand-in's length runs along local Z, like the baked models (`axis: "x"` turns X → Z). */
function alongZ(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.rotateY(-Math.PI / 2);
  return g;
}

/** The procedural stand-in for one kind: face-coloured primitives, base at y = 0. */
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
    case "tree":
    case "tree2":
      return merge([
        part(cyl(0.03, 0.045, 0.2, 6), P.TRUNK, { y: 0.1 }),
        part(ico(0.16), P.OAK, { y: 0.32 }),
        part(ico(0.09), P.OAK_DARK, { x: 0.11, y: 0.26, z: 0.06 }),
        part(ico(0.085), P.OAK_DARK, { x: -0.1, y: 0.28, z: -0.05 }),
        part(ico(0.08), P.OAK_DARK, { x: 0.02, y: 0.25, z: -0.12 }),
      ]);
    case "logPile": {
      const log = (y: number, z: number) => [part(cyl(0.03, 0.03, 0.2, 6), P.CABIN, { y, z, rz: Math.PI / 2 }), ...[-0.1, 0.1].map((x) => part(cyl(0.031, 0.031, 0.004, 6), P.LOG_END, { x, y, z, rz: Math.PI / 2 }))];
      return alongZ(merge([...log(0.03, -0.032), ...log(0.03, 0.032), ...log(0.082, 0)]));
    }
    case "sheep":
      return alongZ(merge([part(ico(0.09), P.WOOL, { y: 0.115, sx: 1.15, sz: 0.95 }), part(sphere(0.045, 8, 6), P.SHEEP_FACE, { x: 0.1, y: 0.12 }), ...[-0.05, 0.05].flatMap((x) => [-0.035, 0.035].map((z) => part(box(0.025, 0.05, 0.025), P.SHEEP_FACE, { x, y: 0.025, z })))]));
    case "fence":
      return alongZ(merge([...[0, 1, 2, 3, 4, 5].map((k) => part(cyl(0.01, 0.01, 0.1, 5), P.TIMBER, { x: -0.225 + 0.09 * k, y: 0.05 })), part(box(0.46, 0.014, 0.012), P.TIMBER, { y: 0.045 }), part(box(0.46, 0.014, 0.012), P.TIMBER, { y: 0.08 })]));
    case "bush":
      return merge([part(ico(0.09), P.OAK_DARK, { y: 0.08, sy: 0.85 }), part(ico(0.06), P.OAK, { x: 0.07, y: 0.06, z: 0.03 })]);
    case "wheat":
    case "wheat2": {
      const heads = [-0.03, 0.03].flatMap((x) => [-0.03, 0.03].flatMap((z) => [part(cyl(0.006, 0.006, 0.1, 4), P.TIMBER, { x, y: 0.05, z }), part(sphere(0.028, 6, 5), P.WHEAT, { x, y: 0.14, z, sy: 1.8 })]));
      return merge([part(cyl(0.05, 0.06, 0.03, 7), P.TIMBER, { y: 0.015 }), ...heads]);
    }
    case "windmill":
      return merge([
        part(cyl(0.09, 0.1, 0.12, 8), P.STONE_WALL, { y: 0.06 }),
        part(cyl(0.06, 0.085, 0.24, 8), P.TIMBER, { y: 0.24 }),
        part(cone(0.075, 0.07, 8), P.CABIN, { y: 0.395 }),
        ...[0, 1, 2, 3].map((i) => part(box(0.28, 0.012, 0.008), P.TIMBER, { x: Math.cos((i * Math.PI) / 2) * 0.14, y: 0.34 + Math.sin((i * Math.PI) / 2) * 0.14, z: 0.1, rz: (i * Math.PI) / 2 })),
      ]);
    case "hayBale":
      return merge([part(cyl(0.1, 0.1, 0.22, 10), P.WHEAT, { y: 0.1, rx: Math.PI / 2 })]);
    case "moundTall":
      return merge([part(cyl(0.05, 0.1, 0.3, 7), P.TERRACE_LOW, { y: 0.15 })]);
    case "moundWide":
      return merge([part(cyl(0.2, 0.22, 0.045, 7), P.TERRACE_LOW, { y: 0.0225, sx: 1.25 }), part(cyl(0.14, 0.16, 0.04, 7), "#E08A55", { x: 0.02, y: 0.065, sx: 1.25, ry: 0.3 }), part(cyl(0.08, 0.1, 0.035, 7), P.TERRACE_HIGH, { x: 0.03, y: 0.1, sx: 1.2, ry: 0.6 })]);
    case "moundLow":
      return alongZ(merge([part(cyl(0.12, 0.14, 0.06, 7), P.TERRACE_HIGH, { x: -0.08, y: 0.03 }), part(cyl(0.1, 0.12, 0.08, 7), P.TERRACE_LOW, { x: 0.08, y: 0.04 })]));
    case "moundTerraced":
      return merge([0.09, 0.07, 0.05, 0.03].map((r, i) => part(cyl(r * 0.85, r, 0.07, 7), i % 2 ? P.TERRACE_LOW : P.TERRACE_HIGH, { y: 0.035 + i * 0.07 })));
    case "kiln":
      return merge([part(halfSphere(0.14, 8, 4), P.KILN, {}), part(box(0.06, 0.07, 0.01), P.DARK, { y: 0.035, z: 0.132 }), part(box(0.05, 0.28, 0.05), P.KILN, { x: 0.1, y: 0.14, z: -0.04 }), part(box(0.06, 0.02, 0.06), P.BRICK_DARK, { x: 0.1, y: 0.29, z: -0.04 })]);
    case "brickStack": {
      const brick = (x: number, y: number, z: number, ry: number, dark: boolean) => part(box(0.05, 0.028, 0.1), dark ? P.BRICK_DARK : P.BRICK, { x, y, z, ry });
      return alongZ(merge([brick(-0.055, 0.014, 0, 0, false), brick(0, 0.014, 0, 0, true), brick(0.055, 0.014, 0, 0, false), brick(0, 0.042, -0.055, Math.PI / 2, true), brick(0, 0.042, 0, Math.PI / 2, false), brick(0, 0.042, 0.055, Math.PI / 2, true), brick(-0.03, 0.07, 0, 0, false), brick(0.03, 0.07, 0, 0, true)]));
    }
    case "peak":
    case "ridge": {
      const jitter = (ring: number, seg: number) => (Math.sin(ring * 7.3 + seg * 3.1) * 0.5 + Math.cos(ring * 2.7 - seg * 5.9) * 0.5) * 0.1;
      const g = facetedCone(0.22, kind === "peak" ? 0.48 : 0.3, 6, 5, jitter, (t) => (t >= 0.68 ? P.SNOW : P.ROCK_GREY));
      if (kind === "ridge") g.scale(1.3, 1, 1);
      return g;
    }
    case "boulder":
      return merge([part(dodeca(0.07), P.ROCK_GREY, { y: 0.06, sy: 0.85 })]);
    case "rubble":
      return alongZ(merge([-0.08, 0, 0.09].map((x, i) => part(dodeca(0.045 + i * 0.008), P.ROCK_GREY, { x, y: 0.035, z: (i - 1) * 0.02, sy: 0.7 }))));
    case "cactus":
      return merge([
        part(cyl(0.03, 0.035, 0.3, 6), P.CACTUS, { y: 0.15 }),
        part(sphere(0.03, 6, 5), P.CACTUS, { y: 0.3 }),
        part(cyl(0.02, 0.02, 0.07, 5), P.CACTUS, { x: 0.05, y: 0.15, rz: Math.PI / 2 }),
        part(cyl(0.02, 0.02, 0.12, 5), P.CACTUS, { x: 0.085, y: 0.2 }),
        part(cyl(0.02, 0.02, 0.07, 5), P.CACTUS, { x: -0.05, y: 0.2, rz: Math.PI / 2 }),
        part(cyl(0.02, 0.02, 0.1, 5), P.CACTUS, { x: -0.085, y: 0.24 }),
      ]);
    case "dryBush":
      return merge([part(ico(0.07), P.TRUNK, { y: 0.07 }), part(ico(0.045), P.TRUNK, { x: 0.05, y: 0.05, z: -0.03 })]);
    case "skull":
      return merge([part(sphere(0.05, 7, 6), P.BONE, { y: 0.045, sz: 1.3 }), ...[-1, 1].map((s) => part(cone(0.012, 0.06, 5), P.BONE, { x: s * 0.06, y: 0.06, rz: s * -1.2 }))]);
    case "flatRock":
      return merge([part(cyl(0.1, 0.11, 0.03, 8), P.DESERT_ROCK, { y: 0.015 })]);
    case "goldNugget":
      return merge([part(octa(0.065), P.GOLD, { y: 0.05, rx: 0.2, ry: 0.4 })]);
    case "sluice":
      return merge([part(box(0.36, 0.03, 0.1), P.TIMBER, { y: 0.12, rz: 0.2 }), ...[-0.05, 0.05].map((z) => part(box(0.36, 0.04, 0.012), P.CABIN, { y: 0.14, z, rz: 0.2 })), ...[-0.04, 0.04].map((z) => part(cyl(0.012, 0.012, 0.146, 5), P.TIMBER, { x: 0.13, y: 0.073, z })), ...[-0.04, 0.04].map((z) => part(cyl(0.012, 0.012, 0.094, 5), P.TIMBER, { x: -0.13, y: 0.047, z }))]);
    case "reed": {
      const stalks: [number, number, number][] = [
        [0, 0, 0.1],
        [0.02, 0.015, -0.12],
        [-0.018, 0.01, 0.05],
      ];
      return merge(stalks.flatMap(([x, z, tilt]) => [part(cyl(0.005, 0.007, 0.2, 4), P.REED, { x, y: 0.1, z, rz: tilt }), part(sphere(0.009, 5, 4), P.DARK, { x: x - Math.sin(tilt) * 0.2, y: 0.2, z })]));
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(String(exhaustive));
    }
  }
}

function proceduralMaterial(kind: PropKind): THREE.MeshStandardMaterial {
  const metal = kind === "goldNugget";
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: metal ? 0.45 : 0.9, metalness: metal ? 0.5 : 0, emissive: new THREE.Color(metal ? P.GOLD : "#000000"), emissiveIntensity: metal ? 0.2 : 0 });
}

const PROCEDURAL_SINK = 0.006;
const warned = new Set<PropKind>();
function warnMissing(kind: PropKind, reason: string): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  console.warn(`[board3d] prop "${kind}" has no model (${reason}); drawing the procedural mesh`);
}

interface PropDraw {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly sink: number;
  readonly fromModel: boolean;
}

/** The GLB for a kind once it loads; the procedural stand-in before that and whenever there is no model. */
function usePropDraw(kind: PropKind): PropDraw {
  const fallback = useMemo<PropDraw>(() => ({ geometry: buildPropGeometry(kind), material: proceduralMaterial(kind), sink: PROCEDURAL_SINK, fromModel: false }), [kind]);
  const [draw, setDraw] = useState<PropDraw>(fallback);
  useEffect(() => {
    let live = true;
    let material: THREE.Material | null = null;
    setDraw(fallback);
    const model = PROP_MODELS[kind];
    if (!model) {
      warnMissing(kind, "no entry in PROP_MODELS");
      return;
    }
    loadPropGeometry(kind)
      .then((geometry) => {
        if (!live) return;
        material = propMaterial(model, geometry);
        setDraw({ geometry, material, sink: model.sink, fromModel: true });
      })
      .catch((err: unknown) => {
        if (live) warnMissing(kind, `${PROP_MODEL_PATH}/${model.file}.glb failed to load: ${String(err)}`);
      });
    return () => {
      live = false;
      material?.dispose();
    };
  }, [kind, fallback]);
  useEffect(() => () => fallback.material.dispose(), [fallback]);
  return draw;
}

const SWAYING: ReadonlySet<PropKind> = new Set(["wheat", "wheat2"]);
const BOBBING: ReadonlySet<PropKind> = new Set(["sheep"]);
const KILN_HEIGHT = 0.28;

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
      list.push({ ...p, hex: h.id, wx: c.x + p.x, wy: (sea ? SEA_HEIGHT : SLAB_HEIGHT) + relief(p.x, p.z), wz: c.z + p.z });
      out.set(p.kind, list);
    }
  }
  return out;
}

function PropKindMesh({ kind, items, idle, shadows }: { kind: PropKind; items: Placed[]; idle: boolean; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const draw = usePropDraw(kind);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // The outline hull is a second instanced draw over the same geometry and the
  // same matrices, so a whole terrain's props cost one extra call, not one each.
  const outline = useMemo(() => outlineMaterial(), []);
  useEffect(() => () => outline.dispose(), [outline]);

  /** Write one instance's matrix to the mesh and its hull. */
  const write = (i: number) => {
    dummy.updateMatrix();
    ref.current?.setMatrixAt(i, dummy.matrix);
    hull.current?.setMatrixAt(i, dummy.matrix);
  };
  const flush = () => {
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
    if (hull.current) hull.current.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((p, i) => {
      dummy.position.set(p.wx, p.wy - draw.sink, p.wz);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.scale);
      write(i);
    });
    flush();
    mesh.computeBoundingSphere();
    hull.current?.computeBoundingSphere();
  }, [items, dummy, draw]);

  const animated = idle && (SWAYING.has(kind) || BOBBING.has(kind));
  useFrame(({ clock }) => {
    if (!ref.current || !animated) return;
    const t = clock.getElapsedTime();
    items.forEach((p, i) => {
      dummy.position.set(p.wx, p.wy - draw.sink, p.wz);
      if (SWAYING.has(kind)) {
        // Sheaves sway ±2° about their long axis.
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
      write(i);
    });
    flush();
  });

  const count = Math.max(1, items.length);
  const key = draw.fromModel ? "model" : "procedural";
  return (
    <>
      <instancedMesh key={`o:${key}`} ref={hull} args={[draw.geometry, outline, count]} castShadow={false} receiveShadow={false} frustumCulled={false} renderOrder={-1} name={`prop-outline:${kind}`} />
      <instancedMesh key={key} ref={ref} args={[draw.geometry, draw.material, count]} castShadow={shadows} receiveShadow={shadows} frustumCulled={false} name={`prop:${kind}`} />
    </>
  );
}

/** A puff leaves the kiln's top every 4 s and drifts up for 3 s. */
function Smoke({ x, y, z, scale, seed }: { x: number; y: number; z: number; scale: number; seed: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const cy = y + KILN_HEIGHT * scale;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    refs.current.forEach((m, i) => {
      if (!m) return;
      const phase = ((t + seed * 4 + i * 2) % 4) / 3;
      m.visible = phase < 1;
      if (!m.visible) return;
      m.position.set(x + Math.sin(phase * 5 + i) * 0.02, cy + phase * 0.3, z);
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

export function Props({ hexes, density, idle, shadows }: { hexes: readonly PropHex[]; density: number; idle: boolean; shadows: boolean }) {
  const groups = useMemo(() => layoutProps(hexes, density), [hexes, density]);
  const kilns = groups.get("kiln") ?? [];
  return (
    <group name="props">
      {ALL_KINDS.map((kind) => {
        const items = groups.get(kind);
        return items && items.length > 0 ? <PropKindMesh key={kind} kind={kind} items={items} idle={idle} shadows={shadows} /> : null;
      })}
      {idle && kilns.map((k) => <Smoke key={k.hex} x={k.wx} y={k.wy} z={k.wz} scale={k.scale} seed={k.seed} />)}
    </group>
  );
}
