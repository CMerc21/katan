-- Chat transport for online games (docs/phase12.md §3, Chat): one row per
-- message, written only by the `send-chat` Edge Function (no client writes,
-- like every other table), readable by the game's members, published so the
-- per-game Realtime channel delivers inserts.

create table public.game_chat (
  id         bigserial primary key,
  game_id    uuid not null references public.games (id) on delete cascade,
  player_id  text not null,
  text       text not null check (char_length(text) between 1 and 400),
  created_at timestamptz not null default now()
);
create index game_chat_game_idx on public.game_chat (game_id, id);

alter table public.game_chat enable row level security;
grant select on public.game_chat to authenticated;
create policy "members read chat" on public.game_chat
  for select to authenticated
  using (public.is_game_member(game_id));

alter publication supabase_realtime add table public.game_chat;
