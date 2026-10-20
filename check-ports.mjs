const checks = [
  ['http://localhost:3001/api/session/status', 3001],
  ['http://localhost:5173/', 5173],
];
for (const [url, port] of checks) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const body = port === 3001 ? ' | ' + (await r.text()).slice(0, 120) : '';
    console.log(`PORT${port} UP: HTTP ${r.status} CT:${r.headers.get('content-type')}${body}`);
  } catch (e) {
    console.log(`PORT${port} DOWN: ${e.message}`);
  }
}
