"use client";

/**
 * The round buttons bottom right (docs/phase12.md §5): Cards (small), Trade
 * and End turn, each with a gold ring when enabled. During the roll phase
 * the End turn slot rolls the dice instead; End turn pulses when it is the
 * only thing left to do. While the animation queue drains the slot becomes
 * Skip.
 */

import { HUD_COPY } from "./hudCopy";
import { Icon, type IconName } from "./icons";
import { useTipHandlers } from "./HelpTip";

export interface RoundAction {
  readonly enabled: boolean;
  readonly reason?: string | null | undefined;
  readonly onClick: () => void;
}

function Round({ icon, label, help, action, testId, size = "large", pulse = false, count, pressed }: { icon: IconName; label: string; help: string; action: RoundAction; testId: string; size?: "large" | "small"; pulse?: boolean; count?: number | undefined; pressed?: boolean | undefined }) {
  const tip = useTipHandlers(
    <>
      <b>{label}</b>
      <div>{help}</div>
      {!action.enabled && action.reason && <div className="hud-dim">{action.reason}</div>}
    </>,
  );
  return (
    <button
      type="button"
      className="hud-round"
      data-size={size}
      data-enabled={action.enabled ? "true" : "false"}
      data-pulse={pulse && action.enabled ? "true" : undefined}
      data-count={count !== undefined && count > 0 ? String(count) : undefined}
      disabled={!action.enabled}
      aria-disabled={!action.enabled ? true : undefined}
      aria-pressed={pressed}
      aria-label={label}
      title={!action.enabled && action.reason ? action.reason : help}
      data-testid={testId}
      onClick={action.onClick}
      {...tip}
    >
      <Icon name={icon} />
      <span className="hud-round-label" aria-hidden>
        {label}
      </span>
    </button>
  );
}

export interface ActionButtonsProps {
  /** The roll phase for me: the primary slot rolls. */
  roll: RoundAction | null;
  /** §5.6: take back the last paid build; shown only while it is legal. */
  undo: RoundAction | null;
  endTurn: RoundAction;
  /** End turn is the only remaining action: pulse gold. */
  endTurnPulse: boolean;
  trade: RoundAction;
  cards: RoundAction;
  cardCount: number;
  cardsOpen: boolean;
  /** The special build phase's "done" (docs/rules.md §13). */
  specialBuildDone: RoundAction | null;
  draining: boolean;
  onSkip: () => void;
}

export function ActionButtons(props: ActionButtonsProps) {
  const { roll, undo, endTurn, endTurnPulse, trade, cards, cardCount, cardsOpen, specialBuildDone, draining, onSkip } = props;
  if (draining) {
    return (
      <div className="hud-actions" aria-label="Actions">
        <Round icon="history" label="Skip" help={HUD_COPY.actions.skip.help} action={{ enabled: true, onClick: onSkip }} testId="skip" />
      </div>
    );
  }
  return (
    <div className="hud-actions" aria-label="Actions">
      {undo && <Round icon="undo" label={HUD_COPY.actions.undo.label} help={HUD_COPY.actions.undo.help} action={undo} testId="undo-build" size="small" />}
      <Round icon="cards" label={HUD_COPY.actions.cards.label} help={HUD_COPY.actions.cards.help} action={cards} testId="cards" size="small" count={cardCount} pressed={cardsOpen} />
      <Round icon="trade" label={HUD_COPY.actions.trade.label} help={HUD_COPY.actions.trade.help} action={trade} testId="trade" />
      {roll ? (
        <Round icon="dice" label={HUD_COPY.actions.roll.label} help={HUD_COPY.actions.roll.help} action={roll} testId="roll" pulse />
      ) : specialBuildDone ? (
        <Round icon="hourglass" label="Done" help="Finish your special build." action={specialBuildDone} testId="special-build-done" pulse />
      ) : (
        <Round icon="hourglass" label={HUD_COPY.actions.endTurn.label} help={HUD_COPY.actions.endTurn.help} action={endTurn} testId="end-turn" pulse={endTurnPulse} />
      )}
    </div>
  );
}
