-- migration-v42: Anonymous-room up/down voting + default ₦499 spectator price.
-- APPLIES to project urhcvdcpxhxmmnavkcvd. Idempotent — safe to re-run.
--
-- 1. community_post_votes: per-(post,user) single vote, value ∈ {-1,1}; 0 is
--    expressed as "no row" (the API deletes on a clear vote), so net score is
--    just SUM(value). RLS enabled with NO client policies: reads and writes are
--    service-role ONLY (the api/_community.js handler hydrates scores server-
--    side), mirroring the v39 lockdown of community_posts/comments/likes.
-- 2. Backfill: existing community_post_likes become up-votes (value=1) so
--    historically-liked posts keep their intent.
-- 3. Future anonymous rooms default spectator_price to ₦499 (v40 normalized
--    existing rooms; new rows otherwise fell back to the column default 0).

-- ---------------------------------------------------------------------------
-- 1. Votes table
-- ---------------------------------------------------------------------------
create table if not exists public.community_post_votes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null default 1,
  created_at timestamptz not null default now(),
  constraint community_post_votes_pkey primary key (post_id, user_id),
  constraint community_post_votes_value_check check (value in (-1, 1))
);

create index if not exists idx_community_post_votes_post
  on public.community_post_votes (post_id);
create index if not exists idx_community_post_votes_user
  on public.community_post_votes (user_id);

alter table public.community_post_votes enable row level security;

-- No public/anon/authenticated policies are created on purpose. Service-role
-- (the API) is the only writer and the only reader that matters; the AppContext
-- and room UIs hydrate scores through /api/community handlers.

-- ---------------------------------------------------------------------------
-- 2. Backfill likes -> up-votes (idempotent)
-- ---------------------------------------------------------------------------
insert into public.community_post_votes (post_id, user_id, value)
select post_id, user_id, 1
from public.community_post_likes
on conflict (post_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Default spectator price for NEW anonymous rooms
-- ---------------------------------------------------------------------------
alter table public.study_groups
  alter column spectator_price set default 499;