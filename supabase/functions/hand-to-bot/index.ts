// Edge Function `hand-to-bot` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { handToBot, reclaimSeat } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  if (body.reclaim === true) {
    await reclaimSeat(sql, { gameId: str(body, "gameId"), userId });
    return {};
  }
  const r = await handToBot(sql, { gameId: str(body, "gameId"), userId, level: body.level as never });
  return { ...r };
}));
