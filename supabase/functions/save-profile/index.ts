// Edge Function `save-profile` (docs/phase13.md §2): name and wardrobe other players see.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { saveProfile } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const profile = await saveProfile(sql, { userId, name: body.name, avatar: body.avatar, color: body.color });
  return { profile };
}));
