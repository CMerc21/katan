// Edge Function `apply-action` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { applyActionForUser } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const result = await applyActionForUser(sql, { gameId: str(body, "gameId"), userId, action: body.action as never, expectedVersion: Number(body.expectedVersion) });
  return { ...result };
}));
