// Edge Function `touch-profile` (docs/phase13.md §3): the friends-list heartbeat; creates the profile on first contact.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { touchProfile } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const profile = await touchProfile(sql, { userId, activity: body.activity });
  return { profile };
}));
