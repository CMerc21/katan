"use client";

/**
 * Crown & Castle on the diorama (docs/phase11.md §11): knights as shields
 * with one to three pips in the player's colour (laid back and greyed while
 * inactive), a stone ring around walled cities, a metropolis crown in the
 * track's colour on top of the keep, and the merchant's striped tent on its
 * hex. Everything is primitives in the palette (docs/art-direction.md);
 * nothing is loaded. `CrownBoard` renders whatever the view holds; the
 * figures are exported for the interaction layer's ghosts.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { HexId, KnightLevel, PlayerColor, Track, VertexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { GILT, PLAYER_FILL, TRACK_COLOR } from "@/game/theme";
import { easeOutBack, progress } from "./geo";
import { SLAB_HEIGHT, hexWorld, vertexWorld } from "./layout3d";

const PIECE_SCALE = 1.5;
const STONE = "#a9a59b";
const STONE_DARK = "#8f8b82";
const BONE = "#efe8d8";
const INK = "#211d19";
const TIMBER = "#8a6a44";
const CANVAS = "#efe2c4";
const CANVAS_STRIPE = "#9b2226";
const INACTIVE = "#8f8b82";

function Mat({ color, ghost = false, side }: { color: string; ghost?: boolean; side?: THREE.Side }) {
  return <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={ghost ? 0.5 : 1} depthWrite={!ghost} side={side ?? THREE.FrontSide} />;
}

// ---------------------------------------------------------------------------
// Knights

/** Pip positions on the shield face for each level. */
const PIPS: Record<KnightLevel, [number, number][]> = {
  1: [[0, 0.02]],
  2: [
    [-0.045, 0.05],
    [0.045, -0.01],
  ],
  3: [
    [-0.05, 0.06],
    [0, 0.01],
    [0.05, -0.04],
  ],
};

/**
 * A shield with `level` pips and a helm above it, on a base ring in the
 * player's colour. Inactive knights lie back on the ground in grey; the
 * caller positions the group (or passes `vertex`). `fresh` pops it in.
 */
export function KnightFigure({ vertex, color, level, active, ghost = false, shadows = true, fresh = false }: { vertex?: VertexId; color: PlayerColor; level: KnightLevel; active: boolean; ghost?: boolean; shadows?: boolean; fresh?: boolean }) {
  const p = vertex ? vertexWorld(vertex) : null;
  const group = useRef<THREE.Group>(null);
  const started = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const now = clock.getElapsedTime() * 1000;
    if (fresh && started.current === null) started.current = now;
    const t = started.current === null ? 1 : progress(started.current, 320, now);
    const s = fresh && t < 1 ? easeOutBack(t) : 1;
    g.scale.setScalar(PIECE_SCALE * 0.9 * Math.max(0.001, s));
  });
  const tint = active ? PLAYER_FILL[color] : INACTIVE;
  const rim = active ? BONE : STONE_DARK;
  const tilt = active ? -0.18 : -1.1;
  const lift = active ? 0.17 : 0.06;
  return (
    <group ref={group} position={p ? [p.x, SLAB_HEIGHT, p.z] : [0, 0, 0]} scale={PIECE_SCALE * 0.9} name={vertex ? `knight:${vertex}` : "knight"}>
      <mesh position={[0, 0.012, 0]} receiveShadow={shadows}>
        <cylinderGeometry args={[0.17, 0.19, 0.025, 16]} />
        <Mat color={PLAYER_FILL[color]} ghost={ghost} />
      </mesh>
      <group position={[0, lift, active ? 0 : 0.05]} rotation={[tilt, 0, 0]}>
        {/* The shield: a rimmed board with a pointed foot. */}
        <mesh castShadow={shadows && !ghost}>
          <boxGeometry args={[0.24, 0.26, 0.04]} />
          <Mat color={rim} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.005, 0.022]}>
          <boxGeometry args={[0.19, 0.2, 0.012]} />
          <Mat color={tint} ghost={ghost} />
        </mesh>
        <mesh position={[0, -0.16, 0]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.12, 0.12, 0.04]} />
          <Mat color={rim} ghost={ghost} />
        </mesh>
        {PIPS[level].map(([x, y], i) => (
          <mesh key={i} position={[x, y, 0.035]}>
            <sphereGeometry args={[0.022, 8, 6]} />
            <Mat color={active ? GILT : BONE} ghost={ghost} />
          </mesh>
        ))}
        {/* The helm rides above the shield. */}
        <mesh position={[0, 0.2, -0.01]}>
          <sphereGeometry args={[0.055, 10, 8]} />
          <Mat color={active ? STONE : INACTIVE} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.25, -0.01]}>
          <coneGeometry args={[0.02, 0.07, 6]} />
          <Mat color={active ? PLAYER_FILL[color] : STONE_DARK} ghost={ghost} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Walls and metropolises

/** A crenellated stone ring around the city at `vertex` (docs/rules.md §16.7). */
export function WallRing({ vertex, ghost = false, shadows = true }: { vertex: VertexId; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const r = 0.5;
  return (
    <group position={[p.x, SLAB_HEIGHT, p.z]} name={`wall:${vertex}`}>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow={shadows && !ghost}>
        <torusGeometry args={[r, 0.045, 6, 24]} />
        <Mat color={STONE} ghost={ghost} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * r, 0.11, Math.sin(a) * r]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.07, 0.06, 0.09]} />
            <Mat color={i % 2 ? STONE_DARK : STONE} ghost={ghost} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.045, r]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.16, 0.08, 0.05]} />
        <Mat color={TIMBER} ghost={ghost} />
      </mesh>
    </group>
  );
}

/** The metropolis crown of `track` on top of the keep at `vertex` (docs/rules.md §16.7). */
export function MetropolisCrown({ vertex, track, ghost = false }: { vertex: VertexId; track: Track; ghost?: boolean }) {
  const p = vertexWorld(vertex);
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.getElapsedTime() * 0.3;
  });
  const c = TRACK_COLOR[track];
  return (
    <group ref={group} position={[p.x, SLAB_HEIGHT + 0.86, p.z]} name={`metropolis:${vertex}`}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.035, 6, 16]} />
        <Mat color={c} ghost={ghost} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.16, 0.08, Math.sin(a) * 0.16]}>
            <coneGeometry args={[0.035, 0.14, 4]} />
            <Mat color={GILT} ghost={ghost} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.04, 8, 6]} />
        <Mat color={GILT} ghost={ghost} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// The merchant

/** Where the merchant camps on a hex: clear of the token and the robber's corner. */
export function merchantOffset(): { dx: number; dz: number } {
  return { dx: -0.46, dz: 0.28 };
}

/** A striped market tent with a pennant; the caller positions the group. */
export function MerchantFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  return (
    <group scale={PIECE_SCALE * 0.9} name="merchant">
      <mesh position={[0, 0.012, 0]} receiveShadow={shadows}>
        <cylinderGeometry args={[0.16, 0.18, 0.025, 12]} />
        <Mat color={TIMBER} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow={shadows && !ghost}>
        <coneGeometry args={[0.17, 0.28, 8, 1, true]} />
        <Mat color={CANVAS} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
      {[0, 2, 4, 6].map((i) => {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.085, 0.16, Math.sin(a) * 0.085]} rotation={[0, -a + Math.PI / 2, 0]}>
            <boxGeometry args={[0.06, 0.26, 0.012]} />
            <Mat color={CANVAS_STRIPE} ghost={ghost} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.18, 5]} />
        <Mat color={INK} ghost={ghost} />
      </mesh>
      <mesh position={[0.04, 0.44, 0]}>
        <boxGeometry args={[0.08, 0.05, 0.01]} />
        <Mat color={GILT} ghost={ghost} />
      </mesh>
      <mesh position={[0.2, 0.05, 0.05]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.1, 0.08, 0.07]} />
        <Mat color={TIMBER} ghost={ghost} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------

/** Everything Crown & Castle adds to the board, from the rendered view. */
export function CrownBoard({ view, shadows, freshKnight }: { view: RedactedState; shadows: boolean; freshKnight: VertexId | null }) {
  const c = view.crown;
  if (!c || !view.scenario?.crown) return null;
  const colorOf = new Map(view.players.map((p) => [p.id, p.color] as const));
  const merchant = c.merchant ? hexWorld(c.merchant.hex) : null;
  const mo = merchantOffset();
  return (
    <group name="crown">
      {c.knights.map((k) => (
        <KnightFigure key={`${k.owner}:${k.at}`} vertex={k.at} color={colorOf.get(k.owner) ?? "white"} level={k.level} active={k.active} shadows={shadows} fresh={freshKnight === k.at} />
      ))}
      {Object.entries(c.players).flatMap(([id, cp]) => [
        ...cp.walls.map((v) => <WallRing key={`w:${id}:${v}`} vertex={v} shadows={shadows} />),
        ...(["trade", "politics", "science"] as const).flatMap((t) => {
          const v = cp.metropolises[t];
          return v ? [<MetropolisCrown key={`m:${t}`} vertex={v} track={t} />] : [];
        }),
      ])}
      {merchant && (
        <group position={[merchant.x + mo.dx, SLAB_HEIGHT, merchant.z + mo.dz]}>
          <MerchantFigure shadows={shadows} />
        </group>
      )}
    </group>
  );
}

/** The sr-only lines for the module's pieces: knights, walls, metropolises and the merchant. */
export function crownPieceList(view: RedactedState): { key: string; piece: string; color?: PlayerColor; text: string }[] {
  const out: { key: string; piece: string; color?: PlayerColor; text: string }[] = [];
  const c = view.crown;
  if (!c || !view.scenario?.crown) return out;
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  const colorOf = (id: string) => view.players.find((p) => p.id === id)?.color ?? "white";
  for (const k of c.knights) out.push({ key: `knight:${k.at}`, piece: "knight", color: colorOf(k.owner), text: `${nameOf(k.owner)} level ${k.level} knight at ${k.at}, ${k.active ? "active" : "inactive"}` });
  for (const [id, cp] of Object.entries(c.players)) {
    for (const v of cp.walls) out.push({ key: `wall:${id}:${v}`, piece: "wall", color: colorOf(id), text: `${nameOf(id)} wall at ${v}` });
    for (const t of ["trade", "politics", "science"] as const) {
      const v = cp.metropolises[t];
      if (v) out.push({ key: `metropolis:${t}`, piece: "metropolis", color: colorOf(id), text: `${nameOf(id)} ${t} metropolis at ${v}` });
    }
  }
  if (c.merchant) out.push({ key: "merchant", piece: "merchant", color: colorOf(c.merchant.playerId), text: `${nameOf(c.merchant.playerId)} merchant on ${c.merchant.hex}` });
  return out;
}

/** Which hex the merchant sits on, for the interaction layer's ghost. */
export function merchantWorld(hex: HexId): { x: number; z: number } {
  const c = hexWorld(hex);
  const o = merchantOffset();
  return { x: c.x + o.dx, z: c.z + o.dz };
}
