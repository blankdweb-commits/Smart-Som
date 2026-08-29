-- ============================================================
-- Apex Scholars Migration v8 — Quiz sound effects storage
-- Creates a public `sounds` storage bucket that hosts the quiz
-- sound clips (start/correct/wrong/timeout) served to the client.
-- Uploads happen separately via scripts/upload-sounds.mjs using the
-- service-role key; the bucket is public so the player can stream clips
-- straight from a public URL without auth.
-- Idempotent. Safe to re-run.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('sounds', 'sounds', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "sounds_public_read" on storage.objects;
create policy "sounds_public_read"
  on storage.objects for select using (bucket_id = 'sounds');

drop policy if exists "sounds_service_write" on storage.objects;
create policy "sounds_service_write"
  on storage.objects for insert
  with check (bucket_id = 'sounds' and (
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ));

-- ============================================================
-- DONE.
-- ============================================================
