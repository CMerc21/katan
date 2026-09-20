"use client";

/**
 * The dice widget above the tray's left end (docs/phase12.md §3): the
 * current roll (bone dice, the red die and the event die under Crown &
 * Castle, the event deck's card under that variant) and a toggle that shows
 * the last six rolls.
 */

import { useEffect, useState } from "react";
import type { EventCardKind, EventDie } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { Step } from "@/game/eventQueue";
import { EVENT_CARD_LABEL, EVENT_DIE_LABEL } from "@/game/labels";
import { BONE, COMMODITY_COLOR, FLEET_COLOR, GILT, INK, PLAYER_FILL } from "@/game/theme";
import { HUD_COPY } from "./hudCopy";
import { Icon } from "./icons";
import { useTipHandlers } from "./HelpTip";
import type { Roll } from "./model";


function Die({ n, rolling, delay, red = false }: { n: number; rolling: boolean; delay: number; red?: boolean }) {
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
    <svg viewBox="0 0 100 100" width={40} height={40} className={rolling ? "die-tumble" : "die-settle"} style={{ animationDelay: `${delay}ms` }} aria-label={`${red ? "red die" : "die"} ${n}`} data-testid={red ? "red-die" : undefined}>
      <rect x="6" y="6" width="88" height="88" rx="16" fill={red ? PLAYER_FILL.red : BONE} stroke={INK} strokeWidth={4} />
      {(pips[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={8} fill={red ? BONE : INK} />
      ))}
    </svg>
  );
}

/** Crown & Castle's event die (docs/rules.md §16.2): a black sail for the fleet, the track's commodity colour otherwise. */
function EventDieFace({ event, rolling, delay }: { event: EventDie; rolling: boolean; delay: number }) {
  const fill = event === "fleet" ? FLEET_COLOR : COMMODITY_COLOR[event === "trade" ? "cloth" : event === "politics" ? "coin" : "paper"];
  return (
    <svg viewBox="0 0 100 100" width={40} height={40} className={rolling ? "die-tumble" : "die-settle"} style={{ animationDelay: `${delay}ms` }} aria-label={`event die ${EVENT_DIE_LABEL[event]}`} data-testid="event-die" data-event={event}>
      <rect x="6" y="6" width="88" height="88" rx="16" fill={BONE} stroke={INK} strokeWidth={4} />
      {event === "fleet" ? (
        <>
          <path d="M50 18 V64 L78 56 Z" fill={fill} />
          <path d="M22 66 H78 L70 80 H30 Z" fill="#8a6a44" stroke={INK} strokeWidth={2} />
        </>
      ) : event === "trade" ? (
        <path d="M22 34 Q36 24 50 34 T78 34 V70 Q64 80 50 70 T22 70 Z" fill={fill} stroke={INK} strokeWidth={2} />
      ) : event === "politics" ? (
        <>
          <circle cx="50" cy="52" r="26" fill={fill} stroke={INK} strokeWidth={2} />
          <circle cx="50" cy="52" r="16" fill="none" stroke="#7a4a1f" strokeWidth={3} />
        </>
      ) : (
        <>
          <rect x="30" y="22" width="40" height="58" fill="#f8f4ea" stroke={INK} strokeWidth={2} />
          <path d="M38 38 H62 M38 50 H62 M38 62 H56" stroke={fill} strokeWidth={3} />
        </>
      )}
    </svg>
  );
}

/** The event deck's drawn card (docs/rules.md §15.1) shown in place of the dice. */
function EventCard({ total, event, rolling }: { total: number; event: EventCardKind | null; rolling: boolean }) {
  return (
    <div className={`flex h-12 w-9 flex-col items-center justify-center rounded border-2 ${rolling ? "die-settle" : ""}`} style={{ background: BONE, borderColor: event ? GILT : INK, color: INK }} aria-label={`card ${total}${event ? `, ${EVENT_CARD_LABEL[event]}` : ""}`} data-testid="event-card" data-event={event ?? undefined}>
      <span className="font-display text-lg font-semibold leading-none">{total}</span>
      {event && <span className="mt-0.5 text-[7px] leading-tight text-center" style={{ color: "#6f1519" }}>{EVENT_CARD_LABEL[event]}</span>}
    </div>
  );
}

function CurrentRoll({ step, view }: { step: Step | null; view: RedactedState }) {
  const rolling = step?.kind === "event" && step.event.kind === "diceRolled";
  const dice = rolling && step.event.kind === "diceRolled" ? step.event.dice : view.lastRoll;
  const [showing, setShowing] = useState(false);
  // Under the event deck a roll carries its card; keep the last one to show between rolls.
  const drawn = rolling && step.event.kind === "diceRolled" ? (step.event.card ?? null) : null;
  const [card, setCard] = useState<{ total: number; event: EventCardKind | null } | null>(null);
  useEffect(() => {
    if (rolling) setShowing(true);
    if (drawn) setCard(drawn);
  }, [rolling, drawn]);
  // Crown & Castle (docs/rules.md §16.2): the event die lands beside the number dice and the first die is red.
  const crown = view.scenario?.crown === true;
  const eventDie: EventDie | null = rolling && step.event.kind === "diceRolled" ? (step.event.event ?? null) : (view.crown?.lastEvent ?? null);
  if (!dice || (!showing && !view.lastRoll)) return null;
  const deck = view.scenario?.variants.eventDeck === true;
  if (deck && card) {
    return (
      <div className="hud-panel flex items-center gap-1.5 rounded-lg px-2 py-1" data-testid="dice-tray" aria-label={`drew ${card.total}`}>
        <EventCard total={card.total} event={card.event} rolling={!!rolling} />
      </div>
    );
  }
  return (
    <div className="hud-panel flex items-center gap-1.5 rounded-lg px-2 py-1" data-testid="dice-tray" aria-label={`dice ${dice[0]} and ${dice[1]}, total ${dice[0] + dice[1]}`}>
      <Die n={dice[0]} rolling={!!rolling} delay={0} red={crown} />
      <Die n={dice[1]} rolling={!!rolling} delay={120} />
      {crown && eventDie && <EventDieFace event={eventDie} rolling={!!rolling} delay={240} />}
      {/* The total beside the faces: nobody should have to count pips or catch the toast. */}
      <span className="hud-num ml-1 text-2xl" data-testid="dice-total" aria-hidden>
        {dice[0] + dice[1]}
      </span>
    </div>
  );
}


function HistoryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const tip = useTipHandlers(
    <>
      <b>{HUD_COPY.actions.diceHistory.label}</b>
      <div>{HUD_COPY.actions.diceHistory.help}</div>
    </>,
  );
  return (
    <button type="button" className="hud-icon-btn hud-panel" aria-label={HUD_COPY.actions.diceHistory.label} aria-pressed={open} onClick={onToggle} data-testid="dice-history" {...tip}>
      <Icon name="history" />
    </button>
  );
}

/** The last six rolls, oldest first. */
function History({ rolls }: { rolls: readonly Roll[] }) {
  return (
    <div className="hud-dice-history hud-panel" role="list" aria-label="Recent rolls" data-testid="dice-history-list">
      {rolls.length === 0 && <span className="hud-dim text-xs">No rolls yet</span>}
      {rolls.map((r, i) => (
        <span key={r.seq} role="listitem" className="flex items-center gap-0.5" aria-label={`rolled ${r.dice[0] + r.dice[1]}${r.event ? `, ${EVENT_DIE_LABEL[r.event]}` : ""}`}>
          {i > 0 && <span className="hud-roll-sep" />}
          <span className="hud-die" data-red={r.event !== null ? "true" : undefined}>
            {r.dice[0]}
          </span>
          <span className="hud-die">{r.dice[1]}</span>
          {r.event && (
            <span className="hud-die" data-event={r.event}>
              {EVENT_DIE_LABEL[r.event].slice(0, 3)}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function DiceWidget({ step, view, rolls }: { step: Step | null; view: RedactedState; rolls: readonly Roll[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CurrentRoll step={step} view={view} />
      <HistoryToggle open={open} onToggle={() => setOpen((o) => !o)} />
      {open && <History rolls={rolls} />}
    </>
  );
}
