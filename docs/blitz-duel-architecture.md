# Blitz Duel with Flow State (v101)

Spec source: **"Flow-State Developer Brief"**. The primary visual reference is
`Flow State Simulator (7).html`; the companion `Flow-State-Developer-Brief.docx`
is binary and could not be read in this environment, so every rule below is
derived from the simulator and the migration, not the document.

Migration: `scripts/migration-v101-blitz-duel.sql` (applied live, re-runnable).
Bank seed: `scripts/seed-blitz-duel-questions.mjs`.
Server: `api/_blitz-duel.js`, dispatched from `api/quiz.js`.
Client: `src/utils/blitzDuelApi.js`, `src/pages/BlitzDuel.jsx`, route `/blitz-duel`.
Tests: `scripts/e2e-blitz-duel.mjs` (`npm run e2e:blitz-duel`).

---

## 1. What a Blitz Duel is

A 1v1 match between the signed-in user and a **Scholar bot**. Both play the same
server-selected board of up to **32 questions** against a single
**server-authoritative 90-second clock**.

| Rule | Value |
|---|---|
| Stake | **2 SC** debited at create |
| Win payout | **+4 SC** gross (net +2) |
| Draw | **2 SC** refunded |
| Loss | no further movement |
| Correct | +1 |
| Wrong / skip | 0 |
| Pace | integer **3–12s** per question (default 6) |
| Bot | ~70% accuracy, 3500–7500ms answer intervals, Flow toggles every 8000–16000ms |

There is **no Flow bonus and no clock extension** — Flow is a state, not a
power-up. A wrong answer never reveals the correct option. When the clock
expires, the current unresolved question is dropped **without** counting as a
skip; a question dropped by the pace ring **does** count as a skip.

Outcome is `Victory` / `Defeat` / `Draw`. The `+4 SC` badge is only rendered
after a confirmed settlement.

All tunables live in `server_config` key `blitz_duel` (stake, question count,
match seconds, payouts, pace range, bot accuracy) and are overridable in
production without a code change.

## 2. Data model

| Table | Purpose |
|---|---|
| `blitz_duel_questions` | The question bank. Seeded **only** from `src/data/flashcards/1v1-questions/` (2 000 rows). Holds `correct_answer` and `explanation`. |
| `blitz_duels` | One row per match: the 90s clock (`starts_at`/`ends_at`), the shuffled `question_ids text[]`, every answer event, the flow timeline, and the bot plan. |
| `blitz_duel_rate_limits` | Atomic per-(user, action, window) counters. |

RLS is enabled on all three and **revoked from `public, anon, authenticated`** —
the tables are `service_role` only. The client never reads them directly; it
cannot, even with a valid JWT.

A partial unique index, `uq_blitz_duels_active_user ... where status = 'active'`,
guarantees **one active match per user**.

## 3. The answer key never leaves the database

`correct_answer` and `explanation` are stored but never projected. The single
egress is the `_blitz_question(p_id)` helper, which selects its columns **by
name** and therefore cannot leak a rationale that quotes the answer:

```sql
select jsonb_build_object(
  'id', id, 'text', question_text, 'options', options,
  'subject', subject, 'topic', topic, 'difficulty', difficulty)
from public.blitz_duel_questions where id = p_id;
```

Graded results come back only as `action = {correct, points, index, next_index,
finished, skipped}` — the server's verdict, never the answer text.

## 4. Money

Every coin move goes through the canonical `_sc_apply` mutator
(`migration-v31-sc-authoritative.sql`) with a **deterministic** idempotency key
so a retry is a replay, never a second charge:

| Event | Amount | Reason | Key |
|---|---|---|---|
| Create | −2 | `duel_stake` | `md5('blitz:' \|\| match \|\| ':stake')` |
| Win | +4 | `duel_win` | `md5('blitz:' \|\| match \|\| ':win')` |
| Draw | +2 | `duel_refund` | `md5('blitz:' \|\| match \|\| ':refund')` |

`_sc_apply` is `service_role`-only, refuses overdraft, and returns the original
result for a repeated `client_request_id`.

## 5. RPC contract

All blitz RPCs take an explicit `p_user_id` (because `service_role` has no
`auth.uid()`) and are granted to **`service_role` only**. Clients reach them
through `api/_blitz-duel.js` so they get a meaningful HTTP status.

| Function | Signature |
|---|---|
| `blitz_duel_create` | `(p_user_id uuid, p_pace integer default null)` |
| `blitz_duel_state` | `(p_user_id uuid, p_match_id uuid)` |
| `blitz_duel_answer` | `(p_user_id, p_match_id, p_question_index integer, p_selected text, p_client_request_id uuid default null)` |
| `blitz_duel_skip` | `(p_user_id, p_match_id, p_question_index, p_client_request_id)` |
| `blitz_duel_flow` | `(p_user_id, p_match_id, p_active boolean, p_client_request_id)` |
| `blitz_duel_settle` | `(p_user_id, p_match_id)` |
| `blitz_duel_rematch` | `(p_user_id, p_pace integer default null)` |

### Response shape

The canonical payload is `_blitz_state(match_id)`; mutating RPCs `||` their
result onto it.

```
{ ok, replay, action, balance_after?, match }

match = { id, status, pace, ends_at, server_now, remaining_ms,
          index, stake_sc, payout_sc, settlement,
          mine:  { score, answered, correct, wrong, skips, flow_active, flow_on_ms },
          bot:   { score, answered, flow_active },
          question: { id, text, options, subject, topic, difficulty } }

settlement = { outcome, delta, score, bot_score, answered, correct, wrong,
               skips, flow_on_ms, flow_off_ms, balance_after, settled_at }
```

**Settlement nesting is easy to get wrong.** On a successful
`blitz_duel_settle`, the settlement is nested under `match.settlement` (the
settle return is `_blitz_state || {action:null}`). But the error payloads carry
it **top-level**: `MATCH_CLOSED` from an answer is
`{ ok:false, error:'MATCH_CLOSED', action:null, settlement }`, and `MATCH_ENDED`
(from `_blitz_ended`) carries top-level `settlement` and `match`. The e2e reads
`body.match?.settlement` accordingly.

`create` is the only payload with a **top-level** `balance_after`; a replayed
create returns `{ ok:true, replay:true, action:null } || _blitz_state` with no
top-level balance.

### Validation order

- **create**: pace is validated **before** the existing-active-match check, so
  `INVALID_PACE` wins even when a live match exists.
- **answer / skip / flow**: owner+match (`for update`) → status → `now() >=
  ends_at` (`_blitz_ended`) → `client_request_id` idempotency → rate limit →
  index strict (`QUESTION_NOT_CURRENT`) → selection/grade.
- Idempotency replays return **before** the rate check (they do not burn a
  slot), while the rate check counts **before** index/selection validation
  (an invalid-index call does burn a slot).

Settlement is allowed **only once the clock has expired**; before that it
returns `MATCH_NOT_ENDED`. It is idempotent via `FOR UPDATE` re-read, a terminal
guard, and the deterministic `_sc_apply` keys.

## 6. Rate limits

Database-backed and atomic (`_blitz_rate_check` increments via
`on conflict (user_id, action, window_start)`), returning `429 RATE_LIMITED`
with a `retry_after_ms` hint. The bot is exempt.

| Action | Limit |
|---|---|
| create | 5 / min |
| answer | 30 / min |
| skip | 30 / min |
| flow | 10 / min |

## 7. Error codes

| Code | HTTP |
|---|---|
| `UNAUTHENTICATED` | 401 |
| `INSUFFICIENT_FUNDS` | 402 |
| `MATCH_NOT_FOUND` | 404 |
| `RATE_LIMITED` | 429 |
| `QUESTION_NOT_CURRENT`, `MATCH_CLOSED`, `MATCH_ENDED`, `MATCH_NOT_ENDED` | 409 |
| `SETTLEMENT_FAILED`, `STAKE_FAILED` | 500 |
| everything else (`INVALID_PACE`, `INVALID_SELECTION`, `INVALID_QUESTION_INDEX`, …) | 400 |

## 8. Client flow

`/blitz-duel` is lazy and wrapped in `RequireAuth`.

- **SetupView** — pace picker, stake/payout summary, start button.
- **ActiveView** — a server-offset clock, a 120px SVG pace ring, the four
  options, a skip button and a Flow toggle. The scoreboard is **hidden while
  Flow is active**. The ring auto-skips on expiry and the view auto-settles at
  `remaining_ms <= 0`.
- **ResultsView** — Victory/Defeat/Draw, the score breakdown and the confirmed
  settlement delta.

The active match id and the chosen pace persist in `localStorage`
(`blitz_duel_match_id`, `blitz_duel_pace`) so a reload resumes the live match.

Flow visuals: 112px ring / 8px stroke, a dark-red aura that activates over
1100ms and retracts over 650ms with no layout shift, a glowing Scholar card
during the bot's Flow, a sound toggle with session mute, and a
`prefers-reduced-motion` fallback. Target is WCAG 2.2 AA.

## 9. The bug a live e2e caught (read this before touching the SQL)

`(timestamptz - timestamptz)` yields an **interval**, and `interval::bigint` is a
hard **42846**. The match duration was originally written as

```sql
v_match_ms := ((m.ends_at - m.starts_at) * 1000)::bigint;   -- 42846 at runtime
```

in five helpers. Every blitz RPC threw before it could answer. It passed the
apply (DDL is not executed) **and** the static verifier, and was only found when
`e2e-blitz-duel` ran the RPCs live. The fix extracts the seconds first:

```sql
v_match_ms := (extract(epoch from (m.ends_at - m.starts_at)) * 1000)::bigint;
```

`verify-deploy-config` PART U now guards both directions: the `extract(epoch …)`
form must be present and the raw interval cast must be absent. **A static gate
proves the SQL is written, never that it runs.**

## 10. Verification

- `npm run e2e:blitz-duel` — **70/70 live checks**: create/replay, stake debited
  once, 32 unique questions with no answer-key leak, wrong/correct grading,
  idempotent answer, `QUESTION_NOT_CURRENT`, `INVALID_SELECTION`,
  `INVALID_PACE`, skip accounting, Flow on/off with accumulated
  `flow_on_ms`, the answer rate limiter (429 + `retry_after_ms`),
  `MATCH_NOT_ENDED`, settlement (win/draw/loss deltas and balance),
  idempotent settle, `MATCH_CLOSED` + stored settlement, rematch, the
  `INSUFFICIENT_FUNDS` path (no active match left behind), RLS probes (client
  cannot read the tables or execute the RPCs, `42501`), and concurrent settles
  moving coins exactly once.
- `node scripts/verify-deploy-config.mjs` — PART U adds the static gates above.
- `npm run build` emits the lazy `BlitzDuel` chunk.

E2E timing note: the database clock cannot be moved, so the whistle is forced
with a service-role `UPDATE blitz_duels SET ends_at = <past>` and then settled.
Answer validation has no timing check; bot answers are resolved inside the RPCs
with server RNG, so the tests assert **shapes and ranges**, not an exact bot
score.
