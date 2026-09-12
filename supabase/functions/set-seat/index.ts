// Edge Function `set-seat` (docs/phase4.md §3 / docs/phase5.md §1 / docs/phase7.md §4). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { setSeat } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await setSeat(sql, {
    gameId: str(body, "gameId"),
    userId,
    color: body.color as never,
    name: typeof body.name === "string" ? body.name : undefined,
    avatar: body.avatar as never,
    playerId: typeof body.playerId === "string" ? body.playerId : undefined,
  });
  return {};
}));
