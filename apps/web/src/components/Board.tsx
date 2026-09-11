"use client";

import { useMemo } from "react";
import { GEOMETRY, type Action, type HexId, type PlayerColor } from "@katan/engine";
import { createLayout, hexPoints, waterPoints } from "@/board/layout";
import type { RedactedState } from "@/driver/types";
import { INK, PLAYER_FILL, SAND, WATER, WATER_DEEP } from "@/game/theme";
import { CityGlyph, HarborMarker, NumberToken, Robber, SettlementGlyph, TerrainDefs } from "./boardParts";

export type TargetMode = "road" | "settlement" | "city" | null;

export interface BoardProps {
  view: RedactedState;
  /** Legal actions for the acting player. */
  legal: Action[];
  /** Which build the acting player is targeting in the action phase. */
  mode: TargetMode;
  meColor: PlayerColor;
  onAction: (action: Action) => void;
}

const R = 50;
const layout = createLayout(R);

/** The board (docs/phase3.md §4). One <svg>; only legal targets are interactive. */
export function Board({ view, legal, mode, meColor, onAction }: BoardProps) {
  const accent = PLAYER_FILL[meColor];
  const phase = view.phase.kind;

  const targets = useMemo(() => {
    const vertices = new Map<string, Action>();
    const edges = new Map<string, Action>();
    const hexes = new Map<string, Action>();
    const wantSettlement = phase === "setup" || mode === "settlement";
    const wantCity = mode === "city";
    const wantRoad = phase === "setup" || phase === "roadBuilding" || mode === "road";
    for (const a of legal) {
      if (a.type === "BUILD_SETTLEMENT" && wantSettlement) vertices.set(a.vertex, a);
      else if (a.type === "BUILD_CITY" && wantCity) vertices.set(a.vertex, a);
      else if (a.type === "BUILD_ROAD" && wantRoad) edges.set(a.edge, a);
      else if (a.type === "MOVE_ROBBER") hexes.set(a.hex, a);
    }
    return { vertices, edges, hexes };
  }, [legal, mode, phase]);

  const me = view.players.find((p) => p.id === view.viewer);
  const myVertices = new Set([...(me?.settlements ?? []), ...(me?.cities ?? [])]);

  return (
    <svg
      viewBox={layout.viewBox}
      className="h-auto w-full max-h-full select-none"
      role="img"
      aria-label="Game board"
      data-testid="board"
    >
      <TerrainDefs />

      {/* 1. Water and harbors */}
      <polygon points={waterPoints(layout)} fill={WATER} stroke={WATER_DEEP} strokeWidth={6} strokeLinejoin="round" />
      {view.board.ports.map((port) => {
        const m = layout.edgeMid(port.edge);
        const o = layout.outward(port.edge);
        const ends = layout.edge(port.edge);
        const owned = port.vertices.some((v) => myVertices.has(v));
        return (
          <HarborMarker
            key={port.edge}
            x={m.x + o.x * R * 0.72}
            y={m.y + o.y * R * 0.72}
            ends={ends}
            kind={port.kind}
            R={R}
            owned={owned}
          />
        );
      })}

      {/* 2. Terrain */}
      {GEOMETRY.hexes.map((hex) => (
        <polygon
          key={hex}
          points={hexPoints(layout, hex, 1.5)}
          fill={`url(#pat-${view.board.hexes[hex]!.terrain})`}
          stroke={SAND}
          strokeWidth={3}
          strokeLinejoin="round"
        />
      ))}

      {/* 3. Tokens and 4. robber */}
      {GEOMETRY.hexes.map((hex) => {
        const tile = view.board.hexes[hex]!;
        const c = layout.hex(hex);
        return tile.token === null ? null : <NumberToken key={hex} x={c.x} y={c.y} n={tile.token} R={R} />;
      })}
      {(() => {
        const c = layout.hex(view.robberHex);
        return <Robber x={c.x + R * 0.42} y={c.y + R * 0.2} R={R} />;
      })()}

      {/* 5. Roads */}
      <g strokeLinecap="round">
        {view.players.flatMap((p) =>
          p.roads.map((edge) => {
            const [a, b] = layout.edge(edge);
            return (
              <g key={edge}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={R * 0.22} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[p.color]} strokeWidth={R * 0.14} />
              </g>
            );
          }),
        )}
      </g>

      {/* 6. Buildings */}
      {view.players.flatMap((p) => [
        ...p.settlements.map((v) => {
          const pt = layout.vertex(v);
          return <SettlementGlyph key={v} x={pt.x} y={pt.y} color={p.color} R={R} />;
        }),
        ...p.cities.map((v) => {
          const pt = layout.vertex(v);
          return <CityGlyph key={v} x={pt.x} y={pt.y} color={p.color} R={R} />;
        }),
      ])}

      {/* 7. Interaction layer: only legal targets exist here */}
      <g data-testid="targets">
        {[...targets.hexes.entries()].map(([hex, action]) => (
          <g
            key={hex}
            className="target-hex"
            role="button"
            tabIndex={0}
            aria-label={`Move robber to hex ${hex}`}
            data-testid={`target-hex-${hex}`}
            onClick={() => onAction(action)}
            onKeyDown={(e) => e.key === "Enter" && onAction(action)}
          >
            <polygon points={hexPoints(layout, hex, 1.5)} fill={accent} fillOpacity={0.14} />
            <polygon
              className="target-hex-outline"
              points={hexPoints(layout, hex, 5)}
              fill="none"
              stroke={accent}
              strokeWidth={5}
              strokeLinejoin="round"
              opacity={0.9}
              style={{ filter: "drop-shadow(0 0 5px rgba(255,255,255,.9))" }}
            />
          </g>
        ))}
        {[...targets.edges.entries()].map(([edge, action]) => {
          const [a, b] = layout.edge(edge);
          return (
            <g
              key={edge}
              className="target-edge"
              role="button"
              tabIndex={0}
              aria-label={`Build road on ${edge}`}
              data-testid={`target-edge-${edge}`}
              onClick={() => onAction(action)}
              onKeyDown={(e) => e.key === "Enter" && onAction(action)}
            >
              <polygon points={edgeHitPolygon(a, b, R * 0.2)} fill="transparent" />
              <line
                className="target-edge-line"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={accent}
                strokeWidth={R * 0.14}
                strokeDasharray={`${R * 0.18} ${R * 0.14}`}
                strokeLinecap="round"
                opacity={0.9}
              />
            </g>
          );
        })}
        {[...targets.vertices.entries()].map(([vertex, action]) => {
          const p = layout.vertex(vertex);
          const label = action.type === "BUILD_CITY" ? `Upgrade to city at ${vertex}` : `Build settlement at ${vertex}`;
          return (
            <circle
              key={vertex}
              className="target-vertex"
              role="button"
              tabIndex={0}
              aria-label={label}
              data-testid={`target-vertex-${vertex}`}
              cx={p.x}
              cy={p.y}
              r={R * 0.24}
              fill={accent}
              fillOpacity={0.35}
              stroke={accent}
              strokeWidth={3}
              onClick={() => onAction(action)}
              onKeyDown={(e) => e.key === "Enter" && onAction(action)}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** A rectangle around an edge, so the hit target has a real bounding box even when the edge is vertical. */
function edgeHitPolygon(a: { x: number; y: number }, b: { x: number; y: number }, half: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  return [
    [a.x + nx, a.y + ny],
    [b.x + nx, b.y + ny],
    [b.x - nx, b.y - ny],
    [a.x - nx, a.y - ny],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

/** Screen-percentage position of a hex centre inside the board's box (for HTML popovers). */
export function hexPercent(hex: HexId): { left: string; top: string } {
  const [x0, y0, w, h] = layout.viewBox.split(" ").map(Number) as [number, number, number, number];
  const c = layout.hex(hex);
  return { left: `${((c.x - x0) / w) * 100}%`, top: `${((c.y - y0) / h) * 100}%` };
}

export { layout as boardLayout };
export type { PlayerColor };
