"use client";

/**
 * DOM-level animations for the event queue (docs/phase7.md §2.2): flying
 * cards between anchors, the dev card reveal, confetti and the "thinking…"
 * tag. The turn banner and the dice tray moved to `src/hud` (Phase 12).
 * All CSS transitions; no library.
 */

import { useEffect, useMemo, useState } from "react";
import type { DevCardType, PlayerColor, Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { PLAYER_FILL, PLAYER_TEXT } from "@/game/theme";
import { CardBack, DevCardFace, ResourceCardFace } from "../cards";
import { useAnchors, type Point } from "./anchors";

/** Commodities (docs/phase11.md) have no card flight yet; only the five resources fly. */
function asResource(x: string | null | undefined): Resource | undefined {
  return x === "wood" || x === "clay" || x === "wool" || x === "grain" || x === "ore" ? x : undefined;
}

// ---------------------------------------------------------------------------
// Thinking tag under a bot's avatar (rendered by the players panel through this hook)

export function thinkingPlayer(step: Step | null): string | null {
  return step?.kind === "thinking" ? step.playerId : null;
}

// ---------------------------------------------------------------------------
// Flying cards

interface Flight {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  readonly face: "resource" | "back" | "dev";
  readonly resource?: Resource;
  readonly dev?: DevCardType;
  readonly delay: number;
  readonly duration: number;
  readonly flip?: boolean;
}

function FlightCard({ f }: { f: Flight }) {
  const [at, setAt] = useState<Point>(f.from);
  useEffect(() => {
    const t = setTimeout(() => setAt(f.to), 16 + f.delay);
    return () => clearTimeout(t);
  }, [f]);
  const moving = at !== f.from;
  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-40"
      style={{
        transform: `translate(${at.x - 14}px, ${at.y - 20}px) scale(${moving ? 1 : 0.7})`,
        transition: `transform ${f.duration}ms cubic-bezier(.3,.7,.3,1), opacity 200ms ease-out ${Math.max(0, f.duration - 200)}ms`,
        opacity: moving ? 0.98 : 1,
      }}
    >
      {f.face === "resource" && f.resource ? <ResourceCardFace resource={f.resource} size={28} /> : f.face === "dev" && f.dev ? <DevCardFace type={f.dev} size={28} /> : <CardBack size={28} />}
    </div>
  );
}

/** Which flights an event produces, using the anchor registry to resolve positions. */
export function flightsFor(step: Step, view: RedactedState, point: (key: string) => Point | null): Flight[] {
  if (step.kind !== "event") return [];
  const e = step.event;
  const me = view.viewer;
  const dest = (playerId: string, resource?: Resource) => (playerId === me && resource ? point(`hand:${resource}`) ?? point(`player:${playerId}`) : point(`player:${playerId}`));
  const out: Flight[] = [];
  const add = (from: Point | null, to: Point | null, face: Flight["face"], extra: Partial<Flight> = {}, delay = 0) => {
    if (!from || !to) return;
    out.push({ id: `${e.seq}-${out.length}`, from, to, face, delay, duration: Math.max(200, step.duration - delay), ...extra });
  };
  switch (e.kind) {
    case "produced":
      e.gains.forEach((g, i) => {
        for (let k = 0; k < g.count; k++) add(point(`hex:${g.hex}`), dest(g.playerId, g.resource), "resource", { resource: g.resource }, i * 80 + k * 40);
      });
      break;
    case "discarded": {
      const bank = point("bank");
      if (e.cards) {
        let i = 0;
        for (const r of ["wood", "clay", "wool", "grain", "ore"] as const) for (let k = 0; k < e.cards[r]; k++) add(dest(e.playerId, r), bank, "resource", { resource: r }, i++ * 40);
      } else for (let i = 0; i < e.count; i++) add(dest(e.playerId), bank, "back", {}, i * 40);
      break;
    }
    case "stole": {
      const r = asResource(e.resource);
      add(dest(e.from, r), dest(e.to, r), r ? "resource" : "back", r ? { resource: r } : {});
      break;
    }
    case "devCardBought":
      add(point("deck"), dest(e.playerId), e.card ? "dev" : "back", e.card ? { dev: e.card } : {});
      break;
    case "inventionTaken":
      e.resources.forEach((r, i) => add(point("bank"), dest(e.playerId, r), "resource", { resource: r }, i * 80));
      break;
    case "monopolised":
      Object.entries(e.taken).forEach(([id, n], i) => {
        for (let k = 0; k < Math.min(n, 4); k++) add(dest(id, e.resource), dest(e.playerId, e.resource), "resource", { resource: e.resource }, i * 60 + k * 40);
      });
      break;
    case "tradeAccepted": {
      let i = 0;
      for (const r of ["wood", "clay", "wool", "grain", "ore"] as const) {
        for (let k = 0; k < e.give[r]; k++) add(dest(e.from, r), dest(e.to, r), "resource", { resource: r }, i++ * 50);
        for (let k = 0; k < e.receive[r]; k++) add(dest(e.to, r), dest(e.from, r), "resource", { resource: r }, i++ * 50);
      }
      break;
    }
    case "maritimeTrade": {
      const give = asResource(e.give);
      const receive = asResource(e.receive);
      for (let k = 0; k < e.count; k++) add(dest(e.playerId, give), point("bank"), give ? "resource" : "back", give ? { resource: give } : {}, k * 50);
      add(point("bank"), dest(e.playerId, receive), receive ? "resource" : "back", receive ? { resource: receive } : {}, 200);
      break;
    }
    case "specialCardMoved":
      add(e.from ? point(`player:${e.from}`) : point("bank"), e.to ? point(`player:${e.to}`) : point("bank"), "back");
      break;
    default:
      break;
  }
  return out;
}

export function FlightLayer({ step, view }: { step: Step | null; view: RedactedState }) {
  const anchors = useAnchors();
  const [flights, setFlights] = useState<Flight[]>([]);
  useEffect(() => {
    if (!step) return;
    const next = flightsFor(step, view, (k) => anchors.point(k));
    if (next.length === 0) return;
    setFlights((f) => [...f, ...next]);
    // Removal is independent of the next step: a flight lives for its own duration (docs/phase7.md §2.2).
    const ttl = Math.max(...next.map((f) => f.delay + f.duration)) + 150;
    setTimeout(() => setFlights((f) => f.filter((x) => !next.includes(x))), ttl);
    // The step identity is the trigger; the view at that moment is what we measure against.
  }, [step]);
  return (
    <>
      {flights.map((f) => (
        <FlightCard key={f.id} f={f} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dev card reveal (centre of the board)

export function DevCardReveal({ step, view }: { step: Step | null; view: RedactedState }) {
  const e = step?.kind === "event" && step.event.kind === "devCardPlayed" ? step.event : null;
  const p = useMemo(() => (e ? view.players.find((x) => x.id === e.playerId) : undefined), [e, view]);
  if (!e || !p) return null;
  return (
    <div key={e.seq} className="card-reveal pointer-events-none absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" data-testid="dev-reveal">
      <DevCardFace type={e.card} size={96} />
      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: PLAYER_FILL[p.color], color: PLAYER_TEXT[p.color] }}>
        {p.name}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Win: restrained confetti in the winner's colour

export function Confetti({ color }: { color: PlayerColor }) {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ x: (i * 37) % 100, d: (i * 53) % 900, r: (i * 71) % 360 })), []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti absolute top-0 block h-2 w-1.5"
          style={{ left: `${p.x}%`, background: i % 3 === 0 ? "#c9a227" : PLAYER_FILL[color], animationDelay: `${p.d}ms`, transform: `rotate(${p.r}deg)` }}
        />
      ))}
    </div>
  );
}
