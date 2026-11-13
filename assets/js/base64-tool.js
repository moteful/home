/* ===== base64-tool.js · Base64 编解码视图层（V2.1.6 P1） =====
   只做编排：方向 / 折行 / 输出格式 / 开关读写、120ms 防抖、状态机 S0–S7、文本编解码、
   文件导入（拖入 / 粘贴 / 选择）、二进制下载、嵌入片段、复制 / 互换 / 清空 / 示例。
   编解码一律走 MFBase64；粘贴走 MFImageImport.enablePaste；提示与弹窗一律走 MF.*。
   输出只经 textarea.value / img.src / 选中片段文本落地，永不 innerHTML。
   隐私：正文与文件字节零持久化，只写选项偏好键 moteful.b64.config；无 fetch / XHR / beacon。 */
(function () {
  'use strict';

  var Core = window.MFBase64, MF = window.MF || {};
  var CFG_KEY = 'moteful.b64.config';
  var DEBOUNCE = 120, SOFT_LIMIT = 256 * 1024, DISPLAY_LIMIT = 200 * 1024, TRUNC_TO = 50 * 1024,
    COPIED_MS = 1500, FILE_LIMIT = 5 * 1024 * 1024, DOWNLOAD_BASE = 'base64-decoded';

  function $(id) { return document.getElementById(id); }
  var input = $('b64Input'), output = $('b64Output'), empty = $('b64Empty'), binary = $('b64Binary'),
    outTitle = $('b64OutTitle'),
    statsPanel = $('b64StatsPanel'),
    statChars = $('b64StatChars'), statBytes = $('b64StatBytes'), statOut = $('b64StatOut'), statRatio = $('b64StatRatio'),
    note = $('b64Note'), noteText = $('b64NoteText'), error = $('b64Error'), errorText = $('b64ErrorText'),
    warn = $('b64Warn'), run = $('b64Run'),
    sampleBtn = $('b64Sample'), clearBtn = $('b64Clear'), copyBtn = $('b64Copy'), swapBtn = $('b64Swap'),
    downloadBtn = $('b64Download'),
    snips = $('b64Snips'), snipImg = $('b64SnipImg'), snipCss = $('b64SnipCss'),
    inputPanel = $('b64InputPanel'), dropzone = $('b64Dropzone'), dzEmpty = $('b64DzEmpty'), dzGallery = $('b64DzGallery'),
    fileInput = $('b64File'), importBtn = $('b64ImportBtn'),
    fileCount = $('b64FileCount'), fileType = $('b64FileType'), fileSize = $('b64FileSize'),
    fileDimsRow = $('b64FileDimsRow'), fileDims = $('b64FileDims'), fileEncoded = $('b64FileEncoded'),
    thumbImg = $('b64ThumbImg'), thumbIco = $('b64ThumbIco'), fileDataUri = $('b64FileDataUri'), fileRemove = $('b64FileRemove'),
    extModal = $('b64ExtModal'), extInput = $('b64ExtInput'), extErr = $('b64ExtErr'), extConfirm = $('b64ExtConfirm'),
    urlSafeEl = $('b64UrlSafe'), padEl = $('b64Pad'),
    clearModal = $('b64ClearModal'), clearConfirm = $('b64ClearConfirm');

  function tr(key, vars) {
    if (window.t) { try { var s = window.t(key, vars); if (s != null && s !== key) return s; } catch (e) {} }
    return key;
  }
  function setI18n(el, key) { if (!el) return; el.setAttribute('data-i18n', key); el.textContent = tr(key); }
  function toast(msg, type) { if (window.toast) window.toast(msg, type); }

  var opts = { mode: 'auto', wrap: 0, urlSafe: false, pad: true, fmt: 'b64' };
  var timer = null, fileSrc = null;   // fileSrc 只在内存：{name,type,mime,size,b64,dataUri,width,height}
  var last = {
    kind: 'empty', action: 'encode', display: '', full: '', stats: null,
    noteKey: null, noteVars: null, errKey: null, errVars: null,
    dataUri: null, binary: null, mime: null
  };

  /* ---------- 选项偏好：只读写 moteful.b64.config，正文与文件不入任何存储 ---------- */
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
  function saveConfig() {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({ mode: opts.mode, wrap: opts.wrap, urlSafe: opts.urlSafe, pad: opts.pad }));
    } catch (e) {}
  }
  function applyOptsToUI() {
    var m = document.querySelector('input[name="b64Mode"][value="' + opts.mode + '"]'); if (m) m.checked = true;
    var w = document.querySelector('input[name="b64Wrap"][value="' + opts.wrap + '"]'); if (w) w.checked = true;
    var f = document.querySelector('input[name="b64Fmt"][value="' + opts.fmt + '"]'); if (f) f.checked = true;
    urlSafeEl.checked = opts.urlSafe; padEl.checked = opts.pad;
  }
  function readOptsFromUI() {
    var m = document.querySelector('input[name="b64Mode"]:checked'); opts.mode = m ? m.value : 'auto';
    var w = document.querySelector('input[name="b64Wrap"]:checked'); opts.wrap = w ? parseInt(w.value, 10) : 0;
    var f = document.querySelector('input[name="b64Fmt"]:checked'); opts.fmt = f ? f.value : 'b64';
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
    binary.hidden = k !== 'binary';
    statsPanel.hidden = k === 'empty';
    output.value = k === 'ok' ? last.display : '';
    setStats(k === 'empty' ? null : last.stats);
    /* 错误（红）与说明（蓝）互斥落位，状态迁移后不残留上一条 */
    var showErr = k === 'error' && last.errKey;
    error.hidden = !showErr;
    if (showErr) errorText.textContent = tr(last.errKey, last.errVars);
    var nk = k === 'empty' ? null : last.noteKey;
    note.hidden = !nk;
    if (nk) noteText.textContent = tr(nk, last.noteVars);
    var titleKey = k === 'binary' ? 'b64_output_bin'
      : (k === 'ok' && last.action === 'decode') || k === 'error' ? 'b64_output_dec' : 'b64_output_enc';
    setI18n(outTitle, titleKey);
    snips.hidden = !last.dataUri;   // 编码文件与解码出的图片都具备 Data URI，均可取片段
    var canText = k === 'ok' && !!last.full;
    copyBtn.disabled = !canText;
    swapBtn.disabled = !canText;
    downloadBtn.disabled = !(k === 'binary' && !!last.binary);
  }

  /* ---------- 状态构造 ---------- */
  function setEmpty() {
    last = {
      kind: 'empty', action: 'encode', display: '', full: '', stats: null,
      noteKey: null, noteVars: null, errKey: null, errVars: null, dataUri: null, binary: null, mime: null
    };
    paint();
  }
  function finishOk(action, full, stats, noteKey, noteVars, extra) {
    var trunc = full.length > DISPLAY_LIMIT;   // S5：超 200KB 只显示前 50KB，复制取内存全量
    last = {
      kind: 'ok', action: action, full: full, display: trunc ? full.slice(0, TRUNC_TO) : full,
      stats: stats, noteKey: trunc ? 'b64_note_trunc' : noteKey || null,
      noteVars: trunc ? null : noteVars || null, errKey: null, errVars: null,
      dataUri: extra && extra.dataUri || null, binary: null, mime: extra && extra.mime || null
    };
    paint();
  }
  function finishBinary(action, m, bytes, mime) {
    var ext = Core.extForMime(mime);
    var isImg = /^image\//.test(mime);
    last = {
      kind: 'binary', action: action, display: '', full: '',
      stats: { chars: m.chars, bytes: m.bytes, out: bytes.length, ratio: m.bytes ? bytes.length / m.bytes : 0 },
      noteKey: 'b64_note_binary', noteVars: { mime: mime || '—' }, errKey: null, errVars: null,
      dataUri: isImg ? Core.buildDataUri(mime, Core.bytesToBase64(bytes)) : null,
      binary: { bytes: bytes, mime: mime, ext: ext }, mime: mime
    };
    paint();
  }
  function failDecode(m, errKey, errVars, noteKey) {
    last = {
      kind: 'error', action: 'decode', display: '', full: '',
      stats: { chars: m.chars, bytes: m.bytes, out: null, ratio: null },
      noteKey: noteKey || null, noteVars: null, errKey: errKey || null, errVars: errVars || null,
      dataUri: null, binary: null, mime: null
    };
    paint();
  }
  function errKeyFor(code) {
    return code === 'char' ? 'b64_err_char' : code === 'len' ? 'b64_err_len' : code === 'pad' ? 'b64_err_pad' : 'b64_err_binary';
  }

  /* ---------- 内核：编码 / 解码（文本与二进制两条出口） ---------- */
  function encodeText(raw, d) {
    var enc = Core.encode(raw, { wrap: 0, urlSafe: false, pad: true });
    if (opts.fmt === 'datauri') {
      var uri = Core.buildDataUri('text/plain', enc.b64);
      finishOk('encode', uri,
        { chars: enc.charsIn, bytes: enc.bytesIn, out: uri.length, ratio: enc.bytesIn ? uri.length / enc.bytesIn : 0 },
        d === 'datauri' ? 'b64_note_datauri' : null, null, { mime: 'text/plain' });
      return;
    }
    var b64 = opts.urlSafe ? Core.toUrlSafe(enc.b64, false) : enc.b64;
    if (opts.pad === false) b64 = b64.replace(/=+$/, '');
    b64 = Core.wrap(b64, opts.wrap);
    var nk = d === 'binary' ? 'b64_note_plain' : d === 'datauri' ? 'b64_note_datauri' : null;
    finishOk('encode', b64,
      { chars: enc.charsIn, bytes: enc.bytesIn, out: b64.length, ratio: enc.bytesIn ? b64.length / enc.bytesIn : 0 }, nk, null, null);
  }
  function decodeInput(raw, d) {
    var m = Core.measure(raw);
    var du = Core.parseDataUri(raw);
    if (du && !du.isBase64) {
      var txt;
      try { txt = decodeURIComponent(du.payload); } catch (e) { txt = du.payload; }
      finishOk('decode', txt,
        { chars: m.chars, bytes: m.bytes, out: txt.length, ratio: m.bytes ? txt.length / m.bytes : 0 },
        'b64_note_datauri_text', { mime: du.mime || 'text/plain' }, null);
      return;
    }
    var bytes;
    try { bytes = Core.decodeToBytes(du ? du.payload : raw); }
    catch (e) {
      if (d === 'jwt') failDecode(m, null, null, 'b64_note_jwt');
      else failDecode(m, errKeyFor(e.code), e.code === 'char' ? { n: e.position } : null, null);
      return;
    }
    var text = null, ok = false;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      ok = Core.isText(text);
    } catch (e) { ok = false; }
    if (ok) {
      finishOk('decode', text,
        { chars: m.chars, bytes: m.bytes, out: Core.measure(text).chars, ratio: m.bytes ? bytes.length / m.bytes : 0 },
        du ? 'b64_note_datauri_dec' : null, du ? { mime: du.mime || 'text/plain' } : null, null);
      return;
    }
    var mime = (du && du.mime && du.mime !== 'text/plain') ? du.mime : (Core.sniffMime(bytes) || '');
    finishBinary('decode', m, bytes, mime);
  }
  function compute() {
    if (fileSrc) { computeFromFile(); return; }
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
      action = (d === 'base64' || d === 'jwt' || d === 'datauri') ? 'decode' : 'encode';
    }
    if (action === 'encode') encodeText(raw, d);
    else decodeInput(raw, d);
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
    if (fileSrc) computeFromFile(); else compute();   // 选项是离散事件，立即重算一次
    showManual(!fileSrc && input.value.length > SOFT_LIMIT);
  }

  /* ---------- 文件导入：选择 / 拖入 / 粘贴（单文件，≤ 5MB） ---------- */
  /* HEIC/HEIF 浏览器不能直接画成 <img>：仍按字节编码，但缩略图回退文件图标、不出尺寸 */
  function previewable(mime) {
    return /^image\//.test(mime) && !/^image\/(heic|heif)$/i.test(mime);
  }
  function renderFile() {
    if (!fileSrc) {
      dzEmpty.hidden = false; dzGallery.hidden = true;
      thumbImg.hidden = true; thumbImg.removeAttribute('src'); thumbIco.hidden = false;
      return;
    }
    dzEmpty.hidden = true; dzGallery.hidden = false;
    fileCount.textContent = tr('b64_file_count', { name: fileSrc.name });
    fileType.textContent = fileSrc.mime || fileSrc.type || '—';
    fileSize.textContent = Core.fmtSize(fileSrc.size);
    var canThumb = previewable(fileSrc.mime);
    var hasDims = canThumb && fileSrc.width > 0 && fileSrc.height > 0;
    fileDimsRow.hidden = !hasDims;
    if (hasDims) fileDims.textContent = fileSrc.width + ' × ' + fileSrc.height;
    fileEncoded.textContent = String(fileSrc.b64.length);
    if (canThumb) {
      thumbImg.src = fileSrc.dataUri; thumbImg.hidden = false; thumbIco.hidden = true;
    } else {
      thumbImg.hidden = true; thumbImg.removeAttribute('src'); thumbIco.hidden = false;
    }
  }
  function loadDims(file) {
    var owner = fileSrc;   // 只回填本次导入，避免旧图的解码回调串到新文件
    function done(w, h) {
      if (!fileSrc || fileSrc !== owner) return;
      fileSrc.width = w; fileSrc.height = h; renderFile();
    }
    function legacy() {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); done(img.naturalWidth || img.width, img.naturalHeight || img.height); };
      img.onerror = function () { URL.revokeObjectURL(url); };
      img.src = url;
    }
    if (window.createImageBitmap) {
      window.createImageBitmap(file).then(function (bmp) {
        done(bmp.width, bmp.height);
        try { bmp.close(); } catch (e) {}
      }).catch(legacy);
    } else legacy();
  }
  function computeFromFile() {
    if (!fileSrc) { setEmpty(); return; }
    var out;
    if (opts.fmt === 'datauri') out = fileSrc.dataUri;
    else {
      var b64 = fileSrc.b64;
      if (opts.urlSafe) b64 = Core.toUrlSafe(b64, false);
      if (opts.pad === false) b64 = b64.replace(/=+$/, '');
      out = Core.wrap(b64, opts.wrap);
    }
    finishOk('encode', out,
      { chars: null, bytes: fileSrc.size, out: out.length, ratio: fileSrc.size ? out.length / fileSrc.size : 0 },
      'b64_note_file', { name: fileSrc.name },
      { dataUri: previewable(fileSrc.mime) ? fileSrc.dataUri : null, mime: fileSrc.mime });
  }
  function importFiles(list) {
    var f = list && list[0];
    if (!f) return;
    if (f.size > FILE_LIMIT) {   // S7：超限拒收，保留上一次结果
      toast(tr('b64_too_big', { n: Core.fmtSize(f.size), m: Core.fmtSize(FILE_LIMIT) }), 'error');
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      var uri = String(fr.result || '');
      var du = Core.parseDataUri(uri);
      if (!du || !du.isBase64) { toast(tr('b64_import_fail'), 'error'); return; }
      fileSrc = {
        name: f.name || 'file', type: f.type || du.mime, mime: du.mime, size: f.size,
        b64: du.payload.replace(/\s/g, ''), dataUri: uri, width: 0, height: 0
      };
      input.value = '';        // 文件成为唯一输入，清掉旧正文避免两套输入并存
      showManual(false);
      renderFile();
      if (previewable(fileSrc.mime)) loadDims(f);
      computeFromFile();
    };
    fr.onerror = function () { toast(tr('b64_import_fail'), 'error'); };
    fr.readAsDataURL(f);
  }
  function clearFile(silent) {
    fileSrc = null;
    if (fileInput) fileInput.value = '';
    renderFile();
    if (!silent) setEmpty();
  }
  function pickFile() { if (fileInput) fileInput.click(); }

  /* ---------- 动作：复制 / 下载 / 互换 / 示例 / 清空 ---------- */
  function flashBtn(btn, doneKey, baseKey) {
    var span = btn && btn.querySelector('span[data-i18n]');
    if (!span) return;
    setI18n(span, doneKey);
    if (btn.__b64Timer) clearTimeout(btn.__b64Timer);
    btn.__b64Timer = setTimeout(function () { setI18n(span, baseKey); }, COPIED_MS);
  }
  function recommend(key) {
    if (window.Moteful && window.Moteful.recommend) {
      try { window.Moteful.recommend.show({ actionKey: key }); } catch (e) {}
    }
  }
  function copyValue(text, btn, baseKey) {
    if (!text) return;
    if (MF.copyText) MF.copyText(text);           // 不传 btn：避开硬编码「已复制 ✓」，自管三语标签
    flashBtn(btn, 'b64_copied', baseKey || 'b64_copy');
    recommend('rec_copy');
  }
  function onCopy() { if (last.kind === 'ok') copyValue(last.full, copyBtn, 'b64_copy'); }
  function onCopyDataUri() {
    if (!fileSrc) return;
    copyValue(fileSrc.dataUri, fileDataUri, 'b64_file_copy_datauri');
  }
  function onSnipImg() {
    if (!last.dataUri) return;
    copyValue('<img src="' + last.dataUri + '" alt="">', snipImg, 'b64_snippet_img');
  }
  function onSnipCss() {
    if (!last.dataUri) return;
    copyValue('background-image:url("' + last.dataUri + '");', snipCss, 'b64_snippet_css');
  }
  function closeExt() { if (MF.closeModal && extModal) { try { MF.closeModal(extModal); } catch (e) {} } }
  function saveBinary(ext) {
    if (!last.binary) return;
    var blob = new Blob([last.binary.bytes], { type: last.binary.mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = DOWNLOAD_BASE + (ext.charAt(0) === '.' ? ext : '.' + ext);   // extForMime 自带点，避免双点
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    closeExt();
    toast(tr('b64_downloaded'), 'success');
    recommend('rec_download');
  }
  function onDownload() {
    if (last.kind !== 'binary' || !last.binary) return;
    if (last.binary.ext) { saveBinary(last.binary.ext); return; }
    if (extErr) extErr.hidden = true;
    if (extInput) extInput.value = '';
    if (MF.openModal) MF.openModal('b64ExtModal');
    setTimeout(function () { if (extInput) extInput.focus(); }, 30);
  }
  function onExtConfirm() {
    var ext = (extInput.value || '').replace(/^\./, '').replace(/\s/g, '').toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(ext)) {
      if (extErr) extErr.hidden = false;
      return;
    }
    saveBinary(ext);
  }
  function onSwap() {
    if (!last.full) return;
    if (fileSrc) clearFile(true);
    input.value = last.full;
    scheduleCompute();
    input.focus();
  }
  function onSample() {
    if (fileSrc) clearFile(true);
    input.value = '你好，Moteful！Base64 编解码 😀';
    scheduleCompute();
    input.focus();
  }
  function onClear() { if (MF.openModal) MF.openModal('b64ClearModal'); }
  function onClearConfirm() {
    input.value = '';
    if (MF.closeModal && clearModal) { try { MF.closeModal(clearModal); } catch (e) {} }
    clearFile(true);
    showManual(false);
    setEmpty();
    toast(tr('b64_clear_done'), 'success');
    input.focus();
  }

  /* ---------- 拖拽与粘贴（只在文件拖拽时接管，文本拖拽仍归浏览器默认） ---------- */
  function isFileDrag(e) {
    var dt = e.dataTransfer;
    return !!(dt && dt.types && Array.prototype.indexOf.call(dt.types, 'Files') >= 0);
  }
  function bindDrop(el) {
    if (!el) return;
    ['dragenter', 'dragover'].forEach(function (name) {
      el.addEventListener(name, function (e) {
        if (!isFileDrag(e)) return;
        e.preventDefault(); e.stopPropagation();
        el.classList.add('drag');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (name) {
      el.addEventListener(name, function (e) {
        if (name === 'drop') {
          if (!isFileDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          importFiles(e.dataTransfer.files);
        }
        el.classList.remove('drag');
      });
    });
  }

  /* ---------- 绑定与初始化 ---------- */
  function bind() {
    input.addEventListener('input', function () {
      if (fileSrc) clearFile(true);
      scheduleCompute();
    });
    run.addEventListener('click', function () { compute(); });
    sampleBtn.addEventListener('click', onSample);
    clearBtn.addEventListener('click', onClear);
    copyBtn.addEventListener('click', onCopy);
    swapBtn.addEventListener('click', onSwap);
    downloadBtn.addEventListener('click', onDownload);
    snipImg.addEventListener('click', onSnipImg);
    snipCss.addEventListener('click', onSnipCss);
    clearConfirm.addEventListener('click', onClearConfirm);
    extConfirm.addEventListener('click', onExtConfirm);
    extInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') onExtConfirm(); });
    importBtn.addEventListener('click', pickFile);
    fileDataUri.addEventListener('click', onCopyDataUri);
    fileRemove.addEventListener('click', function () { clearFile(false); toast(tr('b64_file_removed'), 'success'); });
    fileInput.addEventListener('change', function () { importFiles(fileInput.files); });
    if (dropzone) {
      dropzone.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        pickFile();
      });
      dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); }
      });
    }
    bindDrop(dropzone);
    bindDrop(inputPanel);
    if (window.MFImageImport && window.MFImageImport.enablePaste) {
      window.MFImageImport.enablePaste(function (files) { importFiles(files); });
    }
    /* 同族选项控件用 document 级委托，跨卡也不漏听 */
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'b64Mode' || t.name === 'b64Fmt' || t.name === 'b64Wrap' || t.id === 'b64UrlSafe' || t.id === 'b64Pad') onOptChange();
    });
    document.addEventListener('moteful:langchange', function () {
      renderFile();
      paint();
    });
  }
  readConfig(); applyOptsToUI(); bind(); renderFile(); compute();
})();
