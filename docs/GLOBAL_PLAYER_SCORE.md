# Global Player Score — Server-Authoritative Ranking

Rebuilds the **Global Rank** feature on a cumulative, server-verified
`player_score` (the total number of server-graded correct answers a user has
ever earned), replacing the old client-computed score + client-written
`quiz_results` signal.

## Why it changed

The previous flow was **not authoritative**:

1. Answers were graded server-side, but the final **score/pass verdict** was
   reconstructed client-side and inserted into `quiz_results` by the browser.
2. `quiz_batches` / `quiz_batch_questions` had **`for all` RLS policies** on a
   user's own rows, so a modified client could `UPDATE
   quiz_batch_questions SET correct = true` and fabricate a perfect score.
3. **No persistent, server-verifiable score column existed at all** — rank
   was effectively untrusted.

## The new model (migration v30)

| Concern | Design |
| --- | --- |
| Cumulative score | `player_stats.player_score` = total verified correct answers. Inserted/updated **only** by the server (service role) or the SECURITY DEFINER RPC. |
| Per-round score | `score`/`total` per batch = correct / answered, computed inside the RPC from the persisted `quiz_batch_questions` rows. **Never** taken from the client. |
| Idempotency | `player_score_awards.batch_id` **PK** + `ON CONFLICT (batch_id) DO NOTHING`. One award ever per batch; replay → no-op. The `player_stats` upsert is gated on a **fresh** award (`not v_replay`), so refresh/retry/double-click/tabs can never double-credit. |
| Result row | `quiz_results.batch_id` UNIQUE — one server-written result row per batch. |
| RLS | `player_stats` = SELECT own only (no client write). `quiz_batches` / `quiz_batch_questions` downgraded **for all → for select**. `quiz_results` client-write policy dropped. |
| Passing | threshold by difficulty: Easy 50 / Moderate 60 / Hard 70 / Expert 75 / Master 80 / Extreme 85. |
| Rank | `get_my_player_rank(user)` → `row_number()` over `player_score DESC, correct_answers DESC, score_achieved_at ASC NULLS FIRST, user_id ASC`. Fresh user (no stats row) → `globalRank: null`. |
| Leaderboard | `get_player_leaderboard(limit, offset)` — same ordering, paginated, identity-masked through `community_profiles` (`display_name`, never real names). |
| Grants | Award RPC → **service_role only** (revoked from public/authenticated). Rank + leaderboard RPCs → `authenticated`. |

## Flow

```
Quiz completed (client)
  └─ POST /api/quiz-batch-complete { batchId, difficulty, subject, durationSeconds, groupId }
       └─ QuestionSelectionService.completeBatch
            └─ RPC apply_quiz_batch_score(batch, user, …)   [service role, atomic]
                 └─ validates ownership (auth.uid()/coalesce user)
                 └─ finalizes status ('started'→'completed')
                 └─ computes score from persisted graded answers
                 └─ inserts quiz_results (UNIQUE batch_id)
                 └─ inserts player_score_awards (PK batch_id)   ← exactly once
                 └─ upserts player_stats (only when the award is fresh)
  └─ client receives authoritative { resultId, score, total, passed, playerScore, … }
       └─ recordQuizResult(res, { serverResult })  → no client quiz_results write
```

## Fail-soft

If the RPC is missing (migration not yet applied → `PGRST202`) or errors,
`completeBatch` still transitions the batch to `completed` via the legacy
status flip and returns `awarded:false`. Quiz completion NEVER breaks; ranking
simply stays empty until the migration is applied.

## Pre-migration fallback

`recordQuizResult` receives `serverResult`. When
`serverResult?.resultId` is present it is authoritative (client does not insert
`quiz_results`). Only when there is **no** server result (pre-migration) does
the old client-side `quiz_results` insert run.

## Reading the rank (no new Vercel functions)

The 12-function Hobby ceiling is preserved: awarding rides the existing
`api/quiz.js` router (`handleComplete`), and rank/leaderboard reads go
client-side through `supabase.rpc('get_my_player_rank')` /
`('get_player_leaderboard')`.

- `AppContext.fetchGlobalRank()` → `{ globalRank, playerScore, correctAnswers, totalAnswers, totalPlayers }` (fresh RPC per call; never cached).
- `Quiz.jsx` header cell: rank + score sub-line.
- `Dashboard.jsx` right rail: **Global Rank** card (`#rank`, pts, verified answers, vs N scholars; `—` before the first scored round).

## What does NOT affect the score

Smart Coins balance, streak, readiness %, daily-precision, number of sessions,
study groups, and speed/timing play **no role** in `player_score` or rank.
1v1 duels have no speed mode and currently do not complete batches (no award
path → no duplicate-award risk).

## Apply

```
node scripts/run-migration.mjs scripts/migration-v30-player-score.sql
```

Requires a fresh `SUPABASE_ACCESS_TOKEN` (`sbp_`) in `.env`. Until applied,
ranking reads return empty (error fallback → `—`) and no awards accrue.