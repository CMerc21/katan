/**
 * Wayfarers: wagons (docs/phase10.md). Skeleton; the rules follow.
 */

import { registerModule } from "../hooks";
import { variantOn } from "../../state";
import type { GameState } from "../../types";

registerModule({
  id: "wagons",
  enabled: (state: GameState) => variantOn(state, "wagons"),
});
