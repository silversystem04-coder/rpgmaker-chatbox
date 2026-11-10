/**
 * TT_ChatChoice 核心逻辑单测（不需要游戏、不需要浏览器）
 * 用法：node tools/test-core.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert';

const pluginPath = new URL('../js/plugins/TT_ChatChoice.js', import.meta.url);
const src = fs.readFileSync(pluginPath, 'utf8');

// 模拟浏览器全局：插件加载时只用到 window；Window_ChoiceList / document 不存在时自动跳过钩子
globalThis.window = globalThis;
new Function('window', src)(globalThis);

const TT = globalThis.TT_ChatChoice;
if (!TT) {
  console.error('插件没有导出 window.TT_ChatChoice');
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✔ ' + name);
  } catch (e) {
    fail++;
    console.log('  ✘ ' + name + '\n      ' + e.message);
  }
}
function eq(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, (label || '') + ' 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

console.log('\n[1] 序数识别');
check('"第二个" → 下标 1', () => eq(TT.matchIntent('第二个', ['A', 'B', 'C']).index, 1));
check('"选3" → 下标 2', () => eq(TT.matchIntent('选3', ['A', 'B', 'C']).index, 2));
check('纯数字 "2" → 下标 1', () => eq(TT.matchIntent('2', ['A', 'B', 'C']).index, 1));
check('"第5个" 超出范围 → -1', () => eq(TT.matchIntent('第5个', ['A', 'B', 'C']).index, -1));
check('序数 method=ordinal', () => eq(TT.matchIntent('第一个', ['A', 'B']).method, 'ordinal'));

console.log('\n[2] 是非题');
check('"好，我进去" → 第 0 个', () => eq(TT.matchIntent('好，我进去', ['好，我进去', '不了，我先走了']).index, 0));
check('"不了" → 第 1 个', () => eq(TT.matchIntent('不了', ['好，我进去', '不了，我先走了']).index, 1));
check('"嗯" 但选项无是非 → 不猜', () => eq(TT.matchIntent('嗯', ['向左走', '向右走']).index, -1));

console.log('\n[3] 词面匹配');
check('"答应他吧" → 第 0 个', () => eq(TT.matchIntent('答应他吧', ['答应他', '拒绝他', '什么都不说']).index, 0));
check('"拒绝" → 第 1 个', () => eq(TT.matchIntent('拒绝', ['答应他', '拒绝他', '什么都不说']).index, 1));
check('"我不想掺和" → 第 2 个', () => eq(TT.matchIntent('我不想掺和', ['我站在你这边', '我觉得你错了', '我不想掺和', '让我再想想']).index, 2));
check('"向左" → 第 0 个', () => eq(TT.matchIntent('向左', ['向左走', '向右走', '留在原地']).index, 0));
check('四选一模糊输入不硬猜', () => eq(TT.matchIntent('这个嘛', ['我站在你这边', '我觉得你错了', '我不想掺和', '让我再想想']).index, -1));

console.log('\n[4] 边界');
check('空输入 → -1', () => eq(TT.matchIntent('', ['A', 'B']).index, -1));
check('没有选项 → -1', () => eq(TT.matchIntent('随便', []).index, -1));
check('唯一选项 → 0 / single', () => {
  const r = TT.matchIntent('随便', ['只有这一个']);
  eq(r.index, 0);
  eq(r.method, 'single');
});
check('全角标点被忽略', () => eq(TT.matchIntent('「答应他」！', ['答应他', '拒绝他']).index, 0));

console.log('\n[5] 注入选择');
check('select + callOkHandler 被调用', () => {
  const calls = [];
  const win = {
    maxItems: () => 3,
    select: (i) => calls.push(['select', i]),
    callOkHandler: () => calls.push(['ok'])
  };
  eq(TT.applyChoice(win, 1), true);
  eq(calls, [['select', 1], ['ok']]);
});
check('越界拒绝', () => {
  const win = { maxItems: () => 2, select: () => {}, callOkHandler: () => {} };
  eq(TT.applyChoice(win, 5), false);
});
check('没有 callOkHandler 时回退 $gameMessage.onChoice', () => {
  let got = null;
  globalThis.$gameMessage = { onChoice: (i) => { got = i; } };
  eq(TT.applyChoice({ select: () => {} }, 2), true);
  eq(got, 2);
});

console.log('\n[6] 大模型辅助函数');
check('parseLLMReply 正常', () => eq(TT.parseLLMReply('{"index": 2, "reason": "x"}', 3), 2));
check('parseLLMReply 越界 → -1', () => eq(TT.parseLLMReply('{"index": 9}', 3), -1));
check('parseLLMReply 垃圾输入 → -1', () => eq(TT.parseLLMReply('我觉得是第二个', 3), -1));
check('buildPrompt 含选项和玩家话', () => {
  const p = TT.buildPrompt('答应他吧', ['答应他', '拒绝他'], '你想怎么回答？');
  assert.ok(p.includes('0. 答应他'));
  assert.ok(p.includes('答应他吧'));
  assert.ok(p.includes('你想怎么回答？'));
});

console.log('\n[7] 配置完整性');
check('默认不联网', () => eq(TT.CONFIG.api.enabled, false));
check('默认确认后再选', () => eq(TT.CONFIG.confirm, true));
check('版本 0.1.4', () => eq(TT.VERSION, '0.1.4'));

console.log('\n[8] 无关输入 / 放弃指令 / 候选');
check('"随便" 识别为放弃', () => eq(TT.isAbandon('随便'), true));
check('"你帮我选吧" 识别为放弃', () => eq(TT.isAbandon('你帮我选吧'), true));
check('"答应他" 不是放弃', () => eq(TT.isAbandon('答应他'), false));
check('纯标点无意义', () => eq(TT.isMeaningful('。。。！？'), false));
check('空白输入无意义', () => eq(TT.isMeaningful('   '), false));
check('"好" 有意义', () => eq(TT.isMeaningful('好'), true));
check('完全无关 → 无候选', () => eq(TT.rankCandidates('今天天气怎么样', ['答应他', '拒绝他', '什么都不说']).length, 0));
check('部分匹配 → 有候选且排第一', () => {
  const c = TT.rankCandidates('拒绝', ['答应他', '拒绝他', '什么都不说']);
  assert.ok(c.length >= 1);
  eq(c[0].index, 1);
});
check('候选最多 2 个', () => {
  const c = TT.rankCandidates('我不想', ['答应他', '拒绝他', '什么都不说', '让我再想想'], null, 2);
  assert.ok(c.length <= 2);
});
check('候选带 share', () => {
  const c = TT.rankCandidates('拒绝', ['答应他', '拒绝他']);
  assert.ok(c.length && c[0].share > 0 && c[0].share <= 1);
});

console.log('\n[9] 布局：拖拽 / 缩放夹取');
check('正常布局原样返回', () => {
  const l = TT.clampLayout({ left: 100, top: 50, width: 400, height: 150 }, 1000, 800);
  eq([l.left, l.top, l.width, l.height], [100, 50, 400, 150]);
});
check('拖出右边/下边 → 夹回视口', () => {
  const l = TT.clampLayout({ left: 900, top: 700, width: 400, height: 150 }, 1000, 800);
  eq([l.left, l.top], [600, 650]);
});
check('负坐标 → 0', () => {
  const l = TT.clampLayout({ left: -50, top: -20, width: 400, height: 150 }, 1000, 800);
  eq([l.left, l.top], [0, 0]);
});
check('宽度不低于 minWidth', () => {
  const l = TT.clampLayout({ left: 0, top: 0, width: 10, height: 150 }, 1000, 800);
  eq(l.width, TT.CONFIG.minWidth);
});
check('高度不低于 minHeight', () => {
  const l = TT.clampLayout({ left: 0, top: 0, width: 400, height: 10 }, 1000, 800);
  eq(l.height, TT.CONFIG.minHeight);
});
check('宽度不超过视口', () => {
  const l = TT.clampLayout({ left: 0, top: 0, width: 5000, height: 150 }, 1000, 800);
  eq(l.width, 1000 - 8);
});
check('642×480 小窗口里也能放下', () => {
  const l = TT.clampLayout({ left: 0, top: 0, width: 560, height: 150 }, 642, 480);
  assert.ok(l.width <= 642 - 8 && l.height <= 480 - 8);
  assert.ok(l.left >= 0 && l.top >= 0);
});

console.log('\n[10] 大模型 key 解析 / prompt');
check('CONFIG.api.key 优先', () => {
  const old = TT.CONFIG.api.key;
  TT.CONFIG.api.key = 'sk-config';
  eq(TT.apiKey(), 'sk-config');
  TT.CONFIG.api.key = old;
});
check('window.TT_CHAT_KEY 兜底', () => {
  const old = TT.CONFIG.api.key;
  TT.CONFIG.api.key = '';
  globalThis.TT_CHAT_KEY = 'sk-window';
  eq(TT.apiKey(), 'sk-window');
  delete globalThis.TT_CHAT_KEY;
  TT.CONFIG.api.key = old;
});
check('都没配 → 空串', () => {
  const old = TT.CONFIG.api.key;
  TT.CONFIG.api.key = '';
  eq(TT.apiKey(), '');
  TT.CONFIG.api.key = old;
});
check('prompt 含编号选项与 -1 兜底说明', () => {
  const pr = TT.buildPrompt('便宜点', ['贵的那家', '便宜的那家'], '买药');
  assert.ok(pr.includes('0. 贵的那家') && pr.includes('1. 便宜的那家'));
  assert.ok(pr.includes('-1'));
  assert.ok(pr.includes('买药'));
});
check('解析大模型返回的 JSON', () => {
  eq(TT.parseLLMReply('{"index":1,"reason":"x"}', 3), 1);
  eq(TT.parseLLMReply('我觉得是 {"index": 9, "reason": "越界"}', 3), -1);
  eq(TT.parseLLMReply('说不清', 3), -1);
});

console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败\n');
if (fail > 0) process.exit(1);
