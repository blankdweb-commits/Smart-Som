# Quiz Test Plan

Test matrix and current status. Test automation lives in `scripts/`;
everything below runs without the Vercel CLI.

## Automated (run locally, no network)

### `node scripts/verify-deploy-config.mjs` — 51/51 PASS
Deployment-safety assertions:
- vercel.json: SPA fallback last, no `/api/* → index.html`, every rewrite
  destination has a backing top-level `api/*.js`, `/api/:path* → /api/not-found`
  present and before the fallback, `buildCommand`/`outputDirectory` matched,
  no invalid `functions.runtime` / legacy `builds`, no self-loop.
- api/ layout: every non-`_` file has a default handler export; support modules
  are `_`-prefixed; legacy nested `api/quiz`, `api/matches`, `api/payments`
  removed.
- serve-api.mjs parity: legacy rewrites mirrored; `_` files skipped.
- payload: lazy glob, no `eager`; AppContext uses `loadAllBuiltInFlashcards`
  (no `allBuiltInFlashcards`); `sourcemap: false`; `loadFlashcards.js` NOT in
  the `flashcard-data` manualChunk; `dist/index.html` does not statically load
  `flashcard-data`.
- `useQuizBatch` exposes the full stable error-code set.
- **Fail-closed statics (Section 6, +9)**: exactly ONE `setPlayerActive(true)`
  call site; modal "Start round now" gated on a server re-verify
  (`is_ready === true` via `GET /api/quota/course-status`); `rowStatus` is
  `courseQuotaAvailable`-aware; `StatusChip` has an `unavailable`/"Couldn't
  verify" branch; no `skipQuota` anywhere; retry re-runs full batch-create with
  the same idempotency key; `courseQuotaAvailable` wired in AppContext; quiz
  cooldown effect has a server re-check branch; DailyChallengeWidget gates on
  `allowed === false` only.

## Manual / smoke (local, no Vercel CLI)

1. `node scripts/serve-api.mjs` (port 3001), then:
   - `GET /api/quota/course-status` → 401 application/json.
   - `POST /api/quiz/batch-create` → 401 application/json.
   - `GET /api/quiz/batch-get?id=x` → 401 application/json.
   - `GET /api/does-not-exist` → **404 JSON**
     `{"ok":false,"error":{"code":"NOT_FOUND",…},"path":"/api/does-not-exist"}`
     (identical body to the deployed catch-all).
   - `POST /api/payments-webhook` → 500 only until `PAYSTACK_SECRET_KEY` set.
2. `npm run dev` (Vite :5173 proxying /api → :3001) for full UI QA on the dev
   box: login → Quiz → each allowlist course starts and completes.

## Database plane (live, service-role)

- Per-subject candidate counts (used to build `docs/COURSE_CATALOGUE.md`):
  count active rows per `(course_id, subject_id)` — every UI subject ≥
  requested batch sizes except Complicated Midwifery I (2 rows).
- Exam-bank pinning: `course_id='nclex' → exam_framework='NCLEX'`,
  `course_id='nmcn' → 'NMCN'`.
- RPC authority probe (anon/publishable key): `get_course_quota_status` and
  `get_difficulty_status` currently return data → migration v28 NOT applied yet
  (see security audit); after `run-migration` they must reply
  `insufficient_privilege` while the API still works.

### Cooldown / quota enforcement (live, re-run 2026-09-10 — all green)

These prove the SERVER rejects the exact quiz-entry endpoints during a course's
30-minute cooldown (fresh free test user each run; cleanup included):

- `node scripts/e2e-course-quota.mjs` → **13/13 PASS**: free consume=10,
  round completes with 0 remaining, 1800s cooldown set from server clock,
  second consume refused (`allowed:false`), separate course still allowed
  (per-course isolation), premium 25/30 no cooldown, status map correct.
- `node scripts/e2e-quota-api.mjs` → **17/17 PASS**: real `api/quota.js`
  handler — unauthenticated consume = 401, free clamp + cooldown +
  refusal + premium no-cooldown + status map + cleanup.
- `node scripts/_repro-batch-403.mjs` → the LIVE quiz-entry router
  (`api/quiz.js` `/api/quiz/batch-create`):
  `nursing-200:Pharmacology` Easy → **200** (10 Qs, quota consumed), second
  batch-create on the same course during cooldown → **403
  `QUOTA_EXHAUSTED`** `cooldown_remaining_seconds` present (the active quiz
  does NOT open), `clinical-challenge:nclex` / `quick-quiz:both` still → 200
  (isolation), invalid course → 400 `INVALID_COURSE_KEY`.

## E2E (playwright; needs a live dev server + real signup — run on dev box)

Existing suites remain valid: `npm run e2e:weakness`,
`e2e:community-sections`, `e2e:study-groups`, `e2e:group-quiz-sc` plus the
batch flow. Regenerate new-user flows against the fresh quota + per-course
difficulty rules before sign-off:
- new free user → Easy-only lock → 10-question round → cooldown chip → second
  start shows the quota overlay → a different course still starts.
- premium user → 10–30 selectable, no cooldown.
- error surface: kill the API and start a round → “network error” message, not
  a silent failure/null message.

## Post-deploy (Vercel dashboard — the final acceptance gate)

After commit + redeploy:
1. `https://<app>/api/quiz-batch-get?id=x` → **401 JSON** (was HTML 200).
2. `https://<app>/api/nonexistent` → **404 JSON**.
3. `https://<app>/` → SPA HTML 200 (QA flow: sign in → quiz runs).
4. If Vercel still fails at `Deploying outputs...` after this branch is live,
   capture the `vercel build`/dashboard log’s error section and paste it in a
   new issue — do not assume the earlier failure is fully closed until a green
   deploy is observed.

## Status summary

| Item | Status |
| --- | --- |
| Lint | 0 errors / 36 pre-existing warnings |
| `npm run build` | OK (~40 s) |
| verify-deploy-config.mjs | **51/51 PASS** |
| Vercel Hobby function count | 11 ≤ 12 PASS (4 quiz-batch → 1 api/quiz) |
| Local API smoke incl. JSON 404 | PASS |
| DB pool/framework mapping | PASS (documented counts) |
| Professional Writing seed | 150/150 upserted |
| Live cooldown enforcement (e2e RPC 13/13, API 17/17, batch-repro 403) | **PASS (2026-09-10)** |
| Fail-closed preflight/display hardening (courseQuotaAvailable, server-verified Start, no skipQuota, DailyChallenge gate) | PASS (in-code + statics) |
| Migration v28 (RPC lockdown) | **BLOCKED** — stale Management PAT |
| Vercel live deploy probe | **PENDING** — needs dashboard redeploy |
| E2E browser suites on dev box | PENDING |

## Post-fix browser QA checklist (dev box, after redeploy)

1. Free signup → Quiz → course chip must say "Couldn't verify" only while the
   quota fetch is actually failing (once loaded, "Ready"/"Next round · 30m").
2. Start a free round → completes → same-course second start → cooldown modal
   with countdown; when the client countdown reaches zero the Start button must
   stay disabled ("Checking availability…") until the server confirms
   `is_ready === true`, then start; if the server fetch fails, the modal shows
   the retryable "We couldn't verify this course's availability." error.
3. Daily Challenge on a brand-new free account starts the FIRST round (no
   permanent lock) and shows the 30-minute copy.