// Edge Function `delete-scenario` (docs/phase9.md §5).
import { handle, str } from "../_shared/handler.ts";
import { deleteScenario } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  await deleteScenario(sql, { userId, scenarioId: str(body, "scenarioId") });
  return {};
}));
