-- ===========================================================================
-- Migration v105 - DB-authoritative identity tier.
--
-- The 12-tier identity ladder (src/data/identities.js) was computed ONLY on the
-- client from four locally-derived aggregates, so two surfaces could disagree
-- (Dashboard recomputed its own stats) and a stale/partial client read could
-- show a tier the server would not corroborate. This adds get_my_identity(),
-- a SECURITY DEFINER RPC that computes the SAME ladder from persisted facts:
--
--   totalAttempts  <- count of question_attempts rows
--   accuracy       <- correct / total over quiz_results (lifetime)
--   quizStreak     <- profiles.quiz_streak
--   cardsStudied   <- profiles.cards_studied
--   scEarned       <- sc_earned_total() (positive ledger amounts only)
--
-- The threshold table below is a byte-for-byte mirror of IDENTITIES. When that
-- file changes, this function must change with it; verify-deploy-config PART V
-- asserts both sides carry the same thresholds.
--
-- speedRuns is deliberately ABSENT: it was a client-only metric that never
-- existed server-side and permanently capped the ladder at tier 4.
-- ===========================================================================

create or replace function public.get_my_identity(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  v_total_attempts int;
  v_total_q bigint;
  v_correct_q bigint;
  v_accuracy int;
  v_quiz_streak int;
  v_cards_studied int;
  v_sc_earned int;
  v_identity jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select count(*) into v_total_attempts
    from public.question_attempts a
   where a.user_id = v_user;

  select coalesce(sum(r.total), 0), coalesce(sum(r.score), 0)
    into v_total_q, v_correct_q
    from public.quiz_results r
   where r.user_id = v_user;

  -- Prefer the live attempt log, exactly like the client engine does; fall
  -- back to the quiz-history total when the attempt log is empty.
  if coalesce(v_total_attempts, 0) = 0 and coalesce(v_total_q, 0) > 0 then
    v_total_attempts := least(v_total_q, 2147483647)::int;
  end if;

  v_accuracy := case when coalesce(v_total_q, 0) > 0
                     then round((v_correct_q::numeric / v_total_q) * 100)
                     else 0 end::int;

  select coalesce(p.quiz_streak, 0), coalesce(p.cards_studied, 0)
    into v_quiz_streak, v_cards_studied
    from public.profiles p
   where p.id = v_user;

  v_quiz_streak := coalesce(v_quiz_streak, 0);
  v_cards_studied := coalesce(v_cards_studied, 0);
  v_sc_earned := public.sc_earned_total(v_user);

  -- Highest tier whose every threshold is met. Mirrors identityEngine.js
  -- (IDENTITIES is ordered ascending, and each tier only ADDS constraints).
  v_identity := jsonb_build_object('tier', 0, 'name', 'Auxibaby', 'emoji', '👶');

  if v_total_attempts >= 25 then
    v_identity := jsonb_build_object('tier', 1, 'name', 'The Curious Learner', 'emoji', '📚');
  end if;
  if v_total_attempts >= 75 and v_accuracy >= 40 then
    v_identity := jsonb_build_object('tier', 2, 'name', 'The Steady Hammer', 'emoji', '🔨');
  end if;
  if v_total_attempts >= 150 and v_accuracy >= 50 then
    v_identity := jsonb_build_object('tier', 3, 'name', 'The Medication Master', 'emoji', '💊');
  end if;
  if v_total_attempts >= 250 and v_accuracy >= 55 then
    v_identity := jsonb_build_object('tier', 4, 'name', 'The Systems Thinker', 'emoji', '🧩');
  end if;
  if v_total_attempts >= 400 and v_accuracy >= 60 and v_quiz_streak >= 3 then
    v_identity := jsonb_build_object('tier', 5, 'name', 'The Clinical Strategist', 'emoji', '🧠');
  end if;
  if v_total_attempts >= 550 and v_accuracy >= 62 then
    v_identity := jsonb_build_object('tier', 6, 'name', 'The Fearless Competitor', 'emoji', '⚔️');
  end if;
  if v_total_attempts >= 750 and v_accuracy >= 65 and v_quiz_streak >= 5 then
    v_identity := jsonb_build_object('tier', 7, 'name', 'The Evidence Interpreter', 'emoji', '🔬');
  end if;
  if v_total_attempts >= 1000 and v_accuracy >= 68 and v_sc_earned >= 200 then
    v_identity := jsonb_build_object('tier', 8, 'name', 'The Mentor-in-Training', 'emoji', '🦉');
  end if;
  if v_total_attempts >= 1400 and v_accuracy >= 72 and v_quiz_streak >= 7 then
    v_identity := jsonb_build_object('tier', 9, 'name', 'The Exam Conqueror', 'emoji', '🏆');
  end if;
  if v_total_attempts >= 2000 and v_accuracy >= 75 and v_sc_earned >= 500 then
    v_identity := jsonb_build_object('tier', 10, 'name', 'The Clinical Commander', 'emoji', '🛡️');
  end if;
  if v_total_attempts >= 3000 and v_accuracy >= 80 and v_quiz_streak >= 10 and v_sc_earned >= 1000 then
    v_identity := jsonb_build_object('tier', 11, 'name', 'The Apex Scholar', 'emoji', '👑');
  end if;

  return jsonb_build_object(
    'ok', true,
    'identity', v_identity,
    'stats', jsonb_build_object(
      'totalAttempts', v_total_attempts,
      'accuracy', v_accuracy,
      'quizStreak', v_quiz_streak,
      'cardsStudied', v_cards_studied,
      'scEarned', v_sc_earned));
end;
$$;

-- LIVE GRANT GOTCHA: this project's default privileges auto-grant anon +
-- authenticated on every new function, so revoke them explicitly. Only a
-- signed-in caller may read their own identity; the user id defaults to
-- auth.uid() inside the function.
revoke all on function public.get_my_identity(uuid) from public, anon;
grant execute on function public.get_my_identity(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
