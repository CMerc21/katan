// Edge Function `set-username` (docs/phase13.md §3.1): change your handle.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { setUsername } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const profile = await setUsername(sql, { userId, username: str(body, "username") });
  return { profile };
}));
