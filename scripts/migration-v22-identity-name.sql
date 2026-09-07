-- v22 — Identity display names (no real names in community / duels).
-- Adds an editable public identity name to profiles; the community views now
-- expose that name (fallback: "Scholar") instead of full_name, so other users
-- never see real names in feeds, comments, group boards, or reviews.
alter table public.profiles add column if not exists identity_name text;

do $$
begin
  drop view if exists public.community_feed;
exception when wrong_object_type or undefined_table then null;
end $$;
do $$
begin
  drop view if exists public.community_profiles;
exception when wrong_object_type or undefined_table then null;
end $$;

create view public.community_profiles as
  select id,
         case
           when coalesce(nullif(trim(identity_name), ''), '') = '' then 'Scholar'
           else trim(identity_name)
         end as display_name,
         '' as avatar_url,
         case when level ~ '^\d' then regexp_replace(level, '[^0-9]', '', 'g') else null end as year
  from public.profiles;

create view public.community_feed as
  select
    p.id,
    p.author_id,
    p.content,
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

grant select on public.community_profiles to anon, authenticated;
grant select on public.community_feed to anon, authenticated;