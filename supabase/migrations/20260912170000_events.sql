-- Phase 7 — event log for replay and debugging (docs/phase7.md §1.2).
-- Never client-readable: no grants, no policies, not published.

create table public.game_events (
  game_id  uuid not null references public.games (id) on delete cascade,
  seq      integer not null,
  event    jsonb not null,
  primary key (game_id, seq)
);

alter table public.game_events enable row level security;
revoke all on public.game_events from anon, authenticated;

-- Phase 7 §4: portraits. A small JSON spec per seat (packages/avatars).
alter table public.game_players add column avatar jsonb;
