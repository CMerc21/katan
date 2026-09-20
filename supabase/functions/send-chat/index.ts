// Edge Function `send-chat` (docs/phase12.md §3, Chat). Thin: auth and
// envelope live in _shared/handler.ts, rules live in the bundled server package.
import { handle, str } from "../_shared/handler.ts";
import { sendChat } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const message = await sendChat(sql, { gameId: str(body, "gameId"), userId, text: str(body, "text") });
  return { message };
}));
