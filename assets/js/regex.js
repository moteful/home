/* ===== Regex · 页面逻辑（批次1：核心测试闭环 + 边界/无障碍完善） =====
   严格按设计文档 v0.7正则功能页.html 落地：第六章技术方案、6.7 边界与异常、第八章无障碍。
   样式零新增（仅复用白名单 .rx-panes/.rx-io/.rx-hl/.flag-chip 与全局组件类）。 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var patternEl = $('#rxPattern'), textEl = $('#rxText'),
      errEl = $('#rxErr'), resultEl = $('#rxResult'),
      countEl = $('#rxCount'), hlEl = $('#rxHL'), hlEmpty = $('#rxHLEmpty'),
      headCopyBtn = $('#rxCopyHL'), copyBtn = $('#rxBtnCopy'),
      bigWarnEl = $('#rxBigWarn');
  var worker = null, workerBroken = false, timer = null, workerTimer = null, reqId = 0;

  var BIG = 500 * 1024;   // 大文本阈值：≥500KB 提示走后 Worker（设计 3.2）
  var GUARD = 200000;     // 匹配条数安全上限
  var TIMEOUT = 1500;     // 灾难正则超时（ms）

  /* ---------- i18n 助手（字典未加载/缺键时退回键名，不回退到硬编码文案） ---------- */
  function tr(key, vars) {
    if (window.t) { try { var s = window.t(key, vars); if (s != null && s !== key) return s; } catch (e) {} }
    return key;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function setCount(text) { countEl.textContent = text; }
  function setZero() { setCount(tr('rx_zero')); }

  function flagsObj() {
    var f = { g: false, i: false, m: false, s: false, u: false, y: false };
    document.querySelectorAll('.flag-chip.on').forEach(function (c) { f[c.dataset.flag] = true; });
    return f;
  }
  function flagsStr(flags) {
    var s = '';
    ['g', 'i', 'm', 's', 'u', 'y'].forEach(function (k) { if (flags[k]) s += k; });
    return s;
  }
  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }
  function byteLen(s) {
    try { return new Blob([s]).size; } catch (e) { return s.length; }
  }
  function fmtSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB';
  }

  /* ---------- 空态统一生成（文字走 i18n 动态写入，避免 i18n 时序问题） ---------- */
  function emptyState(icon, titleKey, descKey, pad) {
    return '<div class="empty"' + (pad ? ' style="padding:' + pad + '"' : '') + '>' +
      '<div class="e-ico"><i data-lucide="' + icon + '"></i></div>' +
      '<h4>' + esc(tr(titleKey)) + '</h4>' +
      '<p>' + esc(tr(descKey)) + '</p></div>';
  }

  /* ---------- Worker 管理（含不可用降级：file:// 或 CSP 拦截时转主线程） ---------- */
  function spawnWorker() {
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    if (workerBroken) return;
    try {
      worker = new Worker('../assets/js/regex-worker.js');
    } catch (e) { workerBroken = true; worker = null; return; }
    worker.onmessage = function (e) {
      var d = e.data;
      if (!d || d.type !== 'result') return;
      clearTimeout(workerTimer);
      onResult(d.result, d.reqId);
    };
    worker.onerror = function () {
      /* Worker 异常：标记降级 + 终止，后续匹配改在主线程完成，功能不中断 */
      clearTimeout(workerTimer);
      workerBroken = true;
      try { worker.terminate(); } catch (e) {}
      worker = null;
      showError({ pos: null, message: tr('rx_err_worker') });
    };
  }

  /* ---------- 主线程降级匹配（与 regex-worker.js 同契约，零依赖） ---------- */
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
    var at = pos != null ? tr('rx_err_pos', { p: pos }) : '';
    /* ⚠️ 本表必须与 assets/js/regex-worker.js 的同名 MAP 逐条保持一致：
       前者是 Worker 路径、后者是主线程降级路径，改一处必须同步改另一处，
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
    return { pos: pos, message: (hit ? hit.msg : tr('rx_err_invalid') + '：' + msg) + at, raw: msg };
  }
  function runSync(pattern, flags, text) {
    var t0 = now(), re;
    try { re = new RegExp(pattern, flagsStr(flags)); }
    catch (err) { return { ok: false, error: locateReError(pattern, err), timeout: false }; }
    var matches = [], m, guard = 0;
    try {
      if (re.global || re.sticky) {
        while ((m = re.exec(text)) !== null) {
          matches.push(pack(m, text));
          if (m.index === re.lastIndex) re.lastIndex++;   // 防零宽死循环
          if (++guard > GUARD) break;                     // 安全上限
        }
      } else {
        m = re.exec(text);
        if (m) matches.push(pack(m, text));
      }
    } catch (err) {
      return { ok: false, error: { pos: null, message: tr('rx_err_invalid') + '：' + (err && err.message || err) }, timeout: false };
    }
    return { ok: true, matches: matches, count: matches.length, ms: Math.max(0, now() - t0), timeout: false };
  }

  /* ---------- 大文本提示（≥500KB） ---------- */
  function showBigWarn() {
    if (!bigWarnEl) return;
    var n = byteLen(textEl.value);
    if (n < BIG) { bigWarnEl.hidden = true; return; }
    bigWarnEl.hidden = false;
    var p = bigWarnEl.querySelector('p');
    if (p) p.textContent = tr('rx_big_warn', { size: fmtSize(n) });
    if (window.refreshIcons) window.refreshIcons();
  }
  function hideBigWarn() { if (bigWarnEl) bigWarnEl.hidden = true; }

  /* ---------- 主流程 ---------- */
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 200);   // 防抖 200ms
  }

  function run() {
    var pattern = patternEl.value, text = textEl.value;
    /* 6.7 正则为空：提示"请输入正则"，结果区空态，不标红 */
    if (!pattern) { clearError(); hideBigWarn(); renderNoPattern(); setZero(); return; }
    var myId = ++reqId;
    showBigWarn();
    var flags = flagsObj();
    if (workerBroken || !worker) { spawnWorker(); }
    if (workerBroken || !worker) { onResult(runSync(pattern, flags, text), myId); return; }
    clearTimeout(workerTimer);
    /* 灾难正则保护：超时未响应则终止并重建 Worker，主线程提示 */
    workerTimer = setTimeout(function () {
      spawnWorker();
      showError({ pos: null, message: tr('rx_err_timeout') });
    }, TIMEOUT);
    try {
      worker.postMessage({ type: 'match', reqId: myId, pattern: pattern, flags: flags, text: text });
    } catch (e) {
      workerBroken = true; worker = null;
      onResult(runSync(pattern, flags, text), myId);
    }
  }

  function onResult(res, myId) {
    if (myId !== reqId) return;                        // 过期响应丢弃
    showBigWarn();   // 提示随文本体量常驻（匹配完成不代表文本变小）
    if (!res.ok) { clearError(); showError(res.error); renderEmptyResult(); return; }
    clearError();
    renderHL(textEl.value, res.matches);
    renderMatches(res.matches);
    setCount(tr('rx_matches', { n: res.count, ms: res.ms.toFixed(1) }));
  }

  function showError(err) {
    patternEl.classList.add('is-error');
    errEl.hidden = false;
    /* Worker 与主线程降级两条路径的 message 均已内联位置信息，此处不重复追加 */
    errEl.querySelector('span').textContent = (err && err.message) ? err.message : tr('rx_err_invalid');
  }
  function clearError() {
    patternEl.classList.remove('is-error');
    errEl.hidden = true;
    /* 同时清空文案：元素隐藏后若仍残留上一条错误消息，DOM 里读到的旧文案会
       误导排查（自动化断言读 textContent 时会误判"仍在报错"），故一并清掉 */
    var sp = errEl.querySelector('span');
    if (sp) sp.textContent = '';
  }

  /* 结果区单独清空（不改动高亮区），用于报错态 */
  function renderEmptyResult() { resultEl.innerHTML = ''; }

  /* 未输入正则：高亮区回默认空态 + 结果区引导空态 */
  function renderNoPattern() {
    hlEl.innerHTML = ''; hlEl.hidden = true; hlEmpty.hidden = false; headCopyBtn.hidden = true;
    resultEl.innerHTML = emptyState('search', 'rx_need_pattern', 'rx_need_pattern_desc', '20px');
    if (window.refreshIcons) window.refreshIcons();
  }
  function renderEmpty() { renderNoPattern(); }

  /* 高亮渲染：DOM 节点拼接，文本一律 textContent 写入（杜绝 XSS/破版）；
     index/end 为与 Worker 同源的 UTF-16 码元偏移，中英混排与代理对都不会截断；奇偶 match 交替两色 */
  function renderHL(text, matches) {
    hlEl.innerHTML = '';
    if (!text || !matches || !matches.length) {
      hlEl.hidden = true; hlEmpty.hidden = false; headCopyBtn.hidden = true; return;
    }
    hlEl.hidden = false; hlEmpty.hidden = true; headCopyBtn.hidden = false;
    var frag = document.createDocumentFragment();
    var cursor = 0;
    matches.forEach(function (mt, i) {
      if (mt.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, mt.index)));
      var span = document.createElement('span');
      span.className = 'rx-hl' + (i % 2 ? ' alt' : '');
      span.textContent = text.slice(mt.index, mt.end);
      frag.appendChild(span);
      cursor = mt.end;
    });
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    hlEl.appendChild(frag);
  }

  function renderMatches(matches) {
    resultEl.innerHTML = '';
    if (!matches.length) {
      resultEl.innerHTML = emptyState('search', 'rx_no_match', 'rx_no_match_desc', '20px');
      if (window.refreshIcons) window.refreshIcons();
      return;
    }
    var wrap = document.createElement('div'); wrap.className = 'table-wrap';
    var table = document.createElement('table'); table.className = 'table';
    table.innerHTML = '<thead><tr><th>#</th><th>' + esc(tr('rx_th_content')) + '</th><th>' +
      esc(tr('rx_th_pos')) + '</th><th>' + esc(tr('rx_th_groups')) + '</th></tr></thead>';
    var tbody = document.createElement('tbody');
    matches.forEach(function (mt, i) {
      var tr_ = document.createElement('tr');
      var grpHtml = '';
      (mt.groups || []).forEach(function (g) {
        if (g.name) grpHtml += '<span class="tag t-success">' + esc(g.name) + ' = ' + esc(g.value) + '</span> ';
        else grpHtml += '<span class="tag t-blue">$' + g.n + ' = ' + esc(g.value) + '</span> ';
      });
      /* 位置列：行/列 + 长度（卡片03 要求"起始位置/长度"） */
      var posTxt = tr('rx_pos_fmt', { line: mt.line, col: mt.col }) + ' · ' + tr('rx_len_fmt', { n: mt.end - mt.index });
      tr_.innerHTML = '<td>' + (i + 1) + '</td>' +
        '<td><code>' + esc(mt.content) + '</code></td>' +
        '<td>' + esc(posTxt) + '</td>' +
        '<td>' + grpHtml + '</td>';
      tbody.appendChild(tr_);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    resultEl.appendChild(wrap);
    if (window.refreshIcons) window.refreshIcons();
  }

  /* ---------- 复制（统一 toast + execCommand 降级） ---------- */
  function copyText(v, msgKey) {
    if (!v) return;
    function done() { if (window.toast) toast(tr(msgKey || 'rx_toast_copied'), 'success'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = v;
      ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(done, fallback);
    } else { fallback(); }
  }

  /* ---------- 事件 ---------- */
  patternEl.addEventListener('input', schedule);
  textEl.addEventListener('input', schedule);

  /* 第八章无障碍：Ctrl/⌘ + Enter 立即触发一次匹配（绕过防抖） */
  function hotkey(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.keyCode === 13)) {
      e.preventDefault(); clearTimeout(timer); run();
    }
  }
  patternEl.addEventListener('keydown', hotkey);
  textEl.addEventListener('keydown', hotkey);

  document.querySelectorAll('.flag-chip').forEach(function (c) {
    c.addEventListener('click', function () { c.classList.toggle('on'); savePrefs(); schedule(); });
  });

  $('#rxBtnSample').addEventListener('click', function () {
    patternEl.value = '(\\d{3})-(\\d{4})';
    textEl.value = '电话 138-0013 与 139-8866 均为北京号码，备用 010-1234 也可联系。';
    clearError();
    run();
  });
  $('#rxBtnClear').addEventListener('click', function () {
    patternEl.value = ''; textEl.value = '';
    clearError(); hideBigWarn(); renderNoPattern(); setZero();
  });

  copyBtn.addEventListener('click', function () { copyText(patternEl.value, 'rx_toast_copied'); });
  headCopyBtn.addEventListener('click', function () { copyText(hlEl.innerText, 'rx_toast_copied'); });

  /* ---------- 配置记忆：仅 flags 偏好（localStorage 不可用则静默跳过） ---------- */
  function savePrefs() {
    try { localStorage.setItem('mf-regex-prefs', JSON.stringify(flagsObj())); } catch (e) {}
  }
  (function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem('mf-regex-prefs') || 'null');
      if (p) {
        document.querySelectorAll('.flag-chip').forEach(function (c) {
          c.classList.toggle('on', !!p[c.dataset.flag]);
        });
      }
    } catch (e) {}
  })();

  /* 语言切换后立即重渲染（错误说明/计数/空态保持语言一致） */
  document.addEventListener('moteful:langchange', function () { clearTimeout(timer); run(); });

  spawnWorker();
  renderNoPattern();
  setZero();
})();
