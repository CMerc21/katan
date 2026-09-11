// Edge Function `create-game` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { createGameForUsers } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await createGameForUsers(sql, { createdBy: userId, players: body.players as never, board: (body.board as never) ?? "beginner", seed: typeof body.seed === "string" ? body.seed : undefined });
  return { ...r };
}));
