import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let server;
let base;
let calls;

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-see-life-api-'));
  process.env.DSH_HOME = home;
  calls = [];
  const { createSettingsApi, ROUTE_PREFIX } = await import('../src/settings-api.mjs');
  const lifecycle = {
    status: () => ({ capture: { running: calls.includes('start') }, window: { alive: false }, loop: null }),
    start: async () => { calls.push('start'); return { ok: true, note: 'screen' }; },
    stop: async () => { calls.push('stop'); return { ok: true }; },
    open: async () => { calls.push('open'); return { ok: true, note: 'opened' }; },
    close: async () => { calls.push('close'); return { ok: true }; },
  };
  const handle = createSettingsApi({ lifecycle });
  server = http.createServer((req, res) => {
    handle(req, res, undefined).catch((err) => {
      res.writeHead(500);
      res.end(String(err?.message ?? err));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}${ROUTE_PREFIX}`;
});

after(() => {
  server?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

async function getLifecycle() {
  const res = await fetch(`${base}/lifecycle`);
  return { code: res.status, body: await res.json() };
}

async function act(action) {
  const res = await fetch(`${base}/lifecycle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return { code: res.status, body: await res.json() };
}

test('GET /lifecycle 回状态、流水路径与空记录', async () => {
  const { code, body } = await getLifecycle();
  assert.equal(code, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status.capture.running, false);
  assert.equal(body.journal.path, join(home, 'see-now', 'lifecycle.jsonl'));
  assert.deepEqual(body.journal.events, []);
});

test('POST /lifecycle start 落到生命周期回调并写一条记录', async () => {
  const { code, body } = await act('start');
  assert.equal(code, 200);
  assert.equal(body.ok, true);
  assert.equal(body.action, 'start');
  assert.deepEqual(calls, ['start']);
  assert.equal(body.journal.events[0].action, 'start');
  assert.equal(body.journal.events[0].note, 'screen');
  assert.equal(body.status.capture.running, true);
});

test('window-open / stop 都走同一条路由', async () => {
  await act('window-open');
  await act('stop');
  const { body } = await getLifecycle();
  assert.deepEqual(calls, ['start', 'open', 'stop']);
  assert.deepEqual(body.journal.events.map((event) => event.action), ['stop', 'window-open', 'start']);
});

test('未知 action 是 400，不会误写', async () => {
  const before = (await getLifecycle()).body.journal.events.length;
  const { code, body } = await act('nonsense');
  assert.equal(code, 400);
  assert.equal(body.ok, false);
  assert.equal((await getLifecycle()).body.journal.events.length, before);
});

test('clear 只清流水，配置不碰', async () => {
  const { code, body } = await act('clear');
  assert.equal(code, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.journal.events.map((event) => event.action), ['clear']);
});
