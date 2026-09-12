/**
 * Easy bot (docs/phase5.md §6.4): finishes games and is beatable by
 * someone who has played once.
 */

import { RESOURCES, type Action } from "@katan/engine";
import { hexesOf, myHand, rawPipCount } from "./eval";
import { ensureLegal, ofType, pick, type BotPolicy, type RedactedState, type Rng } from "./types";

export function easyBot(): BotPolicy {
  return { level: "easy", chooseAction: chooseEasy };
}

export function chooseEasy(view: RedactedState, legal: Action[], rng: Rng): Action {
  const phase = view.phase.kind;
  const me = view.viewer;

  if (phase === "setup") {
    const settlements = ofType(legal, "BUILD_SETTLEMENT");
    if (settlements.length) {
      // Uniform among the top half by raw pip count.
      const sorted = settlements.slice().sort((a, b) => rawPipCount(view, b.vertex) - rawPipCount(view, a.vertex));
      return pick(rng, sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))));
    }
    return pick(rng, legal);
  }

  if (phase === "discard") {
    const owed = view.pendingDiscards[me] ?? 0;
    const hand = { ...myHand(view) };
    const cards = { wood: 0, clay: 0, wool: 0, grain: 0, ore: 0 };
    for (let i = 0; i < owed; i++) {
      const options = RESOURCES.filter((r) => hand[r] > 0);
      const r = pick(rng, options);
      hand[r] -= 1;
      cards[r] += 1;
    }
    return ensureLegal(legal, { type: "DISCARD", playerId: me, cards }) ?? pick(rng, legal);
  }

  if (phase === "moveRobber") {
    const moves = ofType(legal, "MOVE_ROBBER");
    const mine = hexesOf(view, me);
    const safe = moves.filter((m) => !mine.has(m.hex));
    return pick(rng, safe.length ? safe : moves);
  }

  if (phase === "steal") return pick(rng, ofType(legal, "STEAL"));

  if (phase === "chooseGold") return pick(rng, ofType(legal, "CHOOSE_GOLD"));

  if (phase === "roll") {
    // Roll immediately (a knight before the roll is a medium+ idea).
    return legal.find((a) => a.type === "ROLL") ?? pick(rng, legal);
  }

  if (phase === "roadBuilding") return pick(rng, legal);

  if (phase === "specialBuild") {
    // docs/phase8.md §5: build something if we can, otherwise pass.
    const builds = legal.filter((a) => a.type !== "SPECIAL_BUILD_DONE");
    if (builds.length && rng() < 0.7) return pick(rng, builds);
    return legal.find((a) => a.type === "SPECIAL_BUILD_DONE") ?? pick(rng, legal);
  }

  if (phase === "action") {
    const current = view.players[view.currentPlayer]!.id;
    if (current !== me) {
      // Trade response: never trades with players.
      return legal.find((a) => a.type === "REJECT_TRADE") ?? pick(rng, legal);
    }
    const roll = rng();
    const hand = myHand(view);
    const handSize = RESOURCES.reduce((n, r) => n + hand[r], 0);
    // Weighting: roads listed twice per edge but settlements are far fewer
    // instances, so weight by type instead of instance.
    const byType: Record<"road" | "ship" | "settlement" | "city", Action[]> = {
      road: ofType(legal, "BUILD_ROAD"),
      ship: ofType(legal, "BUILD_SHIP"),
      settlement: ofType(legal, "BUILD_SETTLEMENT"),
      city: ofType(legal, "BUILD_CITY"),
    };
    const available = (["road", "ship", "settlement", "city"] as const).filter((k) => byType[k].length > 0);
    if (available.length && (roll < 0.6 || handSize >= 7)) {
      const weights = { road: 3, ship: 2, settlement: 2, city: 1 };
      const total = available.reduce((n, k) => n + weights[k], 0);
      let t = rng() * total;
      let kind = available[available.length - 1]!;
      for (const k of available) {
        t -= weights[k];
        if (t < 0) {
          kind = k;
          break;
        }
      }
      return pick(rng, byType[kind]);
    }
    const buy = legal.find((a) => a.type === "BUY_DEV_CARD");
    if (buy && roll < 0.8) return buy;

    // Play a dev card randomly when legal.
    const plays = legal.filter((a) => a.type === "PLAY_KNIGHT" || a.type === "PLAY_ROAD_BUILDING" || a.type === "PLAY_MONOPOLY" || a.type === "PLAY_INVENTION");
    if (plays.length && rng() < 0.5) return pick(rng, plays);

    // Maritime trade only when holding 6+ of one resource, or when a large
    // hand would otherwise just be discarded on the next seven.
    const glut = RESOURCES.find((r) => hand[r] >= 6) ?? (handSize >= 8 ? RESOURCES.reduce((b, r) => (hand[r] > hand[b] ? r : b), RESOURCES[0]) : undefined);
    if (glut) {
      const trades = ofType(legal, "MARITIME_TRADE").filter((t) => t.give === glut);
      const wanted = trades.filter((t) => hand[t.receive] === 0);
      if (wanted.length) return pick(rng, wanted);
      if (trades.length) return pick(rng, trades);
    }
    return legal.find((a) => a.type === "END_TURN") ?? pick(rng, legal);
  }

  return pick(rng, legal);
}
