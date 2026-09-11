// Edge Function `remove-player` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { removePlayer } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await removePlayer(sql, { gameId: str(body, "gameId"), userId, playerId: str(body, "playerId") });
  return {};
}));
