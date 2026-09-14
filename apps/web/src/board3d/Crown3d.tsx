"use client";

/**
 * Crown & Castle on the diorama (docs/phase11.md §11, docs/props.md §4–§5):
 * knights as three GLB figurines (knight_1..3.glb, the level is which model
 * loads; base and top zones in the player's colour, dimmed while inactive),
 * the walled city and the metropolis as whole-city GLBs that replace the
 * city model at that vertex (`CrownCityFigure`), the merchant and the
 * barbarian longship that the on-table track
 * (`src/board/props/BarbarianTrack`) sails along its markers. Each figure
 * keeps its procedural version (the pipless knights, the crenellated ring
 * wall over the city, the spire and gold crown, the cart, the dragon-prowed
 * longship) as the fallback until its GLB loads or if it cannot.
 * `CrownBoard` renders whatever the view holds; the figures are exported
 * for the interaction layer's ghosts.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HexId, KnightLevel, PlayerColor, Track, VertexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { PLAYER_FILL, TRACK_COLOR } from "@/game/theme";
import { easeOutBack, easeOutCubic, progress } from "./geo";
import { SLAB_HEIGHT, hexWorld, vertexWorld } from "./layout3d";
import { PIECE_COLORS, dimColor, usePiece, type PieceName } from "./loadPiece";
import * as P from "./palette";
import { BaseRing, Mat, PIECE_SCALE, ProceduralCity, useEntrance } from "./Pieces";

// ---------------------------------------------------------------------------
// Knights

function Shield({ tint, kite, ghost, position, rotation }: { tint: string; kite: boolean; ghost: boolean; position: [number, number, number]; rotation: [number, number, number] }) {
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
    </group>
  );
}

/** The GLB for a knight level: the level is shown by which model loads. */
export function knightModel(level: KnightLevel): PieceName {
  return level === 1 ? "knight_1" : level === 2 ? "knight_2" : "knight_3";
}

/**
 * A knight of `level` at a vertex: the level's GLB with base and top zones in
 * the player's colour over a grey body, or the procedural figure until it
 * loads (docs/props.md §4: level 1 a squat body with a plain helm and a low
 * shield, level 2 two stacked spheres with a pointed helm and a side shield,
 * level 3 a larger body with a great helm, plume, kite shield, raised sword
 * and cape). Inactive knights have every zone colour × 0.55 and a rough
 * finish (the procedural one turns grey and its ring dims). `fresh` pops it in.
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
    g.scale.setScalar(Math.max(0.001, s));
  });
  const cast = shadows && !ghost;
  const model = usePiece(knightModel(level), {
    color: active ? PLAYER_FILL[color] : dimColor(PLAYER_FILL[color]),
    neutral: active ? PIECE_COLORS.grey : dimColor(PIECE_COLORS.grey),
    roughness: active ? 0.8 : 1,
    ghost,
    castShadow: cast,
    receiveShadow: shadows,
  });
  return (
    <group ref={group} position={p ? [p.x, SLAB_HEIGHT, p.z] : [0, 0, 0]} name={vertex ? `knight:${vertex}` : "knight"}>
      {model ? (
        <primitive object={model} />
      ) : (
        <group scale={PIECE_SCALE}>
          <ProceduralKnight color={color} level={level} active={active} ghost={ghost} shadows={shadows} />
        </group>
      )}
    </group>
  );
}

/** The three-level primitive knight on a base ring; the fallback when the level's GLB is unavailable. */
function ProceduralKnight({ color, level, active, ghost, shadows }: { color: PlayerColor; level: KnightLevel; active: boolean; ghost: boolean; shadows: boolean }) {
  const tint = active ? PLAYER_FILL[color] : P.INACTIVE;
  const cast = shadows && !ghost;
  const body = level === 1 ? 0.07 : level === 2 ? 0.09 : 0.11;
  const head = level === 1 ? 0.045 : 0.055;
  const bodyY = 0.02 + body;
  const headY = bodyY + body * 0.85 + head * 0.8;
  return (
    <>
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
          <Shield tint={tint} kite={false} ghost={ghost} position={[body * 0.9, bodyY - 0.02, 0.03]} rotation={[0, 0.5, 0]} />
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
          <Shield tint={tint} kite={false} ghost={ghost} position={[body + 0.02, bodyY, 0.01]} rotation={[0, Math.PI / 2 - 0.4, 0]} />
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
          <Shield tint={tint} kite ghost={ghost} position={[body * 0.55, bodyY + 0.01, body * 0.95]} rotation={[0, 0, 0]} />
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Walls and metropolises

/**
 * A city that Crown & Castle has upgraded (docs/phase11.md §11): one whole-city
 * GLB per combination — the walled metropolis, the plain metropolis, or the
 * walled city — each larger than the plain city, and the two walled models
 * share a footprint so the wall reads the same size on both. Same vertex
 * placement, entrance rise and hover ghost as `CityFigure`. Until the GLB
 * loads (or if it cannot) it is the city figure with the procedural ring wall
 * and spire drawn over it.
 */
export function CrownCityFigure({ vertex, color, walled, metropolis, fresh = false, seq = null, ghost = false, shadows = true }: { vertex: VertexId; color: PlayerColor; walled: boolean; metropolis: Track | null; fresh?: boolean; seq?: number | null; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  const group = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Group>(null);
  const t = useEntrance(fresh, seq, 300);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const k = fresh && t.current < 1 ? easeOutCubic(t.current) : 1;
    g.position.y = SLAB_HEIGHT - (1 - k) * 0.25;
    if (flag.current) flag.current.scale.x = Math.max(0.001, fresh ? Math.min(1, Math.max(0, (t.current - 0.5) * 2)) : 1);
  });
  const cast = shadows && !ghost;
  const name: PieceName = metropolis ? (walled ? "metropolis_walled" : "metropolis") : "city_walled";
  const model = usePiece(name, { color: PLAYER_FILL[color], neutral: PIECE_COLORS.grey, ghost, castShadow: cast, receiveShadow: shadows });
  return (
    <group ref={group} position={[p.x, SLAB_HEIGHT, p.z]} name={`city:${vertex}`}>
      {model ? (
        <primitive object={model} />
      ) : (
        <>
          <group scale={PIECE_SCALE}>
            <ProceduralCity color={color} ghost={ghost} shadows={shadows} flag={flag} />
          </group>
          {walled && <WallRing vertex={vertex} ghost={ghost} shadows={shadows} centred />}
          {metropolis && <MetropolisCrown vertex={vertex} track={metropolis} ghost={ghost} shadows={shadows} centred />}
        </>
      )}
    </group>
  );
}

/** A low crenellated ring wall around the city at `vertex` (docs/props.md §5); `centred` draws it inside a parent already at the vertex. */
export function WallRing({ vertex, ghost = false, shadows = true, centred = false }: { vertex: VertexId; ghost?: boolean; shadows?: boolean; centred?: boolean }) {
  const p = vertexWorld(vertex);
  const r = 0.13;
  return (
    <group position={centred ? [0, 0, 0] : [p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`wall:${vertex}`}>
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
export function MetropolisCrown({ vertex, track, ghost = false, shadows = true, centred = false }: { vertex: VertexId; track: Track; ghost?: boolean; shadows?: boolean; centred?: boolean }) {
  const p = vertexWorld(vertex);
  const c = TRACK_COLOR[track];
  const cast = shadows && !ghost;
  return (
    <group position={centred ? [0, 0, 0] : [p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`metropolis:${vertex}`}>
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

/** The merchant GLB (one warm neutral) at a hex like the robber, or the procedural figure until it loads; the caller positions the group. */
export function MerchantFigure({ ghost = false, shadows = true }: { ghost?: boolean; shadows?: boolean }) {
  const cast = shadows && !ghost;
  const model = usePiece("merchant", { color: PIECE_COLORS.merchant, ghost, castShadow: cast, receiveShadow: shadows });
  if (model) {
    return (
      <group name="merchant">
        <primitive object={model} />
      </group>
    );
  }
  return <ProceduralMerchant ghost={ghost} shadows={shadows} />;
}

/** A rotund green figure with a ledger beside a two-wheel cart of crates, on a green base ring; the fallback when merchant.glb is unavailable. */
function ProceduralMerchant({ ghost, shadows }: { ghost: boolean; shadows: boolean }) {
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

/**
 * The barbarian longship, hull along its local X so the track can aim it:
 * the GLB (dark red sail over a near-black hull; loadPiece puts its length on
 * Z, so a quarter turn brings it back to X), or the procedural dragon-prowed
 * boat (docs/props.md §5) until it loads. No base ring.
 */
export function LongshipFigure({ shadows = true }: { shadows?: boolean }) {
  const model = usePiece("barbarian_ship", { color: PIECE_COLORS.darkRed, neutral: PIECE_COLORS.nearBlack, castShadow: shadows, receiveShadow: shadows });
  if (model) {
    return (
      <group rotation={[0, Math.PI / 2, 0]} name="longship">
        <primitive object={model} />
      </group>
    );
  }
  return <ProceduralLongship shadows={shadows} />;
}

function ProceduralLongship({ shadows }: { shadows: boolean }) {
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
      {/* Walls and metropolises are whole-city models: Board3D draws `CrownCityFigure` in place of the city (see `crownCityUpgrades`). */}
      {merchant && (
        <group position={[merchant.x + mo.dx, SLAB_HEIGHT, merchant.z + mo.dz]}>
          <MerchantFigure shadows={shadows} />
        </group>
      )}
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
  return out;
}

/** The wall and metropolis at each city vertex, so Board3D can pick the whole-city model to draw there. */
export function crownCityUpgrades(view: RedactedState): Map<VertexId, { walled: boolean; metropolis: Track | null }> {
  const out = new Map<VertexId, { walled: boolean; metropolis: Track | null }>();
  const c = view.crown;
  if (!c || !view.scenario?.crown) return out;
  const at = (v: VertexId) => {
    let u = out.get(v);
    if (!u) {
      u = { walled: false, metropolis: null };
      out.set(v, u);
    }
    return u;
  };
  for (const cp of Object.values(c.players)) {
    for (const v of cp.walls) at(v).walled = true;
    for (const t of ["trade", "politics", "science"] as const) {
      const v = cp.metropolises[t];
      if (v) at(v).metropolis = t;
    }
  }
  return out;
}

/** Which hex the merchant sits on, for the interaction layer's ghost. */
export function merchantWorld(hex: HexId): { x: number; z: number } {
  const c = hexWorld(hex);
  const o = merchantOffset();
  return { x: c.x + o.dx, z: c.z + o.dz };
}
