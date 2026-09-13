-- Phase 11 (docs/phase11.md §13): each player's view row also carries the server's legal
-- action list. A client may compute most legal actions from its redacted view, but a few
-- prompts (Spy) reveal hidden cards through the list, so the authoritative list rides along.
alter table public.game_views add column legal jsonb;
