"use client";

/**
 * Event toasts (docs/phase12.md §6): a dark rounded panel with a white tab,
 * centred at 20 % from the top, for roll results, event die outcomes,
 * barbarian attacks and robber moves. One at a time, four seconds each,
 * queued when several arrive.
 */

import { useEffect, useState } from "react";

export interface Toast {
  readonly id: number;
  readonly text: string;
  /** Test hook naming what the toast is about. */
  readonly kind?: string | undefined;
}

export const TOAST_MS = 4000;

export function EventToast({ queue, onShift }: { queue: readonly Toast[]; onShift: (id: number) => void }) {
  const head = queue[0] ?? null;
  const [visible, setVisible] = useState<Toast | null>(null);
  useEffect(() => {
    if (!head) {
      setVisible(null);
      return;
    }
    setVisible(head);
    const t = setTimeout(() => onShift(head.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [head, onShift]);
  if (!visible) return null;
  return (
    <div key={visible.id} className="hud-toast hud-panel" role="status" data-testid="event-toast" data-kind={visible.kind}>
      {visible.text}
    </div>
  );
}
