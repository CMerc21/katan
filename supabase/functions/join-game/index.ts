// Edge Function `join-game` (docs/phase4.md §3 / docs/phase5.md §1). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { joinGame } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await joinGame(sql, { code: str(body, "code"), userId, name: typeof body.name === "string" ? body.name : "" });
  return { ...r };
}));
