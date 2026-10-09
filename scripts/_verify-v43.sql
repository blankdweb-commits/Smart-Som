select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='community_posts' and column_name='expires_at') as has_col,
  (select count(*) from pg_trigger where tgname='trg_community_posts_assign_expiry') as has_trigger,
  (select position('expires_at' in pg_get_functiondef('public.community_post_lives_until(public.community_posts)'::regprocedure)) > 0) as lives_uses_expires,
  (select position('expires_at is not null' in pg_get_functiondef('public.community_cleanup(timestamptz)'::regprocedure)) > 0) as cleanup_branches,
  (select count(*) from public.community_posts cp join public.study_groups g on g.id=cp.group_id
     where g.type='anonymous' and cp.expires_at is null) as anon_null_expiry,
  (select count(*) from public.community_posts cp join public.study_groups g on g.id=cp.group_id
     where g.type='anonymous' and cp.expires_at is not null) as anon_with_expiry;
