// Edge Function `fork-scenario` (docs/phase9.md §5).
import { handle, str } from "../_shared/handler.ts";
import { forkScenario } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await forkScenario(sql, { userId, scenarioId: str(body, "scenarioId"), name: typeof body.name === "string" ? body.name : undefined });
  return { ...r };
}));
