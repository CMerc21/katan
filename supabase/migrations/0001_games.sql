-- Phase 4 — games, players, action log, per-player redacted views (docs/phase4.md §2).
--
-- Principles: clients never read or write `games`; they read their own
-- `game_views` row and the membership/action tables for games they are in.
-- All writes go through Edge Functions using the service role.

create extension if not exists pgcrypto;

create table public.games (
  id            uuid primary key default gen_random_uuid(),
  seed          text not null,
  state         jsonb not null,             -- full GameState; NO client access
  version       integer not null default 0, -- incremented per applied action
  status        text not null check (status in ('lobby', 'active', 'ended')),
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.game_players (
  game_id    uuid not null references public.games (id) on delete cascade,
  user_id    uuid references auth.users (id),
  player_id  text not null,                 -- id used inside GameState
  seat       integer not null,
  name       text not null,
  color      text not null check (color in ('red', 'blue', 'orange', 'white')),
  kind       text not null default 'human' check (kind in ('human', 'bot')),
  primary key (game_id, player_id),
  unique (game_id, user_id),
  unique (game_id, seat),
  unique (game_id, color),
  check ((kind = 'human') = (user_id is not null) or kind = 'bot')
);

create table public.game_actions (
  game_id     uuid not null references public.games (id) on delete cascade,
  index       integer not null,
  player_id   text not null,
  action      jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, index)
);

-- One row per (game, player): the redacted view that player may see.
create table public.game_views (
  game_id    uuid not null references public.games (id) on delete cascade,
  player_id  text not null,
  user_id    uuid references auth.users (id),
  view       jsonb not null,                -- engine.redact(state, player_id)
  version    integer not null,
  primary key (game_id, player_id)
);

-- §2.2 indexes
create index game_views_user_id_idx on public.game_views (user_id);
create index game_players_user_id_idx on public.game_players (user_id);
create index game_actions_game_index_desc_idx on public.game_actions (game_id, index desc);

-- §2.1 Row Level Security -------------------------------------------------

alter table public.games        enable row level security;
alter table public.game_players enable row level security;
alter table public.game_actions enable row level security;
alter table public.game_views   enable row level security;

-- games: no client policies at all. Service role bypasses RLS.
revoke all on public.games from anon, authenticated;

-- Membership predicate, security definer so it can read game_players
-- without recursing through that table's own policy.
create or replace function public.is_game_member(g uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.game_players gp
    where gp.game_id = g and gp.user_id = auth.uid()
  );
$$;

revoke all on function public.is_game_member(uuid) from public;
grant execute on function public.is_game_member(uuid) to authenticated;

grant select on public.game_players to authenticated;
create policy "members read seats" on public.game_players
  for select to authenticated
  using (public.is_game_member(game_id));

grant select on public.game_actions to authenticated;
create policy "members read actions" on public.game_actions
  for select to authenticated
  using (public.is_game_member(game_id));

grant select on public.game_views to authenticated;
create policy "own view only" on public.game_views
  for select to authenticated
  using (user_id = auth.uid());

-- No client INSERT/UPDATE/DELETE anywhere: no such policies exist and the
-- privileges are not granted.

-- §4 Realtime: only game_views, never games.
alter publication supabase_realtime add table public.game_views;
alter table public.game_views replica identity full;
