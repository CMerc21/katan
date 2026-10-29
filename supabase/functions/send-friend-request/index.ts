// Edge Function `send-friend-request` (docs/phase13.md §3, §3.1): ask by friend code or exact username; a request back accepts.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { sendFriendRequest } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await sendFriendRequest(sql, {
    userId,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(typeof body.username === "string" ? { username: body.username } : {}),
  });
  return { ...r };
}));
