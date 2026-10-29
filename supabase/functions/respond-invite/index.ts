// Edge Function `respond-invite` (docs/phase13.md §4): accept (take the seat) or decline an invite.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { respondInvite } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await respondInvite(sql, { userId, inviteId: str(body, "inviteId"), accept: body.accept === true });
  return { ...r };
}));
