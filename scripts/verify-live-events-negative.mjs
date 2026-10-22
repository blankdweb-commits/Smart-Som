// scripts/verify-live-events-negative.mjs
//
// Proves that every PART Z gate in scripts/verify-deploy-config.mjs can FAIL.
//
// A gate that cannot fail on the bug it names is worse than no gate: it
// reports PASS while the defect it was written for is live. So each mutation
// below breaks the source ON PURPOSE, runs the verifier, and requires the
// named gate to report FAIL. The source is then restored byte-for-byte and
// the verifier is required to be green again.
//
// Run: node scripts/verify-live-events-negative.mjs
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VERIFIER = resolve(ROOT, 'scripts/verify-deploy-config.mjs');

// Each mutation: the file it breaks, the exact text it replaces, and the gate
// label that MUST fail afterwards.
const MUTATIONS = [
  // -------------------------------------------------------------- LE-0 ----
  {
    id: 'le0-contract-export',
    file: 'api/_community.js',
    find: 'export const LIVE_EVENT_ERROR_MESSAGES = {',
    replace: 'const LIVE_EVENT_ERROR_MESSAGES = {',
    label: 'LE-0: the live-events error contract is not exported',
  },
  {
    id: 'le0-router-wrap',
    file: 'api/community.js',
    find: 'if (/\\/live-events\\/[^/]+$/.test(path)) withLiveEventErrors(req, res);',
    replace: '// live-events error wrap removed by verify-live-events-negative',
    label: 'LE-0: the live-events routes are not wrapped by the error contract',
  },
  {
    id: 'le0-refusal-log-leak',
    file: 'api/_community.js',
    find: '    const context = { code, status: res.statusCode };',
    replace: '    const context = { code, status: res.statusCode, user_id: req?.body?.user_id };',
    label: 'LE-0: the refusal log can carry more than the code, the status and the event id',
  },
  {
    id: 'le0-client-copy',
    file: 'src/utils/liveEventsApi.js',
    find: 'export const LIVE_EVENT_ERROR_COPY = {',
    replace: 'const LIVE_EVENT_ERROR_COPY = {',
    label: 'LE-0: the client has no error-copy table',
  },

  // -------------------------------------------------------------- LE-1 ----
  {
    id: 'le1-minute-grid',
    file: 'api/_community.js',
    find: 'const LIVE_EVENT_MINUTE_MS = 60 * 1000;',
    replace: 'const LIVE_EVENT_MINUTE_MS = 61 * 1000;',
    label: 'LE-1: the minute grid helpers are missing',
  },
  {
    id: 'le1-naive-is-utc',
    file: 'api/_community.js',
    find: "`${raw.replace(' ', 'T')}Z`",
    replace: "`${raw.replace(' ', 'T')}`",
    label: 'LE-1: a naive deadline string is no longer pinned to UTC',
  },
  {
    id: 'le1-client-absolute-instant',
    file: 'src/pages/AdminLiveEvents.jsx',
    find: '  return d.toISOString();',
    replace: '  return d.toString();',
    label: 'LE-1: the admin console does not submit an absolute instant',
  },

  // -------------------------------------------------------------- LE-2 ----
  {
    id: 'le2-server-status',
    file: 'api/_community.js',
    find: '  if (startProvided) patch.start_at = startParsed.iso;',
    replace: "  if (startProvided) patch.start_at = startParsed.iso;\n  patch.status = 'live';",
    label: 'LE-2: the update handler can still move an event',
  },
  {
    id: 'le2-client-status',
    file: 'src/pages/AdminLiveEvents.jsx',
    find: '        const patch = {};',
    replace: "        const patch = { status: 'live' };",
    label: 'LE-2: the admin console sends a status through update',
  },

  // -------------------------------------------------------------- LE-3 ----
  {
    id: 'le3-draft-filter',
    file: 'api/_community.js',
    find: "  if (!admin) query = query.neq('status', 'draft');",
    replace: '  // draft filter removed by verify-live-events-negative',
    label: 'LE-3: a draft event is not filtered out of a non-admin list',
  },
  {
    id: 'le3-newest-50',
    file: 'api/_community.js',
    find: "    .order('created_at', { ascending: false })\n    .order('id', { ascending: false })\n    .limit(50);",
    replace: "    .order('created_at', { ascending: false })\n    .order('id', { ascending: false })\n    .limit(500);",
    label: 'LE-3: the message window is not the newest 50',
  },

  // -------------------------------------------------------------- LE-4 ----
  {
    id: 'le4-terminal-update',
    file: 'api/_community.js',
    find:
      "    return res.status(403).json({ error: 'TERMINAL', message: 'A closed or cancelled event cannot be edited.' });",
    replace:
      "    return res.status(403).json({ error: 'INVALID_TRANSITION', message: 'mutated' });",
    label: 'LE-4: a terminal event can still be edited or transitioned',
  },
  {
    id: 'le4-read-only',
    file: 'src/pages/AdminLiveEvents.jsx',
    find: 'Read-only',
    replace: 'Editable',
    label: 'LE-4: the admin console does not mark a terminal event read-only',
  },
  {
    id: 'le4-modal-actions',
    file: 'src/pages/AdminLiveEvents.jsx',
    find: 'publishLiveEvent(session, editing.id)',
    replace: 'publishLiveEvent(session, event.id)',
    label: 'LE-4: a lifecycle action is not reachable from the modal',
  },
  {
    id: 'le4-reload-after-mutation',
    file: 'src/pages/AdminLiveEvents.jsx',
    find: 'setReloadToken((t) => t + 1);',
    replace: '// reload removed by verify-live-events-negative',
    replaceAll: true,
    label: 'LE-4: the admin console does not refresh the list after a mutation',
  },

  // -------------------------------------------------------------- LE-5 ----
  {
    id: 'le5-server-config',
    file: 'api/_community.js',
    find: "    error: 'SERVER_CONFIG',",
    replace: "    error: 'Server configuration error',",
    label: 'LE-5: a missing server configuration is not a 503 that names the missing variables',
  },
  {
    id: 'le5-admin-lookup',
    file: 'api/_community.js',
    find: "      error: 'ADMIN_LOOKUP_UNAVAILABLE',",
    replace: "      error: 'ADMIN_LOOKUP_FAILED',",
    label: 'LE-5: a failed admin lookup is reported as a 403',
  },
  {
    id: 'le5-db-helper',
    file: 'api/_community.js',
    find:
      'export async function handleSendLiveEventMessage(req, res, user) {\n  const supabase = liveEventsDb(res);',
    replace:
      'export async function handleSendLiveEventMessage(req, res, user) {\n  const supabase = getDb();',
    label: 'LE-5: a live-events handler bypasses liveEventsDb(res)',
  },
  {
    id: 'le5-admin-gate',
    file: 'api/_community.js',
    find:
      'export async function handleCloseLiveEvent(req, res, user) {\n  const supabase = liveEventsDb(res);\n  if (!supabase) return;\n  if (!(await requireLiveEventAdmin(res, user))) return;',
    replace:
      'export async function handleCloseLiveEvent(req, res, user) {\n  const supabase = liveEventsDb(res);\n  if (!supabase) return;',
    label: 'LE-5: an admin-gated live-events handler skips requireLiveEventAdmin',
  },
  {
    id: 'le5-secret-key',
    file: 'api/_utils.js',
    find: 'process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY',
    replace: 'process.env.SUPABASE_SERVICE_ROLE_KEY',
    label: 'LE-5: the SUPABASE_SECRET_KEY fallback is gone',
  },

  // -------------------------------------------------------------- LE-6 ----
  {
    id: 'le6-server-guard',
    file: 'api/_community.js',
    find: "  if (effectiveStatus(event) !== 'live') {",
    replace: "  if (false) {",
    label: 'LE-6: the server accepts a write into a scheduled or draft event',
  },
  {
    id: 'le6-send-bypasses-guard',
    file: 'api/_community.js',
    find: '  const writable = await requireLiveEventWritable(res, supabase, eventId);',
    replace: '  const writable = { id: eventId };',
    label: 'LE-6: a write handler bypasses the live-only gate',
  },
  {
    id: 'le6-react-bypasses-guard',
    file: 'api/_community.js',
    find: '  const writable = await requireLiveEventWritable(res, supabase, message.event_id);',
    replace: '  const writable = { id: message.event_id };',
    label: 'LE-6: a write handler bypasses the live-only gate',
  },
  {
    id: 'le6-client-copy',
    file: 'src/utils/liveEventsApi.js',
    find: "  EVENT_NOT_LIVE: 'This event is not live yet. Messages and reactions open when it goes live.',",
    replace: "  EVENT_NOT_LIVE_MUTATED: 'This event is not live yet. Messages and reactions open when it goes live.',",
    label: 'LE-6: the client has no copy for EVENT_NOT_LIVE',
  },

  // -------------------------------------------------------------- LE-V ----
  {
    id: 'lev-e2e-registered',
    file: 'package.json',
    find: '    "e2e:live-events": "node scripts/e2e-live-events.mjs"',
    replace: '    "e2e:live-events-DISABLED": "node scripts/e2e-live-events.mjs"',
    label: 'LE-V: the live-events e2e suite is missing or unregistered',
  },
  {
    id: 'lev-ui-suite-registered',
    file: 'package.json',
    find: '    "e2e:live-events-ui": "node scripts/e2e-live-events-ui.mjs"',
    replace: '    "e2e:live-events-ui-DISABLED": "node scripts/e2e-live-events-ui.mjs"',
    label: 'LE-V: the live-events browser suite is missing or unregistered',
  },
  {
    id: 'lev-room-poll',
    file: 'src/pages/LiveEventRoom.jsx',
    find: 'const POLL_MS = 4000;',
    replace: 'const POLL_MS = 0;',
    label: 'LE-V: the room does not poll while the event is live',
  },
  {
    id: 'lev-room-realtime-reread',
    file: 'src/pages/LiveEventRoom.jsx',
    find: "    ch.on('broadcast', { event: 'live_event' }, () => {\n      load({ quiet: true });\n    });",
    replace: "    ch.on('broadcast', { event: 'live_event' }, () => {\n    });",
    label: 'LE-V: the room does not re-read the event on a realtime notice',
  },
  {
    id: 'lev-room-can-write',
    file: 'src/pages/LiveEventRoom.jsx',
    find: 'const canWrite = state === \'live\' && !!session;',
    replace: 'const canWrite = !!session;',
    label: 'LE-V: the composer is not gated on the server state',
  },
  {
    id: 'lev-room-my-reactions',
    file: 'src/pages/LiveEventRoom.jsx',
    find: 'handleReact(messageId, emoji, !mine);',
    replace: 'handleReact(messageId, emoji, true);',
    label: "LE-V: the room does not track the caller's own reactions",
  },
  {
    id: 'lev-admin-retry',
    file: 'src/pages/AdminLiveEvents.jsx',
    find: '<RefreshCw size={12} /> Retry',
    replace: '<RefreshCw size={12} /> Reload',
    label: 'LE-V: the admin console cannot retry a failed read',
  },
];

const runVerifier = () => {
  const res = spawnSync(process.execPath, [VERIFIER], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: res.status,
    output: `${res.stdout || ''}${res.stderr || ''}`,
  };
};

const countOf = (text, needle) => text.split(needle).length - 1;

// A FAIL line must be the line itself, not a prefix of another gate's label.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const failLineRe = (label) => new RegExp(`^FAIL  ${escapeRe(label)}`, 'm');

let failed = 0;
let passed = 0;

console.log('Negative-testing every PART Z gate of verify-deploy-config.mjs\n');

for (const m of MUTATIONS) {
  const abs = resolve(ROOT, m.file);
  const original = readFileSync(abs); // Buffer: the restore must be byte-exact
  const text = original.toString('utf8');
  const hits = countOf(text, m.find);

  if (hits === 0) {
    console.error(`FAIL  ${m.id} — the anchor text was not found in ${m.file}`);
    failed++;
    continue;
  }
  if (hits > 1 && !m.replaceAll) {
    console.error(`FAIL  ${m.id} — the anchor text is not unique in ${m.file} (${hits} hits)`);
    failed++;
    continue;
  }

  let mutated = m.replaceAll ? text.split(m.find).join(m.replace) : text.replace(m.find, m.replace);
  if (mutated === text) {
    console.error(`FAIL  ${m.id} — the mutation changed nothing`);
    failed++;
    continue;
  }

  let verdict = null;
  try {
    writeFileSync(abs, mutated, 'utf8');
    const run = runVerifier();
    const didFail = failLineRe(m.label).test(run.output);
    const stillGreen = /0 failed/.test(run.output);
    verdict = didFail
      ? `PASS  ${m.id} — "${m.label}" fails on a broken source`
      : `FAIL  ${m.id} — "${m.label}" did NOT fail on a broken source`;
    if (didFail && stillGreen) {
      verdict += ' (harness error: the verifier still reported 0 failed)';
      verdict = `FAIL  ${m.id} — the verifier reported 0 failed, so the gate cannot fail`;
    }
  } finally {
    writeFileSync(abs, original);
  }

  // The restore must be byte-exact, or the run has damaged the workspace.
  const restored = readFileSync(abs);
  const intact = restored.equals(original);
  if (!intact) {
    console.error(`FAIL  ${m.id} — the source was NOT restored byte-for-byte`);
    failed++;
    continue;
  }

  if (verdict && verdict.startsWith('PASS')) {
    passed++;
    console.log(verdict);
  } else {
    failed++;
    console.log(verdict || `FAIL  ${m.id} — no verdict`);
  }
}

// The verifier must be green again now that every mutation is undone.
const final = runVerifier();
const green = final.status === 0 && /0 failed/.test(final.output);
console.log('');
if (green) {
  const summary = final.output.match(/(\d+) passed, (\d+) failed/);
  console.log(`PASS  the verifier is green again (${summary ? summary[1] : '?'} passed, 0 failed)`);
} else {
  failed++;
  console.error('FAIL  the verifier is NOT green after restoring every mutation');
  console.error(final.output.split('\n').slice(-5).join('\n'));
}

console.log(`\n=== ${passed} negative tests passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
