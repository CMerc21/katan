"use client";

/**
 * The editor's canvas (docs/phase8.md §4.1, docs/phase7-5.md §8): the 3D
 * scene in editor mode. Top-down by default with a toggle to the diorama
 * view; empty grid cells are ghost slabs; painting updates tiles in place.
 * Accessible overlay buttons mirror every cell and coastal edge.
 */

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { edgeVerticesOf, hexId, type BoardDefinition, type EdgeId, type HexCoord, type Port, type Terrain } from "@katan/engine";
import { CameraRig } from "@/board3d/Camera";
import { Projector, projectWorld, type CameraSnapshot } from "@/board3d/Effects3d";
import { INTERACTION_LAYER } from "@/board3d/Interaction";
import { Harbor } from "@/board3d/Harbor";
import { SLAB_HEIGHT, boardBounds, edgeWorld, hexWorld, type World } from "@/board3d/layout3d";
import { Props } from "@/board3d/Props";
import { Tiles, type TileInfo } from "@/board3d/Tiles";
import { woodTexture } from "@/board3d/textures";
import { QUALITY_PRESETS } from "@/board3d/quality";
import { GILT, WAX } from "@/game/theme";
import { gridCells, harborEdges, harborKindOf, type Tool } from "./model";

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
  const landHexes = useMemo(() => def.hexes.filter((h) => h.kind === "land" && h.terrain).map((h) => ({ id: hexId(h.at), terrain: h.terrain as Terrain })), [def]);
  const landSet = useMemo(() => new Set(def.hexes.filter((h) => h.kind === "land").map((h) => hexId(h.at))), [def]);
  const bounds = useMemo(() => boardBounds(cells.map(hexId)), [cells]);
  const centre = useMemo<World>(() => ({ x: bounds.cx, z: bounds.cz }), [bounds]);
  const coast = useMemo(() => (tool === "harbor" ? harborEdges(def) : []), [def, tool]);
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
      <Canvas shadows={preset.shadows ? { type: THREE.PCFSoftShadowMap } : false} dpr={[1, preset.dpr]} raycaster={{ layers }} gl={{ antialias: quality !== "low" }} style={{ touchAction: "none" }} onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={["#2a1c13"]} />
        <CameraRig bounds={bounds} resetToken={resetToken} focus={null} hero={null} topDown={topDown} />
        <hemisphereLight args={["#cfe3f0", "#4a3a2a", 0.6]} />
        <directionalLight position={[bounds.cx - light * 0.9, light * 1.1, bounds.cz - light * 0.6]} intensity={2} color="#fff1d6" castShadow={preset.shadows} shadow-mapSize={[2048, 2048]} shadow-camera-left={-light} shadow-camera-right={light} shadow-camera-top={light} shadow-camera-bottom={-light} shadow-camera-far={light * 4} />
        <Table bounds={bounds} onTap={() => onSelect(null)} />
        <Tiles tiles={tiles} robberHex="" rolled={null} rollKey={null} blockedHex={null} shadows={preset.shadows} />
        <Props hexes={landHexes} density={preset.propDensity * 0.6} idle={false} shadows={preset.shadows} />
        {ports.map((p) => (
          <Harbor key={p.edge} port={p} centre={centre} owned={false} shadows={preset.shadows} land={landSet} />
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
                    onCellDown(at, e.nativeEvent.shiftKey, e.nativeEvent.button);
                  }}
                  onPointerOver={(e) => {
                    if (dragging.current) {
                      e.stopPropagation();
                      onCellDrag(at);
                    }
                  }}
                  onPointerUp={(e) => {
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
              </group>
            );
          })}
        </group>
        {/* Coastal edges for the harbour tool. */}
        {tool === "harbor" &&
          coast.map((edge) => {
            const { mid, angle } = edgeWorld(edge);
            const has = def.harbors.some((h) => h.edge === edge);
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
                  <meshStandardMaterial color={has ? GILT : WAX} emissive={has ? GILT : WAX} emissiveIntensity={0.4} transparent opacity={0.7} depthWrite={false} />
                </mesh>
              </group>
            );
          })}
        <Projector snapshot={snapshot} onChange={bumpCamera} />
      </Canvas>

      {/* Accessible overlay: one button per cell (and per coastal edge with the harbour tool). */}
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
                aria-label={`Cell ${id}: ${h ? h.kind + (h.terrain ? ` ${h.terrain}` : "") + (h.token !== undefined ? ` ${h.token}` : "") : "empty"}`}
                data-testid={`cell-${id}`}
                data-kind={h?.kind ?? "empty"}
                data-terrain={h?.terrain ?? ""}
                data-token={h?.token ?? ""}
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
              aria-label={`Harbour edge ${p.edge}`}
              data-testid={`edge-${p.edge}`}
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
