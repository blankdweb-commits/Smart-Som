-- ============================================================
-- Apex Scholars Migration v4b — Nursing Community Sections
-- Adds a `section` attribute to community posts so the community
-- feed can be split into nursing-specific discussion boards:
--   clinical, study-groups, exams, clinical-experience,
--   pharmacology, adult-health, maternal-child, mental-health,
--   school, general (default).
-- Idempotent. Safe to re-run. Must run before migr-v4c.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SECTION COLUMN
-- ------------------------------------------------------------
alter table public.community_posts add column if not exists section text not null default 'general';

create index if not exists idx_community_posts_section on public.community_posts(section);

-- Integrity guard: only known sections are allowed.
do $$
begin
  alter table public.community_posts
    add constraint community_posts_section_check
    check (section in (
      'general', 'clinical', 'study-groups', 'exams',
      'clinical-experience', 'pharmacology', 'adult-health',
      'maternal-child', 'mental-health', 'school'
    ));
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- 2. RECREATE community_feed VIEW with `section`
--    community_feed may be a VIEW or TABLE depending on the
--    installed schema version, so drop each safely first.
-- ------------------------------------------------------------
do $$
begin
  drop view if exists public.community_feed;
exception when wrong_object_type or undefined_table then null;
end $$;
do $$
begin
  drop table if exists public.community_feed cascade;
exception when wrong_object_type then null;
end $$;

create view public.community_feed as
  select
    p.id,
    p.author_id,
    p.content,
    p.image_url,
    p.section,
    p.created_at,
    cp.display_name,
    cp.avatar_url,
    cp.year,
    (select count(*) from public.community_post_likes l where l.post_id = p.id)::int as like_count,
    (select count(*) from public.community_comments c where c.post_id = p.id and not c.is_deleted)::int as reply_count,
    (select count(*) from public.community_post_shares s where s.post_id = p.id)::int as share_count,
    exists (
      select 1 from public.community_post_likes l2
      where l2.post_id = p.id and l2.user_id = auth.uid()
    ) as liked_by_current_user
  from public.community_posts p
  left join public.community_profiles cp on cp.id = p.author_id
  where not p.is_deleted and not p.is_hidden;

grant select on public.community_feed to anon, authenticated;

-- ============================================================
-- DONE.
-- ============================================================