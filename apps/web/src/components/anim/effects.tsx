"use client";

/**
 * DOM-level animations for the event queue (docs/phase7.md §2.2): the turn
 * banner (heraldic ribbon), the dice tray, flying cards between anchors, the
 * dev card reveal, and the "thinking…" tag. All CSS transitions; no library.
 */

import { useEffect, useMemo, useState } from "react";
import type { DevCardType, PlayerColor, Resource } from "@katan/engine";
import type { RedactedState, SeatInfo } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { BONE, INK, LEATHER, PLAYER_FILL, PLAYER_TEXT } from "@/game/theme";
import { Avatar } from "../Avatar";
import { CardBack, DevCardFace, ResourceCardFace } from "../cards";
import { useAnchors, type Point } from "./anchors";

// ---------------------------------------------------------------------------
// Turn banner

export function TurnBanner({ step, view, seats }: { step: Step | null; view: RedactedState; seats: SeatInfo[] | undefined }) {
  const event = step?.kind === "event" && step.event.kind === "turnStarted" ? step.event : null;
  const [shown, setShown] = useState<{ id: string; key: number } | null>(null);
  useEffect(() => {
    if (!event) return;
    setShown({ id: event.playerId, key: event.seq });
    const t = setTimeout(() => setShown(null), Math.max(300, step?.duration ?? 700));
    return () => clearTimeout(t);
  }, [event, step?.duration]);
  if (!shown) return null;
  const p = view.players.find((x) => x.id === shown.id);
  if (!p) return null;
  const seat = seats?.find((s) => s.playerId === p.id);
  return (
    <div key={shown.key} className="ribbon pointer-events-none fixed left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-3 px-8 py-2" style={{ background: PLAYER_FILL[p.color], color: PLAYER_TEXT[p.color] }} data-testid="turn-banner" role="status">
      <Avatar spec={seat?.avatar} color={p.color} name={p.name} size={36} />
      <span className="font-display text-xl tracking-wide">{p.id === view.viewer ? "Your turn" : `${p.name}'s turn`}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking tag under a bot's avatar (rendered by the players panel through this hook)

export function thinkingPlayer(step: Step | null): string | null {
  return step?.kind === "thinking" ? step.playerId : null;
}

// ---------------------------------------------------------------------------
// Dice

function Die({ n, rolling, delay }: { n: number; rolling: boolean; delay: number }) {
  const pips: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [
      [28, 28],
      [72, 72],
    ],
    3: [
      [28, 28],
      [50, 50],
      [72, 72],
    ],
    4: [
      [28, 28],
      [72, 28],
      [28, 72],
      [72, 72],
    ],
    5: [
      [28, 28],
      [72, 28],
      [50, 50],
      [28, 72],
      [72, 72],
    ],
    6: [
      [28, 24],
      [72, 24],
      [28, 50],
      [72, 50],
      [28, 76],
      [72, 76],
    ],
  };
  return (
    <svg viewBox="0 0 100 100" width={34} height={34} className={rolling ? "die-tumble" : "die-settle"} style={{ animationDelay: `${delay}ms` }} aria-label={`die ${n}`}>
      <rect x="6" y="6" width="88" height="88" rx="16" fill={BONE} stroke={INK} strokeWidth={4} />
      {(pips[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={8} fill={INK} />
      ))}
    </svg>
  );
}

export function DiceTray({ step, view }: { step: Step | null; view: RedactedState }) {
  const rolling = step?.kind === "event" && step.event.kind === "diceRolled";
  const dice = rolling && step.event.kind === "diceRolled" ? step.event.dice : view.lastRoll;
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (rolling) setShowing(true);
  }, [rolling]);
  if (!dice || (!showing && !view.lastRoll)) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: LEATHER, boxShadow: "inset 0 0 0 2px rgba(0,0,0,.35), 0 2px 4px rgba(0,0,0,.4)" }} data-testid="dice-tray" aria-label={`dice ${dice[0]} and ${dice[1]}`}>
      <Die n={dice[0]} rolling={!!rolling} delay={0} />
      <Die n={dice[1]} rolling={!!rolling} delay={120} />
    </div>
  );
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
    case "stole":
      add(dest(e.from, e.resource ?? undefined), dest(e.to, e.resource ?? undefined), e.resource ? "resource" : "back", e.resource ? { resource: e.resource } : {});
      break;
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
    case "maritimeTrade":
      for (let k = 0; k < e.count; k++) add(dest(e.playerId, e.give), point("bank"), "resource", { resource: e.give }, k * 50);
      add(point("bank"), dest(e.playerId, e.receive), "resource", { resource: e.receive }, 200);
      break;
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
