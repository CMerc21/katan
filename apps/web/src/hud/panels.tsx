"use client";

/**
 * The bodies of the left rail's panels (docs/phase12.md §3): Chat (local for
 * now), Emote, Log (moved here from the sidebar), Stats, Rules and Leave.
 * Settings lives in `SettingsMenu.tsx`.
 */

import { useState, type ReactNode } from "react";
import type { BotLevel } from "@katan/bots";
import { COSTS, DEFAULT_VICTORY_POINTS, RESOURCES, TRACKS, type PlayerColor } from "@katan/engine";
import type { GameDriver, RedactedState, SeatInfo } from "@/driver/types";
import { RESOURCE_LABEL, TRACK_LABEL, VARIANT_HELP, VARIANT_LABEL } from "@/game/labels";
import { Button } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { HUD_COPY } from "./hudCopy";
import { Icon } from "./icons";
import { bannerStats, devCount, handSize, rollHistogram, totalVP, type Roll } from "./model";

export interface ChatMessage {
  readonly id: number;
  readonly from: string;
  readonly color: PlayerColor;
  readonly text: string;
}

export function ChatPanel({ messages, onSend }: { messages: readonly ChatMessage[]; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex h-full flex-col">
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto" data-testid="chat-messages">
        {messages.length === 0 && <li className="text-ink-soft">{HUD_COPY.rail.chat.help}</li>}
        {messages.map((m) => (
          <li key={m.id}>
            <b>{m.from}</b> {m.text}
          </li>
        ))}
      </ol>
      <form
        className="mt-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSend(text.trim());
          setText("");
        }}
      >
        <input className="min-w-0 flex-1 rounded border border-white/20 bg-black/30 px-2 py-1 text-sm text-white" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" aria-label="Message" data-testid="chat-input" />
        <Button size="sm" variant="primary" type="submit">
          Send
        </Button>
      </form>
    </div>
  );
}

export const EMOTES = ["👍", "👎", "😄", "😮", "😢", "😠", "🤝", "🎲"] as const;

export function EmotePanel({ onEmote }: { onEmote: (emote: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Emotes">
      {EMOTES.map((e) => (
        <button key={e} type="button" className="rounded-md border border-white/15 bg-black/25 py-2 text-2xl hover:bg-white/10" onClick={() => onEmote(e)} aria-label={`Emote ${e}`} data-testid={`emote-${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

/** The log list; the same element is rendered sr-only while the panel is closed so the record is always in the page. */
export function LogList({ view, hidden = false }: { view: RedactedState; hidden?: boolean }) {
  const entries = view.log.slice().reverse();
  return (
    <ol className={hidden ? "sr-only" : "text-sm"} data-testid="log" aria-label="Log" aria-live="polite">
      {entries.length === 0 && <li className="text-ink-soft">Nothing has happened yet.</li>}
      {entries.map((entry, i) => (
        <li key={`${view.log.length - i}`} className="border-b border-white/10 py-1 last:border-0">
          <span className="mr-1.5 text-xs text-ink-soft tabular-nums">t{entry.turn}</span>
          {entry.text}
        </li>
      ))}
    </ol>
  );
}

export function StatsPanel({ view, rolls, seats }: { view: RedactedState; rolls: readonly Roll[]; seats: SeatInfo[] | undefined }) {
  const crown = view.scenario?.crown === true;
  const hist = rollHistogram(rolls);
  const max = Math.max(1, ...hist);
  return (
    <>
      <h3>Players</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>VP</th>
            <th>Cards</th>
            <th>{crown ? "Prog" : "Dev"}</th>
            <th>Roads</th>
            <th>Towns</th>
          </tr>
        </thead>
        <tbody>
          {view.players.map((p) => (
            <tr key={p.id}>
              <td>
                <span className="inline-flex items-center gap-1">
                  <Avatar spec={seats?.find((s) => s.playerId === p.id)?.avatar} color={p.color} name={p.name} size={18} />
                  {p.name}
                </span>
              </td>
              <td>{totalVP(p)}</td>
              <td>{handSize(p)}</td>
              <td>{crown ? bannerStats(view, p).columns.find((c) => c.key === "progress")?.value : devCount(p)}</td>
              <td>{p.roads.length}</td>
              <td>
                {p.settlements.length}+{p.cities.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Titles</h3>
      <ul className="text-sm">
        <li>Longest road: {view.longestRoad.playerId ? `${view.players.find((p) => p.id === view.longestRoad.playerId)?.name} (${view.longestRoad.length})` : "nobody yet"}</li>
        {!crown && <li>Largest army: {view.largestArmy.playerId ? `${view.players.find((p) => p.id === view.largestArmy.playerId)?.name} (${view.largestArmy.count})` : "nobody yet"}</li>}
      </ul>
      <h3>Dice ({rolls.length} rolls)</h3>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label="Roll histogram" data-testid="roll-histogram">
        {hist.slice(2).map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
            <div className="w-full rounded-sm bg-[var(--hud-accent)]" style={{ height: `${(n / max) * 60}px`, opacity: n ? 1 : 0.2 }} title={`${i + 2}: ${n}`} />
            <span className="text-[10px] text-ink-soft">{i + 2}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function InfoPanel({ view }: { view: RedactedState }) {
  const s = view.scenario;
  const crown = s?.crown === true;
  const cost = (key: keyof typeof COSTS) => RESOURCES.filter((r) => COSTS[key][r] > 0).map((r) => `${COSTS[key][r]} ${RESOURCE_LABEL[r].toLowerCase()}`).join(", ");
  return (
    <>
      <h3>This game</h3>
      <p>
        {s ? `${s.name} · ` : ""}
        {[crown ? "Crown & Castle" : null, s?.tides ? "Tides" : null].filter(Boolean).join(" · ")}
        {crown || s?.tides ? " · " : ""}
        {s?.victoryPoints ?? DEFAULT_VICTORY_POINTS} points to win
      </p>
      {s && s.specialRules.length > 0 && (
        <ul>
          {s.specialRules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      )}
      <h3>Build costs</h3>
      <ul>
        <li>Road: {cost("road")}</li>
        {s?.tides && <li>Ship: {cost("ship")}</li>}
        <li>Settlement: {cost("settlement")}</li>
        <li>City: {cost("city")}</li>
        {!crown && <li>Development card: {cost("devCard")}</li>}
        {crown && (
          <>
            <li>Knight: wool + ore (activate: grain; promote: wool + ore)</li>
            <li>City wall: 2 clay</li>
            <li>Improvement: the track&apos;s commodity, one per level</li>
          </>
        )}
      </ul>
      <h3>Titles</h3>
      <ul>
        <li>{HUD_COPY.titles.longestRoad}</li>
        {!crown && <li>{HUD_COPY.titles.largestArmy}</li>}
        {crown && <li>{HUD_COPY.titles.defender}</li>}
        {crown && <li>{HUD_COPY.titles.metropolis}</li>}
      </ul>
      {crown && (
        <>
          <h3>Improvement tracks</h3>
          <ul>
            {TRACKS.map((t) => (
              <li key={t}>
                <b>{TRACK_LABEL[t]}</b>: {HUD_COPY.tracks[t].split(": ")[1]}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">{HUD_COPY.table.barbarians}</p>
        </>
      )}
      {s?.variants && Object.entries(s.variants).some(([, on]) => on) && (
        <>
          <h3>Variants</h3>
          <ul>
            {(Object.keys(VARIANT_LABEL) as (keyof typeof VARIANT_LABEL)[])
              .filter((v) => s.variants[v])
              .map((v) => (
                <li key={v}>
                  <b>{VARIANT_LABEL[v]}</b>: {VARIANT_HELP[v]}
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}

export function LeavePanel({ driver, me, seats, ended, onExit, onCapability }: { driver: GameDriver; me: string; seats: SeatInfo[] | undefined; ended: boolean; onExit: () => void; onCapability: (fn: (() => Promise<{ ok: boolean; error?: { code: string } }>) | undefined) => void }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const seatIsBot = seats?.find((s) => s.playerId === me)?.kind === "bot";
  const isHost = Boolean(driver.userId && driver.hostUserId && driver.userId() === driver.hostUserId());
  const online = Boolean(driver.handToBot || driver.abandonGame);
  return (
    <div className="space-y-3">
      {online && !ended && (
        <div className="space-y-2" aria-label="If someone has to leave">
          <p className="text-ink-soft">{HUD_COPY.rail.leave.help}</p>
          {driver.handToBot && !seatIsBot && (
            <Button size="sm" onClick={() => onCapability(() => driver.handToBot!("medium"))} data-testid="hand-to-bot">
              Let a bot play for me
            </Button>
          )}
          {driver.reclaimSeat && seatIsBot && (
            <Button size="sm" variant="primary" onClick={() => onCapability(() => driver.reclaimSeat!())} data-testid="reclaim-seat">
              Take my seat back
            </Button>
          )}
          {driver.abandonGame && isHost && !confirmEnd && (
            <Button size="sm" variant="quiet" onClick={() => setConfirmEnd(true)} data-testid="abandon">
              End game for everyone
            </Button>
          )}
          {confirmEnd && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              End the game with no winner?
              <Button size="sm" variant="primary" onClick={() => onCapability(() => driver.abandonGame!())} data-testid="abandon-confirm">
                End game
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirmEnd(false)}>
                Keep playing
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="space-y-2">
        {!confirmLeave ? (
          <Button size="sm" onClick={() => setConfirmLeave(true)} data-testid="leave">
            Leave the table
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {online ? "Your seat stays; you can come back from the lobby." : "The hotseat game is lost when you leave."}
            <Button size="sm" variant="primary" onClick={onExit} data-testid="leave-confirm">
              Leave
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A "let a bot play for X" control for an absent human (docs/phase5.md §4), used in the banner's extra row. */
export function BotifyButton({ name, onBotify, id }: { name: string; id: string; onBotify: (playerId: string, level: BotLevel) => void }) {
  return (
    <button type="button" className="hud-badge" data-dark="true" onClick={() => onBotify(id, "medium")} data-testid={`botify-${id}`}>
      <Icon name="bot" size={11} /> Let a bot play for {name}
    </button>
  );
}

export type PanelNode = ReactNode;
