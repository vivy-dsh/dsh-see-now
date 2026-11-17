/**
 * 「我看到了」的生命周期流水。
 *
 * 只记**动作与结果**，不记画面、不记帧、不记窗口标题 —— 这样它既能回答
 * "上一次到底看没看、为什么停"，又不会变成第二份屏幕录像。
 *
 * 文件在 `~/.dsh/see-now/lifecycle.jsonl`，一行一个事件；超过 512KB 时保留最近
 * 500 行重写，避免长期开着把磁盘写满。
 *
 * @module src/lifecycle-store.mjs
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tuningPath } from './tuning.js';

const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 500;
/** 一行事件几十字节；按 320 给足余量，读不满再退回整份读。 */
const LINE_BUDGET = 320;

export function lifecyclePath(env = process.env) {
  return join(dirname(tuningPath(env)), 'see-now', 'lifecycle.jsonl');
}

/** 追加一条；任何写盘失败都不能把正在做的动作带崩。 */
export function appendLifecycle(event, env = process.env) {
  const path = lifecyclePath(env);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
    appendFileSync(path, line, 'utf8');
    trim(path);
    return path;
  } catch {
    return path;
  }
}

function trim(path) {
  try {
    if (statSync(path).size <= MAX_BYTES) return;
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    writeFileSync(path, `${lines.slice(-KEEP_LINES).join('\n')}\n`, 'utf8');
  } catch {
    /* 修不掉就让它长着，下一次再试 */
  }
}

/**
 * 只读文件尾部够 `limit` 条用的那点字节。
 *
 * 面板在调试页每 1.5 秒读一次；整份读在裁剪阈值内是 512KB，等于把「看状态」
 * 变成持续 IO。按行预算切尾巴之后，单次读的量只跟 `limit` 有关。
 */
function readTail(path, limit) {
  const size = statSync(path).size;
  const want = Math.min(size, Math.max(4096, limit * LINE_BUDGET));
  const start = size - want;
  const buf = Buffer.allocUnsafe(want);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, want, start);
  } finally {
    closeSync(fd);
  }
  return { text: buf.toString('utf8'), partial: start > 0 };
}

/** 最新在前，最多 `limit` 条。坏行直接跳过，不因一行 JSON 坏了整页打不开。 */
export function readLifecycle({ limit = 80, env = process.env } = {}) {
  const path = lifecyclePath(env);
  if (!existsSync(path)) return { path, events: [] };
  let text = '';
  let partial = false;
  try {
    ({ text, partial } = readTail(path, limit));
  } catch {
    return { path, events: [] };
  }
  let lines = text.split('\n').filter(Boolean);
  // 从头切进来的第一行是半截：先丢掉，不然它会被当成坏行静默跳过。
  if (partial) lines = lines.slice(1);
  const events = lines
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { path, events };
}

export function clearLifecycle(env = process.env) {
  const path = lifecyclePath(env);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '', 'utf8');
  } catch {
    /* 清不掉时保留原文件，UI 下次读到的仍是旧记录 */
  }
  return path;
}
