"use client";

/**
 * Screen anchors for flying cards (docs/phase7.md §2.2): components register
 * DOM elements under stable keys ("player:seat-1", "hand:wood", "bank",
 * "dice", "board"), and the flight layer measures them with
 * getBoundingClientRect when an event plays. Board positions ("hex:0,0")
 * are projected through the board's own `project` function.
 */

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Projector = (key: string) => Point | null;

interface Registry {
  set(key: string, el: Element | null): void;
  get(key: string): Element | null;
  /** The board's projector for hex/vertex/edge keys. */
  setProjector(fn: Projector | null): void;
  point(key: string): Point | null;
}

const AnchorsContext = createContext<Registry | null>(null);

export function AnchorsProvider({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, Element>());
  const projector = useRef<Projector | null>(null);
  const registry = useMemo<Registry>(
    () => ({
      set(key, el) {
        if (el) map.current.set(key, el);
        else map.current.delete(key);
      },
      get(key) {
        return map.current.get(key) ?? null;
      },
      setProjector(fn) {
        projector.current = fn;
      },
      point(key) {
        const el = map.current.get(key);
        if (el) {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return projector.current?.(key) ?? null;
      },
    }),
    [],
  );
  return <AnchorsContext.Provider value={registry}>{children}</AnchorsContext.Provider>;
}

export function useAnchors(): Registry {
  const r = useContext(AnchorsContext);
  if (!r) throw new Error("useAnchors outside AnchorsProvider");
  return r;
}

/** A ref callback that registers the element under `key`. */
export function useAnchor(key: string): (el: Element | null) => void {
  const registry = useContext(AnchorsContext);
  return useCallback(
    (el: Element | null) => {
      registry?.set(key, el);
    },
    [registry, key],
  );
}
