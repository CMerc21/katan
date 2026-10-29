-- Usernames for friend search (docs/phase13.md §3.1): every profile gets a
-- unique lowercase handle (3–20 of a–z, 0–9, _), assigned on first contact
-- from the display name and changeable with `set-username`. Search runs only
-- inside the `search-players` Edge Function (prefix match, a few results),
-- so the profiles select policy stays as it is: a stranger's row is never
-- selectable by a client.

alter table public.profiles add column username text;

-- Existing profiles: the display name squeezed to the handle alphabet, or
-- "settler" when nothing is left, plus a short suffix from the user id so
-- the backfill cannot collide.
update public.profiles
set username = left(
      coalesce(nullif(left(regexp_replace(lower(display_name), '[^a-z0-9_]', '', 'g'), 13), ''), 'settler'),
      13
    ) || '_' || substr(md5(user_id::text), 1, 6)
where username is null;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  add constraint profiles_username_key unique (username);

-- Prefix search on the handle.
create index profiles_username_prefix_idx on public.profiles (username text_pattern_ops);
