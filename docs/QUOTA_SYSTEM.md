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
  `user_course_quota` row (see `api/quiz-batch-create.js: refundRound()`).
- v27 dropped the legacy overloads so only the v26 signature survives.

## Call path

```
Quiz.jsx / CourseList / DailyChallengeWidget
  -> POST /api/quiz/batch-create {course_key, question_count, ...}
      -> consume_course_quota(...)   (server, service-role)
      -> selection (difficulty access check -> candidates -> batch row)
      -> on error: refundRound()
  403 { code: 'QUOTA_EXHAUSTED' }  |  403 { code: 'DIFFICULTY_LOCKED' }  |  400 ...
```

The client never decides quota; it only renders server `cooldown_remaining_seconds`
status and countdown chips in `CourseList` / cooldown overlay in `Quiz.jsx`.
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