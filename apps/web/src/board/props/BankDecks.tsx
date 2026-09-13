"use client";

/**
 * The bank on the table (docs/phase12.md §7): one flat stack per resource
 * (and per commodity under Crown & Castle) whose height follows the count,
 * plus the development deck or the three progress decks. Hover a stack for
 * its count; the deck shows its count as a small label so the bank is
 * readable at a glance. Replaces the "bank 53" chip.
 */

import { Html } from "@react-three/drei";
import { useState } from "react";
import { COMMODITIES, RESOURCES, type Commodity, type Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { INTERACTION_LAYER } from "@/board3d/Interaction";
import type { Bounds } from "@/board3d/layout3d";
import { COMMODITY_COLOR, RESOURCE_COLOR, TRACK_COLOR } from "@/game/theme";
import { cardLabel } from "@/game/labels";
import { bankLayout } from "./layout";

const CARD_W = 0.42;
const CARD_D = 0.6;
const CARD_H = 0.012;

function Stack({ x, z, count, color, label, testId }: { x: number; z: number; count: number; color: string; label: string; testId?: string }) {
  const [hover, setHover] = useState(false);
  const h = Math.max(CARD_H, Math.min(count, 25) * CARD_H);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2 + 0.005, 0]} layers={INTERACTION_LAYER} onPointerOver={(e) => (e.stopPropagation(), setHover(true))} onPointerOut={() => setHover(false)} name={`bank:${label}`}>
        <boxGeometry args={[CARD_W, h, CARD_D]} />
        <meshStandardMaterial color={count === 0 ? "#6f6a60" : color} roughness={0.8} />
      </mesh>
      {count > 0 && (
        <mesh position={[0, h + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CARD_W * 0.8, CARD_D * 0.8]} />
          <meshStandardMaterial color="#efe8d8" roughness={0.9} />
        </mesh>
      )}
      {hover && (
        <Html position={[0, h + 0.3, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <span className="hud-scene-pill" data-testid={testId ? `${testId}-tip` : undefined}>
            {label} <b>{count}</b>
          </span>
        </Html>
      )}
    </group>
  );
}

export function BankDecks({ view, bounds }: { view: RedactedState; bounds: Bounds }) {
  const crown = view.scenario?.crown === true;
  const cards: (Resource | Commodity)[] = crown ? [...RESOURCES, ...COMMODITIES] : [...RESOURCES];
  const layout = bankLayout(bounds, cards.length);
  const stock = (k: Resource | Commodity): number => (k === "cloth" || k === "coin" || k === "paper" ? (view.crown?.bank[k] ?? 0) : view.bank[k]);
  const deckCount = crown && view.crown ? view.crown.decks.trade + view.crown.decks.politics + view.crown.decks.science : view.devDeck.count;
  const deckTitle = crown && view.crown ? `Progress decks: ${view.crown.decks.trade} trade, ${view.crown.decks.politics} politics, ${view.crown.decks.science} science` : `Development deck: ${deckCount} cards`;
  return (
    <group name="bank">
      {cards.map((k, i) => (
        <Stack key={k} x={layout.origin.x} z={layout.origin.z + i * layout.step} count={stock(k)} color={k === "cloth" || k === "coin" || k === "paper" ? COMMODITY_COLOR[k] : RESOURCE_COLOR[k]} label={cardLabel(k)} testId={`bank-${k}`} />
      ))}
      {crown && view.crown ? (
        (["trade", "politics", "science"] as const).map((t, i) => (
          <Stack key={t} x={layout.deck.x + (i - 1) * 0.5} z={layout.deck.z} count={view.crown!.decks[t]} color={TRACK_COLOR[t]} label={`${t[0]!.toUpperCase()}${t.slice(1)} deck`} />
        ))
      ) : (
        <Stack x={layout.deck.x} z={layout.deck.z} count={view.devDeck.count} color="#3b2a1e" label="Development deck" />
      )}
      <Html position={[layout.deck.x, 0.5, layout.deck.z + 0.45]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span className="hud-scene-pill" title={deckTitle} aria-label={deckTitle}>
          <b data-testid="deck-count">{deckCount}</b>
        </span>
      </Html>
    </group>
  );
}
