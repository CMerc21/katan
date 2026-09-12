"use client";

/**
 * Where boards live (docs/phase8.md §4.3): drafts in localStorage (so the
 * editor and hotseat work without an account) and saved boards in the
 * `boards` table through the save/delete/fork Edge Functions.
 */

import { isBoardDefinition, type BoardDefinition } from "@katan/engine";
import { callFunction, supabase, supabaseConfigured } from "@/lib/supabase";

export interface StoredBoard {
  readonly id: string;
  readonly name: string;
  readonly definition: BoardDefinition;
  readonly isPublic: boolean;
  readonly ownerId: string | null;
  readonly updatedAt: string;
  readonly source: "draft" | "saved";
}

const DRAFTS_KEY = "katan.boards.drafts";

export function isDraftId(id: string): boolean {
  return id.startsWith("draft-");
}

export function loadDrafts(): StoredBoard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return list
      .filter((x): x is { id: string; name: string; definition: unknown; updatedAt: string } => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string")
      .filter((x) => isBoardDefinition(x.definition))
      .map((x) => ({ id: x.id, name: x.name, definition: x.definition as BoardDefinition, isPublic: false, ownerId: null, updatedAt: x.updatedAt, source: "draft" as const }));
  } catch {
    return [];
  }
}

export function saveDraft(definition: BoardDefinition, id?: string): StoredBoard {
  const drafts = loadDrafts();
  const draft: StoredBoard = {
    id: id && isDraftId(id) ? id : `draft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: definition.name,
    definition,
    isPublic: false,
    ownerId: null,
    updatedAt: new Date().toISOString(),
    source: "draft",
  };
  const next = [draft, ...drafts.filter((d) => d.id !== draft.id)].slice(0, 50);
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(next.map((d) => ({ id: d.id, name: d.name, definition: d.definition, updatedAt: d.updatedAt }))));
  } catch {
    /* storage full or blocked: the board stays in memory */
  }
  return draft;
}

export function deleteDraft(id: string): void {
  const next = loadDrafts().filter((d) => d.id !== id);
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(next.map((d) => ({ id: d.id, name: d.name, definition: d.definition, updatedAt: d.updatedAt }))));
  } catch {
    /* ignore */
  }
}

interface BoardRow {
  id: string;
  owner_id: string;
  name: string;
  definition: unknown;
  is_public: boolean;
  updated_at: string;
}

/** Boards visible to the signed-in user: their own and every public one (RLS decides). */
export async function loadSavedBoards(): Promise<StoredBoard[]> {
  if (!supabaseConfigured()) return [];
  const { data, error } = await supabase().from("boards").select("id, owner_id, name, definition, is_public, updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as BoardRow[])
    .filter((r) => isBoardDefinition(r.definition))
    .map((r) => ({ id: r.id, name: r.name, definition: r.definition as BoardDefinition, isPublic: r.is_public, ownerId: r.owner_id, updatedAt: r.updated_at, source: "saved" as const }));
}

export async function loadSavedBoard(id: string): Promise<StoredBoard | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await supabase().from("boards").select("id, owner_id, name, definition, is_public, updated_at").eq("id", id).maybeSingle();
  const r = data as BoardRow | null;
  if (!r || !isBoardDefinition(r.definition)) return null;
  return { id: r.id, name: r.name, definition: r.definition as BoardDefinition, isPublic: r.is_public, ownerId: r.owner_id, updatedAt: r.updated_at, source: "saved" };
}

export async function saveBoardRemote(definition: BoardDefinition, options: { boardId?: string; isPublic?: boolean }): Promise<{ ok: true; boardId: string } | { ok: false; code: string }> {
  const reply = await callFunction<{ boardId: string }>("save-board", { definition, boardId: options.boardId, isPublic: options.isPublic ?? false, name: definition.name });
  return reply.ok ? { ok: true, boardId: reply.boardId } : { ok: false, code: reply.code };
}

export async function deleteBoardRemote(boardId: string): Promise<{ ok: boolean; code?: string }> {
  const reply = await callFunction("delete-board", { boardId });
  return reply.ok ? { ok: true } : { ok: false, code: reply.code };
}

export async function forkBoardRemote(boardId: string): Promise<{ ok: true; boardId: string } | { ok: false; code: string }> {
  const reply = await callFunction<{ boardId: string }>("fork-board", { boardId });
  return reply.ok ? { ok: true, boardId: reply.boardId } : { ok: false, code: reply.code };
}
