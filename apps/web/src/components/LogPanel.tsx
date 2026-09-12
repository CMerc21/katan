"use client";

import type { RedactedState } from "@/driver/types";

/** Log panel: newest first (docs/phase3.md §6). */
export function LogPanel({ view }: { view: RedactedState }) {
  const entries = view.log.slice().reverse();
  return (
    <section aria-label="Log" className="flex min-h-0 flex-1 flex-col">
      <h2 className="font-display px-3 pt-2 text-sm font-semibold text-ink-soft">Log</h2>
      <ol className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 text-sm" data-testid="log">
        {entries.length === 0 && <li className="text-ink-soft">Nothing has happened yet.</li>}
        {entries.map((entry, i) => (
          <li key={`${view.log.length - i}`} className="border-b border-line/60 py-1 last:border-0">
            <span className="mr-1.5 text-xs text-ink-soft tabular-nums">t{entry.turn}</span>
            {entry.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
