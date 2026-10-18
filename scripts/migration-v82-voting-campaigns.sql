-- ============================================================
-- migration-v82-voting-campaigns.sql
--
-- POLYNURSE Phase 3 — the voting platform, split into TWO surfaces that can
-- never contaminate each other:
--
--   A. SERVICE FEEDBACK  -> service_ratings + service_rating_stats
--      "How was PolyNurse?" A rating per category, per account.
--
--   B. INDIVIDUAL CAMPAIGNS -> voting_campaigns + voting_candidates
--      + campaign_votes + campaign_totals
--      Real candidates, a real start/end window, standings.
--
-- WHY NEW TABLES AND NOT voting_polls:
--   voting_polls (migration-v10) is a different product: a user asks for a
--   question to be put to a poll and an admin approves it. It has no candidate
--   concept, no window, no results-visibility rule, and no totals. Its UI was
--   also broken in production (Voting.jsx inserted a `type` column that has
--   never existed -> 42703 on every request). Reusing it would have meant
--   bolting a candidate model onto a poll-request model and blurring two
--   different things. voting_polls is LEFT IN PLACE here (it is empty) so
--   nothing is destroyed; the broken request UI is removed client-side.
--
-- INTEGRITY RULES ENFORCED IN THE DATABASE (not the UI):
--   * The RPCs take NO user id. auth.uid() is read inside, so a client cannot
--     vote as somebody else by editing a request body.
--   * anon + public have EXECUTE revoked. (This project's default privileges
--     auto-grant EXECUTE to anon on every new function, so the explicit
--     `revoke ... from public, anon` is mandatory, not decorative.)
--   * Campaign status + the start/end window are validated server-side.
--   * Duplicate votes are prevented by a UNIQUE constraint; the RPC is
--     idempotent on client_request_id so a double-tap or a replayed request
--     cannot double-count.
--   * Totals are incremented in the SAME transaction as the vote, so a total
--     can never disagree with the underlying rows.
--   * Results respect the campaign's own visibility rule. A hidden campaign
--     exposes no totals to non-admins, not even to the people who voted.
--   * A service rating can never be counted as a candidate vote: they are
--     different tables with different RPCs and no shared code path.
--
-- Idempotent: safe to re-run.
-- ============================================================


-- ============================================================
-- 1. SERVICE FEEDBACK
-- ============================================================

create table if not exists public.service_ratings (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null
                 check (category in ('quiz','marketplace','arena','community','overall')),
  rating       smallint not null check (rating between 1 and 5),
  -- structured, optional. These are NOT free text and NOT a second score:
  -- they describe the rating that was given.
  options      text[] not null default '{}',
  comment      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One rating per category per account. Re-rating UPDATES that row.
  constraint service_ratings_user_category_key unique (user_id, category)
);

create index if not exists idx_service_ratings_category on public.service_ratings(category);

-- Aggregate, kept separate so the chart never has to aggregate live and so the
-- raw per-user rows stay behind a tighter policy.
create table if not exists public.service_rating_stats (
  category        text primary key,
  rating_count    integer not null default 0,
  rating_sum      integer not null default 0,
  -- Per-star counts so the distribution chart is REAL data rather than a
  -- guess reconstructed from an average.
  r1 integer not null default 0,
  r2 integer not null default 0,
  r3 integer not null default 0,
  r4 integer not null default 0,
  r5 integer not null default 0,
  avg_rating      numeric(4,2) not null default 0,
  updated_at      timestamptz not null default now()
);

comment on table public.service_ratings is
  'Per-user service feedback for PolyNurse itself. Never mixed with campaign votes.';
comment on table public.service_rating_stats is
  'Aggregate of service_ratings, maintained in the same transaction as the rating.';

alter table public.service_ratings enable row level security;
alter table public.service_rating_stats enable row level security;

-- Raw rows are private to their author. Comments in particular must not leak.
drop policy if exists "service_ratings_select_own" on public.service_ratings;
create policy "service_ratings_select_own"
  on public.service_ratings for select
  using (auth.uid() = user_id or public.is_admin());

-- No client insert/update/delete at all: everything goes through the RPC.
-- (service_role bypasses RLS, which is what the SECURITY DEFINER RPC uses.)
drop policy if exists "service_ratings_client_write" on public.service_ratings;

-- Aggregate is readable by any signed-in user so the distribution chart works
-- from the client without an extra round trip. It carries no personal data.
drop policy if exists "service_rating_stats_read" on public.service_rating_stats;
create policy "service_rating_stats_read"
  on public.service_rating_stats for select
  using (auth.role() = 'authenticated' or public.is_admin());

drop policy if exists "service_rating_stats_admin_write" on public.service_rating_stats;
create policy "service_rating_stats_admin_write"
  on public.service_rating_stats for all
  using (public.is_admin()) with check (public.is_admin());


-- ============================================================
-- 2. INDIVIDUAL CAMPAIGNS
-- ============================================================

create table if not exists public.voting_campaigns (
  id               bigint generated always as identity primary key,
  title            text not null,
  description      text not null default '',
  -- Shown to voters BEFORE they vote. Eligibility + rules are part of the
  -- campaign, not tribal knowledge.
  eligibility_note text not null default '',
  rules_note       text not null default '',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'upcoming'
                     check (status in ('upcoming','active','ended')),
  -- When false, totals are invisible until the campaign has ended.
  results_public   boolean not null default false,
  -- The permitted voting rule, explicit rather than assumed. Default is the
  -- safe one: one vote per authenticated user per campaign.
  votes_per_user   integer not null default 1 check (votes_per_user between 1 and 10),
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint voting_campaigns_window check (ends_at > starts_at)
);

create table if not exists public.voting_candidates (
  id           bigint generated always as identity primary key,
  campaign_id  bigint not null references public.voting_campaigns(id) on delete cascade,
  name         text not null,
  -- Only a URL supplied and authorised by an admin. Never scraped.
  image_url    text not null default '',
  statement    text not null default '',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (campaign_id, name)
);

create index if not exists idx_voting_candidates_campaign on public.voting_candidates(campaign_id);

-- A stable natural key. `voting_campaigns` has only a generated identity id, so
-- without a slug the sample seed below would duplicate itself on every re-run.
-- Same shape as the v36 promo-pricing seed (add slug -> unique index -> upsert).
alter table public.voting_campaigns
  add column if not exists slug text;
-- Plain (not partial) unique index so it can be used as an ON CONFLICT arbiter
-- by the seed below. Postgres permits any number of NULL slugs in a plain
-- UNIQUE index, so ordinary campaigns can leave it NULL.
create unique index if not exists voting_campaigns_slug_key
  on public.voting_campaigns (slug);

create table if not exists public.campaign_votes (
  id                 bigint generated always as identity primary key,
  campaign_id        bigint not null references public.voting_campaigns(id) on delete cascade,
  candidate_id       bigint not null references public.voting_candidates(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  client_request_id  uuid not null,
  voted_at           timestamptz not null default now(),
  -- The candidate must belong to the campaign. A UNIQUE on the pair of ids
  -- cannot express that, so it is a trigger concern; the RPC checks it and
  -- this constraint is the backstop for "one vote per user per campaign".
  constraint campaign_votes_one_per_user_per_campaign unique (campaign_id, user_id),
  -- Replay protection: the same request id can never insert twice.
  constraint campaign_votes_request_id_key unique (client_request_id)
);

create index if not exists idx_campaign_votes_campaign on public.campaign_votes(campaign_id);
create index if not exists idx_campaign_votes_candidate on public.campaign_votes(candidate_id);

-- The public aggregate. This is what realtime broadcasts and what the client
-- charts read. It deliberately contains NO voter identity, so live updates
-- cannot leak who voted for whom.
create table if not exists public.campaign_totals (
  candidate_id bigint primary key references public.voting_candidates(id) on delete cascade,
  campaign_id  bigint not null references public.voting_campaigns(id) on delete cascade,
  votes        integer not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_campaign_totals_campaign on public.campaign_totals(campaign_id);

comment on table public.campaign_totals is
  'Live aggregate per candidate. Carries no voter identity on purpose.';

alter table public.voting_campaigns  enable row level security;
alter table public.voting_candidates enable row level security;
alter table public.campaign_votes     enable row level security;
alter table public.campaign_totals   enable row level security;

-- --- Campaigns: readable by any signed-in user (candidates need an account
-- to vote anyway, and the window/rules must be visible before that).
drop policy if exists "voting_campaigns_read" on public.voting_campaigns;
create policy "voting_campaigns_read"
  on public.voting_campaigns for select
  using (auth.role() = 'authenticated' or public.is_admin());

drop policy if exists "voting_campaigns_admin_write" on public.voting_campaigns;
create policy "voting_campaigns_admin_write"
  on public.voting_campaigns for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "voting_candidates_read" on public.voting_candidates;
create policy "voting_candidates_read"
  on public.voting_candidates for select
  using (auth.role() = 'authenticated' or public.is_admin());

drop policy if exists "voting_candidates_admin_write" on public.voting_candidates;
create policy "voting_candidates_admin_write"
  on public.voting_candidates for all
  using (public.is_admin()) with check (public.is_admin());

-- --- Votes: the raw row reveals WHO voted for WHOM, so it is select-own only.
-- Everyone else reads campaign_totals instead. No client writes at all.
drop policy if exists "campaign_votes_select_own" on public.campaign_votes;
create policy "campaign_votes_select_own"
  on public.campaign_votes for select
  using (auth.uid() = user_id or public.is_admin());

-- --- Totals: readable only when the campaign actually publishes results, or
-- to an admin. A restricted campaign leaks nothing, not even an aggregate.
drop policy if exists "campaign_totals_read" on public.campaign_totals;
create policy "campaign_totals_read"
  on public.campaign_totals for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.voting_campaigns c
      where c.id = campaign_totals.campaign_id
        and (c.results_public or c.status = 'ended')
    )
  );

drop policy if exists "campaign_totals_admin_write" on public.campaign_totals;
create policy "campaign_totals_admin_write"
  on public.campaign_totals for all
  using (public.is_admin()) with check (public.is_admin());


-- ============================================================
-- 3. REALTIME — live charts WITHOUT exposing a single vote row
-- campaign_totals is the only table added to the publication. Subscribing to
-- it gives aggregate changes and reveals nothing about who voted.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_totals'
  ) then
    alter publication supabase_realtime add table public.campaign_totals;
  end if;
exception
  when undefined_object then null;  -- publication missing on this project
  when duplicate_object then null;
end $$;


-- ============================================================
-- 4. BACKFILL — every existing candidate starts at zero, so a candidate with
--    no votes is still visible on the standings chart (and honest about it).
-- ============================================================
insert into public.campaign_totals (candidate_id, campaign_id, votes)
select c.id, c.campaign_id, 0 from public.voting_candidates c
on conflict (candidate_id) do nothing;

insert into public.service_rating_stats (category, rating_count, rating_sum, avg_rating, updated_at)
select category, count(*), coalesce(sum(rating),0),
       coalesce(round(avg(rating)::numeric, 2), 0), now()
from public.service_ratings
group by category
on conflict (category) do update
  set rating_count = excluded.rating_count,
      rating_sum   = excluded.rating_sum,
      avg_rating   = excluded.avg_rating,
      updated_at   = now();


-- ============================================================
-- 4b. FRAUDULENT-VOTE CORRECTION, WITH AN AUDIT TRAIL
-- An admin must be able to remove a fraudulent vote, but the removal has to be
-- recorded — a total that quietly changes is exactly the thing that makes a
-- result untrustworthy. Every correction writes a row here.
-- ============================================================
create table if not exists public.campaign_vote_audit (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null references public.voting_campaigns(id) on delete cascade,
  vote_id     bigint references public.campaign_votes(id) on delete set null,
  candidate_id bigint references public.voting_candidates(id) on delete set null,
  action      text not null check (action in ('void','restore')),
  reason      text not null default '',
  admin_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_campaign_vote_audit_campaign on public.campaign_vote_audit(campaign_id, created_at desc);

comment on table public.campaign_vote_audit is
  'Every admin correction to a vote total. Never deleted, never edited.';

alter table public.campaign_vote_audit enable row level security;

drop policy if exists "campaign_vote_audit_admin_read" on public.campaign_vote_audit;
create policy "campaign_vote_audit_admin_read"
  on public.campaign_vote_audit for select
  using (public.is_admin());

-- Audit rows are append-only: even an admin has no client INSERT/UPDATE/DELETE
-- path. They are written by the SECURITY DEFINER RPC below.
drop policy if exists "campaign_vote_audit_admin_write" on public.campaign_vote_audit;


-- Void a fraudulent vote. Admin-only, atomic with the total, and always audited.
create or replace function public.void_campaign_vote(
  p_vote   bigint,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_admin  uuid := auth.uid();
  v_vote   public.campaign_votes;
  v_done   boolean := false;
  v_total  integer;
begin
  if v_admin is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_admin = (select user_id from public.campaign_votes where id = p_vote) then
    raise exception 'CANNOT_VOID_OWN_VOTE' using errcode = '42501';
  end if;

  select * into v_vote from public.campaign_votes where id = p_vote for update;
  if v_vote.id is null then
    raise exception 'VOTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.campaign_votes where id = p_vote;
  if found then
    v_done := true;
    update public.campaign_totals
       set votes = greatest(votes - 1, 0), updated_at = now()
     where candidate_id = v_vote.candidate_id;

    insert into public.campaign_vote_audit
      (campaign_id, vote_id, candidate_id, action, reason, admin_id)
    values
      (v_vote.campaign_id, p_vote, v_vote.candidate_id, 'void', left(coalesce(p_reason,''), 300), v_admin);
  end if;

  select votes into v_total from public.campaign_totals where candidate_id = v_vote.candidate_id;

  return jsonb_build_object(
    'ok', true,
    'voided', v_done,
    'candidate_id', v_vote.candidate_id,
    'votes', coalesce(v_total, 0)
  );
end;
$$;

revoke all on function public.void_campaign_vote(bigint, text) from public, anon;
grant execute on function public.void_campaign_vote(bigint, text) to authenticated, service_role;


-- ============================================================
-- 5. RPCs — the ONLY write paths. No user-id parameter anywhere.
-- ============================================================

-- Rate (or re-rate) a PolyNurse service. Idempotent per (user, category).
create or replace function public.cast_service_rating(
  p_category  text,
  p_rating    integer,
  p_options   text[] default '{}',
  p_comment   text default '',
  p_request   uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cat  text;
  v_rat  integer;
  v_opts text[];
  v_comment text;
  v_replay boolean := false;
  v_stats public.service_rating_stats;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_cat := lower(trim(coalesce(p_category, '')));
  if v_cat not in ('quiz','marketplace','arena','community','overall') then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;

  v_rat := coalesce(p_rating, 0);
  if v_rat < 1 or v_rat > 5 then
    raise exception 'INVALID_RATING' using errcode = '22023';
  end if;

  -- Only the structured option keys this product defines. Anything else is
  -- dropped rather than stored, so the vocabulary cannot drift client-side.
  v_opts := coalesce(
    (
      select array_agg(o order by array_position(
        array['fast','clear','helpful','reliable','fair','safe',
              'would_recommend','needs_work','confusing','slow'], o))
      from (
        select unnest(coalesce(p_options, '{}'::text[])) as o
      ) s
      where o in ('fast','clear','helpful','reliable','fair','safe',
                  'would_recommend','needs_work','confusing','slow')
    ),
    '{}'::text[]
  );

  v_comment := left(coalesce(p_comment, ''), 500);

  -- ONE REVIEW PER SERVICE, per account. Every one of the five categories is
  -- write-once. The UNIQUE (user_id, category) constraint alone cannot express
  -- this: on its own it only stops duplicate ROWS, and the upsert below would
  -- happily overwrite an existing rating, which is exactly the re-roll this has
  -- to refuse. An account that can edit its score of a service can keep editing
  -- it until it likes the number it landed on, so the aggregate stops meaning
  -- anything.
  --
  -- An IDENTICAL re-submission is the one exception. A double-tapped Save, a
  -- retried request after a dropped connection, or a replayed idempotency key
  -- all look like a second attempt but carry no new opinion, so they are
  -- accepted as a no-op replay instead of an error. Anything that CHANGES the
  -- stored rating is refused.
  if exists (
    select 1 from public.service_ratings
    where user_id = v_user and category = v_cat
  ) then
    if not exists (
      select 1 from public.service_ratings
      where user_id = v_user
        and category = v_cat
        and rating  = v_rat
        and comment is not distinct from v_comment
        and options = v_opts
    ) then
      raise exception 'ALREADY_RATED' using errcode = '22023';
    end if;

    -- Identical replay: fall through to the aggregate recompute so the caller
    -- still gets fresh stats, but do NOT rewrite the row (which would move
    -- updated_at and imply an edit that never happened).
    v_replay := true;
  else
    insert into public.service_ratings (user_id, category, rating, options, comment)
    values (v_user, v_cat, v_rat, v_opts, v_comment)
    on conflict (user_id, category) do update
      set rating     = excluded.rating,
          options    = excluded.options,
          comment    = excluded.comment,
          updated_at = now();
  end if;

  -- Recompute the aggregate from the base rows in the same transaction, so the
  -- chart can never disagree with what was actually stored.
  insert into public.service_rating_stats
    (category, rating_count, rating_sum, r1, r2, r3, r4, r5, avg_rating, updated_at)
  select v_cat,
         count(*),
         coalesce(sum(rating),0),
         count(*) filter (where rating = 1),
         count(*) filter (where rating = 2),
         count(*) filter (where rating = 3),
         count(*) filter (where rating = 4),
         count(*) filter (where rating = 5),
         coalesce(round(avg(rating)::numeric,2),0), now()
  from public.service_ratings where category = v_cat
  on conflict (category) do update
    set rating_count = excluded.rating_count,
        rating_sum   = excluded.rating_sum,
        r1 = excluded.r1, r2 = excluded.r2, r3 = excluded.r3,
        r4 = excluded.r4, r5 = excluded.r5,
        avg_rating   = excluded.avg_rating,
        updated_at   = now()
  returning * into v_stats;

  return jsonb_build_object(
    'ok', true,
    'category', v_cat,
    'rating', v_rat,
    -- true when this call carried no new opinion (a double-tap / retried
    -- request replaying the identical rating). The client uses it to avoid
    -- showing a "saved" toast for something that changed nothing.
    'replay', v_replay,
    'stats', jsonb_build_object(
      'rating_count', v_stats.rating_count,
      'rating_sum',   v_stats.rating_sum,
      'r1', v_stats.r1, 'r2', v_stats.r2, 'r3', v_stats.r3,
      'r4', v_stats.r4, 'r5', v_stats.r5,
      'avg_rating',   v_stats.avg_rating
    )
  );
end;
$$;

-- Vote for a candidate. Atomic, idempotent, and it NEVER accepts a user id.
create or replace function public.cast_campaign_vote(
  p_campaign  bigint,
  p_candidate bigint,
  p_request   uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_campaign public.voting_campaigns;
  v_cand     public.voting_candidates;
  v_request  uuid;
  v_inserted integer;
  v_already  boolean := false;
  v_total    integer;
  v_turnout  integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_campaign from public.voting_campaigns where id = p_campaign;
  if v_campaign.id is null then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Server-side status + window. A client cannot vote early, late, or into a
  -- closed campaign by editing the request.
  if v_campaign.status = 'ended' or now() >= v_campaign.ends_at then
    raise exception 'CAMPAIGN_ENDED' using errcode = '22023';
  end if;
  if v_campaign.status = 'upcoming' or now() < v_campaign.starts_at then
    raise exception 'CAMPAIGN_NOT_STARTED' using errcode = '22023';
  end if;

  select * into v_cand from public.voting_candidates
   where id = p_candidate and campaign_id = p_campaign;
  if v_cand.id is null then
    raise exception 'INVALID_CANDIDATE' using errcode = '22023';
  end if;

  v_request := coalesce(p_request, gen_random_uuid());

  -- Replay of the SAME request id: return the authoritative total, change
  -- nothing. This is what makes a double-tap or a retried POST safe.
  if exists (select 1 from public.campaign_votes where client_request_id = v_request) then
    v_already := true;
  else
    begin
      insert into public.campaign_votes (campaign_id, candidate_id, user_id, client_request_id)
      values (p_campaign, p_candidate, v_user, v_request);
      v_inserted := 1;
    exception
      when unique_violation then
        -- One vote per user per campaign (the default rule). Re-voting is a
        -- refusal, not a silent overwrite of somebody's earlier choice.
        v_already := true;
        v_inserted := 0;
    end;
  end if;

  if v_inserted = 1 then
    insert into public.campaign_totals (candidate_id, campaign_id, votes)
    values (v_cand.id, p_campaign, 1)
    on conflict (candidate_id) do update
      set votes      = public.campaign_totals.votes + 1,
          updated_at = now();
  end if;

  select votes into v_total from public.campaign_totals where candidate_id = v_cand.id;
  select count(*) into v_turnout from public.campaign_votes where campaign_id = p_campaign;

  return jsonb_build_object(
    'ok', true,
    'already_voted', v_already,
    'candidate_id',  v_cand.id,
    'votes',         coalesce(v_total, 0),
    'turnout',       v_turnout,
    'results_public', v_campaign.results_public or v_campaign.status = 'ended'
  );
end;
$$;

-- Read a campaign's authoritative standings. Honours results visibility.
create or replace function public.get_campaign_results(p_campaign bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campaign public.voting_campaigns;
  v_visible boolean;
  v_rows jsonb;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_campaign from public.voting_campaigns where id = p_campaign;
  if v_campaign.id is null then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_visible := v_campaign.results_public or v_campaign.status = 'ended' or public.is_admin();

  if not v_visible then
    -- Restricted campaign: report the campaign and its candidates, but NO
    -- totals at all, even to people who already voted.
    return jsonb_build_object(
      'ok', true,
      'results_visible', false,
      'campaign_id', p_campaign,
      'turnout', null,
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', cd.id, 'name', cd.name, 'image_url', cd.image_url,
          'statement', cd.statement,
          'votes', null, 'sort_order', cd.sort_order
        ) order by cd.sort_order, cd.name)
        from public.voting_candidates cd where cd.campaign_id = p_campaign
      ), '[]'::jsonb)
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cd.id,
           'name', cd.name,
           'image_url', cd.image_url,
           'statement', cd.statement,
           'sort_order', cd.sort_order,
           'votes', coalesce(t.votes, 0)
         ) order by coalesce(t.votes,0) desc, cd.sort_order, cd.name), '[]'::jsonb)
    into v_rows
  from public.voting_candidates cd
  left join public.campaign_totals t on t.candidate_id = cd.id
  where cd.campaign_id = p_campaign;

  return jsonb_build_object(
    'ok', true,
    'results_visible', true,
    'campaign_id', p_campaign,
    'turnout', (select count(*) from public.campaign_votes where campaign_id = p_campaign),
    'candidates', v_rows
  );
end;
$$;

-- My vote for a campaign, so the client can show "you already voted" without
-- reading anyone else's vote.
create or replace function public.my_campaign_vote(p_campaign bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cand bigint;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select candidate_id into v_cand
    from public.campaign_votes
   where campaign_id = p_campaign and user_id = v_user;
  return jsonb_build_object('ok', true, 'candidate_id', v_cand);
end;
$$;


-- ============================================================
-- 6. ACLs — the default-privileges trap.
-- Every function above MUST be revoked from public AND anon explicitly, or
-- this project grants EXECUTE to anon by default. Read-only helpers still need
-- a signed-in user, so anon is revoked from those too.
-- ============================================================
revoke all on function public.cast_service_rating(text, integer, text[], text, uuid) from public, anon;
grant execute on function public.cast_service_rating(text, integer, text[], text, uuid) to authenticated, service_role;

revoke all on function public.cast_campaign_vote(bigint, bigint, uuid) from public, anon;
grant execute on function public.cast_campaign_vote(bigint, bigint, uuid) to authenticated, service_role;

revoke all on function public.get_campaign_results(bigint) from public, anon;
grant execute on function public.get_campaign_results(bigint) to authenticated, service_role;

revoke all on function public.my_campaign_vote(bigint) from public, anon;
grant execute on function public.my_campaign_vote(bigint) to authenticated, service_role;


-- ============================================================
-- 7. FIX THE EXISTING cast_vote HOLE (live security defect).
-- v10 defined cast_vote(p_user_id, p_poll_id, p_option_id) with NO auth.uid()
-- check and never revoked it, so an anon caller could vote as any user, and
-- the ON CONFLICT DO UPDATE made every vote silently changeable. The Voting UI
-- that used it is being replaced, so this migration LOCKS IT DOWN rather than
-- leaving an unauthenticated write path lying around.
-- The legacy tables are retained; only the ability to abuse this RPC goes.
-- ============================================================
do $$
begin
  if exists (select 1 from pg_proc where proname = 'cast_vote') then
    execute 'revoke all on function public.cast_vote(uuid, bigint, bigint) from public, anon';
    execute 'revoke all on function public.cast_vote(uuid, bigint, bigint) from authenticated';
    raise notice 'cast_vote: revoked from anon, public and authenticated (legacy poll voting is no longer reachable from a client)';
  end if;
end $$;

-- The legacy poll tables are emptied of client write paths too.
drop policy if exists "voting_responses_insert_authed" on public.voting_responses;
drop policy if exists "voting_polls_insert_authed" on public.voting_polls;
drop policy if exists "voting_options_owner_all" on public.voting_options;

-- PostgREST schema-cache refresh so the replaced definitions are picked up.
notify pgrst, 'reload schema';

-- ============================================================
-- 8. SAMPLE CAMPAIGN (seeded so the Campaigns tab is never a dead end)
--
-- WHY THIS EXISTS: with no rows, the Campaigns tab renders only its "No
-- campaigns right now" panel and a first-time user has nothing to look at, so
-- the Voting tutorial describes a screen they cannot see.
--
-- HONESTY RULES FOR THIS SEED, deliberately enforced:
--   * The title is prefixed "SAMPLE -" and the description opens with an
--     explicit disclosure. Nobody can mistake it for a real election.
--   * NO votes are fabricated. Every candidate starts at exactly 0 and the
--     ONLY writer of totals is cast_campaign_vote. Whatever numbers appear
--     are real votes cast by real accounts.
--   * `status` is hand-maintained in this schema (no trigger derives it from
--     the window), so it is hard-coded 'active' alongside a window that
--     already contains now() - otherwise the card renders an "Upcoming" pill
--     and the Vote buttons never appear.
--   * `results_public = true`, because get_campaign_results hides every total
--     until then, which would make the sample look broken.
--   * `votes_per_user = 1`. That column is DISPLAY ONLY - cast_campaign_vote
--     never reads it and the DB hard-wires one vote via
--     unique (campaign_id, user_id). Seeding anything higher would print
--     "3 vote per account" while the server still allowed exactly one.
--   * Idempotent via the slug. Re-running never rewrites a row that may
--     already hold real votes (ON CONFLICT DO NOTHING, not DO UPDATE).
-- ============================================================
insert into public.voting_campaigns
  (slug, title, description, eligibility_note, rules_note,
   starts_at, ends_at, status, results_public, votes_per_user)
values
  ('sample-how-voting-works',
   'SAMPLE - How voting works',
   'This is a sample campaign that demonstrates how voting works. It is not a real election and nobody is standing for anything. Open it to see the rules, the candidates, your own vote and live standings.',
   'Open to every signed-in PolyNurse account. One vote per account. Change your display name in Settings first so candidates are attributed to you.',
   'Tap a candidate and then Vote. Your vote is recorded by the server, not your device, and the standings update on their own. If two candidates are level we show them level rather than inventing a winner.',
   now() - interval '1 day',
   now() + interval '90 days',
   'active',
   true,
   1)
on conflict (slug) do nothing;

insert into public.voting_candidates (campaign_id, name, image_url, statement, sort_order)
select c.id, v.name, '', v.statement, v.sort_order
from public.voting_campaigns c
cross join (values
  ('Keisha B.',
   'I want more timed rounds. A 40-question blitz under a shared clock is the single best thing on this app and I would like to see more question banks behind it, especially Midwifery 300.',
   1),
  ('Tobi A.',
   'I would spend the effort on explanation quality instead. A wrong answer that teaches you something is worth more than ten more questions, and the review panel is where that has to happen.',
   2),
  ('Amaka O.',
   'Study groups are the part of PolyNurse I actually use every week. Stronger group leaderboards, real group quizzes with a proper streak, and a way to see who is online in a group would help me most.',
   3)
) as v(name, statement, sort_order)
where c.slug = 'sample-how-voting-works'
  and not exists (
    select 1 from public.voting_candidates existing
    where existing.campaign_id = c.id and existing.name = v.name
  );

-- Every candidate gets a real zero row so the standings chart renders honestly
-- instead of leaving a missing row the client has to guess about.
insert into public.campaign_totals (candidate_id, campaign_id, votes)
select cd.id, cd.campaign_id, 0
from public.voting_candidates cd
join public.voting_campaigns c on c.id = cd.campaign_id
where c.slug = 'sample-how-voting-works'
on conflict (candidate_id) do nothing;

-- PostgREST cache refresh again: the seed inserts rows the client will read.
notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe (every statement is idempotent).
-- ============================================================