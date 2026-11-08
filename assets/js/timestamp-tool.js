/* ===== Timestamp Converter · 页面逻辑（P0 F-01~F-07） =====
   只通过 window.TimestampCore 取数；文本一律 textContent；
   事件一律 addEventListener（FRM-03 禁内联 onclick）。
   状态机与存储键见设计文档 7 / 8.6。 */
(function () {
  'use strict';

  var Core = window.TimestampCore;
  if (!Core) return;

  var $ = function (s) { return document.querySelector(s); };
  var ISO_PATTERN = 'yyyy-MM-ddTHH:mm:ss.SSSZ';

  var tsNowSec = $('#tsNowSec'), tsNowMs = $('#tsNowMs');
  var btnNowSec = $('#tsBtnNowSec'), btnNowMs = $('#tsBtnNowMs');
  var tsInput = $('#tsInput');
  var tsFwdResult = $('#tsFwdResult'), tsFwdEmpty = $('#tsFwdResult .ts-result-empty');
  var tsFwdBody = $('#tsFwdBody'), tsFwdKv = $('#tsFwdKv'), tsFwdAmb = $('#tsFwdAmb');
  var tsFwdMain = $('#tsFwdMain'), tsFwdMeta = $('#tsFwdMeta'), tsFwdSoft = $('#tsFwdSoft');
  var tsFwdIso = $('#tsFwdIso'), tsFwdSec = $('#tsFwdSec'), tsFwdMs = $('#tsFwdMs');
  var tsFwdAmbS = $('#tsFwdAmbS'), tsFwdAmbMs = $('#tsFwdAmbMs');
  var btnCopyFwd = $('#tsBtnCopyFwd');
  var tsDatePick = $('#tsDatePick'), tsDatePickBtn = $('#tsDatePickBtn'), tsDatePickText = $('#tsDatePickText');
  var tsCalPrev = $('#tsCalPrev'), tsCalNext = $('#tsCalNext'), tsCalTitle = $('#tsCalTitle');
  var tsCalWeek = $('#tsCalWeek'), tsCalGrid = $('#tsCalGrid');
  var tsCalH = $('#tsCalH'), tsCalM = $('#tsCalM'), tsCalS = $('#tsCalS');
  var tsCalNow = $('#tsCalNow'), tsCalDone = $('#tsCalDone');
  var tsDateText = $('#tsDateText');
  var tsRevResult = $('#tsRevResult'), tsRevEmpty = $('#tsRevResult .ts-result-empty');
  var tsRevBody = $('#tsRevBody'), tsRevKv = $('#tsRevKv'), tsRevDst = $('#tsRevDst');
  var tsRevSoft = $('#tsRevSoft'), tsRevDstMsg = $('#tsRevDstMsg'), tsRevDstOpts = $('#tsRevDstOpts');
  var tsRevSec = $('#tsRevSec'), tsRevMs = $('#tsRevMs');
  var btnCopyRev = $('#tsBtnCopyRev');
  var tsError = $('#tsError'), tsErrorText = $('#tsErrorText');
  var tsStorageWarn = $('#tsStorageWarn');
  var tsZoneSel = $('#tsZoneSel'), tsZoneValue = $('#tsZoneValue'), tsZoneOff = $('#tsZoneOff');
  var tsZoneSearch = $('#tsZoneSearch'), tsZoneNone = $('#tsZoneNone');
  var tsZoneGroup = tsZoneSel ? tsZoneSel.querySelector('.ts-zone-group') : null;
  var tsPatternSel = $('#tsPatternSel'), tsPatternValue = $('#tsPatternValue');
  var tsMsToggle = $('#tsMsToggle'), tsCustomWrap = $('#tsCustomWrap'), tsPatternCustom = $('#tsPatternCustom');
  var tsRecent = $('#tsRecent'), btnClearRecent = $('#tsBtnClearRecent');
  var tsClearModal = $('#tsClearModal'), tsClearConfirm = $('#tsClearConfirm');
  var tsClearBody = tsClearModal ? tsClearModal.querySelector('[data-i18n="ts_clear_body"]') : null;

  var DEBOUNCE_FWD = 120, DEBOUNCE_REV = 300;
  var fwdTimer = null, revTimer = null, customTimer = null, tickTimer = null;
  var pick = null, draft = null, pickView = null;

  var state = {
    zone: 'local', pattern: 'std', custom: '', ms: false, unit: 'auto',
    fwd: { raw: '', status: 'empty', t: 0, kind: '' },
    rev: { raw: '', status: 'empty', t: 0, source: 'text' },
    recent: []
  };

  /* ---------- 助手 ---------- */
  function tr(key, vars) {
    if (window.t) { try { var s = window.t(key, vars); if (s != null && s !== key) return s; } catch (e) {} }
    return key;
  }
  function lang() { return window.currentLang || 'en'; }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function offsetLabel(min) {
    var s = min < 0 ? '-' : '+', a = Math.abs(min);
    return s + p2(Math.floor(a / 60)) + ':' + p2(a % 60);
  }
  function inRange(t) { return isFinite(t) && Math.abs(t) <= Core.DATE_LIMIT; }
  /* 时区清单以页面列表为准（52 项），Core.ZONES 只是其中的常用子集；
     只看 Core.ZONES 会让 50 个城市选完后回落到「本地」、且刷新即丢失。 */
  var zoneIndex = null;
  function zoneById(id) {
    if (!zoneIndex) {
      zoneIndex = {};
      var i;
      for (i = 0; i < Core.ZONES.length; i++) zoneIndex[Core.ZONES[i].id] = Core.ZONES[i];
      var lis = tsZoneSel ? tsZoneSel.querySelectorAll('.select-list li[data-zone]') : [];
      for (i = 0; i < lis.length; i++) {
        var zid = lis[i].dataset.zone;
        if (zoneIndex[zid]) continue;
        var sp = lis[i].querySelector('.ts-zone-opt > span[data-i18n]');
        zoneIndex[zid] = { id: zid, iana: zid, labelKey: sp ? sp.getAttribute('data-i18n') : '' };
      }
    }
    return zoneIndex[id] || null;
  }
  function patternById(id) {
    for (var i = 0; i < Core.PATTERNS.length; i++) if (Core.PATTERNS[i].id === id) return Core.PATTERNS[i];
    return null;
  }
  function zoneLabel(id) { var z = zoneById(id); return z ? tr(z.labelKey) : id; }
  function localeTag() { var l = lang(); return l === 'zh' ? 'zh-CN' : (l === 'es' ? 'es' : 'en-US'); }
  function y4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }
  function partsText(p) {
    return y4(p.y) + '-' + p2(p.m) + '-' + p2(p.d) + ' ' + p2(p.H) + ':' + p2(p.M) + ':' + p2(p.S);
  }
  function zoneNowParts() {
    var p = Core.toDateParts(Date.now(), state.zone);
    return { y: p.y, m: p.m, d: p.d, H: p.H, M: p.M, S: p.S };
  }
  function sameParts(a, b) {
    return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
  }

  /* ---------- 提示 ---------- */
  function showError(text, input) {
    if (tsErrorText) tsErrorText.textContent = text;
    if (tsError) tsError.hidden = false;
    if (input) input.classList.add('is-error');
  }
  function clearError() {
    if (tsError) tsError.hidden = true;
    if (tsErrorText) tsErrorText.textContent = '';
    tsInput.classList.remove('is-error');
    if (tsDatePickBtn) tsDatePickBtn.classList.remove('is-error');
    tsDateText.classList.remove('is-error');
  }
  function setNote(el, list) {
    if (!el) return;
    if (!list || !list.length) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = list.join(' · ');
    el.hidden = false;
  }

  /* ---------- 存储（8.6：全部 try/catch，失败给可见信号） ---------- */
  function showStorageWarn() { if (tsStorageWarn) tsStorageWarn.hidden = false; }
  function hideStorageWarn() { if (tsStorageWarn) tsStorageWarn.hidden = true; }
  function readKey(k) {
    try { return localStorage.getItem(k); } catch (e) { showStorageWarn(); return null; }
  }
  function writeKey(k, v) {
    try { localStorage.setItem(k, v); hideStorageWarn(); return true; }
    catch (e) { showStorageWarn(); return false; }
  }

  function parseRecent(raw) {
    if (!raw) return [];
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    if (!Array.isArray(arr)) { writeKey('ts-recent', '[]'); return []; }
    var out = [];
    for (var i = 0; i < arr.length && out.length < 5; i++) {
      var it = arr[i];
      if (!it || typeof it.raw !== 'string' || it.raw === '') continue;
      if (it.kind !== 's' && it.kind !== 'ms' && it.kind !== 'date') continue;
      if (!zoneById(it.zone)) continue;
      if (!isFinite(it.t) || !inRange(+it.t)) continue;
      out.push({ raw: it.raw, kind: it.kind, zone: it.zone, t: +it.t, at: +it.at || 0 });
    }
    if (out.length !== arr.length) writeKey('ts-recent', JSON.stringify(out));
    return out;
  }

  function addRecent(rec) {
    var top = state.recent[0];
    if (top && top.raw === rec.raw && top.kind === rec.kind && top.zone === rec.zone && top.t === rec.t) return;
    /* 逐字输入时 120ms 防抖会留下中间态（1 / 17 / 171 …）：
       5 秒内同源的前缀关系视为「同一串还在输入」，只保留最终值 */
    if (top && top.kind === rec.kind && top.zone === rec.zone && rec.at - top.at < 5000) {
      if (rec.raw.indexOf(top.raw) === 0) {
        state.recent[0] = rec;
        writeKey('ts-recent', JSON.stringify(state.recent));
        renderRecent();
        return;
      }
      if (top.raw.indexOf(rec.raw) === 0) return;
    }
    state.recent.unshift(rec);
    if (state.recent.length > 5) state.recent.length = 5;
    writeKey('ts-recent', JSON.stringify(state.recent));
    renderRecent();
  }

  function renderRecent() {
    if (!tsRecent) return;
    tsRecent.textContent = '';
    if (!state.recent.length) {
      var p = document.createElement('p');
      p.className = 'muted ts-rec-empty';
      p.textContent = tr('ts_recent_empty');
      tsRecent.appendChild(p);
      return;
    }
    state.recent.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-rec-item';
      var main = document.createElement('span');
      main.className = 'ts-rec-main';
      var raw = document.createElement('span');
      raw.className = 'ts-rec-raw';
      raw.textContent = r.raw;
      var sub = document.createElement('span');
      sub.className = 'ts-rec-sub';
      sub.textContent = zoneLabel(r.zone) + ' · ' + Core.format(r.t, r.zone, 'yyyy-MM-dd HH:mm:ss', lang()).text;
      main.appendChild(raw);
      main.appendChild(sub);
      var hint = document.createElement('span');
      hint.className = 'ts-rec-hint';
      hint.textContent = tr('ts_recent_restore');
      b.appendChild(main);
      b.appendChild(hint);
      b.addEventListener('click', function () { restoreRecord(r); });
      tsRecent.appendChild(b);
    });
  }

  function restoreRecord(r) {
    state.zone = r.zone;
    writeKey('ts-zone', r.zone);
    applyZoneUI();
    if (r.kind === 'date') {
      state.rev.source = 'text';
      tsDateText.value = r.raw;
      var p = Core.parseDate(r.raw);
      if (p.ok) syncPick(p.parts); else clearPick();
      computeRev(false);
    } else {
      state.unit = (r.kind === 'ms') ? 'ms' : 's';
      writeKey('ts-unit', state.unit);
      syncUnitUI();
      tsInput.value = r.raw;
      computeFwd(false);
    }
  }

  /* ---------- 当前时间戳 tick（8.3：hidden 暂停 + 恢复校准） ---------- */
  function tick() {
    var now = Date.now();
    if (tsNowSec) tsNowSec.textContent = String(Math.floor(now / 1000));
    if (tsNowMs) tsNowMs.textContent = String(now);
  }
  function startTick() { stopTick(); tick(); tickTimer = setInterval(tick, 1000); }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  /* ---------- 复制（8.5：clipboard → execCommand → toast；不用 MF.copyText） ---------- */
  function flashCopied(btn, key) {
    if (!btn) return;
    var span = btn.querySelector('span');
    if (!span) return;
    span.textContent = tr('ts_copied');
    setTimeout(function () { span.textContent = tr(key || 'ts_btn_copy'); }, 1500);
  }
  function afterCopy(btn, key) {
    if (window.toast) window.toast(tr('ts_copied'), 'success');
    flashCopied(btn, key);
    if (window.Moteful && window.Moteful.recommend) {
      try { window.Moteful.recommend.show({ actionKey: 'rec_copy' }); } catch (e) {}
    }
  }
  function copyText(v, btn, key) {
    if (!v) { if (window.toast) window.toast(tr('ts_copy_empty'), 'warning'); return; }
    function done() { afterCopy(btn, key); }
    function fail() { if (window.toast) window.toast(tr('ts_copy_fail'), 'warning'); }
    /* execCommand 的返回值必须看：浏览器拒绝写剪贴板时它返回 false，
       以前无论成败都提示「已复制」，用户粘出来却是空的 */
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = v;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 时区 / 模板 / 单位 UI ---------- */
  function utcOffsetLabel(zone) {
    var min;
    try { min = Core.zoneOffset(Date.now(), zone); } catch (e) { return ''; }
    var a = Math.abs(min);
    return 'UTC' + (min < 0 ? '-' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + p2(a % 60) : '');
  }
  function syncZoneOffsets() {
    if (!tsZoneSel) return;
    var lis = tsZoneSel.querySelectorAll('.select-list li[data-zone]');
    for (var i = 0; i < lis.length; i++) {
      var span = lis[i].querySelector('.ts-zone-off');
      if (span) span.textContent = utcOffsetLabel(lis[i].dataset.zone);
    }
  }
  function syncZoneLabel() {
    var z = zoneById(state.zone) || Core.ZONES[0];
    if (!tsZoneValue) return;
    tsZoneValue.setAttribute('data-i18n', z.labelKey);
    tsZoneValue.textContent = tr(z.labelKey);
    if (tsZoneOff) tsZoneOff.textContent = utcOffsetLabel(state.zone);
  }
  function applyZoneUI() {
    if (!tsZoneSel) return;
    var lis = tsZoneSel.querySelectorAll('.select-list li[data-zone]');
    for (var i = 0; i < lis.length; i++) {
      var on = lis[i].dataset.zone === state.zone;
      lis[i].classList.toggle('on', on);
      lis[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    syncZoneOffsets();
    syncZoneLabel();
  }
  /* 时区偏移只在打开/切换时算一次：页面跨夏令时长期挂着会停在旧值，每 60 秒校准一次 */
  var offsetTimer = null;
  function refreshZoneDisplay() {
    if (document.hidden) return;
    syncZoneOffsets();
    syncZoneLabel();
  }
  function startOffsetTimer() { stopOffsetTimer(); offsetTimer = setInterval(refreshZoneDisplay, 60000); }
  function stopOffsetTimer() { if (offsetTimer) { clearInterval(offsetTimer); offsetTimer = null; } }
  function filterZoneList() {
    if (!tsZoneSearch || !tsZoneSel) return;
    var q = tsZoneSearch.value.trim().toLowerCase();
    var lis = tsZoneSel.querySelectorAll('.select-list li[data-zone]');
    var any = false, world = false;
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var hay = (li.textContent + ' ' + (li.dataset.alias || '') + ' ' + (li.dataset.zone || '')).toLowerCase();
      var hit = q === '' || hay.indexOf(q) >= 0;
      li.hidden = !hit;
      if (hit) {
        any = true;
        if (li.dataset.zone !== 'local' && li.dataset.zone !== 'UTC') world = true;
      }
    }
    if (tsZoneNone) tsZoneNone.hidden = any;
    if (tsZoneGroup) tsZoneGroup.hidden = !world;
    var active = document.activeElement;
    if (active && active.closest && active.closest('#tsZoneSel .select-list') && active.hidden) {
      focusCurrentOption(tsZoneSel, 'data-zone', tsZoneBtn);
    }
  }

  /* ---------- 弹出层可达性（设计 13.4：Enter/Space 展开、方向键选项、Enter 确认） ---------- */
  var pops = [];
  function syncPops() {
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i], open = p.pop.classList.contains('open');
      p.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      /* .pop-panel 只靠 opacity / pointer-events 隐藏，关闭时里面的日期格与城市项
         仍会占几十个 Tab 停靠点；inert 把它们整体移出 Tab 序列与读屏树 */
      if (open) p.panel.removeAttribute('inert');
      else p.panel.setAttribute('inert', '');
    }
  }
  function bindPop(popEl) {
    if (!popEl) return;
    var btn = popEl.querySelector('[data-pop]');
    var panel = popEl.querySelector('.pop-panel');
    if (!btn || !panel) return;
    if (!panel.id) panel.id = popEl.id + 'Panel';
    btn.setAttribute('aria-controls', panel.id);
    pops.push({ pop: popEl, btn: btn, panel: panel });
    btn.addEventListener('click', syncPops);
  }
  function bindPopEscape(popEl) {
    if (!popEl) return;
    var btn = popEl.querySelector('[data-pop]');
    var panel = popEl.querySelector('.pop-panel');
    if (!btn || !panel) return;
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      popEl.classList.remove('open');
      syncPops();
      btn.focus();
    });
  }
  function visibleOptions(popEl, attr) {
    var out = [];
    if (!popEl) return out;
    var lis = popEl.querySelectorAll('.select-list li[' + attr + ']');
    for (var i = 0; i < lis.length; i++) {
      if (!lis[i].hidden && lis[i].getAttribute('aria-disabled') !== 'true') out.push(lis[i]);
    }
    return out;
  }
  function focusCurrentOption(popEl, attr, btn) {
    var items = visibleOptions(popEl, attr);
    if (!items.length) { if (btn) btn.focus(); return; }
    var on = popEl.querySelector('.select-list li.on[' + attr + ']');
    ((on && !on.hidden) ? on : items[0]).focus();
  }
  function bindListbox(popEl, attr) {
    if (!popEl) return;
    var btn = popEl.querySelector('[data-pop]');
    var list = popEl.querySelector('.select-list');
    var lis = popEl.querySelectorAll('.select-list li[' + attr + ']');
    if (!btn || !list) return;
    for (var i = 0; i < lis.length; i++) {
      lis[i].setAttribute('role', 'option');
      lis[i].tabIndex = -1;
    }
    btn.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      if (!popEl.classList.contains('open')) btn.click();
      focusCurrentOption(popEl, attr, btn);
    });
    list.addEventListener('keydown', function (e) {
      var li = e.target.closest('li[' + attr + ']');
      if (!li || li.tabIndex !== -1) return;
      var items = visibleOptions(popEl, attr);
      var idx = items.indexOf(li);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var n = Math.min(items.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)));
        if (items[n]) items[n].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var t = items[e.key === 'Home' ? 0 : items.length - 1];
        if (t) t.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        li.click();
        btn.focus();
      } else if (e.key === 'Tab') {
        popEl.classList.remove('open');
        syncPops();
      }
    });
  }
  bindPop(tsZoneSel);
  bindPop(tsPatternSel);
  bindPop(tsDatePick);
  bindPopEscape(tsZoneSel);
  bindPopEscape(tsPatternSel);
  bindPopEscape(tsDatePick);
  bindListbox(tsZoneSel, 'data-zone');
  bindListbox(tsPatternSel, 'data-pattern');

  /* ---------- 自定义日期时间选择器（替代原生 datetime-local） ---------- */
  var calFmt = {};
  function calFormatter(key, opts) {
    var k = localeTag() + '|' + key;
    if (!calFmt[k]) calFmt[k] = new Intl.DateTimeFormat(localeTag(), opts);
    return calFmt[k];
  }
  function renderPickTrigger() {
    if (!tsDatePickText) return;
    if (pick) {
      tsDatePickText.removeAttribute('data-i18n');
      tsDatePickText.textContent = partsText(pick);
    } else {
      tsDatePickText.setAttribute('data-i18n', 'ts_pick_empty');
      tsDatePickText.textContent = tr('ts_pick_empty');
    }
  }
  function fillTimeInputs(p) {
    if (tsCalH) tsCalH.value = p2(p.H);
    if (tsCalM) tsCalM.value = p2(p.M);
    if (tsCalS) tsCalS.value = p2(p.S);
  }
  function syncPick(parts) {
    pick = { y: parts.y, m: parts.m, d: parts.d, H: parts.H, M: parts.M, S: parts.S };
    renderPickTrigger();
  }
  function clearPick() {
    pick = null;
    draft = null;
    renderPickTrigger();
  }
  /* new Date(y, ...) 会把 0–99 映射到 1900+，年份 < 100 的日期必须走 setFullYear */
  function mkDate(y, m, d) {
    var dt = new Date(0);
    dt.setFullYear(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }
  function renderCal() {
    if (!tsCalGrid || !pickView) return;
    var first = mkDate(pickView.y, pickView.m, 1);
    if (tsCalTitle) {
      var mopts = { year: 'numeric', month: 'long' };
      if (pickView.y < 1) mopts.era = 'short';
      tsCalTitle.textContent = calFormatter(pickView.y < 1 ? 'monthEra' : 'month', mopts).format(first);
    }
    if (tsCalWeek) {
      tsCalWeek.textContent = '';
      var wf = calFormatter('wd', { weekday: 'short' });
      for (var w = 0; w < 7; w++) {
        var sp = document.createElement('span');
        sp.textContent = wf.format(new Date(2024, 0, 1 + w));
        tsCalWeek.appendChild(sp);
      }
    }
    var lead = (first.getDay() + 6) % 7;
    var start = mkDate(pickView.y, pickView.m, 1 - lead);
    var today = zoneNowParts();
    var df = calFormatter('day', { year: 'numeric', month: 'long', day: 'numeric' });
    tsCalGrid.textContent = '';
    var selEl = null, todayEl = null, firstEl = null;
    for (var i = 0; i < 42; i++) {
      var d = mkDate(start.getFullYear(), start.getMonth() + 1, start.getDate() + i);
      var cell = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-dt-day';
      b.dataset.year = String(cell.y);
      b.dataset.month = String(cell.m);
      b.dataset.day = String(cell.d);
      if (cell.m !== pickView.m) b.classList.add('is-out');
      if (sameParts(draft, cell)) b.classList.add('is-sel');
      if (today.y === cell.y && today.m === cell.m && today.d === cell.d) b.classList.add('is-today');
      b.textContent = String(cell.d);
      b.setAttribute('aria-label', df.format(d));
      b.setAttribute('aria-pressed', b.classList.contains('is-sel') ? 'true' : 'false');
      /* 42 个格子只保留一个 Tab 停靠点，方向键在格子间移动 */
      b.tabIndex = -1;
      if (cell.m === pickView.m) {
        if (!firstEl && cell.d === 1) firstEl = b;
        if (!selEl && b.classList.contains('is-sel')) selEl = b;
        if (!todayEl && b.classList.contains('is-today')) todayEl = b;
      }
      tsCalGrid.appendChild(b);
    }
    var tabEl = selEl || todayEl || firstEl || tsCalGrid.querySelector('.ts-dt-day');
    if (tabEl) tabEl.tabIndex = 0;
  }
  function focusDay() {
    var el = tsCalGrid ? tsCalGrid.querySelector('.ts-dt-day[tabindex="0"]') : null;
    if (el) el.focus();
  }
  /* 面板始终锚定在触发器正下方：空间不足时最小幅度滚动页面让触发器上移，
     不把面板翻到按钮上方（避免搜索框与列表脱离按钮「乱跑」） */
  function fitPanelBelow(btnEl, panelEl) {
    if (!btnEl || !panelEl) return;
    var r = btnEl.getBoundingClientRect();
    var need = panelEl.getBoundingClientRect().height + 18;
    var lack = need - (window.innerHeight - r.bottom);
    if (lack <= 0) return;
    var n = Math.min(lack, Math.max(0, r.top - 12));
    if (n > 0) window.scrollBy({ top: n, behavior: 'instant' });
  }
  function openCal() {
    var base = pick || zoneNowParts();
    draft = { y: base.y, m: base.m, d: base.d, H: base.H, M: base.M, S: base.S };
    pickView = { y: draft.y, m: draft.m };
    fillTimeInputs(draft);
    renderCal();
    fitPanelBelow(tsDatePickBtn, tsDtPanel);
  }
  function closeCal() {
    if (tsDatePick) tsDatePick.classList.remove('open');
    syncPops();
  }
  function commitPick(record) {
    if (!draft) return;
    pick = { y: draft.y, m: draft.m, d: draft.d, H: draft.H, M: draft.M, S: draft.S };
    renderPickTrigger();
    if (tsDateText) tsDateText.value = partsText(pick);
    state.rev.source = 'pick';
    clearTimeout(revTimer);
    computeRev(!!record);
  }
  function shiftMonth(n) {
    if (!pickView) return;
    var idx = pickView.y * 12 + (pickView.m - 1) + n;
    pickView = { y: Math.floor(idx / 12), m: idx % 12 + 1 };
    renderCal();
  }
  function syncPatternLabel() {
    var p = patternById(state.pattern) || Core.PATTERNS[0];
    if (!tsPatternValue) return;
    tsPatternValue.setAttribute('data-i18n', p.labelKey);
    tsPatternValue.textContent = tr(p.labelKey);
  }
  function applyPatternUI() {
    if (tsPatternSel) {
      var lis = tsPatternSel.querySelectorAll('.select-list li[data-pattern]');
      for (var i = 0; i < lis.length; i++) {
        var on = lis[i].dataset.pattern === state.pattern;
        lis[i].classList.toggle('on', on);
        lis[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    syncPatternLabel();
    if (tsCustomWrap) tsCustomWrap.hidden = state.pattern !== 'custom';
  }
  function syncUnitUI() {
    var r = document.querySelector('input[name="ts-unit"][value="' + state.unit + '"]');
    if (r) r.checked = true;
  }
  function displayPattern() {
    var pid = state.pattern, item = patternById(pid);
    var p = (pid === 'custom') ? (state.custom || 'yyyy-MM-dd HH:mm:ss') : (item ? item.pattern : 'yyyy-MM-dd HH:mm:ss');
    if (pid === 'std' || pid === 'slash') {
      if (state.ms && p.indexOf('SSS') < 0) p += '.SSS';
    } else if (pid === 'iso' && !state.ms) {
      p = p.replace('.SSS', '');
    }
    return p;
  }

  /* ---------- 正向换算 ---------- */
  function resetFwdEmpty() {
    state.fwd.status = 'empty';
    tsFwdResult.classList.remove('ts-busy');
    if (tsFwdEmpty) tsFwdEmpty.hidden = false;
    if (tsFwdBody) tsFwdBody.hidden = true;
  }

  function fwdInvalid(d, raw) {
    state.fwd.status = 'invalid';
    tsFwdResult.classList.remove('ts-busy');
    if (tsFwdEmpty) tsFwdEmpty.hidden = false;
    if (tsFwdBody) tsFwdBody.hidden = true;
    var msg = tr('ts_err_invalid');
    if (d.reason === 'non-digit' && d.badIndex >= 0) {
      msg = tr('ts_err_invalid_at', { n: d.badIndex + 1, c: raw.charAt(d.badIndex) });
    }
    showError(msg, tsInput);
  }

  function fwdValid(t, kind, record) {
    if (!inRange(t)) {
      state.fwd.status = 'invalid';
      tsFwdResult.classList.remove('ts-busy');
      if (tsFwdEmpty) tsFwdEmpty.hidden = false;
      if (tsFwdBody) tsFwdBody.hidden = true;
      showError(tr('ts_err_range') + ' · ' + tr('ts_err_range_detail'), tsInput);
      return;
    }
    clearError();
    state.fwd.status = 'valid';
    state.fwd.t = t;
    state.fwd.kind = kind;
    tsFwdResult.classList.remove('ts-busy');
    if (tsFwdEmpty) tsFwdEmpty.hidden = true;
    if (tsFwdBody) tsFwdBody.hidden = false;
    if (tsFwdKv) tsFwdKv.hidden = false;
    if (tsFwdAmb) tsFwdAmb.hidden = true;

    var p = Core.toDateParts(t, state.zone);
    var f = Core.format(t, state.zone, displayPattern(), lang());
    if (tsFwdMain) tsFwdMain.textContent = f.text;
    if (tsFwdMeta) {
      tsFwdMeta.textContent = Core.weekdayLabel(t, state.zone, lang()) +
        ' · ' + tr('ts_zone_offset') + ' ' + offsetLabel(p.offsetMinutes);
    }
    if (tsFwdIso) tsFwdIso.textContent = Core.format(t, state.zone, ISO_PATTERN, lang()).text;
    if (tsFwdSec) tsFwdSec.textContent = String(Math.floor(t / 1000));
    if (tsFwdMs) tsFwdMs.textContent = String(t);

    var notes = [];
    if (p.y < 1700 || p.y > 2200) notes.push(tr('ts_err_soft_range') + ' · ' + tr('ts_err_soft_range_detail'));
    if (f.unknownTokens.length) notes.push(tr('ts_err_token') + ' · ' + tr('ts_err_token_detail', { list: f.unknownTokens.join(', ') }));
    setNote(tsFwdSoft, notes);

    if (record) addRecent({ raw: state.fwd.raw, kind: kind, zone: state.zone, t: t, at: Date.now() });
  }

  function fillAmbOption(unit, t, ok, reco) {
    var btn = tsFwdAmb ? tsFwdAmb.querySelector('[data-amb-unit="' + unit + '"]') : null;
    if (!btn) return;
    var v = btn.querySelector('.ts-amb-v');
    var tag = btn.querySelector('.ts-amb-tag');
    btn.disabled = !ok;
    if (v) v.textContent = ok ? Core.format(t, state.zone, 'yyyy-MM-dd HH:mm:ss', lang()).text : '—';
    if (tag) tag.hidden = !reco;
  }

  function fwdAmbiguous(raw, d) {
    clearError();
    state.fwd.status = 'ambiguous';
    tsFwdResult.classList.remove('ts-busy');
    if (tsFwdEmpty) tsFwdEmpty.hidden = true;
    if (tsFwdBody) tsFwdBody.hidden = false;
    if (tsFwdKv) tsFwdKv.hidden = true;
    if (tsFwdAmb) tsFwdAmb.hidden = false;
    if (tsFwdMain) tsFwdMain.textContent = tr('ts_ambiguous');
    if (tsFwdMeta) tsFwdMeta.textContent = tr('ts_ambiguous_detail', { n: d.digits });
    setNote(tsFwdSoft, []);

    var v = d.value, tS = v * 1000, tMs = v;
    var okS = inRange(tS), okMs = inRange(tMs);
    var now = Date.now(), reco = '';
    if (okS && okMs) reco = (Math.abs(tS - now) <= Math.abs(tMs - now)) ? 's' : 'ms';
    else if (okS) reco = 's';
    else if (okMs) reco = 'ms';
    fillAmbOption('s', tS, okS, reco === 's');
    fillAmbOption('ms', tMs, okMs, reco === 'ms');
  }

  function computeFwd(record) {
    clearTimeout(fwdTimer);
    var raw = tsInput.value.trim();
    state.fwd.raw = raw;
    if (raw === '') { clearError(); resetFwdEmpty(); return; }
    var d = Core.detect(raw);
    if (d.kind === 'invalid') { fwdInvalid(d, raw); return; }
    var kind = state.unit;
    if (kind === 'auto') {
      if (d.kind === 'ambiguous') { fwdAmbiguous(raw, d); return; }
      kind = d.kind;
    }
    var t = (kind === 's') ? d.value * 1000 : d.value;
    fwdValid(t, kind, !!record);
  }

  /* ---------- 反向换算 ---------- */
  function resetRevEmpty() {
    state.rev.status = 'empty';
    tsRevResult.classList.remove('ts-busy');
    if (tsRevEmpty) tsRevEmpty.hidden = false;
    if (tsRevBody) tsRevBody.hidden = true;
  }
  function revInput() { return state.rev.source === 'pick' ? tsDatePickBtn : tsDateText; }

  function buildDstOptions(items, onPick) {
    if (!tsRevDstOpts) return;
    tsRevDstOpts.textContent = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-dst-opt';
      var k = document.createElement('span');
      k.className = 'ts-dst-k';
      k.textContent = it.k;
      var v = document.createElement('span');
      v.className = 'ts-dst-v';
      v.textContent = Core.format(it.t, state.zone, 'yyyy-MM-dd HH:mm:ss', lang()).text +
        ' ' + offsetLabel(Core.zoneOffset(it.t, state.zone));
      b.appendChild(k);
      b.appendChild(v);
      b.addEventListener('click', function () { onPick(it.t); });
      tsRevDstOpts.appendChild(b);
    });
  }

  function renderRevValid(t, record) {
    if (!inRange(t)) {
      state.rev.status = 'invalid';
      tsRevResult.classList.remove('ts-busy');
      if (tsRevEmpty) tsRevEmpty.hidden = true;
      if (tsRevBody) tsRevBody.hidden = true;
      showError(tr('ts_err_range') + ' · ' + tr('ts_err_range_detail'), revInput());
      return;
    }
    clearError();
    state.rev.status = 'valid';
    state.rev.t = t;
    tsRevResult.classList.remove('ts-busy');
    if (tsRevEmpty) tsRevEmpty.hidden = true;
    if (tsRevBody) tsRevBody.hidden = false;
    if (tsRevKv) tsRevKv.hidden = false;
    if (tsRevDst) tsRevDst.hidden = true;
    if (tsRevSec) tsRevSec.textContent = String(Math.floor(t / 1000));
    if (tsRevMs) tsRevMs.textContent = String(t);
    var y = Core.toDateParts(t, state.zone).y;
    setNote(tsRevSoft, (y < 1700 || y > 2200) ? [tr('ts_err_soft_range') + ' · ' + tr('ts_err_soft_range_detail')] : []);
    if (record) addRecent({ raw: state.rev.raw, kind: 'date', zone: state.zone, t: t, at: Date.now() });
  }

  function renderRevGap(r, raw) {
    clearError();
    state.rev.status = 'dst-gap';
    tsRevResult.classList.remove('ts-busy');
    if (tsRevEmpty) tsRevEmpty.hidden = true;
    if (tsRevBody) tsRevBody.hidden = false;
    if (tsRevKv) tsRevKv.hidden = true;
    if (tsRevDst) tsRevDst.hidden = false;
    setNote(tsRevSoft, []);
    if (tsRevDstMsg) {
      tsRevDstMsg.textContent = tr('ts_dst_gap') + ' · ' + tr('ts_dst_gap_detail', {
        from: Core.format(r.before, state.zone, 'HH:mm', lang()).text,
        to: Core.format(r.after, state.zone, 'HH:mm', lang()).text,
        input: raw
      });
    }
    buildDstOptions([
      { k: tr('ts_dst_gap_before'), t: r.before },
      { k: tr('ts_dst_gap_after'), t: r.after }
    ], function (t) { renderRevValid(t, true); });
  }

  function renderRevOverlap(r, raw) {
    clearError();
    state.rev.status = 'dst-overlap';
    tsRevResult.classList.remove('ts-busy');
    if (tsRevEmpty) tsRevEmpty.hidden = true;
    if (tsRevBody) tsRevBody.hidden = false;
    if (tsRevKv) tsRevKv.hidden = true;
    if (tsRevDst) tsRevDst.hidden = false;
    setNote(tsRevSoft, []);
    if (tsRevDstMsg) {
      tsRevDstMsg.textContent = tr('ts_dst_overlap') + ' · ' + tr('ts_dst_overlap_detail', { input: raw });
    }
    buildDstOptions(r.candidates.map(function (c) {
      return { k: offsetLabel(c.offsetMinutes) + ' · ' + tr('ts_dst_overlap_pick'), t: c.t };
    }), function (t) { renderRevValid(t, true); });
  }

  function revRaw() {
    if (state.rev.source === 'pick') return pick ? partsText(pick) : '';
    return tsDateText.value.trim();
  }

  function computeRev(record) {
    clearTimeout(revTimer);
    var raw = revRaw();
    state.rev.raw = raw;
    if (raw === '') {
      if (state.rev.source === 'text') clearPick();
      clearError();
      resetRevEmpty();
      return;
    }
    var p = Core.parseDate(raw);
    if (!p.ok) {
      state.rev.status = 'invalid';
      tsRevResult.classList.remove('ts-busy');
      if (tsRevEmpty) tsRevEmpty.hidden = true;
      if (tsRevBody) tsRevBody.hidden = true;
      if (p.reason === 'date' && p.parts) {
        showError(tr('ts_err_date_detail', { y: p.parts.y, m: p.parts.m, d: p.parts.d }), revInput());
      } else if (p.reason === 'range') {
        showError(tr('ts_err_range') + ' · ' + tr('ts_err_range_detail'), revInput());
      } else {
        showError(tr('ts_err_date'), revInput());
      }
      return;
    }
    if (state.rev.source === 'text') syncPick(p.parts);
    var r = Core.toEpoch(p.parts, state.zone);
    if (r.kind === 'invalid') {
      state.rev.status = 'invalid';
      tsRevResult.classList.remove('ts-busy');
      if (tsRevEmpty) tsRevEmpty.hidden = true;
      if (tsRevBody) tsRevBody.hidden = true;
      showError(tr('ts_err_range') + ' · ' + tr('ts_err_range_detail'), revInput());
      return;
    }
    if (r.kind === 'dst-gap') { renderRevGap(r, raw); return; }
    if (r.kind === 'dst-overlap') { renderRevOverlap(r, raw); return; }
    renderRevValid(r.t, !!record);
  }

  /* ---------- 事件绑定 ---------- */
  tsInput.addEventListener('input', function () {
    tsFwdResult.classList.add('ts-busy');
    clearTimeout(fwdTimer);
    if (tsInput.value.trim() === '') { computeFwd(false); return; }
    fwdTimer = setTimeout(function () { computeFwd(true); }, DEBOUNCE_FWD);
  });

  document.querySelectorAll('input[name="ts-unit"]').forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      state.unit = r.value;
      writeKey('ts-unit', state.unit);
      computeFwd(true);
    });
  });

  tsFwdAmb.querySelectorAll('[data-amb-unit]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.unit = b.dataset.ambUnit;
      syncUnitUI();
      writeKey('ts-unit', state.unit);
      computeFwd(true);
    });
  });

  /* ---------- 自定义日期时间选择器 ---------- */
  var calKeyOpen = false;
  if (tsDatePickBtn) {
    tsDatePickBtn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!tsDatePick.classList.contains('open')) { calKeyOpen = true; tsDatePickBtn.click(); }
        else focusDay();
      } else if (e.key === 'Enter' || e.key === ' ') {
        calKeyOpen = true;
      }
    });
    tsDatePickBtn.addEventListener('click', function () {
      openCal();
      syncPops();
      if (calKeyOpen) { calKeyOpen = false; focusDay(); }
    });
  }
  var tsDtPanel = tsDatePick ? tsDatePick.querySelector('.pop-panel') : null;
  if (tsDtPanel) tsDtPanel.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', syncPops);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') syncPops(); });

  if (tsCalPrev) tsCalPrev.addEventListener('click', function () { shiftMonth(-1); });
  if (tsCalNext) tsCalNext.addEventListener('click', function () { shiftMonth(1); });

  if (tsCalGrid) {
    tsCalGrid.addEventListener('click', function (e) {
      var b = e.target.closest('.ts-dt-day');
      if (!b || !draft) return;
      draft.y = +b.dataset.year;
      draft.m = +b.dataset.month;
      draft.d = +b.dataset.day;
      pickView = { y: draft.y, m: draft.m };
      commitPick(false);
      renderCal();
    });
    tsCalGrid.addEventListener('keydown', function (e) {
      if (!draft) return;
      var step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 :
        e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : 0;
      if (step) {
        e.preventDefault();
        var d = mkDate(draft.y, draft.m, draft.d + step);
        draft.y = d.getFullYear();
        draft.m = d.getMonth() + 1;
        draft.d = d.getDate();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var lead = (mkDate(draft.y, draft.m, 1).getDay() + 6) % 7;
        var wd = ((draft.d - 1) + lead) % 7;
        var target = e.key === 'Home' ? draft.d - wd : draft.d + (6 - wd);
        var hd = mkDate(draft.y, draft.m, target);
        draft.y = hd.getFullYear();
        draft.m = hd.getMonth() + 1;
        draft.d = hd.getDate();
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        var idx = draft.y * 12 + (draft.m - 1) + (e.key === 'PageUp' ? -1 : 1);
        var ny = Math.floor(idx / 12), nm = idx % 12 + 1;
        var last = mkDate(ny, nm + 1, 0).getDate();
        draft = { y: ny, m: nm, d: Math.min(draft.d, last), H: draft.H, M: draft.M, S: draft.S };
      } else {
        return;
      }
      pickView = { y: draft.y, m: draft.m };
      commitPick(false);
      renderCal();
      focusDay();
    });
  }

  function bindTimeInput(el, key, max) {
    if (!el) return;
    el.addEventListener('input', function () {
      var v = el.value.replace(/\D/g, '').slice(0, 2);
      if (v !== el.value) el.value = v;
      if (!draft || v === '') return;
      var n = parseInt(v, 10);
      /* 超限时同步改写输入框，避免「框里 25、结果按 23」 */
      if (n > max) { n = max; el.value = p2(n); }
      draft[key] = n;
      commitPick(false);
    });
    el.addEventListener('blur', function () {
      if (!draft) return;
      el.value = p2(draft[key]);
    });
  }
  bindTimeInput(tsCalH, 'H', 23);
  bindTimeInput(tsCalM, 'M', 59);
  bindTimeInput(tsCalS, 'S', 59);

  if (tsCalNow) {
    tsCalNow.addEventListener('click', function () {
      draft = zoneNowParts();
      pickView = { y: draft.y, m: draft.m };
      fillTimeInputs(draft);
      commitPick(true);
      renderCal();
    });
  }
  if (tsCalDone) {
    tsCalDone.addEventListener('click', function () {
      if (draft) commitPick(true);
      closeCal();
      if (tsDatePickBtn) tsDatePickBtn.focus();
    });
  }

  /* 时区搜索：面板内点击不冒泡关闭，输入即时过滤 */
  if (tsZoneSel) {
    var tsZonePanel = tsZoneSel.querySelector('.pop-panel');
    if (tsZonePanel) tsZonePanel.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  if (tsZoneSearch) tsZoneSearch.addEventListener('input', filterZoneList);
  tsDateText.addEventListener('input', function () {
    state.rev.source = 'text';
    tsRevResult.classList.add('ts-busy');
    clearTimeout(revTimer);
    revTimer = setTimeout(function () { computeRev(true); }, DEBOUNCE_REV);
  });
  tsDateText.addEventListener('blur', function () {
    clearTimeout(revTimer);
    state.rev.source = 'text';
    /* 值未变则不重算：点 DST 候选按钮会先让输入框 blur，重算会重建候选 DOM，随后的 click 落在已移除节点上而丢失 */
    if (revRaw() === state.rev.raw) return;
    computeRev(true);
  });

  tsZoneSel.querySelectorAll('.select-list li[data-zone]').forEach(function (li) {
    li.addEventListener('click', function () {
      if (li.getAttribute('aria-disabled') === 'true') return;
      state.zone = li.dataset.zone;
      writeKey('ts-zone', state.zone);
      applyZoneUI();
      if (tsZoneSearch) tsZoneSearch.value = '';
      filterZoneList();
      computeFwd(false);
      computeRev(false);
      /* 面板自身 stopPropagation，document 收不到这次点击，需就地同步展开态 */
      syncPops();
    });
  });
  var tsZoneBtn = tsZoneSel ? tsZoneSel.querySelector('.select-btn') : null;
  if (tsZoneBtn) tsZoneBtn.addEventListener('click', function () {
    syncZoneOffsets();
    fitPanelBelow(tsZoneBtn, tsZoneSel.querySelector('.pop-panel'));
  });

  tsPatternSel.querySelectorAll('.select-list li[data-pattern]').forEach(function (li) {
    li.addEventListener('click', function () {
      state.pattern = li.dataset.pattern;
      writeKey('ts-pattern', state.pattern);
      applyPatternUI();
      computeFwd(false);
      syncPops();
    });
  });
  tsMsToggle.addEventListener('change', function () {
    state.ms = tsMsToggle.checked;
    writeKey('ts-ms', state.ms ? '1' : '0');
    computeFwd(false);
  });
  tsPatternCustom.addEventListener('input', function () {
    state.custom = tsPatternCustom.value.slice(0, 200);
    clearTimeout(customTimer);
    customTimer = setTimeout(function () {
      writeKey('ts-pattern-custom', state.custom);
      computeFwd(false);
    }, DEBOUNCE_REV);
  });

  btnCopyFwd.addEventListener('click', function () {
    if (state.fwd.status !== 'valid') { if (window.toast) window.toast(tr('ts_copy_empty'), 'warning'); return; }
    copyText(tsFwdMain.textContent, btnCopyFwd, 'ts_btn_copy');
  });
  btnCopyRev.addEventListener('click', function () {
    if (state.rev.status !== 'valid') { if (window.toast) window.toast(tr('ts_copy_empty'), 'warning'); return; }
    copyText(tsRevSec.textContent, btnCopyRev, 'ts_now_copy_sec');
  });
  btnNowSec.addEventListener('click', function () { copyText(tsNowSec.textContent, btnNowSec, 'ts_btn_copy'); });
  btnNowMs.addEventListener('click', function () { copyText(tsNowMs.textContent, btnNowMs, 'ts_btn_copy'); });
  document.querySelectorAll('.ts-now-card').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      var v = card.querySelector('.ts-now-v');
      if (v) copyText(v.textContent, null, null);
    });
  });

  btnClearRecent.addEventListener('click', function () {
    if (tsClearBody) tsClearBody.textContent = tr('ts_clear_body', { n: state.recent.length });
    if (window.MF && window.MF.openModal) window.MF.openModal('tsClearModal');
    else if (window.openModal) window.openModal('tsClearModal');
  });
  tsClearConfirm.addEventListener('click', function () {
    try { localStorage.removeItem('ts-recent'); } catch (e) { showStorageWarn(); }
    state.recent = [];
    renderRecent();
    if (window.MF && window.MF.closeModal) window.MF.closeModal(tsClearModal);
    else if (tsClearModal) tsClearModal.classList.remove('open');
    if (window.toast) window.toast(tr('ts_cleared'), 'success');
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopTick(); stopOffsetTimer(); }
    else { startTick(); startOffsetTimer(); refreshZoneDisplay(); }
  });
  document.addEventListener('moteful:langchange', function () {
    syncZoneLabel();
    syncPatternLabel();
    renderPickTrigger();
    filterZoneList();
    if (tsDatePick && tsDatePick.classList.contains('open')) renderCal();
    if (state.fwd.raw) computeFwd(false);
    if (state.rev.raw) computeRev(false);
    renderRecent();
  });

  /* ---------- 启动（defer 脚本，DOM 已就绪） ---------- */
  function init() {
    var tzOk = true;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(0); }
    catch (e) { tzOk = false; }

    var z = readKey('ts-zone'); if (z && zoneById(z)) state.zone = z;
    var p = readKey('ts-pattern'); if (p && patternById(p)) state.pattern = p;
    var c = readKey('ts-pattern-custom'); if (c) state.custom = String(c).slice(0, 200);
    state.ms = readKey('ts-ms') === '1';
    var u = readKey('ts-unit'); if (u === 's' || u === 'ms' || u === 'auto') state.unit = u;
    state.recent = parseRecent(readKey('ts-recent'));

    if (!tzOk) {
      if (state.zone !== 'local' && state.zone !== 'UTC') state.zone = 'local';
      tsZoneSel.querySelectorAll('.select-list li[data-zone]').forEach(function (li) {
        if (li.dataset.zone !== 'local' && li.dataset.zone !== 'UTC') li.setAttribute('aria-disabled', 'true');
      });
      showError(tr('ts_err_tzdata'));
    }

    applyZoneUI();
    applyPatternUI();
    syncUnitUI();
    tsPatternCustom.value = state.custom;
    tsMsToggle.checked = state.ms;
    renderRecent();
    renderPickTrigger();
    filterZoneList();
    syncPops();
    resetFwdEmpty();
    resetRevEmpty();
    startTick();
    startOffsetTimer();
  }

  init();
})();
