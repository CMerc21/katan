/**
 * Saved boards (docs/phase8.md §4.3): save (insert or update), delete, fork.
 * Reads go straight through RLS (`boards` is selectable by owners and, when
 * public, by anyone signed in); writes come through these transactions.
 */

import { hasErrors, isBoardDefinition, validateBoard, type BoardDefinition } from "@katan/engine";
import type { JSONValue } from "postgres";
import { ServiceError } from "./errors";
import type { Db } from "./game-service";

export interface BoardRow {
  id: string;
  owner_id: string;
  name: string;
  definition: BoardDefinition;
  is_public: boolean;
  forked_from: string | null;
  created_at: Date;
  updated_at: Date;
}

function cleanName(name: unknown, fallback: string): string {
  const n = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return n.length > 0 ? n : fallback;
}

export interface SaveBoardInput {
  userId: string;
  /** Omit to create; pass to update a board you own. */
  boardId?: string;
  name?: string;
  definition: unknown;
  isPublic?: boolean;
}

/** Save allowed with warnings, refused with errors (docs/phase8.md §3). */
export async function saveBoard(sql: Db, input: SaveBoardInput): Promise<{ boardId: string }> {
  if (!isBoardDefinition(input.definition)) throw new ServiceError("BAD_REQUEST", "malformed board definition");
  const issues = validateBoard(input.definition, { allowIslands: true });
  if (hasErrors(issues)) {
    const first = issues.find((i) => i.severity === "error");
    throw new ServiceError("INVALID_BOARD", first ? `${first.code}: ${first.message}` : "the board has errors");
  }
  const name = cleanName(input.name ?? input.definition.name, "Untitled board");
  const definition: BoardDefinition = { ...input.definition, name };
  const isPublic = input.isPublic ?? false;
  return sql.begin(async (tx) => {
    if (input.boardId) {
      const [row] = await tx<{ owner_id: string }[]>`select owner_id from boards where id = ${input.boardId} for update`;
      if (!row) throw new ServiceError("BOARD_NOT_FOUND", "no such board", 404);
      if (row.owner_id !== input.userId) throw new ServiceError("NOT_OWNER", "you do not own this board", 403);
      await tx`update boards set name = ${name}, definition = ${tx.json(definition as unknown as JSONValue)}, is_public = ${isPublic}, updated_at = now() where id = ${input.boardId}`;
      return { boardId: input.boardId };
    }
    const [created] = await tx<{ id: string }[]>`
      insert into boards (owner_id, name, definition, is_public)
      values (${input.userId}, ${name}, ${tx.json(definition as unknown as JSONValue)}, ${isPublic})
      returning id`;
    return { boardId: created!.id };
  });
}

export async function deleteBoard(sql: Db, input: { userId: string; boardId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx<{ owner_id: string }[]>`select owner_id from boards where id = ${input.boardId} for update`;
    if (!row) throw new ServiceError("BOARD_NOT_FOUND", "no such board", 404);
    if (row.owner_id !== input.userId) throw new ServiceError("NOT_OWNER", "you do not own this board", 403);
    await tx`delete from boards where id = ${input.boardId}`;
  });
}

/** Copy a board you can see into your own list. */
export async function forkBoard(sql: Db, input: { userId: string; boardId: string; name?: string }): Promise<{ boardId: string }> {
  return sql.begin(async (tx) => {
    const [row] = await tx<BoardRow[]>`select * from boards where id = ${input.boardId}`;
    if (!row || (!row.is_public && row.owner_id !== input.userId)) throw new ServiceError("BOARD_NOT_FOUND", "no such board", 404);
    const name = cleanName(input.name, `${row.name} (copy)`);
    const definition: BoardDefinition = { ...row.definition, name };
    const [created] = await tx<{ id: string }[]>`
      insert into boards (owner_id, name, definition, is_public, forked_from)
      values (${input.userId}, ${name}, ${tx.json(definition as unknown as JSONValue)}, false, ${input.boardId})
      returning id`;
    return { boardId: created!.id };
  });
}
