-- ============================================================
-- Apex Scholars Migration v30 — Server-Authoritative Global Player Score
--
-- Rebuilds the "Global Rank" feature on a SERVER-AUTHORITATIVE cumulative
-- score (player_score = total server-verified correct answers) instead of the
-- previous client-computed / client-written ranking signals.
--
-- DESIGN (matches the Global Player Score Ranking spec):
--   1. player_stats          — the cumulative score ledger (player_score,
--                              correct_answers, total_answers, score_achieved_at).
--                              RLS = SELECT own only. NO client INSERT/UPDATE/
--                              DELETE policies -> ONLY the server (service role)
--                              or the SECURITY DEFINER RPC can write it.
--   2. player_score_awards   — idempotency ledger keyed by quiz_batch PK.
--                              One award EVER per completed batch. An award row
--                              existing for a batch proves that batch already
--                              paid out; replaying completion can never double
--                              credit. clients get SELECT-own only.
--   3. quiz_results.batch_id — unique idempotency key on the authoritative
--                              result row, written ONLY by the server RPC.
--   4. RLS lockdown           — quiz_batches / quiz_batch_questions go from
--                              "for all" (own rows) to "for select" only, so a
--                              malicious client can no longer UPDATE
--                              quiz_batch_questions.correct = true to fabricate
--                              a score. quiz_results drops client write access
--                              too (server writes history now).
--   5. RPCs (SECURITY DEFINER):
--        apply_quiz_batch_score(batch, user, diff, subject, duration, group)
--            Atomic: validates ownership -> computes score from persisted
--            quiz_batch_questions -> inserts quiz_results -> inserts award
--            ledger -> upserts player_stats. Idempotent on batch_id.
--        get_my_player_rank(user)     deterministic rank + score for one user.
--        get_player_leaderboard(lim,off)  paginated leaderboard.
--            Ordering: player_score DESC, correct_answers DESC,
--                      score_achieved_at ASC, user_id ASC.
--   6. Index on player_stats(player_score DESC, ...) covers the ordering.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. PLAYER STATS — cumulative server-verified score
-- ============================================================
create table if not exists public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_score bigint not null default 0,   -- total verified correct answers
  correct_answers bigint not null default 0, -- mirrors player_score (tie-break col)
  total_answers bigint not null default 0,   -- total verified answered questions
  score_achieved_at timestamptz,             -- last time player_score increased
  updated_at timestamptz not null default now()
);

-- Covering index for the exact leaderboard ordering used everywhere.
create index if not exists idx_player_stats_score
  on public.player_stats (player_score desc, correct_answers desc, score_achieved_at asc, user_id asc);

alter table public.player_stats enable row level security;

drop policy if exists "player_stats_self_read" on public.player_stats;
-- Clients may only read their OWN score. There is NO insert/update/delete
-- policy, so a client cannot set player_score (the §13 RLS requirement).
create policy "player_stats_self_read"
  on public.player_stats for select
  using (auth.uid() = user_id);

-- ============================================================
-- 2. PLAYER SCORE AWARDS — idempotency ledger (PK = batch_id)
-- ============================================================
create table if not exists public.player_score_awards (
  batch_id uuid primary key references public.quiz_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_score_delta bigint not null default 0,
  correct_delta bigint not null default 0,
  total_delta int not null default 0,
  awarded_at timestamptz not null default now()
);

alter table public.player_score_awards enable row level security;

drop policy if exists "player_score_awards_self_read" on public.player_score_awards;
create policy "player_score_awards_self_read"
  on public.player_score_awards for select
  using (auth.uid() = user_id);

-- ============================================================
-- 3. QUIZ RESULTS — idempotent server-side linkage to the batch
-- ============================================================
alter table public.quiz_results add column if not exists batch_id uuid;

-- A full UNIQUE constraint on (batch_id) (NOT a partial index) so that
-- `on conflict (batch_id)` works in the RPC. Guarded so we never try to add it
-- while duplicate batch_id values already exist.
do $$
begin
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'quiz_results' and c.column_name = 'batch_id'
  ) and not exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join lateral unnest(con.conkey) with ordinality k(attnum, ord) on true
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = k.attnum
    where con.contype = 'u' and nsp.nspname = 'public' and rel.relname = 'quiz_results'
      and att.attname = 'batch_id'
  ) then
    if not exists (
      select 1 from public.quiz_results
      where batch_id is not null
      group by batch_id having count(*) > 1
      limit 1
    ) then
      alter table public.quiz_results add constraint quiz_results_batch_id_key unique (batch_id);
    end if;
  end if;
end $$;

-- ============================================================
-- 4. RLS LOCKDOWN — client read-only on the batch tables
--    The server (service role + SECURITY DEFINER) writes via RLS bypass.
--    Clients only ever READ their own batches / batch questions. This closes
--    the client `UPDATE quiz_batch_questions.correct = true` fabrication path
--    that would otherwise poison the server-computed score.
-- ============================================================
drop policy if exists "quiz_batches_own" on public.quiz_batches;
create policy "quiz_batches_own"
  on public.quiz_batches for select
  using (auth.uid() = user_id);

drop policy if exists "batch_questions_own" on public.quiz_batch_questions;
create policy "batch_questions_own"
  on public.quiz_batch_questions for select
  using (
    exists (
      select 1 from public.quiz_batches
      where quiz_batches.id = quiz_batch_questions.batch_id
        and quiz_batches.user_id = auth.uid()
    )
  );

-- quiz_results becomes read-only for clients too (the server writes history).
drop policy if exists "quiz_results_all_own" on public.quiz_results;
drop policy if exists "quiz_results_self_read" on public.quiz_results;
create policy "quiz_results_self_read"
  on public.quiz_results for select
  using (auth.uid() = user_id);
-- "quiz_results_leaderboard_read" (select true) stays for the group boards.

-- ============================================================
-- 5. ATOMIC AWARD RPC — computes, records, and credits in ONE transaction
-- ============================================================
create or replace function public.apply_quiz_batch_score(
  p_batch_id uuid,
  p_user_id uuid,
  p_difficulty text default null,
  p_subject text default null,
  p_duration_seconds int default 0,
  p_group_id bigint default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_batch public.quiz_batches%rowtype;
  v_user uuid;
  v_award public.player_score_awards%rowtype;
  v_stats public.player_stats%rowtype;
  v_difficulty text;
  v_subject text;
  v_duration int;
  v_group_id bigint;
  v_correct int := 0;
  v_total int := 0;
  v_pct numeric;
  v_threshold int;
  v_passed boolean;
  v_result_id bigint;
  v_replay boolean := false;
  v_fresh boolean := false;
begin
  -- Owner is whomever the authenticated token says; the server passes the
  -- verified user id for its own calls.
  v_user := coalesce(auth.uid(), p_user_id);
  if v_user is null then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_batch from public.quiz_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'BATCH_NOT_FOUND');
  end if;
  if v_batch.user_id is distinct from v_user then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'FORBIDDEN');
  end if;

  -- Replay guard: any award ever issued for this batch = this batch is final.
  select * into v_award from public.player_score_awards where batch_id = p_batch_id;
  v_replay := v_award.batch_id is not null;

  -- Finalize the batch (idempotent transition; re-runs are no-ops).
  update public.quiz_batches
    set status = 'completed', completed_at = coalesce(completed_at, now())
  where id = p_batch_id and status in ('reserved', 'started');

  -- Server-verified score: ONLY from rows the server actually graded.
  select count(*) filter (where answered and correct),
         count(*) filter (where answered)
    into v_correct, v_total
  from public.quiz_batch_questions
  where batch_id = p_batch_id;

  -- Sanitised display labels (never any part of the score).
  v_difficulty := case when p_difficulty in ('Easy','Moderate','Hard','Expert','Master','Extreme') then p_difficulty else 'Easy' end;
  v_subject := left(coalesce(nullif(p_subject, ''), ''), 120);
  v_duration := greatest(0, least(coalesce(p_duration_seconds, 0), 60 * 60 * 24 * 7));
  v_group_id := p_group_id;
  if v_group_id is not null
     and not exists (select 1 from public.study_group_members m where m.user_id = v_user and m.group_id = v_group_id)
     and not public.is_admin() then
    v_group_id := null;
  end if;

  v_pct := case when v_total > 0 then ceil(v_correct * 100.0 / v_total) else 0 end;
  v_threshold := case v_difficulty
    when 'Easy' then 50 when 'Moderate' then 60 when 'Hard' then 70
    when 'Expert' then 75 when 'Master' then 80 when 'Extreme' then 85
    else 60 end;
  v_passed := v_pct >= v_threshold;

  -- Authoritative result row (idempotent per batch).
  insert into public.quiz_results
    (user_id, mode, difficulty, subject, score, total, passed, duration_seconds, group_id, batch_id)
  values
    (v_user, v_batch.mode, v_difficulty, v_subject, v_correct, v_total, v_passed, v_duration, v_group_id, p_batch_id)
  on conflict (batch_id) do nothing;

  select id into v_result_id from public.quiz_results where batch_id = p_batch_id;

  -- Award exactly once per batch.
  if not v_replay then
    insert into public.player_score_awards
      (batch_id, user_id, player_score_delta, correct_delta, total_delta, awarded_at)
    values
      (p_batch_id, v_user, v_correct, v_correct, v_total, now())
    on conflict (batch_id) do nothing
    returning * into v_award;
  end if;

  -- Credit the cumulative score EXACTLY once per batch. The stats upsert runs
  -- only when a FRESH award row was just inserted (v_fresh). On replay v_award
  -- still holds the original award, but v_replay is true and the guard below
  -- skips the upsert so a refresh/retry/double-click can never double-credit
  -- player_score.
  if not v_replay and v_award.batch_id is not null then
    v_fresh := true;
    insert into public.player_stats
      (user_id, player_score, correct_answers, total_answers, score_achieved_at, updated_at)
    values
      (v_user, v_award.player_score_delta, v_award.correct_delta, v_award.total_delta,
       case when v_award.player_score_delta > 0 then now() end, now())
    on conflict (user_id) do update set
      player_score    = public.player_stats.player_score + excluded.player_score,
      correct_answers = public.player_stats.correct_answers + excluded.correct_answers,
      total_answers   = public.player_stats.total_answers + excluded.total_answers,
      score_achieved_at = case
        when excluded.player_score > 0 then now()
        else public.player_stats.score_achieved_at
      end,
      updated_at = now();
  end if;

  select * into v_stats from public.player_stats where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'awarded', v_fresh,
    'replay', v_replay,
    'resultId', v_result_id,
    'score', v_correct,
    'total', v_total,
    'passed', v_passed,
    'correctAnswers', v_correct,
    'totalAnswers', v_total,
    'playerScore', coalesce(v_stats.player_score, 0),
    'correctAnswersTotal', coalesce(v_stats.correct_answers, 0),
    'totalAnswersTotal', coalesce(v_stats.total_answers, 0),
    'difficulty', v_difficulty,
    'subject', v_subject,
    'mode', v_batch.mode,
    'groupId', v_group_id
  );
end;
$$;

-- Supabase's DEFAULT PRIVILEGES for role postgres/schema public auto-grant
-- EXECUTE to anon + authenticated on every new function — so we must revoke
-- from those roles explicitly; `from public` alone leaves the explicit grants
-- in place.
revoke all on function public.apply_quiz_batch_score(uuid, uuid, text, text, int, bigint) from public, anon, authenticated;
grant execute on function public.apply_quiz_batch_score(uuid, uuid, text, text, int, bigint) to service_role;

-- ============================================================
-- 6. RANK RPC — deterministic "rank within the full dataset"
--    Ordering: player_score DESC, correct_answers DESC,
--              score_achieved_at ASC, user_id ASC (row_number).
-- ============================================================
create or replace function public.get_my_player_rank(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_stats public.player_stats%rowtype;
  v_rank int;
  v_total int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select count(*) into v_total from public.player_stats;

  select * into v_stats from public.player_stats where user_id = v_user;
  if v_stats.user_id is null then
    return jsonb_build_object(
      'ok', true,
      'playerScore', 0,
      'correctAnswers', 0,
      'totalAnswers', 0,
      'scoreAchievedAt', null,
      'globalRank', null,
      'totalPlayers', v_total
    );
  end if;

  select row_number() over (
           order by player_score desc, correct_answers desc,
                    score_achieved_at asc nulls first, user_id asc
         )::int
    into v_rank
  from public.player_stats
  where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'playerScore', v_stats.player_score,
    'correctAnswers', v_stats.correct_answers,
    'totalAnswers', v_stats.total_answers,
    'scoreAchievedAt', v_stats.score_achieved_at,
    'globalRank', v_rank,
    'totalPlayers', v_total
  );
end;
$$;

revoke all on function public.get_my_player_rank(uuid) from public, anon;
grant execute on function public.get_my_player_rank(uuid) to authenticated;

-- ============================================================
-- 7. LEADERBOARD RPC — paginated, deterministic, identity-masked
--    (display_name via community_profiles; never real names).
-- ============================================================
create or replace function public.get_player_leaderboard(p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 50), 100), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
begin
  select count(*) into v_total from public.player_stats;

  return jsonb_build_object(
    'ok', true,
    'totalPlayers', v_total,
    'players', coalesce((
      select jsonb_agg(t.row_obj order by (t.row_obj ->> 'rank')::int asc)
      from (
        select jsonb_build_object(
                 'rank', row_number() over (
                           order by s.player_score desc, s.correct_answers desc,
                                    s.score_achieved_at asc nulls first, s.user_id asc
                         )::int,
                 'userId', s.user_id,
                 'displayName', cp.display_name,
                 'avatarUrl', cp.avatar_url,
                 'year', cp.year,
                 'playerScore', s.player_score,
                 'correctAnswers', s.correct_answers,
                 'totalAnswers', s.total_answers,
                 'scoreAchievedAt', s.score_achieved_at
               ) as row_obj
        from public.player_stats s
        left join public.community_profiles cp on cp.id = s.user_id
        order by s.player_score desc, s.correct_answers desc,
                 s.score_achieved_at asc nulls first, s.user_id asc
        limit v_limit offset v_offset
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_player_leaderboard(int, int) from public, anon;
grant execute on function public.get_player_leaderboard(int, int) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================