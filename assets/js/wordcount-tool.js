/* ===== Word Counter · 页面逻辑（P0 F-01~F-11） =====
   对照 dev/regex.html 脚本惯例：局部 $/tr/esc；i18n 走 window.t；
   复制走 toast + execCommand 降级；存储键见设计文档 8.3。 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var textEl = $('#wcText'), mChars = $('#wcMChars'), mCharsNs = $('#wcMCharsNs'),
      mHanzi = $('#wcMHanzi'), mWords = $('#wcMWords'), mSent = $('#wcMSent'),
      mPara = $('#wcMPara'), mLines = $('#wcMLines'), bdEl = $('#wcBreakdown'),
      hintEl = $('#wcEmptyHint'), storageWarn = $('#wcStorageWarn'),
      tQuiet = $('#wcTimeQuiet'), tSpeak = $('#wcTimeSpeak'),
      limitLabel = $('#wcLimitLabel'), limitState = $('#wcLimitState'), limitBar = $('#wcLimitBar'),
      btnClear = $('#wcBtnClear'), btnCopy = $('#wcBtnCopy'), btnPaste = $('#wcBtnPaste'), btnSample = $('#wcBtnSample'),
      optWs = $('#wcOptWs'), optPunct = $('#wcOptPunct'),
      speedZh = $('#wcSpeedZh'), speedEn = $('#wcSpeedEn'),
      speakZh = $('#wcSpeedSpeakZh'), speakEn = $('#wcSpeedSpeakEn');

  var DEBOUNCE = 120;                       // 6.2 节流窗口
  var BIG = 50000;                          // 8.2 超长文本软提示阈值（不设硬上限）
  var LIMITS = { title: 20, xbio: 160, meta: 155, abstract: 300, wechat: 120 };   // F-06 内置模板
  var timer = null;

  /* ---------- 助手 ---------- */
  function tr(key, vars) {
    if (window.t) { try { var s = window.t(key, vars); if (s != null && s !== key) return s; } catch (e) {} }
    return key;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(n) { return n.toLocaleString(); }

  /* ---------- 当前口径 / 语速 / 限额 ---------- */
  function speedMode() {
    var r = document.querySelector('input[name="wc-speed"]:checked');
    return r ? r.value : 'quiet-normal';
  }
  /* ---------- 语速分桶：每档各记一份，切档即回填该档生效值 ----------
     wc-speed-custom 的值由扁平 {zh,en} 改为 {档位:{zh,en}}，沿用已登记键、不新增存储键（8.3）。 */
  var buckets = {};
  function bucket(key) { return buckets[key] || (buckets[key] = {}); }
  function readBucket(key, zhEl, enEl) {
    var b = bucket(key), zh = parseFloat(zhEl.value), en = parseFloat(enEl.value);
    if (zh > 0) b.zh = zh; else delete b.zh;
    if (en > 0) b.en = en; else delete b.en;
  }
  function paintBucket(key, zhEl, enEl) {
    var v = window.WordCounterCore.speedFor(buckets, key), p = window.WordCounterCore.PRESETS[key];
    zhEl.value = v.zh; enEl.value = v.en;
    if (p) { zhEl.placeholder = p.zh; enEl.placeholder = p.en; }   // 清空输入框后占位符即该档预设
  }
  function syncSpeedInputs() {
    paintBucket(speedMode(), speedZh, speedEn);
    paintBucket('speak', speakZh, speakEn);
  }
  function limitPick() {
    var li = document.querySelector('#wcLimitSel .select-list li.on');
    var id = li ? li.dataset.limit : 'meta';
    return LIMITS[id] != null ? id : 'meta';
  }
  /* 下拉按钮文案由 moteful.js 在点击时回写，加载与切换语言时须自行对齐选中项 */
  function syncLimitLabel() {
    var li = document.querySelector('#wcLimitSel .select-list li.on');
    if (li) limitLabel.textContent = li.textContent.trim();
  }
  function opts() {
    return {
      includeSpace: optWs.checked,
      includePunct: optPunct.checked,
      speedMode: speedMode(),
      speedCustom: buckets,
      limit: { name: limitPick(), max: LIMITS[limitPick()] }
    };
  }

  /* ---------- F-01 等宽 / 常规字体（纯视图偏好，不写存储：设计文档 8.3 未登记该键） ---------- */
  function applyFont() {
    var r = document.querySelector('input[name="wc-font"]:checked');
    textEl.classList.toggle('wc-sans', !!(r && r.value === 'sans'));
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var text = textEl.value;
    var r = window.WordCounterCore.analyzeText(text, opts());
    var empty = text === '';

    mChars.textContent = fmt(r.cMain);
    mCharsNs.textContent = fmt(r.cNs);
    mHanzi.textContent = fmt(r.cZh);
    mWords.textContent = fmt(r.wEn);
    mSent.textContent = fmt(r.sentences);
    mPara.textContent = fmt(r.paragraphs);
    mLines.textContent = fmt(r.lines);

    /* F-04 中英混排分列小计 + F-10 边界态提示 */
    var symbolOnly = !empty && r.cZh === 0 && r.wEn === 0;   // 纯符号 / 纯空白
    if (empty) {
      bdEl.hidden = true;
      hintEl.hidden = false;
      hintEl.textContent = tr('wc_empty_hint');              // 每次都显式回写，避免残留上一次的提示文案
    } else if (symbolOnly) {
      bdEl.hidden = false;
      hintEl.hidden = false;
      hintEl.textContent = tr('wc_empty_symbol_hint');
    } else {
      bdEl.hidden = false;
      hintEl.hidden = true;
    }
    /* 状态机「空态 Empty」：示例按钮高亮建议点击，非空即回到幽灵按钮常规态 */
    btnSample.classList.toggle('btn-primary', empty);
    btnSample.classList.toggle('btn-ghost', !empty);
    if (!empty) {
      var parts = [
        tr('wc_bd_hanzi') + ' ' + fmt(r.cZh),
        tr('wc_bd_words') + ' ' + fmt(r.wEn),
        tr('wc_bd_num') + ' ' + fmt(r.nNum),
        tr('wc_bd_punct') + ' ' + fmt(r.punct),
        tr('wc_bd_space') + ' ' + fmt(r.space)
      ];
      if (text.length >= BIG) parts.push(tr('wc_big_hint'));
      bdEl.textContent = parts.join(' · ');
    }

    /* F-05 双档时长（约 X 分钟 + 估算口径见面板脚注） */
    var zero = empty || (r.cZh === 0 && r.wEn === 0);
    tQuiet.textContent = zero ? '—' : tr('wc_time_fmt', { m: r.reading.quiet });
    tSpeak.textContent = zero ? '—' : tr('wc_time_fmt', { m: r.reading.speak });

    /* F-06 限额余量三色 */
    limitBar.style.setProperty('--p', r.limitUsedPct + '%');
    limitBar.setAttribute('aria-valuenow', String(r.limitUsedPct));
    limitBar.classList.remove('state-safe', 'state-near', 'state-over');
    limitBar.classList.add('state-' + r.limitState);
    limitState.classList.remove('t-success', 't-warn', 't-danger');
    if (r.limitState === 'safe') {
      limitState.classList.add('t-success');
      limitState.textContent = tr('wc_limit_safe') + ' · ' + tr('wc_limit_left', { n: fmt(r.limitRem) });
    } else {
      limitState.classList.add(r.limitState === 'near' ? 't-warn' : 't-danger');
      limitState.textContent = (r.limitState === 'near' ? tr('wc_limit_near') : tr('wc_limit_over')) + ' · ' + tr('wc_limit_over_by', { n: fmt(-r.limitRem) });
    }
  }

  /* ---------- 存储（8.3 键登记；写入 try/catch 静默降级） ---------- */
  function savePrefs() {
    try {
      localStorage.setItem('wc-speed-mode', speedMode());
      localStorage.setItem('wc-speed-custom', JSON.stringify(buckets));
      localStorage.setItem('wc-limit-pick', limitPick());
    } catch (e) {}
  }
  function loadPrefs() {
    var mode = null, cust = null, pick = null;
    try {
      mode = localStorage.getItem('wc-speed-mode');
      cust = localStorage.getItem('wc-speed-custom');
      pick = localStorage.getItem('wc-limit-pick');
    } catch (e) {}
    if (mode) { var r = document.querySelector('input[name="wc-speed"][value="' + mode + '"]'); if (r) r.checked = true; }
    buckets = {};
    if (cust) {
      try { cust = JSON.parse(cust); } catch (e) { cust = null; }
      if (cust && typeof cust === 'object') {
        Object.keys(window.WordCounterCore.PRESETS).forEach(function (k) {
          var b = cust[k];
          if (!b) return;
          if (b.zh > 0) bucket(k).zh = b.zh;
          if (b.en > 0) bucket(k).en = b.en;
        });
      }
    }
    if (pick && LIMITS[pick] != null) {
      var li = document.querySelector('#wcLimitSel .select-list li[data-limit="' + pick + '"]');
      if (li) {
        document.querySelectorAll('#wcLimitSel .select-list li').forEach(function (x) { x.classList.remove('on'); });
        li.classList.add('on');
      }
    }
  }
  function saveDraft() {
    try { localStorage.setItem('wc-draft-text', textEl.value); storageWarn.hidden = true; }
    catch (e) { storageWarn.hidden = false; }   // 隐私模式 / 容量满 → 仅内存态（状态机 Degraded）
  }
  function loadDraft() {
    var d = null;
    try { d = localStorage.getItem('wc-draft-text'); } catch (e) {}
    if (d != null && d !== '') {
      textEl.value = d;
      render();
      if (window.toast) window.toast(tr('wc_draft_restored'), 'info');
    }
  }
  function setText(t) { textEl.value = t; render(); saveDraft(); }

  /* ---------- 复制（toast + execCommand 降级，同 regex.js 惯例） ---------- */
  function copyText(v) {
    if (!v) { if (window.toast) window.toast(tr('wc_copy_empty'), 'warning'); return; }
    function done() { if (window.toast) window.toast(tr('wc_copied'), 'success'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = v; ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(v).then(done, fallback); }
    else { fallback(); }
  }
  function copySummary() {
    var text = textEl.value;
    if (text === '') { if (window.toast) window.toast(tr('wc_copy_empty'), 'warning'); return; }
    var r = window.WordCounterCore.analyzeText(text, opts());
    var lines = [
      tr('wc_metric_chars') + ' ' + fmt(r.cMain),
      tr('wc_metric_chars_ns') + ' ' + fmt(r.cNs),
      tr('wc_metric_hanzi') + ' ' + fmt(r.cZh),
      tr('wc_metric_words') + ' ' + fmt(r.wEn),
      tr('wc_metric_sent') + ' ' + fmt(r.sentences),
      tr('wc_metric_para') + ' ' + fmt(r.paragraphs),
      tr('wc_metric_lines') + ' ' + fmt(r.lines),
      tr('wc_time_quiet') + ' ' + tr('wc_time_fmt', { m: r.reading.quiet }),
      tr('wc_time_speak') + ' ' + tr('wc_time_fmt', { m: r.reading.speak }),
      tr('wc_limit_label') + ' ' + (r.limitState === 'safe' ? tr('wc_limit_safe') : tr('wc_limit_over_by', { n: fmt(-r.limitRem) }))
    ];
    copyText(lines.join('\n'));
  }

  /* ---------- 事件绑定 ---------- */
  textEl.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { render(); saveDraft(); }, DEBOUNCE);
  });
  optWs.addEventListener('change', function () { render(); savePrefs(); });
  optPunct.addEventListener('change', function () { render(); savePrefs(); });
  document.querySelectorAll('input[name="wc-speed"]').forEach(function (r) {
    r.addEventListener('change', function () { paintBucket(speedMode(), speedZh, speedEn); render(); savePrefs(); });
  });
  document.querySelectorAll('input[name="wc-font"]').forEach(function (r) {
    r.addEventListener('change', applyFont);
  });
  function onQuietSpeed() { readBucket(speedMode(), speedZh, speedEn); render(); savePrefs(); }
  function onSpeakSpeed() { readBucket('speak', speakZh, speakEn); render(); savePrefs(); }
  speedZh.addEventListener('input', onQuietSpeed);
  speedEn.addEventListener('input', onQuietSpeed);
  speakZh.addEventListener('input', onSpeakSpeed);
  speakEn.addEventListener('input', onSpeakSpeed);
  document.querySelectorAll('#wcLimitSel .select-list li').forEach(function (li) {
    li.addEventListener('click', function () { savePrefs(); render(); });
  });
  btnClear.addEventListener('click', function () { if (window.openModal) window.openModal('wcClearModal'); });
  $('#wcClearConfirm').addEventListener('click', function () {
    setText('');
    /* moteful.js 只把 openModal 挂到 window，没有导出 closeModal；
       这里走全站共享的关闭路径（弹窗内 [data-close] 由底座委托监听统一关闭），不自己摸 class。 */
    var m = document.getElementById('wcClearModal');
    var closer = m && m.querySelector('[data-close]');
    if (closer) closer.click();
    else if (m) m.classList.remove('open');
    if (window.toast) window.toast(tr('wc_cleared'), 'success');
  });
  btnCopy.addEventListener('click', copySummary);
  btnPaste.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) { if (t) setText(t); })
        .catch(function () { if (window.toast) window.toast(tr('wc_paste_err'), 'warning'); });
    } else { if (window.toast) window.toast(tr('wc_paste_err'), 'warning'); }
  });
  btnSample.addEventListener('click', function () { setText(tr('wc_sample_text')); });

  /* ---------- F-01 拖入纯文本文件 ----------
     整个页面都接（浏览器默认会把拖入的文件直接导航打开，页面状态全丢），
     读到的高亮反馈打在输入框上；只认纯文本，其它类型给明确提示不静默失败。 */
  var TEXT_EXT = /\.(txt|md|markdown|csv|log|json)$/i;
  function isTextFile(f) {
    return !!(f && (f.type === '' || (f.type && f.type.indexOf('text/') === 0))) || TEXT_EXT.test(f && f.name || '');
  }
  function dropFeedback(on) {
    if (textEl) textEl.classList.toggle('wc-dragover', !!on);
  }
  function acceptFiles(files) {
    if (!files || !files.length) return;
    var ok = 0, bad = 0, left = files.length, buf = [];
    function finish() {
      if (buf.length) setText((textEl.value ? textEl.value + '\n' : '') + buf.join('\n'));
      if (window.toast) {
        if (bad && !ok) window.toast(tr('wc_drop_bad'), 'warning');
        else window.toast(tr('wc_drop_ok'), 'success');
      }
    }
    Array.prototype.forEach.call(files, function (f) {
      if (!isTextFile(f)) { bad++; if (--left === 0) finish(); return; }
      var fr = new FileReader();
      fr.onload = function () { buf.push(String(fr.result == null ? '' : fr.result)); ok++; if (--left === 0) finish(); };
      fr.onerror = function () { bad++; if (--left === 0) finish(); };
      fr.readAsText(f, 'utf-8');
    });
  }
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropFeedback(true);
  });
  document.addEventListener('dragleave', function (e) {
    if (e.relatedTarget === null) dropFeedback(false);
  });
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); dropFeedback(false); acceptFiles(e.dataTransfer.files);
  });
  document.addEventListener('moteful:langchange', function () { loadPrefs(); syncSpeedInputs(); syncLimitLabel(); render(); });

  /* ---------- 启动（defer 脚本，DOM 已就绪） ---------- */
  loadPrefs();
  syncLimitLabel();
  syncSpeedInputs();
  applyFont();
  loadDraft();
  render();
})();
