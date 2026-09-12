import { easyBot } from "./easy";
import { hardBot } from "./hard";
import { mediumBot } from "./medium";
import type { BotLevel, BotPolicy } from "./types";

export * from "./types";
export * from "./eval";
export { chooseEasy } from "./easy";
export { chooseMedium } from "./medium";
export { chooseHard, plan, positionScore } from "./hard";
export * from "./simulate";
export * from "./names";

/** docs/phase5.md §6.1 */
export function createBot(level: BotLevel): BotPolicy {
  switch (level) {
    case "easy":
      return easyBot();
    case "medium":
      return mediumBot();
    case "hard":
      return hardBot();
    default: {
      const exhaustive: never = level;
      throw new Error(`unknown bot level ${String(exhaustive)}`);
    }
  }
}

export function isBotLevel(value: unknown): value is BotLevel {
  return value === "easy" || value === "medium" || value === "hard";
}
