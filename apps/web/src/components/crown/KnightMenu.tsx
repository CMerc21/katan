"use client";

/**
 * The knight's action menu (docs/phase11.md §11), anchored over one of your
 * knights: activate, promote, move, drive off a weaker knight, chase the
 * robber. Each entry is greyed with the reason when the engine lists no
 * such action for this knight (docs/rules.md §16.5).
 */

import { KNIGHTS_PER_LEVEL, type Action, type Hand, type VertexId } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { TargetMode } from "@/board3d/Interaction";
import { ACTIVATE_COST_TEXT, KNIGHT_COST_TEXT, KNIGHT_LEVEL_LABEL } from "@/game/labels";
import { Button } from "../ui";

export function KnightMenu({ view, me, vertex, hand, legal, onDispatch, onMode, onClose }: { view: RedactedState; me: string; vertex: VertexId; hand: Hand; legal: Action[]; onDispatch: (a: Action) => void; onMode: (mode: TargetMode, from: VertexId) => void; onClose: () => void }) {
  const c = view.crown;
  const knight = c?.knights.find((k) => k.at === vertex && k.owner === me);
  if (!c || !knight) return null;
  const cp = c.players[me];
  const mine = c.knights.filter((k) => k.owner === me);
  const has = (pred: (a: Action) => boolean) => legal.some(pred);
  const activate = has((a) => a.type === "ACTIVATE_KNIGHT" && a.vertex === vertex);
  const promote = has((a) => a.type === "PROMOTE_KNIGHT" && a.vertex === vertex);
  const move = has((a) => a.type === "KNIGHT_MOVE" && a.from === vertex);
  const displace = has((a) => a.type === "KNIGHT_DISPLACE" && a.from === vertex);
  const chase = has((a) => a.type === "KNIGHT_CHASE_ROBBER" && a.vertex === vertex);
  const ready = knight.active && !knight.actedThisTurn;
  const restReason = !knight.active ? "The knight is not active" : knight.actedThisTurn ? "This knight has already acted this turn" : null;
  const activateReason = activate ? null : knight.active ? "Already active" : hand.grain < 1 ? `Needs ${ACTIVATE_COST_TEXT}` : "Not right now";
  const promoteReason = promote
    ? null
    : knight.level >= 3
      ? "A mighty knight cannot be promoted further"
      : knight.level === 2 && (cp?.tracks.politics ?? 0) < 3
        ? "A mighty knight needs politics level 3"
        : mine.filter((k) => k.level === knight.level + 1).length >= KNIGHTS_PER_LEVEL
          ? "No piece of the next level left"
          : hand.wool < 1 || hand.ore < 1
            ? `Needs ${KNIGHT_COST_TEXT}`
            : "Not right now";
  const moveReason = move ? null : (restReason ?? "No free vertex on your roads to move to");
  const displaceReason = displace ? null : (restReason ?? "No weaker opposing knight in reach");
  const chaseReason = chase ? null : (restReason ?? (c.attacks === 0 ? "The robber stays home until the barbarians have attacked once" : "The robber is not next to this knight"));
  return (
    <div className="parchment z-20 min-w-[13rem] rounded-md p-2" role="group" aria-label="Knight" data-testid="knight-menu">
      <p className="mb-1 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        <span>
          {KNIGHT_LEVEL_LABEL[knight.level]} knight · {knight.active ? (ready ? "ready" : "active, has acted") : "inactive"}
        </span>
        <Button variant="quiet" size="sm" aria-label="Close" onClick={onClose}>
          ✕
        </Button>
      </p>
      <div className="flex flex-col gap-1">
        <Button size="sm" disabled={!activate} reason={activateReason} title={activate ? `Activate for ${ACTIVATE_COST_TEXT}` : undefined} onClick={() => onDispatch({ type: "ACTIVATE_KNIGHT", playerId: me, vertex })} data-testid="knight-activate">
          Activate ({ACTIVATE_COST_TEXT})
        </Button>
        <Button size="sm" disabled={!promote} reason={promoteReason} title={promote ? `Promote to ${KNIGHT_LEVEL_LABEL[(knight.level + 1) as 2 | 3].toLowerCase()} for ${KNIGHT_COST_TEXT}` : undefined} onClick={() => onDispatch({ type: "PROMOTE_KNIGHT", playerId: me, vertex })} data-testid="knight-promote">
          Promote ({KNIGHT_COST_TEXT})
        </Button>
        <Button size="sm" disabled={!move} reason={moveReason} onClick={() => onMode("knightMove", vertex)} data-testid="knight-move">
          Move
        </Button>
        <Button size="sm" disabled={!displace} reason={displaceReason} onClick={() => onMode("knightDisplace", vertex)} data-testid="knight-displace">
          Drive off a knight
        </Button>
        <Button size="sm" disabled={!chase} reason={chaseReason} onClick={() => onDispatch({ type: "KNIGHT_CHASE_ROBBER", playerId: me, vertex })} data-testid="knight-chase">
          Chase the robber
        </Button>
      </div>
    </div>
  );
}
