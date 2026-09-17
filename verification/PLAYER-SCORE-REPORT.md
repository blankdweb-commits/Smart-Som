# PLAYER SCORE — Global Ranking Report (§18 format)

**Date:** 2026-09-13 · **Task:** Server-authoritative Global Player Score ranking.

## Git status
Working tree has 7 modified + 4 added files (all part of this task). Nothing
committed. HEAD = `b79f22b` ("Nursing 200-Level question normalizer and
validator").

## Branch
`feature/nursing-hub-app-10528384678802489862` — unique per-manifest feature
branch convention kept.

## Remote status
`origin https://github.com/blankdweb-commits/Smart-Som.git`. HEAD is **ahead 1,
behind 0** of `origin/<branch>` (the existing Nursing-200 commit is still
unpushed). No fetch/pull/push performed (non-destructive audit only).

## Actual Git error
None (non-destructive work). **User action still pending:** `git add -A` +
commit + push after explicit go-ahead.

## Vercel error
Not verifiable from this sandbox (no `vercel` CLI auth). In-code safeguards
verified instead: function count still **11 ≤ 12** (no new `api/*.js`), no
invalid `functions.runtime`, rewrite table intact (`verify-deploy-config.mjs`
121/121).

## Root cause of the ranking defect
Ranking was driven by **client-computed, client-written** state with no
persistent server score: the browser scored the round, inserted its own
`quiz_results` row, and `quiz_batches` / `quiz_batch_questions` had `for all`
RLS, so a tampered client could flip `quiz_batch_questions.correct = true`
to fabricate a perfect score. There was **no cumulative `player_score`
column anywhere**, so no trustworthy rank could be derived.

## Files changed
- `scripts/migration-v30-player-score.sql` — **new** (see Database changes).
- `api/_questionSelectionService.js` — `completeBatch` rewritten: passes
  sanitised labels to the award RPC, fails soft on `PGRST202`/errors, returns
  the authoritative verdict (`resultId/score/total/passed/playerScore/…`),
  replay-safe readback of prior awards.
- `api/_quiz-batches.js` — `handleComplete` now accepts **labels only**
  (difficulty whitelist, subject ≤120 chars, duration clamp, groupId int>0);
  never reads a client-supplied score/total.
- `src/context/AppContext.jsx` — `fetchSCRank` → **`fetchGlobalRank`** (RPC
  `get_my_player_rank`); `recordQuizResult` is serverResult-aware (authoritative
  verdict preferred, no client insert when `serverResult.resultId` present,
  legacy fallback only pre-migration).
- `src/pages/Quiz.jsx` — destructures `fetchGlobalRank`; Global Rank header cell
  shows `#rank` + pts sub-line; `handlePlayerComplete` passes the server verdict
  into `recordQuizResult`; **fixed 6 pre-existing `no-undef`** (added the missing
  `selectedDifficulty`/`setSelectedDifficulty` state declaration).
- `src/pages/Dashboard.jsx` — new Global Rank card (right rail): `#rank`, pts,
  verified-answer count, "vs N scholars", resets on sign-out/refetch.
- `scripts/verify-deploy-config.mjs` — new section 10 (7 score/RLS/RPC/migration
  assertions) → now **121/121**.
- `verification/player-score.spec.mjs` — **new** 14-test suite.
- `docs/GLOBAL_PLAYER_SCORE.md` — **new** design doc.

## Database changes
Migration **v30 APPLIED** (live): `node scripts/run-migration.mjs
scripts/migration-v30-player-score.sql` → HTTP **201 SUCCESS** against project
`urhcvdcpxhxmmnavkcvd` (run twice — initial apply + once more after the
revoke/`v_fresh` hardening; fully idempotent). Objects it defines:
- `player_stats(user_id PK, player_score, correct_answers, total_answers,
  score_achieved_at, updated_at)` + covering index
  `idx_player_stats_score(player_score DESC, correct_answers DESC,
  score_achieved_at ASC, user_id ASC)`.
- `player_score_awards(batch_id PK → quiz_batches, user_id, deltas, awarded_at)`
  — the idempotency ledger.
- `quiz_results.batch_id uuid` + unique constraint `quiz_results_batch_id_key`.
- 3 SECURITY DEFINER RPCs: `apply_quiz_batch_score(...)` (service_role only),
  `get_my_player_rank(uuid)` (authenticated), `get_player_leaderboard(int,int)`
  (authenticated).

**Live-grant gotcha found during verification:** this Supabase project's
DEFAULT PRIVILEGES for role `postgres` on schema `public` functions
(`pg_default_acl`, objtype `f`) auto-grant `anon=X`, `authenticated=X` AND
`service_role=X` on **every newly created function** — so a plain
`revoke … from public` leaves the explicit `anon`/`authenticated` grants in
place and the RPCs would still run for anon. Migration v30 therefore revokes
from `public, anon, authenticated` (rank RPCs revoke from `public, anon`).
Re-verified live after the run: ACLs are exactly `postgres=EXECUTE,
service_role=EXECUTE` (award) and `postgres=EXECUTE, authenticated=EXECUTE,
service_role=EXECUTE` (rank/leaderboard). This also explains why the older
"revoke from public" pattern in **v28 (pending)** would NOT have locked down
the quota RPCs on its own — v28's revokes must list `anon`/`authenticated`
explicitly too.

## Score source
`player_score` = sum of server-verified correct answers, incremented only by
`apply_quiz_batch_score` and gated on a **fresh** award row (no replay
double-credit). Per-batch score/total/passed are recomputed in SQL from the
persisted graded rows — the browser supplies no score input.

## Ranking source
`row_number()` over `player_score DESC, correct_answers DESC,
score_achieved_at ASC NULLS FIRST, user_id ASC` — identical ordering in
`get_my_player_rank` (one user) and `get_player_leaderboard` (paginated,
identity-masked). Dashboard + Quiz read the RPC via `supabase.rpc`; never a
cached leaderboard slice + index. Fresh user → `globalRank: null` → UI shows `—`.

## Security changes
- `player_stats` / `player_score_awards`: RLS **SELECT own only** — no client
  insert/update/delete policy.
- `quiz_batches` / `quiz_batch_questions`: policies **for all → for select**.
- `quiz_results`: client `for all` policy **dropped** (server owns writes).
- Award RPC revoked from `public, anon, authenticated`, granted **service_role
  only**; rank RPCs revoked from `public, anon`, granted to `authenticated`
  (worked around the project's per-function auto-grants to anon+authenticated).

## Tests
- `verification/player-score.spec.mjs` — **14/14 PASS** (deterministic ordering,
  award idempotency + replay guard, RLS select-only, no client writes to batch
  tables, server-only score, ranking source = player_score only, RPC-driven UI,
  course isolation, 1v1, index, grants, cache, rank↔leaderboard parity).
  Updated in this session: T2 asserts the `awarded` flag now reflects THIS call
  (`v_fresh`, false on replay); T12 asserts the explicit anon/authenticated
  revokes.
- `scripts/verify-deploy-config.mjs` — **121/121 PASS**.
- `npx eslint` — **0 errors / 35 warnings** (baseline, unchanged). `npm run
  build` — OK (~2m57s; flashcard chunk stays lazy).
- **Live DB E2E — 21/21 PASS** (`scripts/_verify-v30-live.mjs`, since deleted):
  created a throwaway auth user via GoTrue Admin (retry-wrapped — the project
  REST host intermittently 504s from this sandbox), fabricated a 2-question
  graded batch (1 correct / 1 wrong), ran `apply_quiz_batch_score`
  (score=1/total=2, passed=false at Hard, resultId, `quiz_results` + 
  `player_stats` rows correct), replayed the completion (clean, `awarded:false`,
  NO double credit, exactly ONE result row), read rank 1 + matching leaderboard
  position, and confirmed the RLS lockdown from the anon (publishable) client:
  award RPC denied, rank RPC denied, `player_stats`/`quiz_batches`/
  `quiz_batch_questions` updates denied. Cleanup deleted the user (FK cascade
  wiped every test row).

## Build
`npm run build` → **success**. `dist/index.html` unchanged payload shape
(flashcard-data not statically loaded).

---
**Remaining (user action):** commit & push (`git add -A`) after explicit
go-ahead → redeploy Vercel → post-deploy probe: complete a scored round and
confirm the Global Rank card on the Dashboard + `#rank` cell in the Quiz
header, and re-check the anonymity/RLS behavior on the live site.