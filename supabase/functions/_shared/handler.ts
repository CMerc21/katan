/**
 * Shared Edge Function wrapper (docs/phase4.md §3): CORS, JWT verification,
 * one Postgres client per isolate, and the { ok, code, message } envelope.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";
import { ServiceError, toReply } from "./katan.bundle.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

let sqlClient: ReturnType<typeof postgres> | null = null;

function sql(): ReturnType<typeof postgres> {
  if (!sqlClient) {
    const url = Deno.env.get("SUPABASE_DB_URL");
    if (!url) throw new ServiceError("BAD_REQUEST", "SUPABASE_DB_URL is not set", 500);
    sqlClient = postgres(url, { max: 2, prepare: false });
  }
  return sqlClient;
}

export interface Ctx {
  sql: ReturnType<typeof postgres>;
  userId: string;
  body: Record<string, unknown>;
}

async function userIdFrom(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new ServiceError("UNAUTHORIZED", "missing bearer token", 401);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ServiceError("UNAUTHORIZED", "invalid session", 401);
  return data.user.id;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Wrap a service call: resolves the user, parses the JSON body, maps errors to codes. */
export function handle(fn: (ctx: Ctx) => Promise<Record<string, unknown>>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
      const userId = await userIdFrom(req);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await fn({ sql: sql(), userId, body });
      return json({ ok: true, ...result });
    } catch (err) {
      const reply = toReply(err);
      if (reply.status >= 500) console.error(err);
      return json({ ok: false, code: reply.code, message: reply.message }, reply.status);
    }
  };
}

export function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.length === 0) throw new ServiceError("BAD_REQUEST", `${key} is required`);
  return v;
}
