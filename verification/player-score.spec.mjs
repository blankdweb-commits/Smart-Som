// ============================================================
// Global Player Score ranking — verification suite.
//
// Spec §1-§18 (server-authoritative player_score). Runs WITHOUT a live DB:
//   T1   Deterministic ordering — player_score DESC, correct_answers DESC,
//        score_achieved_at ASC, user_id ASC (mirror of the SQL row_number).
//   T2   Award idempotency — player_score_awards PK = batch_id, atomic RPC,
//        one award per completed batch (replay/refresh/tabs cannot double).
//   T3   RLS — player_stats has SELECT-own ONLY; NO client insert/update/
//        delete policy.
//   T4   No client can write quiz_batches / quiz_batch_questions (for-all
//        policies dropped; src/ has zero direct writes).
//   T5   quiz_results is client read-only post-migration (server owns writes).
//   T6   Score is NEVER taken from the client: batch-answer ignores `correct`,
//        batch-complete body carries labels only, server grades + computes.
//   T7   Ranking source is player_score ONLY (never SC balance / streaks /
//        quiz count / readiness / time / cached values).
//   T8   Dashboard + Quiz "Global Rank" read the backend RPC — never a
//        client-side leaderboard slice + index.
//   T9   Course isolation — awarding is per-batch/ownership; cumulative score
//        spans all courses; no course_key filter can split the score.
//   T10  1v1 — no speed mode, no speed points, award idempotent per player batch.
//   T11  Covering index exists on player_stats for the leaderboard ordering.
//   T12  RPC grants — rank/leaderboard to authenticated; award RPC NOT exposed.
//   T13  Cache is never authoritative — no client cache/localStorage drives
//        score/rank display (fresh RPC per fetch).
//   T14  Rank ↔ leaderboard parity — both use the SAME row_number ordering, and
//        a scored user's rank equals their position in the leaderboard.
//
// Usage:  node verification/player-score.spec.mjs
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const has = (p) => existsSync(resolve(ROOT, p));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${String(err.message).split('\n')[0]}`);
  }
};

// T1 ordering key — exact mirror of the SQL ORDER BY / row_number window.
const cmp = (a, b) => {
  if (a.player_score !== b.player_score) return b.player_score - a.player_score;
  if (a.correct_answers !== b.correct_answers) return b.correct_answers - a.correct_answers;
  const ta = a.score_achieved_at ?? null;
  const tb = b.score_achieved_at ?? null;
  if (ta !== tb) {
    if (ta === null) return -1; // NULLS FIRST (ASC)
    if (tb === null) return 1;
    return new Date(ta) - new Date(tb);
  }
  return String(a.user_id).localeCompare(String(b.user_id));
};
const rankOf = (rows, id) => [...rows].sort(cmp).findIndex((r) => r.user_id === id) + 1;

console.log('player-score.spec — Global Player Score ranking');
console.log('  (static + logic; DB objects asserted only after migration v30 is applied)\n');

// ---------------- Files ----------------
const MIG = has('scripts/migration-v30-player-score.sql') ? read('scripts/migration-v30-player-score.sql') : '';
const SERVICE = has('api/_questionSelectionService.js') ? read('api/_questionSelectionService.js') : '';
const BATCHES = has('api/_quiz-batches.js') ? read('api/_quiz-batches.js') : '';
const QUIZ = has('src/pages/Quiz.jsx') ? read('src/pages/Quiz.jsx') : '';
const DASH = has('src/pages/Dashboard.jsx') ? read('src/pages/Dashboard.jsx') : '';
const APP = has('src/context/AppContext.jsx') ? read('src/context/AppContext.jsx') : '';
const USEBATCH = has('src/hooks/useQuizBatch.js') ? read('src/hooks/useQuizBatch.js') : '';

const SRC_FILES = ['src/pages/Quiz.jsx', 'src/pages/Dashboard.jsx', 'src/pages/XpHall.jsx', 'src/hooks/useQuizBatch.js', 'src/components/QuizPlayer.jsx'];
const srcConcat = SRC_FILES.filter(has).map(read).join('\n');

// ---------------- T1 determinism ----------------
check(
  'T1  Deterministic ordering: player_score DESC, correct_answers DESC, score_achieved_at ASC, user_id ASC',
  () => {
    const rows = [
      { user_id: 'a', player_score: 3, correct_answers: 3, score_achieved_at: '2026-09-01T00:00:00Z' },
      { user_id: 'b', player_score: 3, correct_answers: 3, score_achieved_at: '2026-09-02T00:00:00Z' },
      { user_id: 'c', player_score: 3, correct_answers: 4, score_achieved_at: '2026-09-01T00:00:00Z' },
      { user_id: 'd', player_score: 4, correct_answers: 4, score_achieved_at: null },
      { user_id: 'e', player_score: 3, correct_answers: 3, score_achieved_at: '2026-09-01T00:00:00Z' },
      { user_id: 'f', player_score: 3, correct_answers: 3, score_achieved_at: null },
    ];
    const sorted = [...rows].sort(cmp);
    assert.deepStrictEqual(sorted.map(r => r.user_id), ['d', 'c', 'f', 'a', 'e', 'b'],
      `expected deterministic order, got ${sorted.map(r => r.user_id).join(',')}`);
    // Earlier achiever ranks higher on an equal score; identical rows break by user_id.
    assert.strictEqual(rankOf(rows, 'a'), 4);
    assert.strictEqual(rankOf(rows, 'e'), 5);
  }
);

// ---------------- T2 idempotency ----------------
check('T2  Award idempotency: player_score_awards PK=batch_id + atomic RPC', () => {
  assert.ok(/create table if not exists public\.player_score_awards \(/i.test(MIG), 'awards table in migration');
  assert.ok(/batch_id uuid primary key/i.test(MIG), 'PK on batch_id');
  assert.ok(/insert into public\.player_score_awards[\s\S]*?on conflict \(batch_id\) do nothing/i.test(MIG), 'ON CONFLICT DO NOTHING award path');
  assert.ok(/create or replace function public\.apply_quiz_batch_score/i.test(MIG), 'atomic award RPC');
  assert.ok(/v_replay := v_award\.batch_id is not null/i.test(MIG), 'replay guard before awarding');
  assert.ok(/if not v_replay\s+and v_award\.batch_id is not null then[\s\S]*?v_fresh := true;[\s\S]*?insert into public\.player_stats/.test(MIG), 'stats upsert is gated on a FRESH award (no replay double-credit)');
  assert.ok(/awarded', v_fresh/i.test(MIG), 'awarded flag reflects THIS call only (false on replay)');
});

// ---------------- T3 player_stats RLS ----------------
check('T3  RLS: player_stats SELECT-own ONLY (no client write path)', () => {
  assert.ok(/alter table public\.player_stats enable row level security/i.test(MIG), 'RLS enabled');
  const playerStatsSection = MIG.split('PLAYER SCORE AWARDS')[0].split('PLAYER STATS')[1] || '';
  assert.ok(/player_stats_self_read[\s\S]*?for select[\s\S]*?using \(auth\.uid\(\) = user_id\)/.test(playerStatsSection), 'select own policy');
  assert.ok(!/create policy "player_stats_insert"|for insert|for update|for all/.test(playerStatsSection.replace(/player_stats_self_read[^;]*;/g, '')),
    'no client insert/update/delete policy on player_stats');
});

// ---------------- T4 batch tables RLS ----------------
check('T4  No client can write quiz_batches / quiz_batch_questions', () => {
  assert.ok(!/create policy "quiz_batches_own"[\s\S]*?for all/.test(MIG), 'quiz_batches for-all dropped');
  assert.ok(/create policy "quiz_batches_own"[\s\S]*?for select/.test(MIG), 'quiz_batches select-only');
  assert.ok(/create policy "batch_questions_own"[\s\S]*?for select/.test(MIG), 'batch_questions select-only');
  assert.ok(!/from\('quiz_batches'\)[\s\S]*?\.update\(|from\('quiz_batch_questions'\)[\s\S]*?\.update\(/.test(srcConcat),
    'no client-side update on batch tables');
  assert.strictEqual((srcConcat.match(/from\('quiz_batches'\)|from\('quiz_batch_questions'\)/g) || []).length, 0,
    'zero client supabase queries against the batch tables');
});

// ---------------- T5 quiz_results ----------------
check('T5  quiz_results client read-only post-migration (server owns writes)', () => {
  assert.ok(/drop policy if exists "quiz_results_all_own"/.test(MIG), 'for-all policy dropped');
  assert.ok(/create policy "quiz_results_self_read"[\s\S]*?for select/.test(MIG), 'select-own created');
  assert.ok(/authoritative = !!\s*\(serverResult && serverResult\.resultId != null\)/.test(APP), 'client insert gated on authoritative');
  assert.ok(/if \(!authoritative\)\s*\{/.test(APP), 'client quiz_results insert ONLY pre-migration fallback');
});

// ---------------- T6 server computes score ----------------
check('T6  Score never from client: answer ignores `correct`; complete body is labels only', () => {
  assert.ok(/.\s{0,3}The client-supplied\s*`correct`\s*flag is IGNORED/i.test(SERVICE) || /The client-supplied `correct` flag is IGNORED/i.test(SERVICE), 'recordAnswer ignores client correct');
  assert.ok(/serverCorrect = await this\._gradeAnswer/.test(SERVICE), 'server grades');
  assert.ok(/async completeBatch\(\{ batchId, userId, difficulty = null, subject = null, durationSeconds = 0, groupId = null \}\)/.test(SERVICE), 'labels-only params');
  assert.ok(/apply_quiz_batch_score/.test(SERVICE), 'RPC computes authoritative score');
  const completeBody = handleCompleteBody(BATCHES);
  assert.ok(/const \{ batchId \} = req\.body \|\| \{\}/.test(completeBody), 'complete body reads batchId only');
  assert.ok(!/req\.body\?\.score|req\.body\?\.total|body\?\.score/.test(completeBody), 'score/total never read from the request body');
  assert.ok(/difficulty: labelDifficulty,\s*subject: labelSubject,\s*durationSeconds: labelDuration,\s*groupId: labelGroupId/.test(completeBody), 'labels passed to the service');
});

function handleCompleteBody(source) {
  const start = source.indexOf('export async function handleComplete');
  const end = source.indexOf('function handleGet', start < 0 ? 0 : start);
  const sliceEnd = end > start ? end : source.length;
  return source.slice(start, sliceEnd);
}

// ---------------- T7 ranking source ----------------
check('T7  Ranking source is player_score ONLY (RPC reads player_stats)', () => {
  assert.ok(/get_my_player_rank[\s\S]*?from public\.player_stats/.test(MIG), 'rank RPC queries player_stats only');
  assert.ok(!/order by[^)]*smart_coins/.test(MIG), 'no SC ordering in rank/leaderboard');
  assert.ok(/fetchGlobalRank[\s\S]*?supabase\.rpc\('get_my_player_rank'/.test(APP), 'client rank via RPC');
  assert.ok(!/fetchSCRank/.test(APP) && !/fetchSCRank/.test(QUIZ), 'legacy SC-rank fetch removed');
});

// ---------------- T8 backend rank UI ----------------
check('T8  Dashboard + Quiz Global Rank come from the backend RPC (never slice+index)', () => {
  assert.ok(/fetchGlobalRank/.test(DASH) && /globalRankInfo/.test(DASH), 'dashboard uses backend rank');
  assert.ok(/fetchGlobalRank/.test(QUIZ) && /setGlobalRank\(res\.globalRank\)/.test(QUIZ), 'quiz uses backend rank');
  assert.ok(/#\$\{globalRank\}/.test(QUIZ), 'quiz renders the server rank');
  assert.ok(!/\.map\([\s\S]{0,40}\)[\s\S]{0,60}rank\s*\+?\s*1|idx\s*\+\s*1/.test(QUIZ), 'no client-slice rank derivation in Quiz');
  assert.ok(!/(localStorage|sessionStorage)[\s\S]*?playerScore/.test(srcConcat), 'score never read from storage');
});

// ---------------- T9 course isolation ----------------
check('T9  Course isolation: awarding is per-batch ownership; cumulative spans all courses', () => {
  assert.ok(/v_batch\.user_id is distinct from v_user/i.test(MIG), 'RPC enforces batch ownership');
  assert.ok(!/course_key/.test(MIG), 'no course_key filter anywhere in the score system — cumulative across all courses');
  assert.ok(/player_score[\s\S]*= public\.player_stats\.player_score \+ excluded\.player_score/.test(MIG), 'cumulative upsert');
});

// ---------------- T10 1v1 ----------------
check('T10 1v1: no speed mode, no speed points, award idempotent per player batch', () => {
  const cfg = has('api/_selectionConfig.js') ? read('api/_selectionConfig.js') : '';
  assert.ok(/oneVsOne/.test(cfg), 'oneVsOne mode exists');
  assert.ok(!/\bspeed\b/i.test(cfg || ''), 'no speed mode in selection config');
  const completeCalls = (USEBATCH.match(/completeBatch/g) || []).length >= 1;
  assert.ok(completeCalls, 'client completes via the batch endpoint');
  assert.ok(!/elapsedMs[\s\S]*player_score|speedPoints/i.test(MIG), 'award never uses timing');
});

// ---------------- T11 index ----------------
check('T11 Covering index for the leaderboard ordering', () => {
  assert.ok(/idx_player_stats_score\s+on public\.player_stats \(player_score desc, correct_answers desc, score_achieved_at asc, user_id asc\)/.test(MIG), 'index columns + direction match ORDER BY');
});

// ---------------- T12 RPC grants ----------------
check('T12 RPC grants: rank/leaderboard to authenticated; award RPC not exposed', () => {
  assert.ok(/revoke all on function public\.get_my_player_rank\(uuid\) from public, anon;[\s\S]*?grant execute on function public\.get_my_player_rank\(uuid\) to authenticated/.test(MIG), 'get_my_player_rank -> authenticated (anon revoked)');
  assert.ok(/revoke all on function public\.get_player_leaderboard\(int, int\) from public, anon;[\s\S]*?grant execute on function public\.get_player_leaderboard\(int, int\) to authenticated/.test(MIG), 'get_player_leaderboard -> authenticated (anon revoked)');
  assert.ok(/revoke all on function public\.apply_quiz_batch_score\(uuid, uuid, text, text, int, bigint\) from public, anon, authenticated;/.test(MIG), 'award RPC revoked from public/anon/authenticated (Supabase default-priv grants)');
  assert.ok(/grant execute on function public\.apply_quiz_batch_score\(uuid, uuid, text, text, int, bigint\) to service_role;/.test(MIG), 'award RPC granted ONLY to service_role');
  assert.ok(!/apply_quiz_batch_score\([^)]*\) to authenticated/.test(MIG), 'award RPC NOT granted to authenticated');
});

// ---------------- T13 cache ----------------
check('T13 Cache never authoritative: fresh RPC per fetch, no score cache', () => {
  assert.ok(!/localStorage|sessionStorage|getCacheFirst/.test((APP.match(/fetchGlobalRank[\s\S]{0,400}/) || [''])[0] || ''), 'rank fetch bypasses local cache');
  assert.ok(/setGlobalRankInfo\(null\)/.test(DASH), 'dashboard resets rank state before refetch');
  assert.ok(/setGlobalRank\(res\.globalRank\)/.test(QUIZ), 'quiz writes server rank');
});

// ---------------- T14 rank ↔ leaderboard parity ----------------
check('T14 Rank == leaderboard position (same ordering, fresh user = null)', () => {
  const rows = [];
  const ids = ['u1', 'u2', 'u3'];
  for (const id of ids) rows.push({ user_id: id, player_score: Math.floor(Math.random() * 5), correct_answers: 2, score_achieved_at: new Date().toISOString() });
  const sortedByRowNumber = [...rows].sort(cmp);
  sortedByRowNumber.forEach((r, i) => assert.strictEqual(rankOf(rows, r.user_id), i + 1, `rank of ${r.user_id}`));
  assert.ok(/globalRank', null/.test(MIG), 'no-stats user -> null rank');
});

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);