"use client";

/**
 * Fishing (docs/rules.md §15.2): the fish-spend sheet. Lists the five favours
 * with their costs; each is greyed out unless the engine lists a legal
 * `SPEND_FISH` for it. Favours that need a spot on the board (the robber's
 * rest, a free road, a settlement to upgrade) hand over to a target mode;
 * the steal and the bank resource pick their follow-up here.
 */

import { useState } from "react";
import { FISH_COST, FISH_OPTIONS, RESOURCES, isHiddenCount, type Action, type FishOption, type Resource } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import type { TargetMode } from "@/board3d/Interaction";
import { FISH_OPTION_HELP, FISH_OPTION_LABEL, RESOURCE_LABEL } from "@/game/labels";
import { PLAYER_FILL } from "@/game/theme";
import { Button, Modal } from "../ui";

type Spend = Extract<Action, { type: "SPEND_FISH" }>;

export function FishSheet({ view, me, legal, onDispatch, onMode, onClose }: { view: RedactedState; me: string; legal: Action[]; onDispatch: (a: Action) => void; onMode: (m: TargetMode) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<FishOption | null>(null);
  const purse = view.wayfarers?.fishing?.fish[me] ?? 0;
  const spends = legal.filter((a): a is Spend => a.type === "SPEND_FISH");
  const forOption = (option: FishOption) => spends.filter((a) => a.option === option);
  const reason = (option: FishOption): string | null => {
    if (forOption(option).length > 0) return null;
    if (purse < FISH_COST[option]) return `Needs ${FISH_COST[option]} fish`;
    if (view.phase.kind !== "action") return "Only after rolling";
    switch (option) {
      case "moveRobber":
        return "No lake or wasteland to send the robber to";
      case "steal":
        return "Nobody holds a card";
      case "bankResource":
        return "The bank is empty";
      case "freeRoad":
        return "Nowhere to build a road";
      case "freeDevCard":
        return "No cards left and no settlement to upgrade";
      default:
        return "Not right now";
    }
  };
  const choose = (option: FishOption) => {
    const options = forOption(option);
    const first = options[0];
    if (!first) return;
    switch (option) {
      case "moveRobber":
        onMode("fishRobber");
        onClose();
        return;
      case "freeRoad":
        onMode("fishRoad");
        onClose();
        return;
      case "freeDevCard":
        if (first.vertex === undefined) onDispatch(first);
        else {
          onMode("fishCity");
          onClose();
        }
        return;
      case "steal":
      case "bankResource":
        setPicked(option);
        return;
      default: {
        const exhaustive: never = option;
        throw new Error(String(exhaustive));
      }
    }
  };

  return (
    <Modal title={`Spend fish · you hold ${purse}`} onClose={onClose}>
      {picked === null ? (
        <ul className="space-y-1.5" data-testid="fish-options">
          {FISH_OPTIONS.map((option) => {
            const why = reason(option);
            return (
              <li key={option}>
                <Button className="flex w-full items-center gap-3 text-left" variant={why ? "secondary" : "primary"} disabled={why !== null} reason={why} onClick={() => choose(option)} data-testid={`fish-${option}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ink/40 bg-parchment text-sm font-semibold tabular-nums text-ink" aria-label={`${FISH_COST[option]} fish`}>
                    {FISH_COST[option]}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{FISH_OPTION_LABEL[option]}</span>
                    <span className="block text-xs font-normal opacity-80">{FISH_OPTION_HELP[option]}</span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : picked === "steal" ? (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Steal from">
          {forOption("steal").map((a) => {
            const p = view.players.find((x) => x.id === a.targetPlayerId);
            if (!p) return null;
            const hand = p.hand;
            const cards = isHiddenCount(hand) ? hand.count : RESOURCES.reduce((n, r) => n + hand[r], 0);
            return (
              <Button key={p.id} size="sm" onClick={() => onDispatch(a)} data-testid={`fish-steal-${p.id}`}>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: PLAYER_FILL[p.color] }} />
                {p.name} · {cards} cards
              </Button>
            );
          })}
          <Button variant="quiet" size="sm" onClick={() => setPicked(null)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Take a resource">
          {RESOURCES.map((r: Resource) => {
            const a = forOption("bankResource").find((x) => x.resource === r);
            return (
              <Button key={r} size="sm" disabled={!a} reason="The bank has none" onClick={() => a && onDispatch(a)} data-testid={`fish-resource-${r}`}>
                {RESOURCE_LABEL[r]}
              </Button>
            );
          })}
          <Button variant="quiet" size="sm" onClick={() => setPicked(null)}>
            Back
          </Button>
        </div>
      )}
    </Modal>
  );
}
