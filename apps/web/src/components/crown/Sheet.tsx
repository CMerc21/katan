"use client";

/**
 * A non-modal panel over the board (docs/phase11.md §11): prompts whose
 * answer is a spot on the board (a retreat, a metropolis, a city to give up,
 * a deserting knight) keep the board clickable and offer their other
 * answers here. Rendered inside the board's `<main>`.
 */

import type { ReactNode } from "react";

export function Sheet({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <div className="parchment absolute bottom-3 left-1/2 z-10 w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md p-3" role="dialog" aria-label={title} data-testid={testId}>
      <p className="font-display mb-2 text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}
