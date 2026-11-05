/* ===== Word Counter · 纯函数统计内核（P0 F-01~F-11） =====
   口径唯一依据：V2.0.5字数统计工具-设计文档 第 4 章。
   零依赖、无 DOM、无副作用；可单独在 Node 下跑 fixture 断言。
   明确不做（P1+）：目标进度、选中片段统计、清洗开关、结构提示、推荐互推。 */
(function (root) {
  'use strict';

  var PUNCT_ZH_EN = /[,.;:!?，。！？；：、…—「」“”（）()]/g;   // 中英标点集（4.2 F1 注释）
  var CJK_RE = /[一-鿿㐀-䶿]/g;                                // 基本区 U+4E00–U+9FFF + 扩展A U+3400–U+4DBF
  var LATIN_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;              // 连字符 / 撇号词计 1
  var NUM_RE = /[0-9]+(?:\.[0-9]+)*/g;                        // 含小数点数字视为 1 段（v2.0.5 → 1 段）
  var URL_RE = /https?:\/\/[^\s]+/g;
  var EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  var ABBR_RE = /\b(?:e\.g\.|i\.e\.|etc\.|dr\.|mr\.|mrs\.|ms\.|vs\.|prof\.|jr\.|sr\.)(?=[\s,;，；：]|$)/gi;

  var PRESETS = {
    'quiet-slow':   { zh: 300, en: 200 },
    'quiet-normal': { zh: 400, en: 225 },
    'quiet-fast':   { zh: 500, en: 250 },
    'speak':        { zh: 220, en: 140 }
  };

  function countCodePoints(s) { return Array.from(s).length; }
  function countMatches(s, re) { var m = s.match(re); return m ? m.length : 0; }
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }

  /* F2 英文词数：URL / 邮箱整体计 1 单元，先占位再数拉丁词（4.2 单元归并） */
  function tokenizeLatin(text) {
    var t = String(text).replace(URL_RE, ' x ').replace(EMAIL_RE, ' x ');
    var m = t.match(LATIN_RE);
    return m ? m.length : 0;
  }

  /* F3 句子启发式（估算）：句末标点命中 − 排除（缩写白名单 / 版本号 / 小数）；非空兜底 1 句
     连续句末标点合并计 1 句（"Wow!!!" = 1、省略号 "..." = 1），设计文档第 11 章「省略号误判」风险项 */
  function countSentences(text) {
    if (!text) return 0;
    var excl = [];
    var am;
    ABBR_RE.lastIndex = 0;
    while ((am = ABBR_RE.exec(text)) !== null) {
      for (var j = am.index; j < am.index + am[0].length; j++) { if (text[j] === '.') excl.push(j); }
    }
    var TERM = '.!?。！？';
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (TERM.indexOf(ch) < 0) continue;
      if (ch === '.') {
        if (excl.indexOf(i) >= 0) continue;                                   // e.g. / Dr. 白名单
        var prev = text[i - 1], next = text[i + 1];
        if (prev && next && isDigit(prev) && isDigit(next)) continue;         // v2.3.0 / 3.14159
      }
      n++;
      // 吞掉紧随其后的连续句末标点，避免 "!!!" / "..." 被拆成多句
      while (i + 1 < text.length && TERM.indexOf(text[i + 1]) >= 0) i++;
    }
    return n > 0 ? n : 1;
  }

  /* F5 双档时长：中英按各自语速分别求和后向上取整；默读档取所选 radio，朗读档取 'speak' 桶。
     单档取值：该档分桶里的正数生效，否则回落该档预设（设计文档 4.3「每档可调、本地记忆」） */
  function speedFor(custom, key) {
    var p = PRESETS[key] || PRESETS['quiet-normal'];
    var c = custom && custom[key];
    return { zh: c && c.zh > 0 ? c.zh : p.zh, en: c && c.en > 0 ? c.en : p.en };
  }

  function readingMinutes(cZh, wEn, speedMode, speedCustom) {
    var q = speedFor(speedCustom, speedMode);
    var sp = speedFor(speedCustom, 'speak');
    return {
      quiet: Math.ceil(cZh / q.zh + wEn / q.en),
      speak: Math.ceil(cZh / sp.zh + wEn / sp.en)
    };
  }

  /* F6 限额余量三色：rem≥0 绿 safe；−20≤rem<0 黄 near；rem<−20 红 over */
  function limitStatus(limit, cNs) {
    var rem = limit - cNs;
    var state = rem >= 0 ? 'safe' : (rem >= -20 ? 'near' : 'over');
    return { rem: rem, state: state, usedPct: Math.min(100, Math.round(cNs / limit * 100)) };
  }

  function analyzeText(text, opts) {
    opts = opts || {};
    var includeSpace = opts.includeSpace !== false;
    var includePunct = opts.includePunct !== false;
    var speedMode = opts.speedMode || 'quiet-normal';
    var speedCustom = opts.speedCustom || null;
    var limit = opts.limit || { name: 'meta', max: 155 };

    var s = String(text == null ? '' : text);
    var cAll = countCodePoints(s);
    var noWs = s.replace(/[\s\u3000]/g, '');
    var cNs = countCodePoints(noWs);
    var cNp = countCodePoints(noWs.replace(PUNCT_ZH_EN, ''));
    var tmp = s;
    if (!includeSpace) tmp = tmp.replace(/[\s\u3000]/g, '');
    if (!includePunct) tmp = tmp.replace(PUNCT_ZH_EN, '');
    var cMain = countCodePoints(tmp);                                        // 总字符卡（随双口径联动）

    var cZh = countMatches(s, CJK_RE);
    var wEn = tokenizeLatin(s);
    var nNum = countMatches(s, NUM_RE);
    var punct = cNs - cNp;
    var space = cAll - cNs;

    var sentences = countSentences(s);
    var paragraphs = s.split(/\n\s*\n/).filter(function (b) { return b.trim() !== ''; }).length;
    var lines = s === '' ? 0 : s.split('\n').length;

    var reading = readingMinutes(cZh, wEn, speedMode, speedCustom);
    var lim = limitStatus(limit.max, cNs);

    return {
      cAll: cAll, cNs: cNs, cNp: cNp, cMain: cMain,
      cZh: cZh, wEn: wEn, nNum: nNum, punct: punct, space: space,
      sentences: sentences, paragraphs: paragraphs, lines: lines,
      reading: reading,
      limitRem: lim.rem, limitState: lim.state, limitUsedPct: lim.usedPct,
      goalPct: 0, remain: 0                                                  // P1 目标进度占位，不实现
    };
  }

  var api = { analyzeText: analyzeText, tokenizeLatin: tokenizeLatin, countSentences: countSentences, limitStatus: limitStatus, speedFor: speedFor, PRESETS: PRESETS };
  root.WordCounterCore = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
