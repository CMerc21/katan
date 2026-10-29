// Edge Function `send-friend-request` (docs/phase13.md §3): ask by friend code; a request back accepts.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { sendFriendRequest } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await sendFriendRequest(sql, { userId, code: str(body, "code") });
  return { ...r };
}));
