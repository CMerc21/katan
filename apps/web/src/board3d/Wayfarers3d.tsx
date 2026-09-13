"use client";

/**
 * Wayfarers on the diorama (docs/phase10.md §5): the lake's water, fishing
 * ground buoys with their tokens, river ribbons and bridges, oasis palms,
 * caravan camels along their tracks, guards and castles for the raiders,
 * scorched raided hexes, wagons with cargo, and the goods and demand sign at
 * every city. Everything is primitives in the palette (docs/art-direction.md);
 * nothing is loaded. `WayfarersBoard` renders whatever the view's scenario
 * switches on; the figures are exported for the interaction layer's ghosts.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { EdgeId, HexId, PlayerColor, VertexId, WagonGood } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { GILT, GOOD_COLOR, PLAYER_FILL, WATER, WATER_DEEP } from "@/game/theme";
import { easeInOut } from "./geo";
import { SLAB_HEIGHT, edgeWorld, hexWorld, outwardWorld, vertexWorld, type World } from "./layout3d";
import { tokenTexture } from "./textures";

const PIECE_SCALE = 1.5;
const STONE = "#a9a59b";
const STONE_DARK = "#8f8b82";
const TIMBER = "#8a6a44";
const BONE = "#efe8d8";
const INK = "#211d19";
const CAMEL = "#c9a06a";
const CAMEL_DARK = "#a57d48";
const PALM = "#3e6b46";
const PALM_DARK = "#2b4d32";
const SAND = "#d9c9a0";
const ASH = "#1a1410";

function Mat({ color, ghost = false, side }: { color: string; ghost?: boolean; side?: THREE.Side }) {
  return <meshStandardMaterial color={color} flatShading transparent={ghost} opacity={ghost ? 0.5 : 1} depthWrite={!ghost} side={side ?? THREE.FrontSide} />;
}

// ---------------------------------------------------------------------------
// Raiders: castles and guards

/** A keep tower beside the settlement or city at `vertex` (docs/rules.md §15.5). */
export function CastleFigure({ vertex, color, ghost = false, shadows = true }: { vertex: VertexId; color: PlayerColor; ghost?: boolean; shadows?: boolean }) {
  const p = vertexWorld(vertex);
  return (
    <group position={[p.x, SLAB_HEIGHT, p.z]} scale={PIECE_SCALE} name={`castle:${vertex}`}>
      <group position={[0.2, 0, -0.2]}>
        <mesh position={[0, 0.01, 0]} receiveShadow={shadows}>
          <cylinderGeometry args={[0.13, 0.14, 0.02, 12]} />
          <Mat color={PLAYER_FILL[color]} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.17, 0]} castShadow={shadows && !ghost}>
          <cylinderGeometry args={[0.09, 0.1, 0.32, 10]} />
          <Mat color={STONE} ghost={ghost} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.08, 0.36, Math.sin(a) * 0.08]}>
              <boxGeometry args={[0.04, 0.05, 0.04]} />
              <Mat color={STONE_DARK} ghost={ghost} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.48, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 0.22, 5]} />
          <Mat color={INK} ghost={ghost} />
        </mesh>
        <mesh position={[0.05, 0.55, 0]}>
          <boxGeometry args={[0.1, 0.06, 0.01]} />
          <Mat color={PLAYER_FILL[color]} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0.06, 0.101]}>
          <boxGeometry args={[0.05, 0.08, 0.01]} />
          <Mat color={INK} ghost={ghost} />
        </mesh>
      </group>
    </group>
  );
}

/** Where the `i`-th guard stands on a hex: a ring around the token, clear of the robber's corner. */
export function guardOffset(i: number): { dx: number; dz: number } {
  const a = Math.PI * (0.62 + i * 0.27);
  return { dx: Math.cos(a) * 0.5, dz: Math.sin(a) * 0.5 };
}

/** A small spearman in the player's colour; the caller positions the group. */
export function GuardFigure({ color, ghost = false, shadows = true }: { color: PlayerColor; ghost?: boolean; shadows?: boolean }) {
  return (
    <group scale={PIECE_SCALE * 0.8} name="guard">
      <mesh position={[0, 0.08, 0]} castShadow={shadows && !ghost}>
        <cylinderGeometry args={[0.045, 0.06, 0.16, 7]} />
        <Mat color={PLAYER_FILL[color]} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.045, 8, 6]} />
        <Mat color={BONE} ghost={ghost} />
      </mesh>
      <mesh position={[0, 0.235, 0]}>
        <coneGeometry args={[0.05, 0.05, 7]} />
        <Mat color={STONE_DARK} ghost={ghost} />
      </mesh>
      <mesh position={[0.07, 0.17, 0]}>
        <cylinderGeometry args={[0.007, 0.007, 0.34, 5]} />
        <Mat color={TIMBER} ghost={ghost} />
      </mesh>
      <mesh position={[0.07, 0.36, 0]}>
        <coneGeometry args={[0.018, 0.05, 5]} />
        <Mat color={STONE_DARK} ghost={ghost} />
      </mesh>
    </group>
  );
}

/** A raided hex (docs/rules.md §15.5): ash over the tile and charred stakes. */
function RaidedOverlay({ hex }: { hex: HexId }) {
  const c = hexWorld(hex);
  return (
    <group position={[c.x, SLAB_HEIGHT + 0.012, c.z]} name={`raided:${hex}`}>
      <mesh rotation={[-Math.PI / 2, Math.PI / 6, 0]}>
        <circleGeometry args={[0.93, 6]} />
        <meshBasicMaterial color={ASH} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {[
        [-0.35, 0.3],
        [0.15, -0.45],
        [0.45, 0.4],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[dx as number, 0.06, dz as number]} rotation={[0.2 * i, 0, 0.3 - 0.2 * i]}>
          <cylinderGeometry args={[0.012, 0.03, 0.14, 5]} />
          <meshStandardMaterial color="#2a2622" flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Fishing: the lake and the fishing grounds

function LakeWater({ hex, idle }: { hex: HexId; idle: boolean }) {
  const c = hexWorld(hex);
  const rings = useRef<THREE.Mesh[]>([]);
  rings.current = [];
  useFrame(({ clock }) => {
    if (!idle) return;
    const t = clock.getElapsedTime();
    rings.current.forEach((m, i) => {
      const k = (t * 0.25 + i * 0.5) % 1;
      m.scale.setScalar(0.3 + k * 0.9);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
    });
  });
  return (
    <group position={[c.x, SLAB_HEIGHT, c.z]} name={`lake:${hex}`}>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, Math.PI / 6, 0]}>
        <circleGeometry args={[0.86, 6]} />
        <meshStandardMaterial color={WATER} roughness={0.25} transparent opacity={0.9} />
      </mesh>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) rings.current.push(el);
          }}
          position={[0.1 * i, 0.012, -0.15 * i]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.5, 0.54, 32]} />
          <meshBasicMaterial color="#dff2f7" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      ))}
      {[
        [-0.62, 0.35],
        [-0.55, 0.45],
        [0.6, -0.4],
        [0.66, -0.3],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[dx as number, 0.1, dz as number]} rotation={[0.1, 0, i % 2 ? 0.15 : -0.1]}>
          <cylinderGeometry args={[0.008, 0.012, 0.2, 4]} />
          <meshStandardMaterial color={PALM_DARK} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** A buoy with the ground's number token off the coast edge (docs/rules.md §15.2). */
function FishingGroundMarker({ edge, token, centre, land }: { edge: EdgeId; token: number; centre: World; land: ReadonlySet<HexId> }) {
  const { mid, angle } = edgeWorld(edge);
  const out = outwardWorld(edge, centre, land);
  const texture = useMemo(() => tokenTexture(token), [token]);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: "#b8905f", roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
    return [side, top, side];
  }, [texture]);
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = 0.06 + Math.sin(clock.getElapsedTime() * 1.4 + mid.x) * 0.01;
  });
  return (
    <group position={[mid.x + out.x * 0.45, 0.06, mid.z + out.z * 0.45]} ref={group} name={`fishing:${edge}`}>
      <mesh material={materials} rotation={[0, -angle, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.03, 24]} />
      </mesh>
      <mesh position={[0.3, 0.06, 0]}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshStandardMaterial color="#c8412b" flatShading />
      </mesh>
      <mesh position={[0.3, 0.14, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 0.12, 4]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      {[-0.3, -0.15, 0].map((x, i) => (
        <mesh key={i} position={[-0.3 + x * 0.5, 0.02, 0.2 - i * 0.05]}>
          <sphereGeometry args={[0.03, 6, 5]} />
          <meshStandardMaterial color={BONE} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rivers and bridges

function RiverRibbon({ edge, bridged, shadows }: { edge: EdgeId; bridged: boolean; shadows: boolean }) {
  const { mid, angle } = edgeWorld(edge);
  return (
    <group position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]} name={`river:${edge}`}>
      <mesh position={[0, 0.006, 0]}>
        <boxGeometry args={[1.02, 0.012, 0.16]} />
        <meshStandardMaterial color={WATER_DEEP} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.013, 0]}>
        <boxGeometry args={[1.0, 0.004, 0.06]} />
        <meshStandardMaterial color={WATER} roughness={0.2} />
      </mesh>
      {bridged && (
        <group name={`bridge:${edge}`}>
          <mesh position={[0, 0.13, 0]} castShadow={shadows}>
            <boxGeometry args={[0.5, 0.04, 0.26]} />
            <Mat color={TIMBER} />
          </mesh>
          {[-0.12, 0.12].map((z) => (
            <mesh key={z} position={[0, 0.19, z]}>
              <boxGeometry args={[0.5, 0.02, 0.02]} />
              <Mat color={INK} />
            </mesh>
          ))}
          {[-0.2, 0.2].flatMap((x) =>
            [-0.12, 0.12].map((z) => (
              <mesh key={`${x}${z}`} position={[x, 0.11, z]}>
                <cylinderGeometry args={[0.015, 0.015, 0.16, 5]} />
                <Mat color={INK} />
              </mesh>
            )),
          )}
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Caravans: oases and camels

function OasisMarker({ hex, idle }: { hex: HexId; idle: boolean }) {
  const c = hexWorld(hex);
  const fronds = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (fronds.current && idle) fronds.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.8 + c.x) * 0.08;
  });
  return (
    <group position={[c.x - 0.38, SLAB_HEIGHT, c.z - 0.28]} name={`oasis:${hex}`}>
      <mesh position={[0.25, 0.008, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 16]} />
        <meshStandardMaterial color={WATER} roughness={0.25} />
      </mesh>
      <mesh position={[0.25, 0.004, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.24, 0.3, 16]} />
        <meshStandardMaterial color={SAND} />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[0, 0, 0.12]} castShadow>
        <cylinderGeometry args={[0.025, 0.045, 0.42, 6]} />
        <meshStandardMaterial color={TIMBER} flatShading />
      </mesh>
      <group ref={fronds} position={[0.05, 0.42, 0]}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14]} rotation={[0, -a, -0.5]}>
              <boxGeometry args={[0.3, 0.012, 0.07]} />
              <meshStandardMaterial color={i % 2 ? PALM : PALM_DARK} flatShading />
            </mesh>
          );
        })}
        <mesh>
          <sphereGeometry args={[0.04, 6, 5]} />
          <meshStandardMaterial color={CAMEL_DARK} flatShading />
        </mesh>
      </group>
    </group>
  );
}

function Camel({ x, flip }: { x: number; flip: boolean }) {
  return (
    <group position={[x, 0, 0]} rotation={[0, flip ? Math.PI : 0, 0]} scale={0.9}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.2, 0.08, 0.08]} />
        <Mat color={CAMEL} />
      </mesh>
      {[-0.04, 0.04].map((dx) => (
        <mesh key={dx} position={[dx, 0.18, 0]}>
          <sphereGeometry args={[0.04, 6, 5]} />
          <Mat color={CAMEL_DARK} />
        </mesh>
      ))}
      <mesh position={[0.12, 0.19, 0]} rotation={[0, 0, -0.6]}>
        <boxGeometry args={[0.04, 0.16, 0.04]} />
        <Mat color={CAMEL} />
      </mesh>
      <mesh position={[0.18, 0.26, 0]}>
        <boxGeometry args={[0.07, 0.04, 0.05]} />
        <Mat color={CAMEL_DARK} />
      </mesh>
      {[-0.07, 0.07].flatMap((dx) =>
        [-0.03, 0.03].map((dz) => (
          <mesh key={`${dx}${dz}`} position={[dx, 0.04, dz]}>
            <cylinderGeometry args={[0.012, 0.012, 0.08, 4]} />
            <Mat color={CAMEL_DARK} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Two camels walking each edge of a caravan track (docs/rules.md §15.6). */
function CaravanTrack({ edges, index }: { edges: readonly EdgeId[]; index: number }) {
  return (
    <group name={`caravan:${index}`}>
      {edges.map((e) => {
        const { mid, angle } = edgeWorld(e);
        return (
          <group key={e} position={[mid.x, SLAB_HEIGHT + 0.08, mid.z]} rotation={[0, -angle, 0]}>
            <Camel x={-0.22} flip={false} />
            <Camel x={0.2} flip={false} />
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wagons and goods

/** A covered cart in the player's colour with its cargo cubes; the caller positions it (or passes `vertex`). */
export function WagonFigure({ vertex, color, cargo, ghost = false, shadows = true }: { vertex?: VertexId; color: PlayerColor; cargo: readonly WagonGood[]; ghost?: boolean; shadows?: boolean }) {
  const p = vertex ? vertexWorld(vertex) : null;
  const o = wagonOffset();
  return (
    <group position={p ? [p.x + o.dx, SLAB_HEIGHT, p.z + o.dz] : [0, 0, 0]} scale={PIECE_SCALE * 0.85} rotation={[0, 0.5, 0]} name={vertex ? `wagon:${vertex}` : "wagon"}>
      <mesh position={[0, 0.09, 0]} castShadow={shadows && !ghost}>
        <boxGeometry args={[0.24, 0.07, 0.14]} />
        <Mat color={TIMBER} ghost={ghost} />
      </mesh>
      <mesh position={[-0.04, 0.13, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.075, 0.075, 0.15, 8, 1, true, 0, Math.PI]} />
        <Mat color={PLAYER_FILL[color]} ghost={ghost} side={THREE.DoubleSide} />
      </mesh>
      {[-0.07, 0.07].flatMap((x) =>
        [-0.08, 0.08].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.05, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.02, 8]} />
            <Mat color={INK} ghost={ghost} />
          </mesh>
        )),
      )}
      <mesh position={[0.17, 0.1, 0]} rotation={[0, 0, -0.25]}>
        <boxGeometry args={[0.12, 0.015, 0.03]} />
        <Mat color={TIMBER} ghost={ghost} />
      </mesh>
      {cargo.map((good, i) => (
        <mesh key={i} position={[0.06 + i * 0.05, 0.155, i % 2 ? 0.03 : -0.03]} castShadow={shadows && !ghost}>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <Mat color={GOOD_COLOR[good]} ghost={ghost} />
        </mesh>
      ))}
    </group>
  );
}

/** Where a wagon parks beside the building at a vertex. */
export function wagonOffset(): { dx: number; dz: number } {
  return { dx: -0.3, dz: 0.24 };
}

/** A wagon that rolls to its new vertex (docs/rules.md §15.7) instead of jumping. */
function AnimatedWagon({ at, color, cargo, shadows }: { at: VertexId; color: PlayerColor; cargo: readonly WagonGood[]; shadows: boolean }) {
  const group = useRef<THREE.Group>(null);
  const from = useRef<World | null>(null);
  const to = useRef<VertexId>(at);
  const start = useRef(0);
  const o = wagonOffset();
  const dest = (v: VertexId): World => {
    const p = vertexWorld(v);
    return { x: p.x + o.dx, z: p.z + o.dz };
  };
  useEffect(() => {
    if (to.current !== at) {
      from.current = dest(to.current);
      to.current = at;
      start.current = performance.now();
    }
  }, [at]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const end = dest(to.current);
    const f = from.current;
    if (!f) {
      g.position.set(end.x, SLAB_HEIGHT, end.z);
      return;
    }
    const t = Math.min(1, (performance.now() - start.current) / 550);
    const k = easeInOut(t);
    g.position.set(f.x + (end.x - f.x) * k, SLAB_HEIGHT + Math.abs(Math.sin(t * Math.PI * 4)) * 0.02, f.z + (end.z - f.z) * k);
    if (t >= 1) from.current = null;
  });
  return (
    <group ref={group}>
      <WagonFigure color={color} cargo={cargo} shadows={shadows} />
    </group>
  );
}

/** Goods waiting at a city and the sign showing what it asks for (docs/rules.md §15.7). */
function CityGoods({ vertex, stock, demand }: { vertex: VertexId; stock: readonly WagonGood[]; demand: WagonGood | undefined }) {
  const p = vertexWorld(vertex);
  return (
    <group position={[p.x + 0.34, SLAB_HEIGHT, p.z + 0.3]} name={`goods:${vertex}`}>
      {stock.map((good, i) => (
        <mesh key={i} position={[i * 0.11, 0.05, 0]} rotation={[0, 0.3 * i, 0]}>
          <boxGeometry args={[0.09, 0.09, 0.09]} />
          <Mat color={GOOD_COLOR[good]} />
        </mesh>
      ))}
      {demand && (
        <group position={[-0.16, 0, 0]} name={`demand:${vertex}`}>
          <mesh position={[0, 0.13, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.26, 5]} />
            <Mat color={INK} />
          </mesh>
          <mesh position={[0, 0.24, 0]} rotation={[0, -0.6, 0]}>
            <boxGeometry args={[0.14, 0.1, 0.012]} />
            <Mat color={GOOD_COLOR[demand]} />
          </mesh>
          <mesh position={[0, 0.24, 0]} rotation={[0, -0.6, 0]}>
            <boxGeometry args={[0.16, 0.12, 0.008]} />
            <Mat color={GILT} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------

/** Everything the Wayfarers variants add to the board, from the rendered view. */
export function WayfarersBoard({ view, shadows, idle, centre, land }: { view: RedactedState; shadows: boolean; idle: boolean; centre: World; land: ReadonlySet<HexId> }) {
  const variants = view.scenario?.variants;
  const w = view.wayfarers;
  const lakes = useMemo(() => Object.keys(view.board.hexes).filter((h) => view.board.hexes[h]?.terrain === "lake"), [view.board.hexes]);
  const roads = useMemo(() => new Set(view.players.flatMap((p) => p.roads)), [view.players]);
  const colorOf = useMemo(() => new Map(view.players.map((p) => [p.id, p.color] as const)), [view.players]);

  const guards: { key: string; hex: HexId; color: PlayerColor; index: number }[] = [];
  if (variants?.raiders && w?.raiders) {
    const perHex = new Map<HexId, number>();
    for (const [id, hexes] of Object.entries(w.raiders.guards)) {
      const color = colorOf.get(id) ?? "white";
      hexes.forEach((hex, i) => {
        const index = perHex.get(hex) ?? 0;
        perHex.set(hex, index + 1);
        guards.push({ key: `${id}:${hex}:${i}`, hex, color, index });
      });
    }
  }

  return (
    <group name="wayfarers">
      {lakes.map((h) => (
        <LakeWater key={h} hex={h} idle={idle} />
      ))}
      {variants?.fishing && view.board.fishingGrounds.map((g) => <FishingGroundMarker key={g.edge} edge={g.edge} token={g.token} centre={centre} land={land} />)}
      {variants?.rivers && view.board.rivers.map((e) => <RiverRibbon key={e} edge={e} bridged={roads.has(e)} shadows={shadows} />)}
      {variants?.caravans && view.board.oases.map((h) => <OasisMarker key={h} hex={h} idle={idle} />)}
      {variants?.caravans && w?.caravans?.tracks.map((t, i) => <CaravanTrack key={i} edges={t.edges} index={i} />)}
      {variants?.raiders && w?.raiders && (
        <group name="raiders">
          {w.raiders.raided.map((h) => (
            <RaidedOverlay key={h} hex={h} />
          ))}
          {guards.map((g) => {
            const c = hexWorld(g.hex);
            const o = guardOffset(g.index);
            return (
              <group key={g.key} position={[c.x + o.dx, SLAB_HEIGHT, c.z + o.dz]}>
                <GuardFigure color={g.color} shadows={shadows} />
              </group>
            );
          })}
          {Object.entries(w.raiders.castles).map(([id, v]) => (v ? <CastleFigure key={id} vertex={v} color={colorOf.get(id) ?? "white"} shadows={shadows} /> : null))}
        </group>
      )}
      {variants?.wagons && w?.wagons && (
        <group name="wagons">
          {Object.entries(w.wagons.wagons).map(([id, wagon]) => (
            <AnimatedWagon key={id} at={wagon.at} color={colorOf.get(id) ?? "white"} cargo={wagon.cargo} shadows={shadows} />
          ))}
          {view.players.flatMap((p) => p.cities.map((v) => <CityGoods key={v} vertex={v} stock={w.wagons?.stock[v] ?? []} demand={w.wagons?.demand[v]} />))}
        </group>
      )}
    </group>
  );
}

/** The sr-only lines for the variant pieces (guards, castles, wagons) and board features (lake, fishing grounds). */
export function wayfarersPieceList(view: RedactedState): { key: string; piece: string; color?: PlayerColor; text: string }[] {
  const out: { key: string; piece: string; color?: PlayerColor; text: string }[] = [];
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  const colorOf = (id: string) => view.players.find((p) => p.id === id)?.color ?? "white";
  const variants = view.scenario?.variants;
  const w = view.wayfarers;
  for (const h of Object.keys(view.board.hexes)) if (view.board.hexes[h]?.terrain === "lake") out.push({ key: `lake:${h}`, piece: "lake", text: `Lake at ${h}` });
  if (variants?.fishing) for (const g of view.board.fishingGrounds) out.push({ key: `fishing:${g.edge}`, piece: "fishing-ground", text: `Fishing ground ${g.token} on ${g.edge}` });
  if (variants?.raiders && w?.raiders) {
    for (const [id, v] of Object.entries(w.raiders.castles)) if (v) out.push({ key: `castle:${id}`, piece: "castle", color: colorOf(id), text: `${nameOf(id)} castle at ${v}` });
    for (const [id, hexes] of Object.entries(w.raiders.guards)) hexes.forEach((h, i) => out.push({ key: `guard:${id}:${i}`, piece: "guard", color: colorOf(id), text: `${nameOf(id)} guard on ${h}` }));
    for (const h of w.raiders.raided) out.push({ key: `raided:${h}`, piece: "raided", text: `Raided hex ${h}` });
  }
  if (variants?.wagons && w?.wagons) {
    for (const [id, wagon] of Object.entries(w.wagons.wagons)) out.push({ key: `wagon:${id}`, piece: "wagon", color: colorOf(id), text: `${nameOf(id)} wagon at ${wagon.at}${wagon.cargo.length ? ` carrying ${wagon.cargo.join(", ")}` : ""}` });
  }
  if (variants?.caravans && w?.caravans) w.caravans.tracks.forEach((t, i) => t.edges.forEach((e) => out.push({ key: `caravan:${i}:${e}`, piece: "caravan", text: `Caravan ${i + 1} on ${e}` })));
  return out;
}
