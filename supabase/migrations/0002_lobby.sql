-- Phase 5 — lobby, readiness, bots, presence (docs/phase5.md §1.1).

alter table public.games add column join_code text unique;
alter table public.games add column host_user_id uuid references auth.users (id);
alter table public.games add column max_players integer not null default 4 check (max_players between 3 and 4);
alter table public.games add column board text not null default 'beginner' check (board in ('beginner', 'random'));

alter table public.game_players add column ready boolean not null default false;
alter table public.game_players add column bot_level text check (bot_level in ('easy', 'medium', 'hard'));
alter table public.game_players add column last_seen_at timestamptz;
alter table public.game_players add column joined_at timestamptz not null default now();
alter table public.game_players add constraint bot_level_only_for_bots
  check ((kind = 'bot') = (bot_level is not null));

-- Join codes are unique among non-ended games only.
alter table public.games drop constraint games_join_code_key;
create unique index games_join_code_live_idx on public.games (join_code) where status <> 'ended';

-- Client-readable lobby projection (no state, no seed). Realtime cannot
-- publish a view, so this is a table kept in step with `games` by the
-- Edge Functions inside the same transaction.
create table public.lobbies (
  game_id       uuid primary key references public.games (id) on delete cascade,
  join_code     text not null,
  status        text not null check (status in ('lobby', 'active', 'ended')),
  host_user_id  uuid references auth.users (id),
  max_players   integer not null,
  board         text not null,
  winner        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create view public.lobby_games with (security_invoker = true) as
  select game_id as id, join_code, status, host_user_id, max_players, board, winner, created_at
  from public.lobbies;

alter table public.lobbies enable row level security;
grant select on public.lobbies to authenticated;
grant select on public.lobby_games to authenticated;
create policy "members read lobby" on public.lobbies
  for select to authenticated
  using (public.is_game_member(game_id));

-- Lobby screens react to seat changes and to the status flip on start.
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.lobbies;
alter table public.game_players replica identity full;
alter table public.lobbies replica identity full;
