/**
 * client-wiring.test.mjs — 浏览器半身的**接线**检查（不渲染）。
 *
 * 这一层的失败方式特别安静：`id` 和包名差一个字、槽位名字打错、`exports.inject`
 * 漏一项，宿主都毫无异样，只会在浏览器控制台留一句 `loaded without registering`，
 * 用户看到的现象是"设置里没有这一栏"。所以把它拉出来在这里断言。
 *
 * 用一个假的 `window.__ModuleLoader__` 抓下 factory，再用一个假 React 跑一遍
 * `apply()`，看它到底注册了哪个槽位、传了什么。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── 假宿主 ────────────────────────────────────────────────────────────────────

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec;
    },
  },
};

/** 假 React：只需要形状对，不需要渲染。 */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
};

/** 假 document：`apply` 会插一段 `<style>`。 */
const styleNodes = [];
globalThis.document = {
  head: {
    appendChild(node) {
      styleNodes.push(node);
    },
  },
  createElement() {
    return {
      setAttribute() {},
      remove() {
        styleNodes.pop();
      },
      textContent: '',
    };
  },
};

await import('../client.js');

const mod = captured.factory((name) => (name === 'react' ? fakeReact : {}));

// ── 包与工厂 ──────────────────────────────────────────────────────────────────

test('ModuleLoader 的 id 必须是包名', () => {
  assert.equal(captured.id, 'dsh-see-now');
  assert.equal(mod.name, 'dsh-see-now');
});

test('inject 声明了 slots 与 locale', () => {
  assert.deepEqual(mod.inject, ['slots', 'locale']);
});

test('apply 是个函数', () => {
  assert.equal(typeof mod.apply, 'function');
});

// ── 槽位注册 ──────────────────────────────────────────────────────────────────

function runApply() {
  styleNodes.length = 0;
  const effects = [];
  const registered = [];
  const injected = [];
  const ctx = {
    effect: (fn, label) => {
      effects.push(label);
      return fn();
    },
    slots: {
      inject: (name, fn) => {
        injected.push(name);
        return fn();
      },
      register: (def, render) => {
        registered.push({ def, render });
        return () => {};
      },
    },
  };
  mod.apply(ctx);
  return { effects, registered, injected };
}

test('注册 main 与侧栏「我看到了」；不再占用设置分区', () => {
  const { registered, injected } = runApply();
  assert.deepEqual(injected, ['main', 'sidebar.panellist']);
  assert.equal(registered.length, 2);
  assert.equal(registered.some((entry) => entry.def.name === 'settings.section'), false);

  const sidebar = registered.find((entry) => entry.def.name === 'sidebar.panellist');
  assert.ok(sidebar, 'sidebar.panellist is missing');
  assert.equal(sidebar.def.id, 'see-now');
  assert.equal(sidebar.def.order, 16);
  assert.equal(sidebar.def.label(), '我看到了');

  const main = registered.find((entry) => entry.def.name === 'main');
  assert.ok(main, 'main is missing');
  assert.equal(main.def.key, 'see-now');
});

test('样式表挂上了，并且带一个能摘掉的清理函数', () => {
  const { effects } = runApply();
  assert.deepEqual(effects, ['dsh-see-now: styles']);
  assert.equal(styleNodes.length, 1);
  // effect 的返回值就是 disposer：跑一次应该把它摘掉
  assert.equal(typeof styleNodes[0].remove, 'function');
});

test('面板第一帧能渲染出外壳，不会抛', () => {
  const { registered } = runApply();
  const main = registered.find((entry) => entry.def.name === 'main');
  assert.ok(main, 'main is missing');
  const element = main.render();
  assert.equal(element.type, 'main');
  assert.equal(element.props.className, 'snv');
});

test('调试页在导航里，并且保留原五页', () => {
  assert.deepEqual(mod.__test.SN_TABS.map(([id]) => id), ['overview', 'sessions', 'records', 'debug', 'settings', 'privacy']);
});

// 调试页最常被问的一句是「帧在涨，为什么出图是 0」。判据只能是已有的计数，
// 不新增服务端字段，所以这四条要能各说各话。
test('snVerdict 把「0 张」分成四种成因', () => {
  const { snVerdict } = mod.__test;

  // 没在跑
  assert.equal(snVerdict({ running: false }).tone, '');
  assert.match(snVerdict({ running: false }).text, /没在采集/);

  // 一帧都没抓到 → 要人去看最近错误
  const noFrames = snVerdict({ running: true, frames: 0, stats: { kept: 0, sheets: 0 } });
  assert.equal(noFrames.tone, 'warn');
  assert.match(noFrames.text, /一帧都没抓到/);

  // 抓到了但一帧没留 → 画面没变化，这是正常现象，别当故障
  const noKept = snVerdict({ running: true, frames: 156, stats: { kept: 0, sheets: 0 } });
  assert.equal(noKept.tone, 'warn');
  assert.match(noKept.text, /156 帧/);
  assert.match(noKept.text, /画面没变化/);

  // 留了帧还没封箱 / 已经出图
  assert.match(snVerdict({ running: true, frames: 20, stats: { kept: 3, sheets: 0 } }).text, /还没封箱/);
  const done = snVerdict({ running: true, frames: 20, stats: { kept: 9, sheets: 2 } });
  assert.equal(done.tone, 'ok');
  assert.match(done.text, /2 张图/);
});

// ── 补丁构造（纯函数部分）─────────────────────────────────────────────────────

test('patchOf 只带改过的键', () => {
  const { __test } = mod;
  const values = {
    maxAutonomousWakes: 8,
    idleStopMin: 3,
    defaultPace: 'normal',
    speechPacing: true,
    listen: { live: true, liveMin: 1.8, liveStep: 1.2, silence: 0.35, maxSeg: 3, pollMs: 100 },
  };
  const draft = __test.draftOf(values);
  assert.deepEqual(__test.patchOf(draft, values), {});

  draft.silence = '0.5';
  assert.deepEqual(__test.patchOf(draft, values), { listen: { silence: 0.5 } });

  draft.defaultPace = 'calm';
  draft.idleStopMin = '10';
  assert.deepEqual(__test.patchOf(draft, values), {
    idleStopMin: 10,
    defaultPace: 'calm',
    listen: { silence: 0.5 },
  });
});

// #43：设置页存盘必失败。`draftOf()` 漏种哪一项，`patchOf()` 就会认为
// 「用户把它改成了空值」，每次保存都捎上幽灵字段（`tierStyle: ""` / `tierMap: []`），
// 而 `tuning.js` 的规矩是「本次提交让警告变多 → 整笔拒绝、文件不动」。
test('草稿覆盖界面上渲染过的每一项：没动过就是空补丁', () => {
  const { __test } = mod;
  const values = {
    maxAutonomousWakes: 8,
    wakeBatch: 2,
    tierStyle: 'native',
    tierMap: [1, 2, 3, 4, 5, 6, 7, 8],
    tierMode: 'dwell',
    tierCurve: 'custom',
    tierThresholds: [0.26, 0.6, 0.9, 1.2, 1.8, 2.4, 3],
    imageTrigger: 300,
    imageKeep: 120,
    idleStopMin: 3,
    defaultPace: 'normal',
    speechPacing: true,
    listen: { prefer: 'auto', live: true, liveMin: 1.8, liveStep: 1.2, silence: 0.35, maxSeg: 3, pollMs: 100 },
  };
  const draft = __test.draftOf(values);
  for (const key of Object.keys(values)) {
    if (key === 'listen') continue;
    assert.notEqual(draft[key], undefined, `draftOf 漏了 ${key}：patchOf 会把它当成"用户改成了空值"`);
  }
  assert.deepEqual(__test.patchOf(draft, values), {});
});

test('档位判据 / 阈值表 / 七道阈值都能提交成宿主认的类型', () => {
  const { __test } = mod;
  const values = {
    tierMode: 'density',
    tierCurve: 'docx',
    tierThresholds: [0.26, 0.6, 0.9, 1.2, 1.8, 2.4, 3],
  };
  const draft = __test.draftOf(values);
  assert.deepEqual(__test.patchOf(draft, values), {});

  // <select> 给的是字符串，宿主那边要的就是字符串（枚举），原样过
  assert.deepEqual(__test.patchOf({ ...draft, tierMode: 'weight' }, values), { tierMode: 'weight' });
  assert.deepEqual(__test.patchOf({ ...draft, tierCurve: 'perceptual' }, values), { tierCurve: 'perceptual' });

  // 阈值是 <input type="number">，onChange 拿到字符串：必须换成数字，
  // 否则 `"1.2"` 和 `1.2` 在 tuning 那边都能过，但数组比较会永远不等 → 每次都提交
  const typed = { ...draft, tierThresholds: ['0.3', '0.5', '0.8', '1.1', '1.7', '2.3', '3.2'] };
  assert.deepEqual(__test.patchOf(typed, values), {
    tierThresholds: [0.3, 0.5, 0.8, 1.1, 1.7, 2.3, 3.2],
  });

  // 只是复制一份、值不变 → 不该冒补丁
  assert.deepEqual(__test.patchOf({ ...draft, tierThresholds: [...values.tierThresholds] }, values), {});
});

test('改过的高级档位能提交成宿主认的类型', () => {
  const { __test } = mod;
  const values = { tierStyle: 'native', tierMap: [1, 2, 3, 4, 5, 6, 7, 8], wakeBatch: 1 };
  const draft = __test.draftOf(values);

  // wakeBatch 是 <select>，onChange 拿到的是字符串；宿主那边要的是整数
  assert.deepEqual(__test.patchOf({ ...draft, wakeBatch: '3' }, values), { wakeBatch: 3 });
  assert.deepEqual(__test.patchOf({ ...draft, tierStyle: 'custom' }, values), { tierStyle: 'custom' });
  // tierMap 比内容是比数组；复制一份但值不变，不该冒补丁
  assert.deepEqual(__test.patchOf({ ...draft, tierMap: [...values.tierMap] }, values), {});
  const grown = [...values.tierMap];
  grown[7] = 6;
  assert.deepEqual(__test.patchOf({ ...draft, tierMap: grown }, values), { tierMap: [1, 2, 3, 4, 5, 6, 7, 6] });
});

test('空输入框交给宿主去拒，不在前端偷偷兜底成默认值', () => {  const { __test } = mod;
  assert.ok(Number.isNaN(__test.num('')));
  assert.ok(Number.isNaN(__test.num('   ')));
  assert.equal(__test.num('1.5'), 1.5);
  assert.equal(__test.num(2), 2);
});

test('文案里不出现占位符', () => {
  const { __test } = mod;
  for (const [key, value] of Object.entries(__test.TEXT)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.length > 0, key);
    // 样例 JSON 里本来就该有花括号，别把它当成漏填的占位符。
    if (key === 'local.sample.body') continue;
    assert.ok(!/[{}]/.test(value), `${key} 里留着模板占位符`);
  }
});

// ── 回包的两种形态都要能用 ────────────────────────────────────────────────────

test('draftOf 拿到缺 listen 段的回包也不抛', () => {
  const { __test } = mod;
  const draft = __test.draftOf({ idleStopMin: 10 });
  assert.equal(draft.idleStopMin, 10);
  assert.equal(draft.silence, undefined, '缺的段留空，不编默认值');
});

test('mergeValues 把增量回包并进整份配置', () => {
  const { __test } = mod;
  const prev = {
    maxAutonomousWakes: 8,
    idleStopMin: 3,
    defaultPace: 'normal',
    speechPacing: true,
    listen: { live: true, liveMin: 1.8, liveStep: 1.2, silence: 0.35, maxSeg: 3, pollMs: 100 },
  };

  // 老宿主：只回提交过的键 —— 顶层其他项与整个 listen 段都得留住
  const merged = __test.mergeValues(prev, { idleStopMin: 10 });
  assert.equal(merged.idleStopMin, 10);
  assert.equal(merged.maxAutonomousWakes, 8);
  assert.equal(merged.listen.silence, 0.35);

  // 只改 listen 一项时，顶层项也不能丢
  const merged2 = __test.mergeValues(prev, { listen: { silence: 0.5 } });
  assert.equal(merged2.idleStopMin, 3);
  assert.equal(merged2.listen.silence, 0.5);
  assert.equal(merged2.listen.maxSeg, 3);

  // 新宿主：回完整快照，照单全收
  const full = { ...prev, idleStopMin: 20, listen: { ...prev.listen, maxSeg: 9 } };
  assert.deepEqual(__test.mergeValues(prev, full), full);
});

// ── asr.json 那一套 ───────────────────────────────────────────────────────────
// 它写的是另一个文件，所以草稿与补丁都是独立的一份，不能和 see-now.json 的混用。

test('asr.json 的草稿：key 永远是空串，文件里的密钥不回显', () => {
  const { __test } = mod;
  const local = { path: 'x', exists: true, api: 'chat-audio', baseUrl: 'https://a/v1', model: 'm', language: 'zh', hasKey: true };
  const draft = __test.localDraftOf(local);
  assert.equal(draft.api, 'chat-audio');
  assert.equal(draft.baseUrl, 'https://a/v1');
  assert.equal(draft.key, '');
});

test('asr.json 的补丁：只带改过的键；key 只有真填了才带', () => {
  const { __test } = mod;
  const local = { api: 'openai-audio', baseUrl: 'https://a/v1', model: 'm', language: 'zh', hasKey: true };
  const draft = __test.localDraftOf(local);
  assert.deepEqual(__test.localPatchOf(draft, local), {}, '什么都没改就是空补丁');

  assert.deepEqual(__test.localPatchOf({ ...draft, model: 'm2' }, local), { model: 'm2' });
  assert.deepEqual(__test.localPatchOf({ ...draft, key: 'sk-1' }, local), { key: 'sk-1' });
  // 前后空格不算改动 —— 否则光标一进出就冒出一个假补丁
  assert.deepEqual(__test.localPatchOf({ ...draft, model: '  m  ' }, local), {});
});

test('localDraftOf 拿到空值也不把面板弄挂', () => {
  const { __test } = mod;
  assert.equal(__test.localDraftOf(null), null);
  assert.equal(__test.localDraftOf(undefined), null);
});

test('asr.json 那块只在"可能用到它"时出现', () => {
  const { __test } = mod;
  // host = 只用宿主自带的：那块收起来。顶在最上面会让人以为 SenseVoice 被替换了。
  assert.equal(__test.shouldShowLocal('host'), false);
  assert.equal(__test.shouldShowLocal('auto'), true);
  assert.equal(__test.shouldShowLocal('local'), true);
});

test('prefer 三档能读进草稿，也能按枚举提交回去', () => {
  const { __test } = mod;
  const values = {
    maxAutonomousWakes: 8,
    idleStopMin: 3,
    defaultPace: 'normal',
    speechPacing: true,
    listen: { prefer: 'auto', live: true, liveMin: 1.8, liveStep: 1.2, silence: 0.35, maxSeg: 3, pollMs: 100 },
  };

  // 读：草稿里必须带上 prefer，否则下拉框没有当前值（String(undefined) = 'undefined'）
  assert.equal(__test.draftOf(values).prefer, 'auto');

  // 写：prefer 是字符串，绝不能过 num() —— 那会把 'host' 变成 NaN 交给宿主拒
  assert.deepEqual(__test.patchOf({ ...__test.draftOf(values), prefer: 'host' }, values), {
    listen: { prefer: 'host' },
  });

  // 没改就不提交
  assert.deepEqual(__test.patchOf(__test.draftOf(values), values), {});
});
