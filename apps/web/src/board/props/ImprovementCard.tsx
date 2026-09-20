"use client";

/**
 * Crown & Castle: each player's city improvement card on the table beside
 * their piece pile (docs/rules.md §16.3, docs/phase12.md §4), the way the
 * improvement chart lies in front of each seat at a real table. One
 * parchment card per player, a band in the player's colour with their name
 * across the top, then the three tracks as columns of five cells filled to
 * the level reached in the track's colour, the third cell ringed in gold
 * (the ability level) and a gold crown over a track whose metropolis the
 * player holds. Every card faces the camera. The viewer's own card is
 * clickable and opens the improvement sheet, so improving a track is one
 * click on the table rather than a trip through the build cost card.
 */

import { Html } from "@react-three/drei";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { MAX_LEVEL, TRACKS, type Track } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { DEFAULT_AZIMUTH } from "@/board3d/Camera";
import { INTERACTION_LAYER } from "@/board3d/Interaction";
import type { Bounds } from "@/board3d/layout3d";
import { improvementCardTexture } from "@/board3d/textures";
import { TRACK_LABEL } from "@/game/labels";
import { PLAYER_FILL } from "@/game/theme";
import { HUD_COPY } from "@/hud/hudCopy";
import { PARCHMENT_DEEP } from "@/game/theme";
import { CARD_LENGTH, CARD_WIDTH, cardLayout, seatFrom } from "./layout";

const CARD_THICKNESS = 0.024;

function Card({ x, z, name, color, tracks, metropolises, mine, onOpen, shadows }: { x: number; z: number; name: string; color: string; tracks: Record<Track, number>; metropolises: Record<Track, boolean>; mine: boolean; onOpen?: (() => void) | undefined; shadows: boolean }) {
  const [hover, setHover] = useState(false);
  const clickable = mine && onOpen !== undefined;
  const texture = useMemo(() => improvementCardTexture(name, color, tracks, metropolises), [name, color, tracks, metropolises]);
  const face = useMemo(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 }), [texture]);
  const summary = TRACKS.map((t) => `${TRACK_LABEL[t]} ${tracks[t]}/${MAX_LEVEL}${metropolises[t] ? " (metropolis)" : ""}`).join(" · ");
  return (
    <group position={[x, hover && clickable ? 0.04 : 0, z]} rotation={[0, DEFAULT_AZIMUTH, 0]} name={`improvement-card${mine ? ":mine" : ""}`}>
      <mesh position={[0, CARD_THICKNESS / 2, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[CARD_WIDTH, CARD_THICKNESS, CARD_LENGTH]} />
        <meshStandardMaterial color={PARCHMENT_DEEP} flatShading roughness={0.9} />
      </mesh>
      {/* The chart itself: a plane on the card's top, its image top toward the far edge so it reads upright from the camera. */}
      <mesh material={face} position={[0, CARD_THICKNESS + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CARD_WIDTH - 0.02, CARD_LENGTH - 0.02]} />
      </mesh>
      {/* The raycast target (layer 1, like every clickable thing in the scene) covers the whole card. */}
      <mesh
        layers={INTERACTION_LAYER}
        position={[0, CARD_THICKNESS / 2, 0]}
        onClick={(e) => {
          if (!clickable) return;
          e.stopPropagation();
          onOpen();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          if (clickable) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[CARD_WIDTH, CARD_THICKNESS + 0.03, CARD_LENGTH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hover && (
        <Html position={[0, CARD_THICKNESS + 0.14, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <span className="hud-scene-pill whitespace-nowrap">
            {name} · {summary}
            {clickable ? " · click to improve" : ""}
          </span>
        </Html>
      )}
    </group>
  );
}

export function ImprovementCard({ view, bounds, shadows, onOpen }: { view: RedactedState; bounds: Bounds; shadows: boolean; /** Opens the viewer's improvement sheet; omitted while the viewer cannot act. */ onOpen?: (() => void) | undefined }) {
  const c = view.crown;
  if (!c || !view.scenario?.crown) return null;
  const order = view.players.map((p) => p.id);
  return (
    <group name="improvement-cards">
      {view.players.map((p) => {
        const cp = c.players[p.id];
        if (!cp) return null;
        const at = cardLayout(bounds, seatFrom(order, view.viewer, p.id));
        const mine = p.id === view.viewer;
        return (
          <group key={p.id} name={`card:${p.id}`}>
            <Card
              x={at.x}
              z={at.z}
              name={p.name}
              color={PLAYER_FILL[p.color]}
              tracks={cp.tracks}
              metropolises={{ trade: cp.metropolises.trade !== null, politics: cp.metropolises.politics !== null, science: cp.metropolises.science !== null }}
              mine={mine}
              onOpen={mine ? onOpen : undefined}
              shadows={shadows}
            />
            {mine && onOpen && (
              /* The same action for keyboard and assistive users (and the specs): a button over the card. */
              <Html position={[at.x, 0.05, at.z]} center zIndexRange={[4, 0]}>
                <button type="button" className="h-8 w-8 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gilt" aria-label={HUD_COPY.table.improvements} title={HUD_COPY.table.improvements} data-testid="improvement-card" onClick={onOpen} />
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
