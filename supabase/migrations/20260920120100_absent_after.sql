-- The absent-player threshold is a per-game setting the host picks when
-- creating the lobby (docs/phase5.md §4): how long a waited-on player must be
-- unseen before the host may hand their seat to a bot. It used to be a fixed
-- ten minutes. Between two and thirty minutes, stored in milliseconds.

alter table public.lobbies add column absent_after_ms integer not null default 600000
  check (absent_after_ms between 120000 and 1800000);

create or replace view public.lobby_games with (security_invoker = true) as
  select game_id as id, join_code, status, host_user_id, max_players, board, winner, created_at, absent_after_ms
  from public.lobbies;
