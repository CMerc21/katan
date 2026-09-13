/**
 * Crown & Castle (docs/phase11.md). Skeleton; the rules follow.
 */

import { registerModule } from "../hooks";
import { crownOn } from "../../state";
import type { GameState } from "../../types";

registerModule({
  id: "crown",
  enabled: (state: GameState) => crownOn(state),
});
