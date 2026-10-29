-- Friends and game invites (docs/phase13.md §3–§4). Three tables, written only
-- by Edge Functions (no client writes, like every other table), readable by
-- the people they concern, published so Realtime delivers changes.
--
--   profiles      one row per signed-in player: display name, wardrobe,
--                 a shareable friend code, and a heartbeat for "online".
--   friendships   requester → addressee, 'pending' until the addressee
--                 accepts; one row per pair whichever way it was asked.
--   game_invites  a friend asked you into their lobby; 'pending' until you
--                 accept (and take a seat), decline, or it lapses.

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  friend_code  text not null unique check (friend_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  avatar       jsonb,
  color        text,
  activity     text not null default 'menu' check (activity in ('menu', 'lobby', 'game')),
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table public.friendships (
  requester    uuid not null references auth.users (id) on delete cascade,
  addressee    uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- One row per pair, whichever direction: a request back is an acceptance.
create unique index friendships_pair_idx on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee_idx on public.friendships (addressee);

create table public.game_invites (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id) on delete cascade,
  from_user    uuid not null references auth.users (id) on delete cascade,
  to_user      uuid not null references auth.users (id) on delete cascade,
  -- Denormalised so the invitee, who is not a member yet, can render the card.
  from_name    text not null,
  from_avatar  jsonb,
  join_code    text not null,
  board_name   text,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
create unique index game_invites_pending_idx on public.game_invites (game_id, to_user) where status = 'pending';
create index game_invites_to_idx on public.game_invites (to_user, created_at desc);

-- Friend-or-asked predicate, security definer so the profiles policy can read
-- friendships without recursing through that table's own policy.
create or replace function public.is_connected(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where (f.requester = auth.uid() and f.addressee = other)
       or (f.addressee = auth.uid() and f.requester = other)
  );
$$;
revoke all on function public.is_connected(uuid) from public;
grant execute on function public.is_connected(uuid) to authenticated;

alter table public.profiles     enable row level security;
alter table public.friendships  enable row level security;
alter table public.game_invites enable row level security;

-- Your own profile, and the profiles of people you are friends with or have
-- a request open with. A stranger's profile (and so their friend code) is
-- never selectable; codes are looked up only inside `send-friend-request`.
grant select on public.profiles to authenticated;
create policy "own and connected profiles" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_connected(user_id));

grant select on public.friendships to authenticated;
create policy "own friendships" on public.friendships
  for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

grant select on public.game_invites to authenticated;
create policy "own invites" on public.game_invites
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.game_invites;
-- Deletes (a declined request, a removed friend) must carry the old row so
-- subscribers can tell whose row went.
alter table public.friendships replica identity full;
