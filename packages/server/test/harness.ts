/**
 * Runs the real migrations against a plain local Postgres so RLS and the
 * transactional services are tested for real (docs/phase4.md §9).
 *
 * Supabase specifics are stubbed: an `auth` schema with `auth.users` and
 * `auth.uid()` reading `request.jwt.claims`, the `anon`/`authenticated`
 * roles, and an empty `supabase_realtime` publication.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { Db, Tx } from "../src/game-service";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

export function connectTestDb(): Db {
  const url = process.env.KATAN_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/katan_test";
  return postgres(url, { max: 4, onnotice: () => undefined }) as unknown as Db;
}

export async function resetDatabase(sql: Db): Promise<void> {
  await sql.unsafe(`
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to public;
    drop schema if exists auth cascade;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
    drop publication if exists supabase_realtime;
    create publication supabase_realtime;
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
}

export async function createUser(sql: Db, email: string, name = email.split("@")[0] ?? email): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into auth.users (id, email, raw_user_meta_data)
    values (gen_random_uuid(), ${email}, ${sql.json({ display_name: name })})
    returning id`;
  return row!.id;
}

/** Run `fn` as an authenticated client with the given JWT subject (RLS applies). */
export async function asUser<T>(sql: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    return fn(tx as Tx);
  })) as T;
}

/** Run `fn` as the anonymous role (no JWT). */
export async function asAnon<T>(sql: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe(`set local role anon`);
    return fn(tx as Tx);
  })) as T;
}

/** Postgres error code for the first error thrown by `fn`, or null if it succeeds. */
export async function pgErrorCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}
