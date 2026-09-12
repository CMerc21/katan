// Edge Function `delete-board` (docs/phase8.md §4.3).
import { handle, str } from "../_shared/handler.ts";
import { deleteBoard } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await deleteBoard(sql, { userId, boardId: str(body, "boardId") });
  return {};
}));
