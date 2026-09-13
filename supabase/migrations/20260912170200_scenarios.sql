-- Phase 9 — Tides scenarios (docs/phase9.md §5).

-- A game created from a scenario snapshots it, like a custom board.
alter table public.games add column scenario jsonb;

-- Saved scenarios mirror saved boards: owners have full access; anyone signed in may read public ones.
create table public.scenarios (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id),
  name        text not null,
  definition  jsonb not null,
  is_public   boolean not null default false,
  forked_from uuid references public.scenarios (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index scenarios_owner_idx on public.scenarios (owner_id);
create index scenarios_public_idx on public.scenarios (is_public) where is_public;

alter table public.scenarios enable row level security;
grant select on public.scenarios to authenticated;
create policy "owner reads own scenarios" on public.scenarios for select to authenticated using (owner_id = auth.uid());
create policy "anyone reads public scenarios" on public.scenarios for select to authenticated using (is_public);
-- Writes go through the save-scenario / delete-scenario / fork-scenario Edge Functions (service role).
