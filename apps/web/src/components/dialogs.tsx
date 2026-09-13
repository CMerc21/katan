"use client";

import { useEffect, useState } from "react";
import { COMMODITIES, RESOURCES, isHiddenCount, type Action, type Commodity, type CommodityHand, type Hand, type Resource } from "@katan/engine";
import type { RedactedState, SeatInfo } from "@/driver/types";
import { RESOURCE_LABEL, cardLabel, playerName } from "@/game/labels";
import { COMMODITY_COLOR, PLAYER_FILL, RESOURCE_COLOR } from "@/game/theme";
import { Avatar } from "./Avatar";
import { CardFace } from "./cards";
import { Button, Modal, PlayerTag, ResourceChip, Stepper } from "./ui";

const emptyHand = (): Hand => ({ wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 });
const total = (h: Hand) => RESOURCES.reduce((n, r) => n + h[r], 0);
const emptyCommodities = (): CommodityHand => ({ cloth: 0, coin: 0, paper: 0 });
const goodsTotal = (c: CommodityHand) => COMMODITIES.reduce((n, k) => n + c[k], 0);

// ---------------------------------------------------------------------------

export function HandoffOverlay({ name, onReady }: { name: string; onReady: () => void }) {
  return (
    <div className="hud-dark fixed inset-0 z-50 grid place-items-center bg-[#1a1512] text-[var(--hud-text)]" role="dialog" aria-modal="true" aria-label="Pass the device">
      <div className="text-center">
        <p className="text-lg text-ink-soft">Pass the device to</p>
        <p className="font-display mt-1 text-4xl font-semibold">{name}</p>
        <Button variant="primary" className="mt-8 px-6 py-3 text-lg" onClick={onReady} autoFocus data-testid="handoff-ready">
          I&apos;m {name}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Crown & Castle (docs/rules.md §16.1): commodities count toward the limit and get their own steppers when held. */
export function DiscardDialog({
  hand,
  owed,
  onDiscard,
  commodities,
}: {
  hand: Hand;
  owed: number;
  onDiscard: (cards: Hand, commodities?: CommodityHand) => void;
  commodities?: CommodityHand | undefined;
}) {
  const [chosen, setChosen] = useState<Hand>(emptyHand);
  const [goods, setGoods] = useState<CommodityHand>(emptyCommodities);
  const count = total(chosen) + goodsTotal(goods);
  const withGoods = commodities !== undefined && goodsTotal(commodities) > 0;
  return (
    <Modal title={`Discard ${owed} cards`}>
      <p className="mb-3 text-sm text-ink-soft">You hold more than your limit, so half go back to the bank.</p>
      <div className="space-y-2">
        {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
          <Stepper
            key={r}
            label={RESOURCE_LABEL[r]}
            accent={RESOURCE_COLOR[r]}
            value={chosen[r]}
            min={0}
            max={Math.min(hand[r], chosen[r] + (owed - count))}
            onChange={(n) => setChosen({ ...chosen, [r]: n })}
          />
        ))}
        {withGoods &&
          COMMODITIES.filter((k) => commodities[k] > 0).map((k) => (
            <Stepper key={k} label={cardLabel(k)} accent={COMMODITY_COLOR[k]} value={goods[k]} min={0} max={Math.min(commodities[k], goods[k] + (owed - count))} onChange={(n) => setGoods({ ...goods, [k]: n })} />
          ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm tabular-nums" aria-live="polite">
          {count} of {owed} chosen
        </span>
        <Button variant="primary" disabled={count !== owed} reason="Choose the exact number" onClick={() => (withGoods ? onDiscard(chosen, goods) : onDiscard(chosen))} data-testid="discard-confirm">
          Discard {owed} cards
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function StealPopover({
  view,
  targets,
  onSteal,
}: {
  view: RedactedState;
  targets: string[];
  onSteal: (targetPlayerId: string) => void;
}) {
  return (
    <div className="hud-panel hud-dark z-20 rounded-md p-2" role="group" aria-label="Steal from">
      <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Steal from</p>
      <div className="flex flex-col gap-1">
        {targets.map((id) => {
          const p = view.players.find((x) => x.id === id)!;
          const cards = isHiddenCount(p.hand) ? p.hand.count : total(p.hand);
          return (
            <Button key={id} size="sm" onClick={() => onSteal(id)} data-testid={`steal-${id}`}>
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: PLAYER_FILL[p.color] }} />
              {p.name} · {cards} cards
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Pick resources for invention (two, may repeat) or monopoly (one). */
export function ResourcePicker({
  card,
  legal,
  onPlay,
  onClose,
}: {
  card: "invention" | "monopoly";
  legal: Action[];
  onPlay: (action: Action) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Resource[]>([]);
  const need = card === "invention" ? 2 : 1;
  const title = card === "invention" ? "Invention: take two resources" : "Monopoly: name a resource";

  const action: Action | undefined =
    picked.length === need
      ? card === "monopoly"
        ? legal.find((a) => a.type === "PLAY_MONOPOLY" && a.resource === picked[0])
        : legal.find(
            (a) =>
              a.type === "PLAY_INVENTION" &&
              [...a.resources].sort().join() === [...picked].sort().join(),
          )
      : undefined;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        {RESOURCES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={picked.includes(r) ? "primary" : "secondary"}
            onClick={() => setPicked(picked.length < need ? [...picked, r] : [r])}
          >
            {RESOURCE_LABEL[r]}
            {picked.filter((x) => x === r).length > 1 ? " ×2" : ""}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-soft" aria-live="polite">
        {picked.length === 0 ? `Choose ${need}.` : `Chosen: ${picked.map((r) => RESOURCE_LABEL[r]).join(", ")}`}
        {picked.length === need && !action && " — the bank cannot supply that."}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => setPicked([])}>
          Clear
        </Button>
        <Button variant="primary" disabled={!action} reason="Choose resources the bank holds" onClick={() => action && onPlay(action)}>
          Play card
        </Button>
      </div>
    </Modal>
  );
}

/** Gold field choice (docs/phase9.md §8): the same stepper as invention, for `owed` cards. */
export function GoldDialog({ owed, legal, onChoose }: { owed: number; legal: Action[]; onChoose: (action: Action) => void }) {
  const [picked, setPicked] = useState<Resource[]>([]);
  const choices = legal.filter((a): a is Extract<Action, { type: "CHOOSE_GOLD" }> => a.type === "CHOOSE_GOLD");
  const key = (rs: readonly Resource[]) => [...rs].sort().join();
  const action = picked.length === owed ? choices.find((a) => key(a.resources) === key(picked)) : undefined;
  const available = (r: Resource) => choices.some((a) => a.resources.includes(r));
  return (
    <Modal title={`Gold field: take ${owed} resource${owed === 1 ? "" : "s"}`} onClose={() => undefined}>
      <div className="flex flex-wrap gap-2">
        {RESOURCES.map((r) => (
          <Button key={r} size="sm" variant={picked.includes(r) ? "primary" : "secondary"} disabled={!available(r)} reason="The bank has none" onClick={() => setPicked(picked.length < owed ? [...picked, r] : [r])} data-testid={`gold-${r}`}>
            {RESOURCE_LABEL[r]}
            {picked.filter((x) => x === r).length > 1 ? ` ×${picked.filter((x) => x === r).length}` : ""}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-soft" aria-live="polite">
        {picked.length === 0 ? `Choose ${owed}.` : `Chosen: ${picked.map((r) => RESOURCE_LABEL[r]).join(", ")}`}
        {picked.length === owed && !action && " — the bank cannot supply that."}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => setPicked([])}>
          Clear
        </Button>
        <Button variant="primary" disabled={!action} reason="Choose resources the bank holds" onClick={() => action && onChoose(action)} data-testid="gold-confirm">
          Take
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function TradeDialog({
  view,
  me,
  hand,
  legal,
  onDispatch,
  onClose,
  seats,
  give: giveProp,
  onGive,
}: {
  view: RedactedState;
  me: string;
  hand: Hand;
  legal: Action[];
  onDispatch: (action: Action) => void;
  onClose: () => void;
  seats?: SeatInfo[] | undefined;
  /** Phase 12: the offer's "give" side may be controlled so the resource tray can add to it. */
  give?: Hand | undefined;
  onGive?: ((hand: Hand) => void) | undefined;
}) {
  const [tab, setTab] = useState<"players" | "bank">("players");
  const [giveLocal, setGiveLocal] = useState<Hand>(emptyHand);
  const give = giveProp ?? giveLocal;
  const setGive = onGive ?? setGiveLocal;
  const [receive, setReceive] = useState<Hand>(emptyHand);
  const [bankGive, setBankGive] = useState<Resource | Commodity | null>(null);
  const [bankReceive, setBankReceive] = useState<Resource | Commodity | null>(null);
  // Crown & Castle (docs/rules.md §16.1, §16.4): commodities trade too, and the legal list knows every 2:1 (trade level 3, the merchant, a Merchant Fleet).
  const crown = view.scenario?.crown === true;
  const commodities = view.crown?.players[me]?.commodities ?? emptyCommodities();
  const bankCards: (Resource | Commodity)[] = crown ? [...RESOURCES, ...COMMODITIES] : [...RESOURCES];
  const held = (k: Resource | Commodity): number => (k === "cloth" || k === "coin" || k === "paper" ? commodities[k] : hand[k]);
  const maritime = legal.filter((a): a is Extract<Action, { type: "MARITIME_TRADE" }> => a.type === "MARITIME_TRADE");
  const bestRatio = (k: Resource | Commodity): number => {
    const listed = maritime.filter((a) => a.give === k).map((a) => a.giveCount);
    if (listed.length > 0) return Math.min(...listed);
    return k === "cloth" || k === "coin" || k === "paper" ? 4 : ratios[k];
  };
  const receivable = (k: Resource | Commodity): boolean => bankGive !== null && maritime.some((a) => a.give === bankGive && a.receive === k && a.giveCount === bestRatio(bankGive));
  // Wayfarers, Fishing (docs/rules.md §15.2): the boot's holder may attach it to an offer someone could take.
  const bootOffer = view.wayfarers?.fishing?.boot === me && legal.some((a) => a.type === "OFFER_TRADE" && a.boot === true);
  const [boot, setBoot] = useState(false);

  const ratios = ratiosFor(view, me);
  const offerOk = total(give) > 0 && total(receive) > 0 && !RESOURCES.some((r) => give[r] > 0 && receive[r] > 0);
  const bankAction = bankGive && bankReceive ? maritime.find((a) => a.give === bankGive && a.receive === bankReceive && a.giveCount === bestRatio(bankGive)) : undefined;

  return (
    <TradePanel title="Trade" onClose={onClose}>
      <div className="mb-3 flex gap-1 border-b border-line" role="tablist">
        {(["players", "bank"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${tab === t ? "border-ink" : "border-transparent text-ink-soft"}`}
            onClick={() => setTab(t)}
          >
            {t === "players" ? "Players" : "Bank"}
          </button>
        ))}
      </div>

      {tab === "players" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">You give</h3>
              <div className="space-y-1.5">
                {RESOURCES.map((r) => (
                  <Stepper key={r} label={RESOURCE_LABEL[r]} accent={RESOURCE_COLOR[r]} value={give[r]} min={0} max={hand[r]} onChange={(n) => setGive({ ...give, [r]: n })} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">You get</h3>
              <div className="space-y-1.5">
                {RESOURCES.map((r) => (
                  <Stepper key={r} label={RESOURCE_LABEL[r]} accent={RESOURCE_COLOR[r]} value={receive[r]} min={0} max={19} onChange={(n) => setReceive({ ...receive, [r]: n })} />
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <span className="flex -space-x-2">
              {view.players
                .filter((p) => p.id !== me)
                .map((p) => (
                  <Avatar key={p.id} spec={seats?.find((s) => s.playerId === p.id)?.avatar} color={p.color} name={p.name} size={24} />
                ))}
            </span>
            The offer goes to every other player in turn; the first to accept trades with you.
          </p>
          <div className="mt-3 flex items-center justify-end gap-4">
            {bootOffer && (
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={boot} onChange={(e) => setBoot(e.target.checked)} data-testid="offer-boot" />
                Pass the old boot along
              </label>
            )}
            <Button
              variant="primary"
              disabled={!offerOk}
              reason="Give and get at least one card each, with no resource on both sides"
              onClick={() => onDispatch({ type: "OFFER_TRADE", playerId: me, give, receive, ...(bootOffer && boot ? { boot: true } : {}) })}
              data-testid="offer-trade"
            >
              Offer trade
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 className="mb-2 text-sm font-semibold">You give</h3>
          <div className="flex flex-wrap gap-2">
            {bankCards.map((k) => (
              <Button
                key={k}
                size="sm"
                variant={bankGive === k ? "primary" : "secondary"}
                disabled={held(k) < bestRatio(k)}
                reason={`Needs ${bestRatio(k)} ${cardLabel(k).toLowerCase()}`}
                className="flex items-center gap-1"
                onClick={() => {
                  setBankGive(k);
                  setBankReceive(null);
                }}
                data-testid={`bank-give-${k}`}
              >
                {crown && <CardFace card={k} size={16} />}
                {bestRatio(k)}:1 {cardLabel(k)}
              </Button>
            ))}
          </div>
          <h3 className="mb-2 mt-4 text-sm font-semibold">You get</h3>
          <div className="flex flex-wrap gap-2">
            {bankCards.map((k) => {
              const stock = k === "cloth" || k === "coin" || k === "paper" ? (view.crown?.bank[k] ?? 0) : view.bank[k];
              const ok = crown ? receivable(k) : k !== bankGive && stock >= 1;
              return (
                <Button
                  key={k}
                  size="sm"
                  variant={bankReceive === k ? "primary" : "secondary"}
                  disabled={!ok}
                  reason={stock < 1 ? "The bank is out" : bankGive === null ? "Choose what to give first" : "Choose a different card"}
                  className="flex items-center gap-1"
                  onClick={() => setBankReceive(k)}
                  data-testid={`bank-receive-${k}`}
                >
                  {crown && <CardFace card={k} size={16} />}
                  {cardLabel(k)}
                </Button>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" disabled={!bankAction} reason="Choose what to give and get" onClick={() => bankAction && onDispatch(bankAction)} data-testid="bank-trade">
              {bankGive && bankReceive ? `Trade ${bestRatio(bankGive)} ${cardLabel(bankGive).toLowerCase()} for 1 ${cardLabel(bankReceive).toLowerCase()}` : "Trade with the bank"}
            </Button>
          </div>
        </>
      )}
    </TradePanel>
  );
}

/** The trade UI as a dark panel above the tray (docs/phase12.md §5): the board and the tray stay clickable. */
function TradePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-label={title} className="hud-panel hud-dark fixed bottom-[124px] left-1/2 z-30 w-full max-w-xl -translate-x-1/2 rounded-lg p-4" data-testid="trade-dialog">
      <div className="ink-rule mb-3 flex items-start justify-between gap-4 pb-2">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <Button variant="quiet" size="sm" aria-label="Close" onClick={onClose}>
          ✕
        </Button>
      </div>
      <p className="mb-2 text-xs text-ink-soft">Tip: click a card in your tray to add it to the offer.</p>
      {children}
    </div>
  );
}

/** Best maritime ratio per resource, from the harbors this player's buildings touch (§9.2). */
export function ratiosFor(view: RedactedState, playerId: string): Record<Resource, 4 | 3 | 2> {
  const p = view.players.find((x) => x.id === playerId);
  const mine = new Set([...(p?.settlements ?? []), ...(p?.cities ?? [])]);
  const kinds = new Set(view.board.ports.filter((port) => port.vertices.some((v) => mine.has(v))).map((port) => port.kind));
  const out = {} as Record<Resource, 4 | 3 | 2>;
  for (const r of RESOURCES) out[r] = kinds.has(r) ? 2 : kinds.has("any") ? 3 : 4;
  return out;
}

// ---------------------------------------------------------------------------

/** Shown to an opponent while an offer is open (hotseat cycles through them). */
export function TradeResponse({
  view,
  me,
  legal,
  onDispatch,
}: {
  view: RedactedState;
  me: string;
  legal: Action[];
  onDispatch: (action: Action) => void;
}) {
  const trade = view.pendingTrade;
  // Wayfarers, Fishing (docs/rules.md §15.2): the boot may ride along with the acceptance.
  const bootAccept = legal.some((a) => a.type === "ACCEPT_TRADE" && a.boot === true);
  const [boot, setBoot] = useState(false);
  if (!trade) return null;
  const from = view.players.find((p) => p.id === trade.from)!;
  const canAccept = legal.some((a) => a.type === "ACCEPT_TRADE");
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="trade-response">
      <PlayerTag name={from.name} color={from.color} />
      <span className="text-sm">offers</span>
      <HandInline hand={trade.give} />
      <span className="text-sm">for your</span>
      <HandInline hand={trade.receive} />
      {trade.boot && <span className="rounded bg-ink px-1 text-xs text-parchment" data-testid="trade-boot">with the old boot</span>}
      <div className="ml-auto flex items-center gap-2">
        {bootAccept && (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={boot} onChange={(e) => setBoot(e.target.checked)} data-testid="accept-boot" />
            Pass the old boot
          </label>
        )}
        <Button variant="primary" disabled={!canAccept} reason="You do not hold those cards" onClick={() => onDispatch({ type: "ACCEPT_TRADE", playerId: me, ...(bootAccept && boot ? { boot: true } : {}) })}>
          Accept
        </Button>
        <Button onClick={() => onDispatch({ type: "REJECT_TRADE", playerId: me })}>Decline</Button>
      </div>
    </div>
  );
}

export function HandInline({ hand }: { hand: Hand }) {
  return (
    <span className="inline-flex gap-1">
      {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
        <ResourceChip key={r} resource={r} count={hand[r]} compact />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function EndedOverlay({ view, onPlayAgain, seats }: { view: RedactedState; onPlayAgain: () => void; seats?: SeatInfo[] | undefined }) {
  const winner = view.winner ? playerName(view, view.winner) : "Nobody";
  const winnerPlayer = view.players.find((p) => p.id === view.winner);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Game over">
      <div className="hud-panel hud-dark w-full max-w-md rounded-lg p-6">
        <p className="text-sm uppercase tracking-wide text-ink-soft">Game over</p>
        <div className="mt-1 flex items-center gap-3">
          {winnerPlayer && <Avatar spec={seats?.find((s) => s.playerId === winnerPlayer.id)?.avatar} color={winnerPlayer.color} name={winnerPlayer.name} size={72} className="piece-pop" />}
          <h2 className="font-display text-3xl font-semibold" data-testid="winner">
            {winner} wins
          </h2>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="py-1 font-medium">Player</th>
              <th className="py-1 text-right font-medium">Buildings and badges</th>
              <th className="py-1 text-right font-medium">VP cards</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {view.players.map((p) => (
              <tr key={p.id} className={p.id === view.winner ? "font-semibold" : ""}>
                <td className="py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar spec={seats?.find((s) => s.playerId === p.id)?.avatar} color={p.color} name={p.name} size={22} />
                    <PlayerTag name={p.name} color={p.color} />
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">{p.publicVP}</td>
                <td className="py-1 text-right tabular-nums">{p.privateVP ?? "?"}</td>
                <td className="py-1 text-right tabular-nums">{p.publicVP + (p.privateVP ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onPlayAgain} autoFocus>
            Play again
          </Button>
        </div>
      </div>
    </div>
  );
}
