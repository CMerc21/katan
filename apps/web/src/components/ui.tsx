"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { PlayerColor, Resource } from "@katan/engine";
import { RESOURCE_LABEL, RESOURCE_SHORT } from "@/game/labels";
import { PLAYER_FILL, PLAYER_TEXT, RESOURCE_COLOR } from "@/game/theme";

type Variant = "primary" | "secondary" | "quiet";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-parchment hover:bg-ink-soft disabled:bg-line disabled:text-ink-soft",
  secondary: "border border-ink bg-transparent text-ink hover:bg-parchment-deep disabled:border-line disabled:text-ink-soft",
  quiet: "bg-transparent text-ink hover:bg-parchment-deep disabled:text-ink-soft",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shown as a tooltip and read by assistive tech when the button is disabled. */
  reason?: string | null | undefined;
  size?: "sm" | "md";
}

export function Button({ variant = "secondary", reason, size = "md", className = "", children, ...rest }: ButtonProps) {
  const pad = size === "sm" ? "px-2.5 py-1 text-sm" : "px-3.5 py-2";
  return (
    <button
      type="button"
      title={rest.disabled && reason ? reason : rest.title}
      aria-disabled={rest.disabled ? true : undefined}
      className={`rounded-md font-medium leading-tight transition-colors disabled:cursor-not-allowed ${pad} ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Swatch({ color, size = 14 }: { color: PlayerColor; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full border border-ink/70 align-middle"
      style={{ width: size, height: size, background: PLAYER_FILL[color] }}
    />
  );
}

export function PlayerTag({ name, color }: { name: string; color: PlayerColor }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold"
      style={{ background: PLAYER_FILL[color], color: PLAYER_TEXT[color], border: "1px solid rgba(33,29,25,.5)" }}
    >
      {name}
    </span>
  );
}

/** A resource card with a count badge. */
export function ResourceChip({
  resource,
  count,
  animateKey,
  compact = false,
}: {
  resource: Resource;
  count: number;
  animateKey?: string | number;
  compact?: boolean;
}) {
  return (
    <div
      key={animateKey}
      className={`flex items-center gap-2 rounded-md border border-ink/40 bg-white/40 ${compact ? "px-1.5 py-1" : "px-2 py-1.5"} ${animateKey !== undefined ? "card-in" : ""}`}
      aria-label={`${count} ${RESOURCE_LABEL[resource]}`}
    >
      <span
        aria-hidden
        className="grid h-7 w-5 place-items-center rounded-sm text-[10px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(0,0,0,.25)]"
        style={{ background: RESOURCE_COLOR[resource] }}
      >
        {RESOURCE_SHORT[resource]}
      </span>
      {!compact && <span className="text-sm">{RESOURCE_LABEL[resource]}</span>}
      <span className="ml-auto min-w-[1.25rem] text-right text-base font-semibold tabular-nums">{count}</span>
    </div>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  accent,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {accent && <span aria-hidden className="h-5 w-3.5 rounded-sm" style={{ background: accent }} />}
      <span className="w-14 text-sm">{label}</span>
      <Button size="sm" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </Button>
      <span className="w-6 text-center tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button size="sm" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </Button>
    </div>
  );
}

/** A modal panel. Non-dismissable dialogs pass no `onClose`. */
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>("button, input, select, [tabindex]");
    first?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/50 p-4" role="presentation">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-xl" : "max-w-md"} rounded-lg border border-line bg-parchment p-5 shadow-xl`}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          {onClose && (
            <Button variant="quiet" size="sm" aria-label="Close" onClick={onClose}>
              ✕
            </Button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
