// Edge Function `save-scenario` (docs/phase9.md §5). Thin: auth and envelope live in
// _shared/handler.ts, validation lives in the bundled server package.
import { handle } from "../_shared/handler.ts";
import { saveScenario } from "../_shared/katan.bundle.js";

Deno.serve(handle(async ({ sql, userId, body }) => {
  const r = await saveScenario(sql, {
    userId,
    scenarioId: typeof body.scenarioId === "string" ? body.scenarioId : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    definition: body.definition,
    isPublic: body.isPublic === true,
  });
  return { ...r };
}));
