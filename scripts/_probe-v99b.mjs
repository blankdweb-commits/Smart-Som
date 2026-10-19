// TEMPORARY probe 2 — proves the REFUSALS, which probe 1 could not (the
// Management API query endpoint swallows RAISE NOTICE, so a caught exception
// looks identical to a silent no-op). Here each refusal is asserted on the
// HTTP error the statement actually produces.
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = env.VITE_SUPABASE_PROJECT_REF || 'urhcvdcpxhxmmnavkcvd';
const token = env.SUPABASE_ACCESS_TOKEN || process.env.ACCESS_TOKEN;

async function raw(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body };
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// Each of these MUST fail. A 200 here means the guard did not fire.
const mustRefuse = async (label, q, expect) => {
  const r = await raw(q);
  const hit = !r.ok && r.body.includes(expect);
  check(label, hit, hit ? r.body.match(/"message":"([^"]{0,110})/)?.[1] || '' : `HTTP ${r.status} ${r.body.slice(0, 160)}`);
};
const mustAccept = async (label, q) => {
  const r = await raw(q);
  check(label, r.ok, r.ok ? '' : `HTTP ${r.status} ${r.body.slice(0, 160)}`);
  return r.ok ? JSON.parse(r.body) : null;
};

const stamp = Date.now().toString().slice(-8);

// ---- fixtures ------------------------------------------------------------
const made = await mustAccept('fixture: scratch room', `
  insert into public.study_groups (name, description, creator_id, type, privacy, group_state)
  select 'V99b ${stamp}', 'probe', id, 'anonymous', 'restricted', 'waiting'
    from auth.users order by created_at limit 1
  returning id;`);
const gid = made[0].id;
await raw(`update public.study_groups set group_state='active' where id=${gid};`);

// ---- 1. duration bounds -------------------------------------------------
console.log('\n--- duration 40..60 ---');
await mustRefuse('duration 39 is refused by the CHECK',
  `update public.study_groups set event_duration_minutes = 39 where id = ${gid};`,
  'study_groups_event_duration_check');
await mustRefuse('duration 61 is refused by the CHECK',
  `update public.study_groups set event_duration_minutes = 61 where id = ${gid};`,
  'study_groups_event_duration_check');
await mustRefuse('duration 0 is refused by the CHECK',
  `update public.study_groups set event_duration_minutes = 0 where id = ${gid};`,
  'study_groups_event_duration_check');
await mustAccept('duration 40 is accepted',
  `update public.study_groups set event_duration_minutes = 40 where id = ${gid};`);
await mustAccept('duration 60 is accepted',
  `update public.study_groups set event_duration_minutes = 60 where id = ${gid};`);

// ---- 2. the window CHECK + the immutability guard ------------------------
console.log('\n--- the clock cannot be moved off start + duration ---');
await mustRefuse('extending event_ends_at is refused',
  `update public.study_groups set event_ends_at = event_ends_at + interval '10 minutes' where id = ${gid};`,
  'study_groups_event_window_check');
await mustRefuse('shrinking event_ends_at alone is refused',
  `update public.study_groups set event_ends_at = event_ends_at - interval '10 minutes' where id = ${gid};`,
  'study_groups_event_window_check');

// THE HOLE THIS TRIGGER EXISTS TO CLOSE. Moving BOTH columns forward together
// satisfies the window CHECK, so before trg_anon_event_clock_lock it returned
// HTTP 201. It must now be refused by EVENT_CLOCK_IMMUTABLE.
await mustRefuse('moving BOTH forward together is refused (the extension hole)',
  `update public.study_groups set event_started_at = event_started_at + interval '10 minutes',
                                 event_ends_at = event_ends_at + interval '10 minutes' where id = ${gid};`,
  'EVENT_CLOCK_IMMUTABLE');
await mustRefuse('moving BOTH backward together is also refused once the clock exists',
  `update public.study_groups set event_started_at = event_started_at - interval '10 minutes',
                                 event_ends_at = event_ends_at - interval '10 minutes' where id = ${gid};`,
  'EVENT_CLOCK_IMMUTABLE');
await mustRefuse('changing the duration of a RUNNING event is refused',
  `update public.study_groups set event_duration_minutes = 40 where id = ${gid};`,
  'study_groups_event_window_check');
await mustAccept('rewriting the same window with identical values is a no-op, not an error',
  `update public.study_groups set event_started_at = event_started_at, event_ends_at = event_ends_at where id = ${gid};`);
await mustRefuse('an invented ended_reason is refused',
  `update public.study_groups set event_ended_reason = 'whatever' where id = ${gid};`,
  'study_groups_event_ended_reason_check');

// CONFIGURATION must still work while the room has never run an event — that is
// how 40 vs 60 gets chosen at all.
await mustAccept('duration may still be configured before the event starts',
  `update public.study_groups set group_state='waiting', event_started_at=null, event_ends_at=null where id = ${gid};
   update public.study_groups set event_duration_minutes = 45 where id = ${gid};`);
await mustAccept('a deadline may be pre-configured before the event starts',
  `update public.study_groups set event_started_at = now() + interval '5 minutes',
                                 event_ends_at = now() + interval '50 minutes' where id = ${gid};`);

// ---- 3. a 40-minute event really ends at 40, a 60 at 60 ----------------
console.log('\n--- a 40-minute configuration ends at 40, a 60-minute at 60 ---');
const span = async (mins) => {
  const r = await raw(`update public.study_groups set event_duration_minutes = ${mins},
      event_started_at = null, event_ends_at = null, event_ended_at = null, group_state='waiting'
      where id = ${gid};`);
  if (!r.ok) return { err: r.body.slice(0, 160) };
  const a = await raw(`update public.study_groups set group_state='active' where id=${gid}
      returning round(extract(epoch from (event_ends_at-event_started_at))/60.0,4) m;`);
  return JSON.parse(a.body)[0].m;
};
check('configured 40 produces a 40-minute window', String(await span(40)) === '40.0000', `got ${await span(40)}`);
check('configured 60 produces a 60-minute window', String(await span(60)) === '60.0000', `got ${await span(60)}`);

// ---- 4. the seat guard on an ended event --------------------------------
console.log('\n--- no new seat may be granted into an ended event ---');
await raw(`update public.study_groups set event_started_at = now() - interval '61 minutes',
            event_ends_at = now() - interval '1 minute' where id = ${gid};`);
const u = (await mustAccept('fixture: a user', `select id from auth.users order by created_at desc limit 1;`))[0].id;

await mustRefuse('member seat refused on an ended event',
  `insert into public.study_group_members (group_id, user_id, role) values (${gid}, '${u}', 'member');`,
  'EVENT_ENDED');
await mustRefuse('spectator seat refused on an ended event',
  `insert into public.anonymous_spectators (group_id, user_id, reference, amount)
   values (${gid}, '${u}', 'v99b-${stamp}', 0);`,
  'EVENT_ENDED');
const seats = await mustAccept('neither row was written',
  `select (select count(*) from public.study_group_members where group_id=${gid}) m,
          (select count(*) from public.anonymous_spectators where group_id=${gid}) s;`);
check('  -> study_group_members still empty', seats[0].m === 0, JSON.stringify(seats[0]));
check('  -> anonymous_spectators still empty', seats[0].s === 0, JSON.stringify(seats[0]));

// A room that has not started must still accept a seat (creation path).
const made2 = await mustAccept('fixture: second scratch room', `
  insert into public.study_groups (name, description, creator_id, type, privacy, group_state)
  select 'V99c ${stamp}', 'probe', id, 'anonymous', 'restricted', 'waiting'
    from auth.users order by created_at limit 1
  returning id;`);
await mustAccept('a never-started room still accepts a seat (creation path unbroken)',
  `insert into public.study_group_members (group_id, user_id, role) values (${made2[0].id}, '${u}', 'member');`);

// ---- 5. exactly-once under concurrency ---------------------------------
console.log('\n--- concurrent end requests end the event exactly once ---');
await raw(`update public.study_groups set group_state='waiting', event_started_at=null, event_ends_at=null,
            event_ended_at=null, event_ended_reason=null where id=${made2[0].id};`);
await raw(`update public.study_groups set group_state='active' where id=${made2[0].id};`);
const gid2 = made2[0].id;
const [a, b, c] = await Promise.all([
  raw(`select public.community_anonymous_event_end(${gid2}, 'moderator');`),
  raw(`select public.community_anonymous_event_end(${gid2}, 'moderator');`),
  raw(`select public.community_anonymous_event_end(${gid2}, 'moderator');`),
]);
const results = [a, b, c].map(r => JSON.parse(r.body)[0].community_anonymous_event_end);
const fresh = results.filter(r => r.already_ended === false).length;
check('exactly one of three concurrent end calls did the work', fresh === 1, JSON.stringify(results.map(r => r.already_ended)));
const endedAt = (await mustAccept('recorded end time', `select event_ended_at from public.study_groups where id=${gid2};`))[0].event_ended_at;
check('  -> one recorded end time', !!endedAt, String(endedAt));
const reason = (await mustAccept('recorded reason', `select event_ended_reason from public.study_groups where id=${gid2};`))[0].event_ended_reason;
check('  -> reason preserved', reason === 'moderator', String(reason));

// ---- 6. ACLs: the end/sweep RPCs must NOT be executable by anon --------
console.log('\n--- ACLs ---');
const acl = await mustAccept('acl probe', `
  select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
         has_function_privilege('service_role', p.oid, 'EXECUTE') svc_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('community_anonymous_event_end','community_anonymous_event_sweep')
   order by p.proname;`);
for (const row of acl) {
  check(`${row.proname}: anon/authenticated refused, service_role allowed`,
    row.anon_exec === false && row.auth_exec === false && row.svc_exec === true, JSON.stringify(row));
}

// ---- cleanup ------------------------------------------------------------
await raw(`delete from public.community_posts where group_id in (${gid}, ${gid2});`);
await raw(`delete from public.study_group_members where group_id in (${gid}, ${gid2});`);
await raw(`delete from public.anonymous_spectators where group_id in (${gid}, ${gid2});`);
await raw(`delete from public.study_groups where id in (${gid}, ${gid2});`);
const left = await mustAccept('probe rooms removed', `select count(*)::int c from public.study_groups where name like 'V99%';`);
check('cleanup: no probe rooms left', left[0].c === 0, JSON.stringify(left[0]));

console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
process.exit(fail ? 1 : 0);
