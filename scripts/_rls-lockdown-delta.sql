-- TEMP delta: drop legacy client-write policies (delete after use).
-- Applied to the ALREADY-migrated live DB; fresh installs get these via
-- migration-v29-community-ephemeral-anonymous.sql.
drop policy if exists "Users can create community posts" on public.community_posts;
drop policy if exists "Users can update own community posts" on public.community_posts;
drop policy if exists "Users can delete own community posts" on public.community_posts;
drop policy if exists "Users can view community posts" on public.community_posts;

drop policy if exists "Users can create community comments" on public.community_comments;
drop policy if exists "Users can update own comments" on public.community_comments;
drop policy if exists "Users can delete own comments" on public.community_comments;
drop policy if exists "Users can view community comments" on public.community_comments;

drop policy if exists "Users can like posts" on public.community_post_likes;
drop policy if exists "Users can unlike posts" on public.community_post_likes;
drop policy if exists "Users can view post likes" on public.community_post_likes;

drop policy if exists "Users can create reports" on public.community_reports;
drop policy if exists "reports_insert_authed" on public.community_reports;