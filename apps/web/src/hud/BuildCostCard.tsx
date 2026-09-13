"use client";

/**
 * The parchment build-cost reference card (docs/phase12.md §4), bottom
 * left, tilted two degrees. Rows the player can afford right now get a gold
 * left bar and are clickable: a board row enters its placement mode, the
 * development card row buys one, the improvement row opens the sheet. Crown
 * rows appear only under that module; the ship row only under Tides.
 */

import type { Action } from "@katan/engine";
import type { TargetMode } from "@/board3d/Interaction";
import { HUD_COPY } from "./hudCopy";
import { Icon } from "./icons";
import { useTipHandlers } from "./HelpTip";
import type { CostRow } from "./model";

const TEST_ID: Record<CostRow["key"], string> = {
  road: "build-road",
  ship: "build-ship",
  settlement: "build-settlement",
  city: "build-city",
  devCard: "buy-dev",
  wall: "wall",
  knight: "knight",
  promote: "knight-promote",
  improvement: "improve",
};

function Row({ row, mode, onMode, onDispatch, onImprove }: { row: CostRow; mode: TargetMode; onMode: (m: TargetMode) => void; onDispatch: (a: Action) => void; onImprove: () => void }) {
  const copy = HUD_COPY.costs[row.key];
  const tip = useTipHandlers(
    <>
      <b>{copy.name}</b>
      <div>{copy.help}</div>
      {row.reason && <div className="hud-dim">{row.reason}</div>}
    </>,
  );
  const active = row.mode !== undefined && mode === row.mode;
  return (
    <button
      type="button"
      className="hud-cost-row"
      data-affordable={row.affordable ? "true" : "false"}
      data-row={row.key}
      disabled={!row.affordable}
      aria-disabled={!row.affordable ? true : undefined}
      aria-pressed={row.mode !== undefined ? active : undefined}
      title={row.reason ?? copy.help}
      data-testid={TEST_ID[row.key]}
      onClick={() => {
        if (!row.affordable) return;
        if (row.opens === "improve") onImprove();
        else if (row.action) onDispatch(row.action);
        else if (row.mode !== undefined) onMode(active ? null : row.mode);
      }}
      {...tip}
    >
      <span className="hud-cost-name">
        {copy.name}
        {copy.note && <small>{copy.note}</small>}
      </span>
      <span className="hud-cost-icons" aria-hidden>
        {row.cost.map((c, i) => (
          <span key={i}>
            <Icon name={c} size={16} tint />
          </span>
        ))}
      </span>
    </button>
  );
}

export function BuildCostCard({ rows, mode, onMode, onDispatch, onImprove }: { rows: readonly CostRow[]; mode: TargetMode; onMode: (m: TargetMode) => void; onDispatch: (a: Action) => void; onImprove: () => void }) {
  return (
    <div className="hud-cost-card" role="group" aria-label="Build costs" data-testid="build-cost-card">
      <div className="hud-cost-title">Build costs</div>
      {rows.map((row) => (
        <Row key={row.key} row={row} mode={mode} onMode={onMode} onDispatch={onDispatch} onImprove={onImprove} />
      ))}
    </div>
  );
}
