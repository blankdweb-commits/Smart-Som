# LIVE EVENTS — admin console 403, the LE-0..LE-5 repair, and the v99 anonymous event clock

**Status:** IMPLEMENTED + VERIFIED. Nothing committed, nothing pushed.
**Scope:** the admin Live Events console (`/admin/live-events`), the participant
surface (`/live-events`, `/live-events/:id`), and the v99 change that turned the
Anonymous Room into a timed live event.

---

## 1. The problem this plan closes

The admin Live Events console was refused with a **bare 403** and a **free-text
error body**. Three separate defects sat behind that one symptom:

1. A missing service key surfaced as a **500 that blamed the caller**, and a
   *failed* admin lookup surfaced as a **403** — i.e. a server fault was reported
   as a permissions decision, so the operator was told to log in as somebody else.
2. The deadline grid disagreed with what the database actually held, so a
   deadline that looked right in the console was a different instant on the wire.
3. A **draft event leaked to non-admins** (it was filtered in the payload rather
   than in the query), and the message window was the *oldest* 50 instead of the
   newest 50.

## 2. The contract (LE-0..LE-5)

Every rule below is pinned by a gate in `scripts/verify-deploy-config.mjs` **PART Z**
that names the PROPERTY, not the implementation, so the gate still bites if the
code is rewritten. Every PART Z gate is additionally **negative-tested** by
`scripts/verify-live-events-negative.mjs`, which breaks the source on purpose and
proves the gate FAILS.

| # | Rule | Where |
|---|------|-------|
| **LE-0** | Every refusal leaves the router as `{ error: <CODE>, message: <human text> }`. The refusal log carries the code, the status and the event id **only** — never a token, a user, or a body. The client reads the **server** message first; `LIVE_EVENT_ERROR_COPY` is a fallback, not the source of truth. | `api/_community.js` (`LIVE_EVENT_ERROR_MESSAGES`, `liveEventErrorCode`, `withLiveEventErrors`), `api/community.js` (the router wraps every live-events route), `src/utils/liveEventsApi.js` |
| **LE-1** | One minute grid, everywhere: `truncateToMinute` / `toMinuteIso` / `parseLiveEventTime`. A naive `YYYY-MM-DDTHH:mm` is read as **UTC**, never as the server's local zone. The admin console edits in **local** time and submits an **absolute instant**; the stored value is minute-truncated. | `api/_community.js`, `src/pages/AdminLiveEvents.jsx` (`toLocalInputValue` / `fromLocalInputValue`) |
| **LE-2** | `status` is **not editable** through `update`. The lifecycle owns the transitions, so a field patch can never move an event sideways. | `api/_community.js` (`handleUpdateLiveEvent`), `src/pages/AdminLiveEvents.jsx` (the patch object carries no status) |
| **LE-3** | A draft is filtered in the **QUERY** for a non-admin (`status != 'draft'`), never hidden in the payload. The message window is the **newest 50**, rendered **oldest-first**. | `api/_community.js` (`handleListLiveEvents`, `handleGetLiveEvent`) |
| **LE-4** | `closed` and `cancelled` are **terminal**: refused by `update` AND by every transition (`TERMINAL`). The admin console marks a terminal event **read-only** and keeps the lifecycle actions **inside the modal**, so they are always reachable. The list is re-read from the server after every mutation. | `api/_community.js` (`handleCloseLiveEvent`, `handleSetLiveEventStatus`), `src/pages/AdminLiveEvents.jsx` |
| **LE-5** | A missing server configuration is **503 `SERVER_CONFIG`** that **names what is missing** (`detail: { missing: [...] }`); a **failed admin lookup** is **503 `ADMIN_LOOKUP_UNAVAILABLE`** — only a real non-admin is a 403. Every handler resolves its database through `liveEventsDb(res)`; every admin-gated handler goes through `requireLiveEventAdmin(res, user)`. The service key may be `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_SECRET_KEY`. | `api/_community.js`, `api/_utils.js` |

**Routes** (`api/community.js`): `list`, `get`, `create`, `update`, `publish`,
`start`, `cancel`, `close`, `send`, `react` — all under `/live-events/*`.

**Client**: `src/pages/AdminLiveEvents.jsx` (console), `src/pages/LiveEvents.jsx`
(participant list), `src/pages/LiveEventRoom.jsx` (participant room),
`src/utils/liveEventsApi.js` (client wrapper + error copy).

## 3. The v99 anonymous event clock (the other half of this session)

`scripts/migration-v99-anonymous-live-event.sql` turns the Anonymous Room into a
**timed live event**:

- The clock **starts on activation** (a BEFORE UPDATE trigger), so an activated
  room runs a 40–60 minute window (`event_started_at` / `event_ends_at` /
  `event_duration_minutes`, with a CHECK that the window is exact).
- While the window runs, `community_membership_reconcile` touches **nothing**:
  no idle release, no wipe, the idle member keeps their seat. The 15-minute idle
  deadline belongs to an open-ended room, not to a timed event, so the watchdog is
  **suspended**, not re-tuned.
- Once the window has elapsed, the watchdog **resumes** (release + wipe) and the
  writes are refused with `EVENT_ENDED`.
- `event_live` is true only when `event_started_at IS NOT NULL`,
  `event_ended_at IS NULL`, `event_ends_at IS NOT NULL` and `now() < event_ends_at`.
- The API asks the **database** whether the event is over (`_anon_event_over`),
  fails **closed** with 503 `EVENT_STATE_UNAVAILABLE` when the predicate cannot be
  read, and answers 403 `EVENT_ENDED` when it can.

## 4. Files

| File | Role |
|------|------|
| `scripts/migration-v102-live-events.sql` | `live_events` + `live_event_messages` (admin entity, separate from the Anonymous Room) |
| `scripts/migration-v103-live-event-reactions.sql` | `live_event_reactions` (one emoji per user per message) |
| `scripts/migration-v99-anonymous-live-event.sql` | the anonymous event clock, `_anon_event_over`, the reconcile override and the triggers |
| `api/_community.js` | the live-events handlers + the LE-0..LE-5 contract |
| `api/community.js` | the routes + the `withLiveEventErrors` wrapper |
| `api/_utils.js` | `SUPABASE_SECRET_KEY` fallback |
| `src/utils/liveEventsApi.js` | client wrapper, `LIVE_EVENT_ERROR_COPY`, `liveEventError` |
| `src/pages/AdminLiveEvents.jsx` | the admin console (local-minute editing, modal lifecycle actions, read-only terminal events) |
| `src/pages/LiveEvents.jsx`, `src/pages/LiveEventRoom.jsx` | participant list + room |
| `scripts/e2e-live-events.mjs` | `npm run e2e:live-events` — **41/41**, exercises the REAL router against the live DB |
| `scripts/verify-live-events-negative.mjs` | `npm run verify:live-events-negative` — **21/21** mutations, each proven to fail its gate |
| `scripts/verify-deploy-config.mjs` | PART Z — the 21 static gates |
| `scripts/e2e-anonymous-lifecycle.mjs` | the v99 contract (**203/203**) |

## 5. Verification

| Suite | Result |
|-------|--------|
| `npm run e2e:live-events` | **41/41** |
| `npm run verify:live-events-negative` | **21/21** mutations pass, verifier green again |
| `node scripts/verify-deploy-config.mjs` | **742 passed, 0 failed** |
| `npm run e2e:anonymous-lifecycle` | **203/203** (was 188/194 — six stale assertions rewritten) |
| `npm run e2e:community-ephemeral` | 12/12 |
| `npm run e2e:social-hub` | 45/45 |
| `npm run build` | OK |

**The six stale assertions** (all caused by v99, all rewritten to state the
NEW contract rather than deleted):

1. the reconcile released an idle seat → while the event is **live** it releases
   **nothing** and the idle member **keeps** their seat;
2. the released member's feed was refused → the room is no longer released, so
   the refusal moved to a room whose event is **over** (`CLOSED` / `EVENT_ENDED`);
3. the released member could not send → same, re-pointed at the ended room;
4. the roster listed 3 members → the scratch room seats **4**;
5. the non-member roster read used a still-seated member → it uses a member who
   **actually left** a waiting room;
6. the ghost-alias aim returned `SOCIAL_BLOCKED` → the target is now a member
   who **departed**, and the refusal is `NOT_A_MEMBER`.

Two dedicated rooms were added to the suite so each rule is proven in isolation:
an **active room with an already-elapsed window** (the window is *configured*,
never simulated — it may be written freely while the room has never run an
event) and a **waiting room with no clock at all** (so the membership refusals
are proven independently of the event deadline).

## 6. Remaining (user)

- Browser QA of the admin console (create → publish → start → chat → react →
  close), the participant list and the participant room.
- The **production** 403 response body is still unverified (no authorised admin
  account on the deployed site) — the console is proven against the live
  database through the real router, not against production.
- `npm run lint` is broken on this box (`chalk` is an un-materialised OneDrive
  reparse point) — use `npx eslint . --format json`.
- Commit only when explicitly asked.
