# Quota System (server-authoritative)

## Rules (current production behavior)

| | Free | Premium |
| --- | --- | --- |
| Questions per round | exactly 10 (unchangeable) | 10–30 (client selectable) |
| Cooldown | round reserved, per-course **30-minute** cooldown | none (`window_expires_at = null`) |
| Model | `consume_course_quota(user_id, course_key, count, is_premium, request_id)` | same |
| Premium detection | — | latest `subscriptions` row with `status='active'` and `expires_at`/`grace_until` in the future |

`course_key` is per-course (e.g. `nursing-200:Professional Writing and Seminar`,
`clinical-challenge:nclex`, `quick-quiz:both`, `uselu-test`, `weakness-challenge`,
`daily-challenge`), so different courses don't block each other.

## Atomicity & correctness (migration v26)

`consume_course_quota` is SECURITY DEFINER and:
- runs inside a transaction with an **advisory xact lock** per
  `(user_id, course_key)` so concurrent starts serialize;
- is **idempotent on `p_request_id`** — a retried request cannot double-charge;
- clamps `p_count` server-side (free → 10, premium → 10–30);
- refunds are round-scoped: a failed start (`NO_CANDIDATES`,
  `DIFFICULTY_LOCKED`, etc.) deletes **exactly** that round's
  `user_course_quota` row (see `api/_quiz-batches.js: refundRound()`).
- v27 dropped the legacy overloads so only the v26 signature survives.

## Call path

```
Quiz.jsx / CourseList / DailyChallengeWidget
  -> POST /api/quiz/batch-create {course_key, question_count, ...}
      -> consume_course_quota(...)   (server, service-role)
      -> selection (difficulty access check -> candidates -> batch row)
      -> on error: refundRound()
   403 { code: 'COOLDOWN_ACTIVE' } (allowed=false, cooldown_remaining_seconds>0)
   |  403 { code: 'QUOTA_EXHAUSTED' }            |  403 { code: 'DIFFICULTY_LOCKED' }  |  400 ...
```

The client never decides quota; it only renders server `cooldown_remaining_seconds`
status and countdown chips in `CourseList` / cooldown overlay in `Quiz.jsx`.

## Course-level cooldown LOCK (POLYNURSE)

- A free course on its 30-minute cooldown is **non-selectable**: `Quiz.jsx`
  `rowState()` maps the server `course-status` map to
  `AVAILABLE | COOLDOWN | LOADING | ERROR`; the course card is locked
  (`On cooldown`, ticking `Available in mm:ss`, `tabIndex={-1}` +
  `aria-disabled`) and tapping it opens `CourseLockOverlay` ("This course is on
  cooldown. It will become available in mm:ss."), NOT quiz setup.
- The client clock is **display-only** — at zero-cross the `directoryCooldownExpiry`
  effect refetches `GET /api/quota/course-status` and unlocks ONLY when the
  server reports `is_ready:true`; refetch failure keeps the row locked with a
  Retry (fail-closed). Deep links (`?subject=`, `?groupId=`, `?weakness=1`)
  resolve only for `AVAILABLE` rows; any cooldown/unknown row shows the same
  overlay. `QuizSetupFlow` subject tiles are additionally disabled while the
  course/tile is cooling or when quota status is `error`.
- The backend enforces independently: `api/_quiz-batches.js` distinguishes
  **`COOLDOWN_ACTIVE`** (403, `cooldown_remaining_seconds` > 0) from
  `QUOTA_EXHAUSTED`, and returns `cooldown_started_at` + `window_expires_at`.
  `useQuizBatch.classifyBatchError` passes both codes through.
- Per-course isolation is preserved: a parent course row is selectable if ANY
  of its subjects is ready.
Quota can also be read via `GET /api/quota/course-status` →
`{ subjects: { <course_key>: { is_ready, cooldown_remaining_seconds, ... } } }`.

## RPC exposure warning (please read)

`consume_course_quota`, `get_course_quota_status`, `get_difficulty_status`, and
`record_difficulty_correct` currently have EXECUTE granted to
`public`/`authenticated` (live probe confirmed the read RPCs return data to the
**anon** role, and `consume_course_quota` is callable too). The intended design
is server-only invocation. Apply `scripts/migration-v28-server-only-rpcs.sql`
(revoke from public, grant to `service_role`) — blocked this session on a
stale `SUPABASE_ACCESS_TOKEN`. Details + verification steps in
`docs/QUIZ_SECURITY_AUDIT.md`.

## Operational notes (learned live)

- A service-role `@supabase/supabase-js` client that has ever performed a
  GoTrue sign-in makes subsequent PostgREST inserts fail with RLS 42501 — keep
  the admin client pure (sign-in via a separate publishable-key client).
- Difficulty credit for live quizzes happens only in
  `api/quiz/batch-answer.js` (server reads the question's `difficulty`); the
  legacy client `recordAnsweredBatch` path is orphaned (no caller), so there is
  no double-credit.
- Cooldown text renders as “Next round · 1h” then a live `mm:ss`.

## Client display/preflight hardening (Sep 10 2026)

The server is the only quota authority; the client shows status. To keep the
client display fail-closed (never imply "Ready" without a verified server
answer):

- `AppContext.courseQuotaAvailable` is `true` only after a successful
  `GET /api/quota/course-status`; on any fetch failure (or sign-out) it is
  `false`, and course chips render a "Couldn't verify" state instead of a green
  "Ready" chip.
- The cooldown modal's "Start round now" button appears only after the client
  countdown hits zero AND a fresh server `course-status` fetch returns
  `is_ready === true`; if that fetch fails the modal fails closed with a
  retryable error ("We couldn't verify this course's availability…").
- `retrySameSession` no longer passes a `skipQuota` flag (there is no such
  server bypass); it re-runs batch-create with the same idempotency
  `request_id`, so it re-authorizes without double-charging.
- DailyChallengeWidget starts a round only while `consume_course_quota`
  returns `allowed === true`; a failed/`null` response shows an error and
  charges nothing.