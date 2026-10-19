// TEMPORARY probe — proves migration-v99 behaves as designed against the live DB.
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = env.VITE_SUPABASE_PROJECT_REF || 'urhcvdcpxhxmmnavkcvd';
const token = env.SUPABASE_ACCESS_TOKEN || process.env.ACCESS_TOKEN;

async function sql(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

const show = (label, r) => console.log(label, JSON.stringify(r));

// ---- 1. schema ----------------------------------------------------------
console.log('--- 1. columns + constraints ---');
show('columns:', await sql(`
  select column_name, data_type, column_default, is_nullable
    from information_schema.columns
   where table_schema='public' and table_name='study_groups'
     and column_name like 'event%'
   order by column_name;`));

show('checks:', await sql(`
  select conname, pg_get_constraintdef(oid) def
    from pg_constraint
   where conrelid='public.study_groups'::regclass and conname like 'study_groups_event%'
   order by conname;`));

show('triggers:', await sql(`
  select tgname, pg_get_triggerdef(oid) def from pg_trigger
   where tgrelid in ('public.study_groups'::regclass,'public.study_group_members'::regclass,'public.anonymous_spectators'::regclass)
     and not tgisinternal and tgname like 'trg_anon_event%'
   order by tgname;`));

show('acls:', await sql(`
  select p.proname, pg_get_function_identity_arguments(p.oid) args, p.proacl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in
     ('_anon_event_deadline','_anon_event_over','_anon_event_state',
      'community_anonymous_event_end','community_anonymous_event_sweep',
      'community_membership_reconcile')
   order by p.proname;`));

// ---- 2. duration bounds --------------------------------------------------
console.log('\n--- 2. duration is 40..60, enforced by CHECK ---');
show('reject 39:', await sql(`
  do $$ begin
    update public.study_groups set event_duration_minutes = 39 where id = 12;
    raise notice 'ACCEPTED_39';
  exception when check_violation then raise notice 'REFUSED_39'; end $$;`));
show('reject 61:', await sql(`
  do $$ begin
    update public.study_groups set event_duration_minutes = 61 where id = 12;
    raise notice 'ACCEPTED_61';
  exception when check_violation then raise notice 'REFUSED_61'; end $$;`));

// ---- 3. the activation trigger stamps the clock, idempotently ----------
console.log('\n--- 3. activation stamps the clock (on a scratch room) ---');
const stamp = Date.now().toString().slice(-8);
const created = await sql(`
  insert into public.study_groups (name, description, creator_id, type, privacy, group_state)
  select 'V99 Probe ${stamp}', 'probe', id, 'anonymous', 'restricted', 'waiting'
    from auth.users order by created_at limit 1
  returning id, group_state, event_duration_minutes, event_started_at, event_ends_at;`);
const gid = created[0].id;
show('created (waiting, no clock):', created[0]);

show('state while waiting:', await sql(`select public._anon_event_state(${gid}) s, public._anon_event_over(${gid}) over_;`));

// Simulate the activation transition the way the join RPC does it.
show('activate #1:', await sql(`
  update public.study_groups set group_state='active' where id=${gid}
  returning event_started_at, event_ends_at,
    round(extract(epoch from (event_ends_at - event_started_at))/60.0, 3) as mins;`));

// Re-activating / touching must NOT move the clock.
const first = (await sql(`select event_started_at, event_ends_at from public.study_groups where id=${gid};`))[0];
show('re-activate (idempotent):', await sql(`
  update public.study_groups set group_state='waiting' where id=${gid};
  update public.study_groups set group_state='active' where id=${gid};
  select event_started_at, event_ends_at from public.study_groups where id=${gid};`));
const second = (await sql(`select event_started_at, event_ends_at from public.study_groups where id=${gid};`))[0];
console.log('clock unchanged after deactivate/reactivate:',
  first.event_started_at === second.event_started_at && first.event_ends_at === second.event_ends_at);

show('state while live:', await sql(`select public._anon_event_state(${gid}) s, public._anon_event_over(${gid}) over_;`));

// ---- 4. the clock cannot be extended ------------------------------------
console.log('\n--- 4. the window CHECK blocks extending the clock ---');
show('push ends_at later by 10m:', await sql(`
  do $$ begin
    update public.study_groups
       set event_ends_at = event_ends_at + interval '10 minutes'
     where id=${gid};
    raise notice 'ACCEPTED_EXTENSION';
  exception when check_violation then raise notice 'REFUSED_EXTENSION'; end $$;`));
show('shrink ends_at by 10m:', await sql(`
  do $$ begin
    update public.study_groups
       set event_ends_at = event_ends_at - interval '10 minutes'
     where id=${gid};
    raise notice 'ACCEPTED_SHRINK';
  exception when check_violation then raise notice 'REFUSED_SHRINK'; end $$;`));

// ---- 5. backdating the start only ever SHORTENS -------------------------
console.log('\n--- 5. a backdated start shortens; a forward-dated one is refused ---');
show('backdate 30m:', await sql(`
  update public.study_groups
     set event_started_at = event_started_at - interval '30 minutes',
         event_ends_at    = event_ends_at    - interval '30 minutes'
   where id=${gid}
  returning round(extract(epoch from (event_ends_at - now()))/60.0, 2) as mins_remaining;`));
show('push start into the future:', await sql(`
  do $$ begin
    update public.study_groups
       set event_started_at = event_started_at + interval '30 minutes',
           event_ends_at    = event_ends_at    + interval '30 minutes'
     where id=${gid};
    raise notice 'ACCEPTED_FORWARD';
  exception when check_violation then raise notice 'REFUSED_FORWARD'; end $$;`));

// ---- 6. expiry predicate + seat guard ----------------------------------
console.log('\n--- 6. expiry: predicate flips, and a new seat is refused ---');
await sql(`update public.study_groups set event_started_at = now() - interval '61 minutes',
             event_ends_at = now() - interval '1 minute' where id=${gid};`);
show('state after deadline:', await sql(`select public._anon_event_state(${gid}) s, public._anon_event_over(${gid}) over_;`));
show('join attempt (seat guard):', await sql(`
  do $$ declare u uuid; begin
    select id into u from auth.users order by created_at desc limit 1;
    begin
      insert into public.study_group_members (group_id, user_id, role) values (${gid}, u, 'member');
      raise notice 'SEAT_GRANTED';
    exception when others then raise notice 'SEAT_REFUSED %', sqlerrm; end;
  end $$;`));
show('spectator attempt (seat guard):', await sql(`
  do $$ declare u uuid; begin
    select id into u from auth.users order by created_at desc limit 1;
    begin
      insert into public.anonymous_spectators (group_id, user_id, reference, amount)
      values (${gid}, u, 'v99-probe-${stamp}', 0);
      raise notice 'SEAT_GRANTED';
    exception when others then raise notice 'SEAT_REFUSED %', sqlerrm; end;
  end $$;`));

// ---- 7. exactly-once end ------------------------------------------------
console.log('\n--- 7. community_anonymous_event_end is exactly-once ---');
show('end #1:', await sql(`select public.community_anonymous_event_end(${gid}, 'deadline');`));
const t1 = (await sql(`select event_ended_at from public.study_groups where id=${gid};`))[0].event_ended_at;
await new Promise(r => setTimeout(r, 1500));
show('end #2:', await sql(`select public.community_anonymous_event_end(${gid}, 'deadline');`));
const t2 = (await sql(`select event_ended_at from public.study_groups where id=${gid};`))[0].event_ended_at;
console.log('recorded end time unchanged on replay:', t1 === t2);
show('bad reason refused:', await sql(`select public.community_anonymous_event_end(${gid}, 'because');`));
show('reconcile no longer wipes (event over path):', await sql(`select public.community_membership_reconcile(${gid});`));

// ---- 8. reconcile is suspended while live -------------------------------
console.log('\n--- 8. reconcile is suspended while the event is live ---');
show('fresh live room reconcile:', await sql(`
  do $$ declare g bigint; declare u uuid; begin
    select id into u from auth.users order by created_at desc limit 1;
    insert into public.study_groups (name, description, creator_id, type, privacy, group_state, minimum_members_to_remain_active)
    values ('V99 Live ${stamp}', 'probe', u, 'anonymous', 'restricted', 'waiting', 99)
    returning id into g;
    update public.study_groups set group_state='active' where id=g;
    -- make one non-owner member look long-idle
    insert into public.study_group_members (group_id, user_id, role, last_activity_at)
    values (g, u, 'member', now() - interval '2 hours');
    raise notice 'group %', g;
  end $$;`));
const liveGid = (await sql(`select id from public.study_groups where name = 'V99 Live ${stamp}';`))[0].id;
show('members before:', await sql(`select count(*)::int c from public.study_group_members where group_id=${liveGid};`));
show('reconcile while live:', await sql(`select public.community_membership_reconcile(${liveGid});`));
show('members after (must be unchanged):', await sql(`select count(*)::int c from public.study_group_members where group_id=${liveGid};`));
show('group_state (must NOT be wiped):', await sql(`select group_state, event_started_at is not null as clocked from public.study_groups where id=${liveGid};`));

// ---- cleanup ------------------------------------------------------------
console.log('\n--- cleanup ---');
await sql(`delete from public.community_posts where group_id in (${gid}, ${liveGid});`);
await sql(`delete from public.study_group_members where group_id in (${gid}, ${liveGid});`);
await sql(`delete from public.anonymous_spectators where group_id in (${gid}, ${liveGid});`);
await sql(`delete from public.study_groups where id in (${gid}, ${liveGid});`);
show('probe rooms gone:', await sql(`select count(*)::int c from public.study_groups where name like 'V99 %';`));
show('room 12 untouched:', await sql(`select id, group_state, event_duration_minutes, event_started_at, event_ended_at from public.study_groups where id=12;`));
process.exit(0);
