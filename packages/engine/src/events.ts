/**
 * Game events (docs/phase7.md §1): the structured, ordered record of what
 * each action did. `applyActionWithEvents` returns them next to the new
 * state; the human-readable `state.log` is derived from them by
 * `describeEvent`, and `redactEvents` hides what a viewer may not see.
 */

import type { DevCardType } from "./types";
import type { Resource } from "./board";
import type { EdgeId, HexId, VertexId } from "./geometry";
import type { Hand, PlayerId } from "./types";

export type SpecialCard = "longestRoad" | "largestArmy";

export type EventBody =
  | { kind: "turnStarted"; playerId: PlayerId; turn: number }
  | { kind: "diceRolled"; playerId: PlayerId; dice: [number, number] }
  | { kind: "produced"; gains: { playerId: PlayerId; hex: HexId; resource: Resource; count: number }[] }
  | { kind: "productionBlocked"; hex: HexId }
  | { kind: "bankShort"; resource: Resource; playerId: PlayerId | null; count: number }
  /** `cards` is null for everyone but the discarding player. */
  | { kind: "discarded"; playerId: PlayerId; count: number; cards: Hand | null }
  | { kind: "robberMoved"; from: HexId; to: HexId; by: PlayerId }
  /** `resource` is null for third parties. */
  | { kind: "stole"; from: PlayerId; to: PlayerId; resource: Resource | null }
  | { kind: "built"; playerId: PlayerId; piece: "road" | "settlement" | "city"; at: EdgeId | VertexId }
  /** `card` is null for everyone but the buyer. */
  | { kind: "devCardBought"; playerId: PlayerId; card: DevCardType | null }
  | { kind: "devCardPlayed"; playerId: PlayerId; card: DevCardType }
  | { kind: "inventionTaken"; playerId: PlayerId; resources: [Resource, Resource] }
  | { kind: "monopolised"; playerId: PlayerId; resource: Resource; taken: Record<PlayerId, number> }
  | { kind: "tradeOffered"; playerId: PlayerId; give: Hand; receive: Hand }
  | { kind: "tradeAccepted"; from: PlayerId; to: PlayerId; give: Hand; receive: Hand }
  | { kind: "tradeDeclined"; playerId: PlayerId; from: PlayerId }
  | { kind: "tradeCancelled"; playerId: PlayerId; reason: "withdrawn" | "unpayable" | "turnEnded" | "everyoneDeclined" }
  | { kind: "maritimeTrade"; playerId: PlayerId; give: Resource; count: number; receive: Resource }
  | { kind: "specialCardMoved"; card: SpecialCard; from: PlayerId | null; to: PlayerId | null }
  | { kind: "turnEnded"; playerId: PlayerId }
  /** docs/phase8.md §5: the named player may build before the next roll. */
  | { kind: "specialBuildTurn"; playerId: PlayerId }
  | { kind: "setupCompleted" }
  | { kind: "gameEnded"; winner: PlayerId; scores: Record<PlayerId, number> }
  /** Free text from outside the rules (a seat handed to a bot, the host ending the game). */
  | { kind: "note"; playerId: PlayerId | null; text: string };

export type GameEvent = { readonly seq: number } & EventBody;
export type GameEventKind = GameEvent["kind"];

/** The player an event is "about" for the log feed, or null. */
export function eventPlayer(event: GameEvent): PlayerId | null {
  switch (event.kind) {
    case "turnStarted":
    case "diceRolled":
    case "discarded":
    case "built":
    case "devCardBought":
    case "devCardPlayed":
    case "inventionTaken":
    case "monopolised":
    case "tradeOffered":
    case "tradeDeclined":
    case "tradeCancelled":
    case "maritimeTrade":
    case "turnEnded":
    case "specialBuildTurn":
      return event.playerId;
    case "robberMoved":
      return event.by;
    case "stole":
      return event.to;
    case "tradeAccepted":
      return event.to;
    case "specialCardMoved":
      return event.to;
    case "gameEnded":
      return event.winner;
    case "bankShort":
    case "note":
      return event.playerId;
    case "produced":
    case "productionBlocked":
    case "setupCompleted":
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
    case "diceRolled":
      return `${nameOf(event.playerId)} rolled ${event.dice[0]} + ${event.dice[1]} = ${event.dice[0] + event.dice[1]}`;
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
    case "tradeCancelled":
      switch (event.reason) {
        case "withdrawn":
          return `${nameOf(event.playerId)} withdrew the trade`;
        case "unpayable":
          return "trade offer withdrawn: offerer can no longer pay";
        case "turnEnded":
        case "everyoneDeclined":
          return null;
        default: {
          const exhaustive: never = event.reason;
          return String(exhaustive);
        }
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
    case "note":
      return event.text;
    default: {
      const exhaustive: never = event;
      throw new Error(`unknown event ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Hide discard contents, stolen resources and bought cards from third parties. */
export function redactEvents(events: readonly GameEvent[], viewer: PlayerId): GameEvent[] {
  return events.map((e) => {
    switch (e.kind) {
      case "discarded":
        return e.playerId === viewer ? e : { ...e, cards: null };
      case "stole":
        return e.from === viewer || e.to === viewer ? e : { ...e, resource: null };
      case "devCardBought":
        return e.playerId === viewer ? e : { ...e, card: null };
      default:
        return e;
    }
  });
}
