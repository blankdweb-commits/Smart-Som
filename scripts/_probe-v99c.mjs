// TEMPORARY probe 3 — reworked around the fact that trg_anon_event_clock_lock
// makes a started room's window immutable. A clock must therefore be CONFIGURED
// while the room is still 'waiting', then activation adopts it. That is the
// route the migration documents, and the route the e2e suite will use instead of
// waiting 40 minutes for an event to expire.
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
  return { status: res.status, ok: res.ok, body: await res.text() };
}
let pass = 0, fail = 0;
const check = (l, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); ok ? pass++ : fail++; };
const mustRefuse = async (l, q, expect) => {
  const r = await raw(q);
  const hit = !r.ok && r.body.includes(expect);
  check(l, hit, hit ? (r.body.match(/(?:ERROR:  [0A-Z]+: [A-Z_]+)/)?.[0] || '') : `HTTP ${r.status} ${r.body.slice(0, 140)}`);
};
const ok2 = async (l, q, detail = '') => {
  const r = await raw(q);
  check(l, r.ok, r.ok ? detail : `HTTP ${r.status} ${r.body.slice(0, 140)}`);
  return r.ok ? JSON.parse(r.body) : null;
};

const stamp = Date.now().toString().slice(-8);
const rooms = [];
const newRoom = async (tag) => {
  const r = await ok2(`fixture: ${tag}`, `
    insert into public.study_groups (name, description, creator_id, type, privacy, group_state)
    select 'V99 ${tag} ${stamp}', 'probe', id, 'anonymous', 'restricted', 'waiting'
      from auth.users order by created_at limit 1
    returning id;`);
  rooms.push(r[0].id);
  return r[0].id;
};
// The supported route: configure the whole window while the room has never run.
const configure = (id, startExpr, mins) =>
  `update public.study_groups
      set event_duration_minutes = ${mins},
          event_started_at = ${startExpr},
          event_ends_at    = ${startExpr} + make_interval(mins => ${mins})
    where id = ${id};`;
const activate = (id) => `update public.study_groups set group_state = 'active' where id = ${id};`;

// ---- A. duration bounds, checked on a never-started room -----------------
console.log('\n--- A. duration is 40..60, and it is configurable before the start ---');
const A = await newRoom('bounds');
for (const bad of [0, 39, 61, 90]) {
  await mustRefuse(`duration ${bad} refused while unconfigured`,
    `update public.study_groups set event_duration_minutes = ${bad} where id = ${A};`,
    'study_groups_event_duration_check');
}
for (const good of [40, 45, 60]) {
  await ok2(`duration ${good} accepted before the event starts`,
    `update public.study_groups set event_duration_minutes = ${good} where id = ${A};`);
}

// ---- B. 40 ends at 40, 60 ends at 60 ------------------------------------
console.log('\n--- B. the configured window is exactly what was asked for ---');
const B40 = await newRoom('forty');
await ok2('configure a 40-minute window', configure(B40, 'now()', 40));
const b40 = await ok2('activate and read the window', `
  ${activate(B40)}
  select round(extract(epoch from (event_ends_at - event_started_at))/60.0, 4) as mins,
         public._anon_event_state(${B40}) as state,
         public._anon_event_over(${B40}) as over_
    from public.study_groups where id = ${B40};`);
check('a 40-minute event has a 40-minute window', Number(b40[0].mins) === 40, JSON.stringify(b40[0]));
check('  -> state is live', b40[0].state === 'live', b40[0].state);
check('  -> not over', b40[0].over_ === false, String(b40[0].over_));

const B60 = await newRoom('sixty');
await ok2('configure a 60-minute window', configure(B60, 'now()', 60));
const b60 = await ok2('activate and read the window', `
  ${activate(B60)}
  select round(extract(epoch from (event_ends_at - event_started_at))/60.0, 4) as mins,
         public._anon_event_state(${B60}) as state
    from public.study_groups where id = ${B60};`);
check('a 60-minute event has a 60-minute window', Number(b60[0].mins) === 60, JSON.stringify(b60[0]));

// A room with NO configured clock stamps 60 on activation.
const Bdef = await newRoom('default');
const bdef = await ok2('an unconfigured room gets 60 minutes on activation', `
  ${activate(Bdef)}
  select event_duration_minutes d, round(extract(epoch from (event_ends_at - event_started_at))/60.0,4) m
    from public.study_groups where id = ${Bdef};`);
check('  -> default duration is 60', bdef[0].d === 60 && Number(bdef[0].m) === 60, JSON.stringify(bdef[0]));

// ---- C. the extension hole ------------------------------------------------
console.log('\n--- C. a running event cannot be extended ---');
await mustRefuse('pushing the deadline out is refused',
  `update public.study_groups set event_ends_at = event_ends_at + interval '10 minutes' where id = ${B60};`,
  'EVENT_CLOCK_IMMUTABLE');
await mustRefuse('pushing BOTH start and deadline out is refused (this was the hole)',
  `update public.study_groups set event_started_at = event_started_at + interval '10 minutes',
                                 event_ends_at = event_ends_at + interval '10 minutes' where id = ${B60};`,
  'EVENT_CLOCK_IMMUTABLE');
await mustRefuse('changing the duration of a running event is refused',
  `update public.study_groups set event_duration_minutes = 40 where id = ${B60};`,
  'study_groups_event_window_check');
const still60 = await ok2('  -> the window is untouched after those attempts',
  `select round(extract(epoch from (event_ends_at - event_started_at))/60.0,4) m from public.study_groups where id = ${B60};`);
check('  -> still exactly 60 minutes', Number(still60[0].m) === 60, JSON.stringify(still60[0]));

// ---- D. activation is idempotent -----------------------------------------
console.log('\n--- D. re-activation cannot restart the clock ---');
const before = await ok2('read the clock', `select event_started_at, event_ends_at from public.study_groups where id = ${B60};`);
await ok2('deactivate and reactivate twice', `
  update public.study_groups set group_state='waiting' where id=${B60};
  ${activate(B60)}
  update public.study_groups set group_state='waiting' where id=${B60};
  ${activate(B60)}`);
const after = await ok2('read the clock again', `select event_started_at, event_ends_at from public.study_groups where id = ${B60};`);
check('start time unchanged', before[0].event_started_at === after[0].event_started_at,
  `${before[0].event_started_at} -> ${after[0].event_started_at}`);
check('deadline unchanged', before[0].event_ends_at === after[0].event_ends_at,
  `${before[0].event_ends_at} -> ${after[0].event_ends_at}`);

// ---- E. expiry refuses new seats -----------------------------------------
console.log('\n--- E. once the deadline passes, no new seat may be granted ---');
const E = await newRoom('expired');
await ok2('configure a window that started 61 minutes ago and ended 1 minute ago',
  configure(E, "now() - interval '61 minutes'", 60));
await ok2('activate it', activate(E));
const st = await ok2('state is ended and the predicate is true', `
  select public._anon_event_state(${E}) s, public._anon_event_over(${E}) o,
         round(extract(epoch from (event_ends_at - now()))/60.0, 2) remaining_min
    from public.study_groups where id = ${E};`);
check('  -> state ended', st[0].s === 'ended', st[0].s);
check('  -> over = true', st[0].o === true, String(st[0].o));
check('  -> remaining is negative (past the deadline)', Number(st[0].remaining_min) < 0, String(st[0].remaining_min));

const u = (await ok2('fixture: a user', `select id from auth.users order by created_at desc limit 1;`))[0].id;
await mustRefuse('member seat refused on an ended event',
  `insert into public.study_group_members (group_id, user_id, role) values (${E}, '${u}', 'member');`,
  'EVENT_ENDED');
await mustRefuse('spectator seat refused on an ended event',
  `insert into public.anonymous_spectators (group_id, user_id, reference, amount)
   values (${E}, '${u}', 'v99e-${stamp}', 0);`,
  'EVENT_ENDED');
const rows = await ok2('neither row landed',
  `select (select count(*)::int from public.study_group_members where group_id=${E}) m,
          (select count(*)::int from public.anonymous_spectators where group_id=${E}) s;`);
check('  -> study_group_members empty', rows[0].m === 0, JSON.stringify(rows[0]));
check('  -> anonymous_spectators empty', rows[0].s === 0, JSON.stringify(rows[0]));

// The boundary: a room whose deadline is 1 minute in the FUTURE still takes seats.
const F = await newRoom('ending-soon');
await ok2('configure a window ending in 4 minutes (inside the ending-soon window)',
  configure(F, "now() - interval '56 minutes'", 60));
await ok2('activate it', activate(F));
const fst = await ok2('state is ending_soon but still writable', `
  select public._anon_event_state(${F}) s, public._anon_event_over(${F}) o;`);
check('  -> state ending_soon', fst[0].s === 'ending_soon', fst[0].s);
check('  -> over = false (still writable)', fst[0].o === false, String(fst[0].o));
await ok2('  -> and a member seat IS accepted', `
  insert into public.study_group_members (group_id, user_id, role) values (${F}, '${u}', 'member');`);

// ---- G. reconcile suspension --------------------------------------------
console.log('\n--- G. the idle/wipe watchdog is suspended only while the event is live ---');
// B60 needs a real long-idle member, or `released` is trivially 0 and proves
// nothing about the watchdog having resumed.
await ok2('seed a long-idle member so the watchdog has something to release',
  `insert into public.study_group_members (group_id, user_id, role, last_activity_at)
   values (${B60}, '${u}', 'member', now() - interval '2 hours');`);
await raw(`update public.study_groups set minimum_members_to_remain_active = 99 where id = ${B60};`);
const live = await ok2('reconcile a live event with a long-idle member below the wipe threshold',
  `select public.community_membership_reconcile(${B60});`);
check('  -> event_live true', live[0].community_membership_reconcile.event_live === true, JSON.stringify(live[0]));
check('  -> nothing released', live[0].community_membership_reconcile.released === 0, JSON.stringify(live[0]));
check('  -> no wipe', live[0].community_membership_reconcile.wipe === false, JSON.stringify(live[0]));
const gState = await ok2('  -> the room is still active', `select group_state from public.study_groups where id = ${B60};`);
check('  -> group_state active', gState[0].group_state === 'active', gState[0].group_state);

// Same room, but with the event over: the watchdog must resume.
await ok2('end the event by moderator', `select public.community_anonymous_event_end(${B60}, 'moderator');`);
const over = await ok2('reconcile the same room once the event is over',
  `select public.community_membership_reconcile(${B60});`);
check('  -> event_live false', over[0].community_membership_reconcile.event_live === false, JSON.stringify(over[0]));
check('  -> the idle seat IS released (watchdog resumed)', over[0].community_membership_reconcile.released >= 1, JSON.stringify(over[0]));

// ---- H. exactly-once + sweep --------------------------------------------
console.log('\n--- H. exactly-once ending ---');
const H = await newRoom('once');
await ok2('activate', activate(H));
const conc = await Promise.all([0, 1, 2].map(() => raw(`select public.community_anonymous_event_end(${H}, 'moderator');`)));
const res = conc.map(r => JSON.parse(r.body)[0].community_anonymous_event_end);
check('exactly one of three concurrent calls did the work',
  res.filter(r => r.already_ended === false).length === 1, JSON.stringify(res.map(r => r.already_ended)));
const hRow = await ok2('one recorded end time + reason',
  `select event_ended_at, event_ended_reason from public.study_groups where id = ${H};`);
check('  -> reason is moderator', hRow[0].event_ended_reason === 'moderator', String(hRow[0].event_ended_reason));
// BAD_REASON is RETURNED as {ok:false,...} rather than raised — consistent with
// every other refusal RPC in this schema. Assert the payload, not an HTTP error.
const badReason = await ok2('an invented reason is refused (returned, not raised)',
  `select public.community_anonymous_event_end(${H}, 'invented');`);
check('  -> BAD_REASON', badReason[0].community_anonymous_event_end.code === 'BAD_REASON', JSON.stringify(badReason[0]));

const swept = await ok2('the bulk sweep reports the ended rooms',
  `select public.community_anonymous_event_sweep(null);`);
check('  -> sweep succeeded', swept[0].community_anonymous_event_sweep.ok === true, JSON.stringify(swept[0].community_anonymous_event_sweep));

// ---- cleanup -------------------------------------------------------------
await raw(`delete from public.community_posts where group_id in (${rooms.join(',')});`);
await raw(`delete from public.study_group_members where group_id in (${rooms.join(',')});`);
await raw(`delete from public.anonymous_spectators where group_id in (${rooms.join(',')});`);
await raw(`delete from public.study_groups where id in (${rooms.join(',')});`);
const left = await ok2('cleanup', `select id, name from public.study_groups where name like 'V99%';`);
check('no probe rooms left', left.length === 0, JSON.stringify(left));
const r12 = await ok2('room 12 untouched', `select id, group_state, event_duration_minutes, event_started_at, event_ended_at from public.study_groups where id=12;`);
check('room 12 still waiting, 60 minutes, never started',
  r12[0].group_state === 'waiting' && r12[0].event_duration_minutes === 60
  && r12[0].event_started_at === null && r12[0].event_ended_at === null, JSON.stringify(r12[0]));

console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
process.exit(fail ? 1 : 0);
