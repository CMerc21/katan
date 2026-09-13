"use client";

/**
 * A panel that slides in from the left rail (docs/phase12.md §3): 280 px
 * wide, dark, never modal. The board stays clickable beside it; Esc and the
 * close button dismiss it.
 */

import type { ReactNode } from "react";
import { useOpenSound } from "./primitives";

export function SidePanel({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  useOpenSound();
  return (
    <aside className="hud-side hud-panel hud-dark" role="dialog" aria-label={title} data-testid={testId ?? "side-panel"}>
      <div className="hud-side-head">
        <span>{title}</span>
        <button type="button" className="hud-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="hud-side-body">{children}</div>
    </aside>
  );
}
