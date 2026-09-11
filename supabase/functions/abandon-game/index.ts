// Edge Function `abandon-game` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { abandonGame } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await abandonGame(sql, { gameId: str(body, "gameId"), userId });
  return {};
}));
