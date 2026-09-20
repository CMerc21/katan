"use client";

/**
 * Crown & Castle: each player's three city-improvement books on the table
 * beside their piece pile (docs/rules.md §16.3, docs/phase12.md §7). One flat
 * book per track in the track's colour, its level shown as raised pips on
 * the cover (filled to the level reached, empty above it), a gold seal on
 * the book of a track whose metropolis the player holds. The viewer's own
 * books are clickable and open the improvement sheet, so the tracks are one
 * click from the table as well as from the cost card.
 */

import { Html } from "@react-three/drei";
import { useState } from "react";
import { MAX_LEVEL, TRACKS, type Track } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { INTERACTION_LAYER } from "@/board3d/Interaction";
import type { Bounds } from "@/board3d/layout3d";
import * as P from "@/board3d/palette";
import { TRACK_LABEL } from "@/game/labels";
import { TRACK_COLOR } from "@/game/theme";
import { BOOK_GAP, booksLayout } from "./layout";

export const BOOK_WIDTH = 0.28;
export const BOOK_LENGTH = 0.34;
const BOOK_HEIGHT = 0.06;
const PAGES = "#EEE6D2";

function Book({ x, z, heading, track, level, metropolis, mine, name, onOpen, shadows }: { x: number; z: number; heading: number; track: Track; level: number; metropolis: boolean; mine: boolean; name: string; onOpen?: (() => void) | undefined; shadows: boolean }) {
  const [hover, setHover] = useState(false);
  const cover = TRACK_COLOR[track];
  const clickable = mine && onOpen !== undefined;
  return (
    <group position={[x, hover && clickable ? 0.03 : 0, z]} rotation={[0, heading, 0]} name={`book:${track}`}>
      {/* Pages: a bone block a hair narrower than the covers so their edges show. */}
      <mesh position={[0.012, BOOK_HEIGHT / 2, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[BOOK_WIDTH - 0.024, BOOK_HEIGHT - 0.016, BOOK_LENGTH - 0.02]} />
        <meshStandardMaterial color={PAGES} flatShading />
      </mesh>
      {/* Front and back covers. */}
      <mesh position={[0, BOOK_HEIGHT - 0.006, 0]} castShadow={shadows}>
        <boxGeometry args={[BOOK_WIDTH, 0.012, BOOK_LENGTH]} />
        <meshStandardMaterial color={cover} flatShading roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.006, 0]} receiveShadow={shadows}>
        <boxGeometry args={[BOOK_WIDTH, 0.012, BOOK_LENGTH]} />
        <meshStandardMaterial color={cover} flatShading roughness={0.7} />
      </mesh>
      {/* The spine along the left edge. */}
      <mesh position={[-BOOK_WIDTH / 2 + 0.01, BOOK_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.02, BOOK_HEIGHT, BOOK_LENGTH]} />
        <meshStandardMaterial color={cover} flatShading roughness={0.7} />
      </mesh>
      {/* Level pips down the cover: one raised bone stud per level reached, a dark recess for each still to build. */}
      {Array.from({ length: MAX_LEVEL }, (_, i) => {
        const reached = i < level;
        return (
          <mesh key={i} position={[0.02, BOOK_HEIGHT + (reached ? 0.008 : 0.001), -BOOK_LENGTH / 2 + 0.06 + i * 0.055]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.018, 8]} />
            <meshStandardMaterial color={reached ? PAGES : P.DARK} flatShading />
          </mesh>
        );
      })}
      {metropolis && (
        <mesh position={[BOOK_WIDTH / 2 - 0.05, BOOK_HEIGHT + 0.006, BOOK_LENGTH / 2 - 0.06]}>
          <cylinderGeometry args={[0.03, 0.03, 0.012, 8]} />
          <meshStandardMaterial color={P.GOLD} metalness={0.3} roughness={0.5} flatShading />
        </mesh>
      )}
      {/* The raycast target (layer 1, like every clickable thing in the scene) covers the whole book. */}
      <mesh
        layers={INTERACTION_LAYER}
        position={[0, BOOK_HEIGHT / 2, 0]}
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
        <boxGeometry args={[BOOK_WIDTH, BOOK_HEIGHT + 0.02, BOOK_LENGTH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hover && (
        <Html position={[0, BOOK_HEIGHT + 0.12, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <span className="hud-scene-pill whitespace-nowrap">
            {name} · {TRACK_LABEL[track]} <b>{level}</b>/{MAX_LEVEL}
            {metropolis ? " · metropolis" : ""}
            {clickable ? " · click to improve" : ""}
          </span>
        </Html>
      )}
    </group>
  );
}

export function ImprovementBooks({ view, bounds, shadows, onOpen }: { view: RedactedState; bounds: Bounds; shadows: boolean; /** Opens the viewer's improvement sheet; omitted while the viewer cannot act. */ onOpen?: (() => void) | undefined }) {
  const c = view.crown;
  if (!c || !view.scenario?.crown) return null;
  return (
    <group name="improvement-books">
      {view.players.map((p, seat) => {
        const cp = c.players[p.id];
        if (!cp) return null;
        const layout = booksLayout(bounds, seat);
        const heading = Math.atan2(layout.along.x, layout.along.z);
        return (
          <group key={p.id} name={`books:${p.id}`}>
            {TRACKS.map((track, i) => (
              <Book
                key={track}
                x={layout.origin.x + layout.across.x * (0.15 + i * BOOK_GAP)}
                z={layout.origin.z + layout.across.z * (0.15 + i * BOOK_GAP)}
                heading={heading}
                track={track}
                level={cp.tracks[track]}
                metropolis={cp.metropolises[track] !== null}
                mine={p.id === view.viewer}
                name={p.name}
                onOpen={onOpen}
                shadows={shadows}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}
