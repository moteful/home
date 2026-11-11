/* ===== base64-tool.js · Base64 编解码视图层（V2.1.5 P0） =====
   只做编排：方向 / 折行 / 开关读写、120ms 防抖、状态机 S0–S5、复制 / 互换 / 清空 / 示例、统计与提示。
   编解码一律走 MFBase64；提示与弹窗一律走 MF.*；输出只经 textarea.value 落地，永不 innerHTML。
   隐私：正文零持久化，只写选项偏好键 moteful.b64.config；无 fetch / XHR / beacon。 */
(function () {
  'use strict';

  var Core = window.MFBase64, MF = window.MF || {};
  var CFG_KEY = 'moteful.b64.config';
  var DEBOUNCE = 120, SOFT_LIMIT = 256 * 1024, DISPLAY_LIMIT = 200 * 1024, TRUNC_TO = 50 * 1024, COPIED_MS = 1500;

  function $(id) { return document.getElementById(id); }
  var input = $('b64Input'), output = $('b64Output'), empty = $('b64Empty'), outTitle = $('b64OutTitle'),
    statsPanel = $('b64StatsPanel'),
    statChars = $('b64StatChars'), statBytes = $('b64StatBytes'), statOut = $('b64StatOut'), statRatio = $('b64StatRatio'),
    note = $('b64Note'), noteText = $('b64NoteText'), error = $('b64Error'), errorText = $('b64ErrorText'),
    warn = $('b64Warn'), run = $('b64Run'),
    sampleBtn = $('b64Sample'), clearBtn = $('b64Clear'), copyBtn = $('b64Copy'), swapBtn = $('b64Swap'),
    urlSafeEl = $('b64UrlSafe'), padEl = $('b64Pad'),
    clearModal = $('b64ClearModal'), clearConfirm = $('b64ClearConfirm');

  function tr(key, vars) {
    if (window.t) { try { var s = window.t(key, vars); if (s != null && s !== key) return s; } catch (e) {} }
    return key;
  }
  function setI18n(el, key) { if (!el) return; el.setAttribute('data-i18n', key); el.textContent = tr(key); }
  function toast(msg, type) { if (window.toast) window.toast(msg, type); }

  var opts = { mode: 'auto', wrap: 0, urlSafe: false, pad: true };
  var timer = null, copyTimer = null;
  var last = { kind: 'empty', action: 'encode', display: '', full: '', stats: null, noteKey: null, errKey: null, errVars: null };

  /* ---------- 选项偏好：只读写 moteful.b64.config，正文不入任何存储 ---------- */
  function readConfig() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (!c) return;
      if (c.mode === 'auto' || c.mode === 'encode' || c.mode === 'decode') opts.mode = c.mode;
      if (c.wrap === 0 || c.wrap === 76 || c.wrap === 64) opts.wrap = c.wrap;
      if (typeof c.urlSafe === 'boolean') opts.urlSafe = c.urlSafe;
      if (typeof c.pad === 'boolean') opts.pad = c.pad;
    } catch (e) {}
  }
  function saveConfig() { try { localStorage.setItem(CFG_KEY, JSON.stringify(opts)); } catch (e) {} }
  function applyOptsToUI() {
    var m = document.querySelector('input[name="b64Mode"][value="' + opts.mode + '"]'); if (m) m.checked = true;
    var w = document.querySelector('input[name="b64Wrap"][value="' + opts.wrap + '"]'); if (w) w.checked = true;
    urlSafeEl.checked = opts.urlSafe; padEl.checked = opts.pad;
  }
  function readOptsFromUI() {
    var m = document.querySelector('input[name="b64Mode"]:checked'); opts.mode = m ? m.value : 'auto';
    var w = document.querySelector('input[name="b64Wrap"]:checked'); opts.wrap = w ? parseInt(w.value, 10) : 0;
    opts.urlSafe = urlSafeEl.checked; opts.pad = padEl.checked;
  }

  /* ---------- 统计与提示渲染（动态文案随语言重绘） ---------- */
  function fmtRatio(r) { var p = Math.round((r - 1) * 100); return (p > 0 ? '+' : '') + p + '%'; }
  function setStats(s) {
    statChars.textContent = s && s.chars != null ? String(s.chars) : '—';
    statBytes.textContent = s && s.bytes != null ? String(s.bytes) : '—';
    statOut.textContent = s && s.out != null ? String(s.out) : '—';
    statRatio.textContent = s && s.ratio != null ? fmtRatio(s.ratio) : '—';
  }
  function paint() {
    var k = last.kind;
    empty.hidden = k !== 'empty';
    output.hidden = k !== 'ok';
    statsPanel.hidden = k === 'empty';
    output.value = k === 'ok' ? last.display : '';
    setStats(k === 'empty' ? null : last.stats);
    /* 错误（红）与说明（蓝）互斥落位，状态迁移后不残留上一条 */
    var showErr = k === 'error' && last.errKey;
    error.hidden = !showErr;
    if (showErr) errorText.textContent = tr(last.errKey, last.errVars);
    var nk = k === 'empty' ? null : last.noteKey;
    note.hidden = !nk;
    if (nk) noteText.textContent = tr(nk);
    setI18n(outTitle, (k === 'ok' && last.action === 'decode') || k === 'error' ? 'b64_output_dec' : 'b64_output_enc');
    var can = k === 'ok' && !!last.full;
    copyBtn.disabled = !can; swapBtn.disabled = !can;
  }

  /* ---------- 状态构造 ---------- */
  function setEmpty() {
    last = { kind: 'empty', action: 'encode', display: '', full: '', stats: null, noteKey: null, errKey: null, errVars: null };
    paint();
  }
  function finishOk(action, full, stats, noteKey) {
    var trunc = full.length > DISPLAY_LIMIT;   // S5：超 200KB 只显示前 50KB，复制取内存全量
    last = {
      kind: 'ok', action: action, full: full, display: trunc ? full.slice(0, TRUNC_TO) : full,
      stats: stats, noteKey: trunc ? 'b64_note_trunc' : noteKey, errKey: null, errVars: null
    };
    paint();
  }
  function failDecode(m, errKey, errVars, noteKey) {
    last = {
      kind: 'error', action: 'decode', display: '', full: '',
      stats: { chars: m.chars, bytes: m.bytes, out: null, ratio: null },
      noteKey: noteKey || null, errKey: errKey || null, errVars: errVars || null
    };
    paint();
  }
  function errKeyFor(code) {
    return code === 'char' ? 'b64_err_char' : code === 'len' ? 'b64_err_len' : code === 'pad' ? 'b64_err_pad' : 'b64_err_binary';
  }

  /* ---------- 核心：方向判定 → 编 / 解码 → 统计（输入侧统计尽量复用内核返回值，不二次扫描） ---------- */
  function compute() {
    var raw = input.value, action, d = null;
    if (opts.mode === 'encode') {
      if (raw === '') { setEmpty(); return; }
      action = 'encode';
    } else if (opts.mode === 'decode') {
      if (raw.replace(/\s/g, '') === '') { setEmpty(); return; }
      action = 'decode';
    } else {
      d = Core.detect(raw);
      if (d === 'empty') { setEmpty(); return; }
      action = (d === 'base64' || d === 'jwt') ? 'decode' : 'encode';   // datauri / plain / binary 偏保守走编码
    }
    if (action === 'encode') {
      var enc = Core.encode(raw, { wrap: opts.wrap, urlSafe: opts.urlSafe, pad: opts.pad });
      var nk = d === 'binary' ? 'b64_note_plain' : d === 'datauri' ? 'b64_note_datauri' : null;
      finishOk('encode', enc.b64,
        { chars: enc.charsIn, bytes: enc.bytesIn, out: enc.outLen, ratio: enc.bytesIn ? enc.outLen / enc.bytesIn : 0 }, nk);
    } else {
      var m = Core.measure(raw);
      try {
        var dec = Core.decode(raw);
        finishOk('decode', dec.text,
          { chars: m.chars, bytes: m.bytes, out: dec.charsOut, ratio: m.bytes ? dec.bytesOut / m.bytes : 0 }, null);
      } catch (e) {
        /* JWT 整串含 '.' 必然在清洗步报错，用说明位解释而非生硬的字符位置错误 */
        if (d === 'jwt') failDecode(m, null, null, 'b64_note_jwt');
        else failDecode(m, errKeyFor(e.code), e.code === 'char' ? { n: e.position } : null, null);
      }
    }
  }

  /* ---------- 防抖与手动模式（输入 > 256KB 停自动，显示「转换」按钮） ---------- */
  function showManual(on) { warn.hidden = !on; run.hidden = !on; }
  function scheduleCompute() {
    if (input.value.length > SOFT_LIMIT) { showManual(true); return; }   // S4：沿用上一次结果，不闪空
    showManual(false);
    if (timer) clearTimeout(timer);
    timer = setTimeout(compute, DEBOUNCE);
  }
  function onOptChange() {
    readOptsFromUI(); saveConfig();
    compute();                                  // 选项是离散事件，立即重算一次
    showManual(input.value.length > SOFT_LIMIT);
  }

  /* ---------- 动作：复制 / 互换 / 示例 / 清空 ---------- */
  function onCopy() {
    if (!last.full) return;
    if (MF.copyText) MF.copyText(last.full);    // 不传 btn：避开硬编码「已复制 ✓」，自管三语标签
    var span = copyBtn.querySelector('span[data-i18n]');
    if (span) {
      setI18n(span, 'b64_copied');
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { setI18n(span, 'b64_copy'); }, COPIED_MS);
    }
    if (window.Moteful && window.Moteful.recommend) {
      try { window.Moteful.recommend.show({ actionKey: 'rec_copy' }); } catch (e) {}
    }
  }
  function onSwap() {
    if (!last.full) return;
    input.value = last.full;
    scheduleCompute();
    input.focus();
  }
  function onSample() {
    input.value = '你好，Moteful！Base64 编解码 😀';
    scheduleCompute();
    input.focus();
  }
  function onClear() { if (MF.openModal) MF.openModal('b64ClearModal'); }
  function onClearConfirm() {
    input.value = '';
    if (MF.closeModal) MF.closeModal(clearModal);
    showManual(false);
    setEmpty();
    toast(tr('b64_clear_done'), 'success');
    input.focus();
  }

  /* ---------- 绑定与初始化 ---------- */
  function bind() {
    input.addEventListener('input', scheduleCompute);
    run.addEventListener('click', function () { compute(); });
    sampleBtn.addEventListener('click', onSample);
    clearBtn.addEventListener('click', onClear);
    copyBtn.addEventListener('click', onCopy);
    swapBtn.addEventListener('click', onSwap);
    clearConfirm.addEventListener('click', onClearConfirm);
    /* 同族选项控件用 document 级委托，跨卡也不漏听 */
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'b64Mode' || t.name === 'b64Wrap' || t.id === 'b64UrlSafe' || t.id === 'b64Pad') onOptChange();
    });
    document.addEventListener('moteful:langchange', function () { paint(); });
  }
  readConfig(); applyOptsToUI(); bind(); compute();
})();