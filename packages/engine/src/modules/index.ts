/**
 * Registers every module's hooks (docs/phase10.md, docs/phase11.md §9).
 * Importing this file is a side effect; `actions.ts` and `game.ts` do it so
 * the registry is complete wherever the engine runs.
 */

import "./wayfarers/eventDeck";
import "./wayfarers/fishing";
import "./wayfarers/rivers";
import "./wayfarers/harbormaster";
import "./wayfarers/raiders";
import "./wayfarers/caravans";
import "./wayfarers/wagons";
import "./crown";

export * from "./hooks";
export * from "./prompt";
export * from "./types";
