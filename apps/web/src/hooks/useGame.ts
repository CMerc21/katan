"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Action } from "@katan/engine";
import type { DriverError, GameDriver, RedactedState, Result } from "@/driver/types";

export interface Game {
  readonly view: RedactedState;
  /** Legal actions for `me`. */
  readonly legal: Action[];
  readonly dispatch: (action: Action) => Promise<Result<void, DriverError>>;
  /** Player id this screen currently acts as. */
  readonly me: string;
}

/** The one hook components use to read and drive the game (docs/phase3.md §1). */
export function useGame(driver: GameDriver): Game {
  const [view, setView] = useState<RedactedState | null>(null);

  useEffect(() => driver.subscribe(setView), [driver]);

  const legal = useMemo(() => (view ? driver.legalActions() : []), [driver, view]);
  const dispatch = useCallback((action: Action) => driver.dispatch(action), [driver]);

  if (!view) {
    // subscribe() fires synchronously, so this only happens before the first effect.
    return { view: firstView(driver), legal: driver.legalActions(), dispatch, me: driver.me() };
  }
  return { view, legal, dispatch, me: view.viewer };
}

function firstView(driver: GameDriver): RedactedState {
  let snapshot: RedactedState | null = null;
  driver.subscribe((v) => void (snapshot = v))();
  if (!snapshot) throw new Error("driver did not emit an initial view");
  return snapshot;
}
