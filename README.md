# Katan

An online hex settlement-building game for 3 to 4 friends. Original rules
(`docs/rules.md`), original art, seeded randomness, server-authoritative
state, and computer players for empty seats.

## How to play with friends

1. Open the site and sign in with your email (we send a link and a code; no password).
2. **Create game**, pick the board and player count.
3. Share the **invite link** (or the 6-letter code) from the lobby. Friends sign in the same way and land in your lobby.
4. Short a player? **Add bot** (easy, medium or hard). Everyone presses **I'm ready**; the host presses **Start game**.
5. Play. The screen always says who the game is waiting for. If someone has to leave, they can press **Let a bot play for me** and take the seat back later; the host can hand an absent player's seat to a bot after 10 minutes.

Prefer one screen? **Hotseat** plays on a single device, passing it around, with optional bot seats.

## Run it locally

```
pnpm install
pnpm test                 # engine, bots, server (needs Postgres), web
pnpm --filter web dev     # http://localhost:3000 — hotseat works with no setup
```

Online play locally needs the Supabase CLI and Docker:

```
supabase start                       # local Postgres, auth, realtime, functions
supabase db reset                    # apply supabase/migrations
pnpm build:functions                 # bundle engine + bots + server for Deno
supabase functions serve --env-file .env.local
pnpm seed:local                      # two users + a game vs a medium bot
cp .env.example .env.local           # then fill NEXT_PUBLIC_* from `supabase status`
pnpm --filter web dev
```

Magic-link emails for the local stack land in Inbucket at http://127.0.0.1:54324.

## Deploy

**Supabase**

```
supabase link --project-ref <ref>
supabase db push                     # migrations; Realtime is enabled on game_views, game_players, lobbies only
pnpm deploy:functions                # = pnpm build:functions && supabase functions deploy
```

The hosted runtime injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` into every function, so no
secrets need to be set for the functions to run. In **Authentication → URL
Configuration**, set the Site URL to your web domain and add
`https://<your-domain>/**` and `http://localhost:3000/**` as redirect URLs.

**Vercel**

Import the repository, set **Root Directory** to `apps/web` (framework
Next.js; pnpm is detected from the root lockfile and workspace packages are
transpiled from source), and add `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Everything else in `.env.example` is for
local development and tests only. Never put the service role key in the web app.

## Layout

| Path | What |
|---|---|
| `packages/engine` | Pure rules engine, seeded RNG, redaction. 100+ tests including 200 random full games. |
| `packages/bots` | Easy / medium / hard policies over redacted views. |
| `packages/server` | Transactional game and lobby logic over Postgres, shared by the Edge Functions and tests. |
| `supabase/` | Migrations (RLS: clients read only their own view), config, Edge Functions. |
| `apps/web` | Next.js client: SVG board, hotseat driver, Supabase driver, lobby. |
| `docs/` | `rules.md` (source of truth) and the phase documents. |

See `CLAUDE.md` for conventions and the phase plan.
