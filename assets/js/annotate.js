/*
 * Moteful 标注工具页面编排（V0.6）
 * 职责：导入接线、水印/打码模式切换、参数接线、预览渲染调度、
 *       水印渲染（文字/图片/平铺/时间戳）、打码交互（矩形框选/画笔涂抹/撤销重做）、
 *       导出调度（单张 + ZIP）、配置记忆、5 秒自动清除。
 *
 * 依赖：moteful.js（MF.toast / MF.refreshIcons）、image-import.js（MFImageImport）、
 *       zip.js（MotefulZip）、annotate-core.js（MFAnnotateCore）、i18n.js（DICT/currentLang）
 *
 * 铁律：所有展示文案走 i18n 集中源，本文件不含硬编码文案；
 *       不新建视觉样式类，只使用 moteful.css 白名单类与 annotate.css 页面私有样式。
 */
(function () {
  'use strict';

  var Core = window.MFAnnotateCore;

  /* ---------- i18n 辅助 ---------- */
  function tr(key) {
    var d = (window.DICT && window.DICT[window.currentLang]) || {};
    return (d[key] != null) ? d[key] : key;
  }
  function trn(key, n) { return String(tr(key)).replace('{n}', n); }

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function setHidden(el, on) { if (el) el.hidden = !!on; }
  function radioVal(name, fb) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : fb;
  }
  function setRadio(name, value) {
    var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function numOf(id, fb) {
    var el = $(id);
    var v = el ? parseInt(el.textContent, 10) : NaN;
    return isNaN(v) ? fb : v;
  }
  function setNum(id, v) { var el = $(id); if (el) el.textContent = String(v); }
  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function toast(msg, type) {
    if (window.MF && window.MF.toast) window.MF.toast(msg, type || 'info');
  }

  /* ---------- 常量 ---------- */
  var CONFIG_KEY = 'moteful.annotate.config';
  var CONFIG_VER = 1;
  var MAX_PREVIEW = 1200;     // 预览最长边
  var MAX_SIDE = 8000;        // 导出大图护栏
  var WIPE_MS = 5000;         // 自动清除延迟
  // canvas 绘制用绝对色（水印盖在图片上，不随界面主题变化）
  var INK = { white: '#ffffff', black: '#000000', plate: '#ffffff' };

  /* ---------- 默认配置 ---------- */
  var DEFAULTS = {
    mode: 'wm', wmType: 'text', content: '© Moteful',
    color: 'auto', size: 24, opacity: 80, angle: 0,
    ax: 'right', ay: 'bottom', margin: 24, tileGap: 160, timeFmt: 'date',
    msMode: 'rect', block: 12, brush: 24,
    fmt: 'png', quality: 92
  };

  /* ---------- 状态 ---------- */
  var state = {
    cfg: null,
    mode: 'wm', wmType: 'text',
    color: 'auto', size: 24, opacity: 80, angle: 0,
    ax: 'right', ay: 'bottom', margin: 24, tileGap: 160, timeFmt: 'date',
    msMode: 'rect', block: 12, brush: 24,
    fmt: 'png', quality: 92,   // 质量固定 92：导出区不再提供质量控件（v0.6.2）
    importer: null,
    currentId: null,
    waterImg: null,          // { img, w, h, name }
    msOps: [], msRedo: [],   // 打码操作栈（归一化坐标）
    drag: null,
    fit: null, ctx: null,
    msCache: null,           // 打码底图缓存（原图 + 已提交操作）
    lumaKey: '', lumaVal: null,
    exporting: false,
    wipeTimer: 0,
    renderTimer: 0
  };

  var el = {};

  function cacheEl() {
    el.fileInput = $('annotateFileInput');
    el.wmFileInput = $('annotateWmFileInput');
    el.drop = $('annotateImport');
    el.params = $('annotateParams');
    el.wmPanel = $('annotate-wm');
    el.msPanel = $('annotate-ms');
    el.wmPick = $('annotateWmPick');
    el.wmDrop = $('annotateWmDrop');
    el.wmName = $('annotateWmName');
    el.wmContent = $('annotateWmContent');
    el.previewPanel = $('annotatePreviewPanel');
    el.stage = $('annotateStage');
    el.canvas = $('annotateCanvas');
    el.grid = $('annotateGrid');
    el.exportPanel = $('annotateExportPanel');
    el.progress = $('annotateProgress');
    el.progressFill = $('annotateProgressFill');
    el.progressTxt = $('annotateProgressTxt');
    el.dzEmpty = $('annotateDzEmpty');
    el.gallery = $('annotateGallery');
    el.queueCount = $('annotateQueueCount');
    el.thumbs = $('annotateThumbs');
    el.addMore = $('annotateAddMore');
  el.brushCur = $('annotateBrushCursor');
    el.blockSlider = $('annotateMsBlockSlider');
    el.brushSlider = $('annotateMsBrushSlider');
    el.clearAll = $('annotateClearAll');
    el.msUndo = $('annotateMsUndo');
    el.msRedo = $('annotateMsRedo');
    el.msClear = $('annotateMsClear');
    el.exportBtn = document.querySelector('[data-export]');
    el.zipBtn = document.querySelector('[data-export-zip]');
    if (el.canvas) state.ctx = el.canvas.getContext('2d');
  }

  /* ============================================================
   * 配置记忆
   * ============================================================ */
  function readConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.__version !== CONFIG_VER) return null;
      return o;
    } catch (e) { return null; }
  }

  function writeConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        __version: CONFIG_VER,
        mode: state.mode, wmType: state.wmType,
        content: state.wmContentValue(), color: state.color, size: state.size,
        opacity: state.opacity, angle: state.angle,
        ax: state.ax, ay: state.ay, margin: state.margin,
        tileGap: state.tileGap, timeFmt: state.timeFmt,
        msMode: state.msMode, block: state.block, brush: state.brush,
        fmt: state.fmt, quality: state.quality
      }));
    } catch (e) { /* 隐私模式等场景静默失败 */ }
  }
  var writeConfigSoon = debounce(writeConfig, 300);

  // 便于 save 时读取当前输入框文案（不污染 state 语义）
  state.wmContentValue = function () {
    return el.wmContent ? el.wmContent.value : DEFAULTS.content;
  };

  function applyConfigToUI(cfg) {
    cfg = cfg || DEFAULTS;
    setRadio('annotateMode', cfg.mode);
    setRadio('annotateWmType', cfg.wmType);
    setRadio('annotateWmColor', cfg.color);
    setRadio('annotateWmH', cfg.ax);
    setRadio('annotateWmV', cfg.ay);
    setRadio('annotateWmFmt', cfg.timeFmt);
    /* msMode 允许 null（关闭态）：显式清空选中，否则 HTML 里 rect 的 checked 会复活成矩形 */
    if (cfg.msMode) setRadio('annotateMsMode', cfg.msMode);
    else $$('input[name="annotateMsMode"]').forEach(function (x) { x.checked = false; });
    setRadio('annotateFmt', cfg.fmt);
    if (el.wmContent) el.wmContent.value = cfg.content;
    setNum('annotateWmSize', cfg.size);
    setNum('annotateWmOpacity', cfg.opacity);
    setNum('annotateWmAngle', cfg.angle);
    setNum('annotateWmMargin', cfg.margin);
    setNum('annotateWmTileGap', cfg.tileGap);
    setNum('annotateMsBlock', cfg.block);
    setNum('annotateMsBrush', cfg.brush);
  }

  /* ============================================================
   * 从界面读参数
   * ============================================================ */
  function readUI() {
    state.mode = radioVal('annotateMode', 'wm');
    state.wmType = radioVal('annotateWmType', 'text');
    state.color = radioVal('annotateWmColor', 'auto');
    state.ax = radioVal('annotateWmH', 'right');
    state.ay = radioVal('annotateWmV', 'bottom');
    state.timeFmt = radioVal('annotateWmFmt', 'date');
    /* msMode 允许 null（打码方式「再点一次取消」后的关闭态：两按钮都不选中） */
    state.msMode = radioVal('annotateMsMode', null);
    state.fmt = radioVal('annotateFmt', 'png');
    state.size = numOf('annotateWmSize', 24);
    state.opacity = numOf('annotateWmOpacity', 80);
    state.angle = numOf('annotateWmAngle', 0);
    state.margin = numOf('annotateWmMargin', 24);
    state.tileGap = numOf('annotateWmTileGap', 160);
    state.block = numOf('annotateMsBlock', 12);
    state.brush = numOf('annotateMsBrush', 24);
  }

  /* ============================================================
   * 布局状态切换
   * ============================================================ */
  function updateMode() {
    var wm = state.mode === 'wm';
    setHidden(el.wmPanel, !wm);
    setHidden(el.msPanel, wm);
    render();
  }

  function updateWmFields() {
    $$('[data-wm-when]', el.params).forEach(function (f) {
      var list = (f.getAttribute('data-wm-when') || '').split(/\s+/);
      setHidden(f, list.indexOf(state.wmType) < 0);
    });
  }

  // 导入区双态（空态 / 缩略图画廊）+ 后续卡片显隐：空队列时只留导入卡
  function updateImportState() {
    var n = state.importer ? state.importer.count() : 0;
    setHidden(el.dzEmpty, n > 0);
    setHidden(el.gallery, n === 0);
    if (el.drop) el.drop.classList.toggle('mini', n > 0);
    setHidden(el.params, n === 0);
    setHidden(el.previewPanel, n === 0);
    setHidden(el.exportPanel, n === 0);
    var ready = state.importer ? state.importer.readyCount() : 0;
    if (el.exportBtn) el.exportBtn.disabled = state.exporting || ready === 0;
    if (el.zipBtn) el.zipBtn.disabled = state.exporting || ready === 0;
    if (el.clearAll) el.clearAll.disabled = state.exporting || n === 0;
    if (el.queueCount) el.queueCount.textContent = n ? trn('annotate_queue_count', n) : '';
  }

  function updateUndoBtns() {
    setHidden(el.msUndo, false);
    if (el.msUndo) el.msUndo.disabled = state.msOps.length === 0;
    if (el.msRedo) el.msRedo.disabled = state.msRedo.length === 0;
    if (el.msClear) el.msClear.disabled = state.msOps.length === 0;
  }

  /* ============================================================
   * 队列与当前图
   * ============================================================ */
  function currentItem() {
    if (!state.importer) return null;
    var q = state.importer.queue;
    for (var i = 0; i < q.length; i++) {
      if (q[i].id === state.currentId && q[i].status === 'ready') return q[i];
    }
    var ready = state.importer.getReadyImages();
    if (ready.length) { state.currentId = ready[0].id; return ready[0]; }
    return null;
  }

  function renderQueue() {
    var items = state.importer ? state.importer.queue : [];
    if (el.thumbs) {
      el.thumbs.innerHTML = '';
      items.forEach(function (it, i) {
        var node = document.createElement('div');
        node.className = 'dz-thumb';
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        if (it.id === state.currentId) node.setAttribute('aria-current', 'true');
        node.dataset.id = it.id;
        node.innerHTML =
          '<span class="dz-idx">' + (i + 1) + '</span>' +
          (it.thumbUrl ? '<img src="' + it.thumbUrl + '" alt="">' : '') +
          '<button type="button" class="dz-rm" data-rm="' + it.id + '" aria-label="' +
          tr('annotate_thumb_remove') + '"><i data-lucide="x"></i></button>';
        el.thumbs.appendChild(node);
      });
    }
    updateImportState();
    if (window.MF && window.MF.refreshIcons) window.MF.refreshIcons();
  }

  function selectImage(id) {
    if (state.mode === 'wm') {
      scrollPreviewTo(id);
      if (state.currentId !== id) {
        state.currentId = id;
        renderQueue();
      }
      return;
    }
    if (state.currentId === id) return;
    state.currentId = id;
    resetMsCache();
    state.lumaKey = '';
    renderQueue();
    ensureExif(cur()).then(function () { render(); });
  }

  function scrollPreviewTo(id) {
    if (!el.grid || el.grid.hidden || !state.importer) return;
    var items = state.importer.getReadyImages();
    var idx = -1;
    items.forEach(function (it, i) { if (it.id === id) idx = i; });
    if (idx >= 0 && el.grid.children[idx]) {
      el.grid.children[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function cur() {
    if (!state.importer) return null;
    var q = state.importer.queue;
    for (var i = 0; i < q.length; i++) if (q[i].id === state.currentId) return q[i];
    return null;
  }

  // EXIF：仅 JPEG 解析一次；失败回退当前时间
  function ensureExif(item) {
    if (!item || item._exifDone) return Promise.resolve(item ? item.exifDate : null);
    item._exifDone = true;
    var isJpg = /jpe?g/i.test(item.type || '') || /\.jpe?g$/i.test(item.name || '');
    if (!isJpg || !item.file || !item.file.arrayBuffer) {
      item.exifDate = null;
      return Promise.resolve(null);
    }
    return item.file.arrayBuffer().then(function (buf) {
      item.exifDate = Core.parseExifDate(buf);
      if (!item.exifDate && state.wmType === 'time') toast(tr('annotate_no_exif'), 'warning');
      return item.exifDate;
    }).catch(function () { item.exifDate = null; return null; });
  }

  function initImporter() {
    state.importer = new window.MFImageImport({
      onChange: function () { renderQueue(); render(); },
      onImport: function (added, dup, bad, heic) {
        if (heic) toast(tr('annotate_import_heic'), 'warning');
        if (bad) toast(trn('annotate_import_bad', bad), 'warning');
        if (dup) toast(trn('annotate_import_dup', dup), 'info');
        if (added) {
          cancelWipe();
          if (!cur()) {
            var ready = state.importer.getReadyImages();
            if (ready.length) state.currentId = ready[0].id;
          }
          toast(trn('annotate_import_added', added), 'success');
        }
      },
      onError: function () { toast(tr('annotate_err_decode'), 'danger'); }
    });
  }

  /* ============================================================
   * 预览渲染
   * ============================================================ */
  function fitPreview(it) {
    var availW = el.stage ? (el.stage.clientWidth - 32) : 960;
    var maxW = Math.min(Math.max(160, availW), MAX_PREVIEW);
    var s = Math.min(1, maxW / it.width);
    var dw = Math.max(1, Math.round(it.width * s));
    var dh = Math.max(1, Math.round(it.height * s));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    return { dw: dw, dh: dh, pw: Math.round(dw * dpr), ph: Math.round(dh * dpr), dpr: dpr };
  }

  // 网格预览：每张图限制最大显示宽度，保持原比例
  function fitGridItem(it) {
    var maxW = 240;
    var s = Math.min(1, maxW / it.width);
    var dw = Math.max(1, Math.round(it.width * s));
    var dh = Math.max(1, Math.round(it.height * s));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    return { dw: dw, dh: dh, pw: Math.round(dw * dpr), ph: Math.round(dh * dpr), dpr: dpr };
  }

  function render() {
    syncMsSliders();
    if (state.mode === 'ms') {
      renderSingle();
      syncBrushCursor();
      return;
    }
    syncBrushCursor();
    renderGrid();
  }

  /* 大小/直径滑杆与步进器双向同步（仿 image-tool 质量模式）：
     值的单一来源是 .step-val 的 textContent（readUI 链路），render 汇聚点处
     把 state 回写到滑杆（value + --p 进度填充），步进器/手动编辑/配置恢复
     改值后滑杆自动跟随。 */
  function syncMsSliders() {
    [[el.blockSlider, 'annotateMsBlock'], [el.brushSlider, 'annotateMsBrush']].forEach(function (pair) {
      var slider = pair[0], textEl = $(pair[1]);
      if (!slider || !textEl) return;
      var v = parseInt(textEl.textContent, 10);
      if (isNaN(v)) return;
      var stepBox = textEl.closest('.step');
      var min = stepBox ? +(stepBox.dataset.min || 0) : 0;
      var max = stepBox ? +(stepBox.dataset.max || 100) : 100;
      v = Math.max(min, Math.min(max, v));
      var sv = String(v);
      if (slider.value !== sv) slider.value = sv;
      slider.style.setProperty('--p', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%');
    });
  }

  /* 打码画笔光标：仅在「打码模式 + 画笔工具 + 悬停画布」时显示；
     直径与实际涂抹直径一致（clamp(brush,8,80) × scaleFor），隐藏原生指针。 */
  function syncBrushCursor() {
    if (!el.brushCur || !el.stage) return;
    var brushOn = state.mode === 'ms' && state.msMode === 'brush';
    /* 关闭态（打码方式再点一次取消）：画布指针还原为普通箭头，不再是绘制十字 */
    el.stage.classList.toggle('brush-mode', brushOn);
    el.stage.classList.toggle('tool-off', state.mode === 'ms' && !state.msMode);
    var on = brushOn && state.brushHover && el.canvas && !el.canvas.hidden && !!currentItem();
    el.brushCur.hidden = !on;
    if (on && state.fit) {
      var d = Math.max(6, Core.clamp(state.brush, 8, 80) * Core.scaleFor(state.fit.dw, state.fit.dh));
      el.brushCur.style.width = d + 'px';
      el.brushCur.style.height = d + 'px';
    }
  }

  function renderSingle() {
    if (el.grid) { el.grid.hidden = true; }
    if (el.stage) { el.stage.classList.remove('grid'); }
    var it = currentItem();
    if (!it || !el.canvas || !state.ctx) return;
    if (el.canvas.hidden) el.canvas.hidden = false;
    var fit = fitPreview(it);
    state.fit = fit;
    var cv = el.canvas;
    if (cv.width !== fit.pw || cv.height !== fit.ph) {
      cv.width = fit.pw; cv.height = fit.ph;
      cv.style.width = fit.dw + 'px';
      cv.style.height = fit.dh + 'px';
      resetMsCache();
    }
    var ctx = state.ctx;
    ctx.setTransform(fit.dpr, 0, 0, fit.dpr, 0, 0);
    ctx.clearRect(0, 0, fit.dw, fit.dh);
    ctx.drawImage(it.img, 0, 0, fit.dw, fit.dh);

    if (state.mode === 'wm') {
      drawWatermark(ctx, fit.dw, fit.dh, it);
    } else {
      ensureMsCache(it, fit);
      if (state.msCache) ctx.drawImage(state.msCache.canvas, 0, 0, fit.dw, fit.dh);
      drawDragPreview(ctx);
    }
    updateStageAria(it);
  }

  function renderGrid() {
    var items = state.importer ? state.importer.getReadyImages() : [];
    if (!items.length || !el.grid || !el.stage) return;
    if (el.canvas) el.canvas.hidden = true;
    el.grid.hidden = false;
    el.stage.classList.add('grid');

    var tpl = tr('annotate_aria_stage');
    var existing = Array.from(el.grid.children);
    items.forEach(function (it, i) {
      var node = existing[i];
      if (!node) {
        node = document.createElement('div');
        node.className = 'annotate-preview-item';
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.addEventListener('click', function () {
          openLightbox(parseInt(node.dataset.idx, 10) || 0, node);
        });
        node.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openLightbox(parseInt(node.dataset.idx, 10) || 0, node);
          }
        });
        var c = document.createElement('canvas');
        c.setAttribute('role', 'img');
        node.appendChild(c);
        el.grid.appendChild(node);
      }
      node.dataset.idx = i;
      node.setAttribute('aria-label',
        String(tpl).replace('{n}', items.length).replace('{i}', i + 1));
      var c = node.querySelector('canvas');
      var fit = fitGridItem(it);
      if (c.width !== fit.pw || c.height !== fit.ph) {
        c.width = fit.pw; c.height = fit.ph;
      }
      c.style.width = '100%';
      c.style.height = 'auto';
      var ctx = c.getContext('2d');
      ctx.setTransform(fit.dpr, 0, 0, fit.dpr, 0, 0);
      ctx.clearRect(0, 0, fit.dw, fit.dh);
      ctx.drawImage(it.img, 0, 0, fit.dw, fit.dh);
      drawWatermark(ctx, fit.dw, fit.dh, it);
    });
    while (existing.length > items.length) {
      el.grid.removeChild(existing.pop());
    }
  }

  /* ---------- 放大预览灯箱（复用 compare.js 的 window.MFCompare） ---------- */
  // 为每张图生成「原图 / 标注后」两张预览图，按当前模式套用水印或马赛克。
  function renderPreviewPair(it) {
    var MAX = 1400;
    var long = Math.max(it.width, it.height) || 1;
    var s = Math.min(1, MAX / long);
    var w = Math.max(1, Math.round(it.width * s));
    var h = Math.max(1, Math.round(it.height * s));
    var b = document.createElement('canvas'); b.width = w; b.height = h;
    var bc = b.getContext('2d');
    bc.drawImage(it.img, 0, 0, w, h);
    var beforeUrl = b.toDataURL('image/png');
    var a = document.createElement('canvas'); a.width = w; a.height = h;
    var ac = a.getContext('2d');
    if (state.mode === 'wm') {
      ac.drawImage(it.img, 0, 0, w, h);
      drawWatermark(ac, w, h, it);
    } else {
      ac.drawImage(it.img, 0, 0, w, h);
      applyMosaicOps(ac, w, h);
    }
    var afterUrl = a.toDataURL('image/png');
    return { beforeUrl: beforeUrl, afterUrl: afterUrl };
  }

  function openLightbox(index, triggerEl) {
    if (!window.MFCompare) return;
    var items = state.importer ? state.importer.getReadyImages() : [];
    if (!items.length) return;
    var modalItems = items.map(function (it) {
      var pair = renderPreviewPair(it);
      var dim = it.width + ' × ' + it.height;
      return {
        id: it.id,
        name: it.name,
        origSize: dim,
        newSize: dim,
        rateText: '',
        beforeUrl: pair.beforeUrl,
        afterUrl: pair.afterUrl
      };
    });
    if (index < 0) index = 0;
    if (index >= modalItems.length) index = modalItems.length - 1;
    window.MFCompare.open(modalItems, index, triggerEl || null);
  }

  function scheduleRender(ms) {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(render, ms || 0);
  }

  function updateStageAria(it) {
    if (!el.canvas) return;
    var n = state.importer ? state.importer.count() : 0;
    var idx = 1;
    if (state.importer) {
      state.importer.queue.forEach(function (q, i) { if (q.id === it.id) idx = i + 1; });
    }
    var tpl = tr('annotate_aria_stage');
    el.canvas.setAttribute('aria-label',
      String(tpl).replace('{n}', n).replace('{i}', idx));
  }

  /* ---------- 水印绘制 ---------- */

  function unitText(it) {
    if (state.wmType === 'time') {
      var d = (it && it.exifDate) || new Date();
      return Core.formatDate(d, state.timeFmt);
    }
    return el.wmContent ? (el.wmContent.value || '') : '';
  }

  // 构建"可绘制水印单元"：文字 → 文本行；图片 → Image
  function buildUnit(ctx, W, H, it) {
    var useImage = (state.wmType === 'image') || (state.wmType === 'tile' && !!state.waterImg);
    if (useImage && state.waterImg) {
      var u = Core.measureImageUnit(state.waterImg.w, state.waterImg.h, state.size, W);
      return { kind: 'image', w: u.w, h: u.h, img: state.waterImg.img };
    }
    if (state.wmType === 'image') return null;   // 选了图片水印但未上传 → 不绘制
    var fp = Core.fontSize(state.size, W, H);
    var text = unitText(it);
    if (!text) return null;
    ctx.font = '600 ' + fp + 'px system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
    var m = Core.measureTextUnit(ctx, text, fp);
    return { kind: 'text', w: m.w, h: m.h, lines: m.lines, lineHeight: m.lineHeight, fontSize: fp };
  }

  function drawUnit(ctx, unit, cx, cy, rot, alpha, color) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    if (unit.kind === 'image') {
      ctx.drawImage(unit.img, -unit.w / 2, -unit.h / 2, unit.w, unit.h);
    } else {
      ctx.fillStyle = color || INK.white;
      ctx.font = '600 ' + unit.fontSize + 'px system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var y0 = -unit.h / 2 + unit.lineHeight / 2;
      for (var i = 0; i < unit.lines.length; i++) {
        ctx.fillText(unit.lines[i], 0, y0 + i * unit.lineHeight);
      }
    }
    ctx.restore();
  }

  // 自动色：按底图平均亮度选黑白（结果按图缓存，避免每帧 getImageData）
  function resolveColor(ctx, W, H, it) {
    if (state.color === 'white') return INK.white;
    if (state.color === 'black') return INK.black;
    var key = (it ? it.id : '') + '|' + W + 'x' + H;
    if (state.lumaKey !== key || state.lumaVal == null) {
      state.lumaKey = key;
      state.lumaVal = Core.avgLuma(ctx.getImageData(0, 0, W, H).data);
    }
    return Core.autoColor(state.lumaVal) === 'white' ? INK.white : INK.black;
  }

  function drawWatermark(ctx, W, H, it) {
    var unit = buildUnit(ctx, W, H, it);
    if (!unit || !unit.w || !unit.h) return;
    var alpha = Core.clamp(state.opacity, 10, 100) / 100;
    var color = unit.kind === 'text' ? resolveColor(ctx, W, H, it) : null;
    var angle = state.angle;

    if (state.wmType === 'tile') {
      var gap = Core.tileGapPx(state.tileGap, W, H);
      var items = Core.tilingGrid(unit.w, unit.h, gap, angle, W, H);
      for (var i = 0; i < items.length; i++) {
        drawUnit(ctx, unit, items[i].x + items[i].boxW / 2, items[i].y + items[i].boxH / 2, items[i].rot, alpha, color);
      }
    } else {
      var pos = Core.anchorToXY({ x: state.ax, y: state.ay }, state.margin, unit.w, unit.h, W, H);
      drawUnit(ctx, unit, pos.x + unit.w / 2, pos.y + unit.h / 2, angle, alpha, color);
    }
  }

  /* ---------- 打码绘制 ---------- */

  function resetMsCache() { state.msCache = null; }

  function ensureMsCache(it, fit) {
    var key = state.msOps.length + ':' + state.block + ':' + fit.dw + 'x' + fit.dh;
    if (state.msCache && state.msCache.key === key) return;
    var c = document.createElement('canvas');
    c.width = fit.dw; c.height = fit.dh;
    var cc = c.getContext('2d');
    cc.drawImage(it.img, 0, 0, fit.dw, fit.dh);
    applyMosaicOps(cc, fit.dw, fit.dh);
    state.msCache = { canvas: c, key: key };
  }

  function applyMosaicOps(ctx, W, H) {
    var blockPx = Math.max(1, Core.clamp(state.block, 4, 40) * Core.scaleFor(W, H));
    var brushPx = Math.max(2, Core.clamp(state.brush, 8, 80) * Core.scaleFor(W, H));
    for (var i = 0; i < state.msOps.length; i++) {
      var op = state.msOps[i];
      if (op.type === 'rect') {
        var r = Core.normToRect(op.rect, W, H);
        Core.mosaicRect(ctx, r.x, r.y, r.w, r.h, blockPx);
      } else {
        var pts = Core.normToPath(op.points, W, H);
        for (var k = 0; k < pts.length; k++) {
          Core.mosaicRect(ctx, pts[k].x - brushPx / 2, pts[k].y - brushPx / 2, brushPx, brushPx, blockPx);
        }
      }
    }
  }

  /* 画笔实时换算：与正式渲染（applyMosaicOps / finish 重采样）同参数。
     返回物理像素系的 brush/block/step，供实时打码使用。 */
  function brushMetrics() {
    var fit = state.fit;
    var dpr = fit ? fit.dpr : 1;
    var brushDw = Math.max(2, Core.clamp(state.brush, 8, 80) * Core.scaleFor(fit ? fit.dw : 1, fit ? fit.dh : 1));
    var blockDw = Math.max(1, Core.clamp(state.block, 4, 40) * Core.scaleFor(fit ? fit.dw : 1, fit ? fit.dh : 1));
    return { dpr: dpr, brush: brushDw * dpr, block: blockDw * dpr, step: Math.max(2, brushDw / 3) };
  }

  /* 实时涂抹：在主画布上对新点增量打码（不走全量重画，保证跟手不卡）。
     坐标从显示系换算到物理系后调用 mosaicRect（其取样/边界均按 canvas 物理尺寸）。 */
  function paintStrokeLive(d, p) {
    var fit = state.fit, ctx = state.ctx;
    if (!fit || !ctx) return;
    var m = brushMetrics();
    if (d.lastPainted) {
      var dx = p.x - d.lastPainted.x, dy = p.y - d.lastPainted.y;
      if (dx * dx + dy * dy < m.step * m.step) return;
    }
    d.lastPainted = p;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    Core.mosaicRect(ctx, p.x * m.dpr - m.brush / 2, p.y * m.dpr - m.brush / 2, m.brush, m.brush, m.block);
    ctx.restore();
  }

  function drawDragPreview(ctx) {
    var d = state.drag;
    if (!d || !d.active) return;
    if (d.mode === 'rect') {
      ctx.save();
      ctx.strokeStyle = cssVar('--primary') || INK.white;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      var x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      var w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
      return;
    }
    /* 画笔：兜底全量重画已涂路径为实时打码效果（render 被外部触发时保持画面完整；
       常规拖拽中由 pointermove 的 paintStrokeLive 增量绘制，这里只在重画时补齐）。 */
    var fit = state.fit;
    if (!fit) return;
    var m = brushMetrics();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var last = null;
    for (var i = 0; i < d.points.length; i++) {
      var p = d.points[i];
      if (last) {
        var dx = p.x - last.x, dy = p.y - last.y;
        if (dx * dx + dy * dy < m.step * m.step) continue;
      }
      last = p;
      Core.mosaicRect(ctx, p.x * m.dpr - m.brush / 2, p.y * m.dpr - m.brush / 2, m.brush, m.brush, m.block);
    }
    ctx.restore();
  }

  /* ============================================================
   * 打码交互（矩形框选 / 画笔涂抹）
   * ============================================================ */
  function canvasXY(e) {
    var r = el.canvas.getBoundingClientRect();
    var dw = state.fit ? state.fit.dw : r.width;
    var dh = state.fit ? state.fit.dh : r.height;
    return {
      x: (e.clientX - r.left) * (dw / (r.width || 1)),
      y: (e.clientY - r.top) * (dh / (r.height || 1))
    };
  }

  function bindStage() {
    if (!el.canvas) return;
    el.canvas.addEventListener('pointerdown', function (e) {
      if (state.mode !== 'ms' || state.exporting || !currentItem()) return;
      /* 记录按下位置：供 click 区分「单击开灯箱」与「拖拽松手」（绘制拦截
         发生在这之后，关闭态也记录，否则关闭态拖拽松手会误弹灯箱） */
      state.msDownPos = canvasXY(e);
      /* 打码方式处于关闭态（再点一次取消后）：不进入绘制；不做 preventDefault，
         让 click 正常冒泡到下方监听 → 单击画布仍可放大预览。 */
      if (!state.msMode) return;
      e.preventDefault();
      var p = canvasXY(e);
      state.drag = { active: true, mode: state.msMode, start: p, cur: p, points: [p], lastPainted: null };
      state.justDrew = false;
      try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      render();
    });
    el.canvas.addEventListener('pointermove', function (e) {
      var d = state.drag;
      if (!d || !d.active) return;
      e.preventDefault();
      var p = canvasXY(e);
      d.cur = p;
      if (d.mode === 'brush') {
        d.points.push(p);
        /* 实时涂抹：增量打码，不走全量重画（全量重画每次清屏 + 重建缓存，长笔画会卡）。 */
        paintStrokeLive(d, p);
      } else {
        render();
      }
    });
    function finish(e) {
      var d = state.drag;
      if (!d || !d.active) return;
      d.active = false;
      /* 发生过实际拖动（非单击）就不触发松手后的 click 开灯箱；
         仅记距离阈值，涂太短未成 op 的笔迹同样不弹。 */
      if (Math.abs(d.cur.x - d.start.x) + Math.abs(d.cur.y - d.start.y) > 4) {
        state.justDrew = true;
      }
      var it = currentItem();
      if (it && state.fit) {
        if (d.mode === 'rect') {
          var x1 = Math.min(d.start.x, d.cur.x), y1 = Math.min(d.start.y, d.cur.y);
          var w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
          if (w > 4 && h > 4) {
            pushOp({ type: 'rect', rect: Core.rectToNorm({ x: x1, y: y1, w: w, h: h }, state.fit.dw, state.fit.dh) });
          }
        } else {
          var step = Math.max(2, Math.max(2, Core.clamp(state.brush, 8, 80) * Core.scaleFor(state.fit.dw, state.fit.dh)) / 3);
          var pts = Core.resamplePath(d.points, step);
          /* 与矩形同款最小笔迹检查：resamplePath 对单个点也返回长度 1，
             不加 moved 判断会把「单击」当成一笔涂抹，吞掉松手后的 click 开灯箱。 */
          if (state.justDrew && pts.length) {
            pushOp({ type: 'stroke', points: Core.pathToNorm(pts, state.fit.dw, state.fit.dh) });
          }
        }
      }
      state.drag = null;
      render();
    }
    el.canvas.addEventListener('pointerup', finish);
    el.canvas.addEventListener('pointercancel', function (e) { state.msDownPos = null; finish(e); });
    // 打码模式下，单击（未拖动绘制）画布 → 放大预览当前图
    el.canvas.addEventListener('click', function (e) {
      if (state.mode !== 'ms' || state.exporting || !currentItem() || state.justDrew) return;
      /* 位移 > 4px 视为拖拽松手（尤其关闭态：justDrew 不会置位），不开灯箱 */
      var down = state.msDownPos;
      state.msDownPos = null;
      if (down) {
        var p = canvasXY(e);
        if (Math.abs(p.x - down.x) + Math.abs(p.y - down.y) > 4) return;
      }
      var items = state.importer.getReadyImages();
      var idx = -1;
      items.forEach(function (q, i) { if (q.id === state.currentId) idx = i; });
      if (idx >= 0) openLightbox(idx, el.canvas);
    });
    // 打码画笔光标：进/出画布显隐，移动跟随（含拖拽涂抹中）；尺寸由 syncBrushCursor 按 state.fit 更新
    if (el.brushCur && el.stage) {
      el.canvas.addEventListener('pointerenter', function () {
        state.brushHover = true;
        syncBrushCursor();
      });
      el.canvas.addEventListener('pointerleave', function () {
        state.brushHover = false;
        syncBrushCursor();
      });
      el.canvas.addEventListener('pointermove', function (e) {
        if (el.brushCur.hidden) return;
        var r = el.stage.getBoundingClientRect();
        el.brushCur.style.left = (e.clientX - r.left) + 'px';
        el.brushCur.style.top = (e.clientY - r.top) + 'px';
      });
    }
  }

  function pushOp(op) {
    state.msOps.push(op);
    state.justDrew = true;
    state.msRedo.length = 0;
    resetMsCache();
    updateUndoBtns();
  }

  function doUndo() {
    if (!state.msOps.length) return;
    state.msRedo.push(state.msOps.pop());
    resetMsCache(); updateUndoBtns(); render();
  }
  function doRedo() {
    if (!state.msRedo.length) return;
    state.msOps.push(state.msRedo.pop());
    resetMsCache(); updateUndoBtns(); render();
  }
  function doClearMs() {
    state.msOps.length = 0;
    state.msRedo.length = 0;
    resetMsCache(); updateUndoBtns(); render();
    toast(tr('annotate_ms_none'), 'info');
  }

  /* ============================================================
   * 导出
   * ============================================================ */
  function extOf(fmt) { return fmt === 'jpeg' ? 'jpg' : fmt; }
  function mimeOf(fmt) { return fmt === 'png' ? 'image/png' : (fmt === 'jpeg' ? 'image/jpeg' : 'image/webp'); }

  function baseName(name) {
    return String(name || 'image').replace(/\.[^.]+$/, '');
  }
  function outName(it) {
    return '标注_' + baseName(it.name) + '.' + extOf(state.fmt);
  }

  // 渲染到离屏 canvas（原图分辨率；超限等比压缩并提示）
  function renderFull(it) {
    var W = it.width, H = it.height;
    var scale = 1;
    if (W > MAX_SIDE || H > MAX_SIDE) {
      scale = Math.min(MAX_SIDE / W, MAX_SIDE / H);
      toast(tr('annotate_warn_big'), 'warning');
    }
    var w = Math.max(1, Math.round(W * scale));
    var h = Math.max(1, Math.round(H * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    if (state.fmt === 'jpeg') { ctx.fillStyle = INK.plate; ctx.fillRect(0, 0, w, h); }  // JPEG 不支持 alpha 补白
    ctx.drawImage(it.img, 0, 0, w, h);
    if (state.mode === 'wm') drawWatermark(ctx, w, h, it);
    else applyMosaicOps(ctx, w, h);
    return c;
  }

  function canvasBlob(canvas, fmt, quality) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) {
        if (b) res(b); else rej(new Error('encode'));
      }, mimeOf(fmt), fmt === 'png' ? undefined : (Core.clamp(quality, 10, 100) / 100));
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function setExporting(on) {
    state.exporting = on;
    updateImportState();
  }
  function showProgress(on, ratio, txt) {
    setHidden(el.progress, !on);
    if (!on) return;
    if (el.progressFill) el.progressFill.style.width = Math.round((ratio || 0) * 100) + '%';
    if (el.progressTxt) el.progressTxt.textContent = txt || '';
  }

  function exportCurrent() {
    if (state.exporting) return;
    var it = currentItem();
    if (!it) return;
    cancelWipe();
    setExporting(true);
    showProgress(true, 0.15, tr('annotate_exporting'));
    try {
      var c = renderFull(it);
      canvasBlob(c, state.fmt, state.quality).then(function (blob) {
        downloadBlob(blob, outName(it));
        showProgress(true, 1, tr('annotate_export_done'));
        if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
        else toast(tr('annotate_export_one_done'), 'success');
        setTimeout(function () { showProgress(false); setExporting(false); }, 400);
        scheduleWipe(it.id);
      }).catch(function () {
        toast(tr('annotate_err_export'), 'danger');
        showProgress(false); setExporting(false);
      });
    } catch (e) {
      toast(tr('annotate_err_export'), 'danger');
      showProgress(false); setExporting(false);
    }
  }

  function exportZip() {
    if (state.exporting) return;
    var items = state.importer ? state.importer.getReadyImages() : [];
    if (!items.length) return;
    cancelWipe();
    setExporting(true);
    showProgress(true, 0, tr('annotate_exporting'));
    var files = [], done = 0, failed = 0;

    function next() {
      if (done >= items.length) {
        if (!files.length) {
          toast(tr('annotate_err_export'), 'danger');
          showProgress(false); setExporting(false);
          return;
        }
        var zipBlob = window.MotefulZip.build(files.map(function (f) {
          return { name: f.name, data: new Uint8Array(f.buf) };
        }));
        downloadBlob(zipBlob, '标注图片.zip');
        if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
        else toast(trn('annotate_export_zip_done', files.length), 'success');
        showProgress(true, 1, tr('annotate_export_done'));
        setTimeout(function () { showProgress(false); setExporting(false); }, 400);
        scheduleWipe(null);
        return;
      }
      var it = items[done];
      Promise.resolve().then(function () {
        var c = renderFull(it);
        return canvasBlob(c, state.fmt, state.quality);
      }).then(function (blob) {
        return blob.arrayBuffer().then(function (buf) {
          files.push({ name: outName(it), buf: buf });
        });
      }).catch(function () { failed++; }).then(function () {
        done++;
        showProgress(true, done / items.length, trn('annotate_export_progress', done) + ' / ' + items.length);
        setTimeout(next, 0);
      });
    }
    next();
  }

  /* ============================================================
   * 自动清除（5 秒）
   * ============================================================ */
  function cancelWipe() {
    if (state.wipeTimer) { clearTimeout(state.wipeTimer); state.wipeTimer = 0; }
  }

  // id 为 null → 清空全部；否则只移除该张
  function scheduleWipe(id) {
    cancelWipe();
    toast(tr('annotate_wipe_scheduled'), 'info');
    state.wipeTimer = setTimeout(function () {
      state.wipeTimer = 0;
      if (!state.importer) return;
      if (id) {
        state.importer.remove(id);
        if (state.currentId === id) state.currentId = null;
      } else {
        state.importer.clear();
        state.currentId = null;
        state.msOps.length = 0; state.msRedo.length = 0;
      }
      resetMsCache(); updateUndoBtns(); renderQueue(); render();
      toast(tr('annotate_wipe_done'), 'success');
    }, WIPE_MS);
  }

  /* ============================================================
   * 水印图片
   * ============================================================ */
  function loadImageFile(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }

  function onWmFile(file) {
    if (!file) return;
    loadImageFile(file).then(function (img) {
      state.waterImg = { img: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, name: file.name };
      if (el.wmName) el.wmName.textContent = file.name;
      setHidden(el.wmDrop, false);
      setRadio('annotateWmType', 'image');
      readUI(); updateWmFields();
      render();
      writeConfigSoon();
    }).catch(function () { toast(tr('annotate_err_decode'), 'danger'); });
  }

  function clearWmImage() {
    state.waterImg = null;
    if (el.wmFileInput) el.wmFileInput.value = '';
    if (el.wmName) el.wmName.textContent = tr('annotate_wm_upload_none');
    setHidden(el.wmDrop, true);
    render();
  }

  /* ============================================================
   * 事件接线
   * ============================================================ */
  function openPicker() {
    if (el.fileInput) el.fileInput.click();
  }

  function bindControls() {
    // 打开文件选择：点击 + 键盘（keydown 由 moteful.js 的 dropzone 行为触发 click）
    // 注意：已导入态下点击缩略图 / 删除按钮 / 清空按钮，内部处理器会立刻重渲队列
    // （renderQueue 重建 DOM），等事件冒泡到 dropzone 时 e.target 已脱离文档树，
    // contains(e.target) 判定失效 → 误弹文件选择框（等于「追加导入」）。
    // 正解：在捕获阶段（任何重渲发生前）记录点击起点是否在 gallery 内，冒泡阶段用该标记判定。
    var clickInGallery = false;
    if (el.drop) el.drop.addEventListener('click', function (e) {
      clickInGallery = !!(el.gallery && !el.gallery.hidden && el.gallery.contains(e.target));
    }, true);
    if (el.drop) el.drop.addEventListener('click', function (e) {
      if (clickInGallery) { clickInGallery = false; return; }
      openPicker();
    });
    if (el.addMore) el.addMore.addEventListener('click', openPicker);
    if (el.fileInput) el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files && el.fileInput.files.length) {
        if (state.importer) state.importer.addFiles(el.fileInput.files);
        el.fileInput.value = '';
      }
    });
    if (el.drop) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        el.drop.addEventListener(ev, function (e) { e.preventDefault(); });
      });
      el.drop.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();   // 阻止冒泡到下方 document 全页处理，防双导
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length && state.importer) {
          state.importer.addFiles(dt.files);
        }
      });
    }
    /* 全页拖放导入（仿 tool.js V0.2.10 / stitch 同款机制）：拖到页面任意位置
       都进导入区，并阻止浏览器新建窗口打开图片。高亮复用 moteful.css 的
       .dropzone.drag（与悬停同款样式），页面私有 CSS 零新增。 */
    function dtHasFiles(e) {
      try { return Array.prototype.indexOf.call((e.dataTransfer && e.dataTransfer.types) || [], 'Files') >= 0; }
      catch (err) { return false; }
    }
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (!dtHasFiles(e)) return;
        e.preventDefault();                       // 阻止浏览器默认打开图片
        if (el.drop) el.drop.classList.add('drag');
      }, false);
    });
    document.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        if (el.drop) el.drop.classList.remove('drag');
      }
    }, false);
    document.addEventListener('drop', function (e) {
      if (el.drop) el.drop.classList.remove('drag');
      if (!dtHasFiles(e)) return;
      e.preventDefault();
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length && state.importer) {
        state.importer.addFiles(dt.files);
      }
    }, false);

    // 参数变化：用事件委托（不用参数卡限定范围，因为「输出格式 / 质量」在导出卡内，
    // 早期版本只绑 #annotateParams 导致 state.fmt 永远停留在 png，导出后缀不跟随）
    document.addEventListener('change', function (e) {
      if (!e.target || e.target.type !== 'radio') return;
      /* 打码方式：change（含键盘方向键切换）时同步 data-on 标记，
         供下方 click 委托判定「再点一次取消」。 */
      if (e.target.name === 'annotateMsMode') {
        $$('input[name="annotateMsMode"]').forEach(function (x) { x.dataset.on = x === e.target ? '1' : ''; });
      }
      readUI();
      updateMode();
      updateWmFields();
      render();
      writeConfigSoon();
    });

    /* 打码方式「再点一次取消」：radio 原生不支持反选，点已选中项不触发 change。
       依赖 data-on 标记（change 委托 + 初始 checked 同步）判定激活项，
       click 时激活项 → checked=false 关闭；画布暂停绘制，单击仍可开灯箱。 */
    document.addEventListener('click', function (e) {
      var lab = e.target && e.target.closest ? e.target.closest('.seg') : null;
      var r = lab ? lab.querySelector('input[name="annotateMsMode"]')
                  : (e.target && e.target.name === 'annotateMsMode' ? e.target : null);
      if (!r || !r.checked || r.dataset.on !== '1') return;
      r.checked = false;
      r.dataset.on = '';
      readUI();
      updateMode();
      render();
      writeConfigSoon();
    });

    // 步进器：moteful.js 在 .step-btn 上直接监听（先于 document 委托执行）并更新 .step-val，
    // 这里再读新值重绘。委托绑定可同时覆盖参数卡与导出卡内的步进器（字号 / 质量等）。
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.step-btn') : null;
      if (!b) return;
      readUI();
      render();
      writeConfigSoon();
    });

    // 大小/直径滑杆：拖动 → 写回 .step-val（单一来源）→ 走统一 readUI/render 链路；
    // 步进器 → 值变化由 render 内 syncMsSliders 回写滑杆，双向同步。
    [[el.blockSlider, 'annotateMsBlock'], [el.brushSlider, 'annotateMsBrush']].forEach(function (pair) {
      var slider = pair[0], textEl = pair[1] && $(pair[1]);
      if (!slider || !textEl) return;
      slider.addEventListener('input', function () {
        var stepBox = textEl.closest('.step');
        var min = stepBox ? +(stepBox.dataset.min || 0) : 0;
        var max = stepBox ? +(stepBox.dataset.max || 100) : 100;
        var v = Math.max(min, Math.min(max, parseInt(slider.value, 10) || min));
        textEl.textContent = String(v);
        textEl.setAttribute('data-last', String(v));
        readUI();
        render();
        writeConfigSoon();
      });
    });

    // stepper manual edit: contenteditable .step-val, reuses existing textContent pipeline (moteful.js global handler + numOf both read textContent)
    bindStepEditing();

    function bindStepEditing() {
      document.addEventListener('beforeinput', function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains('step-val') || !t.getAttribute('contenteditable')) return;
        if (e.inputType && e.inputType.indexOf('insertParagraph') === 0) { e.preventDefault(); return; }
        if (e.data != null && !/^[0-9-]$/.test(e.data)) e.preventDefault();
      });
      document.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains('step-val') || !t.getAttribute('contenteditable')) return;
        var clean = (t.textContent || '').replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '');
        if (clean !== t.textContent) { t.textContent = clean; placeCaretEnd(t); }
      });
      document.addEventListener('blur', function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains('step-val') || !t.getAttribute('contenteditable')) return;
        normalizeStepVal(t);
      }, true);
      document.addEventListener('keydown', function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains('step-val') || !t.getAttribute('contenteditable')) return;
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); t.blur(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var step = t.closest('.step'); if (!step) return;
          var min = +(step.dataset.min || 0), max = +(step.dataset.max || 99);
          var stepBtns = step.querySelectorAll('.step-btn[data-step]');
          var fb = stepBtns.length ? stepBtns[0] : null; var dv = fb ? (Math.abs(+(fb.dataset.step)) || 1) : 1;
          var cur = parseInt((t.textContent || '').replace(/[^0-9-]/g, ''), 10); if (isNaN(cur)) cur = min;
          var v = Math.max(min, Math.min(max, cur + (e.key === 'ArrowUp' ? dv : -dv)));
          t.textContent = String(v); t.setAttribute('data-last', String(v));
          readUI(); render(); writeConfigSoon();
        }
      });
    }

    function normalizeStepVal(el) {
      var step = el.closest('.step'); if (!step) return;
      var min = +(step.dataset.min || 0), max = +(step.dataset.max || 99);
      var raw = (el.textContent || '').replace(/[^0-9-]/g, '').trim();
      var n = parseInt(raw, 10);
      if (raw === '' || isNaN(n)) {
        var last = el.getAttribute('data-last');
        n = (last != null && last !== '') ? parseInt(last, 10) : min;
        if (isNaN(n)) n = min;
      }
      n = Math.max(min, Math.min(max, n));
      el.textContent = String(n);
      el.setAttribute('data-last', String(n));
      readUI(); render(); writeConfigSoon();
    }

    function placeCaretEnd(el) {
      try { var r = document.createRange(); r.selectNodeContents(el); r.collapse(false); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (err) {}
    }


    if (el.wmContent) {
      el.wmContent.addEventListener('input', function () {
        render();
        writeConfigSoon();
      });
    }

    // 水印图片
    if (el.wmPick) el.wmPick.addEventListener('click', function () { if (el.wmFileInput) el.wmFileInput.click(); });
    if (el.wmDrop) el.wmDrop.addEventListener('click', clearWmImage);
    if (el.wmFileInput) el.wmFileInput.addEventListener('change', function () {
      if (el.wmFileInput.files && el.wmFileInput.files.length) onWmFile(el.wmFileInput.files[0]);
      el.wmFileInput.value = '';
    });

    // 打码操作
    if (el.msUndo) el.msUndo.addEventListener('click', doUndo);
    if (el.msRedo) el.msRedo.addEventListener('click', doRedo);
    if (el.msClear) el.msClear.addEventListener('click', doClearMs);

    // 队列
    if (el.thumbs) {
      el.thumbs.addEventListener('click', function (e) {
        var rm = e.target.closest ? e.target.closest('[data-rm]') : null;
        if (rm) {
          var id = rm.getAttribute('data-rm');
          if (state.importer) state.importer.remove(id);
          if (state.currentId === id) { state.currentId = null; resetMsCache(); state.lumaKey = ''; }
          renderQueue(); render();
          return;
        }
        var node = e.target.closest ? e.target.closest('.dz-thumb') : null;
        if (node) selectImage(node.dataset.id);
      });
      el.thumbs.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // 阻断冒泡：否则 moteful.js 的 dropzone 全局行为会对 dz 本身触发 click()，
        // 合成出的 click 目标不在 gallery 内 → 误弹文件选择框。
        e.stopPropagation();
        var node = e.target.closest ? e.target.closest('.dz-thumb') : null;
        if (node) { e.preventDefault(); selectImage(node.dataset.id); }
      });
    }
    if (el.clearAll) el.clearAll.addEventListener('click', function () {
      if (!state.importer) return;
      state.importer.clear();
      state.currentId = null;
      state.msOps.length = 0; state.msRedo.length = 0;
      resetMsCache(); updateUndoBtns(); renderQueue(); render();
    });

    // 导出
    if (el.exportBtn) el.exportBtn.addEventListener('click', exportCurrent);
    if (el.zipBtn) el.zipBtn.addEventListener('click', exportZip);

    // 视口变化：重算预览尺寸
    window.addEventListener('resize', debounce(function () { resetMsCache(); render(); }, 200));

    // 兜底写入配置 / 关闭页面静默擦除
    window.addEventListener('pagehide', function () {
      writeConfig();
      cancelWipe();
      if (state.importer) state.importer.clear();
    });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    cacheEl();
    var cfg = readConfig() || DEFAULTS;
    applyConfigToUI(cfg);
    readUI();
    initImporter();
    bindControls();
    bindStage();
    /* 打码方式「再点一次取消」：data-on 标记与实际选中项对齐
       （必须在 applyConfigToUI 回填之后执行，此处恰好满足） */
    var ms0 = document.querySelector('input[name="annotateMsMode"]:checked');
    if (ms0) ms0.dataset.on = '1';
    updateMode();
    updateWmFields();
    updateUndoBtns();
    renderQueue();
    render();
    writeConfig();

    // 鍒嗕韩鍙傛暟娉ㄥ唽锛圴1.4.1 P1A锛氬甫閰嶇疆閾炬帴 / 浜岀淮鐮侊級
    if (window.MotefulShare) {
      window.MotefulShare.register('annotate', {
        getParams: function () {
          var p = { b: state.block };
          if (state.mode === 'wm' && el.wmContent && el.wmContent.value) p.wm = el.wmContent.value;
          return p;
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
