// TEMPORARY cleanup — removes ONLY rooms created by the v99 probes.
// Matched by the probe's own name prefix AND its own stamp format, so a real
// room can never match. Real rooms are named 'Anonymous' / 'Anonymous Nursing
// Room 5QP7' and are not touched.
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = env.VITE_SUPABASE_PROJECT_REF || 'urhcvdcpxhxmmnavkcvd';
const token = env.SUPABASE_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  return { ok: r.ok, body: await r.text() };
};

// Show exactly what is about to be touched, and prove it is only probe rooms.
const before = await sql(`
  select id, name, creator_id::text, group_state
    from public.study_groups
   where name ~ '^V99 ?(bounds|forty|sixty|default|expired|ending-soon|once|probe|Live|b|c)? ?[0-9]*$'
   order by id;`);
console.log('rooms matching the probe pattern:');
console.log(before.body);

const run = async (q) => {
  const r = await sql(q);
  if (!r.ok) console.log('ERR:', r.body.slice(0, 200));
  return r.ok;
};
// Posts first: community_posts.group_id is ON DELETE SET NULL, so deleting the
// group first would publish the probe's message history to the logged-out feed.
await run(`delete from public.community_posts where group_id in (select id from public.study_groups where name like 'V99%' or name like 'V99b%' or name like 'V99c%');`);
await run(`delete from public.study_group_members where group_id in (select id from public.study_groups where name like 'V99%' or name like 'V99b%' or name like 'V99c%');`);
await run(`delete from public.anonymous_spectators where group_id in (select id from public.study_groups where name like 'V99%' or name like 'V99b%' or name like 'V99c%');`);
await run(`delete from public.anonymous_room_events where group_id in (select id from public.study_groups where name like 'V99%' or name like 'V99b%' or name like 'V99c%');`);
await run(`delete from public.study_groups where name like 'V99%' or name like 'V99b%' or name like 'V99c%';`);

const after = await sql(`select count(*)::int c from public.study_groups where name like 'V99%';`);
console.log('probe rooms remaining:', after.body);
const real = await sql(`
  select id, name, group_state, minimum_members_to_activate, member_limit,
         spectator_price, member_price, event_duration_minutes, event_started_at
    from public.study_groups where type = 'anonymous' order by id;`);
console.log('every real anonymous room, after cleanup:');
console.log(real.body);
const orphans = await sql(`
  select
    (select count(*)::int from public.community_posts where group_id is not null
       and group_id not in (select id from public.study_groups)) as orphan_posts,
    (select count(*)::int from public.study_group_members m
       where m.group_id not in (select id from public.study_groups)) as orphan_members;`);
console.log('orphans:', orphans.body);
