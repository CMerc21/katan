-- Phase 8 — generalized boards and the editor (docs/phase8.md §4–§5).

-- 5–6 players: two more seat colours and a higher cap.
alter table public.game_players drop constraint game_players_color_check;
alter table public.game_players add constraint game_players_color_check check (color in ('red', 'blue', 'orange', 'white', 'green', 'brown'));
alter table public.games drop constraint games_max_players_check;
alter table public.games add constraint games_max_players_check check (max_players between 3 and 6);

-- A lobby may pick a custom board; its definition is snapshotted into the game so later edits never touch a running game.
alter table public.games drop constraint games_board_check;
alter table public.games add constraint games_board_check check (board in ('beginner', 'random', 'custom'));
alter table public.games add column board_definition jsonb;
alter table public.lobbies add column board_name text;

-- Saved boards (docs/phase8.md §4.3). Owners have full access; anyone signed in may read public boards.
create table public.boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id),
  name        text not null,
  definition  jsonb not null,
  is_public   boolean not null default false,
  forked_from uuid references public.boards (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index boards_owner_idx on public.boards (owner_id);
create index boards_public_idx on public.boards (is_public) where is_public;

alter table public.boards enable row level security;
grant select on public.boards to authenticated;
create policy "owner reads own boards" on public.boards for select to authenticated using (owner_id = auth.uid());
create policy "anyone reads public boards" on public.boards for select to authenticated using (is_public);
-- Writes go through the save-board / delete-board / fork-board Edge Functions (service role).

-- The lobby list shows the chosen board's name.
create or replace view public.lobby_games with (security_invoker = true) as
  select game_id as id, join_code, status, host_user_id, max_players, board, winner, created_at, board_name
  from public.lobbies;
