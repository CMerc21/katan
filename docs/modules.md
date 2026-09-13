# Engine modules — how Phase 10 and Phase 11 rules plug in

Companion to `CLAUDE.md`, `docs/phase10.md` and `docs/phase11.md`. Read this before touching `packages/engine/src/modules/`.

## 1. Where things live

| Path | Holds |
| --- | --- |
| `src/modules/types.ts` | Every module's state shape (`WayfarersState`, `CrownState`), constants, card lists, `ModulePrompt`. |
| `src/modules/hooks.ts` | `ModuleHooks` (the hook list), `registerModule`, `activeModules(state)`. |
| `src/modules/prompt.ts` | `parkPrompt` / `finishPrompt` / `underlyingPhase`. |
| `src/modules/index.ts` | Imports every module for its `registerModule` side effect. `actions.ts`, `game.ts` and the root `index.ts` import it. |
| `src/modules/wayfarers/<variant>.ts` | One file per Phase 10 variant. |
| `src/modules/crown/*.ts` | Phase 11 (`index.ts` registers; `production`, `improvements`, `progress`, `knights`, `fleet`, `walls`, `victory`). |
| `src/guards.ts` | `requirePhase`, `requireCurrent`, `requireBuilder`, `requirePrompted`, `pay`, `requireHand`. |
| `src/turnHelpers.ts` | `resolveGold`, `startDiscards`, `stealRandomCard`, `notifyBuilt`, `upgradeToCity`, `startRoadBuilding`. |

Modules import from `state.ts`, `legal.ts`, `guards.ts`, `turnHelpers.ts`, `specialCards.ts`, `rng.ts`, `board.ts`, `geometry.ts`. **Never import `actions.ts` or `game.ts` from a module** (cycle).

## 2. Switches

- `state.scenario.crown` and `state.scenario.variants.<name>` are the only switches. Use `crownOn(state)` / `variantOn(state, "fishing")` from `state.ts` in `enabled`.
- Module state: `state.wayfarers` (null unless a variant is on; each variant owns one nullable sub-object) and `state.crown` (null unless crown). `init(state)` creates it in `createGame` (after the base state exists; `state.seed` is available, use `rng(state.seed, "<module>:init")` style streams via `createRng(seed, label)` for anything random at start).
- The base game must be byte-for-byte unchanged with every switch off: no module hook may change behaviour when `enabled` is false, and `init` is never called then.

## 3. Hooks (`ModuleHooks`)

The core calls, in registration order, only the modules whose `enabled(state)` is true:

- `init` — createGame.
- `roll(state, player, outcome, draw)` — chain: return a new `RollOutcome` (event deck replaces `dice`/`total` and sets `card`; crown keeps the number and adds `red`/`event` drawn from `draw`, the action's seeded `Rng`).
- `afterRoll(state, player, outcome)` — after production (non-seven) or after the discard/robber phase was set (seven). Wrap the phase for any decision (see §4). Return true to stop later modules.
- `onSeven(state)` — return `"noRobber"` to skip the robber move (Robber's Rest, the crown first-attack rule). Discards still happen.
- `hexProduces(state, hex)` — false blocks a hex (raided).
- `yieldOverride(state, hex, owner, "settlement" | "city")` — `{ resources: n }` replaces the 1/2 count (crown cities on pasture/mountain/forest → 1). Add commodities/spice yourself in `afterProduction` or here (emit your own event).
- `afterProduction(state, total, { received, gold })` — fish, spice, caravan bonus, science aid (`gold[id] += 1` makes the core ask that player for a resource of their choice through `chooseGold`).
- `extraActions(state, playerId, out)` — push legal actions for `playerId` in the current phase. Check the phase yourself (`state.phase.kind === "action"`, roll, specialBuild, setup…). Only push actions `apply` will accept.
- `promptActions(state, prompt, playerId, out)` — legal actions inside one of *your* prompts (ignore other kinds).
- `apply(state, action)` — handle your action types; return true when handled, false for types you do not own. Throw `RuleError` for illegal payloads. The core bumps `actionIndex`, expires unpayable trades and checks the win afterwards.
- `victoryPoints(state, player)` — `{ publicVP, hiddenVP }` extra terms (chips, boot −1, castles, rebuilt hexes, deliveries, defender chips, metropolises, VP progress cards, merchant).
- `cardCount(state, player)` — extra stealable/discardable cards (commodities). `stealExtra(state, thief, victim, i)` moves the i-th such card and returns its name. `discardExtra(state, player, extra, commit)` validates (and on commit moves) the `commodities` part of a `DISCARD`.
- `discardThreshold(state, player)` — 7 raised by walls.
- `onTurnStart(state)` / `onTurnEnd(state, player)` — clear per-turn flags, award coins, stock goods.
- `onBuilt(state, playerId, piece, at)` — after any road/ship/settlement/city (setup included), before Longest Road is re-evaluated.
- `onSetupSettlement(state, player, vertex, round)`.
- `roadCost(state, edge)` — extra `Hand` (bridge). `legalActions` already filters roads by `roadCostOf`.
- `blockedVertices(state, playerId)` — opposing knights: roads cannot connect through them and they break Longest Road. `unbuildableVertices(state, playerId)` — any knight: no settlement there.
- `edgeWeight(state, playerId, edge)` — Longest Road weight (caravans: 2).
- `maritime(state, player, give, giveCount, receive)` — take the whole trade (commodities, merchant 2:1). Return true when handled (you moved the cards); return false to let the base rule run. The core emits `maritimeTrade`.
- `onTradeAccepted(state, offerer, acceptor, { offer, accept })` — the boot rides along (validate: holder, receiver's VP ≥ holder's).

## 4. Prompts

When a module needs a decision from a player (possibly not the current one), call `parkPrompt(state, prompt)`: the phase becomes `{ kind: "modulePrompt", prompt, returnTo: <the phase that was current> }` and `nextActor` returns `prompt.playerId`. `legalActions` calls your `promptActions`; your `apply` handles the answer and calls `finishPrompt(state)` (resume) or `finishPrompt(state, nextPrompt)` (chain, e.g. the next pending player). Prompts wrap whatever phase is current, including `chooseGold`, `discard` and other prompts, so ordering always works.

For "take a resource of your choice" reuse the gold phase: `state.phase = { kind: "chooseGold", owed: { [id]: 1 }, returnTo: state.phase }` (check the bank has cards first, or use `resolveGold`). For "discard half" reuse `startDiscards(state, returnTo, thresholdFn)` (it sets `pendingDiscards` and the `discard` phase with `returnTo`).

Prompt kinds are pinned in `ModulePrompt` (`modules/types.ts`); every prompt carries `playerId` (who decides).

## 5. Actions, events, errors

All action types, event kinds and `RuleError` codes are already declared (`types.ts`, `events.ts`, `errors.ts`) with `describeEvent` lines. Use them; add a new one only if truly needed (then also add its `BASE_DURATION` in `apps/web/src/game/eventQueue.ts` and its case in `applyEventToView`, and its `ERROR_TEXT` in `apps/web/src/game/labels.ts`).

`BUILD_KNIGHT` is shared: raiders use `hex`, crown uses `vertex` (they are mutually exclusive by validation).

## 6. Randomness

Only `rng(state.seed, state.actionIndex)` (the action's stream; the roll hook is handed it as `draw`) or `createRng(state.seed, "<label>:<n>")` for named streams (deck shuffles: use `shuffles` counters so replay is exact). Never `Math.random`.

## 7. Tests

One file per variant / crown section under `packages/engine/test/`, every `it` named with the section it covers (`docs/phase10.md §2`, `docs/phase11.md §5`). Build scenarios in tests with `builtInScenario` or `{ ...standardFrame scenario, variants: { fishing: true } }`; `test/helpers.ts` has `playRandomGame({ scenario })`, `give`, `place`, `inPhase`, `withNextRoll`, `expectRule`. Random-play invariants must hold with your variant on: piece supplies, resource conservation (bank + hands = 95), your own module's conservation (fish tokens, spice, commodities, knight piece counts) and the VP math (`victoryPoints` vs. an independent recount).
