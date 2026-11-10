/* ===== markdown-tool.js · Markdown 编辑器视图层（V2.1.2 P0） =====
   只做编排：绑定 textarea / 工具栏 / 快捷键 / 防抖 / 草稿 / 复制 / 下载 / 统计 / 分栏切换。
   解析与渲染一律走 MarkdownCore，提示与弹窗一律走 MF.*，不新建任何交互范式。 */
(function () {
  'use strict';

  var Core = window.MarkdownCore, WC = window.WordCounterCore;
  var DRAFT_KEY = 'mf-md-draft', CARET_KEY = 'mf-md-caret';
  var DEBOUNCE = 120, MAX_BYTES = 500 * 1024, COPIED_MS = 1500;

  function $(id) { return document.getElementById(id); }
  var input = $('mdInput'), preview = $('mdPreview'), body = $('mdBody'), empty = $('mdEmpty'),
    warn = $('mdWarn'), warnText = $('mdWarnText'),
    restore = $('mdRestore'), restoreYes = $('mdRestoreYes'), restoreNo = $('mdRestoreNo'),
    saveState = $('mdSaveState'),
    statChars = $('mdStatChars'), statWords = $('mdStatWords'), statParas = $('mdStatParas');

  function tr(key, vars) {
    if (window.t) { try { var s = window.t(key, vars); if (s != null && s !== key) return s; } catch (e) {} }
    return key;
  }
  function setI18n(el, key, vars) {
    if (!el) return;
    el.setAttribute('data-i18n', key);
    el.textContent = tr(key, vars);
  }
  function toast(msg, type) { if (window.toast) window.toast(msg, type); }
  /* ---------- 渲染 + 统计 + 提示（统计复用 WordCounterCore，与解析共用同一次回调） ---------- */
  var lastBlocks = null;
  function clearBody() { while (body.firstChild) body.removeChild(body.firstChild); }
  function setStats(chars, words, paras) {
    statChars.textContent = String(chars);
    statWords.textContent = String(words);
    statParas.textContent = String(paras);
  }
  function showWarn(r) {
    var unsafe = r.links.total - r.links.safe, parts = [];
    if (unsafe > 0) parts.push(tr('md_warn_links', { n: unsafe }));
    if (r.tablesDegraded > 0) parts.push(tr('md_warn_tables', { n: r.tablesDegraded }));
    if (!parts.length) { warn.hidden = true; return; }
    warnText.textContent = parts.join(' ');
    warn.hidden = false;
  }
  /* ---------- 预览外框：代码块 / 表格加「类型 + 复制 + 收起」头 ----------
     折叠走原生 details/summary，箭头复用 SEO 三卡的 .seo-summary-icon。
     外框只装饰预览 DOM；「复制 HTML」走 Core.renderHTML(lastBlocks)，天然不含外框。 */
  function readFolds() {
    return {
      code: [].map.call(body.querySelectorAll('details.md-code'), function (d) { return !d.open; }),
      table: [].map.call(body.querySelectorAll('details.md-table'), function (d) { return !d.open; })
    };
  }
  function tableToMarkdown(tb) {
    var trs = tb.querySelectorAll('tr');
    if (!trs.length) return '';
    var rows = [].map.call(trs, function (tr) {
      return [].map.call(tr.children, function (c) {
        return c.textContent.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
      });
    });
    var ths = tb.querySelectorAll('thead th'), n = rows[0].length, sep = '|', i;
    for (i = 0; i < n; i++) {
      var a = ths[i] ? ths[i].style.textAlign : '';
      sep += (a === 'center' ? ':---:' : a === 'right' ? '---:' : '---') + '|';
    }
    var line = function (r) { return '| ' + r.join(' | ') + ' |'; };
    var out = [line(rows[0]), sep];
    for (i = 1; i < rows.length; i++) out.push(line(rows[i]));
    return out.join('\n');
  }
  function blockHead(label, labelKey, onCopy) {
    var s = document.createElement('summary');
    s.className = 'md-block-head';
    var chev = document.createElement('i');
    chev.setAttribute('data-lucide', 'chevron-down');
    chev.className = 'seo-summary-icon';
    s.appendChild(chev);
    var lb = document.createElement('span');
    lb.className = 'md-block-label';
    if (labelKey) setI18n(lb, labelKey); else lb.textContent = label;
    s.appendChild(lb);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm md-block-copy';
    btn.title = tr('md_block_copy');
    btn.setAttribute('data-i18n-title', 'md_block_copy');
    var ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'copy');
    btn.appendChild(ic);
    var sp = document.createElement('span');
    sp.setAttribute('data-i18n', 'md_block_copy');
    sp.textContent = tr('md_block_copy');
    btn.appendChild(sp);
    /* summary 的默认动作就是折叠，复制按钮必须取消它，否则一点就收起 */
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onCopy(btn); });
    s.appendChild(btn);
    return s;
  }
  function fold(kind, node, head) {
    var d = document.createElement('details');
    d.className = 'md-block md-' + kind;
    d.open = true;
    d.appendChild(head);
    node.parentNode.insertBefore(d, node);
    d.appendChild(node);
    return d;
  }
  function decorate(memo) {
    var ci = 0, ti = 0;
    [].forEach.call(body.querySelectorAll('pre'), function (pre) {
      var code = pre.querySelector('code');
      if (!code) return;
      var m = (code.getAttribute('class') || '').match(/language-(\S+)/);
      var d = fold('code', pre, blockHead(m ? m[1] : null, m ? null : 'md_code_plain', function (btn) {
        copyText(code.textContent, btn, 'md_block_copy', true);
      }));
      if (memo.code[ci]) d.open = false;
      ci++;
    });
    [].forEach.call(body.querySelectorAll('table'), function (tb) {
      var d = fold('table', tb, blockHead(null, 'md_table_label', function (btn) {
        copyText(tableToMarkdown(tb), btn, 'md_block_copy', true);
      }));
      if (memo.table[ti]) d.open = false;
      ti++;
    });
    if (window.MF && window.MF.refreshIcons) window.MF.refreshIcons();
  }
  function render(text) {
    if (String(text).trim() === '') {
      lastBlocks = null;
      clearBody();
      setStats(0, 0, 0);
      warn.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    var r = Core.parse(text);
    lastBlocks = r.blocks;
    var frag = Core.render(r.blocks, document);
    var memo = readFolds();   // 逐键重渲染时保住用户手动收起的那几块
    clearBody();
    body.appendChild(frag);
    decorate(memo);
    var a = WC.analyzeText(text, {});
    setStats(a.cAll, a.cZh + a.wEn, a.paragraphs);
    showWarn(r);
  }
  /* ---------- 草稿：只存纯文本；超容量 / 隐私模式明示「无法保存」，不假装已保存 ---------- */
  var saveKey = 'md_save_idle';
  function setSave(key, vars) { saveKey = key; setI18n(saveState, key, vars); }
  function byteLength(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) n += 1;
      else if (c < 2048) n += 2;
      else if (c >= 0xD800 && c < 0xDC00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function dropDraft() {
    try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(CARET_KEY); } catch (e) {}
  }
  function saveDraft(text) {
    if (text === '') { dropDraft(); setSave('md_save_idle'); return; }
    if (byteLength(text) > MAX_BYTES) { setSave('md_save_toobig'); return; }
    try {
      localStorage.setItem(DRAFT_KEY, text);
      try { localStorage.setItem(CARET_KEY, String(input.selectionStart)); } catch (e) {}
      setSave('md_save_saved');
    } catch (e) { setSave('md_save_fail'); }
  }
  var timer = null;
  function refresh(immediate) {
    if (!immediate) setSave('md_save_writing');
    clearTimeout(timer);
    timer = setTimeout(function () { render(input.value); saveDraft(input.value); }, immediate ? 0 : DEBOUNCE);
  }
  function onInput() {
    if (groupPrev === null) groupPrev = lastValue;
    lastValue = input.value;
    clearTimeout(groupTimer);
    groupTimer = setTimeout(commitGroup, HIST_GROUP);
    refresh(false);
  }
  /* ---------- 历史快照：撤销栈存「变更前」文本；连续输入合组，工具栏/插入一步一存 ---------- */
  var HIST_LIMIT = 50, HIST_GROUP = 600;
  var undoStack = [], redoStack = [], lastValue = input.value, baseText = input.value;
  var groupPrev = null, groupTimer = null;
  function syncHistBtns() {
    var u = $('mdUndo'), r = $('mdRedo'), b = $('mdReset');
    if (u) u.disabled = undoStack.length === 0;
    if (r) r.disabled = redoStack.length === 0;
    if (b) b.disabled = false;
  }
  function commitGroup() {
    if (groupPrev === null) return;
    clearTimeout(groupTimer); groupTimer = null;
    var pre = groupPrev; groupPrev = null;
    if (pre !== lastValue) {
      undoStack.push(pre);
      if (undoStack.length > HIST_LIMIT) undoStack.shift();
      redoStack = [];
    }
    syncHistBtns();
  }
  function write(t) {
    commitGroup();
    input.value = t; lastValue = t;
    render(t); saveDraft(t);
    input.focus();
    try { input.setSelectionRange(t.length, t.length); } catch (e) {}
    syncHistBtns();
  }
  function doUndo() {
    commitGroup();
    if (!undoStack.length) { toast(tr('md_hist_no_more'), 'info'); return; }
    redoStack.push(input.value);
    write(undoStack.pop());
  }
  function doRedo() {
    commitGroup();
    if (!redoStack.length) { toast(tr('md_hist_no_more_redo'), 'info'); return; }
    undoStack.push(input.value);
    if (undoStack.length > HIST_LIMIT) undoStack.shift();
    write(redoStack.pop());
  }
  function doReset() {
    commitGroup();
    write(baseText);
    undoStack = []; redoStack = [];
    syncHistBtns();
    toast(tr('md_hist_reset_toast'), 'success');
  }
  /* ---------- 插入语法：保留选区，操作完把焦点还给编辑器 ---------- */
  function bounds() {
    var v = input.value, s = input.selectionStart, e = input.selectionEnd;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var le = v.indexOf('\n', e);
    return [v, s, e, ls, le === -1 ? v.length : le];
  }
  function replaceRange(start, end, text, selStart, selEnd) {
    commitGroup();
    var v = input.value;
    input.value = v.slice(0, start) + text + v.slice(end);
    input.focus();
    if (selStart != null) input.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
    onInput();
    commitGroup();
  }
  function wrap(mark, phKey) {
    var t = bounds(), s = t[1], e = t[2];
    var sel = input.value.slice(s, e), inner = sel || tr(phKey);
    replaceRange(s, e, mark + inner + mark, s + mark.length, s + mark.length + inner.length);
  }
  function lineEach(fn) {
    var t = bounds(), v = t[0], ls = t[3], le = t[4];
    var lines = v.slice(ls, le).split('\n');
    var out = lines.map(fn).join('\n');
    replaceRange(ls, le, out, ls, ls + out.length);
  }
  function cycleHeading(line) {
    var m = line.match(/^(#{1,6})\s+/);
    var lvl = m ? (m[1].length % 3) + 1 : 1;
    return '#######'.slice(0, lvl) + ' ' + line.replace(/^#{1,6}\s*/, '');
  }
  function insertLink() {
    var t = bounds(), s = t[1], e = t[2];
    var label = input.value.slice(s, e) || tr('md_ph_link');
    var url = 'https://';
    var text = '[' + label + '](' + url + ')';
    var us = s + label.length + 3;
    replaceRange(s, e, text, us, us + url.length);   // 光标停在 url 上
  }
  function insertImage() {
    var t = bounds(), s = t[1], e = t[2];
    var alt = input.value.slice(s, e) || tr('md_ph_image');
    var url = 'https://';
    var text = '![' + alt + '](' + url + ')';
    var us = s + alt.length + 4;
    replaceRange(s, e, text, us, us + url.length);   // 光标停在 url 上
  }
  function insertAbove(text) {
    var t = bounds(), v = t[0], s = t[1], ls = t[3], le = t[4];
    var cur = v.slice(ls, le);
    var lead = (ls === 0 || v.slice(0, ls).search(/\S/) === -1) ? '' : '\n';
    var ins = lead + text;
    replaceRange(ls, le, cur === '' ? ins : ins + '\n' + cur, ls + ins.length, ls + ins.length);
  }
  /* ---------- Tab / Shift+Tab：只在列表与引用行内增减缩进，其余保留默认焦点行为 ---------- */
  function isIndentable(line) { return /^(\s*)([-*+]|\d+\.)\s/.test(line) || /^\s*>/.test(line); }
  function indentLines(out) {
    lineEach(function (line) { return out ? line.replace(/^ {1,2}/, '') : (isIndentable(line) || line === '' ? '  ' + line : line); });
  }
  /* ---------- 复制：clipboard → execCommand → 明确失败提示（不假装已复制） ---------- */
  function flashCopied(btn, key) {
    if (!btn) return;
    var span = btn.querySelector('span');
    if (!span) return;
    span.textContent = tr('md_copied');
    setTimeout(function () { setI18n(span, key); }, COPIED_MS);
  }
  function afterCopy(btn, key, noRec) {
    toast(tr('md_copied'), 'success');
    flashCopied(btn, key);
    /* 预览区逐块复制不弹推荐窗：那是导出级动作，连点会刷屏 */
    if (!noRec && window.Moteful && window.Moteful.recommend) {
      try { window.Moteful.recommend.show({ actionKey: 'rec_copy' }); } catch (e) {}
    }
  }
  function copyText(v, btn, key, noRec) {
    if (!v || String(v).trim() === '') { toast(tr('md_copy_empty'), 'warning'); return; }
    function done() { afterCopy(btn, key, noRec); }
    function fail() { toast(tr('md_copy_fail'), 'warning'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = v; ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, fallback);
    else fallback();
  }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function download() {
    var text = input.value;
    if (String(text).trim() === '') { toast(tr('md_copy_empty'), 'warning'); return; }
    var a = document.createElement('a');
    var url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.href = url;
    a.download = 'moteful-markdown-' + today() + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast(tr('md_downloaded'), 'success');
  }
  /* ---------- 列表 / 引用前缀（重复点击不叠加） ---------- */
  function lead(line) { return line.match(/^\s*/)[0]; }
  function bare(line) { return line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/^\s*>\s?/, '').replace(/^#{1,6}\s+/, ''); }
  function toUl(line) { return lead(line) + '- ' + bare(line); }
  function toOl(line, idx) { return lead(line) + (idx + 1) + '. ' + bare(line); }
  function toQuote(line) { return lead(line) + '> ' + bare(line); }
  var TABLE_TEXT = '| A | B | C |\n|---|---|---|\n| a | b | c |';
  /* ---------- 对齐前缀 {left|center|right|justify}：同一种再点一次即取消 ---------- */
  var RE_ALIGN = /^(\s*)\{(left|center|right|justify)\}\s*/;
  function toAlign(line, mode) {
    var m = line.match(RE_ALIGN), body = m ? m[1] + line.slice(m[0].length) : line;
    if (m && m[2] === mode) return body;
    /* 空行也给出可见结果，与「- 」「> 」等前缀按钮一致，不做静默无操作 */
    return '{' + mode + '} ' + (body.trim() === '' ? tr('md_ph_align') : body);
  }
  /* 代码块内会把标记当代码正文，表格行会打断分隔行导致整表降级——这两处一律不落标记 */
  function alignBlocked(lines, idx) {
    var fence = null;
    for (var i = 0; i < idx; i++) {
      var m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (!m) continue;
      if (fence && m[1][0] === fence.charAt(0) && m[1].length >= fence.length && m[2].trim() === '') fence = null;
      else if (!fence) fence = m[1];
    }
    if (fence) return true;
    var t = (lines[idx] || '').trim(), nx = (lines[idx + 1] || '').trim();
    var sep = function (s) { return s.indexOf('|') !== -1 && /^[:\-\s|]+$/.test(s); };
    return t.charAt(0) === '|' || sep(t) || (t.indexOf('|') !== -1 && sep(nx));
  }
  function alignAction(mode) {
    var t = bounds(), all = t[0].split('\n');
    var first = t[0].slice(0, t[3]).split('\n').length - 1;
    var count = t[0].slice(t[3], t[4]).split('\n').length, hit = 0;
    for (var k = 0; k < count; k++) if (alignBlocked(all, first + k)) hit++;
    if (hit === count) { toast(tr('md_align_blocked'), 'info'); return; }
    lineEach(function (l, k) { return alignBlocked(all, first + k) ? l : toAlign(l, mode); });
  }

  /* 整段写入（示例 / 清空）：先把「变更前」记一步，再落文本 */
  function pushStep(pre) {
    if (pre === input.value) return;
    undoStack.push(pre);
    if (undoStack.length > HIST_LIMIT) undoStack.shift();
    redoStack = [];
  }
  function setText(t) { write(t); }

  /* ---------- 绑定 ---------- */
  input.addEventListener('input', onInput);
  var actions = {
    mdTbBold: function () { wrap('**', 'md_ph_strong'); },
    mdTbItalic: function () { wrap('*', 'md_ph_em'); },
    mdTbUnderline: function () { wrap('++', 'md_ph_underline'); },
    mdTbStrike: function () { wrap('~~', 'md_ph_del'); },
    mdTbHeading: function () { lineEach(cycleHeading); },
    mdTbUl: function () { lineEach(toUl); },
    mdTbOl: function () { lineEach(toOl); },
    mdTbQuote: function () { lineEach(toQuote); },
    mdTbCode: function () { wrap('`', 'md_ph_code'); },
    mdTbTable: function () { insertAbove(TABLE_TEXT); },
    mdTbLink: insertLink,
    mdTbImage: insertImage,
    mdTbAlignLeft: function () { alignAction('left'); },
    mdTbAlignCenter: function () { alignAction('center'); },
    mdTbAlignRight: function () { alignAction('right'); },
    mdTbAlignJustify: function () { alignAction('justify'); },
    mdTbHr: function () { insertAbove('---'); }
  };
  Object.keys(actions).forEach(function (id) {
    var b = $(id);
    if (b) b.addEventListener('click', actions[id]);
  });
  $('mdUndo').addEventListener('click', doUndo);
  $('mdRedo').addEventListener('click', doRedo);
  $('mdReset').addEventListener('click', doReset);
  syncHistBtns();
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var t = bounds(), lines = t[0].slice(t[3], t[4]).split('\n');
      if (!lines.some(isIndentable)) return;   // 非列表行不拦截，Tab 继续走「工具栏→编辑→操作行」
      e.preventDefault();
      indentLines(e.shiftKey);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var k = (e.key || '').toLowerCase();
      if (k === 'b') { e.preventDefault(); actions.mdTbBold(); }
      else if (k === 'i') { e.preventDefault(); actions.mdTbItalic(); }
      else if (k === 'k') { e.preventDefault(); actions.mdTbLink(); }
    }
  });
  $('mdCopyMd').addEventListener('click', function () { copyText(input.value, this, 'md_copy_md'); });
  $('mdCopyHtml').addEventListener('click', function () {
    copyText(lastBlocks ? Core.renderHTML(lastBlocks, document) : '', this, 'md_copy_html');
  });
  $('mdDownload').addEventListener('click', download);
  $('mdSample').addEventListener('click', function () { pushStep(input.value); setText(tr('md_sample_text')); baseText = input.value; });
  $('mdClear').addEventListener('click', function () {
    if (window.MF && window.MF.openModal) window.MF.openModal('mdClearModal');
    else if (window.openModal) window.openModal('mdClearModal');
  });
  $('mdClearConfirm').addEventListener('click', function () {
    pushStep(input.value);
    setText('');
    var m = $('mdClearModal'), closer = m && m.querySelector('[data-close]');
    if (closer) closer.click(); else if (m) m.classList.remove('open');
    toast(tr('md_cleared'), 'success');
  });
  /* ---------- 分栏切换：保住两栏各自的滚动位置（F-01 接受标准） ---------- */
  var scrollMemo = { edit: 0, preview: 0 };
  input.addEventListener('scroll', function () { scrollMemo.edit = input.scrollTop; });
  preview.addEventListener('scroll', function () { scrollMemo.preview = preview.scrollTop; });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mdView"]'), function (r) {
    r.addEventListener('change', function () {
      setTimeout(function () {
        if (r.value === 'preview') preview.scrollTop = scrollMemo.preview;
        else input.scrollTop = scrollMemo.edit;
      }, 0);
    });
  });

  /* ---------- 草稿恢复条：不自动填，用户确认后才还原内容与光标 ---------- */
  var pendingDraft = null;
  try { pendingDraft = localStorage.getItem(DRAFT_KEY); } catch (e) {}
  restoreYes.addEventListener('click', function () {
    var pos = 0;
    try { pos = parseInt(localStorage.getItem(CARET_KEY) || '0', 10) || 0; } catch (e) {}
    input.value = pendingDraft || '';
    restore.hidden = true;
    render(input.value);
    saveDraft(input.value);
    input.focus();
    try { input.setSelectionRange(pos, pos); } catch (e) {}
    /* 草稿恢复算「载入」：以此为还原基线，之前的历史清空 */
    groupPrev = null; lastValue = baseText = input.value;
    undoStack = []; redoStack = []; syncHistBtns();
    toast(tr('md_draft_restored'), 'success');
  });
  restoreNo.addEventListener('click', function () {
    dropDraft();
    pendingDraft = null;
    restore.hidden = true;
    setSave('md_save_idle');
    toast(tr('md_draft_ignored'), 'info');
  });

  /* ---------- 换语言：只重算动态文案，不重跑解析以外的开销 ---------- */
  document.addEventListener('moteful:langchange', function () {
    render(input.value);
    setSave(saveKey);
  });

  /* ---------- 启动（defer 脚本，DOM 已就绪） ---------- */
  if (pendingDraft != null && pendingDraft !== '') restore.hidden = false;
  render(input.value);
})();
