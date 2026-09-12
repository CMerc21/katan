// Edge Function `save-board` (docs/phase8.md §4.3). Thin: auth and envelope live in
// _shared/handler.ts, validation lives in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { saveBoard } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await saveBoard(sql, {
    userId,
    boardId: typeof body.boardId === "string" ? body.boardId : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    definition: body.definition,
    isPublic: body.isPublic === true,
  });
  return { ...r };
}));
