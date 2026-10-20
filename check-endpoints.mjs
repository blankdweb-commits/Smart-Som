// Phase 1 endpoint probe: direct API + Vite proxy. Expect JSON 200/401, never HTML 503.
const targets = [
  ['/api/session/status', 'GET'],
  ['/api/session/touch', 'POST'],
  ['/api/session/register', 'POST'],
  ['/api/quota/course-status', 'GET'],
  ['/api/progress/difficulty', 'GET'],
  ['/api/daily-challenge', 'GET'],
  ['/api/quiz?action=license-status', 'GET'],
  ['/api/community/groups/join', 'POST'],
];
const bases = [['direct', 'http://localhost:3001'], ['proxy', 'http://localhost:5173']];
for (const [name, base] of bases) {
  for (const [path, method] of targets) {
    try {
      const r = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
        signal: AbortSignal.timeout(5000),
      });
      const ct = r.headers.get('content-type') || '';
      const body = (await r.text()).slice(0, 100);
      const shape = ct.includes('json') ? 'JSON' : 'HTML/OTHER';
      console.log(`${name} ${method} ${path} -> ${r.status} ${shape} | ${body}`);
    } catch (e) {
      console.log(`${name} ${method} ${path} -> ERROR ${e.message}`);
    }
  }
}
