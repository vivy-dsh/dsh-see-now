/**
 * dsh-see-now —— 浏览器半身。
 *
 * 只做一件事：在 DSH 设置里放一页「看你在干什么」，让 `~/.dsh/see-now.json`
 * 里那九个值从"要改源码"变成"看得见、改得动、改错了会告诉你为什么"。
 *
 * ## 为什么这件事必须有界面
 *
 * 这些值原本写死在 `loop.js` 里。作者在 `tuning.js` 的注释里自己记着这件事
 * （读过源码的人只会在那儿看到一个 issue 编号），后来抽出了配置层和校验，
 * 但用户要动它仍然得手写 JSON —— 而写错一个类型就是"永远不停"或"立刻停"。
 *
 * ## 数据从哪来
 *
 * 走本插件自己的同源 `/api/see-now/*` 路由：`GET /status` 读、`POST /config` 写。
 * 校验规则**一条都不在这里**——全在 `src/tuning.js` 的 `readTuning` 里，
 * 前端只负责显示它给出的 `warnings`。前端另写一套规则，就一定会和宿主吵起来。
 *
 * ## 手写 ModuleLoader 包
 *
 * 不需要构建步骤，除 shell 已提供的 `react` 之外没有依赖。
 *
 * @module client.js
 */

window.__ModuleLoader__.load({
  // 必须是包名，不是插件的短名。client-modules 的 `arrive()` 拿着包名去查已经
  // 注册的 factory，名字对不上就一路抛 `loaded without registering "dsh-see-now"`，
  // 而那条错误只进浏览器控制台 —— 宿主那头毫无异样，设置里就是干脆没有这一栏。
  id: 'dsh-see-now',
  factory: require => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { createElement: h, useState, useEffect, useCallback, Fragment } = React;

    const NS = 'settings.seeNow';
    /** 路由前缀；与 `src/settings-api.mjs` 的 `ROUTE_PREFIX` 必须一致。 */
    const API = '/api/see-now';
    const inject = ['slots', 'locale'];

    // ── 文案 ──────────────────────────────────────────────────────────────────
    // 先只写中文：这一版的目标是"跑通"，双语等它成立之后再补一份 en 字典。
    const TEXT = {
      nav: '看你看的东西',
      title: '看你看的东西',
      sub: '让 AI 实时看屏幕、听声音，只在画面真的变了才交图。这里调的是"陪多久、多久看一次、一句听到哪儿算完"。',
      'state.loading': '读取中…',
      'state.reload': '重新读取',
      'state.save': '保存',
      'state.saving': '保存中…',
      'state.saved': '已保存。重开 DSH 生效。',
      'state.savedLocal': '已保存。下一次转写就用新地址。',
      'state.nosave': '没有改动。',
      'sec.common': '常用',
      'sec.advanced': '高级（一般不用动）',
      'field.prefer': '用哪个转写服务',
      'field.prefer.hint': '宿主自带的是 SenseVoice（桌面版内置、零配置、不占显存）。下面那块 asr.json 是可选的自建或在线服务 —— 选「只用宿主自带的」时它不参与，那块配置会收起来。',
      'prefer.auto': '自动 —— 宿主自带的优先',
      'prefer.host': '只用宿主自带的（SenseVoice）',
      'prefer.local': '只用下面那个服务（asr.json）',
      'local.title': '转写服务（asr.json）',
      'local.sub': '这个文件决定"声音用谁听写"。它与 video-storyboard 共用一份 —— 两个插件都读它，所以改这里对两边都生效。',
      'local.api': '接口形态',
      'local.api.hint': '多数服务是音频接口。只有聊天接口的服务（小米 MiMo 这类）才选第二种 —— 端点不一样，选错会 404。',
      'local.api.openai': '音频接口 /audio/transcriptions',
      'local.api.chat': '聊天接口 /chat/completions',
      'local.baseUrl': '服务地址',
      'local.baseUrl.hint': '要带版本路径，例如 https://api.example.com/v1。留空 = 不用这个文件。',
      'local.baseUrl.ph': 'https://api.example.com/v1',
      'local.model': '模型名',
      'local.model.hint': '按服务方的文档填。',
      'local.language': '语言',
      'local.language.hint': 'auto / zh / en，按服务支持的填。',
      'local.key': '密钥',
      'local.key.hint': '只写不读：文件里的 key 不会回显到页面上。留空表示不改。',
      'local.key.keep': '已设置，留空不改',
      'local.key.ph': '没设置',
      'local.empty': '这里还是空的。填了地址就能用；留空则由上面「用哪个转写服务」的规则决定。',
      'local.save': '保存转写服务',
      'local.sample': '看看这个文件长什么样',
      'local.sample.body': '{\n  "api": "openai-audio",\n  "baseUrl": "http://127.0.0.1:8000/v1",\n  "model": "paraformer-zh-2024-03-09",\n  "language": "auto"\n}',
      'local.manage': '文件里还有 manage（怎么把服务拉起来）一类的键，面板不动它们，原样保留。',
      'local.env': '环境变量正在覆盖这些字段',
      'field.pace': '场景变换侦测灵敏度',
      'field.pace.hint': '决定"多大的画面变化才算换了一个场景"。分数越低越敏感：切点更密、醒得更勤、话也多；'
        + '分数越高越只挑大变化。',
      'pace.calm': '低 —— 20 分以上的变化才算（很久才出声）',
      'pace.normal': '中 —— 12 分（默认）',
      'pace.dense': '高 —— 7 分就算（反应快，话也多）',
      'pace.game-economic': '只挑大动作 —— 80 分（游戏省流）',
      'field.batch': '超省模式（攒几张再交）',
      'field.batch.hint': '攒够几张图才叫醒你一次。1 张 = 攒满就交（默认，最及时）。'
        + '调到 3 张：模型一次看三张，少两轮请求 —— 省的是"每轮都要把整个上下文重过一遍"那笔，'
        + '一张图本身只要 222 token，多带两张几乎不要钱。代价是画面更晚到：'
        + '每张要 15~40 秒，攒 3 张就是 1~2 分钟。会话越长越值。',
      'batch.1': '1 张 —— 攒满就交（默认）',
      'batch.2': '2 张',
      'batch.3': '3 张 —— 省得明显',
      'batch.4': '4 张 —— 最省，也最慢',
      'field.idleStop': '空闲多久自己收工',
      'field.idleStop.hint': '单位分钟。0 = 关掉这条线，你不理它它就一直陪着（会一直花 token）。',
      'field.pacing': '说话停顿跟着句长走',
      'field.pacing.hint': '长句之后多留一点，短句之后紧一点。',
      'pacing.follow': '跟随句长（默认）',
      'pacing.guard': '取更晚的那个',
      'pacing.off': '关掉，固定间隔',
      'field.silence': '静音多久算一句说完',
      'field.silence.hint': '单位秒。0.35 是人喘口气的下限 —— 再低会把一句话从中间切开，后半截被当成新的一句。',
      'field.maxSeg': '一句最长多久',
      'field.maxSeg.hint': '单位秒。说到这么久还没停就强行断开，否则一句话一直不断，字幕永远出不来。',
      'field.tierStyle': '每帧多大（档位）',
      'field.tierStyle.hint': '档位 1 = 一格占满，8 = 只占 1/8 边。'
        + '默认「标准」：按变化密度算出档位后，1 档压成 1/2 —— 不然那几帧几乎没变的画面'
        + '会各占满一整张图，张数白涨。想要 1 档也占满就选「原生」。'
        + '换「灵敏度」时格子会跟着变（帧越密格子越小），那是设计，不是错。',
      'tier.standard': '标准 —— 1 档压成 1/2（默认）',
      'tier.native': '原生 —— 算出几档就是几档，1 档也占满',
      'tier.full': '更大 —— 在密度基础上整体降一档',
      'tier.compact': '更小 —— 在密度基础上整体升一档',
      'tier.custom': '自定义 —— 逐档指定映射',
      'field.fillTierMap': '一键填满',
      'field.fillTierMap.pick': '全设成…',
      'field.fillTierMap.hint': '选一个档位，八项一起改成它。八项全一样 = 密度不再影响尺寸，'
        + '灵敏度怎么改格子都是这么大。代价：帧很稀的时候一格只放一两帧，剩下画布是空的。',
      'field.tierMap': '逐档映射',
      'field.tierMap.hint': '左边是算出来的档位，右边选它实际落到哪一档。'
        + '想把"1 档"也缩小就把它改成 2；想让 8 档别那么碎就改成 6。',
      'field.tierMode': '格子大小按什么算',
      'field.tierMode.hint': '模型看的是一张静态拼图，格子大小是唯一能告诉它"这一刻值不值得端详"的通道。'
        + '「密度」看这一带节奏快不快；「变化」按这一帧变了多少分地方 —— 只有它能做出'
        + '同一张图里的大小对比（代价：省 token，但一张图覆盖的时长变长、出图变慢）。',
      'mode.density': '密度 —— 每秒几帧（默认）',
      'mode.weight': '变化 —— 变化越大格越大',
      'field.tierCurve': '七道阈值的取法',
      'field.tierCurve.hint': '阈值决定"多密的画面该用几档"。'
        + '「docx」是原始那套；「感知」按人眼瞬时记忆定标（一格最多 3 秒、最少 0.3 秒）；'
        + '「自定义」自己填七个数。',
      'curve.docx': '原始（docx）',
      'curve.perceptual': '感知定标（3 s ~ 0.3 s）',
      'curve.custom': '自定义七个阈值',
      'field.tierThresholds': '七道阈值（帧/秒）',
      'field.tierThresholds.hint': '从左到右必须严格递增。第 i 个数 = "多密算第 i+1 档"，'
        + '所以数字越大越晚才切到小格子。默认 0.26 / 0.6 / 0.9 / 1.2 / 1.8 / 2.4 / 3.0。',
      'tier.from': '档',
      'field.wakes': '自主唤醒上限',
      'field.wakes.hint': '你一句话都没说，它自己最多醒几次就收工。',
      'field.imageTrigger': '涨到多少张就动手省',
      'field.imageTrigger.hint': '会话里的图涨到这个数，就把更早的一次性省略掉（省到下面那个留底数）。'
        + '0 = 关闭这个功能。',
      'field.imageKeep': '省完保留最近几张',
      'field.imageKeep.hint': '被省掉的图会变成一段文字：不再发给模型，磁盘上那份也能删。'
        + '100 张约 2.2 万 token。**必须小于上面那个触发线**。'
        + '⚠ 每省略一次，前缀缓存要全量重算一遍 —— 所以触发线和留底的差越大，重算越少。',
      'field.live': '说长句时先出半截字幕',
      'field.live.hint': '关掉的话，一句话必须等说完才显示 —— 说满十几秒的时候屏幕上一个字都没有。',
      'field.liveMin': '多长开始给半截',
      'field.liveMin.hint': '单位秒。说满这么久先生成一份快照去转写。',
      'field.liveStep': '半截多久更新一次',
      'field.liveStep.hint': '单位秒。越小字幕跟得越紧，转写次数也越多。不能超过「一句最长」。',
      'field.pollMs': '多久查一次有没有新声音',
      'field.pollMs.hint': '单位毫秒。这个不是转写的开销，主要成本是等断句。',
      'hint.restart': '改这里不会当场生效：这些值决定的是循环的收工线和断句节奏，插件在启动时读一次。保存后重开 DSH。',
      'hint.path': '配置文件',
      'hint.origin': '这里显示的默认值直接来自插件源码，不是在界面里另写一套。',
      'warn.title': '配置里有几处它没接受，用的是默认值',
      'err.rejected': '这几项没通过校验，文件没有被改动：',
      'err.load': '读不到配置',
      'err.save': '保存失败',
      'note.file': '文件还不存在。现在保存会新建它，只写你改过的那几项。',
      'win.title': '悬浮窗样式',
      'win.sub': '一直挂在屏幕上的那个小窗长什么样。改完立刻生效，不用重开 DSH。',
      'win.style': '外观预设',
      'win.style.auto': '自动 —— 远程/录屏用纯色，其余实时玻璃',
      'win.style.live': '实时玻璃 —— 跟着桌面模糊（好看，吃 CPU）',
      'win.style.frost': '静态磨砂 —— 不吃性能（低配机选这个）',
      'win.style.solid': '纯色 —— 最省，背后不透',
      'win.style.hint': '实时玻璃每帧都要抓一次屏再模糊 —— 低配机、高分屏上「卡」就是这么来的。'
        + '静态磨砂不抓屏，只画一张预生成的底板，CPU 占用接近 0；纯色连渐变都不要。',
      'win.applied': '已应用，窗口下一拍就换过来。',
      'win.path': '配置文件',
      'win.game': '打游戏的时候',
      'win.mode': '窗口',
      'win.mode.full': '正常显示',
      'win.mode.hidden': '最小化到托盘（完全不占屏幕）',
      'win.mode.hint': '最小化是真的从屏幕上消失，不是缩成一条。右下角托盘图标、或 Ctrl+Alt+W 叫回来；'
        + '采集照常，台词照念。',
      'win.danmaku': '弹幕',
      'win.danmaku.off': '关',
      'win.danmaku.on': '开 —— 台词从屏幕顶部飘过',
      'win.danmaku.hint': '只飘它说的话；你自己发的不飘。窗口最小化之后，这是唯一还看得见消息的通道。',
      'win.game.hint': '边打游戏边听：窗口选「最小化到托盘」+ 弹幕「开」+ 外观选「静态磨砂」—— 0 占屏、0 抓屏。',
    };

    const t = key => TEXT[key] ?? key;

    // ── 样式 ──────────────────────────────────────────────────────────────────
    const CSS = `
.sn_root{display:flex;flex-direction:column;gap:14px;padding:2px 0 8px}
.sn_hero{display:flex;flex-direction:column;gap:8px;padding:18px 20px;border-radius:16px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);
  background:linear-gradient(165deg,color-mix(in srgb,var(--dsw-alias-bg-layer-3) 86%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,transparent))}
.sn_title{margin:0;font-size:19px;font-weight:740;letter-spacing:-.3px;color:var(--dsw-alias-label-primary)}
.sn_sub{margin:0;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-width:78ch}
.sn_card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.sn_cardhd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.sn_cardname{font-size:13.5px;font-weight:660;color:var(--dsw-alias-label-primary)}
.sn_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.sn_field{display:flex;flex-direction:column;gap:5px;min-width:0}
.sn_label{font-size:12px;font-weight:620;color:var(--dsw-alias-label-primary)}
.sn_hint{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.sn_input,.sn_select{height:32px;padding:0 10px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.sn_input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.sn_select{cursor:pointer}
.sn_input:focus-visible,.sn_select:focus-visible{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 70%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.sn_check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.sn_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sn_btn{height:30px;padding:0 14px;border-radius:8px;font-size:12px;font-weight:620;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 80%,transparent);
  color:var(--dsw-alias-label-primary)}
.sn_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l2)}
.sn_btn.primary{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary)}
.sn_btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 86%,#fff)}
.sn_btn:disabled{opacity:.5;cursor:not-allowed}
.sn_ok{font-size:11.5px;color:var(--dsw-alias-state-success-primary)}
.sn_note{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.sn_mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.sn_box{padding:10px 12px;border-radius:10px;font-size:11.5px;line-height:1.6;word-break:break-word}
.sn_box.warn{border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 8%,transparent);color:var(--dsw-alias-state-warning-primary,#f0a441)}
.sn_box.bad{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary)}
.sn_box ul{margin:4px 0 0;padding-left:18px}
.sn_box li{margin:2px 0}
.sn_det summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:2px 0}
.sn_pre{margin:8px 0 0;padding:10px 12px;border-radius:8px;overflow-x:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
`;

    /**
     * 一个带超时的 JSON 请求。
     *
     * 没有超时的话，Host 正忙时一次挂起的 fetch 会让整页永远停在"读取中"。
     */
    async function api(path, options) {
      const { timeout = 15000, ...rest } = options ?? {};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(API + path, { ...rest, signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const why = body && Array.isArray(body.rejected) ? body.rejected.join('；') : `HTTP ${res.status}`;
          throw new Error(why);
        }
        if (body === null) throw new Error('返回值不是 JSON');
        return body;
      } finally {
        clearTimeout(timer);
      }
    }

    /**
     * 表单草稿：扁平结构，读起来比嵌套少一层心智负担。
     *
     * **必须把「界面上渲染过的每一项」都种进来**，一项不落。`patchOf` 是按
     * 「draft 与 values 逐项比较、不等即视为用户改过」算补丁的：种子缺了谁，
     * draft 那边就是 `undefined`，与真实值永远不等，于是每次保存都会捎上一个
     * 空值幽灵字段（`tierStyle: ""` / `tierMap: []`）。而 `tuning.js` 的规矩是
     * 「本次提交让警告变多 → 整笔拒绝、文件不动」，所以只要缺一项，用户改什么都存不下去。
     */
    function draftOf(values) {
      const listen = values?.listen ?? {};
      return {
        maxAutonomousWakes: values.maxAutonomousWakes,
        imageTrigger: values.imageTrigger,
        imageKeep: values.imageKeep,
        idleStopMin: values.idleStopMin,
        wakeBatch: values.wakeBatch,
        defaultPace: values.defaultPace,
        speechPacing: values.speechPacing,
        // tierMap 是数组：给引用即可，patchOf 用 JSON.stringify 比内容，没有原地改的风险
        tierStyle: values.tierStyle,
        tierMap: values.tierMap,
        // 数组同理给引用（patchOf 用 JSON.stringify 比内容）
        tierMode: values.tierMode,
        tierCurve: values.tierCurve,
        tierThresholds: values.tierThresholds,
        prefer: listen.prefer,
        live: listen.live,
        liveMin: listen.liveMin,
        liveStep: listen.liveStep,
        silence: listen.silence,
        maxSeg: listen.maxSeg,
        pollMs: listen.pollMs,
      };
    }

    /**
     * 按段浅合并两份 values。
     *
     * 宿主 `/config` 的回包现在给的是**写完之后文件里的完整快照**，但面板不该赌
     * 宿主一定是新版 —— 老实现回的是 `writeTuning().values`，按"只写提交过的键"
     * 的语义只有本次提交的那几个，合并一次两种都能用。
     */
    function mergeValues(prev, next) {
      const base = prev ?? {};
      const patch = next ?? {};
      return {
        ...base,
        ...patch,
        listen: { ...(base.listen ?? {}), ...(patch.listen ?? {}) },
      };
    }

    /** 输入框里的字符串换成数字；空串或非数就原样交给宿主去判（它会拒，并给出原因）。 */
    const num = value => {
      if (typeof value === 'number') return value;
      const text = String(value ?? '').trim();
      if (text === '') return Number.NaN;
      return Number(text);
    };

    /**
     * 只把**改过**的键做成补丁。
     *
     * 整体提交虽然也能跑，但它会在用户什么都没动的情况下把一整份默认值写进文件 ——
     * 而 `tuning.js` 的初衷是"用户只写自己想改的那几项"。
     */
    function patchOf(draft, values) {
      // `draftOf` 对空 values 有兜底（`values?.listen ?? {}`），这里也不能假设一定齐全：
      // 老宿主回的包只带本次提交过的键，没提交过 listen 段时它就是 undefined。
      const base = values ?? {};
      const patch = {};
      for (const key of ['maxAutonomousWakes', 'imageTrigger', 'imageKeep', 'idleStopMin', 'wakeBatch', 'defaultPace', 'speechPacing']) {
        if (draft[key] !== base[key]) patch[key] = key === 'defaultPace' || key === 'speechPacing'
          ? draft[key]
          : num(draft[key]);
      }
      if (draft.tierStyle !== base.tierStyle) patch.tierStyle = String(draft.tierStyle ?? '');
      if (draft.tierMode !== base.tierMode) patch.tierMode = String(draft.tierMode ?? '');
      if (draft.tierCurve !== base.tierCurve) patch.tierCurve = String(draft.tierCurve ?? '');
      // 数组比引用永远不等，只能比内容；顺序有意义（第 i 个 = 档位 i+1）
      if (JSON.stringify(draft.tierMap ?? null) !== JSON.stringify(base.tierMap ?? null)) {
        patch.tierMap = (Array.isArray(draft.tierMap) ? draft.tierMap : []).map((n) => num(n));
      }
      if (JSON.stringify(draft.tierThresholds ?? null) !== JSON.stringify(base.tierThresholds ?? null)) {
        patch.tierThresholds = (Array.isArray(draft.tierThresholds) ? draft.tierThresholds : []).map((n) => num(n));
      }
      const cur = base.listen ?? {};
      const listen = {};
      for (const key of ['prefer', 'live', 'liveMin', 'liveStep', 'silence', 'maxSeg', 'pollMs']) {
        if (draft[key] === cur[key]) continue;
        // prefer 是枚举字符串，不能交给 num()（那会把 'host' 换成 NaN）
        listen[key] = key === 'live' ? draft[key] === true
          : key === 'prefer' ? String(draft[key] ?? '')
          : num(draft[key]);
      }
      if (Object.keys(listen).length > 0) patch.listen = listen;
      return patch;
    }

    // ── asr.json 的那一份草稿 ─────────────────────────────────────────────────
    // 单独一套，因为它写的是另一个文件：改了立刻对下一次转写生效，不用重开 DSH。
    // key 永远是空串起步 —— 后端不回传密钥，所以"草稿里没有 key" 与 "文件里没有 key"
    // 是两件事，靠 hasKey 区分。
    const ASR_FIELDS = ['api', 'baseUrl', 'model', 'language'];

    function localDraftOf(local) {
      if (!local || typeof local !== 'object') return null;
      return {
        api: local.api || 'openai-audio',
        baseUrl: local.baseUrl || '',
        model: local.model || '',
        language: local.language || '',
        key: '',
      };
    }

    /** 只提交真的改过的那几个键；key 只在用户真填了的时候才带。 */
    function localPatchOf(draft, local) {
      const patch = {};
      if (!draft || !local) return patch;
      for (const key of ASR_FIELDS) {
        const next = String(draft[key] ?? '').trim();
        if (next !== String(local[key] ?? '').trim()) patch[key] = next;
      }
      const key = String(draft.key ?? '').trim();
      if (key !== '') patch.key = key;
      return patch;
    }

    /**
     * asr.json 那块只在**可能用到它**的时候出现。
     *
     * 原来它顶在最上面，看起来像"转写已经换成这个自建服务了"——实际上宿主自带的
     * SenseVoice 一直在，选了 local 才轮到 asr.json。所以：选「只用宿主自带的」
     * 时整块收起来，别让配置项的存在暗示了不存在的替换关系。
     */
    const shouldShowLocal = (prefer) => prefer !== 'host';

    // ── 设置页 ────────────────────────────────────────────────────────────────
    function SettingsPage() {
      const [data, setData] = useState(null);
      const [draft, setDraft] = useState(null);
      const [error, setError] = useState('');
      const [rejected, setRejected] = useState([]);
      const [busy, setBusy] = useState(true);
      const [savedAt, setSavedAt] = useState(0);
      // asr.json 那一套是独立的：不同文件、不同生效方式（改完立刻生效）。
      const [localDraft, setLocalDraft] = useState(null);
      const [localRejected, setLocalRejected] = useState([]);
      const [localAt, setLocalAt] = useState(0);
      // 悬浮窗样式又是另一个文件（watch-window.json）：也是改完立刻生效，所以单独一套状态
      const [windowStyle, setWindowStyleState] = useState('');
      const [windowAt, setWindowAt] = useState(0);

      const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
          const next = await api('/status');
          setData(next);
          setDraft(draftOf(next.values));
          setLocalDraft(localDraftOf(next.local));
          setWindowStyleState(next.window?.style ?? 'auto');
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const set = (key, value) => {
        setSavedAt(0);
        setRejected([]);
        setDraft(current => ({ ...current, [key]: value }));
      };

      /**
       * 改逐档映射里的一项。
       *
       * 必须**整份数组换新**（不能原地改）：`patchOf` 靠比较两份 draft 来算补丁，
       * 原地改会让"改过"和"没改"看起来一样，那一项就永远提交不上去。
       */
      const setTierMap = (i, v) => {
        const base = Array.isArray(draft?.tierMap) ? draft.tierMap : [1, 2, 3, 4, 5, 6, 7, 8];
        const next = base.map((x) => Number(x));
        next[i] = Number(v);
        set('tierMap', next);
      };

      /**
       * 改七道阈值里的一道。同样整份换新（理由同 `setTierMap`）。
       * 输入框存**字符串**：空串和非数字都留给宿主去拒，前端不替它猜。
       */
      const setThreshold = (i, v) => {
        const base = Array.isArray(draft?.tierThresholds)
          ? draft.tierThresholds
          : (data?.defaults?.tierThresholds ?? []);
        const next = base.slice();
        next[i] = v;
        set('tierThresholds', next);
      };

      const save = async () => {
        if (data === null || draft === null) return;
        const patch = patchOf(draft, data.values);
        if (Object.keys(patch).length === 0 && patch.listen === undefined) {
          setSavedAt(-1);
          return;
        }
        setBusy(true);
        setError('');
        setRejected([]);
        try {
          const result = await api('/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          });
          if (result.ok) {
            // 用宿主回的值重建，而不是把草稿当成新真相：这样面板显示的永远是
            // "文件里实际是什么"，连派生值（idleStopMs）都对。合并是因为回包
            // 可能是增量（见 mergeValues）。
            const merged = mergeValues(data.values, result.values);
            setData(current => ({ ...current, values: merged, warnings: result.warnings, path: result.path }));
            setDraft(draftOf(merged));
            setSavedAt(Date.now());
          } else {
            setRejected(result.rejected ?? []);
          }
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      const setLocal = (key, value) => {
        setLocalAt(0);
        setLocalRejected([]);
        setLocalDraft(current => ({ ...(current ?? {}), [key]: value }));
      };

      const saveLocal = async () => {
        if (data === null || localDraft === null) return;
        const patch = localPatchOf(localDraft, data.local);
        if (Object.keys(patch).length === 0) {
          setLocalAt(-1);
          return;
        }
        setBusy(true);
        setError('');
        setLocalRejected([]);
        try {
          const result = await api('/local', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          });
          if (result.ok) {
            // 同 save()：以宿主回的快照为准，别把草稿当真相。
            setData(current => ({ ...current, local: result.local }));
            setLocalDraft(localDraftOf(result.local));
            setLocalAt(Date.now());
          } else {
            setLocalRejected(result.rejected ?? []);
          }
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      /**
       * 换悬浮窗样式：单独一条路由，**不跟主表单一起提交**。
       *
       * 它写的是 watch-window.json（窗口自己也在写 geometry/name/hidden），
       * 和 see-now.json 不是一份文件；而且窗口盯着这个文件的 mtime，改完就换 ——
       * 没有必要让用户再点一次「保存」。
       */
      const applyWindow = async (patch) => {
        if (patch.style !== undefined) setWindowStyleState(patch.style);
        setWindowAt(0);
        setError('');
        try {
          const result = await api('/window', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          });
          if (result.ok) {
            setData(current => (current ? { ...current, window: result.window } : current));
            setWindowAt(Date.now());
          } else {
            setError((result.rejected ?? []).join('；'));
          }
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      };

      if (data === null || draft === null) {
        return h('div', { className: 'sn_root' },
          h('div', { className: 'sn_hero' },
            h('h2', { className: 'sn_title' }, t('title')),
            h('p', { className: 'sn_sub' }, t('sub'))),
          error !== '' ? h('div', { className: 'sn_box bad' }, `${t('err.load')}：${error}`) : h('div', { className: 'sn_note' }, t('state.loading')),
          h('div', { className: 'sn_row' }, h('button', { className: 'sn_btn', onClick: load, disabled: busy }, t('state.reload'))));
      }

      const field = (key, labelKey, hintKey, props) => h('label', { className: 'sn_field', key },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('input', {
          className: 'sn_input',
          type: 'number',
          value: String(draft[key] ?? ''),
          onChange: e => set(key, e.target.value),
          ...props,
        }),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      const select = (key, labelKey, hintKey, options) => h('label', { className: 'sn_field', key },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('select', {
          className: 'sn_select',
          // 缺种时给空串：`String(undefined)` 会让下拉框渲染出一个名为 "undefined" 的选项
          value: String(draft[key] ?? ''),
          onChange: e => set(key, e.target.value === 'true' ? true : e.target.value === 'false' ? false : e.target.value),
        }, options.map(([value, text]) => h('option', { key: String(value), value: String(value) }, text))),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      // asr.json 那一套的控件：数据源是 localDraft，不是 draft（两个不同的文件）。
      const localField = (key, labelKey, hintKey, props) => h('label', { className: 'sn_field', key: `l_${key}` },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('input', {
          className: 'sn_input',
          value: String(localDraft?.[key] ?? ''),
          onChange: e => setLocal(key, e.target.value),
          ...props,
        }),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      const localSelect = (key, labelKey, hintKey, options) => h('label', { className: 'sn_field', key: `l_${key}` },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('select', {
          className: 'sn_select',
          value: String(localDraft?.[key] ?? ''),
          onChange: e => setLocal(key, e.target.value),
        }, options.map(([value, text]) => h('option', { key: String(value), value: String(value) }, text))),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      // ── 转写服务：asr.json ──
      // 放在「常用」**下面**：先看"用哪个"，再看"那个服务的细节"。顶在最上面会让
      // 人以为这是在替换宿主自带的转写 —— 它只是备选，选「只用宿主的」时整块收起。
      const localCard = data.local && localDraft && shouldShowLocal(draft.prefer)
        ? h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('local.title'))),
          h('p', { className: 'sn_note', style: { margin: '0 0 10px' } }, t('local.sub')),
          h('div', { className: 'sn_mono', style: { marginBottom: '10px' } }, data.local.path),
          !data.local.exists ? h('div', { className: 'sn_hint', style: { marginBottom: '10px' } }, t('local.empty')) : null,
          h('div', { className: 'sn_grid' },
            localSelect('api', 'local.api', 'local.api.hint', [
              ['openai-audio', t('local.api.openai')],
              ['chat-audio', t('local.api.chat')],
            ]),
            localField('baseUrl', 'local.baseUrl', 'local.baseUrl.hint', { type: 'text', placeholder: t('local.baseUrl.ph') }),
            localField('model', 'local.model', 'local.model.hint', { type: 'text' }),
            localField('language', 'local.language', 'local.language.hint', { type: 'text' }),
            localField('key', 'local.key', 'local.key.hint', {
              type: 'password',
              autoComplete: 'off',
              placeholder: data.local.hasKey ? t('local.key.keep') : t('local.key.ph'),
            })),

          data.local.manage ? h('div', { className: 'sn_hint', style: { marginTop: '8px' } }, t('local.manage')) : null,
          data.local.envKeys && data.local.envKeys.length > 0
            ? h('div', { className: 'sn_box warn', style: { marginTop: '10px' } },
              `${t('local.env')}：${data.local.envKeys.join('、')}`)
            : null,

          localRejected.length > 0
            ? h('div', { className: 'sn_box bad', style: { marginTop: '10px' } },
              t('err.rejected'),
              h('ul', {}, localRejected.map((line, i) => h('li', { key: i }, line))))
            : null,

          h('div', { className: 'sn_row', style: { marginTop: '10px' } },
            h('button', { className: 'sn_btn', onClick: saveLocal, disabled: busy }, t('local.save')),
            localAt > 0 ? h('span', { className: 'sn_ok' }, t('state.savedLocal')) : null,
            localAt < 0 ? h('span', { className: 'sn_note' }, t('state.nosave')) : null),

          h('details', { className: 'sn_det', style: { marginTop: '10px' } },
            h('summary', {}, t('local.sample')),
            h('pre', { className: 'sn_pre' }, t('local.sample.body'))))
        : null;

      return h('div', { className: 'sn_root' },
        h('div', { className: 'sn_hero' },
          h('h2', { className: 'sn_title' }, t('title')),
          h('p', { className: 'sn_sub' }, t('sub')),
          h('div', { className: 'sn_mono' }, `${t('hint.path')}：${data.path}`)),

        data.warnings.length > 0
          ? h('div', { className: 'sn_box warn', role: 'status' },
            t('warn.title'),
            h('ul', {}, data.warnings.map((line, i) => h('li', { key: i }, line))))
          : null,

        h('div', { className: 'sn_box' }, t('hint.restart')),

        // ── 悬浮窗样式 ──
        // 放在「常用」上面：它是这一页唯一"改完立刻能看见"的东西，也最常被调
        h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('win.title'))),
          h('p', { className: 'sn_note', style: { margin: 0 } }, t('win.sub')),
          h('div', { className: 'sn_grid' },
            h('label', { className: 'sn_field' },
              h('span', { className: 'sn_label' }, t('win.style')),
              h('select', {
                className: 'sn_select',
                value: windowStyle || 'auto',
                onChange: e => { void applyWindow({ style: e.target.value }); },
              }, ['auto', 'live', 'frost', 'solid'].map(value =>
                h('option', { key: value, value }, t('win.style.' + value)))),
              h('span', { className: 'sn_hint' }, t('win.style.hint')))),
          h('div', { className: 'sn_grid' },
            h('label', { className: 'sn_field' },
              h('span', { className: 'sn_label' }, t('win.mode')),
              h('select', {
                className: 'sn_select',
                value: data.window?.mode || 'full',
                onChange: e => { void applyWindow({ mode: e.target.value }); },
              }, ['full', 'hidden'].map(value =>
                h('option', { key: value, value }, t('win.mode.' + value)))),
              h('span', { className: 'sn_hint' }, t('win.mode.hint'))),
            h('label', { className: 'sn_field' },
              h('span', { className: 'sn_label' }, t('win.danmaku')),
              h('select', {
                className: 'sn_select',
                value: data.window?.danmaku ? 'on' : 'off',
                onChange: e => { void applyWindow({ danmaku: e.target.value === 'on' }); },
              }, ['off', 'on'].map(value =>
                h('option', { key: value, value }, t('win.danmaku.' + value)))),
              h('span', { className: 'sn_hint' }, t('win.danmaku.hint')))),
          h('p', { className: 'sn_note', style: { margin: 0 } }, t('win.game.hint')),
          data.window && data.window.path
            ? h('div', { className: 'sn_mono' }, `${t('win.path')}：${data.window.path}`)
            : null,
          windowAt > 0 ? h('span', { className: 'sn_ok', role: 'status' }, t('win.applied')) : null),

        // ── 常用 ──
        h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('sec.common'))),
          h('div', { className: 'sn_grid' },
            select('prefer', 'field.prefer', 'field.prefer.hint', [
              ['auto', t('prefer.auto')],
              ['host', t('prefer.host')],
              ['local', t('prefer.local')],
            ]),
            select('defaultPace', 'field.pace', 'field.pace.hint', [
              ['calm', t('pace.calm')],
              ['normal', t('pace.normal')],
              ['dense', t('pace.dense')],
              ['game-economic', t('pace.game-economic')],
            ]),
            select('wakeBatch', 'field.batch', 'field.batch.hint', [
              [1, t('batch.1')],
              [2, t('batch.2')],
              [3, t('batch.3')],
              [4, t('batch.4')],
            ]),
            field('idleStopMin', 'field.idleStop', 'field.idleStop.hint', { min: 0, max: 1440, step: 1 }),
            select('speechPacing', 'field.pacing', 'field.pacing.hint', [
              [true, t('pacing.follow')],
              ['guard', t('pacing.guard')],
              [false, t('pacing.off')],
            ]),
            field('silence', 'field.silence', 'field.silence.hint', { min: 0.15, max: 1.5, step: 0.05 }),
            field('maxSeg', 'field.maxSeg', 'field.maxSeg.hint', { min: 0.8, max: 15, step: 0.1 }))),

        localCard,

        // ── 高级 ──
        h('details', { className: 'sn_det sn_card' },
          h('summary', {}, t('sec.advanced')),
          h('div', { className: 'sn_grid', style: { marginTop: '12px' } },
            select('tierStyle', 'field.tierStyle', 'field.tierStyle.hint', [
              ['standard', t('tier.standard')],
              ['native', t('tier.native')],
              ['full', t('tier.full')],
              ['compact', t('tier.compact')],
              ['custom', t('tier.custom')],
            ]),
            select('tierMode', 'field.tierMode', 'field.tierMode.hint', [
              ['density', t('mode.density')],
              ['weight', t('mode.weight')],
            ]),
            select('tierCurve', 'field.tierCurve', 'field.tierCurve.hint', [
              ['docx', t('curve.docx')],
              ['perceptual', t('curve.perceptual')],
              ['custom', t('curve.custom')],
            ]),
            field('maxAutonomousWakes', 'field.wakes', 'field.wakes.hint', { min: 1, max: 200, step: 1 }),
            field('imageTrigger', 'field.imageTrigger', 'field.imageTrigger.hint', { min: 0, max: 2000, step: 10 }),
            field('imageKeep', 'field.imageKeep', 'field.imageKeep.hint', { min: 0, max: 2000, step: 10 }),
            field('liveMin', 'field.liveMin', 'field.liveMin.hint', { min: 0.8, max: 6, step: 0.1 }),
            field('liveStep', 'field.liveStep', 'field.liveStep.hint', { min: 0.4, max: 4, step: 0.1 }),
            field('pollMs', 'field.pollMs', 'field.pollMs.hint', { min: 50, max: 1000, step: 10 })),

          /**
           * 选了「自定义」才展开这 8 个下拉。
           *
           * 左边是**算出来的档位**，右边选它实际落到哪一档 —— 不是"把第 i 格画多大"，
           * 是"这一档的帧应该长多大"。两者容易搞混，所以第一列写 `i →` 而不是"第 i 档"。
           */
          draft.tierStyle === 'custom'
            ? h('div', { className: 'sn_grid', style: { marginTop: '12px' } },
              h('span', { className: 'sn_label', style: { gridColumn: '1 / -1' } }, t('field.tierMap')),
              /**
               * 一键填满：把八项一起改成同一个档。
               *
               * 这就是"每帧固定这么大"的做法 —— 八项都指向同一档时，密度算出来的档位
               * 被整表吃掉，节奏怎么改都不影响尺寸。**不做成独立选项**：它和逐档自定义
               * 是同一件事，多一个概念只会让人以为还有别的能力。
               */
              h('label', { className: 'sn_field', key: 'fill', style: { gridColumn: '1 / -1' } },
                h('span', { className: 'sn_label' }, t('field.fillTierMap')),
                h('select', {
                  className: 'sn_select',
                  defaultValue: '',
                  onChange: (e) => {
                    const v = Number(e.target.value);
                    if (v >= 1 && v <= 8) set('tierMap', Array.from({ length: 8 }, () => v));
                    e.target.selectedIndex = 0;
                  },
                },
                h('option', { value: '' }, t('field.fillTierMap.pick')),
                [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('option', { key: n, value: String(n) }, `${n} 档`))),
                h('span', { className: 'sn_hint' }, t('field.fillTierMap.hint'))),
              [0, 1, 2, 3, 4, 5, 6, 7].map((i) => h('label', { className: 'sn_field', key: `tm${i}` },
                h('span', { className: 'sn_label' }, `${i + 1} →`),
                h('select', {
                  className: 'sn_select',
                  value: String(draft.tierMap?.[i] ?? i + 1),
                  onChange: (e) => setTierMap(i, e.target.value),
                }, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('option', { key: n, value: String(n) }, String(n)))))))
            : null,
          draft.tierStyle === 'custom'
            ? h('span', { className: 'sn_hint' }, t('field.tierMap.hint'))
            : null,
          /**
           * 七道阈值自己填。**只在选「自定义」时出现** —— 选 docx / 感知时那套数字是
           * 代码定的，露出来只会让人以为改得动。
           *
           * 顺序有意义：第 i 个是"多密算第 i+1 档"，必须严格递增。前端不拦，
           * 交给 `tuning.js` 统一判（那边拒了会把原话显示在下面）。
           */
          draft.tierCurve === 'custom'
            ? h('div', { className: 'sn_grid', style: { marginTop: '12px' } },
              h('span', { className: 'sn_label', style: { gridColumn: '1 / -1' } }, t('field.tierThresholds')),
              [0, 1, 2, 3, 4, 5, 6].map((i) => h('label', { className: 'sn_field', key: `th${i}` },
                h('span', { className: 'sn_label' }, `第 ${i + 1} 道`),
                h('input', {
                  className: 'sn_input',
                  type: 'number',
                  step: '0.01',
                  min: '0.01',
                  value: String(draft.tierThresholds?.[i] ?? ''),
                  onChange: (e) => setThreshold(i, e.target.value),
                }))),
              h('span', { className: 'sn_hint', style: { gridColumn: '1 / -1' } }, t('field.tierThresholds.hint')))
            : null,
          h('label', { className: 'sn_check', style: { marginTop: '12px' } },
            h('input', {
              type: 'checkbox',
              checked: draft.live === true,
              onChange: e => set('live', e.target.checked),
            }),
            h('span', {}, t('field.live'))),
          h('span', { className: 'sn_hint' }, t('field.live.hint'))),

        // ── 保存 ──
        rejected.length > 0
          ? h('div', { className: 'sn_box bad', role: 'alert' },
            t('err.rejected'),
            h('ul', {}, rejected.map((line, i) => h('li', { key: i }, line))))
          : null,

        error !== ''
          ? h('div', { className: 'sn_box bad', role: 'alert' }, `${t('err.save')}：${error}`)
          : null,

        h('div', { className: 'sn_row' },
          h('button', { className: 'sn_btn primary', onClick: save, disabled: busy },
            busy ? t('state.saving') : t('state.save')),
          h('button', { className: 'sn_btn', onClick: load, disabled: busy }, t('state.reload')),
          savedAt > 0 ? h('span', { className: 'sn_ok', role: 'status' }, t('state.saved')) : null,
          savedAt < 0 ? h('span', { className: 'sn_note' }, t('state.nosave')) : null),

        h('div', { className: 'sn_note' }, t('hint.origin')));
    }

    function EyeIcon({ size = 20 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true,
      },
        h('path', { d: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z' }),
        h('circle', { cx: 12, cy: 12, r: 3 }));
    }

    const SN_TABS = [
      ['overview', '总览'],
      ['sessions', '会话'],
      ['records', '记录'],
      ['debug', '调试'],
      ['settings', '配置'],
      ['privacy', '隐私'],
    ];

    const SN_ACTION = {
      start: '开始看',
      stop: '停止',
      'window-open': '打开悬浮窗',
      'window-close': '关闭悬浮窗',
      clear: '清空记录',
    };

    const SN_CSS = `
      .snv{--snv-line:var(--dsw-alias-border-l2,rgba(127,127,127,.24));--snv-line2:var(--dsw-alias-border-l3,rgba(127,127,127,.4));--snv-brand:var(--dsw-alias-brand-primary,#2f6fed);--snv-ok:var(--dsw-alias-state-success-primary,#1a7f4b);--snv-warn:var(--dsw-alias-state-warn-primary,#a86a00);--snv-bad:var(--dsw-alias-state-error-primary,#c43b3b);--snv-fg:var(--dsw-alias-label-primary,#1f2329);--snv-fg2:var(--dsw-alias-label-secondary,rgba(0,0,0,.64));--snv-fg3:var(--dsw-alias-label-tertiary,rgba(0,0,0,.46));--snv-bg:var(--dsw-alias-bg-base,#fff);--snv-bg1:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));--snv-bg2:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));height:100%;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;background:var(--snv-bg);color:var(--snv-fg);font:13.5px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
      .snv *{box-sizing:border-box}
      .snv h1,.snv h2,.snv h3,.snv p{margin:0}
      .snv-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:15px 22px 13px;border-bottom:1px solid var(--snv-line);background:linear-gradient(135deg,rgba(47,111,237,.10),rgba(118,196,255,.07) 58%,transparent)}
      .snv-kicker{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--snv-fg3)}
      .snv-head h1{font-size:19px;font-weight:660;letter-spacing:.01em}
      .snv-sub{margin-top:3px;font-size:12px;color:var(--snv-fg2);max-width:680px}
      .snv-dots{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px 12px;max-width:100%;padding-top:2px}
      .snv-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--snv-fg2);white-space:nowrap}
      .snv-dot::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--snv-fg3);box-shadow:0 0 0 3px rgba(127,127,127,.12);flex:none}
      .snv-dot.ok::before{background:var(--snv-ok);box-shadow:0 0 0 3px rgba(26,127,75,.16)}
      .snv-dot.warn::before{background:var(--snv-warn);box-shadow:0 0 0 3px rgba(168,106,0,.16)}
      .snv-dot.bad::before{background:var(--snv-bad);box-shadow:0 0 0 3px rgba(196,59,59,.16)}
      .snv-tabs{flex:none;display:flex;gap:2px;padding:0 14px;margin-top:8px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;border-bottom:1px solid var(--snv-line);background:var(--snv-bg1)}
      .snv-tabs::-webkit-scrollbar{display:none}
      .snv-tab{flex:none;appearance:none;background:none;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;margin:0;padding:9px 12px 7px;font:inherit;font-size:12.5px;font-weight:500;color:var(--snv-fg2);cursor:pointer;transition:background .15s,color .15s,border-color .15s}
      .snv-tab:hover{background:rgba(127,127,127,.08);color:var(--snv-fg)}
      .snv-tab.on{color:var(--snv-brand);border-bottom-color:var(--snv-brand);font-weight:650}
      .snv-tab:focus-visible{outline:2px solid var(--snv-brand);outline-offset:-2px}
      .snv-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 26px;scrollbar-gutter:stable}
      .snv-alert{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;padding:8px 11px;border-radius:9px;border:1px solid rgba(196,59,59,.35);background:rgba(196,59,59,.08);color:var(--snv-bad);font-size:12px}
      .snv-toast{margin-bottom:10px;padding:8px 11px;border-radius:9px;border:1px solid rgba(26,127,75,.35);background:rgba(26,127,75,.08);color:var(--snv-ok);font-size:12px}
      .snv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
      .snv-card{padding:11px 13px;border:1px solid var(--snv-line);border-radius:11px;background:var(--snv-bg1);min-width:0}
      .snv-card.ok{border-color:rgba(26,127,75,.35);background:rgba(26,127,75,.06)}
      .snv-card.warn{border-color:rgba(168,106,0,.35);background:rgba(168,106,0,.06)}
      .snv-card.bad{border-color:rgba(196,59,59,.35);background:rgba(196,59,59,.06)}
      .snv-card-title{font-size:11.5px;color:var(--snv-fg3);display:flex;align-items:center;justify-content:space-between;gap:8px}
      .snv-card-value{margin-top:5px;font-size:18px;font-weight:650;line-height:1.2;letter-spacing:-.01em;font-variant-numeric:tabular-nums;word-break:break-word}
      .snv-card-hint{margin-top:3px;font-size:11.5px;color:var(--snv-fg2);word-break:break-word}
      .snv-actions{display:flex;flex-wrap:wrap;gap:8px;margin:13px 0 4px}
      .snv-btn{appearance:none;height:31px;padding:0 12px;border-radius:8px;border:1px solid var(--snv-line2);background:var(--snv-bg);color:var(--snv-fg);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
      .snv-btn:hover{background:var(--snv-bg2)}
      .snv-btn.primary{background:var(--snv-brand);border-color:var(--snv-brand);color:#fff}
      .snv-btn.primary:hover{filter:brightness(1.05)}
      .snv-btn.danger{border-color:rgba(196,59,59,.4);color:var(--snv-bad)}
      .snv-btn.quiet{border-color:transparent;background:transparent;color:var(--snv-fg2)}
      .snv-btn:disabled{opacity:.45;cursor:default}
      .snv-section{margin-top:16px}
      .snv-section h3{font-size:12.5px;font-weight:650;margin:0 0 7px;color:var(--snv-fg)}
      .snv-note{margin:0 0 10px;font-size:12px;color:var(--snv-fg2);line-height:1.6}
      .snv-table{width:100%;border-collapse:collapse;font-size:12px}
      .snv-table th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--snv-line);color:var(--snv-fg3);font-weight:500;white-space:nowrap}
      .snv-table td{padding:6px 8px;border-bottom:1px solid var(--snv-line);vertical-align:top;word-break:break-word}
      .snv-table tr:last-child td{border-bottom:0}
      .snv-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;border:1px solid var(--snv-line2);font-size:11px;line-height:1.6;color:var(--snv-fg2);background:rgba(127,127,127,.06);white-space:nowrap}
      .snv-chip.ok{color:var(--snv-ok);border-color:rgba(26,127,75,.35);background:rgba(26,127,75,.1)}
      .snv-chip.warn{color:var(--snv-warn);border-color:rgba(168,106,0,.35);background:rgba(168,106,0,.1)}
      .snv-chip.bad{color:var(--snv-bad);border-color:rgba(196,59,59,.35);background:rgba(196,59,59,.1)}
      .snv-empty{padding:18px 12px;border:1px dashed var(--snv-line2);border-radius:10px;color:var(--snv-fg3);font-size:12px;text-align:center}
      .snv-embed{border:1px solid var(--snv-line);border-radius:11px;overflow:hidden;background:var(--snv-bg)}
      .snv-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--snv-fg2);word-break:break-all}
      .snv-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .snv-debug-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
      .snv-kv{padding:8px 10px;border:1px solid var(--snv-line);border-radius:8px;background:var(--snv-bg1);min-width:0}
      .snv-kv-k{font-size:11px;color:var(--snv-fg3)}
      .snv-kv-v{margin-top:2px;font-size:12.5px;font-weight:600;word-break:break-word}
      .snv-error{margin:10px 0;padding:9px 11px;border-radius:8px;border:1px solid rgba(196,59,59,.35);background:rgba(196,59,59,.08);color:var(--snv-bad);font-size:12px;line-height:1.55;word-break:break-word}
      .snv-details{margin-top:4px}
      .snv-details summary{cursor:pointer;font-size:12px;color:var(--snv-brand)}
      .snv-pre{margin:8px 0 0;padding:10px;border-radius:8px;background:var(--snv-bg2);font:11.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:380px;overflow:auto}
      @media(max-width:760px){.snv-head{flex-direction:column;gap:8px;padding:13px 14px 11px}.snv-dots{justify-content:flex-start}.snv-tabs{padding:0 8px}.snv-body{padding:11px 12px 20px}.snv-grid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}}
    `;

    async function snRequest(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
        ...options,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((data.rejected ?? []).join('；') || `HTTP ${response.status}`);
      if (data.ok === false) throw new Error((data.rejected ?? []).join('；') || '操作没有成功');
      return data;
    }

    function SnButton({ children, onClick, disabled, kind = '' }) {
      return h('button', {
        type: 'button',
        className: `snv-btn ${kind}`.trim(),
        disabled: Boolean(disabled),
        onClick,
      }, children);
    }

    function SnChip({ tone = '', children }) {
      return h('span', { className: `snv-chip ${tone}`.trim() }, children);
    }

    function snCard(title, value, hint, tone = '') {
      return h('div', { className: `snv-card ${tone}`.trim() },
        h('div', { className: 'snv-card-title' }, title),
        h('div', { className: 'snv-card-value' }, value),
        h('div', { className: 'snv-card-hint' }, hint));
    }

    function snTime(value) {
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value ?? '');
        return date.toLocaleString('zh-CN', { hour12: false });
      } catch {
        return String(value ?? '');
      }
    }

    function snSpan(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return '—';
      if (n < 60) return `${Math.round(n)} 秒`;
      const m = Math.floor(n / 60), s = Math.round(n % 60);
      return `${m} 分 ${s} 秒`;
    }

    /**
     * 用一句话回答「为什么没有出图」。
     *
     * 帧数在涨、出图是 0，是最容易被当成故障的现象，其实多数时候是**镜头没动** ——
     * 留帧判据一帧都没到，拼图自然不封箱。这几条文案只复用 `runner.status()` 里
     * 已有的计数，不新增服务端字段。
     */
    function snVerdict(cap) {
      const stats = cap?.stats ?? {};
      const frames = Number(cap?.frames ?? stats.frames ?? 0);
      const kept = Number(stats.kept ?? 0);
      const sheets = Number(cap?.sheets ?? stats.sheets ?? 0);
      const running = Boolean(cap?.running);
      if (sheets > 0) return { tone: 'ok', text: `已出 ${sheets} 张图，模型拿到的是拼好的这张。` };
      if (!running) return { tone: '', text: '没在采集；点「开始看」才会开始攒帧。' };
      if (frames === 0) return { tone: 'warn', text: '一帧都没抓到：先看下面的「最近错误」，多半是 ffmpeg 没起来。' };
      if (kept === 0) return { tone: 'warn', text: `抓了 ${frames} 帧，一帧都没留下 —— 画面没变化，不出图是正常的。换个会动的画面再试。` };
      return { tone: 'warn', text: `留下了 ${kept} 帧，还没封箱成图 —— 等下一帧或超时触发。` };
    }

    function SnEventTable({ events, empty }) {
      if (!events?.length) return h('div', { className: 'snv-empty' }, empty);
      return h('table', { className: 'snv-table' },
        h('thead', null, h('tr', null,
          h('th', null, '时间'), h('th', null, '动作'), h('th', null, '结果'), h('th', null, '说明'))),
        h('tbody', null, events.map((event, index) => h('tr', { key: `${event.at ?? ''}-${index}` },
          h('td', null, snTime(event.at)),
          h('td', null, SN_ACTION[event.action] ?? event.action ?? '—'),
          h('td', null, event.ok === false ? h(SnChip, { tone: 'bad' }, '失败') : h(SnChip, { tone: 'ok' }, '完成')),
          h('td', null, event.note ?? '—')))));
    }

    function SnOverview({ status, life, act, busy, refresh }) {
      const cap = life?.status?.capture ?? {};
      const win = life?.status?.window ?? {};
      const lp = life?.status?.loop ?? null;
      const sheets = cap.sheets ?? cap.stats?.sheets ?? 0;
      const values = status?.values ?? {};
      const recent = (life?.journal?.events ?? []).slice(0, 6);
      return h(Fragment, null,
        h('div', { className: 'snv-grid' },
          snCard('采集', cap.running ? '正在看' : '没在看',
            cap.running
              ? `${cap.source?.kind ?? '屏幕'} · ${cap.frames ?? 0} 帧 · ${snSpan(cap.since)}`
              : '开始后按节奏出图，静止画面几乎不花 token',
            cap.running ? 'ok' : ''),
          snCard('悬浮窗', win.alive ? (win.hidden ? '在跑，已藏起' : '在跑') : '没开',
            win.alive
              ? `pid ${win.pid ?? '—'} · 心跳 ${win.heartbeatAgeSec ?? '—'}s 前`
              : '桌面上的那个小窗，不是这个网页',
            win.alive ? (win.hidden ? 'warn' : 'ok') : ''),
          snCard('陪看会话', lp ? (lp.stopped ? '已停' : '在跑') : '没起',
            lp
              ? `叫醒 ${lp.wakes ?? 0} 次 · ${lp.session ?? '未绑定会话'}`
              : '开始看之后才会绑定到当前聊天',
            lp && !lp.stopped ? 'ok' : ''),
          snCard('本次出图', `${sheets} 张`,
            `${values.fps ?? '—'} fps · ${values.pace ?? '—'} 节奏 · 队列 ${cap.pending ?? 0}`,
            sheets > 0 ? 'ok' : '')),
        h('div', { className: 'snv-actions' },
          h(SnButton, { kind: 'primary', onClick: () => act('start'), disabled: Boolean(busy) }, busy === 'start' ? '启动中…' : '开始看'),
          h(SnButton, { onClick: () => act('stop'), disabled: Boolean(busy) }, busy === 'stop' ? '停止中…' : '停止'),
          h(SnButton, { onClick: () => act('window-open'), disabled: Boolean(busy) }, '打开悬浮窗'),
          h(SnButton, { onClick: () => act('window-close'), disabled: Boolean(busy) }, '关闭悬浮窗'),
          h(SnButton, { kind: 'quiet', onClick: refresh, disabled: Boolean(busy) }, '刷新')),
        h('div', { className: 'snv-section' },
          h('h3', null, '最近动作'),
          h(SnEventTable, { events: recent, empty: '还没有动作记录。开始看一次，这里会出现时间线。' })));
    }

    function SnSessions({ life, act, busy }) {
      const cap = life?.status?.capture ?? {};
      const lp = life?.status?.loop ?? null;
      const sessions = (life?.journal?.events ?? []).filter(event => event.action === 'start' || event.action === 'stop');
      return h(Fragment, null,
        h('p', { className: 'snv-note' },
          '一次「看」= 一次陪看会话：开始后采集和常驻循环一起起，按节奏叫醒模型；停止、关窗或收工都会结束它。'),
        h('div', { className: 'snv-grid' },
          snCard('当前采集', cap.running ? '在跑' : '停',
            cap.running ? `${cap.source?.kind ?? '屏幕'} · ${cap.frames ?? 0} 帧 · 队列 ${cap.pending ?? 0}` : '没有采集进程',
            cap.running ? 'ok' : ''),
          snCard('当前循环', lp ? (lp.stopped ? '已停' : '在跑') : '没起',
            lp ? `会话 ${lp.session ?? '未绑定'} · 叫醒 ${lp.wakes ?? 0} 次` : '开始看后自动起',
            lp && !lp.stopped ? 'ok' : '')),
        h('div', { className: 'snv-actions' },
          h(SnButton, { kind: 'primary', onClick: () => act('start'), disabled: Boolean(busy) }, '开始陪看'),
          h(SnButton, { onClick: () => act('stop'), disabled: Boolean(busy) }, '结束本次'),
          h(SnButton, { onClick: () => act('window-open'), disabled: Boolean(busy) }, '叫回悬浮窗')),
        h('div', { className: 'snv-section' },
          h('h3', null, '会话时间线'),
          h(SnEventTable, { events: sessions, empty: '还没有开始/结束记录。' })));
    }

    function SnRecords({ life }) {
      const events = life?.journal?.events ?? [];
      return h(Fragment, null,
        h('p', { className: 'snv-note' },
          '这里只记动作元数据：什么时候开始/停止、开没开窗、成功没有。不保存画面、帧或窗口标题；画面只走模型，生命周期记录留在本机。'),
        h('div', { className: 'snv-section' },
          h('h3', null, `全部动作（${events.length}）`),
          h(SnEventTable, { events, empty: '还没有记录。' })),
        h('div', { className: 'snv-section' },
          h('h3', null, '记录文件'),
          h('div', { className: 'snv-path' }, life?.journal?.path ?? life?.path ?? '—')));
    }

    function SnDebug({ status, life, act, busy, refresh }) {
      const cap = life?.status?.capture ?? {};
      const win = life?.status?.window ?? {};
      const lp = life?.status?.loop ?? null;
      const listen = cap.listen ?? {};
      const lastError = cap.lastError ?? win.reason ?? lp?.reason ?? '';
      const lastErrorText = typeof lastError === 'string' ? lastError : (lastError ? JSON.stringify(lastError) : '');
      const source = typeof cap.source === 'string'
        ? cap.source
        : (cap.source?.kind ?? cap.source?.type ?? '—');
      const tick = cap.running ? cap.since : cap.idleSec;
      const stats = cap.stats ?? {};
      const takes = cap.takes ?? {};
      const reserved = cap.reserved ?? null;
      const verdict = snVerdict(cap);
      const avgScore = Number(stats.scoreN) > 0 ? Math.round(Number(stats.scoreSum) / Number(stats.scoreN)) : null;
      const tiers = Object.entries(stats.tierHist ?? {}).map(([tier, n]) => `${tier}×${n}`).join(' ') || '—';
      const pairs = [
        ['采集', cap.running ? '在跑' : '停'],
        ['源', source],
        ['画质', cap.quality ?? '—'],
        ['帧 / 出图', `${cap.frames ?? 0} 帧 / ${cap.sheets ?? stats.sheets ?? 0} 张`],
        ['留下的帧', stats.kept ?? 0],
        ['判据 切/标/底', `${stats.cuts ?? 0} / ${stats.marks ?? 0} / ${stats.floors ?? 0}`],
        ['重复跳过', stats.dupSkipped ?? 0],
        ['分数 均/最高', avgScore === null ? '—' : `${avgScore} / ${stats.scoreMax ?? '—'}`],
        ['档位分布', tiers],
        ['首帧至今', cap.secondsSinceWake == null ? '—' : snSpan(cap.secondsSinceWake)],
        ['叫醒空手', `${takes.peekEmpty ?? 0} / ${takes.peek ?? 0}`],
        ['预留图', reserved ? `seq ${reserved.seq} · ${reserved.ageSec}s` : '—'],
        ['队列', cap.pending ?? 0],
        ['溢出', stats.overflow ?? 0],
        [cap.running ? '已运行' : '已停', snSpan(tick)],
        ['唤醒 / 会话', `${lp?.wakes ?? 0} 次 / ${lp?.session ?? '—'}`],
        ['窗口', win.alive ? `pid ${win.pid ?? '?'}` : (win.pid ? `已退出（${win.pid}）` : '没开')],
        ['心跳', win.heartbeatAgeSec == null ? '—' : `${win.heartbeatAgeSec} 秒前`],
        ['听声音', listen.enabled ? '在听' : (listen.reason ? String(listen.reason) : '没在听')],
      ];
      return h(Fragment, null,
        h('p', { className: 'snv-note' },
          '调试页每 1.5 秒自动刷新；点「开始看」会自动切到这里。显示的是宿主真实状态，只读，不会改配置。'),
        h('div', { className: 'snv-row' },
          h(SnButton, {
            kind: cap.running ? 'quiet' : 'primary',
            onClick: () => act('start'),
            disabled: Boolean(busy),
          }, cap.running ? '重新开始' : '开始看'),
          h(SnButton, { kind: 'quiet', onClick: () => act('stop'), disabled: !cap.running || Boolean(busy) }, '停止'),
          h(SnButton, { kind: 'quiet', onClick: refresh }, '刷新')),
        lastErrorText ? h('div', { className: 'snv-error' }, `最近错误：${lastErrorText}`) : null,
        h('div', { className: 'snv-section' },
          h('h3', null, '实时状态'),
          h('div', { className: 'snv-row' },
            h(SnChip, { tone: verdict.tone }, verdict.text)),
          h('div', { className: 'snv-debug-grid' }, pairs.map(([key, value]) => h('div', { className: 'snv-kv', key },
            h('div', { className: 'snv-kv-k' }, key),
            h('div', { className: 'snv-kv-v' }, String(value)))))),
        h('div', { className: 'snv-section' },
          h('h3', null, '最近动作'),
          h(SnEventTable, { events: (life?.journal?.events ?? []).slice(0, 6), empty: '还没有动作。' })),
        h('div', { className: 'snv-section' },
          h('h3', null, '原始状态'),
          h('details', { className: 'snv-details' },
            h('summary', null, '展开 runner.status() / loop / window'),
            h('pre', { className: 'snv-pre' }, JSON.stringify({
              capture: cap,
              loop: lp,
              window: win,
              tuning: status?.values ?? null,
            }, null, 2)))));
    }

    function SnPrivacy({ status, life, act, busy }) {
      const win = life?.status?.window ?? {};
      const confirmAct = (action, message) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(message)) return;
        void act(action);
      };
      return h(Fragment, null,
        h('p', { className: 'snv-note' },
          '隐私边界：抓到的画面只作为模型输入；本插件不落盘画面。生命周期记录也只是动作，不含屏上内容。随时可以一键停掉采集和悬浮窗。'),
        h('div', { className: 'snv-actions' },
          h(SnButton, { kind: 'danger', onClick: () => confirmAct('stop', '停止采集和陪看循环？'), disabled: Boolean(busy) }, '停止采集与陪看'),
          h(SnButton, { kind: 'danger', onClick: () => confirmAct('window-close', '关闭桌面悬浮窗？'), disabled: Boolean(busy) }, '关闭悬浮窗'),
          h(SnButton, { onClick: () => confirmAct('clear', '清空生命周期记录？只删动作日志，不碰配置。'), disabled: Boolean(busy) }, '清空动作记录')),
        h('div', { className: 'snv-section' },
          h('h3', null, '当前状态'),
          h('div', { className: 'snv-row' },
            h(SnChip, { tone: life?.status?.capture?.running ? 'ok' : '' }, life?.status?.capture?.running ? '采集在跑' : '采集停了'),
            h(SnChip, { tone: win.alive ? 'ok' : '' }, win.alive ? '悬浮窗在' : '悬浮窗不在'),
            h(SnChip, null, '画面不落盘'))),
        h('div', { className: 'snv-section' },
          h('h3', null, '文件位置'),
          h('div', { className: 'snv-path' }, `配置：${status?.path ?? '—'}`),
          h('div', { className: 'snv-path' }, `生命周期：${life?.journal?.path ?? life?.path ?? '—'}`),
          h('div', { className: 'snv-path' }, '悬浮窗日志：~/.dsh/see-now-window.log')));
    }

    function SnSettings() {
      return h('div', { className: 'snv-embed' }, h(SettingsPage));
    }

    function SeeNowPanel() {
      const [tab, setTab] = useState('overview');
      const [status, setStatus] = useState(null);
      const [life, setLife] = useState(null);
      const [error, setError] = useState('');
      const [toast, setToast] = useState('');
      const [busy, setBusy] = useState('');

      const refresh = useCallback(async () => {
        try {
          const [nextStatus, nextLife] = await Promise.all([snRequest('/status'), snRequest('/lifecycle')]);
          setStatus(nextStatus);
          setLife(nextLife);
          setError('');
        } catch (failure) {
          setError(failure.message);
        }
      }, []);

      useEffect(() => { void refresh(); }, [refresh]);

      // 提示条自己下台：动作已经完成，留着只会盖住下一次的状态。
      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(''), 4000);
        return () => clearTimeout(timer);
      }, [toast]);

      const capRunning = Boolean(life?.status?.capture?.running);
      useEffect(() => {
        if (tab !== 'debug' && !capRunning) return undefined;
        const timer = setInterval(() => {
          // 窗口在后台时没人看这页，别再按 1.5 秒去敲宿主。
          if (typeof document !== 'undefined' && document.hidden) return;
          void refresh();
        }, 1500);
        return () => clearInterval(timer);
      }, [tab, capRunning, refresh]);

      const act = useCallback(async (action) => {
        setBusy(action);
        setError('');
        setToast('');
        try {
          const next = await snRequest('/lifecycle', {
            method: 'POST',
            body: JSON.stringify({ action }),
          });
          // 回包已经是完整的一份（status + journal），不用再 GET 两趟。
          setLife(next);
          if (action === 'start' && next?.ok !== false) setTab('debug');
          setToast(`${SN_ACTION[action] ?? action}：完成`);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy('');
        }
      }, []);

      const cap = life?.status?.capture ?? {};
      const win = life?.status?.window ?? {};
      const lp = life?.status?.loop ?? null;
      const dots = [
        h('span', { key: 'cap', className: `snv-dot ${cap.running ? 'ok' : ''}` }, cap.running ? '正在看' : '没在看'),
        h('span', { key: 'win', className: `snv-dot ${win.alive ? 'ok' : ''}` }, win.alive ? '悬浮窗开着' : '悬浮窗没开'),
        h('span', { key: 'loop', className: `snv-dot ${lp && !lp.stopped ? 'ok' : ''}` }, lp ? (lp.stopped ? '循环已停' : '陪看循环在跑') : '无循环'),
      ];
      let content = null;
      if (tab === 'overview') content = h(SnOverview, { status, life, act, busy, refresh });
      else if (tab === 'sessions') content = h(SnSessions, { life, act, busy });
      else if (tab === 'records') content = h(SnRecords, { life });
      else if (tab === 'debug') content = h(SnDebug, { status, life, act, busy, refresh });
      else if (tab === 'settings') content = h(SnSettings);
      else content = h(SnPrivacy, { status, life, act, busy });

      return h('main', { className: 'snv' },
        h('style', null, SN_CSS),
        h('header', { className: 'snv-head' },
          h('div', null,
            h('p', { className: 'snv-kicker' }, 'VIVY · 感知'),
            h('h1', null, '我看到了'),
            h('p', { className: 'snv-sub' }, '看屏幕、听声音、管住陪看的开始与结束。配置和记录都在这一页。')),
          h('div', { className: 'snv-dots' }, ...dots)),
        h('div', { className: 'snv-tabs', role: 'tablist', 'aria-label': '我看到了导航' },
          SN_TABS.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            role: 'tab',
            id: `snv-tab-${id}`,
            'aria-controls': `snv-panel-${id}`,
            'aria-selected': tab === id,
            className: tab === id ? 'snv-tab on' : 'snv-tab',
            onClick: () => setTab(id),
          }, label))),
        h('div', {
          className: 'snv-body',
          role: 'tabpanel',
          id: `snv-panel-${tab}`,
          'aria-labelledby': `snv-tab-${tab}`,
        },
          error ? h('div', { className: 'snv-alert', role: 'alert' },
            h('span', null, error),
            h(SnButton, { kind: 'quiet', onClick: refresh }, '重试')) : null,
          toast ? h('div', { className: 'snv-toast' }, toast) : null,
          content));
    }

    // ── 接进 shell ────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-plugin', 'dsh-see-now');
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'dsh-see-now: styles');

      /* VIVY心核：整页管理面板，不再占用 DSH 设置里的独立分区。
         `dsh-vivy-studio` 按可访问名把它归到「心核」，order 16 接在「进化」之后。 */
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'see-now',
        inject: () => ({}),
      }, SeeNowPanel));

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'see-now',
        order: 16,
        label: () => '我看到了',
      }, EyeIcon));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = 'dsh-see-now';
    exports.__test = { draftOf, mergeValues, patchOf, num, TEXT, localDraftOf, localPatchOf, shouldShowLocal, SN_TABS, snVerdict };
    return module.exports;
  },
});
