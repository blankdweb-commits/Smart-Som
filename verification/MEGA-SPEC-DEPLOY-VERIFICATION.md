# MEGA-SPEC DEPLOY VERIFICATION — migrations v31–v35

Verify BEFORE deploy cutover. Runs against the live Supabase project and the
running Vercel app. Two actors:

- **postgres** = SQL editor (Supabase Dashboard → SQL) — for introspection + reset.
- **authenticated JWT** = the app's `supabase` client (browser) or `curl -H
  "apikey: <anon>" -H "Authorization: Bearer <user-jwt>"`. Every "MUST FAIL"
  check below is only meaningful when run as the **authenticated** role (the
  SQL editor runs as postgres and bypasses RLS/grants).

## Prereqs
1. `SUPABASE_ACCESS_TOKEN` uploaded; supabase CLI linked to the project.
2. Two throwaway test accounts (A, B) both ACTIVATED, with real quiz history.
3. Run migrations in strict order: v31 → v32 → v33 → v34 → v35.
4. Re-run v35 once more when done → must finish clean (idempotency).

## Phase 1 (v31) — SC economy is server-authoritative
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 1.1 | postgres | `\df public._sc_apply` exists; `revoke all on function _sc_apply(_sc_apply params)` leaves ONLY `service_role` holding execute (plus the winning-user RPC's definer context) | function + non-public grants |
| 1.2 | JWT A | `select * from public.smart_coin_ledger limit 5` | returns only A's rows |
| 1.3 | JWT A | `update public.profiles set smart_coins = 999999 where id = auth.uid()` | MUST FAIL (RLS blocks profile writes / column not client-writable) |
| 1.4 | JWT A | `insert into public.smart_coin_ledger (…) values (…)` | MUST FAIL (no client insert policy) |
| 1.5 | app | Dashboard wallet → answer questions → ledger gains rows, coins only via server RPCs | balance changes only after server ops |
| 1.6 | postgres | `select count(*) from smart_coin_ledger where source not in ('quiz','duel','daily','challenge','referral_bonus','squad_reward','welcome')` | 0 (only server sources) |

## Phase 2 (v32) — competitive ranking
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 2.1 | postgres | Refresh materialized view/rank table; `select user_id, competitive_rank_score from <%= rank storage %> order by competitive_rank_score desc limit 5` | deterministic order, scores in [0, clamp] bounds |
| 2.2 | postgres | formula sanity: coin = 1000·ln(1+b)/ln(1+250) caps at 1000; 1v1 ≤ 600; 3v3 ≤ 600; perf ≤ 400·min(matches,10)/10 + 20·min(ach,20) | recompute matches stored values |
| 2.3 | JWT A | `select * from public.get_rank_position()` | `{ok, rank, score}` sane, no error |
| 2.4 | JWT A | leaderboard SELECT | no delayed/wrong columns; ties broken per spec order |

## Phase 3 (v33) — server-finalized duels
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 3.1 | JWT A | `insert into public.duels (…) values (…)` | MUST FAIL (duels locked to select-own) |
| 3.2 | JWT A | `update public.duels set winner_id = 'A' where …` | MUST FAIL |
| 3.3 | app | win a 1v1 against a HUMAN (test A vs B) | one `duels` row; coins: winner +stake·(n−1), loser −stake; identical on both clients |
| 3.4 | app | win vs "The House" | winner +stake·(n−1); competitor_stats unchanged for The House |
| 3.5 | app | replay the SAME client_request_id twice (resend) | second call refused / no double-ledger (idempotent, `uq_duels_client_request`) |
| 3.6 | postgres | `select * from smart_coin_ledger where metadata->>'client_request_id' = '<id>'` | exactly 1 coin entry + 1 duels row |

## Phase 4 (v34) — risk tiers + rematch protection
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 4.1 | app | spam rematch vs same opponent within same window | `DUEL_FROZEN` / lock error, no new duels row |
| 4.2 | postgres | `select * from public.refresh_duel_risk();` | risk bucket recomputed; locked matches flagged |
| 4.3 | JWT A | finalize a match flagged locked | MUST FAIL (server refuses) |

## Phase 5 (v35) — viral growth layer
### Achievements
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 5.1 | JWT A | `insert into public.user_achievements (user_id, achievement_id)` | MUST FAIL (select-own only) |
| 5.2 | app | answer a quiz → call evaluates automatically | server unlocks only real facts; wall shows same list; toast for new |
| 5.3 | postgres | `select count(*) from user_achievements where unlocked_at > now() - interval '10 min'` | matches the app's new-unlock toast count |
| 5.4 | JWT A | `select * from public.evaluate_achievements();` | `{ok:true, unlocked:[], total:N, stats:{…}}`, no duplicate unlocks on re-run |

### Challenges
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 5.5 | app | complete daily-drive (20 correct today) → Claim | NOT_COMPLETE until target; then success; +5 SC; second Claim → already claimed |
| 5.6 | JWT A | `select * from claim_challenge_reward('daily-drive', auth.uid())` twice | 1st credited, 2nd `ALREADY_CLAIMED` (idempotent) |
| 5.7 | postgres | `select * from challenges` | exactly the 4 seeds, targets correct |

### Referrals
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 5.8 | postgres | `update public.profiles set referrer_id = null, referral_code = null where id in ('A','B')` (reset) | clean slate |
| 5.9 | app | A opens /signup?referral=CODE; B signs up with Code; B ACTIVATES | +15 SC lands ONLY on A's account at activation, in ledger as referral_bonus |
| 5.10 | postgres | `select status, credited_at from referrals` | exactly 1 row credited; B has no SC from referral |
| 5.11 | app | B tries applying a second code / own code | `ALREADY_REFERRED` / `SELF_REFERRAL` |
| 5.12 | postgres | duplicate `apply_referral` for same B | idempotent — no second ledger row |

### Squads
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 5.13 | app | A creates squad (blank code) | auto 6-char code, A is owner |
| 5.14 | app | B joins by code; both answer correct questions | weekly_correct aggregates from player_score_awards only |
| 5.15 | app | A claims weekly reward | +5 SC; second claim blocked until week roll |
| 5.16 | app | B leaves; B re-joins | one membership max (`squad_members_user_unique`) |
| 5.17 | JWT A | `join_squad('')` | INVALID_CODE (never joins empty code) |

### Party Rooms
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 5.18 | app | A creates room | 6-char code; listed in get_active_rooms |
| 5.19 | app | B joins with code, then leaves | memberCount decrements; leaving removes membership |
| 5.20 | postgres | room past created_at + 2h | disappears from active list (TTL) |
| 5.21 | JWT A | `insert into public.quiz_rooms` / `room_members` | MUST FAIL (RPC-only) |

### ACL sweep (all of v35)
| # | Actor | Check | Expect |
|---|-------|-------|--------|
| 5.22 | postgres | for each new RPC: `revoke all on function … from public, anon, authenticated; grant execute … to authenticated;` already present | re-run grant statement → no-op |
| 5.23 | JWT anon (no login) | call `evaluate_achievements()` | returns `{ok:false,error:'UNAUTHENTICATED'}` (definer guard) or PG error |
| 5.24 | JWT A | call any v35 RPC with B's client-side smuggled id | definer validates auth.uid() — MUST NOT act on B |

## Cutover gate
All of the above pass (especially 1.3/1.4, 3.1/3.2, 5.1, 5.21, 5.24) → deploy
is safe. Any FAIL in the forge checks = ship-blocking.

## Post-cutover (Phase 9 note)
Promo pricing migration is numbered **v36** (NOT v35 — do not reuse the number).
Re-run steps 5.22–5.24 against the new RPCs after v36.