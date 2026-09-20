/**
 * All HUD copy in one place (docs/phase12.md §6): help tips for build costs,
 * the improvement effects, the titles, the rail buttons and the round
 * buttons. Components import from here so text is never scattered. Original
 * wording throughout; the rules are docs/rules.md.
 */

import type { Track } from "@katan/engine";

export const HUD_COPY = {
  rail: {
    chat: { label: "Chat", help: "Table talk. Messages stay on this screen for now; the network transport lands with a later phase." },
    emote: { label: "Emote", help: "Show a quick reaction over your banner." },
    log: { label: "Log", help: "Everything that has happened, newest first. L toggles it." },
    stats: { label: "Stats", help: "Pieces, cards and dice for every player." },
    info: { label: "Rules", help: "Build costs, titles and this scenario's rules at a glance." },
    settings: { label: "Settings", help: "Animation speed, sound, graphics and the camera." },
    leave: { label: "Leave game", help: "Hand your seat to a bot, take it back, or leave the table." },
  },
  actions: {
    trade: { label: "Trade", help: "Offer cards to the other players or trade with the bank. T opens it." },
    endTurn: { label: "End turn", help: "Pass the dice along. E ends your turn once you have rolled." },
    roll: { label: "Roll", help: "Roll the dice to start your turn." },
    cards: { label: "Cards", help: "Your development cards, or progress cards under Crown & Castle." },
    skip: { label: "Skip", help: "Fast-forward the animations. Space skips too." },
    camera: { label: "Reset view", help: "Bring the camera back to the table's default framing." },
    diceHistory: { label: "Dice history", help: "The last six rolls, with the event die under Crown & Castle." },
    undo: { label: "Undo", help: "Take back the last road, settlement or city you paid for this turn. Only until anything else happens; U does it too." },
    costs: { label: "Build", help: "The build-cost card. Everything you can afford is already marked on the board: click a spot to build. B opens and closes the card." },
  },
  costs: {
    road: { name: "Road", note: "longest road", help: "A road joins one of your buildings or roads. Five or more in a row may win Longest Road (+2)." },
    ship: { name: "Ship", note: "sea route", help: "A ship extends your route across the sea from a coastal building or another ship." },
    settlement: { name: "Settlement", note: "+1 point", help: "Two edges away from every other building, touching one of your roads." },
    city: { name: "City", note: "+2 points", help: "Upgrades a settlement; produces two cards per hex." },
    devCard: { name: "Development card", note: "", help: "A knight, a road pair, an invention, a monopoly or a hidden point." },
    wall: { name: "City wall", note: "+2 hand limit", help: "Protects a city from downgrade and raises your discard limit by two." },
    knight: { name: "Knight", note: "defence", help: "Hire a basic knight on one of your roads. Activate it with a grain to count it against the barbarians." },
    promote: { name: "Promote knight", note: "+1 strength", help: "Raise a knight one level. Mighty knights need Politics level 3." },
    improvement: { name: "City improvement", note: "commodities", help: "Spend a track's commodity to climb it. Level 3 unlocks an ability; level 4 claims a metropolis (+2)." },
  },
  tracks: {
    trade: "Trade: level 3 trades commodities 2:1 with the bank.",
    politics: "Politics: level 3 allows mighty knights.",
    science: "Science: level 3 lets you build one free road each turn.",
  } satisfies Record<Track, string>,
  titles: {
    longestRoad: "Longest Road: the longest unbroken route of five or more, worth two points.",
    largestArmy: "Largest Army: three or more knights played, worth two points.",
    defender: "Defender of the Realm: the strongest defence when the barbarians are repelled earns a point.",
    metropolis: "A metropolis crowns a city on a track's fourth level and is worth two extra points.",
  },
  stats: {
    roads: "Roads built",
    army: "Knights played",
    defense: "Active defence: the levels of your activated knights",
    knights: "Knights on the board",
    dev: "Development cards in hand",
    hand: "Resource cards in hand",
    progress: "Progress cards in hand",
    improvements: "City improvement levels across the three tracks",
  },
  table: {
    barbarians: "The barbarian fleet advances on a black sail. When it lands, the realm's active knights face the cities' strength.",
    bank: "The bank's cards. Hover a stack for its count.",
    piles: "Unplaced pieces wait by each seat; yours are nearest you.",
    improvements: "Your city improvements. Click the card to improve a track.",
  },
} as const;
