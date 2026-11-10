/*:
 * @plugindesc 雷霆聊天框 v0.1.3 — 把 RPG Maker 的对话选项换成自由输入的聊天框（MV / MZ）
 * @author 雷霆 × DSH
 *
 * @help
 * 安装（MV）：
 *   1. 本文件放到  <游戏>/www/js/plugins/TT_ChatChoice.js
 *   2. 编辑 <游戏>/www/js/plugins.js，在 $plugins = [ ... ] 数组末尾加一行：
 *      {"name":"TT_ChatChoice","status":true,"description":"","parameters":{}}
 *   3. 进游戏，遇到对话选项时屏幕底部出现聊天框。F9 开关。
 *
 * 安装（MZ）：路径是 <游戏>/js/plugins/，plugins.js 里数组名为 plugins。
 *
 * 配置：见文件顶部 TT.CONFIG。默认纯本地匹配（不联网、零成本）；
 *       接大模型：把 api.enabled 改成 true，key 有三处可放（优先级从高到低）：
 *         1) TT.CONFIG.api.key 直接填（最简单，但别把这个文件提交到 git）
 *         2) 单独的 key 文件里的 window.TT_CHAT_KEY（推荐；见 js/plugins/TT_ChatChoice.key.example.js）
 *         3) 浏览器 localStorage 的 TT_ChatChoiceKey（控制台里调试用）
 *       验证通道：控制台执行 TT_ChatChoice.testAPI().then(console.log, console.error)
 *
 * 说明：本插件只接管「对话选项」（Scene_Message 的 Window_ChoiceList），
 *       不碰战斗/物品选择窗口。
 */
(function () {
  'use strict';

  var TT = (window.TT_ChatChoice = window.TT_ChatChoice || {});

  TT.VERSION = '0.1.4';

  // ==================================================================
  // 配置：改这里
  // ==================================================================
  TT.CONFIG = {
    enabled: true,          // false = 完全关闭，回到原版选项

    // 本地匹配阈值（决定"敢不敢替你选"）
    minScore: 1,            // 最高分至少这么多才出手
    minConfidence: 0.5,     // 最高分 / (最高分 + 次高分 * 1.2)
    confirm: true,          // true = 先问一句"我理解为 X，确认？"

    // 大模型兜底（可选）。默认关闭 = 完全本地、零成本、不联网。
    api: {
      enabled: false,
      endpoint: 'https://api.deepseek.com/chat/completions',
      key: '',              // 填上 key 并把 enabled 改 true
      model: 'deepseek-chat',
      timeoutMs: 8000
    },

    hideOriginal: true,     // 隐藏游戏原来的选项框
    hotkey: 'F9',           // 临时开关
    // 聊天框布局：可拖拽 / 缩放，位置尺寸记在 localStorage
    layoutKey: 'TT_ChatChoiceLayout',
    defaultDock: 'auto',    // 'auto' = 小窗口(高<560)停顶部，避免压住原对话框；'top' / 'bottom'
    defaultWidth: 560,      // 首次出现宽度（px），窗口更窄时自动收
    defaultHeight: 150,     // 首次出现高度（px）
    minWidth: 300,          // 缩放下限
    minHeight: 96,
    pollFallback: true,     // 每 400ms 兜底扫描一次（防自定义窗口不被 hook 到）
    debug: false
  };

  // API key 解析：CONFIG 里直接填 > 外部 key 文件（window.TT_CHAT_KEY）> localStorage
  // 这样 git 里可以只放代码，key 放本机单独文件（见 TT_ChatChoice.key.example.js）
  TT.apiKey = function () {
    try {
      if (TT.CONFIG.api && TT.CONFIG.api.key) return String(TT.CONFIG.api.key);
      if (typeof window !== 'undefined' && window.TT_CHAT_KEY) return String(window.TT_CHAT_KEY);
      if (typeof localStorage !== 'undefined') {
        return String(localStorage.getItem('TT_ChatChoiceKey') || '');
      }
    } catch (e) { /* ignore */ }
    return '';
  };

  TT.METHOD_NAME = {    ordinal: '序数',
    lexical: '词面匹配',
    llm: '大模型',
    single: '唯一选项',
    none: '无'
  };

  // ==================================================================
  // 一、纯逻辑（可在 Node 里单测）
  // ==================================================================

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。！？、；：""''「」『』（）【】《》〈〉…—~,.!?;:'"()\[\]<>\/\\|·]/g, '');
  }

  // 中文 bigram + 英文/数字单词
  function tokensOf(s) {
    var out = [];
    var cjk = s.match(/[\u4e00-\u9fff]+/g) || [];
    for (var i = 0; i < cjk.length; i++) {
      var seg = cjk[i];
      if (seg.length === 1) {
        out.push(seg);
      } else {
        for (var j = 0; j < seg.length - 1; j++) out.push(seg.substr(j, 2));
      }
    }
    var words = s.match(/[a-z0-9]+/g) || [];
    for (var k = 0; k < words.length; k++) out.push(words[k]);
    return out;
  }

  function longestCommonSubstring(a, b) {
    if (!a || !b) return 0;
    var prev = new Array(b.length + 1);
    var best = 0;
    var i, j;
    for (j = 0; j <= b.length; j++) prev[j] = 0;
    for (i = 1; i <= a.length; i++) {
      var cur = new Array(b.length + 1);
      cur[0] = 0;
      for (j = 1; j <= b.length; j++) {
        if (a.charAt(i - 1) === b.charAt(j - 1)) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) best = cur[j];
        } else {
          cur[j] = 0;
        }
      }
      prev = cur;
    }
    return best;
  }

  function scoreOption(inputN, optionN, inputTokens, optionTokens) {
    if (!optionN) return 0;
    var score = 0;
    var set = {};
    var matched = {};
    var i, k;
    for (k = 0; k < optionTokens.length; k++) set[optionTokens[k]] = true;
    for (i = 0; i < inputTokens.length; i++) {
      var t = inputTokens[i];
      if (set[t] && !matched[t]) {
        matched[t] = true;
        score += t.length >= 2 ? 1 : 0.5;
      }
    }
    var lcs = longestCommonSubstring(inputN, optionN);
    if (lcs >= 2) score += lcs * 0.8;
    // 短选项（"是" / "好" / "走" / "No"）被完整包含时加权重
    if (optionN.length <= 3 && inputN.indexOf(optionN) >= 0) score += 2;
    return score;
  }

  var CN_NUM = {
    '零': 0, '一': 0, '二': 1, '两': 1, '三': 2, '四': 3,
    '五': 4, '六': 5, '七': 6, '八': 7, '九': 8, '十': 9
  };

  function cnToIndex(ch) {
    if (/^\d$/.test(ch)) return parseInt(ch, 10) - 1;
    return CN_NUM[ch] != null ? CN_NUM[ch] : null;
  }

  // "第二个" / "选2" / "按第3个" / 纯数字 "2" → 下标
  function parseOrdinal(input, n) {
    var m = input.match(/(?:第|选|点|按|要)\s*([一二两三四五六七八九十\d])\s*(?:个|项|条|号|种)?/);
    if (m) {
      var idx = cnToIndex(m[1]);
      if (idx !== null && idx >= 0 && idx < n) return idx;
    }
    if (/^\d+$/.test(input)) {
      var k = parseInt(input, 10) - 1;
      if (k >= 0 && k < n) return k;
    }
    return null;
  }

  var YES_WORDS = ['是的', '是', '好', '好的', '行', '可以', '确定', '同意', '对', '嗯', '要', '答应', '接受', '没错'];
  var NO_WORDS = ['不是', '不', '否', '不要', '不行', '拒绝', '算了', '取消', '别', '不同意', '不答应', '不用'];

  function polarity(input) {
    var i;
    for (i = 0; i < NO_WORDS.length; i++) if (input.indexOf(NO_WORDS[i]) >= 0) return -1;
    for (i = 0; i < YES_WORDS.length; i++) if (input.indexOf(YES_WORDS[i]) >= 0) return 1;
    return 0;
  }

  function isYesOption(o) {
    return /是|好|确定|同意|接受|行|可以|对|要|答应/.test(o);
  }

  function isNoOption(o) {
    return /不是|不|否|拒绝|取消|算|别/.test(o);
  }

  /**
   * 核心：把自由输入映射到选项下标
   * @param {string} input 玩家说的话
   * @param {string[]} options 选项文本（原始）
   * @param {string} ctx 当前对话上下文（可选）
   * @returns {{index:number, method:string, confidence:number, scores:number[]}}
   */
  TT.matchIntent = function (input, options, ctx) {
    options = options || [];
    var result = { index: -1, method: 'none', confidence: 0, scores: [] };
    var inputN = normalize(input);
    if (!inputN || !options.length) return result;

    var n = options.length;
    if (n === 1) {
      result.index = 0;
      result.method = 'single';
      result.confidence = 1;
      return result;
    }

    var ord = parseOrdinal(inputN, n);
    if (ord !== null) {
      result.index = ord;
      result.method = 'ordinal';
      result.confidence = 0.95;
      return result;
    }

    var optsN = [];
    var i;
    for (i = 0; i < n; i++) optsN.push(normalize(options[i]));

    var inputTokens = tokensOf(inputN);
    var pol = polarity(inputN);
    var scores = [];
    var best = 0;
    for (i = 0; i < n; i++) {
      var s = scoreOption(inputN, optsN[i], inputTokens, tokensOf(optsN[i]));
      if (pol === 1) {
        if (isYesOption(optsN[i])) s += 2;
        if (isNoOption(optsN[i])) s -= 1;
      } else if (pol === -1) {
        if (isNoOption(optsN[i])) s += 2;
        if (isYesOption(optsN[i])) s -= 1;
      }
      scores.push(s);
      if (s > scores[best]) best = i;
    }
    result.scores = scores;

    var top = scores[best];
    var second = 0;
    for (i = 0; i < n; i++) if (i !== best && scores[i] > second) second = scores[i];

    if (top >= TT.CONFIG.minScore) {
      var conf = second <= 0 ? 1 : top / (top + second * 1.2);
      if (conf >= TT.CONFIG.minConfidence) {
        result.index = best;
        result.method = 'lexical';
        result.confidence = conf;
        return result;
      }
    }
    return result;
  };

  // 明确表示"你帮我选 / 跳过"：不替你选，提示走原选项
  var ABANDON_WORDS = ['随便', '你选', '你挑', '你决定', '帮我选', '替我选', '代我选', '都行', '哪个都行', '随意', '跳过', '不选', '不想选', '无所谓', '懒得选'];

  TT.isAbandon = function (input) {
    var s = normalize(input);
    if (!s) return false;
    for (var i = 0; i < ABANDON_WORDS.length; i++) {
      if (s.indexOf(ABANDON_WORDS[i]) >= 0) return true;
    }
    return false;
  };

  // 有实际内容的输入（排除空、纯标点、纯符号）
  TT.isMeaningful = function (input) {
    return /[a-z0-9\u4e00-\u9fff]/.test(normalize(input));
  };

  /**
   * 候选排序：本地没把握时，给玩家 Top-N 让玩家点
   * @returns {Array<{index:number, score:number, share:number}>}
   */
  TT.rankCandidates = function (input, options, ctx, n) {
    options = options || [];
    n = n || 2;
    var out = [];
    var inputN = normalize(input);
    if (!inputN || options.length < 2) return out;

    var optsN = [];
    var i;
    for (i = 0; i < options.length; i++) optsN.push(normalize(options[i]));

    var inputTokens = tokensOf(inputN);
    var pol = polarity(inputN);
    var total = 0;
    for (i = 0; i < options.length; i++) {
      var s = scoreOption(inputN, optsN[i], inputTokens, tokensOf(optsN[i]));
      if (pol === 1) {
        if (isYesOption(optsN[i])) s += 2;
        if (isNoOption(optsN[i])) s -= 1;
      } else if (pol === -1) {
        if (isNoOption(optsN[i])) s += 2;
        if (isYesOption(optsN[i])) s -= 1;
      }
      if (s > 0) {
        out.push({ index: i, score: s });
        total += s;
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    out = out.slice(0, n);
    for (i = 0; i < out.length; i++) out[i].share = total > 0 ? out[i].score / total : 0;
    return out;
  };

  // ==================================================================
  // 二、大模型兜底
  // ==================================================================

  TT.buildPrompt = function (input, options, ctx) {
    var lines = [];
    lines.push('你在帮玩家把一句自然语言映射到游戏对话框里的选项。');
    lines.push('只判断意思最接近的那一个，不要发明新选项。');
    if (ctx) lines.push('当前对话：' + String(ctx).replace(/\n/g, ' / '));
    lines.push('选项（从 0 开始编号）：');
    for (var i = 0; i < options.length; i++) lines.push(i + '. ' + options[i]);
    lines.push('玩家说：' + input);
    lines.push('输出 JSON：{"index": 数字, "reason": "一句话"}。判断不了就 index 用 -1。');
    return lines.join('\n');
  };

  TT.parseLLMReply = function (text, n) {
    try {
      var m = String(text).match(/\{[\s\S]*\}/);
      if (!m) return -1;
      var o = JSON.parse(m[0]);
      var i = parseInt(o.index, 10);
      return i >= 0 && i < n ? i : -1;
    } catch (e) {
      return -1;
    }
  };

  TT.llmMatch = function (input, options, ctx, cb) {
    var api = TT.CONFIG.api;
    var key = TT.apiKey();
    if (!api.enabled || !key) return cb(null);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', api.endpoint, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + key);
    xhr.timeout = api.timeoutMs;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var d = JSON.parse(xhr.responseText);
          var content = d.choices[0].message.content;
          cb(TT.parseLLMReply(content, options.length));
        } catch (e) {
          cb(null);
        }
      } else {
        cb(null);
      }
    };
    xhr.onerror = xhr.ontimeout = function () { cb(null); };
    xhr.send(JSON.stringify({
      model: api.model,
      temperature: 0,
      messages: [{ role: 'user', content: TT.buildPrompt(input, options, ctx) }]
    }));
  };

  // 通道自检：游戏/浏览器控制台里执行 TT_ChatChoice.testAPI().then(console.log, console.error)
  TT.testAPI = function () {
    var api = TT.CONFIG.api || {};
    var key = TT.apiKey();
    if (!key) return Promise.reject(new Error('没找到 key：检查 CONFIG.api.key / window.TT_CHAT_KEY / localStorage'));
    if (!api.endpoint) return Promise.reject(new Error('api.endpoint 为空'));
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', api.endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + key);
      xhr.timeout = api.timeoutMs || 8000;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          return reject(new Error('HTTP ' + xhr.status + '：' + String(xhr.responseText || '').slice(0, 300)));
        }
        try {
          var d = JSON.parse(xhr.responseText);
          var c = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
          resolve({ ok: true, reply: c || '', usage: d.usage || null, model: api.model });
        } catch (e) {
          reject(new Error('返回不是 JSON：' + String(xhr.responseText || '').slice(0, 300)));
        }
      };
      xhr.onerror = function () { reject(new Error('网络错误（检查 endpoint / 代理 / 防火墙）')); };
      xhr.ontimeout = function () { reject(new Error('超时 ' + xhr.timeout + 'ms')); };
      xhr.send(JSON.stringify({
        model: api.model,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: 'user', content: '只回复 pong' }]
      }));
    });
  };

  // ==================================================================
  // 三、把选择注入回游戏
  // ==================================================================

  TT.applyChoice = function (win, index) {
    if (!win || index == null || index < 0) return false;
    if (typeof win.maxItems === 'function' && index >= win.maxItems()) return false;
    if (typeof win.select === 'function') win.select(index);
    if (typeof win.callOkHandler === 'function') {
      win.callOkHandler();
      return true;
    }
    if (window.$gameMessage && typeof window.$gameMessage.onChoice === 'function') {
      window.$gameMessage.onChoice(index);
      return true;
    }
    return false;
  };

  // ==================================================================
  // 四、UI
  // ==================================================================

  var state = {
    open: false,
    win: null,
    options: [],
    ctx: '',
    phase: 'input',   // 'input' | 'confirm'
    pending: -1,
    fails: 0,         // 连续没听懂次数（≥2 升级提示）
    candidates: []    // 低置信度候选
  };

  var root = null;
  var inputEl = null;
  var logEl = null;
  var optionsEl = null;
  var candidateEl = null;
  var layout = null;       // {left,top,width,height}（v0.1.3）
  var layoutDrag = null;   // 拖拽/缩放进行中的状态

  // ---------- 布局：拖拽 / 缩放 / 停靠（v0.1.3） ----------

  function hasButtonAncestor(el, stop) {
    while (el && el !== stop) {
      if (el.tagName === 'BUTTON') return true;
      el = el.parentNode;
    }
    return false;
  }

  function makeHeadButton(text, title) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.style.cssText = 'background:transparent;border:1px solid rgba(110,200,255,0.3);color:#7fd4ff;'
      + 'border-radius:5px;font-size:12px;line-height:1;padding:2px 6px;margin-left:6px;cursor:pointer;';
    return b;
  }

  // 纯函数：把任意布局夹进视口。可在无 DOM 环境测试。
  TT.clampLayout = function (l, vw, vh) {
    var minW = TT.CONFIG.minWidth || 300;
    var minH = TT.CONFIG.minHeight || 96;
    var w = Math.max(minW, Math.min(Number(l.width) || minW, vw - 8));
    var h = Math.max(minH, Math.min(Number(l.height) || minH, vh - 8));
    var x = Math.max(0, Math.min(Number(l.left) || 0, vw - w));
    var y = Math.max(0, Math.min(Number(l.top) || 0, vh - h));
    return { left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) };
  };

  function defaultLayout(vw, vh) {
    var w = Math.min(TT.CONFIG.defaultWidth || 560, vw - 16);
    var h = Math.min(TT.CONFIG.defaultHeight || 150, vh - 16);
    // 小窗口（OMORI 这类 640×480）默认停顶部，避开底部的原版对话框
    var dockAtTop = TT.CONFIG.defaultDock === 'top'
      || (TT.CONFIG.defaultDock === 'auto' && vh < 560);
    return TT.clampLayout({
      left: (vw - w) / 2,
      top: dockAtTop ? 8 : vh - h - 12,
      width: w,
      height: h
    }, vw, vh);
  }

  function loadLayout(vw, vh) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(TT.CONFIG.layoutKey) || 'null'); } catch (e) { saved = null; }
    return saved ? TT.clampLayout(saved, vw, vh) : defaultLayout(vw, vh);
  }

  function saveLayout() {
    if (!layout) return;
    try { localStorage.setItem(TT.CONFIG.layoutKey, JSON.stringify(layout)); } catch (e) { /* ignore */ }
  }

  function applyLayout() {
    if (!root || !layout) return;
    root.style.left = layout.left + 'px';
    root.style.top = layout.top + 'px';
    root.style.width = layout.width + 'px';
    root.style.height = layout.height + 'px';
  }

  function beginDrag(mode, e) {
    if (!root || !layout) return;
    layoutDrag = {
      mode: mode,
      sx: e.clientX, sy: e.clientY,
      left: layout.left, top: layout.top,
      w: layout.width, h: layout.height
    };
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  // 全局只绑一次：mousemove 里按 layoutDrag 更新布局
  function installLayoutDrag() {
    if (typeof document === 'undefined' || document.__ttLayoutDrag) return;
    document.__ttLayoutDrag = true;
    document.addEventListener('mousemove', function (e) {
      if (!layoutDrag || !root) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var dx = e.clientX - layoutDrag.sx;
      var dy = e.clientY - layoutDrag.sy;
      if (layoutDrag.mode === 'move') {
        layout = TT.clampLayout({ left: layoutDrag.left + dx, top: layoutDrag.top + dy, width: layoutDrag.w, height: layoutDrag.h }, vw, vh);
      } else {
        layout = TT.clampLayout({ left: layoutDrag.left, top: layoutDrag.top, width: layoutDrag.w + dx, height: layoutDrag.h + dy }, vw, vh);
      }
      applyLayout();
    });
    document.addEventListener('mouseup', function () {
      if (layoutDrag) { layoutDrag = null; saveLayout(); }
    });
  }

  function toggleDock() {
    if (!layout) return;
    var vh = window.innerHeight;
    var atTop = layout.top < vh / 2;
    layout = TT.clampLayout({
      left: layout.left,
      top: atTop ? (vh - layout.height - 12) : 12,
      width: layout.width,
      height: layout.height
    }, window.innerWidth, vh);
    applyLayout();
    saveLayout();
  }

  function resetLayout() {
    layout = defaultLayout(window.innerWidth, window.innerHeight);
    applyLayout();
    saveLayout();
  }

  function hasChoices() {
    var gm = window.$gameMessage;
    return !!(gm && typeof gm.choices === 'function' && gm.choices() && gm.choices().length);
  }

  function buildUI() {
    if (root || typeof document === 'undefined') return;
    installLayoutDrag();
    layout = loadLayout(window.innerWidth, window.innerHeight);

    root = document.createElement('div');
    root.id = 'tt-chat-root';
    root.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'display:none', 'box-sizing:border-box',
      'font-family:"Microsoft YaHei","PingFang SC",sans-serif',
      'user-select:none'
    ].join(';');

    var panel = document.createElement('div');
    panel.style.cssText = [
      'box-sizing:border-box', 'width:100%', 'height:100%',
      'display:flex', 'flex-direction:column',
      'background:rgba(10,13,18,0.94)',
      'border:1px solid rgba(110,200,255,0.35)',
      'border-radius:12px',
      'box-shadow:0 10px 40px rgba(0,0,0,0.65)',
      'padding:10px 12px', 'color:#e8f2ff', 'overflow:auto'
    ].join(';');

    var head = document.createElement('div');
    head.id = 'tt-chat-head';
    head.style.cssText = 'display:flex;align-items:center;font-size:12px;color:#7fd4ff;'
      + 'letter-spacing:1px;margin-bottom:7px;cursor:move;';
    var title = document.createElement('span');
    title.textContent = '◆ 自由对话';
    var tip = document.createElement('span');
    tip.style.cssText = 'color:#4f6a7d;font-weight:normal;letter-spacing:0;margin-left:8px;flex:1;';
    tip.textContent = '拖这里移动 · 右下角缩放 · Esc 用原选项';
    var dockBtn = makeHeadButton('⇅', '停靠到顶部 / 底部');
    var resetBtn = makeHeadButton('⟲', '复位位置和大小');
    head.appendChild(title);
    head.appendChild(tip);
    head.appendChild(dockBtn);
    head.appendChild(resetBtn);
    head.addEventListener('mousedown', function (e) {
      if (hasButtonAncestor(e.target, head)) return;
      beginDrag('move', e);
    });
    dockBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleDock(); });
    resetBtn.addEventListener('click', function (e) { e.stopPropagation(); resetLayout(); });

    optionsEl = document.createElement('div');
    optionsEl.style.cssText = 'font-size:12px;color:#7f95a8;margin-bottom:8px;line-height:1.8;flex:none;';

    candidateEl = document.createElement('div');
    candidateEl.style.cssText = 'display:none;font-size:12px;color:#8aa0b4;margin-bottom:8px;line-height:1.8;flex:none;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex:none;';

    inputEl = document.createElement('input');
    inputEl.id = 'tt-chat-input';
    inputEl.type = 'text';
    inputEl.autocomplete = 'off';
    inputEl.placeholder = '用你自己的话说…（Enter 发送）';
    inputEl.style.cssText = [
      'flex:1', 'background:rgba(255,255,255,0.06)',
      'border:1px solid rgba(110,200,255,0.28)', 'border-radius:8px',
      'padding:9px 11px', 'color:#fff', 'font-size:14px', 'outline:none'
    ].join(';');

    var send = document.createElement('button');
    send.textContent = '发送';
    send.style.cssText = [
      'background:rgba(80,170,255,0.18)', 'border:1px solid rgba(110,200,255,0.45)',
      'color:#bfe6ff', 'border-radius:8px', 'padding:9px 15px',
      'font-size:13px', 'cursor:pointer'
    ].join(';');

    logEl = document.createElement('div');
    logEl.style.cssText = 'font-size:12px;color:#9fb4c8;margin-top:7px;min-height:16px;line-height:1.6;'
      + 'white-space:pre-wrap;flex:1;overflow:auto;';

    row.appendChild(inputEl);
    row.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(optionsEl);
    panel.appendChild(candidateEl);
    panel.appendChild(row);
    panel.appendChild(logEl);
    root.appendChild(panel);

    // 缩放手柄（右下角）
    var grip = document.createElement('div');
    grip.id = 'tt-chat-grip';
    grip.title = '拖动缩放聊天框';
    grip.style.cssText = 'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:5;';
    var gripLine = document.createElement('div');
    gripLine.style.cssText = 'position:absolute;right:4px;bottom:4px;width:9px;height:9px;'
      + 'border-right:2px solid rgba(110,200,255,0.55);border-bottom:2px solid rgba(110,200,255,0.55);';
    grip.appendChild(gripLine);
    root.appendChild(grip);
    grip.addEventListener('mousedown', function (e) { beginDrag('resize', e); });

    document.body.appendChild(root);
    applyLayout();

    send.addEventListener('click', function () { submitOrConfirm(); });
    inputEl.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        submitOrConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    });
    inputEl.addEventListener('keyup', function (e) { e.stopPropagation(); });
    inputEl.addEventListener('input', function () {
      if (state.phase === 'confirm') {
        state.phase = 'input';
        state.pending = -1;
        setPlaceholder('用你自己的话说…（Enter 发送）');
      }
    });
  }

  function destroyUI() {
    if (root && root.parentNode) {
      try { root.parentNode.removeChild(root); } catch (e) { /* ignore */ }
    }
    root = null;
    inputEl = null;
    logEl = null;
    optionsEl = null;
    candidateEl = null;
  }

  function log(text) {
    if (logEl) logEl.textContent = text || '';
  }

  function setPlaceholder(t) {
    if (inputEl) inputEl.placeholder = t;
  }

  function renderOptions() {
    if (!optionsEl) return;
    optionsEl.textContent = '';
    var label = document.createElement('span');
    label.textContent = '原选项：';
    label.style.cssText = 'color:#4f6a7d;';
    optionsEl.appendChild(label);
    for (var i = 0; i < state.options.length; i++) {
      var chip = document.createElement('span');
      chip.textContent = (i + 1) + '. ' + state.options[i];
      chip.setAttribute('data-index', String(i));
      chip.style.cssText = [
        'display:inline-block', 'margin:2px 6px 2px 0', 'padding:1px 8px',
        'border:1px solid rgba(110,200,255,0.2)', 'border-radius:10px',
        'color:#8aa0b4', 'cursor:pointer'
      ].join(';');
      (function (idx) {
        var el = chip;
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          pickChip(idx);
        });
        el.addEventListener('mouseenter', function () {
          el.style.borderColor = 'rgba(110,200,255,0.6)';
          el.style.color = '#dfefff';
        });
        el.addEventListener('mouseleave', function () {
          el.style.borderColor = el.__hl ? 'rgba(255,200,90,0.55)' : 'rgba(110,200,255,0.2)';
          el.style.color = el.__hl ? '#ffd479' : '#8aa0b4';
        });
      })(i);
      optionsEl.appendChild(chip);
    }
  }

  // 低置信度时候选（可点）
  function renderCandidates(cands) {
    state.candidates = cands || [];
    if (!candidateEl) return;
    candidateEl.textContent = '';
    if (!state.candidates.length) {
      candidateEl.style.display = 'none';
      return;
    }
    var label = document.createElement('span');
    label.textContent = '你是想选：';
    label.style.cssText = 'color:#4f6a7d;';
    candidateEl.appendChild(label);
    for (var i = 0; i < state.candidates.length; i++) {
      (function (c) {
        var b = document.createElement('span');
        b.textContent = (c.index + 1) + '. ' + state.options[c.index];
        b.style.cssText = [
          'display:inline-block', 'margin:2px 6px 2px 0', 'padding:1px 10px',
          'border:1px solid rgba(255,200,90,0.5)', 'border-radius:10px',
          'color:#ffd479', 'cursor:pointer'
        ].join(';');
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          pickChip(c.index);
        });
        candidateEl.appendChild(b);
      })(state.candidates[i]);
    }
    candidateEl.style.display = 'block';
  }

  // 连续没听懂：把原选项 chips 高亮成"可以点"
  function highlightChips() {
    if (!optionsEl) return;
    var chips = optionsEl.querySelectorAll('span[data-index]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].__hl = true;
      chips[i].style.borderColor = 'rgba(255,200,90,0.55)';
      chips[i].style.color = '#ffd479';
    }
  }

  // 玩家点了某个原选项（或候选）：走确认流程
  function pickChip(idx) {
    if (!state.open) return;
    if (idx == null || idx < 0 || idx >= state.options.length) return;
    state.fails = 0;
    renderCandidates([]);
    if (!TT.CONFIG.confirm) {
      doApply(idx);
      return;
    }
    state.pending = idx;
    state.phase = 'confirm';
    log('已选：第 ' + (idx + 1) + ' 个「' + state.options[idx] + '」\nEnter 确认 · 点别的选项可换 · Esc 取消');
    setPlaceholder('Enter 确认 · 点别的选项可换 · Esc 取消');
  }

  function show(win) {
    if (!win) return;
    var gm = window.$gameMessage;
    if (!gm || typeof gm.choices !== 'function') return;
    var opts = gm.choices();
    if (!opts || !opts.length) return;

    if (root) destroyUI();
    buildUI();
    if (!root) return;

    state.open = true;
    state.win = win;
    state.options = opts.slice();
    state.ctx = gm._texts && gm._texts.length ? gm._texts.join('\n') : '';
    state.phase = 'input';
    state.pending = -1;
    state.fails = 0;
    state.candidates = [];

    if (TT.CONFIG.hideOriginal) {
      try { win.visible = false; } catch (e) { /* ignore */ }
    }

    renderOptions();
    renderCandidates([]);
    inputEl.value = '';
    setPlaceholder('用你自己的话说…（Enter 发送）');
    log('');
    root.style.display = 'block';
    setTimeout(function () {
      try { inputEl.focus(); } catch (e) { /* ignore */ }
    }, 0);
  }

  function closeUI(restore) {
    var win = state.win;
    state.open = false;
    state.win = null;
    state.options = [];
    state.ctx = '';
    state.phase = 'input';
    state.pending = -1;
    state.fails = 0;
    state.candidates = [];
    if (root) root.style.display = 'none';
    if (candidateEl) { candidateEl.style.display = 'none'; candidateEl.textContent = ''; }
    if (logEl) logEl.textContent = '';
    if (restore && win) {
      try { win.visible = true; } catch (e) { /* ignore */ }
    }
    destroyUI();
  }

  function onEscape() {
    if (state.phase === 'confirm') {
      state.phase = 'input';
      state.pending = -1;
      log('');
      setPlaceholder('用你自己的话说…（Enter 发送）');
      return;
    }
    closeUI(true);
  }

  function submitOrConfirm() {
    if (!state.open) return;
    if (state.phase === 'confirm') {
      if (state.pending >= 0) doApply(state.pending);
      return;
    }
    submit();
  }

  function submit() {
    var text = inputEl ? inputEl.value.trim() : '';
    if (!text) return;                    // 空输入：静默
    if (!TT.isMeaningful(text)) return;   // 纯标点/符号：静默
    if (TT.isAbandon(text)) {
      state.fails = 0;
      renderCandidates([]);
      log('好，不替你选。按 Esc 用原选项，或直接点上面的原选项。');
      setPlaceholder('Enter 确认 · Esc 用原选项');
      return;
    }
    var m = TT.matchIntent(text, state.options, state.ctx);
    if (m.index >= 0) {
      finalize(m);
      return;
    }
    if (TT.CONFIG.api.enabled && TT.apiKey()) {
      log('本地没把握，问一下大模型…');
      TT.llmMatch(text, state.options, state.ctx, function (idx) {
        if (idx != null && idx >= 0) {
          finalize({ index: idx, method: 'llm', confidence: 0.7 });
        } else {
          localFail(text);
        }
      });
      return;
    }
    localFail(text);
  }

  // 没匹配上：先给候选（可点），连续 2 次升级为"直接点原选项"
  function localFail(text) {
    state.fails++;
    var cands = TT.rankCandidates(text, state.options, state.ctx, 2);
    if (cands.length) {
      renderCandidates(cands);
      log(cands.length === 1
        ? '没太确定。你是不是想选「' + state.options[cands[0].index] + '」？点它，或换个说法。'
        : '没太确定。你是想选上面哪个？点一下就行，或换个说法。');
      setPlaceholder('点候选，或换个说法（Esc 用原选项）');
      return;
    }
    renderCandidates([]);
    if (state.fails >= 2) {
      highlightChips();
      log('还没对上。直接点上面的原选项，或按 Esc 用原选项。');
      setPlaceholder('点原选项，或按 Esc');
    } else {
      log('没太听懂。换个说法？也可以直接点上面的原选项，或按 Esc。');
      setPlaceholder('换个说法（Enter 发送）· Esc 用原选项');
    }
  }

  function finalize(m) {
    state.fails = 0;
    renderCandidates([]);
    state.pending = m.index;
    if (!TT.CONFIG.confirm) {
      doApply(m.index);
      return;
    }
    state.phase = 'confirm';
    var pct = Math.round(m.confidence * 100);
    log('我理解为：第 ' + (m.index + 1) + ' 个「' + state.options[m.index] + '」（' +
      pct + '%，' + (TT.METHOD_NAME[m.method] || m.method) + '）\nEnter 确认 · 继续打字=重说 · Esc 取消');
    setPlaceholder('Enter 确认 · 继续打字=重说 · Esc 取消');
  }

  function doApply(index) {
    var win = state.win;
    closeUI(false);
    TT.applyChoice(win, index);
  }

  // ==================================================================
  // 五、挂到游戏的选项窗口上
  // ==================================================================

  TT.onChoiceWindowUpdate = function (win) {
    if (!TT.CONFIG.enabled) return;
    if (state.open) {
      if (state.win === win && !hasChoices()) closeUI(true);
      return;
    }
    if (!win.active || !win.visible) return;
    if (!hasChoices()) return;
    show(win);
  };

  function installHooks() {
    if (typeof Window_ChoiceList === 'undefined') return;
    var proto = Window_ChoiceList.prototype;
    if (proto.__ttChatHooked) return;
    proto.__ttChatHooked = true;

    var origUpdate = proto.update;
    proto.update = function () {
      origUpdate.call(this);
      try {
        TT.onChoiceWindowUpdate(this);
      } catch (e) {
        if (TT.CONFIG.debug) console.error('[TT_ChatChoice]', e);
      }
    };

    if (TT.CONFIG.pollFallback) {
      setInterval(function () {
        try {
          if (!TT.CONFIG.enabled || state.open || !hasChoices()) return;
          var scene = window.SceneManager && SceneManager._scene;
          var win = scene && scene._choiceWindow;
          if (win && win.active && win.visible) show(win);
        } catch (e) {
          if (TT.CONFIG.debug) console.error('[TT_ChatChoice] poll', e);
        }
      }, 400);
    }
  }

  // 键盘：UI 打开时把按键从游戏手里抢过来
  function installKeyboardGuard() {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', function (e) {
      try {
        if (e.key === TT.CONFIG.hotkey) {
          TT.CONFIG.enabled = !TT.CONFIG.enabled;
          if (!TT.CONFIG.enabled && state.open) closeUI(true);
          return;
        }
        if (!state.open) return;
        if (root && root.contains(e.target)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          submitOrConfirm();
          return;
        }
        e.stopPropagation();
      } catch (err) {
        if (TT.CONFIG.debug) console.error('[TT_ChatChoice] key', err);
      }
    }, true);
  }

  // 手动触发的调试入口（游戏里 F8 控制台可用）
  TT._show = show;
  TT._close = closeUI;
  TT._state = state;

  installHooks();
  installKeyboardGuard();
})();
