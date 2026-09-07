-- v23 — Repair community_feed view dropped columns (group_id, section, image_url).
-- v22 recreated the view without group_id/section/image_url; PostgREST then
-- rejects the client's `group_id=is.null` filter with HTTP 400. Rebuild the view
-- with the full original column set (migration-v4c) while keeping the
-- identity-first display_name from the v22 community_profiles view.
do $$
begin
  drop view if exists public.community_feed;
exception when wrong_object_type or undefined_table then null;
end $$;

create view public.community_feed as
  select
    p.id,
    p.author_id,
    p.content,
    p.image_url,
    p.section,
    p.group_id,
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