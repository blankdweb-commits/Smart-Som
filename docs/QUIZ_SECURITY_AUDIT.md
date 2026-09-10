# Quiz Security Audit

Scope: authority for quota spending, difficulty unlocking, question serving, and
data access in the quiz flow. Server/database are authoritative; the frontend is
display-only.

## Authority model (POSITIVE)

| Concern | Authority | Client role |
| --- | --- | --- |
| Round creation / question selection | `api/quiz.js` (batch-create) → `QuestionSelectionService.createQuizBatch` (server) | POSTs `course_key`/count; renders returned ids |
| Quota reservation | `consume_course_quota` RPC (atomic, server-only call) | Passes session token only — **never** `p_is_premium` |
| Difficulty unlock | `record_difficulty_correct` RPC on genuinely-correct answers (server-side, per-question difficulty fetched from DB) | Sends answer; server decides correctness |
| Course/subject allowlist | `api/_selectionConfig.js` + `_resolveCourseMetadata` (fail-closed) | Selects from the same allowlist |
| Question content | DB rows returned by server; client bundles are a render fallback only | Resolves server ids against cached banks |

## Fail-closed paths

- Unknown/ambiguous `course_key` → `UNKNOWN_COURSE` / `INVALID_COURSE_KEY` (400).
- Framework pinned per course (`:nclex` → NCLEX, `:nmcn` → NMCN, `:both` →
  `['nclex','nmcn']`, framework constraint dropped for `:both`).
- `FRAMEWORK_MISMATCH`, `DIFFICULTY_LOCKED`, `QUOTA_EXHAUSTED` returned as
  typed errors; `refundRound()` deletes exactly that round's
  `user_course_quota` row when a failed start consumed it.
- Missing difficulty profile defaults to `{ Easy: batchSize }` (always
  unlocked) so a fresh user never spuriously locks.

## RLS / EXECUTE matrix

- Tables behind RLS owner-scoped policies (`user_course_quota`,
  `difficulty_progress`, `question_attempts`, `user_sessions`).
- RPCs `consume_course_quota(get_course_quota_status/
  record_difficulty_correct/get_difficulty_status/reset_course_quota` are
  SECURITY DEFINER and were granted EXECUTE to `public`/`authenticated`. The
  design intent is that **only the server API** calls them (with
  `SUPABASE_SERVICE_ROLE_KEY`); verified client never calls `.rpc()` for these.

## CONFIRMED OPEN ISSUE (high priority, manual step)

Migration `scripts/migration-v28-server-only-rpcs.sql` (revoke EXECUTE from
public/anon/authenticated; grant to `service_role` only) is written and ready
but **NOT yet applied** — the Management API PAT in `.env`
(`SUPABASE_ACCESS_TOKEN`) returned 401 this session.

Live probe with the **anon (publishable) key**:
- `get_course_quota_status(user_id)` → **EXPOSED** (returns data for any
  user_id).
- `get_difficulty_status(user_id, course_key)` → **EXPOSED**.
- `consume_course_quota(...)` → **resolved & callable by anon** (only failed on
  the probe's malformed `request_id` uuid, i.e. a type error — not permission).

Until v28 is applied, a signed-in client can forge quota rounds for any user
and read another user's quota/difficulty state via PostgREST
(`/rest/v1/rpc/...`). The app's HTTP API does not expose this, but the RPC
surface must be locked.

**Action:** refresh `SUPABASE_ACCESS_TOKEN=sbp_...` in `.env` (or set
`ACCESS_TOKEN`) and run:

```powershell
node scripts/run-migration.mjs scripts/migration-v28-server-only-rpcs.sql
```

then re-run the anon probe below — the three RPCs must reply
`PGRST301/insufficient_privilege`, and the serverless functions must still work
(service role is unaffected).

## Client error contract (Phase 18)

`src/hooks/useQuizBatch.js` → `classifyBatchError()` maps results to stable
codes surfaced by `Quiz.jsx`:
`NETWORK_ERROR`, `API_MISROUTED` (HTML body), `SERVER_ERROR`, `UNAUTHORIZED`,
`QUOTA_EXHAUSTED`, `DIFFICULTY_LOCKED`, `INVALID_REQUEST`. Every failure now
returns a non-null user-facing message (fixes the old
`create failed with no error details null`).

## Key takeaways

- Never put the service-role key or Paystack secret behind a `VITE_` prefix
  (Vite inlines `VITE_*` into the browser bundle).
- Client-bundled question banks are still inspectable by an authenticated
  client; RLS + RPC + server feature-gating are the real authority, as documented.