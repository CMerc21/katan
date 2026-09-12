"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameDriver, RedactedState } from "@/driver/types";
import { EventQueue, type QueueState, type Step } from "@/game/eventQueue";
import { effectiveSpeed, type Settings } from "@/game/settings";

export interface AnimatedGame {
  /** What the screen shows: the last fully rendered view plus the events played so far. */
  readonly view: RedactedState;
  /** The latest authoritative view (for legal actions once the queue is idle). */
  readonly latest: RedactedState;
  readonly current: Step | null;
  readonly draining: boolean;
  readonly skip: () => void;
}

/**
 * Sits between the driver and the components (docs/phase7.md §2.1). Views from
 * the driver are queued; the rendered view advances one event at a time.
 */
export function useEventQueue(driver: GameDriver, settings: Settings, isBot: (playerId: string) => boolean, onStep?: (step: Step, view: RedactedState) => void): AnimatedGame {
  const speedRef = useRef(effectiveSpeed(settings));
  speedRef.current = effectiveSpeed(settings);
  const isBotRef = useRef(isBot);
  isBotRef.current = isBot;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const [latest, setLatest] = useState<RedactedState | null>(null);
  const [qs, setQs] = useState<QueueState | null>(null);
  const queueRef = useRef<EventQueue | null>(null);

  useEffect(() => {
    let queue: EventQueue | null = null;
    const unsubscribe = driver.subscribe((view) => {
      setLatest(view);
      if (!queue) {
        queue = new EventQueue(view, {
          speed: () => speedRef.current,
          isBot: (id) => isBotRef.current(id),
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
          onChange: setQs,
          onStep: (step, v) => onStepRef.current?.(step, v),
        });
        queueRef.current = queue;
        setQs(queue.state());
        return;
      }
      queue.push(view);
    });
    return () => {
      unsubscribe();
      queue?.dispose();
      queueRef.current = null;
    };
  }, [driver]);

  const skip = useMemo(() => () => queueRef.current?.skip(), []);

  const initial = useMemo(() => firstView(driver), [driver]);
  const view = qs?.rendered ?? initial;
  return { view, latest: latest ?? initial, current: qs?.current ?? null, draining: qs?.draining ?? false, skip };
}

function firstView(driver: GameDriver): RedactedState {
  let snapshot: RedactedState | null = null;
  driver.subscribe((v) => void (snapshot = v))();
  if (!snapshot) throw new Error("driver did not emit an initial view");
  return snapshot;
}
