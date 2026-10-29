// Edge Function `remove-friend` (docs/phase13.md §3): unfriend, or withdraw a request you sent.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { removeFriend } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await removeFriend(sql, { userId, otherUserId: str(body, "userId") });
  return {};
}));
