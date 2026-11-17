import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLifecycle, clearLifecycle, lifecyclePath, readLifecycle } from '../src/lifecycle-store.mjs';

test('生命周期流水只记动作，最新在前，可清空', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'see-now-life-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, DSH_HOME: home };

  appendLifecycle({ action: 'start', ok: true, note: 'screen' }, env);
  appendLifecycle({ action: 'stop', ok: false, note: 'no-session' }, env);

  const { path, events } = readLifecycle({ env });
  assert.equal(path, lifecyclePath(env));
  assert.equal(path, join(home, 'see-now', 'lifecycle.jsonl'));
  assert.equal(events.length, 2);
  assert.equal(events[0].action, 'stop');
  assert.equal(events[0].ok, false);
  assert.equal(events[1].action, 'start');
  assert.equal(events[1].note, 'screen');

  clearLifecycle(env);
  assert.deepEqual(readLifecycle({ env }).events, []);
});

test('坏行不会让整份记录读不出来', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'see-now-life-bad-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, DSH_HOME: home };
  appendLifecycle({ action: 'start', ok: true }, env);
  const path = lifecyclePath(env);
  writeFileSync(path, `${readFileSync(path, 'utf8')}not-json\n`, 'utf8');
  const { events } = readLifecycle({ env });
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'start');
});

// 面板在调试页每 1.5 秒读一次：只读尾巴，但不能因此少一条或多出半截行。
test('limit 只返回最近几条，且从文件尾部读起', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'see-now-life-limit-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, DSH_HOME: home };

  // 每条都带一段注释，把总长撑过单次读的预算，逼出「从中间切进来」的分支。
  for (let i = 1; i <= 300; i += 1) {
    appendLifecycle({ action: 'start', ok: true, note: `#${i} ${'x'.repeat(200)}` }, env);
  }

  const { path, events } = readLifecycle({ limit: 5, env });
  assert.equal(path, lifecyclePath(env));
  assert.equal(events.length, 5);
  assert.deepEqual(events.map((event) => event.note.split(' ')[0]), ['#300', '#299', '#298', '#297', '#296']);

  // 半截行不能变成一条坏记录混在里面
  assert.ok(events.every((event) => typeof event.action === 'string'));
});
