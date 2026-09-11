// Edge Function `create-lobby` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { createLobby } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await createLobby(sql, { hostUserId: userId, name: typeof body.name === "string" ? body.name : "", board: (body.board as never) ?? "beginner", maxPlayers: (Number(body.maxPlayers) === 3 ? 3 : 4) });
  return { ...r };
}));
