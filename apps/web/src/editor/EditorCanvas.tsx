"use client";

/**
 * The editor's canvas (docs/phase8.md §4.1, docs/phase7-5.md §8): the 3D
 * scene in editor mode. Top-down by default with a toggle to the diorama
 * view; empty grid cells are ghost slabs; painting updates tiles in place.
 * Accessible overlay buttons mirror every cell and, per tool, every coastal
 * edge (harbours, fishing grounds) or land edge (rivers). Wayfarers markers
 * (docs/phase10.md §8) are drawn in place: river ribbons, fishing buoys with
 * their token, oasis ponds and a ripple on lakes.
 */

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { edgeVerticesOf, hexId, type BoardDefinition, type EdgeId, type HexCoord, type Port, type Terrain } from "@katan/engine";
import { CameraRig } from "@/board3d/Camera";
import { Projector, projectWorld, type CameraSnapshot } from "@/board3d/Effects3d";
import { INTERACTION_LAYER } from "@/board3d/Interaction";
import { Harbor } from "@/board3d/Harbor";
import { SLAB_HEIGHT, boardBounds, edgeWorld, hexWorld, outwardWorld, type World } from "@/board3d/layout3d";
import { Props, type PropHex } from "@/board3d/Props";
import { RECESS_DEPTH } from "@/board3d/slab";
import { Tiles, type TileInfo } from "@/board3d/Tiles";
import { tokenTexture, woodTexture } from "@/board3d/textures";
import { QUALITY_PRESETS } from "@/board3d/quality";
import { GILT, WATER, WAX } from "@/game/theme";
import { fishingGroundsOf, gridCells, harborEdges, harborKindOf, isOasis, landEdges, riverEdgesOf, type Tool } from "./model";

const RIVER_LIGHT = "#8cc3d4";
const BUOY = "#b8321f";
const PALM_TRUNK = "#7a5a34";
const PALM_LEAF = "#3f7a3c";

/** A river segment: a flat blue ribbon along the edge with a paler thread down the middle. */
function RiverRibbon({ edge }: { edge: EdgeId }) {
  const { mid, angle } = edgeWorld(edge);
  return (
    <group position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]} name={`river:${edge}`}>
      <mesh position={[0, 0.012, 0]}>
        <boxGeometry args={[0.98, 0.02, 0.14]} />
        <meshStandardMaterial color={WATER} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.024, 0]}>
        <boxGeometry args={[0.9, 0.006, 0.05]} />
        <meshBasicMaterial color={RIVER_LIGHT} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

/** A fishing ground: a buoy and a net ring just off the coast edge, with the ground's number token. */
function FishingMarker({ edge, token, centre, land }: { edge: EdgeId; token: number; centre: World; land: ReadonlySet<string> }) {
  const { mid } = edgeWorld(edge);
  const out = outwardWorld(edge, centre, land);
  const texture = useMemo(() => tokenTexture(token), [token]);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: "#b8905f", roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, transparent: true });
    return [side, top, side];
  }, [texture]);
  const x = mid.x + out.x * 0.42;
  const z = mid.z + out.z * 0.42;
  const nx = mid.x + out.x * 0.2 - out.z * 0.3;
  const nz = mid.z + out.z * 0.2 + out.x * 0.3;
  return (
    <group name={`fishing:${edge}`}>
      <mesh position={[nx, 0.02, nz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.11, 0.17, 12]} />
        <meshBasicMaterial color={PALM_TRUNK} transparent opacity={0.85} />
      </mesh>
      <mesh position={[nx, 0.08, nz]}>
        <cylinderGeometry args={[0.05, 0.06, 0.16, 8]} />
        <meshStandardMaterial color={BUOY} roughness={0.6} />
      </mesh>
      <mesh position={[nx, 0.1, nz]}>
        <cylinderGeometry args={[0.052, 0.052, 0.03, 8]} />
        <meshStandardMaterial color="#f2ead6" roughness={0.6} />
      </mesh>
      <mesh position={[x, 0.03, z]} material={materials}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 24]} />
      </mesh>
    </group>
  );
}

/** An oasis: a small pond off the hex centre with a palm beside it. */
function OasisMarker({ id }: { id: string }) {
  const c = hexWorld(id);
  const y = SLAB_HEIGHT + 0.01;
  return (
    <group position={[c.x + 0.34, y, c.z + 0.3]} name={`oasis:${id}`}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.2, 20]} />
        <meshStandardMaterial color={WATER} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.25, 20]} />
        <meshBasicMaterial color="#d9c9a0" transparent opacity={0.9} />
      </mesh>
      <group position={[-0.22, 0, -0.1]} rotation={[0, 0, -0.25]}>
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.02, 0.03, 0.32, 6]} />
          <meshStandardMaterial color={PALM_TRUNK} />
        </mesh>
        {[0, 1, 2, 3, 4].map((k) => (
          <mesh key={k} position={[Math.cos((k * Math.PI * 2) / 5) * 0.09, 0.32, Math.sin((k * Math.PI * 2) / 5) * 0.09]} rotation={[0.35 * Math.sin((k * Math.PI * 2) / 5), -(k * Math.PI * 2) / 5, -0.35 * Math.cos((k * Math.PI * 2) / 5)]}>
            <boxGeometry args={[0.2, 0.01, 0.06]} />
            <meshStandardMaterial color={PALM_LEAF} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Lakes are water on land: the slab's recess holds the water (docs/props.md §3); two ripple rings sit on it. */
function LakeRipple({ id }: { id: string }) {
  const c = hexWorld(id);
  return (
    <group position={[c.x, SLAB_HEIGHT - RECESS_DEPTH + 0.006, c.z]} name={`lake:${id}`}>
      {[0.3, 0.5].map((r) => (
        <mesh key={r} position={[0.05, 0.004, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + 0.025, 28]} />
          <meshBasicMaterial color={RIVER_LIGHT} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

export interface CanvasProps {
  def: BoardDefinition;
  tool: Tool;
  symmetry: string;
  selected: string | null;
  topDown: boolean;
  quality: "high" | "medium" | "low";
  gridRadius: number;
  /** Pointer down on a cell (shift held → rectangle start). */
  onCellDown: (at: HexCoord, shift: boolean, button: number) => void;
  /** Pointer entered a cell while a paint drag is active. */
  onCellDrag: (at: HexCoord) => void;
  onCellUp: (at: HexCoord | null) => void;
  onEdge: (edge: EdgeId) => void;
  onSelect: (id: string | null) => void;
}

function Table({ bounds, onTap }: { bounds: { cx: number; cz: number; radius: number }; onTap: () => void }) {
  const texture = useMemo(() => woodTexture(), []);
  return (
    <mesh position={[bounds.cx, -0.02, bounds.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow layers={INTERACTION_LAYER} onClick={onTap}>
      <planeGeometry args={[bounds.radius * 8, bounds.radius * 8]} />
      <meshStandardMaterial map={texture} roughness={0.9} color="#a58a70" />
    </mesh>
  );
}

export function EditorCanvas(props: CanvasProps) {
  const { def, tool, selected, topDown, quality, gridRadius, onCellDown, onCellDrag, onCellUp, onEdge, onSelect } = props;
  const preset = QUALITY_PRESETS[quality];
  const snapshot = useRef<CameraSnapshot | null>(null);
  const [camVersion, setCamVersion] = useState(0);
  const bumpCamera = useCallback(() => setCamVersion((v) => v + 1), []);
  const [resetToken, setResetToken] = useState(0);
  const dragging = useRef(false);
  // While a paint drag is running the camera must not orbit or pan with it, so the brush lands where the pointer is.
  const [painting, setPainting] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const cells = useMemo(() => gridCells(gridRadius), [gridRadius]);
  const byId = useMemo(() => new Map(def.hexes.map((h) => [hexId(h.at), h])), [def]);
  const tiles: TileInfo[] = useMemo(
    () =>
      def.hexes.map((h) => ({
        id: hexId(h.at),
        kind: h.kind,
        terrain: h.kind === "land" ? ((h.terrain as Terrain | undefined) ?? null) : null,
        token: h.kind === "land" && h.token !== undefined ? h.token : null,
      })),
    [def],
  );
  const propHexes = useMemo<PropHex[]>(() => def.hexes.filter((h) => (h.kind === "land" && h.terrain) || h.kind === "sea").map((h) => ({ id: hexId(h.at), terrain: h.kind === "sea" ? "sea" : (h.terrain as Terrain) })), [def]);
  const landSet = useMemo(() => new Set(def.hexes.filter((h) => h.kind === "land").map((h) => hexId(h.at))), [def]);
  const bounds = useMemo(() => boardBounds(cells.map(hexId)), [cells]);
  const centre = useMemo<World>(() => ({ x: bounds.cx, z: bounds.cz }), [bounds]);
  // Edge targets per tool: coastal edges for harbours and fishing grounds, every land edge for rivers.
  const coast = useMemo(() => (tool === "harbor" || tool === "fishing" ? harborEdges(def) : tool === "river" ? landEdges(def) : []), [def, tool]);
  const rivers = useMemo(() => riverEdgesOf(def), [def]);
  const grounds = useMemo(() => fishingGroundsOf(def), [def]);
  const oases = useMemo(() => def.hexes.filter((h) => h.kind === "land" && isOasis(h)).map((h) => hexId(h.at)), [def]);
  const lakes = useMemo(() => def.hexes.filter((h) => h.kind === "land" && h.terrain === "lake").map((h) => hexId(h.at)), [def]);
  const riverSet = useMemo(() => new Set(rivers), [rivers]);
  const groundByEdge = useMemo(() => new Map(grounds.map((g) => [g.edge, g.token])), [grounds]);
  const edgeLabel = tool === "river" ? "River edge" : tool === "fishing" ? "Fishing edge" : "Harbour edge";
  const ports: Port[] = useMemo(() => def.harbors.map((h) => ({ edge: h.edge, kind: harborKindOf(h) ?? "any", vertices: edgeVerticesOf(h.edge) })), [def]);
  const unassigned = useMemo(() => def.hexes.filter((h) => h.kind === "land" && !h.terrain).map((h) => hexId(h.at)), [def]);

  // Synchronous overlay projection (same technique as Board3D).
  const projected = useMemo(() => {
    const snap = snapshot.current;
    void camVersion;
    if (!snap) return { cells: [] as { at: HexCoord; x: number; y: number; visible: boolean }[], edges: [] as { edge: EdgeId; x: number; y: number; visible: boolean }[] };
    const v = new THREE.Vector3();
    return {
      cells: cells.map((at) => ({ at, ...projectWorld(snap, hexWorld(hexId(at)), SLAB_HEIGHT + 0.02, v) })),
      edges: coast.map((edge) => ({ edge, ...projectWorld(snap, edgeWorld(edge).mid, SLAB_HEIGHT + 0.02, v) })),
    };
  }, [cells, coast, camVersion]);

  useEffect(() => {
    const up = () => {
      setPainting(false);
      if (dragging.current) {
        dragging.current = false;
        onCellUp(null);
      }
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [onCellUp]);

  const layers = useMemo(() => {
    const l = new THREE.Layers();
    l.set(INTERACTION_LAYER);
    return l;
  }, []);
  const light = bounds.radius * 1.6;

  return (
    <div className="relative h-full w-full" data-testid="editor-canvas" data-view={topDown ? "top" : "diorama"}>
      <Canvas shadows={preset.shadows ? { type: THREE.PCFSoftShadowMap } : false} dpr={[1, preset.dpr]} raycaster={{ layers }} gl={{ antialias: quality !== "low" }} style={{ touchAction: "none", cursor: tool === "frame" || tool === "terrain" ? "crosshair" : "pointer" }} onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={["#2a1c13"]} />
        <CameraRig bounds={bounds} resetToken={resetToken} focus={null} hero={null} topDown={topDown} enabled={!painting} />
        <hemisphereLight args={["#cfe3f0", "#4a3a2a", 0.6]} />
        <directionalLight position={[bounds.cx - light * 0.9, light * 1.1, bounds.cz - light * 0.6]} intensity={2} color="#fff1d6" castShadow={preset.shadows} shadow-mapSize={[2048, 2048]} shadow-camera-left={-light} shadow-camera-right={light} shadow-camera-top={light} shadow-camera-bottom={-light} shadow-camera-far={light * 4} />
        <Table bounds={bounds} onTap={() => onSelect(null)} />
        <Tiles tiles={tiles} robberHex="" rolled={null} rollKey={null} blockedHex={null} shadows={preset.shadows} />
        <Props hexes={propHexes} density={preset.propDensity * 0.6} idle={false} shadows={preset.shadows} />
        {ports.map((p) => (
          <Harbor key={p.edge} port={p} centre={centre} owned={false} shadows={preset.shadows} land={landSet} />
        ))}
        {/* Wayfarers markers (docs/phase10.md §8). */}
        {lakes.map((id) => (
          <LakeRipple key={id} id={id} />
        ))}
        {rivers.map((edge) => (
          <RiverRibbon key={edge} edge={edge} />
        ))}
        {grounds.map((g) => (
          <FishingMarker key={g.edge} edge={g.edge} token={g.token} centre={centre} land={landSet} />
        ))}
        {oases.map((id) => (
          <OasisMarker key={id} id={id} />
        ))}
        {/* Unassigned land: a dashed question ring on top. */}
        {unassigned.map((id) => {
          const c = hexWorld(id);
          return (
            <mesh key={id} position={[c.x, SLAB_HEIGHT + 0.01, c.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.28, 0.36, 24]} />
              <meshBasicMaterial color="#efe8d8" transparent opacity={0.6} />
            </mesh>
          );
        })}
        {/* Cells: ghost slabs where empty, invisible pick targets where occupied. */}
        <group name="cells">
          {cells.map((at) => {
            const id = hexId(at);
            const occupied = byId.has(id);
            const c = hexWorld(id);
            const isSel = selected === id;
            return (
              <group key={id} position={[c.x, 0, c.z]}>
                <mesh
                  layers={INTERACTION_LAYER}
                  position={[0, occupied ? SLAB_HEIGHT + 0.02 : 0.01, 0]}
                  rotation={[-Math.PI / 2, Math.PI / 6, 0]}
                  userData={{ cell: id }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dragging.current = true;
                    setPainting(true);
                    onCellDown(at, e.nativeEvent.shiftKey, e.nativeEvent.button);
                  }}
                  onPointerOver={(e) => {
                    setHover(id);
                    if (dragging.current) {
                      e.stopPropagation();
                      onCellDrag(at);
                    }
                  }}
                  onPointerOut={() => setHover((h) => (h === id ? null : h))}
                  onPointerUp={(e) => {
                    setPainting(false);
                    if (dragging.current) {
                      e.stopPropagation();
                      dragging.current = false;
                      onCellUp(at);
                    }
                  }}
                  onContextMenu={(e) => e.nativeEvent.preventDefault()}
                >
                  <circleGeometry args={[0.92, 6]} />
                  <meshBasicMaterial color={occupied ? "#000000" : "#efe8d8"} transparent opacity={occupied ? 0 : 0.08} depthWrite={false} />
                </mesh>
                {!occupied && (
                  <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, Math.PI / 6, 0]}>
                    <ringGeometry args={[0.84, 0.9, 6]} />
                    <meshBasicMaterial color="#efe8d8" transparent opacity={0.18} />
                  </mesh>
                )}
                {isSel && (
                  <mesh position={[0, SLAB_HEIGHT + 0.03, 0]} rotation={[-Math.PI / 2, Math.PI / 6, 0]}>
                    <ringGeometry args={[0.86, 0.98, 6]} />
                    <meshBasicMaterial color={GILT} transparent opacity={0.95} />
                  </mesh>
                )}
                {hover === id && !isSel && (
                  <mesh position={[0, (occupied ? SLAB_HEIGHT : 0) + 0.025, 0]} rotation={[-Math.PI / 2, Math.PI / 6, 0]}>
                    <ringGeometry args={[0.8, 0.92, 6]} />
                    <meshBasicMaterial color="#efe8d8" transparent opacity={0.55} depthWrite={false} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
        {/* Edge targets: coastal edges for the harbour and fishing tools, land edges for the river tool. */}
        {coast.length > 0 &&
          coast.map((edge) => {
            const { mid, angle } = edgeWorld(edge);
            const has = tool === "river" ? riverSet.has(edge) : tool === "fishing" ? groundByEdge.has(edge) : def.harbors.some((h) => h.edge === edge);
            return (
              <group key={edge} position={[mid.x, SLAB_HEIGHT, mid.z]} rotation={[0, -angle, 0]}>
                <mesh
                  layers={INTERACTION_LAYER}
                  position={[0, 0.06, 0]}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onEdge(edge);
                  }}
                >
                  <boxGeometry args={[0.8, 0.16, 0.3]} />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
                <mesh position={[0, 0.03, 0]}>
                  <boxGeometry args={[0.78, 0.05, 0.14]} />
                  <meshStandardMaterial color={has ? GILT : tool === "river" ? WATER : WAX} emissive={has ? GILT : tool === "river" ? WATER : WAX} emissiveIntensity={0.4} transparent opacity={0.7} depthWrite={false} />
                </mesh>
              </group>
            );
          })}
        <Projector snapshot={snapshot} onChange={bumpCamera} />
      </Canvas>

      {/* Accessible overlay: one button per cell, and one per edge the current tool can act on. */}
      <div className="pointer-events-none absolute inset-0" data-testid="editor-targets">
        {projected.cells
          .filter((p) => p.visible)
          .map((p) => {
            const id = hexId(p.at);
            const h = byId.get(id);
            return (
              <button
                key={id}
                type="button"
                className="pointer-events-auto absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt"
                style={{ left: p.x, top: p.y }}
                aria-label={`Cell ${id}: ${h ? h.kind + (h.terrain ? ` ${h.terrain}` : "") + (h.token !== undefined ? ` ${h.token}` : "") + (isOasis(h) ? " oasis" : "") : "empty"}`}
                data-testid={`cell-${id}`}
                data-kind={h?.kind ?? "empty"}
                data-terrain={h?.terrain ?? ""}
                data-token={h?.token ?? ""}
                data-oasis={isOasis(h) ? "true" : ""}
                onClick={(e) => {
                  e.stopPropagation();
                  onCellDown(p.at, e.shiftKey, 0);
                  onCellUp(p.at);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onCellDown(p.at, false, 2);
                  onCellUp(p.at);
                }}
              />
            );
          })}
        {projected.edges
          .filter((p) => p.visible)
          .map((p) => (
            <button
              key={p.edge}
              type="button"
              className="pointer-events-auto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100"
              style={{ left: p.x, top: p.y }}
              aria-label={`${edgeLabel} ${p.edge}`}
              data-testid={`edge-${p.edge}`}
              data-harbor={harborKindOf(def.harbors.find((h) => h.edge === p.edge)) ?? ""}
              data-river={riverSet.has(p.edge) ? "true" : ""}
              data-fishing={groundByEdge.get(p.edge) ?? ""}
              onClick={(e) => {
                e.stopPropagation();
                onEdge(p.edge);
              }}
            />
          ))}
      </div>
      <button type="button" className="parchment absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-xs" onClick={() => setResetToken((t) => t + 1)} data-testid="editor-reset-view">
        Reset view
      </button>
    </div>
  );
}
