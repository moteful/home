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
    splitEl = document.querySelector('.md-split'),
    warn = $('mdWarn'), warnText = $('mdWarnText'),
    restore = $('mdRestore'), restoreYes = $('mdRestoreYes'), restoreNo = $('mdRestoreNo'),
    saveState = $('mdSaveState'),
    tocWrap = $('mdTocWrap'), tocPanel = $('mdTocPanel'), tocBtn = $('mdTocBtn'),
    importFile = $('mdImportFile'),
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
  var lastBlocks = null, lastHeadings = null;
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
      lastBlocks = null; lastHeadings = null;
      clearBody();
      renderToc([]);
      setStats(0, 0, 0);
      warn.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    var r = Core.parse(text);
    lastBlocks = r.blocks;
    lastHeadings = r.headings;
    var frag = Core.render(r.blocks, document);
    var memo = readFolds();   // 逐键重渲染时保住用户手动收起的那几块
    clearBody();
    body.appendChild(frag);
    decorate(memo);
    renderToc(r.headings);
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
    if (!noRec) recommend('rec_copy');
  }
  function recommend(key) {
    if (window.Moteful && window.Moteful.recommend) {
      try { window.Moteful.recommend.show({ actionKey: key }); } catch (e) {}
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
    recommend('rec_download');
  }
  /* ---------- P1 导入：点击选择 + 全页拖入（只认 .md / .markdown / .txt，上限 1 MB） ---------- */
  var IMPORT_MAX = 1024 * 1024, TEXT_EXT = /\.(md|markdown|txt)$/i;
  function importFiles(files) {
    var f = files && files[0];
    if (!f) return;
    if (!TEXT_EXT.test(f.name || '')) { toast(tr('md_import_type'), 'warning'); return; }
    if (f.size > IMPORT_MAX) { toast(tr('md_import_size'), 'warning'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result == null ? '' : reader.result);
      pushStep(input.value);
      setText(text);
      baseText = input.value;
      toast(tr('md_import_ok', { name: f.name }), 'success');
    };
    reader.onerror = function () { toast(tr('md_import_fail'), 'warning'); };
    reader.readAsText(f, 'utf-8');
  }
  function dropFeedback(on) { input.classList.toggle('md-dragover', !!on); }

  /* ---------- P1 目录：标题 id 由内核生成，点击滚到预览中的位置 ---------- */
  function renderToc(list) {
    tocPanel.textContent = '';
    if (!list || !list.length) { tocWrap.hidden = true; return; }
    tocWrap.hidden = false;
    list.forEach(function (h, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item md-toc-item md-toc-l' + h.level;
      b.title = h.text;
      var sp = document.createElement('span');
      sp.className = 'md-toc-text';
      sp.textContent = (i + 1) + '. ' + h.text;
      b.appendChild(sp);
      b.addEventListener('click', function () { jumpToHeading(h.id); });
      tocPanel.appendChild(b);
    });
  }
  function closeTocPop() {
    var p = tocBtn.closest('.pop');
    if (p) p.classList.remove('open');
  }
  function jumpToHeading(id) {
    closeTocPop();
    if (window.matchMedia && window.matchMedia('(max-width:768px)').matches) {
      var r = document.querySelector('input[name="mdView"][value="preview"]');
      if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    setTimeout(function () {
      var el = document.getElementById(id);
      if (!el || !preview.clientHeight) return;
      var top = el.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop - 8;
      preview.scrollTop = Math.max(0, top);
      el.classList.add('md-flash');
      setTimeout(function () { el.classList.remove('md-flash'); }, 1300);
    }, 30);
  }

  /* ---------- P1 导出独立 HTML：单文件自带样式，不引用站内资源 ---------- */
  var EXPORT_CSS = [
    ':root{color-scheme:light dark}',
    'body{margin:0;padding:32px 16px;background:#f4f7fb;color:#0f172a;font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif}',
    '.doc{max-width:760px;margin:0 auto;padding:32px 36px;background:#fff;border:1px solid #e2e8f0;border-radius:12px}',
    '.doc>:first-child{margin-top:0}',
    '.doc h1{font-size:28px;line-height:1.35;margin:0 0 16px}',
    '.doc h2{font-size:22px;margin:28px 0 12px}',
    '.doc h3{font-size:18px;margin:24px 0 10px}',
    '.doc h4,.doc h5,.doc h6{font-size:15px;margin:20px 0 8px}',
    '.doc p,.doc ul,.doc ol,.doc blockquote,.doc pre,.doc table{margin:0 0 14px}',
    '.doc a{color:#0284c7}',
    '.doc blockquote{margin-left:0;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f1f5f9;color:#475569}',
    '.doc code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;padding:1px 5px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px}',
    '.doc pre{padding:14px;background:#0f172a;color:#e2e8f0;border-radius:8px;overflow:auto}',
    '.doc pre code{padding:0;border:0;background:none;color:inherit;white-space:pre}',
    '.doc table{border-collapse:collapse;width:100%}',
    '.doc th,.doc td{border:1px solid #e2e8f0;padding:7px 10px;text-align:left}',
    '.doc th{background:#f1f5f9}',
    '.doc hr{border:0;border-top:1px solid #e2e8f0;margin:20px 0}',
    '.doc img{max-width:100%;height:auto}',
    '.doc .tok-com{color:#94a3b8;font-style:italic}',
    '.doc .tok-kw{color:#7dd3fc;font-weight:600}',
    '.doc .tok-str{color:#86efac}',
    '.doc .tok-num{color:#fcd34d}',
    '.doc .tok-tag{color:#fca5a5}',
    '.doc .tok-attr{color:#c4b5fd}',
    '.doc .tok-var{color:#a5b4fc}',
    '@media (prefers-color-scheme:dark){body{background:#0b1220;color:#e2e8f0}.doc{background:#0f172a;border-color:#1e293b}.doc blockquote{background:#131e33;border-color:#334155;color:#94a3b8}.doc code{background:#131e33;border-color:#1e293b}.doc th,.doc td{border-color:#1e293b}.doc th{background:#131e33}.doc pre{background:#020617}}',
    '@media (max-width:600px){body{padding:0}.doc{border:0;border-radius:0;padding:20px 16px}}'
  ].join('\n');
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function saveBlob(text, mime, name) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportHtml() {
    if (!lastBlocks) { toast(tr('md_copy_empty'), 'warning'); return; }
    var title = lastHeadings && lastHeadings[0] ? lastHeadings[0].text : tr('md_export_title');
    var lang = document.documentElement.lang || 'en';
    var html = '<!DOCTYPE html>\n<html lang="' + escHtml(lang) + '">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + escHtml(title) + '</title>\n' +
      '<style>\n' + EXPORT_CSS + '\n</style>\n</head>\n<body>\n<article class="doc">\n' +
      Core.renderHTML(lastBlocks, document) + '\n</article>\n</body>\n</html>\n';
    saveBlob(html, 'text/html;charset=utf-8', 'moteful-markdown-' + today() + '.html');
    toast(tr('md_export_ok'), 'success');
    recommend('rec_export');
  }

  /* ---------- P1 复制富文本：ClipboardItem 双 MIME，失败降级为复制 HTML 源码 ---------- */
  function execCopyText(v) {
    var ta = document.createElement('textarea');
    ta.value = v; ta.style.position = 'fixed'; ta.style.top = '-1000px';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copyRich(btn) {
    if (!lastBlocks) { toast(tr('md_copy_empty'), 'warning'); return; }
    var html = Core.renderHTML(lastBlocks, document);
    var plain = input.value;
    function ok() { toast(tr('md_rich_ok'), 'success'); flashCopied(btn, 'md_copy_rich'); recommend('rec_copy'); }
    function fallback() {
      if (execCopyText(html)) { toast(tr('md_rich_fail'), 'info'); flashCopied(btn, 'md_copy_rich'); recommend('rec_copy'); }
      else toast(tr('md_copy_fail'), 'warning');
    }
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      try {
        var item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(ok, fallback);
        return;
      } catch (e) {}
    }
    fallback();
  }

  /* ---------- P1 滚动同步：块级行号 → 文本镜像测高 → 预览跟随（偏差 ≤ 1 块） ---------- */
  var mirror = null, marks = [], mirrorText = null, topCache = null;
  var lineCache = null, lineCacheText = null, syncRaf = 0;
  function lineOffsets(text) {
    if (lineCacheText === text) return lineCache;
    var arr = [0];
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) arr.push(i + 1);
    lineCacheText = text; lineCache = arr;
    return arr;
  }
  function buildMirror() {
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.className = 'md-mirror';
      mirror.setAttribute('aria-hidden', 'true');
      splitEl.appendChild(mirror);
    }
    var cs = window.getComputedStyle(input);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    mirror.style.width = Math.max(0, input.clientWidth - padX) + 'px';
    mirror.style.font = cs.font || (cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily);
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.wordBreak = cs.wordBreak;
    mirror.textContent = '';
    marks = [];
    var text = input.value, offs = lineOffsets(text), prev = 0;
    (lastBlocks || []).forEach(function (b) {
      var off = offs[Math.min(b.line || 0, offs.length - 1)] || 0;
      if (off < prev) off = prev;
      if (off > text.length) off = text.length;
      mirror.appendChild(document.createTextNode(text.slice(prev, off)));
      var m = document.createElement('span');
      m.className = 'md-m';
      m.appendChild(document.createTextNode('\u200b'));
      mirror.appendChild(m);
      marks.push(m);
      prev = off;
    });
    mirror.appendChild(document.createTextNode(text.slice(prev) + '\n'));
  }
  function blockTops() {
    var text = input.value;
    if (mirrorText === text && topCache) return topCache;
    buildMirror();
    mirrorText = text;
    var box = mirror.getBoundingClientRect();
    topCache = marks.map(function (m) { return Math.max(0, m.getBoundingClientRect().top - box.top); });
    return topCache;
  }
  function nearestBlock(tops, y) {
    var lo = 0, hi = tops.length - 1, ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (tops[mid] <= y + 2) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  function syncFromEditor() {
    if (!lastBlocks || !lastBlocks.length) return;
    if (!preview.clientHeight || preview.offsetParent === null) return;
    if (input.scrollTop + input.clientHeight >= input.scrollHeight - 2) { preview.scrollTop = preview.scrollHeight; return; }
    var idx = nearestBlock(blockTops(), input.scrollTop);
    var el = body.children[idx];
    if (!el) return;
    var top = el.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop - 8;
    preview.scrollTop = Math.max(0, top);
  }
  window.addEventListener('resize', function () { mirrorText = null; topCache = null; });

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
  $('mdExportHtml').addEventListener('click', exportHtml);
  $('mdCopyRich').addEventListener('click', function () { copyRich(this); });
  $('mdImport').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', function () {
    if (this.files && this.files.length) importFiles(this.files);
    this.value = '';
  });
  /* 拖入 .md / .txt：浏览器默认会把文件直接导航打开、页面状态全丢，必须整页接管 */
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropFeedback(true);
  });
  document.addEventListener('dragleave', function (e) {
    if (e.relatedTarget === null) dropFeedback(false);
  });
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); dropFeedback(false); importFiles(e.dataTransfer.files);
  });
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
  input.addEventListener('scroll', function () {
    scrollMemo.edit = input.scrollTop;
    if (syncRaf) return;
    syncRaf = window.requestAnimationFrame(function () { syncRaf = 0; syncFromEditor(); });
  });
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
