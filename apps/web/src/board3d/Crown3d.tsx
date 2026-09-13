"use client";

/**
 * Crown & Castle on the diorama (docs/phase11.md §11, docs/props.md §4–§5):
 * knights as three-level figurines in the player's colour (grey while
 * inactive) with a pipped shield, a crenellated ring wall around walled
 * cities, the metropolis spire with a gold crown rising from the keep, the
 * rotund merchant beside his cart, and the barbarian longship advancing
 * along a track at the board's far edge. Everything is primitives; nothing
 * is loaded. `CrownBoard` renders whatever the view holds; the figures are
 * exported for the interaction layer's ghosts.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLEET_STEPS, type HexId, type KnightLevel, type PlayerColor, type Track, type VertexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { PLAYER_FILL, TRACK_COLOR } from "@/game/theme";
import { easeInOut, easeOutBack, progress } from "./geo";
import { SLAB_HEIGHT, hexWorld, vertexWorld, type Bounds } from "./layout3d";
import * as P from "./palette";
import { BaseRing, Mat, PIECE_SCALE } from "./Pieces";

// ---------------------------------------------------------------------------
// Knights

/** Pip positions on the shield face for each level. */
const PIPS: Record<KnightLevel, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-0.012, 0.008],
    [0.012, -0.008],
  ],
  3: [
    [-0.014, 0.01],
    [0, 0],
    [0.014, -0.01],
  ],
};

function Shield({ level, tint, kite, ghost, position, rotation }: { level: KnightLevel; tint: string; kite: boolean; ghost: boolean; position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {kite ? (
        <>
          <mesh>
            <boxGeometry args={[0.05, 0.05, 0.008]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
          <mesh position={[0, -0.032, 0]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.036, 0.036, 0.008]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
        </>
      ) : (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.032, 0.032, 0.008, 10]} />
          <Mat color={tint} ghost={ghost} />
        </mesh>
      )}
      {PIPS[level].map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.006]}>
          <sphereGeometry args={[0.006, 6, 5]} />
          <Mat color={P.WOOL} ghost={ghost} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A knight of `level` on a base ring in the player's colour (docs/props.md §4):
 * level 1 a squat body with a plain helm and a low shield, level 2 two stacked
 * spheres with a pointed helm and a side shield, level 3 a larger body with a
 * great helm, plume, kite shield, raised sword and cape. Inactive knights turn
 * grey and their ring dims. `fresh` pops it in.
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
    g.scale.setScalar(PIECE_SCALE * Math.max(0.001, s));
  });
  const tint = active ? PLAYER_FILL[color] : P.INACTIVE;
  const cast = shadows && !ghost;
  const body = level === 1 ? 0.07 : level === 2 ? 0.09 : 0.11;
  const head = level === 1 ? 0.045 : 0.055;
  const bodyY = 0.02 + body;
  const headY = bodyY + body * 0.85 + head * 0.8;
  return (
    <group ref={group} position={p ? [p.x, SLAB_HEIGHT, p.z] : [0, 0, 0]} scale={PIECE_SCALE} name={vertex ? `knight:${vertex}` : "knight"}>
      <BaseRing color={PLAYER_FILL[color]} ghost={ghost} shadows={shadows} dim={!active} />
      <mesh position={[0, bodyY, 0]} castShadow={cast}>
        <sphereGeometry args={[body, 10, 8]} />
        <Mat color={tint} ghost={ghost} />
      </mesh>
      <mesh position={[0, headY, 0]} castShadow={cast}>
        <sphereGeometry args={[head, 10, 8]} />
        <Mat color={tint} ghost={ghost} />
      </mesh>
      {level === 1 && (
        <>
          <mesh position={[0, headY + head * 0.35, 0]}>
            <sphereGeometry args={[head * 1.05, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
          <Shield level={1} tint={tint} kite={false} ghost={ghost} position={[body * 0.9, bodyY - 0.02, 0.03]} rotation={[0, 0.5, 0]} />
        </>
      )}
      {level === 2 && (
        <>
          <mesh position={[0, headY + head * 0.9, 0]}>
            <coneGeometry args={[head * 0.9, head * 1.4, 8]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
          <mesh position={[0, headY - 0.005, head * 0.95]}>
            <boxGeometry args={[0.05, 0.006, 0.012]} />
            <Mat color={P.DARK} ghost={ghost} />
          </mesh>
          <Shield level={2} tint={tint} kite={false} ghost={ghost} position={[body + 0.02, bodyY, 0.01]} rotation={[0, Math.PI / 2 - 0.4, 0]} />
        </>
      )}
      {level === 3 && (
        <>
          {/* Great helm with a visor slit and a plume. */}
          <mesh position={[0, headY + 0.01, 0]} castShadow={cast}>
            <cylinderGeometry args={[head * 1.05, head * 1.05, head * 2, 10]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
          <mesh position={[0, headY + 0.012, head * 1.06]}>
            <boxGeometry args={[0.05, 0.006, 0.01]} />
            <Mat color={P.DARK} ghost={ghost} />
          </mesh>
          <mesh position={[0, headY + head * 2.1, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.05, 5]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
          <mesh position={[0, headY + head * 2.1 + 0.03, -0.02]} rotation={[-0.9, 0, 0]}>
            <cylinderGeometry args={[0.01, 0.006, 0.06, 5]} />
            <Mat color={tint} ghost={ghost} />
          </mesh>
          <Shield level={3} tint={tint} kite ghost={ghost} position={[body * 0.55, bodyY + 0.01, body * 0.95]} rotation={[0, 0, 0]} />
          {/* Sword raised in the other hand. */}
          <group position={[-body * 0.95, bodyY + 0.04, 0.02]} rotation={[0, 0, 0.35]}>
            <mesh position={[0, 0.07, 0]}>
              <boxGeometry args={[0.012, 0.16, 0.004]} />
              <Mat color={P.SILVER} ghost={ghost} />
            </mesh>
            <mesh position={[0, -0.012, 0]}>
              <boxGeometry args={[0.04, 0.01, 0.01]} />
              <Mat color={P.DARK} ghost={ghost} />
            </mesh>
          </group>
          {/* Cape: a curved sheet behind the body. */}
          <mesh position={[0, bodyY - 0.02, -body * 0.4]}>
            <cylinderGeometry args={[body * 1.15, body * 1.35, body * 1.9, 8, 1, true, Math.PI * 0.7, Math.PI * 0.6]} />
            <Mat color={tint} ghost={ghost} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Walls and metropolises

/** A low crenellated ring wall around the city at `vertex` (docs/props.md §5). */
export function WallRing({ vertex, ghost = false, shadows = true }: { vertex: VertexId; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const r = 0.13;
  return (
    <group position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`wall:${vertex}`}>
      <mesh position={[0, 0.025, 0]} castShadow={shadows && !ghost}>
        <cylinderGeometry args={[r + 0.012, r + 0.014, 0.05, 24, 1, true]} />
        <Mat color={P.KEEP_STONE} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r - 0.012, r + 0.012, 24]} />
        <Mat color={P.KEEP_STONE} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * r, 0.06, Math.sin(a) * r]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.02, 0.02, 0.026]} />
            <Mat color={P.KEEP_STONE} ghost={ghost} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * The metropolis (docs/props.md §5): a central spire rising from the keep to
 * about 0.40 R, its pointed roof in the improvement track's colour, topped by
 * a small gold crown, with two side turrets. Drawn over the city figure.
 */
export function MetropolisCrown({ vertex, track, ghost = false, shadows = true }: { vertex: VertexId; track: Track; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const c = TRACK_COLOR[track];
  const cast = shadows && !ghost;
  return (
    <group position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`metropolis:${vertex}`}>
      <mesh position={[-0.02, 0.27, -0.01]} castShadow={cast}>
        <cylinderGeometry args={[0.035, 0.055, 0.2, 4]} />
        <Mat color={P.KEEP_STONE} ghost={ghost} />
      </mesh>
      <mesh position={[-0.02, 0.4, -0.01]} castShadow={cast}>
        <coneGeometry args={[0.05, 0.08, 4]} />
        <Mat color={c} ghost={ghost} />
      </mesh>
      <group position={[-0.02, 0.44, -0.01]}>
        <mesh position={[0, 0.008, 0]}>
          <cylinderGeometry args={[0.018, 0.016, 0.014, 8]} />
          <Mat color={P.GOLD} ghost={ghost} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.014, 0.024, Math.sin(a) * 0.014]}>
              <coneGeometry args={[0.006, 0.02, 4]} />
              <Mat color={P.GOLD} ghost={ghost} />
            </mesh>
          );
        })}
      </group>
      {[
        [0.075, 0.045],
        [-0.09, 0.05],
      ].map(([x, z], i) => (
        <group key={i} position={[x!, 0, z!]}>
          <mesh position={[0, 0.16, 0]} castShadow={cast}>
            <cylinderGeometry args={[0.022, 0.026, 0.12, 6]} />
            <Mat color={P.KEEP_STONE} ghost={ghost} />
          </mesh>
          <mesh position={[0, 0.245, 0]}>
            <coneGeometry args={[0.03, 0.05, 6]} />
            <Mat color={c} ghost={ghost} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// The merchant

/** Where the merchant camps on a hex: clear of the token and the robber's corner. */
export function merchantOffset(): { dx: number; dz: number } {
  return { dx: -0.46, dz: 0.28 };
}

/** A rotund green figure with a ledger beside a two-wheel cart of crates, on a green base ring; the caller positions the group. */
export function MerchantFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  const cast = shadows && !ghost;
  return (
    <group scale={PIECE_SCALE * 0.9} name="merchant">
      <BaseRing color={P.MERCHANT_GREEN} radius={0.15} ghost={ghost} shadows={shadows} />
      <group position={[0.06, 0, 0.02]}>
        <mesh position={[0, 0.1, 0]} castShadow={cast}>
          <sphereGeometry args={[0.08, 10, 8]} />
          <Mat color={P.MERCHANT_GREEN} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          <Mat color={P.WOOL} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.014, 10]} />
          <Mat color={P.MERCHANT_GREEN} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.255, 0]}>
          <sphereGeometry args={[0.03, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Mat color={P.MERCHANT_GREEN} ghost={ghost} />
        </mesh>
        <mesh position={[0.075, 0.12, 0.03]} rotation={[0, 0.3, 0.2]}>
          <boxGeometry args={[0.03, 0.04, 0.012]} />
          <Mat color={P.WOOL} ghost={ghost} />
        </mesh>
      </group>
      <group position={[-0.09, 0, -0.02]} rotation={[0, 0.2, 0]}>
        <mesh position={[0, 0.07, 0]} castShadow={cast}>
          <boxGeometry args={[0.12, 0.03, 0.09]} />
          <Mat color={P.TIMBER} ghost={ghost} />
        </mesh>
        {[-0.055, 0.055].map((z) => (
          <mesh key={z} position={[0, 0.045, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.012, 8]} />
            <Mat color={P.TRUNK} ghost={ghost} />
          </mesh>
        ))}
        <mesh position={[-0.02, 0.11, 0]} castShadow={cast}>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <Mat color={P.TIMBER} ghost={ghost} />
        </mesh>
        <mesh position={[0.03, 0.11, 0.005]} rotation={[0, 0.4, 0]}>
          <boxGeometry args={[0.045, 0.045, 0.045]} />
          <Mat color={P.LOG_END} ghost={ghost} />
        </mesh>
        <mesh position={[0.09, 0.075, 0]} rotation={[0, 0, -0.2]}>
          <boxGeometry args={[0.08, 0.01, 0.02]} />
          <Mat color={P.TIMBER} ghost={ghost} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// The barbarian fleet

const TATTERED_SAIL = (() => {
  const s = new THREE.Shape();
  const w = 0.3;
  const h = 0.28;
  s.moveTo(-w / 2, h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(w / 2 - 0.01, -h / 2 + 0.05);
  // A notched bottom edge.
  const teeth = 5;
  for (let i = 0; i <= teeth; i++) {
    const x = w / 2 - (i / teeth) * w;
    s.lineTo(x, i % 2 ? -h / 2 : -h / 2 + 0.04);
  }
  s.lineTo(-w / 2 + 0.015, -h / 2 + 0.08);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(0.05, 0.02);
  hole.lineTo(0.08, -0.01);
  hole.lineTo(0.05, -0.04);
  hole.lineTo(0.02, -0.01);
  s.holes.push(hole);
  return s;
})();

/** The barbarian longship (docs/props.md §5): dragon prow, shields along each side, a tattered square sail, no base ring. */
export function LongshipFigure({ shadows = true }: { shadows?: boolean }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(TATTERED_SAIL), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group scale={PIECE_SCALE * 0.8} name="longship">
      <mesh position={[0, 0.05, 0]} castShadow={shadows}>
        <boxGeometry args={[0.84, 0.06, 0.16]} />
        <Mat color={P.LONGSHIP_HULL} />
      </mesh>
      {[-0.075, 0.075].map((z) => (
        <mesh key={z} position={[0, 0.095, z]}>
          <boxGeometry args={[0.8, 0.05, 0.014]} />
          <Mat color={P.LONGSHIP_HULL} />
        </mesh>
      ))}
      <mesh position={[0.44, 0.05, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.11, 0.06, 0.11]} />
        <Mat color={P.LONGSHIP_HULL} />
      </mesh>
      <mesh position={[-0.44, 0.05, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.11, 0.06, 0.11]} />
        <Mat color={P.LONGSHIP_HULL} />
      </mesh>
      {/* Dragon-head prow: stacked cones curling up and forward. */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.46 + i * 0.02, 0.1 + i * 0.05, 0]} rotation={[0, 0, -0.3]}>
          <coneGeometry args={[0.032 - i * 0.005, 0.07, 6]} />
          <Mat color={P.LONGSHIP_HULL} />
        </mesh>
      ))}
      <mesh position={[0.53, 0.26, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.06, 0.03, 0.03]} />
        <Mat color={P.LONGSHIP_HULL} />
      </mesh>
      <mesh position={[0.56, 0.245, 0]}>
        <coneGeometry args={[0.012, 0.03, 4]} />
        <Mat color={P.SOOT} />
      </mesh>
      <mesh position={[-0.46, 0.12, 0]} rotation={[0, 0, 0.4]}>
        <coneGeometry args={[0.022, 0.08, 6]} />
        <Mat color={P.LONGSHIP_HULL} />
      </mesh>
      {/* Six round shields along each side. */}
      {[-0.085, 0.085].flatMap((z) =>
        [0, 1, 2, 3, 4, 5].map((k) => (
          <mesh key={`${z}${k}`} position={[-0.3 + k * 0.12, 0.11, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.028, 0.028, 0.008, 8]} />
            <Mat color={k % 2 ? P.BRICK : P.LONGSHIP_SAIL} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.009, 0.009, 0.46, 5]} />
        <Mat color={P.TRUNK} />
      </mesh>
      <mesh position={[0, 0.48, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.34, 5]} />
        <Mat color={P.TRUNK} />
      </mesh>
      <mesh geometry={geometry} position={[0.02, 0.33, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Mat color={P.LONGSHIP_SAIL} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** The fleet track along the board's far edge: a stone marker per step and the longship at the fleet's position. */
function FleetTrack({ bounds, position, shadows }: { bounds: Bounds; position: number; shadows: boolean }) {
  const z = bounds.minZ - 0.9;
  const span = Math.min(3.2, (bounds.maxX - bounds.minX) * 0.7);
  const x0 = bounds.cx - span / 2;
  const at = (i: number) => x0 + (span * i) / FLEET_STEPS;
  const ship = useRef<THREE.Group>(null);
  const from = useRef<number | null>(null);
  const to = useRef(position);
  const start = useRef(0);
  useEffect(() => {
    if (to.current !== position) {
      from.current = to.current;
      to.current = position;
      start.current = performance.now();
    }
  }, [position]);
  useFrame(({ clock }) => {
    const g = ship.current;
    if (!g) return;
    const bob = Math.sin(clock.getElapsedTime() * 1.3) * 0.008;
    const f = from.current;
    if (f === null) {
      g.position.set(at(to.current), bob, z);
      return;
    }
    const t = Math.min(1, (performance.now() - start.current) / 700);
    const k = easeInOut(t);
    g.position.set(at(f) + (at(to.current) - at(f)) * k, bob, z);
    if (t >= 1) from.current = null;
  });
  return (
    <group name="fleet-track">
      {Array.from({ length: FLEET_STEPS + 1 }, (_, i) => (
        <mesh key={i} position={[at(i), 0.01, z]} receiveShadow={shadows}>
          <cylinderGeometry args={[i === FLEET_STEPS ? 0.12 : 0.07, i === FLEET_STEPS ? 0.13 : 0.08, 0.02, 8]} />
          <Mat color={i === FLEET_STEPS ? P.BRICK : P.KEEP_STONE} />
        </mesh>
      ))}
      <group ref={ship} position={[at(position), 0, z]}>
        <LongshipFigure shadows={shadows} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------

/** Everything Crown & Castle adds to the board, from the rendered view. */
export function CrownBoard({ view, shadows, freshKnight, bounds }: { view: RedactedState; shadows: boolean; freshKnight: VertexId | null; bounds: Bounds }) {
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
          return v ? [<MetropolisCrown key={`m:${t}`} vertex={v} track={t} shadows={shadows} />] : [];
        }),
      ])}
      {merchant && (
        <group position={[merchant.x + mo.dx, SLAB_HEIGHT, merchant.z + mo.dz]}>
          <MerchantFigure shadows={shadows} />
        </group>
      )}
      <FleetTrack bounds={bounds} position={Math.min(FLEET_STEPS, Math.max(0, c.fleet))} shadows={shadows} />
    </group>
  );
}

/** The sr-only lines for the module's pieces: knights, walls, metropolises, the merchant and the fleet. */
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
  out.push({ key: "longship", piece: "longship", text: `Barbarian fleet at step ${c.fleet} of ${FLEET_STEPS}` });
  return out;
}

/** Which hex the merchant sits on, for the interaction layer's ghost. */
export function merchantWorld(hex: HexId): { x: number; z: number } {
  const c = hexWorld(hex);
  const o = merchantOffset();
  return { x: c.x + o.dx, z: c.z + o.dz };
}
