/**
 * Saved scenarios (docs/phase9.md §5): save (insert or update), delete,
 * fork. Reads go through RLS (`scenarios` is selectable by owners and, when
 * public, by anyone signed in); writes come through these transactions.
 */

import { isScenario, scenarioHasErrors, type Scenario } from "@katan/engine";
import type { JSONValue } from "postgres";
import { ServiceError } from "./errors";
import type { Db } from "./game-service";

export interface ScenarioRow {
  id: string;
  owner_id: string;
  name: string;
  definition: Scenario;
  is_public: boolean;
  forked_from: string | null;
  created_at: Date;
  updated_at: Date;
}

function cleanName(name: unknown, fallback: string): string {
  const n = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return n.length > 0 ? n : fallback;
}

export interface SaveScenarioInput {
  userId: string;
  /** Omit to create; pass to update a scenario you own. */
  scenarioId?: string;
  name?: string;
  definition: unknown;
  isPublic?: boolean;
}

/** Save allowed with warnings, refused with errors (board rules plus scenario checks). */
export async function saveScenario(sql: Db, input: SaveScenarioInput): Promise<{ scenarioId: string }> {
  if (!isScenario(input.definition)) throw new ServiceError("BAD_REQUEST", "malformed scenario");
  const given: Scenario = input.definition;
  if (scenarioHasErrors(given)) throw new ServiceError("INVALID_SCENARIO", "the scenario has errors");
  const name = cleanName(input.name ?? given.name, "Untitled scenario");
  const isPublic = input.isPublic ?? false;
  return sql.begin(async (tx) => {
    if (input.scenarioId) {
      const [row] = await tx<{ owner_id: string }[]>`select owner_id from scenarios where id = ${input.scenarioId} for update`;
      if (!row) throw new ServiceError("SCENARIO_NOT_FOUND", "no such scenario", 404);
      if (row.owner_id !== input.userId) throw new ServiceError("NOT_OWNER", "you do not own this scenario", 403);
      const definition: Scenario = { ...given, id: input.scenarioId, name };
      await tx`update scenarios set name = ${name}, definition = ${tx.json(definition as unknown as JSONValue)}, is_public = ${isPublic}, updated_at = now() where id = ${input.scenarioId}`;
      return { scenarioId: input.scenarioId };
    }
    const [created] = await tx<{ id: string }[]>`
      insert into scenarios (owner_id, name, definition, is_public)
      values (${input.userId}, ${name}, ${tx.json({ ...given, name } as unknown as JSONValue)}, ${isPublic})
      returning id`;
    const id = created!.id;
    // The stored definition carries its own row id so a game can name what it was made from.
    await tx`update scenarios set definition = ${tx.json({ ...given, id, name } as unknown as JSONValue)} where id = ${id}`;
    return { scenarioId: id };
  });
}

export async function deleteScenario(sql: Db, input: { userId: string; scenarioId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx<{ owner_id: string }[]>`select owner_id from scenarios where id = ${input.scenarioId} for update`;
    if (!row) throw new ServiceError("SCENARIO_NOT_FOUND", "no such scenario", 404);
    if (row.owner_id !== input.userId) throw new ServiceError("NOT_OWNER", "you do not own this scenario", 403);
    await tx`delete from scenarios where id = ${input.scenarioId}`;
  });
}

/** Copy a scenario you can see into your own list. */
export async function forkScenario(sql: Db, input: { userId: string; scenarioId: string; name?: string }): Promise<{ scenarioId: string }> {
  return sql.begin(async (tx) => {
    const [row] = await tx<ScenarioRow[]>`select * from scenarios where id = ${input.scenarioId}`;
    if (!row || (!row.is_public && row.owner_id !== input.userId)) throw new ServiceError("SCENARIO_NOT_FOUND", "no such scenario", 404);
    const name = cleanName(input.name, `${row.name} (copy)`);
    const [created] = await tx<{ id: string }[]>`
      insert into scenarios (owner_id, name, definition, is_public, forked_from)
      values (${input.userId}, ${name}, ${tx.json({ ...row.definition, name } as unknown as JSONValue)}, false, ${input.scenarioId})
      returning id`;
    const id = created!.id;
    await tx`update scenarios set definition = ${tx.json({ ...row.definition, id, name } as unknown as JSONValue)} where id = ${id}`;
    return { scenarioId: id };
  });
}
