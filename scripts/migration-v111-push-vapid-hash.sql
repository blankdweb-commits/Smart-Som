-- ============================================================
-- migration-v111-push-vapid-hash.sql
--
-- Track which VAPID key a browser push subscription was created with. After a
-- VAPID rotation the API can skip and remove subscriptions minted with the old
-- key instead of repeatedly sending to endpoints the browser will reject.
--
-- The value is a SHA-256 hex digest of the PUBLIC VAPID key. It is not a secret.
-- Existing rows are backfilled by scripts/backfill-push-vapid-key.mjs BEFORE a
-- rotation (using the then-current key) so they survive the change; the client
-- also re-registers on its next app open.
--
-- Idempotent and forward-only. Requires v44 push_subscriptions.
-- Apply: node scripts/run-migration.mjs scripts/migration-v111-push-vapid-hash.sql
-- ============================================================

alter table public.push_subscriptions
  add column if not exists vapid_key_hash text;

create index if not exists idx_push_subscriptions_vapid_key_hash
  on public.push_subscriptions (vapid_key_hash);

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
