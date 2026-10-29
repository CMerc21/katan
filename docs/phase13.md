# Phase 13 — The home lobby, wardrobe, friends and invites

Companion to `CLAUDE.md`, `docs/phase5.md` (lobbies, seats) and `docs/phase7.md` §4 (avatars). Phase 13 replaces the parchment form at `/` with a lobby: a painted scene with your character standing in it, a wardrobe to dress them, a friend list, parties and invites. It changes no game rule; `packages/engine` is untouched.

## 1. Layout (`/`, `apps/web/src/lobby/`)

The reference was a mobile-game home lobby; we kept its composition and drew everything new (no artwork, names or marks from any commercial game).

```
┌ profile badge ┐        ┌ Katan plaque ┐         ┌ Boards hex ┐
│ (hex portrait)│        │ [Rejoin chip]│         │ (library)  │
                                                            
[Friends ]                  name ribbon                [Library ]
[Wardrobe]     (+)       ‹  CHARACTER  ›      (+)      [Editor  ]
[Games   ]   party slot     on the road    party slot  [Settings]
                       [category ▾ option Customise]
[Solo|Online]                                          [ PLAY ⚄ ]
```

- **Scene** (`LobbyScene.tsx`): a single SVG, `xMidYMax slice`, in flat painted layers: sky gradient, sun and glow, blurred drifting clouds, birds, two mountain ranges (seeded, low in the middle so the sun and town stay clear), a walled town with pennants, a treeline, the meadow, a cobbled road in perspective, and wheat on both sides in four sway groups. Every scatter comes from a fixed mulberry32 seed, never `Math.random`, so the server render and the client render are identical. A vignette darkens the edges.
- **Showcase**: your figure (`Figure.tsx`, §2) at `min(46vh, 25rem)` with an idle breathing loop and a bounce when the look changes; a ribbon with your name and an epithet (`titleFor`: "the Falconer", "the Crowned", …); arrows that step the category picked in the plaque under the feet; Customise opens the wardrobe. Clicking the figure opens it too.
- **Party slots** either side (a third on wide screens when the party seats 4+): a seated friend's figure with Ready / In party / Bot, a pending invite as a faded "Invited…" figure, or an empty hex with a "+person" glyph that opens Friends. Hidden below 640 px, where Friends is one tap away on the rail.
- **Corners**: profile badge (hex portrait, name, friend code, sign in/out); the Katan plaque with a Rejoin chip when a game of yours is in play; the Boards hex (library). **Rails**: Friends (badge: requests + invites waiting), Wardrobe, Games (opens Online with your games) on the left; Library, Editor, Settings (the HUD's `SettingsBody`) on the right. Below 640 px the rail buttons drop their labels.
- **Solo / Online** segmented switch bottom left; signed-in players start on Online, guests on Solo. **Play** bottom right opens the Play sheet: Solo is the hotseat form (`HotseatStart`, seat 1 wearing your wardrobe); Online is the Phase 5 create / join forms plus "Open lobby" for your party and "Your games". The forms keep their test ids (`count-3`, `start`, `create-lobby`, `join-code-input`, …), so the specs only gained a click on `lobby-play`.
- **Panels** slide in (220 ms), never modal: Friends from the left; Wardrobe, Play and Settings from the right. One at a time; Esc or × closes. All motion stops under `prefers-reduced-motion`.
- Styles in `src/styles/lobby.css` (`lb-*`): dark slate plaques with a gilt edge, the gold call-to-action, hex frames, the ribbon, the keyframes.

## 2. Character and wardrobe

- **Figure** (`packages/avatars/src/figure.ts`, `renderFigure`): the portrait's head (`headLayers`, now shared by `renderAvatar`) on a standing body, viewBox `0 0 120 228`, feet on y 212. `garment` picks the outfit (tunic with belt, ankle robe with sash, quilted gambeson, cloak over a tunic, apron over a tunic), `accessory` is carried (quill, tankard, lantern from the hand) or perched (hawk on the shoulder). Same flat shapes and ink outline as the portrait. The spec is unchanged, so every stored seat avatar draws a figure.
- **Wardrobe** (`src/lobby/wardrobe.ts`, pure, unit tested): `{ avatar, color, name }`. Categories over the layers: Outfit (garment + colour), Headwear, Accessory, Hair (hair, colour, facial hair), Face (skin, face, eyes, brows, mouth). `equip`, `cycle`, `withColor`, `withName`, `shuffle`, `parseWardrobe` (field-by-field fallback for untrusted storage), `titleFor`, `wornSummary`.
- **Panel** (`WardrobePanel.tsx`): tabs, a tile per option drawn with that option applied (body layers as a small figure, head layers as a portrait), colour swatches, Shuffle, a name field for guests. Every click equips immediately; there is no Save.
- **Storage** (`useWardrobe.ts`): `localStorage["katan.wardrobe"]` on every change; for a signed-in player also `save-profile`, debounced 800 ms. On arrival a profile that already has a look wins; one without gets the local look.
- **Into a seat**: `create-lobby` and `join-game` accept optional `avatar` and `color`; the server validates the avatar (`isAvatarSpec`, else the seeded default) and treats the colour as a preference (taken → the next free one). The Play sheet, the lobby page's join-by-code and invite acceptance (which reads the profile) all pass it.

## 3. Friends

Schema in `supabase/migrations/20261029170000_social.sql`; logic in `packages/server/src/social-service.ts`.

- **profiles**: `user_id`, `display_name`, `friend_code` (8 characters from the join-code alphabet, unique), `avatar`, `color`, `activity` (`menu | lobby | game`), `last_seen_at`. Created on first contact by `touch-profile` (name from `auth.users` metadata or the email's local part).
- **friendships**: `(requester, addressee)`, `pending | accepted`, one row per pair whichever way (unique index on `least/greatest`).
- **RLS**: you read your own profile and those of people you are friends with or have a request open with (`is_connected`, security definer); never a stranger's, so codes cannot be harvested. You read friendships you are part of. No client writes on any of the three tables.
- **Functions**: `send-friend-request { code }` (by code only, never by email; a request back accepts; repeats are idempotent; your own code, unknown codes and existing friends are refused; at most 50 open outgoing), `respond-friend-request { fromUserId, accept }` (declining deletes), `remove-friend { userId }` (unfriend or withdraw; cancels pending invites between the two), `save-profile { name?, avatar?, color? }`, `touch-profile { activity }`.
- **Online** is a heartbeat, not Presence: the client calls `touch-profile` on arrival, every 45 s, on tab wake and when the route changes (`/lobby` → lobby, `/play` → game); a profile seen within 2 minutes is online. This works under RLS without a shared presence channel that would list every online user.
- **Client** (`src/social/`): `model.ts` (pure, unit tested) maps rows, splits the list into **Online** (free ones first, then in a lobby, then in a game), **Offline** (most recently seen first) and **Pending requests** (incoming with Accept / Decline, outgoing with Cancel). `SocialProvider` (mounted in the root layout) loads, subscribes over Realtime to `friendships`, `game_invites` and `profiles` (refetching on any change, debounced 150 ms) and exposes `useSocial()`. The context's clock ticks every 15 s; toast expiry is checked every second inside the reducer.
- **Panel** (`FriendsPanel.tsx`): your code with Copy, an add-by-code form, Game invites (when any), **Invite to your party**, Online, Offline, Pending requests. Remove asks "Sure?" first. Without an account it explains and offers sign-in.

## 4. Parties and invites

- **Party** (`useParty.ts`): your newest open lobby (from `lobby_games`), its seats live over Realtime. Inviting with no party opens one (Beginner, 4 seats) and stays on the home screen; the slots fill as friends accept. Online Play offers "Open lobby" to go and start it.
- **game_invites**: `game_id`, `from_user`, `to_user`, the sender's name and portrait, the join code and board name (denormalised, because the invitee is not a member yet and cannot read the lobby), `pending | accepted | declined | expired | cancelled`. One pending invite per (game, invitee): re-sending cancels the old one and toasts again. RLS: sender and invitee only.
- **send-invite { gameId, toUserId }**: you must sit in the lobby, it must not have started or be full, they must be an accepted friend and not seated already.
- **respond-invite { inviteId, accept }**: decline marks it declined. Accept takes a seat through `joinGame` with the invitee's profile name, wardrobe and colour and returns the join code; the client goes to `/lobby/[code]`. An invite older than 15 minutes, a started game or a full lobby marks it expired and returns `INVITE_EXPIRED` / `GAME_NOT_ACTIVE` / `LOBBY_FULL`.
- **Invite in a lobby**: `/lobby/[code]` lists online friends with Invite / Invited / Seated / Full.

### 4.1 Notifications (`InviteToasts.tsx`)

An invite insert on the Realtime channel goes straight into the toast reducer (`toastReducer` in `model.ts`) before the refetch. A toast slides in at the top right (260 ms), shows the sender's portrait, "Ana invites you to play", the board and lobby code, Accept and Decline, a × ("Later") and a thin gilt timer bar. It never takes focus; the stack is a polite live region. After 12 s it folds away into the Friends panel's Game invites list (the badge on Friends counts it). At most 3 toasts show; a newer invite to the same game replaces the older toast; settled invites (accepted elsewhere, cancelled) drop out on the next sync; each invite toasts once per visit, including ones already waiting when you arrive.

## 5. Tests

| Where | What |
|---|---|
| `packages/avatars/test/avatars.test.ts` | every outfit × accessory figure is well-formed, coloured and distinct; head layers change the figure |
| `packages/server/test/social.test.ts` | profile creation and codes; saving the wardrobe; requests by code, mutual accept, idempotence, refusals; respond / withdraw / unfriend; RLS on profiles, friendships and invites (and no client writes); invites only to friends in your lobby, re-send replaces, accept seats with the wardrobe, decline, TTL, started game, full lobby, unfriend cancels |
| `apps/web/test/lobby.test.ts` | wardrobe categories cover every layer once, equip / cycle / colour / name / shuffle / parse, epithets; friend grouping and order, status text, invitable states, row mapping; the toast reducer |
| `apps/web/e2e/home.spec.ts` | the lobby renders; wardrobe and arrows change the figure at once and survive a reload; panels open and close; Friends explains sign-in; Solo play starts a game with seat 1 in the wardrobe's look |

The existing hotseat specs that start at `/` click `lobby-play` first; `online.spec.ts` clicks Online then Play.

## 6. Deviations and what still needs a Supabase stack

- The migration file name was written by hand with a timestamp (`20261029170000`) that sorts after the last applied one; the dev container has no Supabase CLI for `supabase migration new`.
- Realtime delivery of `game_invites` / `friendships` / `profiles` changes, and the toasts arriving in a second browser, are not verified here (no Docker, so no `supabase start`). The server side runs against local Postgres with the real migrations and RLS.
- There is no matchmaking or account level; "Play" means set up a table. The reference's shop, currencies and leaderboards have no counterpart.
