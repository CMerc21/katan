/**
 * Game events (docs/phase7.md §1): the structured, ordered record of what
 * each action did. `applyActionWithEvents` returns them next to the new
 * state; the human-readable `state.log` is derived from them by
 * `describeEvent`, and `redactEvents` hides what a viewer may not see.
 *
 * Phase 10 (docs/phase10.md) and Phase 11 (docs/phase11.md) events are
 * listed after the base ones; every kind has a public sentence or null.
 */

import type { DevCardType } from "./types";
import type { Resource } from "./board";
import type { EdgeId, HexId, VertexId } from "./geometry";
import type { Hand, PlayerId } from "./types";
import type { Commodity, CommodityHand, EventCardKind, EventDie, FishOption, KnightLevel, ProgressCard, Track, WagonGood } from "./modules/types";

export type SpecialCard = "longestRoad" | "largestArmy";

/** Chips awarded by the Wayfarers variants (docs/phase10.md §3–§4). */
export type VariantChip = "bridgeBuilder" | "poorSettler" | "harbormaster";

export type EventBody =
  | { kind: "turnStarted"; playerId: PlayerId; turn: number }
  /** `card` is set when the event deck replaced the dice (docs/phase10.md §1); `red`/`event` under Crown & Castle (docs/phase11.md §2). */
  | { kind: "diceRolled"; playerId: PlayerId; dice: [number, number]; card?: { total: number; event: EventCardKind | null }; red?: number; event?: EventDie }
  | { kind: "produced"; gains: { playerId: PlayerId; hex: HexId; resource: Resource; count: number }[] }
  | { kind: "productionBlocked"; hex: HexId }
  | { kind: "bankShort"; resource: Resource; playerId: PlayerId | null; count: number }
  /** `cards` is null for everyone but the discarding player. */
  | { kind: "discarded"; playerId: PlayerId; count: number; cards: Hand | null; commodities?: CommodityHand | null }
  | { kind: "robberMoved"; from: HexId; to: HexId; by: PlayerId }
  /** `resource` is null for third parties; a commodity name under Crown & Castle. */
  | { kind: "stole"; from: PlayerId; to: PlayerId; resource: Resource | Commodity | null }
  | { kind: "built"; playerId: PlayerId; piece: "road" | "settlement" | "city"; at: EdgeId | VertexId }
  /** §5.6: the last paid build of the turn was taken back and its cost refunded. */
  | { kind: "buildUndone"; playerId: PlayerId; piece: "road" | "settlement" | "city"; at: EdgeId | VertexId; cost: Hand }
  /** `card` is null for everyone but the buyer. */
  | { kind: "devCardBought"; playerId: PlayerId; card: DevCardType | null }
  | { kind: "devCardPlayed"; playerId: PlayerId; card: DevCardType }
  | { kind: "inventionTaken"; playerId: PlayerId; resources: [Resource, Resource] }
  | { kind: "monopolised"; playerId: PlayerId; resource: Resource; taken: Record<PlayerId, number> }
  | { kind: "tradeOffered"; playerId: PlayerId; give: Hand; receive: Hand }
  | { kind: "tradeAccepted"; from: PlayerId; to: PlayerId; give: Hand; receive: Hand }
  | { kind: "tradeDeclined"; playerId: PlayerId; from: PlayerId }
  /** §9.1: `playerId` countered `from`'s offer, giving `give` for `receive`. */
  | { kind: "tradeCountered"; playerId: PlayerId; from: PlayerId; give: Hand; receive: Hand }
  | { kind: "tradeCancelled"; playerId: PlayerId; reason: "withdrawn" | "unpayable" | "turnEnded" | "everyoneDeclined" }
  | { kind: "maritimeTrade"; playerId: PlayerId; give: Resource | Commodity; count: number; receive: Resource | Commodity }
  | { kind: "specialCardMoved"; card: SpecialCard; from: PlayerId | null; to: PlayerId | null }
  | { kind: "turnEnded"; playerId: PlayerId }
  /** docs/phase8.md §5: the named player may build before the next roll. */
  | { kind: "specialBuildTurn"; playerId: PlayerId }
  | { kind: "setupCompleted" }
  | { kind: "gameEnded"; winner: PlayerId; scores: Record<PlayerId, number> }
  /** Tides (docs/phase9.md §6). */
  | { kind: "shipBuilt"; playerId: PlayerId; at: EdgeId }
  | { kind: "shipMoved"; playerId: PlayerId; from: EdgeId; to: EdgeId }
  | { kind: "pirateMoved"; from: HexId | null; to: HexId; by: PlayerId }
  | { kind: "goldChosen"; playerId: PlayerId; resources: Resource[] }
  | { kind: "islandSettled"; playerId: PlayerId; island: number; bonus: number }
  /** Free text from outside the rules (a seat handed to a bot, the host ending the game). */
  | { kind: "note"; playerId: PlayerId | null; text: string }
  // --- Wayfarers (docs/phase10.md) -------------------------------------------
  /** The event deck was rebuilt after the reshuffle card. */
  | { kind: "deckReshuffled" }
  /** Neighborly help: `resource` is null for third parties (and when nothing was given, `gave` is false). */
  | { kind: "neighborlyGave"; from: PlayerId; to: PlayerId; gave: boolean; resource: Resource | null }
  /** Tax collector: one card to the bank per player with 8+ cards (`resource` hidden from third parties). */
  | { kind: "taxCollected"; playerId: PlayerId; resource: Resource | null }
  | { kind: "fishDrawn"; playerId: PlayerId; fish: number; boot: boolean; source: HexId | EdgeId }
  | { kind: "fishSpent"; playerId: PlayerId; fish: number; option: FishOption }
  | { kind: "bootPassed"; from: PlayerId; to: PlayerId }
  | { kind: "bridgeBuilt"; playerId: PlayerId; edge: EdgeId }
  | { kind: "coinsAwarded"; playerId: PlayerId; coins: number; total: number }
  | { kind: "chipMoved"; chip: VariantChip; from: PlayerId | null; to: PlayerId | null }
  | { kind: "castleBuilt"; playerId: PlayerId; vertex: VertexId }
  | { kind: "raidersAdvanced"; steps: number; counter: number }
  | { kind: "guardPlaced"; playerId: PlayerId; hex: HexId }
  | { kind: "raid"; raided: HexId[]; defended: HexId[]; guardsLost: { playerId: PlayerId; hex: HexId }[] }
  | { kind: "hexRebuilt"; playerId: PlayerId; hex: HexId }
  | { kind: "spiceProduced"; gains: { playerId: PlayerId; hex: HexId; count: number }[] }
  | { kind: "caravanExtended"; playerId: PlayerId; caravan: number; edge: EdgeId }
  | { kind: "wagonMoved"; playerId: PlayerId; path: VertexId[]; grain: number; toll: PlayerId | null }
  | { kind: "goodLoaded"; playerId: PlayerId; vertex: VertexId; good: WagonGood }
  | { kind: "delivered"; playerId: PlayerId; vertex: VertexId; good: WagonGood; points: number }
  | { kind: "goodsStocked"; stocked: { vertex: VertexId; good: WagonGood }[] }
  // --- Crown & Castle (docs/phase11.md) ----------------------------------------
  | { kind: "commoditiesProduced"; gains: { playerId: PlayerId; hex: HexId; commodity: Commodity; count: number }[] }
  /** `card` is null for everyone but the drawer (VP cards are public). */
  | { kind: "progressDrawn"; playerId: PlayerId; track: Track; card: ProgressCard | null }
  | { kind: "progressPlayed"; playerId: PlayerId; card: ProgressCard }
  /** `card` is null for third parties. */
  | { kind: "progressDiscarded"; playerId: PlayerId; card: ProgressCard | null }
  | { kind: "improvementBuilt"; playerId: PlayerId; track: Track; level: number }
  | { kind: "metropolisPlaced"; playerId: PlayerId; track: Track; vertex: VertexId; from: PlayerId | null }
  | { kind: "knightBuilt"; playerId: PlayerId; vertex: VertexId }
  | { kind: "knightActivated"; playerId: PlayerId; vertex: VertexId; free: boolean }
  | { kind: "knightPromoted"; playerId: PlayerId; vertex: VertexId; level: KnightLevel }
  | { kind: "knightMoved"; playerId: PlayerId; from: VertexId; to: VertexId }
  | { kind: "knightDisplaced"; playerId: PlayerId; from: VertexId; to: VertexId; victim: PlayerId }
  | { kind: "knightRetreated"; playerId: PlayerId; from: VertexId; to: VertexId | null }
  | { kind: "knightRemoved"; playerId: PlayerId; vertex: VertexId; reason: "deserter" | "intrigue" | "raid" | "noRetreat" }
  | { kind: "knightsDeactivated" }
  | { kind: "robberChased"; playerId: PlayerId; vertex: VertexId }
  | { kind: "wallBuilt"; playerId: PlayerId; vertex: VertexId; free: boolean }
  | { kind: "fleetAdvanced"; position: number }
  | { kind: "fleetAttacked"; strength: number; defense: number; result: "defended" | "raided"; defenders: PlayerId[]; losers: PlayerId[] }
  /** `removed`: the owner had no settlement piece left, so the city left the board (§16.6). */
  | { kind: "cityDowngraded"; playerId: PlayerId; vertex: VertexId; removed: boolean }
  | { kind: "defenderAwarded"; playerId: PlayerId; chip: boolean }
  | { kind: "merchantPlaced"; playerId: PlayerId; hex: HexId; from: PlayerId | null }
  /** A hidden transfer of `count` cards (Master Merchant, Wedding, Spy; contents are private). */
  | { kind: "cardsTaken"; from: PlayerId; to: PlayerId; count: number; what: "cards" | "progress" }
  | { kind: "commodityMonopolised"; playerId: PlayerId; commodity: Commodity; taken: Record<PlayerId, number> }
  | { kind: "resourceMonopolised"; playerId: PlayerId; resource: Resource; taken: Record<PlayerId, number> }
  | { kind: "tokensSwapped"; playerId: PlayerId; a: HexId; b: HexId }
  | { kind: "roadRemoved"; playerId: PlayerId; owner: PlayerId; edge: EdgeId; relocatedTo: EdgeId | null }
  | { kind: "alchemistSet"; playerId: PlayerId }
  | { kind: "commercialSwap"; by: PlayerId; with: PlayerId; resource: Resource; commodity: Commodity }
  | { kind: "resourcesTaken"; playerId: PlayerId; cards: Hand; reason: "irrigation" | "mining" | "scienceAid" | "bounty" | "harvest" | "fish" };

export type GameEvent = { readonly seq: number } & EventBody;
export type GameEventKind = GameEvent["kind"];

/** The player an event is "about" for the log feed, or null. */
export function eventPlayer(event: GameEvent): PlayerId | null {
  switch (event.kind) {
    case "turnStarted":
    case "diceRolled":
    case "discarded":
    case "built":
    case "buildUndone":
    case "devCardBought":
    case "devCardPlayed":
    case "inventionTaken":
    case "monopolised":
    case "tradeOffered":
    case "tradeDeclined":
    case "tradeCountered":
    case "tradeCancelled":
    case "maritimeTrade":
    case "turnEnded":
    case "specialBuildTurn":
    case "shipBuilt":
    case "shipMoved":
    case "goldChosen":
    case "islandSettled":
    case "taxCollected":
    case "fishDrawn":
    case "fishSpent":
    case "bridgeBuilt":
    case "coinsAwarded":
    case "castleBuilt":
    case "guardPlaced":
    case "hexRebuilt":
    case "caravanExtended":
    case "wagonMoved":
    case "goodLoaded":
    case "delivered":
    case "progressDrawn":
    case "progressPlayed":
    case "progressDiscarded":
    case "improvementBuilt":
    case "metropolisPlaced":
    case "knightBuilt":
    case "knightActivated":
    case "knightPromoted":
    case "knightMoved":
    case "knightDisplaced":
    case "knightRetreated":
    case "knightRemoved":
    case "robberChased":
    case "wallBuilt":
    case "cityDowngraded":
    case "defenderAwarded":
    case "merchantPlaced":
    case "commodityMonopolised":
    case "resourceMonopolised":
    case "tokensSwapped":
    case "roadRemoved":
    case "alchemistSet":
    case "resourcesTaken":
      return event.playerId;
    case "robberMoved":
    case "pirateMoved":
      return event.by;
    case "stole":
    case "tradeAccepted":
    case "neighborlyGave":
    case "bootPassed":
    case "cardsTaken":
      return event.to;
    case "specialCardMoved":
    case "chipMoved":
      return event.to;
    case "commercialSwap":
      return event.by;
    case "gameEnded":
      return event.winner;
    case "bankShort":
    case "note":
      return event.playerId;
    case "produced":
    case "productionBlocked":
    case "setupCompleted":
    case "deckReshuffled":
    case "raidersAdvanced":
    case "raid":
    case "spiceProduced":
    case "goodsStocked":
    case "commoditiesProduced":
    case "knightsDeactivated":
    case "fleetAdvanced":
    case "fleetAttacked":
      return null;
    default: {
      const exhaustive: never = event;
      throw new Error(`unknown event ${JSON.stringify(exhaustive)}`);
    }
  }
}

const RESOURCE_KEYS: readonly Resource[] = ["wood", "clay", "wool", "grain", "ore"];

function handText(h: Hand): string {
  const parts: string[] = [];
  for (const r of RESOURCE_KEYS) if (h[r] > 0) parts.push(`${h[r]} ${r}`);
  return parts.length ? parts.join(", ") : "nothing";
}

const EVENT_CARD_TEXT: Record<EventCardKind, string> = {
  plentifulHarvest: "Plentiful harvest: everyone takes a resource of their choice",
  robbersRest: "Robber's rest: the robber stays put",
  neighborlyHelp: "Neighborly help: everyone may give a card to the poorest player",
  taxCollector: "Tax collector: every player with 8 or more cards pays one to the bank",
  bounty: "Bounty: the current player takes a resource from the bank",
};

const CHIP_TEXT: Record<VariantChip, string> = { bridgeBuilder: "Bridge Builder", poorSettler: "the Poor Settler", harbormaster: "Harbormaster" };
const TRACK_TEXT: Record<Track, string> = { trade: "trade", politics: "politics", science: "science" };
const FISH_TEXT: Record<FishOption, string> = { moveRobber: "to move the robber", steal: "to steal a card", bankResource: "for a resource from the bank", freeRoad: "for a free road", freeDevCard: "for a free development card" };
export const PROGRESS_CARD_NAME: Record<ProgressCard, string> = {
  merchant: "Merchant",
  tradeMonopoly: "Trade Monopoly",
  resourceMonopoly: "Resource Monopoly",
  masterMerchant: "Master Merchant",
  merchantFleet: "Merchant Fleet",
  commercialHarbor: "Commercial Harbor",
  bishop: "Bishop",
  constitution: "Constitution",
  deserter: "Deserter",
  diplomat: "Diplomat",
  intrigue: "Intrigue",
  saboteur: "Saboteur",
  spy: "Spy",
  warlord: "Warlord",
  wedding: "Wedding",
  alchemist: "Alchemist",
  crane: "Crane",
  engineer: "Engineer",
  inventor: "Inventor",
  irrigation: "Irrigation",
  medicine: "Medicine",
  mining: "Mining",
  printer: "Printer",
  roadBuilding: "Road Building",
  smith: "Smith",
};

/**
 * One public sentence per event, or null when the event needs no log line.
 * Only public information is ever described: a stolen card is "a card"
 * even when the event carries the resource, so the same text is safe in
 * every player's log.
 */
export function describeEvent(event: GameEvent, nameOf: (id: PlayerId) => string): string | null {
  switch (event.kind) {
    case "turnStarted":
    case "turnEnded":
    case "productionBlocked":
      return null;
    case "specialBuildTurn":
      return `${nameOf(event.playerId)} may build (special build phase)`;
    case "diceRolled": {
      const base = event.card
        ? `${nameOf(event.playerId)} drew ${event.card.total}${event.card.event ? ` — ${EVENT_CARD_TEXT[event.card.event]}` : ""}`
        : `${nameOf(event.playerId)} rolled ${event.dice[0]} + ${event.dice[1]} = ${event.dice[0] + event.dice[1]}`;
      return event.event ? `${base} (event die: ${event.event})` : base;
    }
    case "produced": {
      const byPlayer = new Map<PlayerId, Hand>();
      for (const g of event.gains) {
        const h = byPlayer.get(g.playerId) ?? { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
        h[g.resource] += g.count;
        byPlayer.set(g.playerId, h);
      }
      if (byPlayer.size === 0) return null;
      return [...byPlayer].map(([id, h]) => `${nameOf(id)} +${handText(h)}`).join("; ");
    }
    case "bankShort":
      return event.playerId === null
        ? `bank ran short of ${event.resource}; nobody received any`
        : `bank ran short of ${event.resource}; ${nameOf(event.playerId)} received ${event.count}`;
    case "discarded":
      return `${nameOf(event.playerId)} discarded ${event.count} cards`;
    case "robberMoved":
      return `${nameOf(event.by)} moved the robber`;
    case "stole":
      return `${nameOf(event.to)} stole a card from ${nameOf(event.from)}`;
    case "built":
      return event.piece === "city"
        ? `${nameOf(event.playerId)} upgraded a settlement to a city`
        : `${nameOf(event.playerId)} built a ${event.piece}`;
    case "buildUndone":
      return event.piece === "city" ? `${nameOf(event.playerId)} took back the city upgrade` : `${nameOf(event.playerId)} took back the ${event.piece}`;
    case "devCardBought":
      return `${nameOf(event.playerId)} bought a development card`;
    case "devCardPlayed":
      return event.card === "knight"
        ? `${nameOf(event.playerId)} played a knight`
        : event.card === "roadBuilding"
          ? `${nameOf(event.playerId)} played road building`
          : null; // invention and monopoly describe their effect instead
    case "inventionTaken":
      return `${nameOf(event.playerId)} played invention for ${event.resources[0]} and ${event.resources[1]}`;
    case "monopolised": {
      const taken = Object.values(event.taken).reduce((n, x) => n + x, 0);
      return `${nameOf(event.playerId)} played monopoly on ${event.resource} and took ${taken}`;
    }
    case "tradeOffered":
      return `${nameOf(event.playerId)} offered a trade`;
    case "tradeAccepted":
      return `${nameOf(event.to)} accepted ${nameOf(event.from)}'s trade`;
    case "tradeDeclined":
      return `${nameOf(event.playerId)} declined the trade`;
    case "tradeCountered":
      return `${nameOf(event.playerId)} countered ${nameOf(event.from)}'s offer`;
    case "tradeCancelled":
      switch (event.reason) {
        case "withdrawn":
          return `${nameOf(event.playerId)} withdrew the trade`;
        case "unpayable":
          return "trade offer withdrawn: offerer can no longer pay";
        case "turnEnded":
        case "everyoneDeclined":
          return null;
        default:
          return null;
      }
    case "maritimeTrade":
      return `${nameOf(event.playerId)} traded ${event.count} ${event.give} for 1 ${event.receive}`;
    case "specialCardMoved": {
      const card = event.card === "longestRoad" ? "Longest Road" : "Largest Army";
      if (event.to === null) return `${card} is unclaimed`;
      return event.from === null ? `${nameOf(event.to)} takes ${card}` : `${nameOf(event.to)} takes ${card} from ${nameOf(event.from)}`;
    }
    case "setupCompleted":
      return "setup complete";
    case "gameEnded":
      return `${nameOf(event.winner)} wins`;
    case "shipBuilt":
      return `${nameOf(event.playerId)} built a ship`;
    case "shipMoved":
      return `${nameOf(event.playerId)} moved a ship`;
    case "pirateMoved":
      return `${nameOf(event.by)} moved the pirate`;
    case "goldChosen": {
      const h: Hand = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
      for (const r of event.resources) h[r] += 1;
      return `${nameOf(event.playerId)} took ${handText(h)} from the gold field`;
    }
    case "islandSettled":
      return `${nameOf(event.playerId)} settled a new island (+${event.bonus})`;
    case "note":
      return event.text;
    // Wayfarers
    case "deckReshuffled":
      return "the event deck was reshuffled";
    case "neighborlyGave":
      return event.gave ? `${nameOf(event.from)} gave a card to ${nameOf(event.to)}` : `${nameOf(event.from)} gave nothing`;
    case "taxCollected":
      return `${nameOf(event.playerId)} paid a card to the tax collector`;
    case "fishDrawn":
      return event.boot ? `${nameOf(event.playerId)} hauled up the old boot` : `${nameOf(event.playerId)} caught ${event.fish} fish`;
    case "fishSpent":
      return `${nameOf(event.playerId)} spent ${event.fish} fish ${FISH_TEXT[event.option]}`;
    case "bootPassed":
      return `${nameOf(event.from)} passed the old boot to ${nameOf(event.to)}`;
    case "bridgeBuilt":
      return `${nameOf(event.playerId)} built a bridge`;
    case "coinsAwarded":
      return `${nameOf(event.playerId)} earned ${event.coins} gold coin${event.coins === 1 ? "" : "s"} (${event.total})`;
    case "chipMoved": {
      const chip = CHIP_TEXT[event.chip];
      if (event.to === null) return event.from === null ? null : `${chip} is unclaimed`;
      return event.from === null ? `${nameOf(event.to)} takes ${chip}` : `${nameOf(event.to)} takes ${chip} from ${nameOf(event.from)}`;
    }
    case "castleBuilt":
      return `${nameOf(event.playerId)} raised a castle`;
    case "raidersAdvanced":
      return `the raiders advance ${event.steps} (${event.counter})`;
    case "guardPlaced":
      return `${nameOf(event.playerId)} posted a guard`;
    case "raid":
      return event.raided.length === 0 ? "the raiders landed and were driven off" : `the raiders landed and ravaged ${event.raided.length} hex${event.raided.length === 1 ? "" : "es"}`;
    case "hexRebuilt":
      return `${nameOf(event.playerId)} rebuilt a raided hex (+1)`;
    case "spiceProduced": {
      const byPlayer = new Map<PlayerId, number>();
      for (const g of event.gains) byPlayer.set(g.playerId, (byPlayer.get(g.playerId) ?? 0) + g.count);
      if (byPlayer.size === 0) return null;
      return [...byPlayer].map(([id, n]) => `${nameOf(id)} +${n} spice`).join("; ");
    }
    case "caravanExtended":
      return `${nameOf(event.playerId)} led caravan ${event.caravan + 1} onward`;
    case "wagonMoved":
      return `${nameOf(event.playerId)} moved their wagon ${event.path.length - 1} step${event.path.length === 2 ? "" : "s"}${event.toll ? ` (paid a toll to ${nameOf(event.toll)})` : ""}`;
    case "goodLoaded":
      return `${nameOf(event.playerId)} loaded ${event.good}`;
    case "delivered":
      return `${nameOf(event.playerId)} delivered ${event.good} (+${event.points})`;
    case "goodsStocked":
      return null;
    // Crown & Castle
    case "commoditiesProduced": {
      const byPlayer = new Map<PlayerId, string[]>();
      for (const g of event.gains) {
        const list = byPlayer.get(g.playerId) ?? [];
        list.push(`${g.count} ${g.commodity}`);
        byPlayer.set(g.playerId, list);
      }
      if (byPlayer.size === 0) return null;
      return [...byPlayer].map(([id, parts]) => `${nameOf(id)} +${parts.join(", ")}`).join("; ");
    }
    case "progressDrawn":
      return `${nameOf(event.playerId)} drew a ${TRACK_TEXT[event.track]} progress card`;
    case "progressPlayed":
      return `${nameOf(event.playerId)} played ${PROGRESS_CARD_NAME[event.card]}`;
    case "progressDiscarded":
      return `${nameOf(event.playerId)} discarded a progress card`;
    case "improvementBuilt":
      return `${nameOf(event.playerId)} improved ${TRACK_TEXT[event.track]} to level ${event.level}`;
    case "metropolisPlaced":
      return event.from === null ? `${nameOf(event.playerId)} founded the ${TRACK_TEXT[event.track]} metropolis` : `${nameOf(event.playerId)} took the ${TRACK_TEXT[event.track]} metropolis from ${nameOf(event.from)}`;
    case "knightBuilt":
      return `${nameOf(event.playerId)} hired a knight`;
    case "knightActivated":
      return `${nameOf(event.playerId)} activated a knight`;
    case "knightPromoted":
      return `${nameOf(event.playerId)} promoted a knight to level ${event.level}`;
    case "knightMoved":
      return `${nameOf(event.playerId)} moved a knight`;
    case "knightDisplaced":
      return `${nameOf(event.playerId)} drove off ${nameOf(event.victim)}'s knight`;
    case "knightRetreated":
      return event.to === null ? `${nameOf(event.playerId)}'s knight had nowhere to go` : `${nameOf(event.playerId)}'s knight retreated`;
    case "knightRemoved":
      return `${nameOf(event.playerId)} lost a knight`;
    case "knightsDeactivated":
      return "every knight stands down";
    case "robberChased":
      return `${nameOf(event.playerId)}'s knight chased the robber away`;
    case "wallBuilt":
      return `${nameOf(event.playerId)} walled a city`;
    case "fleetAdvanced":
      return `the barbarian fleet advances (${event.position}/7)`;
    case "fleetAttacked":
      return event.result === "defended"
        ? `the barbarians attacked (${event.strength} vs ${event.defense}) and were repelled`
        : `the barbarians attacked (${event.strength} vs ${event.defense}) and sacked the realm`;
    case "cityDowngraded":
      return event.removed ? `${nameOf(event.playerId)}'s city was razed (no settlement piece left)` : `${nameOf(event.playerId)}'s city was reduced to a settlement`;
    case "defenderAwarded":
      return event.chip ? `${nameOf(event.playerId)} is Defender of the Realm (+1)` : `${nameOf(event.playerId)} was honoured with a progress card`;
    case "merchantPlaced":
      return `${nameOf(event.playerId)} placed the merchant`;
    case "cardsTaken":
      return `${nameOf(event.to)} took ${event.count} ${event.what === "progress" ? "progress card" : "card"}${event.count === 1 ? "" : "s"} from ${nameOf(event.from)}`;
    case "commodityMonopolised": {
      const taken = Object.values(event.taken).reduce((n, x) => n + x, 0);
      return `${nameOf(event.playerId)} claimed every ${event.commodity} and took ${taken}`;
    }
    case "resourceMonopolised": {
      const taken = Object.values(event.taken).reduce((n, x) => n + x, 0);
      return `${nameOf(event.playerId)} claimed ${event.resource} and took ${taken}`;
    }
    case "tokensSwapped":
      return `${nameOf(event.playerId)} swapped two number tokens`;
    case "roadRemoved":
      return event.relocatedTo ? `${nameOf(event.playerId)} moved a road` : `${nameOf(event.playerId)} removed ${nameOf(event.owner)}'s road`;
    case "alchemistSet":
      return `${nameOf(event.playerId)} chose the next roll`;
    case "commercialSwap":
      return `${nameOf(event.with)} swapped a commodity for ${nameOf(event.by)}'s ${event.resource}`;
    case "resourcesTaken":
      return `${nameOf(event.playerId)} took ${handText(event.cards)} from the bank`;
    default: {
      const exhaustive: never = event;
      throw new Error(`unknown event ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Hide discard contents, stolen resources, bought and drawn cards from third parties. */
export function redactEvents(events: readonly GameEvent[], viewer: PlayerId): GameEvent[] {
  return events.map((e) => {
    switch (e.kind) {
      case "discarded":
        return e.playerId === viewer ? e : { ...e, cards: null, commodities: null };
      case "stole":
        return e.from === viewer || e.to === viewer ? e : { ...e, resource: null };
      case "devCardBought":
        return e.playerId === viewer ? e : { ...e, card: null };
      case "neighborlyGave":
        return e.from === viewer || e.to === viewer ? e : { ...e, resource: null };
      case "taxCollected":
        return e.playerId === viewer ? e : { ...e, resource: null };
      case "progressDrawn":
        return e.playerId === viewer || (e.card !== null && (e.card === "constitution" || e.card === "printer")) ? e : { ...e, card: null };
      case "progressDiscarded":
        return e.playerId === viewer ? e : { ...e, card: null };
      default:
        return e;
    }
  });
}
