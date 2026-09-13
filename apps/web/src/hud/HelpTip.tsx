"use client";

/**
 * Help tips (docs/phase12.md §6): one dark panel with a white tab, anchored
 * under the hovered element, fed by `hudCopy.ts`. The provider renders it at
 * the end of the HUD; components register hover/focus handlers through
 * `useTipHandlers`. Banners use a 300 ms delay, everything else shows at once.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Help tips

interface TipState {
  readonly content: ReactNode;
  readonly rect: { left: number; top: number; width: number; height: number };
}

interface TipApi {
  /** Show `content` under `el` after `delay` ms (0 for build costs, 300 for banners). */
  show(el: Element, content: ReactNode, delay?: number): void;
  hide(): void;
}

const TipContext = createContext<TipApi | null>(null);

export function HelpTipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const api = useMemo<TipApi>(
    () => ({
      show(el, content, delay = 0) {
        if (timer.current) clearTimeout(timer.current);
        const r = el.getBoundingClientRect();
        const next = { content, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
        if (delay <= 0) setTip(next);
        else timer.current = setTimeout(() => setTip(next), delay);
      },
      hide() {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setTip(null);
      },
    }),
    [],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <TipContext.Provider value={api}>
      {children}
      {tip && <HelpTip tip={tip} />}
    </TipContext.Provider>
  );
}

const NOOP: TipApi = { show: () => undefined, hide: () => undefined };

export function useHelpTip(): TipApi {
  return useContext(TipContext) ?? NOOP;
}

/** Mouse and focus handlers that show `content` for the element. */
export function useTipHandlers(content: ReactNode, delay = 0) {
  const tip = useHelpTip();
  return useMemo(
    () => ({
      onMouseEnter: (e: { currentTarget: Element }) => tip.show(e.currentTarget, content, delay),
      onMouseLeave: () => tip.hide(),
      onFocus: (e: { currentTarget: Element }) => tip.show(e.currentTarget, content, 0),
      onBlur: () => tip.hide(),
    }),
    [tip, content, delay],
  );
}

function HelpTip({ tip }: { tip: TipState }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: tip.rect.left, top: tip.rect.top + tip.rect.height + 10 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = tip.rect.left;
    let top = tip.rect.top + tip.rect.height + 10;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    if (top + h > window.innerHeight - 8) top = Math.max(8, tip.rect.top - h - 10);
    setPos({ left, top });
  }, [tip]);
  return (
    <div ref={box} className="hud-tip hud-panel hud-dark" role="tooltip" style={{ left: pos.left, top: pos.top }} data-testid="help-tip">
      {tip.content}
    </div>
  );
}

