# Community Reset + Ephemeral Posts + Anonymous Group System

Spec: **"POLYNURSE — COMMUNITY RESET + EPHEMERAL POSTS + ANONYMOUS GROUP SYSTEM"**.
Applies via `scripts/migration-v29-community-ephemeral-anonymous.sql`
(`node scripts/run-migration.mjs scripts/migration-v29-community-ephemeral-anonymous.sql`,
requires a fresh `SUPABASE_ACCESS_TOKEN`).

---

## 1. Community Reset — one general feed

- All eight section boards are merged into a **single `general` feed**.
  `study_sections` and section-based grouping are gone from the UI.
- `src/data/communitySections.js` exports `general` only (`SECTION_ORDER = ['general']`);
  `getSection` falls back to general so legacy importers keep working.
- `src/pages/Community.jsx` renders one feed: `activeSection = 'all'`, no section tabs,
  no composer section picker. Group-scoped posts live in the Study Groups feed
  (feed query filters `.is('group_id', null)`).
- Old section rows keep their existing `section` column value but are simply shown
  together in the one feed.

## 2. Ephemeral posts (server-authoritative)

Lifecycle is computed **on the server**; the client only renders what the server says.

| Field | Meaning | Source |
|---|---|---|
| `grace_until` | Legacy posts written before the reset get `now()+24h` (`NOT NULL` ⇒ grace phase). | migration backfill |
| `last_interaction_at` | last like/reply/comment date — bumped by `bumpInteraction`. | `api/_community.js` |
| `lives_until` | `coalesce(grace_until, coalesce(last_interaction_at, created_at) + '1 hour')`, computed by the `community_post_lives_until` SECURITY DEFINER function. | view/RPC |
| `post_state` | `'active'` within `last_interaction_at + 110s`, otherwise `'cold'`. | view/RPC (server clock) |
| wipe | `community_cleanup` purges posts once `now() > lives_until` (hard delete → cascades comments/likes/shares; reported posts are soft-hidden and retained for moderation). | cron via `/api/community/cleanup` |

**Interaction bump rate limiting** (`api/_community.js bumpInteraction`): the
`last_interaction_at` update has a guard
`or(last_interaction_at.is.null,last_interaction_at.lt.<now-15s>)`, so a second
interaction within **15 seconds** cannot extend a post's life. One user cannot
ping-pong liked/unliked to keep a post alive forever.

**Client behavior** (`Community.jsx`):
- Ephemeral badges — green **Live** while `post_state === 'active'`, amber
  **Expiring soon** (+ `· gone <relative>` on the timestamp) while `'cold'`.
- A 15s + window-focus poll refetches page 0 so badges/counts stay fresh between
  realtime events; the single reload keeps handles on `community_post_lives_until`.

**Cleanup endpoint**: `POST /api/community/cleanup` requires
`Authorization: Bearer <COMMUNITY_CLEANUP_TOKEN>` (env `COMMUNITY_CLEANUP_TOKEN`,
mirrored to Vercel). Without it the endpoint answers **503 `CLEANUP_NOT_CONFIGURED`**.
Set the token in `.env` and as a Vercel env var, then schedule a cron
(e.g. every 15 min) against `/api/community/cleanup` with that bearer token.

> Env note: `SUPABASE_ACCESS_TOKEN` is currently missing → migration v29 cannot be
> applied from this box yet (APPLY SKIPPED). `COMMUNITY_CLEANUP_TOKEN` is also
> unset until configured.

## 3. Server-authoritative write layer (RLS lockdown)

Migration v29 removes client write RLS from `community_posts`, `community_comments`,
`community_post_likes`, `community_reports`. **All** writes go through
`POST /api/community/*` (service role):

| Endpoint | Body | Notes |
|---|---|---|
| `/posts` | `{ content?, image_url?, group_id? }` | author must not be banned; ordinary groups require viewer access; anonymous groups members-only (spectators **cannot** post); auto-live; returns 400 `SPECTATOR_READ_ONLY` / `ANONYMOUS_MEMBERS_ONLY` |
| `/posts/reply` | `{ post_id, content }` | returns `{ comment }`; post must still be alive |
| `/posts/like` | `{ post_id, liked }` | single toggle endpoint; rate-limited bump |
| `/posts/delete` | `{ post_id }` | author or hyper admin; soft-delete (`is_deleted`) |
| `/posts/edit` | `{ post_id, content?, image_url? }` | author only |
| `/posts/edit-comment` | `{ comment_id, content }` | comment author only |
| `/posts/delete-comment` | `{ comment_id }` | comment author or admin; soft-delete (`is_deleted`) |
| `/posts/report` | `{ post_id, reason }` | + quoted content snapshot |
| `/groups/join` | `{ group_id }` | anonymous rooms only |
| `/groups/leave` | `{ group_id }` | anonymous rooms only |
| `/groups/panel` | `{ group_id }` | panel JSON (below) |
| `/groups/feed` | `{ group_id, limit? }` | auth-gated masked feed |
| `/cleanup` | — | bearer-gated wipe/expiry sweep |

Public reads stay on Supabase: `community_feed` view (general + ordinary group posts,
expiry-filtered) and `community_comments` (RLS read gate). The client helper is
`communityApi(session, path, body)` in `src/utils/communityApi.js`
(`authHeaders` + `X-Session-Id`).

## 4. Anonymous group system

**The room** (`type='anonymous'`, `privacy='restricted'`, one seeded "Anonymous" row):
- `group_state`: `waiting` → `active` → `wiped` (terminal; never re-opens).
- `minimum_members_to_activate` = 30 — at the 30th join the group auto-activates.
- `minimum_members_to_remain_active` = 18 — an active group drops below this and
  gets wiped.
- `spectator_price` = ₦599 — non-members can watch ONLY while active.

| Hook | Behavior |
|---|---|
| `community_panel(p_group, p_user)` | `{ok,id,name,description,type,privacy,group_state,is_active,spectator_price,minimum_members_to_activate,minimum_members_to_remain_active,can_view,my_role,member_count}`. **`member_count` is public while `waiting`** (waitlist "X/30" progress for joiners) and hidden the moment the room is active (or for blocked user types). |
| `community_anonymous_join` | advisory-lock serialized; refusals: `NOT_FOUND`, `NOT_ANONYMOUS`, `GROUP_WIPED`, `ALREADY_SPECTATOR`, `BANNED`, `GROUP_ACTIVE` (at 30); last joined member triggers activation. |
| `community_anonymous_leave` | owner cannot leave; a leave on an active room that drops the count under 18 performs the wipe inline. |
| `community_anonymous_wipe` | sets `wiped` + `is_active=false`, soft-hides the room's posts (`is_deleted`+`is_hidden`), revokes spectators, deletes memberships. |
| `community_group_feed` | auth-gated by `can_view`; **identity-masked for anonymous rooms** — `display_name` = `'Anonymous Member'`, `avatar_url`/`year` = `null` (required because `community_profiles` is globally readable by authenticated users). |
| `community_member_count` | active (non-banned) member count; granted EXECUTE to `authenticated` for the Study Groups list counter. |

**Spectator purchase** (hosted Paystack checkout, mirrors `Activate.jsx`):
`POST /api/initiate-payment {product:'anonymous_spectate', group_id}` →
`{authorization_url}` → `window.location.assign` → Paystack redirects to
`/payments/verify`. Requires room type anonymous, `group_state='active'`,
price > 0, buyer not a member/active spectator. Payment lands on `/api/verify-payment`
(grants an `anonymous_spectators` row) and the webhook confirms.

**Read model for anonymous UIs** (`GroupPage.jsx` / `StudyGroups.jsx`):
- waiting → "X/30 joined", **Join as Anonymous**; members see the board, outsiders don't.
- active → members/spectators see the masked board; outsiders see "Membership closed"
  + **Watch as Spectator — ₦599**; spectators can read & react but **cannot post**.
- wiped → "This room was wiped." card; board hidden; join = `GROUP_WIPED`.
- Members/Leadership tabs are hidden for anonymous rooms (no identity leak);
  the group quiz sprint CTA is hidden too.

## 5. Seeding

The seed lives inside the migration (idempotent): an admin-anchored `Anonymous`
group (type `anonymous`, privacy `restricted`, 30/18/₦599, `group_state='waiting'`)
created only when no `type='anonymous'` row exists.

## 6. Deployment notes (Vercel)

- `api/community.js` is the **12th** top-level Serverless Function
  (`verify-deploy-config.mjs` gates `<= 12`).
- `vercel.json` rewrites `/api/community/:path* → /api/community`
  (sub-path router, like `api/quiz.js`); `scripts/serve-api.mjs` mirrors it.
- `api/_community.js` is underscore-prefixed → never deployed as a function.
- E2E: `npm run e2e:community-ephemeral` (browser: no section tabs, Live → Expiring
  soon → gone via injected time) and `npm run e2e:anonymous-lifecycle` (service-role
  RPC lifecycle on a throwaway scratch room).