"use client";

import { useEffect, useMemo, useRef } from "react";
import { GEOMETRY, type Action, type HexId, type PlayerColor } from "@katan/engine";
import { createLayout, hexPoints, waterPoints } from "@/board/layout";
import type { RedactedState } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { PLAYER_FILL, SAND, WATER, WATER_DEEP } from "@/game/theme";
import { useAnchors } from "./anim/anchors";
import { CityGlyph, HarborMarker, NumberToken, RoadGlyph, Robber, SettlementGlyph, TerrainDefs } from "./boardParts";

export type TargetMode = "road" | "settlement" | "city" | null;

export interface BoardProps {
  view: RedactedState;
  /** Legal actions for the acting player. */
  legal: Action[];
  /** Which build the acting player is targeting in the action phase. */
  mode: TargetMode;
  meColor: PlayerColor;
  onAction: (action: Action) => void;
  /** The animation step being played, for piece/robber/token effects (docs/phase7.md §2.2). */
  step?: Step | null;
  /** Clicking the board while animations drain fast-forwards them. */
  onSkip?: (() => void) | undefined;
}

const R = 50;
const layout = createLayout(R);

/** The 2D board (docs/phase3.md §4). One <svg>; only legal targets are interactive. */
export function Board({ view, legal, mode, meColor, onAction, step = null, onSkip }: BoardProps) {
  const accent = PLAYER_FILL[meColor];
  const phase = view.phase.kind;
  const svgRef = useRef<SVGSVGElement>(null);
  const anchors = useAnchors();

  // Register the projector so flying cards can start from a hex (docs/phase7.md §2.2).
  useEffect(() => {
    anchors.setProjector((key) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const [kind, id] = key.split(":", 2);
      if (!id) return null;
      const rect = svg.getBoundingClientRect();
      const [x0, y0, w, h] = layout.viewBox.split(" ").map(Number) as [number, number, number, number];
      const p = kind === "hex" ? layout.hex(id) : kind === "vertex" ? layout.vertex(id) : kind === "edge" ? layout.edgeMid(id) : null;
      if (!p) return null;
      return { x: rect.left + ((p.x - x0) / w) * rect.width, y: rect.top + ((p.y - y0) / h) * rect.height };
    });
    return () => anchors.setProjector(null);
  }, [anchors]);

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

  // Animation cues from the current step.
  const event = step?.kind === "event" ? step.event : null;
  const justBuilt = event?.kind === "built" ? event : null;
  const rolled = event?.kind === "diceRolled" ? event.dice[0] + event.dice[1] : null;
  const blockedHex = event?.kind === "productionBlocked" ? event.hex : null;
  const hexIds = Object.keys(view.board.hexes) as HexId[];
  const robber = layout.hex(view.robberHex);

  return (
    <svg
      ref={svgRef}
      viewBox={layout.viewBox}
      className="h-auto w-full max-h-full select-none"
      role="img"
      aria-label="Game board"
      data-testid="board"
      onClick={onSkip}
    >
      <TerrainDefs />

      {/* 1. Water and harbors */}
      <polygon points={waterPoints(layout)} fill={WATER} stroke={WATER_DEEP} strokeWidth={6} strokeLinejoin="round" />
      {view.board.ports.map((port) => {
        const m = layout.edgeMid(port.edge);
        const o = layout.outward(port.edge);
        const ends = layout.edge(port.edge);
        const owned = port.vertices.some((v) => myVertices.has(v));
        return <HarborMarker key={port.edge} x={m.x + o.x * R * 0.78} y={m.y + o.y * R * 0.78} ends={ends} kind={port.kind} R={R} owned={owned} />;
      })}

      {/* 2. Terrain */}
      {hexIds.map((hex) => (
        <g key={hex} className={blockedHex === hex ? "hex-shake" : undefined}>
          <polygon points={hexPoints(layout, hex, 1.5)} fill={`url(#pat-${view.board.hexes[hex]!.terrain})`} stroke={SAND} strokeWidth={3} strokeLinejoin="round" />
        </g>
      ))}

      {/* 3. Tokens and 4. robber */}
      {hexIds.map((hex) => {
        const tile = view.board.hexes[hex]!;
        const c = layout.hex(hex);
        if (tile.token === null) return null;
        const cls = blockedHex === hex ? "token-dim" : rolled === tile.token && hex !== view.robberHex ? "token-pulse" : "";
        return <NumberToken key={`${hex}-${rolled ?? ""}`} x={c.x} y={c.y} n={tile.token} R={R} className={cls} />;
      })}
      <Robber x={robber.x + R * 0.42} y={robber.y + R * 0.2} R={R} className="robber-move" />

      {/* 5. Roads */}
      <g>
        {view.players.flatMap((p) =>
          p.roads.map((edge) => {
            const [a, b] = layout.edge(edge);
            const fresh = justBuilt?.piece === "road" && justBuilt.at === edge;
            return <RoadGlyph key={edge} a={a} b={b} color={p.color} R={R} className={fresh ? "road-draw" : ""} />;
          }),
        )}
      </g>

      {/* 6. Buildings */}
      {view.players.flatMap((p) => [
        ...p.settlements.map((v) => {
          const pt = layout.vertex(v);
          const fresh = justBuilt?.piece === "settlement" && justBuilt.at === v;
          return <SettlementGlyph key={v} x={pt.x} y={pt.y} color={p.color} R={R} className={fresh ? "piece-pop" : ""} />;
        }),
        ...p.cities.map((v) => {
          const pt = layout.vertex(v);
          const fresh = justBuilt?.piece === "city" && justBuilt.at === v;
          return <CityGlyph key={v} x={pt.x} y={pt.y} color={p.color} R={R} className={fresh ? "piece-rise" : ""} />;
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
            onClick={(e) => {
              e.stopPropagation();
              onAction(action);
            }}
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
              onClick={(e) => {
                e.stopPropagation();
                onAction(action);
              }}
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
              onClick={(e) => {
                e.stopPropagation();
                onAction(action);
              }}
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

export { layout as boardLayout, GEOMETRY as boardGeometry };
export type { PlayerColor };
