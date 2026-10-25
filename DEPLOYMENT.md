# Polynurse Exam Center - Deployment Guide

This guide provides instructions for deploying the Polynurse Exam Center platform to production using **Vercel**, **Supabase**, and **Paystack**.

## Prerequisites

1.  **Vercel Account:** For hosting the frontend and serverless API functions.
2.  **Supabase Project:** For authentication and database.
3.  **Paystack Account:** For handling payments (Live or Test mode).

---

## 1. Supabase Setup

1.  Create a new project in [Supabase](https://supabase.com).
2.  Navigate to the **SQL Editor** in your Supabase dashboard.
3.  Copy the contents of `SUPABASE_SETUP.sql` from this repository and run it to create the necessary tables, indexes, and RLS policies.
4.  Go to **Project Settings > API** and note down your:
    *   `Project URL`
    *   `anon public API key`
    *   `service_role secret key` (Keep this secret!)

## 2. Paystack Setup

1.  Create an account at [Paystack](https://paystack.com).
2.  Go to **Settings > API Keys & Webhooks**.
3.  Note down your **Public Key** and **Secret Key**.
4.  Set your **Webhook URL** to:
    `https://<your-live-domain>/api/payments/webhook`
    (e.g. `https://myapexlaprat.vercel.app/api/payments/webhook`). This URL is
    preserved by a `vercel.json` rewrite and handled by the top-level
    `api/payments-webhook.js` function. It receives real-time `charge.success`
    events so the subscription is activated even if the user closes the page
    during checkout.
5.  Set your **Callback URL** to:
    `https://<your-live-domain>/payments/verify`
    (e.g. `https://myapexlaprat.vercel.app/payments/verify`). Users are
    redirected here after a successful hosted checkout, where the app
    server-verifies the reference and activates the plan. The app also sends
    this callback URL with every `transaction/initialize` call automatically.
6.  Always use the **live** public/secret keys (`pk_live_...` / `sk_live_...`)
    for real transactions. Put both in Vercel environment variables (below) —
    never commit live keys.

## 3. Vercel Deployment

1.  Connect your GitHub repository to Vercel.
2.  Add the following **Environment Variables** in Vercel project settings:

| Variable | Description |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase Anon Public Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase Service Role Key (Server-side only) |
| `VITE_PAYSTACK_PUBLIC_KEY` | Your Paystack Public Key |
| `PAYSTACK_SECRET_KEY` | Your Paystack Secret Key (Server-side only) |
| `APP_URL` | Your production URL (e.g., `https://myapexlaprat.vercel.app`) |

3.  Deploy the project.

### `/api/*` routing requirement

This app is a **Vite SPA + Vercel Serverless Functions** project (not Next.js).
Vercel only serves `api/<name>.js` at its exact mount path, so sub-paths the
frontend calls (`/api/quota/course-status`, `/api/session/register`,
`/api/progress/difficulty`, ...) must be routed to their function base via
`vercel.json` rewrites. The committed `vercel.json` already includes these
rules **before** the `/:path*` SPA fallback. Keep them in this order or the
APIs will return HTML (SPA page) / 405 instead of JSON. Do **not** rely on
`[...path].js` catch-all files in `api/` — multi-segment catch-alls are a
Next.js feature and are not supported by Vercel filesystem functions.

---

## 4. Post-Deployment Verification

1.  **Authentication:** Sign up for a new account. You should be redirected to the `/activate` page.
2.  **Payment Flow:** Attempt to "Activate" or "Purchase License". Use Paystack test cards if in test mode.
3.  **Webhook:** After a successful payment, the `transactions` table in Supabase should populate, and a 17-character product key should be generated in the `product_keys` table.
4.  **AI Parsing:** Go to **Past Questions**, upload a PDF or Image. Ensure Tesseract/PDF.js extracts content and generates flashcards.

## 5. Security Notes

*   Ensure **Row Level Security (RLS)** is enabled in Supabase (the setup script does this).
*   Never expose `SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY` to the frontend (prefixed with `VITE_`).
*   Always verify `x-paystack-signature` in webhooks (handled in `api/payments-webhook.js`).

---

## 6. Phase 4–5 features: Nursing Licence (S8) + Loan Shark (S9)

Both are **Smart-Coin-only** and server-authoritative. They add **no** new Vercel
functions — all routes dispatch from the existing `api/quiz.js` (underscore
modules `api/_license.js` / `api/_loans.js` are not deployed as functions, so the
Hobby **12-function** budget is preserved).

### Database migrations (apply in order, all idempotent)

| File | Purpose |
| --- | --- |
| `scripts/migration-v48-license-renewal.sql` | `nursing_licenses` + `license_renewal_attempts` tables, `license_ensure`/`license_apply_result` RPCs, `license_renewal` config (100 SC / 50 Q / 80% / 24h / 12mo). |
| `scripts/migration-v49-sc-ledger-ref-id-text.sql` | Widens `smart_coin_ledger.ref_id` bigint→text so `_sc_apply` accepts a ref id (fixes a latent v31 bug). |
| `scripts/migration-v50-loan-shark.sql` | `loan_profiles` + `loans` tables, `loan` config (cap 3/10, 10%, 48h, licence 500 SC / ≥1500 balance), and the 8 loan lifecycle RPCs. |
| `scripts/migration-v51-anonymous-waiting-reconcile.sql` | Rewrites `community_membership_reconcile` to release idle seats in **waiting** rooms too (was active-only), plus a one-time stale-seat self-heal — fixes the "N/100 members" count when nobody is online. |
| `scripts/migration-v52-premium-grant-two-users.sql` | Data grant: one active `monthly` subscription (+30d / +32d grace) + `profiles.is_activated` for the two operator accounts (idempotent, `on conflict (reference) do nothing`). |
| `scripts/migration-v53-anonymous-social-events.sql` | Anonymous-room **event cards** (`anonymous_room_events`), event reactions (`anonymous_event_reactions`), member anti-slam prefs (`anonymous_room_member_prefs`), and `anonymous_encoded_messages.revealed_at`/`revealed_by` (Encoded Message public reveal). Service-role only. Idempotent. |

Apply with the Management-API helper: `node scripts/_apply-v43.mjs <file>` (needs
a valid `SUPABASE_ACCESS_TOKEN` in `.env`; HTTP 201 = ok).

### Endpoints (all require a bearer session; unauth → `401 {"error":"Unauthorized"}`)

*   `GET  /api/quiz/license-status` · `POST /api/quiz/license-start` · `POST /api/quiz/license-submit`
*   `GET  /api/loans/list` · `POST /api/loans/{request|offer|accept|repay|reject|cancel|shark-buy|default}`

### Verification

*   `npm run e2e:license-renewal` (32/32) and `npm run e2e:loan-shark` (36/36) — live.
*   `node scripts/verify-deploy-config.mjs` (235 checks) — static/deploy parity.
*   RLS/authority for both features is documented in `docs/QUIZ_SECURITY_AUDIT.md`.

> **Loan Shark default policy:** a default sweeps the borrower's *available* SC
> (never below 0) to the lender and records the default on their public loan
> history. The stronger consequence described to borrowers ("lose licences,
> achievements and all data from the first stage") is surfaced as a warning only
> and is **not** auto-executed — it would require a separate, confirmed
> account-reset action.

---

## 7. Web Push (VAPID) + WhatsApp-style reply-to-message

### No migration required

Push was a double no-op: no VAPID keys were set anywhere, and `web-push` was not
a dependency (`api/_push.js` lazy-`import('web-push')` threw → `PUSH_ENABLED=false`
→ the client showed "Push notifications are not configured on this server yet").
The v44 tables (`push_subscriptions`, `notification_preferences`) and
`public/sw.js` already exist, so **no SQL** was needed. Reply-to-message was
already implemented end-to-end; this release (a) makes the reply affordance
discoverable on touch and (b) fixes a **latent 404**: the reply-parent SELECT was
`id, group_id` only, so `isPostAlive` had no `expires_at/created_at` and judged
every parent dead → all anonymous replies 404'd `REPLY_NOT_FOUND`.

### New server dependency

*   `web-push@^3.6.7` (in `package.json`). Already `npm install`ed — run `npm install` on the deploy machine so the lockfile installs it.

### Vercel env vars (MUST set + redeploy — the whole push feature gates on these)

```env
VAPID_PUBLIC_KEY=[REDACTED - rotate before use]
VAPID_PRIVATE_KEY=[REDACTED - rotate before use]
VAPID_SUBJECT=mailto:admin@polynurse.com.ng
```

These are also in `.env` (local dev, gitignored) and `.env.example` (placeholders). `GET/POST /api/community/notifications/vapid` returns `{ok, public_key, enabled}` — `enabled:true` only when both keys are present. Push is **targeted** (mention / reply-to / Encoded recipient / member joined), fire-and-forget — it never fails a message write.

### Reply-to-message release contents

*   `src/pages/AnonymousRoom.jsx` — **swipe-to-reply**: `SWIPE_REPLY_THRESHOLD=64`, pointer handlers (`beginSwipe/moveSwipe/endSwipe/cancelSwipe`, `setPointerCapture`, horizontal-only, vertical `touch-pan-y` preserved, `prefersReducedMotion` respected, vibrate + composer focus on arm) and the message-action ⋮ button is now always visible (was hover-only).
*   `api/_community.js` — reply-parent SELECT now includes `created_at, expires_at, grace_until, last_interaction_at, is_deleted, is_hidden` so a real alive parent can be quoted (fixes the 404).

### Verification

*   `node scripts/verify-deploy-config.mjs` → **250/250** (new PART E gates: `web-push` dep, `_push.js` VAPID/web-push wiring, `/notifications/vapid` `enabled`, swipe handlers, non-hover-only trigger, `.env.example` VAPID, reply-parent lifetime columns).
*   `npm run e2e:anonymous-lifecycle` → **102/102** (10f block: quoted target posted → reply persists `reply_to_post_id` (DB-backed) → hydrated `reply` quote with `Anonymous #NN` author + excerpt → bogus target 404).
*   `npm run build` ✓; eslint 0 errors on touched files.
*   Post-deploy browser QA: open the Anonymous room → toggle push on (permission prompt) → have a second account reply / `@mention` / Encoded / join → the first device must receive a system notification; test swipe-to-reply on a phone.

---

## 8. Anonymous room — action event cards + challenge respond + anti-slam + Encoded reveal (v53)

### Migration

*   `scripts/migration-v53-anonymous-social-events.sql` (apply in order; idempotent, HTTP 201 via `node scripts/_apply-v43.mjs`). Creates `anonymous_room_events`, `anonymous_event_reactions`, `anonymous_room_member_prefs`, and adds `anonymous_encoded_messages.revealed_at`/`revealed_by`.

### Endpoints (bearer session; unauth → `401 {"error":"Unauthorized"}`)

*   `POST /api/community/anonymous/social` — `{ action, message_id? | target_alias?, group_id? }` (records a masked event card; target path resolves the alias server-side). 403 `SOCIAL_DECLINED` / `SOCIAL_BLOCKED`, 429 `SOCIAL_COOLDOWN` / `SOCIAL_RATE_LIMITED`.
*   `POST /api/community/anonymous/event` — `{ event_id, group_id? }` (single card, realtime hint path).
*   `POST /api/community/anonymous/event-react` — `{ event_id, emoji, active, group_id? }` (400 `REACTION_NOT_ALLOWED`).
*   `POST /api/community/anonymous/event-respond` — `{ event_id, respond: accept|decline, group_id? }` (accept starts a fresh fight; 409 `EVENT_RESOLVED`, 403 `NOT_AUTHORIZED`, 400 `INVALID_RESPOND`).
*   `POST /api/community/anonymous/prefs` — `{ declining_interactions?, group_id? }` (anti-slam opt-out).
*   `POST /api/community/anonymous/encoded` — `{ message_id, action?: decode|reveal|unreveal, group_id? }` (reveal = recipient-only; unreveal = author or revealer; 400 `INVALID_ACTION`/`NOT_ENCODED`, 403 `ENCODED_PRIVATE`).

### Behaviour

*   Actions/challenges/fights are standalone **event cards** interleaved with messages; the feed returns `events` (last 50, oldest-first) and `hydrateRoomMessages` adds `revealed` + `can_unreveal`.
*   A **CHALLENGE** accept records an `anonymous_fights` row and surfaces a **fight** event card; decline resolves it; **declining interactions** refuses inbound actions; an anti-slam **rate cap** (10 event cards / 60 s / actor) returns 429.
*   An Encoded Message body **never enters the feed** (any viewer) until the **recipient** publicly reveals it; the author or the revealer may take it private again.
*   Client: `src/pages/AnonymousRoom.jsx` (RoomEventCard, Actions bottom sheet, declining toggle, reveal/re-lock UI) + `src/utils/anonSound.js` tones.

### Verification

*   `npm run e2e:anonymous-lifecycle` → **133/133** (v53 block `14b` covers every contract above).
*   `node scripts/verify-deploy-config.mjs` → **266/266** (PART F v53 gates).
*   `npm run build` ✓; eslint on touched files 0/0.

## 9. Marketplace (Phase A) - first-party PolyNurse checkout

### Seed (idempotent, already applied)

*   `node scripts/seed-marketplace-platform-seller.mjs` -> `marketplace_sellers` row **`business_name = 'PolyNurse'`** (id `1`).
*   **This seller name is the checkout gate.** A product is purchasable ONLY when its
    `seller_id` resolves to that seller (matched case-insensitively in
    `api/initiate-payment.js`). Anything else is **informational only** and is refused
    **server-side** with `403 THIRD_PARTY_NOT_PURCHASABLE` - not merely hidden in the UI.
*   Tables + RLS already exist from `scripts/migration-v10-upgrade.sql`
    (`marketplace_categories` / `_sellers` / `_products` / `_purchases`). **No new migration.**

### Vercel env

No new env. `PAYSTACK_SECRET_KEY` (already set) is the only extra requirement, since
marketplace reuses the existing hosted checkout.

### `POST /api/initiate-payment` - the four products

| `product` | extra body | resolves from | reference |
|---|---|---|---|
| _(none)_ | `plan_id` | `subscription_plans.price` | `APX-…` |
| `anonymous_spectate` | `group_id` | `study_groups.spectator_price` | `APX-SPE-…` |
| `anonymous_membership` | `group_id` | `study_groups.member_price` | `APX-MEM-…` |
| `anonymous_memberships` | `group_id, count, for_me` | `price x count` | `APX-GFT-…` |
| `marketplace_product` | `product_id` | `marketplace_products.price` | `APX-MKT-…` |

Marketplace refusals (all server-authoritative): `INVALID_PRODUCT` 400 ·
`PRODUCT_NOT_FOUND` 404 · `PRODUCT_NOT_AVAILABLE` 400 (unpublished/archived) ·
**`THIRD_PARTY_NOT_PURCHASABLE` 403** · `FREE_PRODUCT` 400 · `PREMIUM_ONLY` 400 ·
`NOT_PURCHASABLE` 400 (price <= 0) · `ALREADY_OWNED` 400.

### Entitlement + amount integrity

*   `POST /api/verify-payment` (`metadata.product = 'marketplace_product'`) and
    `POST /api/payments/webhook` both call `grantMarketplaceProduct`, which re-resolves
    the product and the platform seller **server-side**, rejects a paid amount that
    differs from `price` by more than N1 (`amount_mismatch` / `400`), and inserts a
    `marketplace_purchases` row (`status = 'complete'`). **No subscription is created.**
*   Idempotent on `(user_id, product_id)` and on `reference` (`23505` ->
    `already_processed`), so the callback verifier and the webhook cannot double-grant.
*   Paystack webhook URL stays `https://www.polynurse.com.ng/api/payments/webhook`
    (`vercel.json` rewrites it to `api/payments-webhook.js`). **Must be signed with
    `PAYSTACK_SECRET_KEY`** - the handler rejects unsigned posts with 401.
*   `expected_amount_kobo` rides in the initialize metadata as a last-resort amount check.

### Routes + admin

*   `/marketplace` - storefront (`src/pages/Marketplace.jsx`), lazy route in `App.jsx`.
*   `/admin/marketplace` - admin console (`src/pages/AdminMarketplace.jsx`), gated by
    `userProfile.isAdmin` (client) **and** by `marketplace_products_admin_all` RLS
    (`public.is_admin()`), so it is enforced on both sides. Non-admins redirect to `/dashboard`.

### Verification

*   `npm run e2e:marketplace` -> **32/32**: every refusal code, first-party success
    (`amount == price x 100`, `APX-MKT-*`, `metadata.product`/`product_id`),
    verify-payment grant + replay idempotency + third-party refusal + amount mismatch,
    webhook grant/replay/bad-signature/third-party-ignored/`amount_mismatch`, and the
    storefront RLS (published visible; unpublished + archived hidden to anon).
*   `node scripts/verify-deploy-config.mjs` -> PART N marketplace gates.
*   `npm run build`; eslint on touched files 0 errors.

---

## 10. Anonymous room expansion (v62) - identity colours, RPS, and the consent-gated gag

### Migration

*   `scripts/migration-v62-anonymous-room-expansion.sql` (idempotent, **APPLIED**):
    1. Clears the stale `membership_locked` left on room 253 by the retired v54
       "auto-lock at 20" rule (v56 already removed that rule from
       `community_anonymous_join`, so the flag only ever blocked joins).
       **Free founding member seats are deliberately left at the v56 value of
       20** - a 60-seat change was reverted before this migration was ever
       applied, so the migration does not touch `founding_member_cap`.
    2. Widens `anonymous_room_events.kind` to `('action','challenge','fight','duel','announce')`
       and adds **`visible_at timestamptz default now()`** (+ partial index) for delayed lines.
    3. New `anonymous_duels` table (one bout per accepted challenge, `event_id` UNIQUE,
       `a_move`/`b_move` CHECKed, `status open|done|expired`, `a_id <> b_id`); RLS on,
       service-role only.
    4. One-time purge of >24h `anonymous_room_events` / `_reactions` / `anonymous_combat_events` /
       `anonymous_fights` - `community_cleanup` never touched these, so they grew forever.

### The capacity model (unchanged from v56)

| Rule | Value |
|---|---|
| Free founding member seats | 20 (`founding_member_cap`) |
| Room wakes at | `minimum_members_to_activate` (20 canon / 10 room 253) |
| Beyond the free seats | one-time paid member seat (`member_price`) |
| Free spectator seats | 20 (`free_spectator_cap`, unchanged) |
| Total capacity | 100 (`member_limit`, unchanged) |
| Wipe watchdog | `minimum_members_to_remain_active` (unchanged) |

Refusals: `MEMBERSHIP_LOCKED` 403 (host hard close) -> `GROUP_FULL` 403 (members +
spectators >= `member_limit`) -> `MEMBERSHIP_PAYMENT_REQUIRED` 403 (members >=
`founding_member_cap`). Add `ALREADY_SPECTATOR` when a spectator also tries to take a member seat.

### Delayed announcements need NO cron

There is **no `crons` key in `vercel.json`** and Vercel **Hobby cron is daily-only**, so a
5-minute gag cannot be timer-driven. Instead the steps are written up-front as **hidden rows**
(`visible_at` in the future) and revealed by **`revealDueAnnouncements()`**, a throttled
(10 s/room) sweep that piggy-backs on ordinary room traffic: the `/anonymous/feed` fetch, the
room open, and every realtime-triggered `reconcile()`. The feed applies the gate with
`.lte('visible_at', now)`; when a row is due it broadcasts `room_event {action:'announcement'}`
so connected clients refresh immediately. `fetchRoomEvent` uses the same gate.

> Both queries **fall back to the pre-v62 shape** when `visible_at` is missing
> (`42703`/`42P10`), so event cards keep working before the migration is applied. The sweep
> carries the same fallback - without it the bare `.lte()` failed silently and no due line
> was ever broadcast.

**A delayed row is written with `created_at = visible_at`.** That single choice makes the
ordinary `created_at` filters correct, and fixes three bugs at once:

*   **Ordering** - the feed sorts by `created_at`, so a line lands at the moment it is
    revealed instead of clustering with the original `cracked` card.
*   **The `LIMIT 50` window** - a delayed row is no longer pushed out of the feed by
    everything that happened while it waited.
*   **Expiry** - `created_at + EVENT_LIFETIME` now equals `visible_at + lifetime`, i.e. the
    card lives 10 minutes after it *appears*. (Keying expiry on `created_at` alone expired
    steps 3 and 4 at +10/+15 min before they could ever render.) `hydrateRoomEvent` also
    sends an explicit `expires_at` so the client's sweep agrees.

### The gag (non-graphic, consent-gated)

*   New action **`crack`** (`kind: 'affection'`) in `ROOM_ACTIONS`. It is a **consent
    action**: `CONSENT_ACTION_KEYS` routes it into the existing
    `kind='challenge' / status='pending'` machinery, so the **target must accept**.
    It is deliberately **not** in `server_config('anonymous_fight').attack_actions`, so it
    never starts a fight.
*   Accepted -> a `kind='announce'` card, then `GAG_STEP_MS = 5 min` apart:
    `don get belle` (**either party at random**) -> the *other* one `denied the belle`
    -> the carrier `gave birth to <random>`. Declining ends the chain; nothing is scheduled.
*   Wording lives server-side in `announcementText()` (slang only, no explicit text) and
    ships as `event.text`; the client renders it verbatim. Alias-only, never a user id.
*   `ROOM_NOTICE` bumped **v4 -> v5** so everyone re-accepts the safety notice, which now
    discloses that moves need consent and that *declining interactions* refuses everything.
*   Announcements need no system actor - they are ordinary event cards and expire with the
    normal 10-minute event lifetime, counted from when they become visible.
*   Accepting also broadcasts `room_event {action:'crack_accepted'}`; the client **must**
    treat that like `announcement` and reconcile, or nobody refetches until the next poll.

### Identity colours (72-swatch palette)

*   Aliases are `1..9999` (`anonymous_room_identities.alias check (alias between 1 and 9999)`).
    The old mapping was `(n * 47) % 360` - a linear congruential step with an **exact period
    of 360**, so alias `n` and `n+360` were byte-identical colours *by construction*, and
    aliases 8 apart were only 16 degrees apart.
*   Now an **FNV-1a hash** indexes **24 hues x 3 lightness bands = 72 swatches**. Any two
    different swatches are distinguishable (15 degrees of hue, or 12% of lightness), so a
    shared colour is an obvious identical match rather than a confusing near-miss.
*   Every swatch clears **WCAG AA (4.5:1)** against the room's `bg-slate-950`; worst case in
    the built palette is **4.82:1**. Three deep hues (240/255) carry an explicit lightness
    floor. An unparseable alias gets its own desaturated swatch instead of the old silent
    hue-220 fallback that made every unknown alias the same blue.
*   **Residual, stated plainly:** two of the room's 20 free seats can still draw the same
    swatch (~95% of 20-member rooms contain at least one such pair). That is arithmetic, not
    a bug - eliminating it needs a **server-assigned per-room colour slot** (a new migration).
    The `#NN` is therefore never hidden next to the coloured name.

### Per-action card colour + entrance animation

*   `EVENT_TONE_CLASS` replaces a 3-branch ternary that only knew `rose` and
    `violet`/`indigo`; **15 of 18 actions were rendering as the same slate card** (including
    the entire crack/belle chain). `pink` was also missing from `TAG_TONE_CLASS` entirely.
*   Each card `kind` (`action` / `challenge` / `fight` / `duel` / `announce`) gets a CSS
    keyframe entrance in `src/index.css` - deliberately **CSS, not framer-motion**, so it
    costs nothing on the render-blocking bundle. Each is a single short transform/opacity
    tween, never a loop.
*   The component omits the class when the reader prefers reduced motion (reusing the existing
    `prefersReducedMotion` helper), and the `prefers-reduced-motion` media query is the
    backstop. Accept/Decline and reaction pills stay status-keyed so the primary action
    remains the most readable thing on the card.

### RPS on an accepted challenge (opt-in)

*   `POST /api/community/anonymous/duel` (GET state) and `/anonymous/duel-pick` (throw) -
    new **regex routes in `api/community.js`**, so the **12-function Hobby cap is intact**.
    Unapplied schema returns `503 SCHEMA_NOT_READY`.
*   The bout is only **opened** when a fight card appears; the panel is fetched when the
    fighter **taps** it, so nobody is forced into a minigame.
*   Server rules: participant-only (`403 NOT_AUTHORIZED`), `status='open'`, one throw each
    (`409 DUEL_ALREADY_PICKED`, enforced with `.is(a_move|b_move, null)`), and
    **both moves stay hidden until the bout settles** (`your_throw`/`their_throw` are null
    while `status='done'` is false), so picking cannot be countered.
*   Fixed while in there: the accept `UPDATE` now carries `.eq('status','pending')`
    (two concurrent accepts previously both settled), and the fight card is published
    **with its `id`** so realtime clients fetch it instead of waiting for a refetch.

### Leave -> new Anonymous ID

*   `handleLeaveGroup` reads the alias the room already knows (no visit key, so no
    re-roll before the departure broadcast) and then **deletes the
    `anonymous_room_identities` row**, so the next join mints a fresh `Anonymous #NN`.
    The client calls `clearAnonVisitKey()` on a confirmed leave. Membership and seat are
    untouched, so re-entry still succeeds while a seat is free.

### Verification

*   `node scripts/verify-deploy-config.mjs` -> PART O gates.
*   `npm run e2e:anonymous-lifecycle` -> v62 block.
*   `npm run build`; eslint on touched files 0 errors.

---

## 11. `migration-v63-arena-escrow-lifecycle.sql` — 1v1 Arena (escrow + full lifecycle)

### Why

The 1v1 arena (v38/v58/v60) had four money-and-fairness defects, all confirmed
by audit before any code was written:

1. **The wager was never held.** `create_competitive_match` only checked that
   the *creator* was solvent. A player with 20 SC could open 20 concurrent
   20-SC matches, and a winner could be paid from money that did not exist.
2. **Two formats disagreed about a silent player.** Blitz charged a silent
   opponent `-stake`; sudden-death made the same silence a `+0` draw.
3. **Nothing was startable by both sides.** Either participant could open the
   clock alone; there was no confirmation handshake.
4. **No abandonment policy at all.** Closing the tab either left the match
   stuck `active` forever or settled it by an accident of which format it was.

### Locked decisions (confirmed with the user)

| Decision | Value |
|---|---|
| Abandonment | The leaver forfeits their stake; the other player is **refunded**. Voluntary forfeit is immediate; an unexpected drop gets a **45s reconnect grace**. |
| Escrow | **Full two-sided escrow.** Both stakes are debited at match creation, before the clock can open. |
| Format | **One format for 1v1**: blitz (40 NMCN questions / 90s). Sudden-death is removed from 1v1 for humans *and* bots. Triple Threat keeps sudden-death untouched. |
| Tie-break | **Points DESC -> correct count DESC -> DRAW.** The v58 cumulative-latency tie-break is deleted (it is not a fairness signal on mobile). |

### Scoring (identical for humans and every bot, enforced in SQL only)

| Outcome | Points |
|---|---|
| Correct | `1` |
| Correct + Double | `2` |
| Incorrect | `0` (v58 used `-1`) |
| Incorrect + Double | `0` (v58 used `-2`) |
| Skip | `0` |

`competitive_match_answers.points` is written by `arena_answer` and is the only
input to settlement. The client never sends a score.

### Pot arithmetic (escrow is already debited, so the winner is released the gross pot)

| Outcome | Released | Net |
|---|---|---|
| Win | `+2 x stake` | winner `+stake`, loser `-stake` |
| Draw | `+stake` each | `0` / `0` |
| Forfeit / grace expiry | leaver `0`, other `+stake` | leaver `-stake`, other `0` |
| Cancel / no-show / both-away | `+stake` each | `0` / `0` |

Forfeited stakes are credited to the `server_config('arena_treasury')` account
so total SC supply is conserved. With `user_id = null` the stake simply leaves
circulation.

### Schema deltas (all idempotent)

*   `competitive_matches` `+=` `creator_ready`, `opponent_ready`, `ready_at`,
    `duration_seconds`, `wager_creator_held`, `wager_opponent_held`,
    `escrow_amount`, `wager_released`, `last_seen_*`, `disconnected_*`,
    `abandoned_by`, `abandon_reason`, `grace_seconds`.
    `status` gains `ready` (`waiting|ready|active|completed|abandoned`).
*   `competitive_match_answers` `+=` `points`, `skipped`, `is_bot`; the
    `auth.users` FK on `player_id` is **dropped** so a deterministic,
    non-user bot identity can hold real graded answer rows.
*   `arena_queue` (server-side matchmaking) and `arena_match_events`
    (append-only escrow/lifecycle audit) — RLS on, **no policies**, service-role only.

### RPCs

Public (`authenticated` only, `anon`/`public` revoked):

`arena_create_match` · `arena_ready` · `arena_start` · `arena_answer` ·
`arena_heartbeat` · `arena_forfeit` · `arena_cancel` · `arena_settle` ·
`arena_state` · `arena_outcome` · `arena_enqueue` · `arena_leave_queue` ·
`arena_roster`

Internal (`service_role` only, never client-callable):

`_arena_hold` · `_arena_release` · `_arena_treasury` · `_arena_resolve` ·
`_arena_board` · `_arena_score` · `_arena_bot_turn` · `_arena_review` ·
`_arena_sweep` · `_arena_in_active_match` · the three guard triggers

### Exactly-once

Escrow uses `_sc_apply` with **deterministic** `client_request_id`
(`md5('arena:hold:'||match||':'||user)::uuid` and
`md5('arena:release:'||match||':'||user)::uuid`), on top of a per-match
`pg_advisory_xact_lock` and a terminal-status guard. A concurrent replay from
both players therefore moves coins once. Proven live by `e2e-arena` F2.

### Bots play the same game

`_arena_bot_turn` resolves the bot's answer for an index the moment the human
answers (or skips) that index, inserting a **real graded row** through the same
`points` arithmetic. Bot skill (`house` 0.55 / `zainab` 0.62 / `apollo` 0.78),
its occasional skip, and its one-time Double on the mid-board question are all
server-side. The client sends only the tutor id. A tutor match earns **no**
verified `one_v_one_wins`.

### The seal (why the legacy functions were not rewritten)

The v38/v58/v60 RPCs are still needed for Triple Threat. Rather than rewrite two
large legacy functions, the arena claims its rows at the data layer:

*   an arena match is any row with `escrow_amount > 0`;
*   an arena write is any session that called `_arena_claim_write()`.

`trg_arena_guard_match_ins` refuses a blitz INSERT (`BLITZ_REQUIRES_ARENA`);
`trg_arena_guard_match_upd` and `trg_arena_guard_answers` refuse any mutation of
an escrowed row (`ARENA_REQUIRES_ARENA_RPC`). Both raise `42501`, which aborts the
whole PostgREST transaction — including any `_sc_apply` a legacy path had already
run. So the old delta-based settlement cannot double-spend against an escrow, and
sudden-death (`escrow_amount = 0`) is completely unaffected.

> **Re-run gotcha:** the migration now begins with
> `select set_config('arena.write','1',true)` so its own pre-migration sweep does
> not trip the guard trigger it installs. Without it the second apply fails.

### Reconnect grace (no cron available)

Vercel Hobby cron is daily-only, so the grace/no-show sweep is **traffic-driven**:
`arena_state`, `arena_heartbeat`, `arena_outcome`, `arena_enqueue` and `arena_settle`
all call `_arena_sweep()` first. A player whose heartbeat stops for 10s is marked
disconnected; if they are still gone 45s later the match is forfeited for them.
Reconnecting inside the window clears the flag and play continues. If **both**
players drop, both are refunded (a shared network event is nobody's fault).

### Review / answer-key release

`_arena_review` returns the correct answer, `explanation` and `hint` for every
answered question — and returns `null` while the match is still live. Fields are
emitted only when the bank actually has them; nothing is invented (there is no
`rationale` column).

### Verification

*   `node scripts/verify-deploy-config.mjs` -> **428/428** (PART P = the 14 v63 gates).
*   `npm run e2e:arena` -> **69/69** (escrow, uniqueness, handshake, scoring,
    Double, lifecycle, grace, bots, matchmaking, secrecy, seal).
*   `npm run e2e:duel` -> **22/22** (Triple Threat still green + the blitz seal).
*   `npm run build` -> ok (`Rumble` 52.58 kB); eslint **0 errors** project-wide.
