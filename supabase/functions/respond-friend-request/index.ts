// Edge Function `respond-friend-request` (docs/phase13.md §3): accept or decline a request sent to you.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { respondFriendRequest } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await respondFriendRequest(sql, { userId, fromUserId: str(body, "fromUserId"), accept: body.accept === true });
  return {};
}));
