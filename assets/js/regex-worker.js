/* Moteful · regex-worker.js · 后台匹配管线（经典 Worker，零依赖）
   接收 {type:'match', reqId, pattern, flags, text}
   回传 {type:'result', reqId, result:{ok, matches, count, ms, timeout, error}} */
'use strict';

self.onmessage = function (e) {
  var d = e.data;
  if (!d || d.type !== 'match') return;
  var result;
  try {
    result = runMatch(d.pattern, d.flags || {}, d.text || '');
  } catch (err) {
    result = { ok: false, error: { pos: null, message: '匹配执行出错：' + (err && err.message || err) }, timeout: false };
  }
  self.postMessage({ type: 'result', reqId: d.reqId, result: result });
};

function flagsStr(flags) {
  var s = '';
  ['g', 'i', 'm', 's', 'u', 'y'].forEach(function (k) { if (flags[k]) s += k; });
  return s;
}

function now() {
  return (self.performance && self.performance.now) ? self.performance.now() : Date.now();
}

function runMatch(pattern, flags, text) {
  var t0 = now();
  var re;
  try {
    re = new RegExp(pattern, flagsStr(flags));
  } catch (err) {
    return { ok: false, error: locateReError(pattern, err), timeout: false };
  }
  var matches = [];
  var m, guard = 0;
  try {
    if (re.global || re.sticky) {
      while ((m = re.exec(text)) !== null) {
        matches.push(pack(m, text));
        if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
        if (++guard > 200000) break;                  // 安全上限
      }
    } else {
      m = re.exec(text);
      if (m) matches.push(pack(m, text));
    }
  } catch (err) {
    return { ok: false, error: { pos: null, message: '匹配执行出错：' + (err && err.message || err) }, timeout: false };
  }
  var t1 = now();
  return { ok: true, matches: matches, count: matches.length, ms: Math.max(0, t1 - t0), timeout: false };
}

function pack(m, text) {
  var before = text.slice(0, m.index);
  var line = (before.match(/\n/g) || []).length + 1;
  var col = m.index - before.lastIndexOf('\n');
  var groups = [];
  for (var i = 1; i < m.length; i++) groups.push({ n: i, name: null, value: m[i] });
  if (m.groups) for (var k in m.groups) groups.push({ n: null, name: k, value: m.groups[k] });
  return { index: m.index, end: m.index + m[0].length, line: line, col: col, content: m[0], groups: groups };
}

function locateReError(pattern, err) {
  var msg = (err && err.message) || '';
  var mm = msg.match(/position (\d+)/);
  var pos = mm ? parseInt(mm[1], 10) : null;
  var at = pos != null ? '（位置 ' + pos + '）' : '';
  /* ⚠️ 本表必须与 assets/js/regex.js 的同名 MAP 逐条保持一致：
     前者是主线程降级路径、后者是 Worker 路径，改一处必须同步改另一处，
     否则同一份错误在不同路径下会给出不同提示。 */
  var MAP = [
    { re: /nothing to repeat/i, msg: '量词前面没有可重复的内容（如 * 或 + 不能直接放在开头）' },
    { re: /Unterminated group/i, msg: '括号没有闭合，缺少收尾的 )' },
    { re: /missing \)/i, msg: '缺少右括号 )' },
    /* Chrome 实际报的是 Unmatched ')'（带单引号），故不能用 /Unmatched \)/ 匹配 */
    { re: /Unmatched/i, msg: '多了一个右括号 )，没有对应的 (' },
    { re: /Unterminated character class/i, msg: '方括号没有闭合，缺少收尾的 ]' },
    { re: /Invalid capture group name/i, msg: '捕获组的名字不合法（名字不能以数字开头）' },
    { re: /Invalid group/i, msg: '分组的写法不正确，请检查 (? 后面的内容' },
    { re: /numbers out of order/i, msg: '花括号里的数字顺序不对（{2,1} 应写成 {1,2}）' },
    { re: /Invalid escape/i, msg: '转义写法无效（如 \\q；请用 \\\\ 或改用字面量）' },
    { re: /Lookbehind.*not supported/i, msg: '当前环境不支持后行断言 (?<= )，请用前行断言' },
    /* 兜底必须放最后：它是宽泛匹配，前置会抢走上面所有具体规则的命中 */
    { re: /Invalid regular expression/i, msg: '正则写法不被引擎识别' }
  ];
  var hit = null;
  for (var i = 0; i < MAP.length; i++) { if (MAP[i].re.test(msg)) { hit = MAP[i]; break; } }
  return { pos: pos, message: (hit ? hit.msg : '正则无效：' + msg) + at, raw: msg };
}
