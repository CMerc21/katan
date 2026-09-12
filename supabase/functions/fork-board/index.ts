// Edge Function `fork-board` (docs/phase8.md §4.3).
import { handle, str } from "../_shared/handler.ts";
import { forkBoard } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await forkBoard(sql, { userId, boardId: str(body, "boardId"), name: typeof body.name === "string" ? body.name : undefined });
  return { ...r };
}));
