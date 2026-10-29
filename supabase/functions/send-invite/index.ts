// Edge Function `send-invite` (docs/phase13.md §4): ask a friend into a lobby you sit in.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { sendInvite } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await sendInvite(sql, { userId, gameId: str(body, "gameId"), toUserId: str(body, "toUserId") });
  return { ...r };
}));
