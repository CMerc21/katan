// Edge Function `search-players` (docs/phase13.md §3.1): find players by username prefix.
// Thin: auth and envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { searchPlayers } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const players = await searchPlayers(sql, { userId, query: typeof body.query === "string" ? body.query : "" });
  return { players };
}));
