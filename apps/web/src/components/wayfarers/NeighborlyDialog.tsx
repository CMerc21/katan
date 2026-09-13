"use client";

/**
 * Event deck, Neighborly help (docs/rules.md §15.1): give one card to the
 * poorest player, or pass. The legal list carries one `NEIGHBORLY_GIVE` per
 * resource held plus the pass.
 */

import { RESOURCES, type Action } from "@katan/engine";
import type { RedactedState } from "@/driver/types";
import { RESOURCE_LABEL, playerName } from "@/game/labels";
import { Button, Modal } from "../ui";

type Give = Extract<Action, { type: "NEIGHBORLY_GIVE" }>;

export function NeighborlyDialog({ view, legal, to, onGive }: { view: RedactedState; legal: Action[]; to: string; onGive: (a: Action) => void }) {
  const gives = legal.filter((a): a is Give => a.type === "NEIGHBORLY_GIVE");
  const pass = gives.find((a) => a.resource === null);
  return (
    <Modal title="Neighborly help">
      <p className="mb-3 text-sm text-ink-soft">{playerName(view, to)} has the fewest points. You may hand over one card.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Give a card">
        {RESOURCES.map((r) => {
          const a = gives.find((x) => x.resource === r);
          return (
            <Button key={r} size="sm" disabled={!a} reason="You hold none" onClick={() => a && onGive(a)} data-testid={`neighborly-${r}`}>
              {RESOURCE_LABEL[r]}
            </Button>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" disabled={!pass} onClick={() => pass && onGive(pass)} data-testid="neighborly-pass">
          Give nothing
        </Button>
      </div>
    </Modal>
  );
}
