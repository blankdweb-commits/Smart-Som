drop policy if exists "analytics_select_own" on public.learning_analytics;
create policy "analytics_all_own"
  on public.learning_analytics for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
