"use client";

/**
 * Where boards live (docs/phase8.md §4.3): drafts in localStorage (so the
 * editor and hotseat work without an account) and saved boards in the
 * `boards` table through the save/delete/fork Edge Functions.
 */

import { isBoardDefinition, isScenario, type BoardDefinition, type Scenario } from "@katan/engine";
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

// ---------------------------------------------------------------------------
// Scenarios (docs/phase9.md §5): drafts in localStorage, saved ones in `scenarios`.

export interface StoredScenario {
  readonly id: string;
  readonly name: string;
  readonly scenario: Scenario;
  readonly isPublic: boolean;
  readonly ownerId: string | null;
  readonly updatedAt: string;
  readonly source: "draft" | "saved";
}

const SCENARIO_DRAFTS_KEY = "katan.scenarios.drafts";

export function isScenarioDraftId(id: string): boolean {
  return id.startsWith("sdraft-");
}

function writeScenarioDrafts(list: readonly StoredScenario[]): void {
  try {
    window.localStorage.setItem(SCENARIO_DRAFTS_KEY, JSON.stringify(list.map((d) => ({ id: d.id, name: d.name, scenario: d.scenario, updatedAt: d.updatedAt }))));
  } catch {
    /* storage full or blocked */
  }
}

export function loadScenarioDrafts(): StoredScenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCENARIO_DRAFTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return list
      .filter((x): x is { id: string; name: string; scenario: unknown; updatedAt: string } => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string")
      .filter((x) => isScenario(x.scenario))
      .map((x) => ({ id: x.id, name: x.name, scenario: x.scenario as Scenario, isPublic: false, ownerId: null, updatedAt: x.updatedAt, source: "draft" as const }));
  } catch {
    return [];
  }
}

export function saveScenarioDraft(scenario: Scenario, id?: string): StoredScenario {
  const drafts = loadScenarioDrafts();
  const draftId = id && isScenarioDraftId(id) ? id : `sdraft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const draft: StoredScenario = { id: draftId, name: scenario.name, scenario: { ...scenario, id: draftId }, isPublic: false, ownerId: null, updatedAt: new Date().toISOString(), source: "draft" };
  writeScenarioDrafts([draft, ...drafts.filter((d) => d.id !== draft.id)].slice(0, 50));
  return draft;
}

export function deleteScenarioDraft(id: string): void {
  writeScenarioDrafts(loadScenarioDrafts().filter((d) => d.id !== id));
}

interface ScenarioRow {
  id: string;
  owner_id: string;
  name: string;
  definition: unknown;
  is_public: boolean;
  updated_at: string;
}

function rowToScenario(r: ScenarioRow): StoredScenario | null {
  if (!isScenario(r.definition)) return null;
  return { id: r.id, name: r.name, scenario: { ...r.definition, id: r.id, name: r.name }, isPublic: r.is_public, ownerId: r.owner_id, updatedAt: r.updated_at, source: "saved" };
}

export async function loadSavedScenarios(): Promise<StoredScenario[]> {
  if (!supabaseConfigured()) return [];
  const { data, error } = await supabase().from("scenarios").select("id, owner_id, name, definition, is_public, updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ScenarioRow[]).map(rowToScenario).filter((x): x is StoredScenario => x !== null);
}

export async function loadSavedScenario(id: string): Promise<StoredScenario | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await supabase().from("scenarios").select("id, owner_id, name, definition, is_public, updated_at").eq("id", id).maybeSingle();
  return data ? rowToScenario(data as ScenarioRow) : null;
}

export async function saveScenarioRemote(scenario: Scenario, options: { scenarioId?: string; isPublic?: boolean }): Promise<{ ok: true; scenarioId: string } | { ok: false; code: string }> {
  const reply = await callFunction<{ scenarioId: string }>("save-scenario", { definition: scenario, scenarioId: options.scenarioId, isPublic: options.isPublic ?? false, name: scenario.name });
  return reply.ok ? { ok: true, scenarioId: reply.scenarioId } : { ok: false, code: reply.code };
}

export async function deleteScenarioRemote(scenarioId: string): Promise<{ ok: boolean; code?: string }> {
  const reply = await callFunction("delete-scenario", { scenarioId });
  return reply.ok ? { ok: true } : { ok: false, code: reply.code };
}

export async function forkScenarioRemote(scenarioId: string): Promise<{ ok: true; scenarioId: string } | { ok: false; code: string }> {
  const reply = await callFunction<{ scenarioId: string }>("fork-scenario", { scenarioId });
  return reply.ok ? { ok: true, scenarioId: reply.scenarioId } : { ok: false, code: reply.code };
}
