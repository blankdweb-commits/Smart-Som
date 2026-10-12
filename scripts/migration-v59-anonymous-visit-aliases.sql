-- ------------------------------------------------------------
-- v59 — PER-VISIT ANONYMOUS ROOM IDENTITIES
--
-- WS3: a member keeps exactly ONE identity row per room
-- (primary key group_id, user_id) but the displayed "Anonymous #NN"
-- pseudonym is RE-ROLLED whenever the member returns in a NEW visit.
-- A visit is identified by a client-minted `visit_key` (one per browser
-- session/tab, stored in sessionStorage). Membership, seats, roles and
-- any stored history are NOT touched — only the pseudonym number, so a
-- member cannot be correlated across separate visits.
--
-- The alias -> user mapping still resolves within a room because
-- `unique (group_id, alias)` (v39) holds: re-rolling picks a fresh,
-- currently-unused number (the server retries on 23505).
--
-- SERVICE-ROLE ONLY: the identity table must never be readable by a
-- client (the alias <-> user mapping is private). No policy is added;
-- the revoke is re-asserted because column additions never grant client
-- access on their own.
-- IDEMPOTENT: safe to re-run.
-- ------------------------------------------------------------

alter table public.anonymous_room_identities
  add column if not exists visit_key text;

create index if not exists idx_anonymous_room_identities_visit
  on public.anonymous_room_identities (group_id, visit_key);

-- Re-assert the private (service-role only) contract.
revoke all on public.anonymous_room_identities from public, anon, authenticated;
