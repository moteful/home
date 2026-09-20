/*
 * Moteful 拼接工具页面编排（V0.5）
 * 职责：模式切换、参数接线、预览调度、导出调度、配置记忆、自动清除
 * 依赖：moteful.js（主题/语言/图标）、image-import.js（MFImageImport）、
 *       stitch-core.js（MFStitchCore）、i18n.js（DICT/currentLang）
 *
 * 铁律：所有展示文案走 i18n 集中源，本文件不含硬编码文案。
 */
(function () {
  'use strict';

  /* ---------- i18n 辅助 ---------- */
  function tr(key) {
    var d = (window.DICT && window.DICT[window.currentLang]) || {};
    return (d[key] != null) ? d[key] : key;
  }
  function trn(key, n) { return String(tr(key)).replace('{n}', n); }
  function tr2(key, a, b) { return String(tr(key)).replace('{n}', a).replace('{total}', b); }
  function trwh(key, w, h) { return String(tr(key)).replace('{w}', w).replace('{h}', h); }

  /* ---------- 工具函数 ---------- */
  function $(id) { return document.getElementById(id); }
  function setHidden(el, on) {
    if (!el) return;
    el.hidden = !!on;
    if (on) el.style.display = 'none'; else el.style.removeProperty('display');
  }
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 提示：V0.9 收口到全站统一 Toast（原自建 #stitchNote 内联元素已移除） ---------- */
  function flashNote(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type || 'info');
  }

  /* ---------- 默认参数 ---------- */
  var DEFAULT_VERTICAL = {
    direction: 'vertical', gap: 0, bgColor: '#ffffff', radius: 0,
    align: 'center', margin: 0, unified: true, format: 'png', quality: 92
  };
  var DEFAULT_GRID = {
    template: '3x3', rows: 3, cols: 3, gap: 4, bgColor: '#ffffff',
    radius: 0, cellRatio: '1:1', fillMode: 'cover', margin: 0,
    format: 'png', quality: 92
  };

  /* ---------- 状态 ---------- */
  var state = {
    mode: 'vertical',       // 'vertical' | 'grid'
    vParams: {},
    gParams: {},
    images: [],             // MFImageImport 管理的队列引用
    importer: null,
    cells: [],              // 网格模式格子数组
    selectedCell: null,
    previewUrl: null,
    renderVersion: 0,
    renderTimer: 0,
    isExporting: false,
    exportProgress: 0,
    isStreamMode: false,
    wipeTimer: 0,
    moveMode: false,
    moveModeSrc: null,
    dragSrcId: null,        // 拖动排序：当前拖动的源图片 ID
    saveTimer: 0
  };

  var CONFIG_KEY = 'moteful.stitch.config';
  var CONFIG_VERSION = 1;

  /* ---------- 配置记忆 ---------- */
  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return false;
      var cfg = JSON.parse(raw);
      if (!cfg || cfg.__version !== CONFIG_VERSION) return false;
      if (cfg.mode) state.mode = cfg.mode;
      if (cfg.vParams) state.vParams = Object.assign({}, DEFAULT_VERTICAL, cfg.vParams);
      if (cfg.gParams) state.gParams = Object.assign({}, DEFAULT_GRID, cfg.gParams);
      return true;
    } catch (e) { return false; }
  }
  function saveConfigNow() {
    try {
      var cfg = {
        __version: CONFIG_VERSION,
        mode: state.mode,
        vParams: state.vParams,
        gParams: state.gParams
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveConfigNow, 500);
  }

  /* ---------- DOM 引用 ---------- */
  var el = {};
  function cacheDom() {
    el.modeBtns = document.querySelectorAll('[data-stitch-mode]');
    el.verticalPanel = $('stitch-vertical');
    el.gridPanel = $('stitch-grid');
    el.importZone = $('stitchImport');
    el.importZoneG = $('stitchImportG');
    el.dzEmpty = $('stitchDzEmpty');
    el.dzEmptyG = $('stitchDzEmptyG');
    el.fileInput = $('stitchFileInput');
    el.gallery = $('stitchGallery');
    el.galleryList = $('stitchGalleryList');
    el.galleryCount = $('stitchGalleryCount');
    el.addMoreBtn = $('stitchAddMore');
    el.clearThumbsBtn = $('stitchClearThumbs'); // 缩略图区“清空”（原重复 id 已改名）
    el.galleryG = $('stitchGalleryG');
    el.galleryListG = $('stitchGalleryListG');
    el.galleryCountG = $('stitchGalleryCountG');
    el.addMoreBtnG = $('stitchAddMoreG');
    el.clearThumbsBtnG = $('stitchClearThumbsG');
    el.clearBtn = $('stitchClear');             // 操作区“清空全部”（现为唯一 stitchClear）
    el.previewImg = $('stitchPreviewImg');
    el.previewEmpty = $('stitchPreviewEmpty');
    el.previewWrap = $('stitchPreviewWrap');
    el.infoSize = $('stitchInfoSize');
    el.infoEst = $('stitchInfoEst');
    el.infoStream = $('stitchInfoStream');
    el.exportBtn = $('stitchExport');
    el.exportBtnG = $('stitchExportG');
    el.clearBtnG = $('stitchClearG');
    el.progressWrap = $('stitchProgress');
    el.progressFill = $('stitchProgressFill');
    el.progressTxt = $('stitchProgressTxt');
    el.progressWrapG = $('stitchProgressG');
    el.progressFillG = $('stitchProgressFillG');
    el.progressTxtG = $('stitchProgressTxtG');
    el.infoSizeG = $('stitchInfoSizeG');
    el.infoFilled = $('stitchInfoFilled');
    el.infoStreamG = $('stitchInfoStreamG');
    // 单向模式参数
    el.dirSeg = document.querySelectorAll('[data-dir]');
    el.gapSlider = $('stitchGap');
    el.gapVal = $('stitchGapVal');
    el.bgSeg = document.querySelectorAll('[data-bg]');
    el.radiusSlider = $('stitchRadius');
    el.radiusVal = $('stitchRadiusVal');
    el.alignSeg = document.querySelectorAll('[data-align]');
    el.marginSlider = $('stitchMargin');
    el.marginVal = $('stitchMarginVal');
    el.unifiedToggle = $('stitchUnified');
    el.fmtSeg = document.querySelectorAll('[data-fmt-stitch]');
    el.qualitySlider = $('stitchQuality');
    el.qualityVal = $('stitchQualityVal');
    // 网格模式参数
    el.tplBar = $('stitchTplBar');
    el.tplBtns = document.querySelectorAll('[data-tpl]');
    el.customCtl = $('stitchCustomCtl');
    el.gridCanvas = $('stitchGridCanvas');
    el.gridPreviewImg = $('stitchGridPreviewImg');
    el.gapSliderG = $('stitchGapG');
    el.gapValG = $('stitchGapValG');
    el.bgSegG = document.querySelectorAll('[data-bg-g]');
    el.radiusSliderG = $('stitchRadiusG');
    el.radiusValG = $('stitchRadiusValG');
    el.fillSeg = document.querySelectorAll('[data-fill]');
    el.ratioSeg = document.querySelectorAll('[data-ratio]');
    el.fmtSegG = document.querySelectorAll('[data-fmt-grid]');
    el.qualitySliderG = $('stitchQualityG');
    el.qualityValG = $('stitchQualityValG');
    el.cellPanelMask = $('stitchCellPanelMask');
    el.cellPanelThumbs = $('stitchCellPanelThumbs');
    el.cellPanelClear = $('stitchCellPanelClear');
    el.cellPanelClose = $('stitchCellPanelClose');
    el.moveModeBar = $('stitchMoveModeBar');
    el.moveModeBtn = $('stitchMoveModeBtn');
    el.moveModeExit = $('stitchMoveModeExit');
  }

  /* ---------- 模式切换 ---------- */
  function switchMode(mode) {
    state.mode = mode;
    el.modeBtns.forEach(function (b) {
      b.checked = (b.value === mode);
    });
    setHidden(el.verticalPanel, mode !== 'vertical');
    setHidden(el.gridPanel, mode !== 'grid');
    // 导入区独立于模式面板，根据当前模式切换显示
    if (el.importZone) setHidden(el.importZone, mode !== 'vertical');
    if (el.importZoneG) setHidden(el.importZoneG, mode !== 'grid');
    // 切到网格模式时用已有图片重新填充格子：否则从单向模式切过来时画布全空，
    // 既看不到缩略图也无法拖动排序（原先只有再次导入或点模板才会填充）。
    if (mode === 'grid') {
      rebuildCells();
      renderGridCells();
    }
    scheduleRender();
    scheduleSave();
  }

  /* ---------- 导入 ---------- */
  function initImporter() {
    state.importer = new window.MFImageImport({
      onChange: function () {
        state.images = state.importer.queue;
        renderGallery();
        syncEmptyState();
        if (state.mode === 'grid') {
          // 网格模式：导入图片后按当前模板自动映射到格子并渲染缩略图
          rebuildCells();
          renderGridCells();
        }
        scheduleRender();
      },
      onImport: function (added, dup, bad, heic) {
        var parts = [];
        if (added) parts.push(trn('stitch_import_added', added));
        if (dup) parts.push(trn('stitch_import_dup', dup));
        if (bad) parts.push(trn('stitch_import_bad', bad));
        if (heic) parts.push(tr('v01_heic_note'));
        if (parts.length) flashNote(parts.join(' · '), 'info');
      }
    });
    state.images = state.importer.queue;
  }

  function syncEmptyState() {
    var empty = state.images.length === 0;
    if (el.importZone) el.importZone.classList.toggle('mini', !empty);
    if (el.dzEmpty) setHidden(el.dzEmpty, !empty);
    if (el.gallery) setHidden(el.gallery, empty);
    if (el.dzEmptyG) setHidden(el.dzEmptyG, !empty);
    if (el.galleryG) setHidden(el.galleryG, empty);
    if (el.previewEmpty) setHidden(el.previewEmpty, !empty);
    if (el.previewImg) setHidden(el.previewImg, empty);
    if (el.exportBtn) el.exportBtn.disabled = empty || state.isExporting;
    if (el.exportBtnG) el.exportBtnG.disabled = empty || state.isExporting;
    if (el.clearThumbsBtn) el.clearThumbsBtn.disabled = empty;
    if (el.clearThumbsBtnG) el.clearThumbsBtnG.disabled = empty;
    if (el.clearBtn) el.clearBtn.disabled = empty;
    if (el.clearBtnG) el.clearBtnG.disabled = empty;
  }

  /* ===== 拖拽类型识别（基于浏览器原生 dataTransfer.types，不依赖闭包变量，
     以避免第三方扩展（如划词翻译）改写 DOM / 干扰 dragstart 时序时，
     因模块变量未赋值而导致 dragover 不 preventDefault、drop 无法触发）===== */
  var DRAG_MIME = 'application/x-mf-thumb'; // 内部缩略图排序的自定义类型标记
  // 判断 dataTransfer.types 是否含某类型。兼容现代浏览器（字符串数组）与
  // IE/Trident、搜狗兼容模式等老内核（types 为 DOMStringList，用 contains 判断）。
  function dragHasType(e, type) {
    var dt = e && e.dataTransfer;
    if (!dt || !dt.types) return false;
    var types = dt.types;
    var t = String(type).toLowerCase();
    // DOMStringList（老内核）
    if (typeof types.contains === 'function') {
      try { if (types.contains(t)) return true; } catch (err1) {}
    }
    // 字符串数组 / 类数组（现代浏览器）
    if (typeof types.length === 'number') {
      for (var i = 0; i < types.length; i++) {
        if (String(types[i]).toLowerCase() === t) return true;
      }
    }
    return false;
  }
  // 是否为本页缩略图的内部排序拖拽：
  // ① 现代内核：dragstart 写入了自定义类型；② 老内核兜底：dragstart 已记录源 ID
  //   且不是从操作系统拖入的文件（老内核可能写不进自定义 MIME）。
  function isInternalThumbDrag(e) {
    if (dragHasType(e, DRAG_MIME)) return true;
    if (state.dragSrcId && !isExternalFileDrag(e)) return true;
    return false;
  }
  function isExternalFileDrag(e) { return dragHasType(e, 'Files'); } // 从操作系统拖入文件

  /* 计算插入槽位（0..n，槽位 i 表示插到第 i 个元素之前）。
     落在缩略图左半 => 插到它前面；右半 => 插到它后面；
     行首/行尾/行间空白按最近槽位处理，支持多行换行。 */
  function calcInsertIndex(list, clientX, clientY) {
    var thumbs = list.querySelectorAll('.dz-thumb');
    var n = thumbs.length;
    if (!n) return 0;
    var rects = [];
    for (var k = 0; k < n; k++) rects.push(thumbs[k].getBoundingClientRect());
    // 按 top 分行
    var rows = [];
    for (var a = 0; a < n; a++) {
      var top = rects[a].top, hgt = rects[a].height || 0;
      var row = null;
      for (var b = 0; b < rows.length; b++) {
        // 同一行用“半行高容差”判定：被拖缩略图的 scale 等拖拽视觉反馈会让其
        // getBoundingClientRect().top 与同排元素相差 1~2px，若用严格相等会把它
        // 错分成单独一行，导致命中计算恒落回源元素、无法换位。真正换行的行间距
        // 约为一个行高，远大于半行高，不会被误并。
        if (Math.abs(rows[b].top - top) <= rows[b].h * 0.5) { row = rows[b]; break; }
      }
      if (!row) { row = { top: top, h: hgt, items: [] }; rows.push(row); }
      row.items.push({ idx: a, r: rects[a] });
    }
    for (var c = 0; c < rows.length; c++) {
      var rw = rows[c];
      // 行纵向范围取整排元素的最小 top / 最大 bottom，避免单个元素缩放带来的偏差
      var rowTop = Infinity, rowBottom = -Infinity;
      for (var e = 0; e < rw.items.length; e++) {
        rowTop = Math.min(rowTop, rw.items[e].r.top);
        rowBottom = Math.max(rowBottom, rw.items[e].r.bottom);
      }
      if (clientY >= rowTop && clientY <= rowBottom) {
        for (var d = 0; d < rw.items.length; d++) {
          var it = rw.items[d];
          if (clientX <= it.r.right) {
            var mid = it.r.left + it.r.width / 2;
            return clientX < mid ? it.idx : it.idx + 1; // 左半=前，右半=后
          }
        }
        return rw.items[rw.items.length - 1].idx + 1; // 行尾右侧空白
      }
      if (clientY < rowTop) return rw.items[0].idx;   // 该行上方
    }
    return n; // 最后一行下方：末尾
  }

  /* ---------- 缩略图画廊 ----------
     单向模式与网格模式共用同一份 state.images，因此两个导入区的缩略图列表
     （#stitchGalleryList / #stitchGalleryListG）必须用同一套渲染与排序逻辑同步渲染，
     否则网格导入区导入后不显示缩略图。 */
  function renderGallery() {
    renderGalleryInto(el.galleryList);
    renderGalleryInto(el.galleryListG);
    if (el.galleryCount) {
      el.galleryCount.textContent = state.images.length ? trn('stitch_count', state.images.length) : tr('v01_empty');
    }
    if (el.galleryCountG) {
      el.galleryCountG.textContent = state.images.length ? trn('stitch_count', state.images.length) : tr('v01_empty');
    }
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
  }

  function renderGalleryInto(list) {
    if (!list) return;

    // ===== 拖拽排序：桌面(HTML5 DnD)与移动端(touch)统一事件委托在 #stitchGalleryList 上，
    //       动态新增的缩略图无需逐个重新绑定。只绑定一次。 =====
    if (!list._dragEventsBound) {
      list._dragEventsBound = true;
      // 插入指示线（绝对定位到 list，不占 grid 空间）
      var insertLine = document.createElement('div');
      insertLine.className = 'dz-insert-line';
      var lastInsertIdx = -2;

      // 隐藏插入指示线与目标高亮
      function hideInsertLine() {
        insertLine.style.display = 'none';
        if (insertLine.parentNode) insertLine.parentNode.removeChild(insertLine);
        lastInsertIdx = -2;
        var act = list.querySelectorAll('.dz-thumb.drag-over');
        Array.prototype.forEach.call(act, function (nd) { nd.classList.remove('drag-over'); });
      }
      // 在槽位 insertIdx 处显示插入指示线并高亮目标缩略图
      function showInsertLine(insertIdx) {
        var thumbs = list.querySelectorAll('.dz-thumb');
        if (!thumbs.length) { hideInsertLine(); return; }
        var listRect = list.getBoundingClientRect();
        var ref, before = true;
        if (insertIdx >= thumbs.length) {
          ref = thumbs[thumbs.length - 1]; before = false;
        } else {
          ref = thumbs[insertIdx]; before = true;
        }
        if (!ref) { hideInsertLine(); return; }
        var rr = ref.getBoundingClientRect();
        insertLine.style.display = 'block';
        insertLine.style.left = ((before ? rr.left : rr.right) - listRect.left - 2) + 'px';
        insertLine.style.top = (rr.top - listRect.top) + 'px';
        insertLine.style.height = rr.height + 'px';
        if (insertLine.parentNode !== list) list.appendChild(insertLine);
        var act = list.querySelectorAll('.dz-thumb.drag-over');
        Array.prototype.forEach.call(act, function (nd) { nd.classList.remove('drag-over'); });
        ref.classList.add('drag-over');
      }
      // 由“源图片 ID + 插入槽位”换算目标下标并重排数据数组。
      // 重排后 image-import 的 move() 会触发 onChange -> renderGallery + 预览重绘。
      // 桌面 drop 与移动端 touchmove 共用此函数。返回是否发生了移动。
      function reorderToSlot(srcId, insertIdx) {
        if (!srcId) return false;
        var srcIdx = -1;
        state.images.forEach(function (img, i) { if (img.id === srcId) srcIdx = i; });
        if (srcIdx < 0) return false;
        var dstIdx = insertIdx;
        if (srcIdx < dstIdx) dstIdx = dstIdx - 1; // 移除源后，其后的下标整体前移
        if (dstIdx < 0) dstIdx = 0;
        if (dstIdx !== srcIdx) { state.importer.move(srcIdx, dstIdx); return true; }
        return false;
      }

      /* ---------- 桌面端：mousedown / mousemove / mouseup 自实现拖拽排序 ----------
         不使用原生 HTML5 DnD：搜狗等浏览器会在内核层劫持原生 dragover/drop（用于其
         “超级拖拽/拖词搜索”），网页只能收到 dragstart、收不到 drop，无法排序；
         而 mousedown/move/up 是最基础鼠标事件，不会被这样拦截。逻辑与下方触屏
         touch 方案同构：按下后移动超过 5px 进入拖动态，随后实时跟随换位。 */
      var mouseDrag = { pressed: false, active: false, srcId: null, startX: 0, startY: 0, lastIdx: -2 };
      // 找到起点所在缩略图；落在删除 / 左右移动按钮上时不启动排序，保留其点击
      function dragThumbFromTarget(target) {
        if (target && target.closest && (target.closest('.dz-rm') || target.closest('.dz-move-btns'))) return null;
        return target && target.closest ? target.closest('.dz-thumb') : null;
      }
      list.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return; // 仅响应鼠标左键
        var thumb = dragThumbFromTarget(e.target);
        if (!thumb) return;
        mouseDrag.pressed = true; mouseDrag.active = false;
        mouseDrag.srcId = thumb.getAttribute('data-id');
        mouseDrag.startX = e.clientX; mouseDrag.startY = e.clientY; mouseDrag.lastIdx = -2;
      });
      // mousemove / mouseup 绑在 document：指针移出缩略图或列表后仍可持续跟踪
      document.addEventListener('mousemove', function (e) {
        if (!mouseDrag.pressed) return;
        if (!mouseDrag.active) {
          if (Math.abs(e.clientX - mouseDrag.startX) < 5 && Math.abs(e.clientY - mouseDrag.startY) < 5) return;
          mouseDrag.active = true; // 越过移动阈值，正式进入拖动态
          state.dragSrcId = mouseDrag.srcId;
          var n0 = list.querySelector('.dz-thumb[data-id="' + mouseDrag.srcId + '"]');
          if (n0) n0.classList.add('is-dragging');
        }
        e.preventDefault(); // 进入拖拽后阻止选中文本及浏览器原生幽灵拖拽
        var idx = calcInsertIndex(list, e.clientX, e.clientY);
        if (idx !== mouseDrag.lastIdx) {
          mouseDrag.lastIdx = idx;
          showInsertLine(idx);
          reorderToSlot(mouseDrag.srcId, idx); // 跟随换位：数据与 DOM 实时重排（与触屏一致）
        }
      });
      // 拖动结束的 mouseup 后浏览器可能向落点补发一次 click，捕获阶段吞掉以免误触删除等按钮
      function swallowClickOnce() {
        function h(ev) { ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click', h, true); }
        document.addEventListener('click', h, true);
      }
      function endMouseDrag() {
        if (!mouseDrag.pressed) return;
        if (mouseDrag.active) {
          hideInsertLine();
          var n = list.querySelector('.dz-thumb.is-dragging');
          if (n) n.classList.remove('is-dragging');
          swallowClickOnce();
        }
        mouseDrag.pressed = false; mouseDrag.active = false;
        mouseDrag.srcId = null; mouseDrag.lastIdx = -2;
        state.dragSrcId = null;
      }
      document.addEventListener('mouseup', endMouseDrag);
      // 拖拽过程中屏蔽浏览器原生右键菜单
      list.addEventListener('contextmenu', function (e) {
        if (mouseDrag.pressed || state.dragSrcId) e.preventDefault();
      });

      /* ---------- 移动端：长按约 250ms 进入拖动，touchmove 实时跟随换位 ---------- */
      // 触屏不触发 HTML5 drag 事件，这里用原生 touch 事件实现等价排序，
      // 并通过“长按阈值 + 移动阈值”与页面纵向滚动区分，避免误拖。
      var touchDrag = { active: false, timer: 0, srcId: null, startX: 0, startY: 0, lastIdx: -2 };
      function clearTouchTimer() {
        if (touchDrag.timer) { clearTimeout(touchDrag.timer); touchDrag.timer = 0; }
      }
      function endTouchDrag() {
        clearTouchTimer();
        if (touchDrag.active) hideInsertLine();
        var node = list.querySelector('.dz-thumb.is-dragging');
        if (node) node.classList.remove('is-dragging');
        touchDrag.active = false; touchDrag.srcId = null; touchDrag.lastIdx = -2;
      }
      // touchstart 委托：仅当起点落在缩略图（非删除/移动按钮）上才准备排序
      list.addEventListener('touchstart', function (e) {
        var t = e.touches[0];
        var thumb = e.target.closest ? e.target.closest('.dz-thumb') : null;
        if (!thumb) return;
        // 点在删除按钮、左右移动按钮上时不进入拖拽，保留其点击行为
        if (e.target.closest && (e.target.closest('.dz-rm') || e.target.closest('.dz-move-btns'))) return;
        touchDrag.srcId = thumb.getAttribute('data-id');
        touchDrag.startX = t.clientX; touchDrag.startY = t.clientY;
        touchDrag.active = false; touchDrag.lastIdx = -2;
        clearTouchTimer();
        var sx = t.clientX, sy = t.clientY;
        touchDrag.timer = setTimeout(function () {
          // 长按成立，进入拖动态
          touchDrag.active = true;
          state.dragSrcId = touchDrag.srcId;
          var node = list.querySelector('.dz-thumb[data-id="' + touchDrag.srcId + '"]');
          if (node) node.classList.add('is-dragging');
          if (navigator.vibrate) { try { navigator.vibrate(20); } catch (err) {} }
          var idx = calcInsertIndex(list, sx, sy);
          touchDrag.lastIdx = idx; showInsertLine(idx);
        }, 250);
      }, { passive: true });
      // touchmove：未进入拖动态时，位移超过 10px 判定为页面滚动并取消长按；
      // 进入拖动态后 preventDefault 阻止滚动，并按手指位置实时换位。
      list.addEventListener('touchmove', function (e) {
        var t = e.touches[0];
        if (!touchDrag.active) {
          var dx = t.clientX - touchDrag.startX;
          var dy = t.clientY - touchDrag.startY;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTouchTimer(); // 让位给页面滚动
          return;
        }
        e.preventDefault();
        var idx = calcInsertIndex(list, t.clientX, t.clientY);
        if (idx !== touchDrag.lastIdx) {
          touchDrag.lastIdx = idx;
          showInsertLine(idx);
          reorderToSlot(touchDrag.srcId, idx); // 跟随换位：数据与 DOM 实时重排
        }
      }, { passive: false }); // passive:false 才能在拖动态 preventDefault 阻止滚动
      list.addEventListener('touchend', function () { endTouchDrag(); state.dragSrcId = null; });
      list.addEventListener('touchcancel', function () { endTouchDrag(); state.dragSrcId = null; });
    }

    var alive = {};
    state.images.forEach(function (it) { alive[it.id] = true; });
    // 移除已删除（跳过拖拽插入指示线）。
    // 注意：list.children 是动态 HTMLCollection，边遍历边 remove 会因索引前移而漏删，
    // 必须先 slice 成静态快照再遍历。
    var staleKids = Array.prototype.slice.call(list.children);
    staleKids.forEach(function (child) {
      if (child.classList && child.classList.contains('dz-insert-line')) return;
      var id = child.getAttribute('data-id');
      if (!alive[id]) child.remove();
    });
    // 增量更新
    var existing = {};
    Array.prototype.forEach.call(list.children, function (child) {
      if (child.classList && child.classList.contains('dz-insert-line')) return;
      existing[child.getAttribute('data-id')] = child;
    });
    state.images.forEach(function (it, idx) {
      var node = existing[it.id];
      if (!node) {
        node = document.createElement('div');
        node.className = 'dz-thumb';
        node.setAttribute('data-id', it.id);
        // 排序改用 mousedown/move/up 自实现（兼容劫持原生 DnD 的浏览器），显式关闭原生拖拽
        node.setAttribute('draggable', 'false');
        node.setAttribute('title', esc(it.name));
        node.innerHTML =
          // img 关闭原生拖拽：避免排序拖动时被浏览器附加 Files 类型而触发重复导入
          '<img alt="' + esc(it.name) + '" draggable="false">' +
          '<span class="dz-idx">' + (idx + 1) + '</span>' +
          '<button type="button" class="dz-rm" aria-label="' + esc(tr('v022_remove')) + '"><i data-lucide="x"></i></button>' +
          '<div class="dz-move-btns"><button type="button" class="mv-left" aria-label="left">‹</button><button type="button" class="mv-right" aria-label="right">›</button></div>';
        // 事件绑定
        node.querySelector('.dz-rm').addEventListener('click', function (e) {
          e.stopPropagation();
          state.importer.remove(it.id);
        });
        node.querySelector('.mv-left').addEventListener('click', function (e) {
          e.stopPropagation();
          var i = state.images.indexOf(it);
          if (i > 0) state.importer.move(i, i - 1);
        });
        node.querySelector('.mv-right').addEventListener('click', function (e) {
          e.stopPropagation();
          var i = state.images.indexOf(it);
          if (i < state.images.length - 1) state.importer.move(i, i + 1);
        });
        // 桌面排序由 #stitchGalleryList 上的 mousedown/mousemove/mouseup 委托统一处理，
        // 移动端由 touch 事件处理，缩略图自身不再绑定原生 dragstart/dragend。
      }
      // 按 state.images 顺序重排 DOM（已存在的节点会被移动到正确位置）
      list.appendChild(node);
      // 更新内容
      var img = node.querySelector('img');
      if (it.thumbUrl) img.src = it.thumbUrl;
      else img.removeAttribute('src');
      node.querySelector('.dz-idx').textContent = idx + 1;
      if (it.status === 'error') {
        node.style.opacity = '0.5';
        node.title = tr('stitch_err_decode');
      } else {
        node.style.opacity = '';
      }
    });
  }

  /* ---------- 网格模式：格子管理 ---------- */
  function rebuildCells() {
    state.cells = [];
    for (var r = 0; r < state.gParams.rows; r++) {
      for (var c = 0; c < state.gParams.cols; c++) {
        state.cells.push({
          index: r * state.gParams.cols + c, row: r, col: c,
          imageId: null, fillMode: null
        });
      }
    }
    // 按顺序映射图片
    var ready = state.importer ? state.importer.getReadyImages() : [];
    ready.forEach(function (img, i) {
      if (i < state.cells.length) state.cells[i].imageId = img.id;
    });
  }

  function renderGridCells() {
    if (!el.gridCanvas) return;
    var canvas = el.gridCanvas;
    canvas.innerHTML = '';
    canvas.style.gridTemplateColumns = 'repeat(' + state.gParams.cols + ', 1fr)';
    canvas.style.gap = state.gParams.gap + 'px';
    var imgMap = {};
    state.images.forEach(function (img) { imgMap[img.id] = img; });
    state.cells.forEach(function (cell) {
      var div = document.createElement('div');
      div.className = 'grid-cell';
      div.setAttribute('data-cell-idx', cell.index);
      if (cell.imageId && imgMap[cell.imageId]) {
        var img = imgMap[cell.imageId];
        // 关闭 img 原生拖拽：否则 Chrome 拖动 <img> 时会自动往 dataTransfer 附加 Files 类型，
        // 导入区会把「格子排序拖拽」误判成「外部文件拖入」而重复添加同一张图。
        div.innerHTML = '<span class="cell-idx">' + (cell.index + 1) + '</span><img src="' + (img.thumbUrl || '') + '" alt="' + esc(img.name) + '" draggable="false">';
      } else {
        div.classList.add('empty');
        div.innerHTML = '<span class="cell-idx">' + (cell.index + 1) + '</span>+';
      }
      if (state.selectedCell === cell.index) div.classList.add('selected');
      if (state.moveMode && state.moveModeSrc === cell.index) div.classList.add('selected');
      // 点击
      div.addEventListener('click', function () {
        if (state.moveMode) {
          handleMoveModeClick(cell.index);
        } else {
          openCellPanel(cell.index);
        }
      });
      // 拖拽
      div.setAttribute('draggable', 'true');
      div.addEventListener('dragstart', function (e) {
        if (state.moveMode) { e.preventDefault(); return; }
        div.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(cell.index));
        // 打上「页面内部拖拽」标记（自定义 MIME + state.dragSrcId 双保险）：
        // 某些内核即使关闭了 img 原生拖拽仍会附加 Files 类型，导入区/全页 drop
        // 收到此标记后会直接 return，绝不走「外部文件导入」分支。
        try { e.dataTransfer.setData(DRAG_MIME, 'cell:' + cell.index); } catch (errSet) {}
        state.dragSrcId = 'cell:' + cell.index;
      });
      div.addEventListener('dragend', function () {
        state.dragSrcId = null; // 拖拽结束清除标记，避免影响后续外部文件拖入
        div.classList.remove('dragging');
        document.querySelectorAll('.grid-cell.drag-over').forEach(function (n) { n.classList.remove('drag-over'); });
      });
      // 说明：dragover/dragleave 阶段部分内核不暴露自定义 MIME（types 可能为空），
      // 因此这里用「是否外部文件」反向判断——只有外部文件才放行给全页 handler，
      // 其余（页面内部排序拖拽）一律 preventDefault，确保 drop 能正常触发。
      div.addEventListener('dragover', function (e) {
        if (isExternalFileDrag(e)) return; // 外部文件交给全页 handler，格子不拦截
        e.preventDefault();
        div.classList.add('drag-over');
      });
      div.addEventListener('dragleave', function () {
        div.classList.remove('drag-over');
      });
      div.addEventListener('drop', function (e) {
        if (isExternalFileDrag(e)) return; // 外部文件不在此处理，冒泡到 document 正常导入
        e.preventDefault();
        div.classList.remove('drag-over');
        var srcIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(srcIdx) && srcIdx !== cell.index) {
          swapCells(srcIdx, cell.index);
        }
      });
      canvas.appendChild(div);
    });
  }

  function swapCells(idxA, idxB) {
    var tmp = state.cells[idxA].imageId;
    state.cells[idxA].imageId = state.cells[idxB].imageId;
    state.cells[idxB].imageId = tmp;
    renderGridCells();
    scheduleRender();
  }

  /* ---------- 单格替换面板 ---------- */
  function openCellPanel(cellIdx) {
    state.selectedCell = cellIdx;
    renderGridCells();
    if (!el.cellPanelThumbs) return;
    el.cellPanelThumbs.innerHTML = '';
    state.images.forEach(function (img) {
      var div = document.createElement('div');
      div.className = 'cell-panel-thumb';
      if (state.cells[cellIdx].imageId === img.id) div.classList.add('on');
      div.innerHTML = '<img src="' + (img.thumbUrl || '') + '" alt="' + esc(img.name) + '">';
      div.setAttribute('title', esc(img.name));
      div.addEventListener('click', function () {
        // 如果图片已在其他格子，交换
        var srcCell = null;
        state.cells.forEach(function (c) {
          if (c.imageId === img.id && c.index !== cellIdx) srcCell = c;
        });
        if (srcCell) {
          srcCell.imageId = state.cells[cellIdx].imageId;
        }
        state.cells[cellIdx].imageId = img.id;
        closeCellPanel();
        renderGridCells();
        scheduleRender();
      });
      el.cellPanelThumbs.appendChild(div);
    });
    if (el.cellPanelMask) el.cellPanelMask.classList.add('active');
  }

  function closeCellPanel() {
    state.selectedCell = null;
    if (el.cellPanelMask) el.cellPanelMask.classList.remove('active');
    renderGridCells();
  }

  function clearCell(cellIdx) {
    state.cells[cellIdx].imageId = null;
    closeCellPanel();
    renderGridCells();
    scheduleRender();
  }

  /* ---------- 移动模式（移动端） ---------- */
  function enterMoveMode() {
    state.moveMode = true;
    state.moveModeSrc = null;
    if (el.moveModeBar) el.moveModeBar.classList.add('active');
    if (el.moveModeBtn) el.moveModeBtn.style.display = 'none';
  }
  function exitMoveMode() {
    state.moveMode = false;
    state.moveModeSrc = null;
    if (el.moveModeBar) el.moveModeBar.classList.remove('active');
    if (el.moveModeBtn) el.moveModeBtn.style.display = '';
    renderGridCells();
  }
  function handleMoveModeClick(cellIdx) {
    if (state.moveModeSrc === null) {
      state.moveModeSrc = cellIdx;
      renderGridCells();
    } else if (state.moveModeSrc === cellIdx) {
      state.moveModeSrc = null;
      renderGridCells();
    } else {
      swapCells(state.moveModeSrc, cellIdx);
      state.moveModeSrc = null;
    }
  }

  /* ---------- 预览渲染 ---------- */
  /* 网格模式圆角实时预览：
     网格预览用的是 DOM 交互层格子（不走 canvas），而导出圆角只在 canvas 渲染时生效，
     所以调圆角滑块时预览区毫无变化。这里把「导出圆角」按预览缩放比换算成 CSS 半径
     写到画布的 --cell-radius 上，格子（含内部图片，靠 overflow:hidden 裁切）即可实时变圆角。 */
  function applyGridPreviewRadius() {
    if (!el.gridCanvas) return;
    var radius = state.gParams.radius || 0;
    var totalW = state.lastGridWidth || 0;
    // 预览画布上限 800px（见 renderPreview），导出宽度通常更大，需等比缩小半径
    var scale = totalW > 0 ? Math.min(800 / totalW, 1) : 1;
    el.gridCanvas.style.setProperty('--cell-radius', (radius * scale).toFixed(2) + 'px');
  }

  /* 网格模式填充方式实时预览：
     导出时的填充（覆盖/包含/拉伸）由 stitch-core 的 calcDrawRect 在 canvas 上计算，
     而预览用的是 DOM 格子，原本 object-fit 写死 cover，切换填充模式预览毫无变化。
     这里把填充模式映射为 CSS object-fit 写到画布的 --cell-fit 上，格子图片即时切换显示方式。
     映射：cover→cover（裁切填满）、contain→contain（完整留白）、stretch→fill（拉满变形）。 */
  function applyGridPreviewFill() {
    if (!el.gridCanvas) return;
    var mode = state.gParams.fillMode || 'cover';
    var fit = mode === 'contain' ? 'contain' : (mode === 'stretch' ? 'fill' : 'cover');
    el.gridCanvas.style.setProperty('--cell-fit', fit);
  }

  function scheduleRender() {
    if (state.renderTimer) clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(renderPreview, 300);
  }

  function renderPreview() {
    var ready = state.importer ? state.importer.getReadyImages() : [];
    if (ready.length === 0) {
      if (el.previewImg) setHidden(el.previewImg, true);
      if (el.previewEmpty) setHidden(el.previewEmpty, false);
      if (el.gridCanvas) setHidden(el.gridCanvas, false);
      if (el.gridPreviewImg) setHidden(el.gridPreviewImg, true);
      updateInfoBar(0, 0, 0);
      return;
    }
    if (el.previewEmpty) setHidden(el.previewEmpty, true);

    var myVersion = ++state.renderVersion;
    var layout, canvas, params;

    if (state.mode === 'vertical') {
      params = state.vParams;
      layout = params.direction === 'vertical'
        ? window.MFStitchCore.calcVerticalLayout(ready, params)
        : window.MFStitchCore.calcHorizontalLayout(ready, params);
      state.isStreamMode = window.MFStitchCore.shouldUseStream(ready, layout);
      canvas = createPreviewCanvas(layout);
      var ctx = canvas.getContext('2d');
      window.MFStitchCore.fillBackground(ctx, canvas.width, canvas.height, params.bgColor);
      // 预览用普通绘制（流式只在导出时用）
      var scale = canvas.width / layout.totalWidth;
      ctx.scale(scale, scale);
      var radius = params.radius || 0;
      layout.positions.forEach(function (pos, i) {
        var img = ready[i];
        if (!img || !img.img) return;
        if (radius > 0) {
          ctx.save();
          window.MFStitchCore.roundRectPath(ctx, pos.x, pos.y, pos.w, pos.h, radius);
          ctx.clip();
        }
        ctx.drawImage(img.img, pos.x, pos.y, pos.w, pos.h);
        if (radius > 0) ctx.restore();
      });
      if (el.gridCanvas) setHidden(el.gridCanvas, true);
      if (el.gridPreviewImg) setHidden(el.gridPreviewImg, true);
    } else {
      // 网格模式：用交互层格子预览，不创建 canvas（导出时才完整渲染）
      params = state.gParams;
      if (state.cells.length === 0 || state.cells.length !== params.rows * params.cols) {
        rebuildCells();
      }
      layout = params.cellRatio === 'free'
        ? window.MFStitchCore.calcGridSizeFree(state.cells, ready, params)
        : window.MFStitchCore.calcGridSize(state.cells, ready, params);
      state.isStreamMode = window.MFStitchCore.shouldUseGridStream(state.cells, layout);
      if (el.gridCanvas) {
        setHidden(el.gridCanvas, false);
        el.gridCanvas.style.maxWidth = Math.min(layout.totalWidth, 800) + 'px';
      }
      // 记录导出总宽并按缩放比应用圆角，使预览格子与导出结果视觉一致
      state.lastGridWidth = layout.totalWidth;
      applyGridPreviewRadius();
      applyGridPreviewFill();
      if (el.gridPreviewImg) setHidden(el.gridPreviewImg, true);
      // 网格模式不更新 previewImg，直接更新信息条
      var estBytesG = layout.totalWidth * layout.totalHeight * 4;
      if (params.format === 'jpeg') estBytesG *= 0.1;
      else if (params.format === 'webp') estBytesG *= 0.15;
      else estBytesG *= 0.6;
      updateInfoBar(layout.totalWidth, layout.totalHeight, Math.round(estBytesG));
      return; // 网格模式提前返回，不走 canvas.toBlob
    }

    // 转 blob 更新预览
    canvas.toBlob(function (blob) {
      if (myVersion !== state.renderVersion) return;
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(blob);
      var targetImg = state.mode === 'vertical' ? el.previewImg : el.gridPreviewImg;
      if (targetImg) {
        targetImg.src = state.previewUrl;
        setHidden(targetImg, false);
      }
    }, 'image/png');

    // 估算文件大小（粗略：像素数 × 4字节 × 压缩比）
    var estBytes = layout.totalWidth * layout.totalHeight * 4;
    if (params.format === 'jpeg') estBytes *= 0.1;
    else if (params.format === 'webp') estBytes *= 0.15;
    else estBytes *= 0.6;
    updateInfoBar(layout.totalWidth, layout.totalHeight, Math.round(estBytes));
  }

  function createPreviewCanvas(layout) {
    var maxDim = 2000;
    var scale = Math.min(1, maxDim / Math.max(layout.totalWidth, layout.totalHeight));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(layout.totalWidth * scale));
    c.height = Math.max(1, Math.round(layout.totalHeight * scale));
    return c;
  }

  function updateInfoBar(w, h, estBytes) {
    if (el.infoSize) el.infoSize.textContent = w + ' × ' + h + ' px';
    if (el.infoEst) el.infoEst.textContent = formatBytes(estBytes);
    if (el.infoStream) {
      if (state.isStreamMode) {
        el.infoStream.textContent = tr('stitch_stream_mode');
        el.infoStream.classList.add('stitch-stream-tag');
      } else {
        el.infoStream.textContent = '';
        el.infoStream.classList.remove('stitch-stream-tag');
      }
    }
    // 网格模式信息条
    if (el.infoSizeG) el.infoSizeG.textContent = w + ' × ' + h + ' px';
    if (el.infoFilled) {
      var filled = 0;
      state.cells.forEach(function (c) { if (c.imageId) filled++; });
      el.infoFilled.textContent = filled + ' / ' + state.cells.length;
    }
    if (el.infoStreamG) {
      if (state.isStreamMode) {
        el.infoStreamG.textContent = tr('stitch_stream_mode');
        el.infoStreamG.classList.add('stitch-stream-tag');
      } else {
        el.infoStreamG.textContent = '';
        el.infoStreamG.classList.remove('stitch-stream-tag');
      }
    }
  }

  /* ---------- 导出 ---------- */
  function exportImage() {
    if (state.isExporting) return;
    var ready = state.importer ? state.importer.getReadyImages() : [];
    if (ready.length === 0) return;
    if (state.mode === 'vertical' && ready.length < 2) {
      flashNote(tr('stitch_err_min'), 'warning');
      return;
    }

    state.isExporting = true;
    var activeBtn = state.mode === 'grid' ? el.exportBtnG : el.exportBtn;
    if (activeBtn) {
      activeBtn.disabled = true;
      var btnTxt = activeBtn.querySelector('[data-i18n]');
      if (btnTxt) btnTxt.textContent = tr('stitch_exporting');
    }
    cancelWipe();

    var layout, canvas, params, prefix;
    if (state.mode === 'vertical') {
      params = state.vParams;
      layout = params.direction === 'vertical'
        ? window.MFStitchCore.calcVerticalLayout(ready, params)
        : window.MFStitchCore.calcHorizontalLayout(ready, params);
      prefix = 'stitch_export';
      canvas = document.createElement('canvas');
      canvas.width = layout.totalWidth;
      canvas.height = layout.totalHeight;
    } else {
      params = state.gParams;
      if (state.cells.length !== params.rows * params.cols) rebuildCells();
      layout = params.cellRatio === 'free'
        ? window.MFStitchCore.calcGridSizeFree(state.cells, ready, params)
        : window.MFStitchCore.calcGridSize(state.cells, ready, params);
      prefix = 'stitch_export_grid';
      canvas = document.createElement('canvas');
      canvas.width = layout.totalWidth;
      canvas.height = layout.totalHeight;
    }

    // 超大图警告
    if (layout.totalWidth > 16000 || layout.totalHeight > 16000) {
      flashNote(tr('stitch_err_too_big'), 'danger');
    }

    var useStream = state.mode === 'vertical'
      ? window.MFStitchCore.shouldUseStream(ready, layout)
      : window.MFStitchCore.shouldUseGridStream(state.cells, layout);

    var drawPromise;
    if (useStream) {
      showProgress(true);
      if (state.mode === 'vertical') {
        drawPromise = window.MFStitchCore.drawStitchStream(canvas, ready, layout.positions, params, function (p) {
          setProgress(p, trn('stitch_stream_progress', Math.round(p * 100)));
        });
      } else {
        drawPromise = window.MFStitchCore.drawGridStream(canvas, state.cells, ready, layout.positions, params, function (p) {
          setProgress(p, trn('stitch_stream_progress', Math.round(p * 100)));
        });
      }
    } else {
      if (state.mode === 'vertical') {
        window.MFStitchCore.drawStitch(canvas, ready, layout.positions, params);
      } else {
        window.MFStitchCore.drawGrid(canvas, state.cells, ready, layout.positions, params);
      }
      drawPromise = Promise.resolve();
    }

    drawPromise.then(function () {
      // 透明背景 + JPEG → 铺白底
      var fmt = params.format;
      if (fmt === 'jpeg' && params.bgColor === 'transparent') {
        var ctx = canvas.getContext('2d');
        var tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        var tctx = tmp.getContext('2d');
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        tctx.drawImage(canvas, 0, 0);
        canvas = tmp;
        flashNote(tr('stitch_transparent_jpeg_note'), 'warning');
      }
      return window.MFStitchCore.exportBlob(canvas, fmt, params.quality);
    }).then(function (blob) {
      var fileName = window.MFStitchCore.genFileName(
        state.mode === 'vertical' ? '\u957f\u56fe\u62fc\u63a5' : '\u7f51\u683c\u62fc\u56fe',
        params.format
      );
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
      else flashNote(tr(state.mode === 'vertical' ? 'stitch_export_done' : 'stitch_export_grid_done'), 'success');
      scheduleWipe();
    }).catch(function (err) {
      console.error(err);
      flashNote(tr('stitch_err_export'), 'danger');
    }).then(function () {
      state.isExporting = false;
      showProgress(false);
      var activeBtn2 = state.mode === 'grid' ? el.exportBtnG : el.exportBtn;
      if (activeBtn2) {
        activeBtn2.disabled = state.images.length === 0;
        var btnTxt2 = activeBtn2.querySelector('[data-i18n]');
        if (btnTxt2) btnTxt2.textContent = tr(state.mode === 'vertical' ? 'stitch_export' : 'stitch_export_grid');
      }
      // 释放 canvas
      canvas.width = 0; canvas.height = 0;
    });
  }

  function showProgress(on) {
    var wrap = state.mode === 'grid' ? el.progressWrapG : el.progressWrap;
    if (wrap) wrap.classList.toggle('active', on);
  }
  function setProgress(p, txt) {
    var fill = state.mode === 'grid' ? el.progressFillG : el.progressFill;
    var txtEl = state.mode === 'grid' ? el.progressTxtG : el.progressTxt;
    if (fill) fill.style.setProperty('--p', Math.round(p * 100) + '%');
    if (txtEl) txtEl.textContent = txt;
  }

  /* ---------- 自动清除 ---------- */
  function scheduleWipe() {
    cancelWipe();
    flashNote(tr('v03_wipe_scheduled'), 'warning');
    state.wipeTimer = setTimeout(doWipe, 5000);
  }
  function cancelWipe() {
    if (state.wipeTimer) {
      clearTimeout(state.wipeTimer);
      state.wipeTimer = 0;
    }
  }
  function doWipe() {
    state.wipeTimer = 0;
    if (state.importer) state.importer.clear();
    state.cells = [];
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
    if (el.previewImg) el.previewImg.removeAttribute('src');
    if (el.gridPreviewImg) el.gridPreviewImg.removeAttribute('src');
    renderGallery();
    renderGridCells();
    syncEmptyState();
    updateInfoBar(0, 0, 0);
    flashNote(tr('v03_wipe_done_all'), 'success');
  }

  /* ---------- 参数接线 ---------- */
  function wireVerticalParams() {
    // 方向
    if (el.dirSeg) el.dirSeg.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.vParams.direction = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 间距
    if (el.gapSlider) {
      el.gapSlider.value = state.vParams.gap;
      el.gapSlider.addEventListener('input', function () {
        state.vParams.gap = parseInt(el.gapSlider.value, 10) || 0;
        if (el.gapVal) el.gapVal.textContent = state.vParams.gap + 'px';
        el.gapSlider.style.setProperty('--p', state.vParams.gap + '%');
        scheduleRender();
        scheduleSave();
      });
    }
    // 背景
    if (el.bgSeg) el.bgSeg.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.vParams.bgColor = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 圆角
    if (el.radiusSlider) {
      el.radiusSlider.value = state.vParams.radius;
      el.radiusSlider.addEventListener('input', function () {
        state.vParams.radius = parseInt(el.radiusSlider.value, 10) || 0;
        if (el.radiusVal) el.radiusVal.textContent = state.vParams.radius + 'px';
        el.radiusSlider.style.setProperty('--p', state.vParams.radius * 2 + '%');
        scheduleRender();
        scheduleSave();
      });
    }
    // 对齐
    if (el.alignSeg) el.alignSeg.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.vParams.align = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 外边距
    if (el.marginSlider) {
      el.marginSlider.value = state.vParams.margin;
      el.marginSlider.addEventListener('input', function () {
        state.vParams.margin = parseInt(el.marginSlider.value, 10) || 0;
        if (el.marginVal) el.marginVal.textContent = state.vParams.margin + 'px';
        el.marginSlider.style.setProperty('--p', state.vParams.margin + '%');
        scheduleRender();
        scheduleSave();
      });
    }
    // 统一尺寸
    if (el.unifiedToggle) {
      el.unifiedToggle.checked = state.vParams.unified;
      el.unifiedToggle.addEventListener('change', function () {
        state.vParams.unified = el.unifiedToggle.checked;
        scheduleRender();
        scheduleSave();
      });
    }
    // 格式
    if (el.fmtSeg) el.fmtSeg.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.vParams.format = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 质量
    if (el.qualitySlider) {
      el.qualitySlider.value = state.vParams.quality;
      el.qualitySlider.addEventListener('input', function () {
        state.vParams.quality = parseInt(el.qualitySlider.value, 10) || 92;
        if (el.qualityVal) el.qualityVal.textContent = state.vParams.quality + '%';
        el.qualitySlider.style.setProperty('--p', state.vParams.quality + '%');
        scheduleSave();
      });
    }
  }

  /* ---------- 数字步进器（去原生化）：- [文本框] +
     行为统一处理：int 限制（仅数字字符）/ 前导零去除（输 007 → 7）/
     失焦范围矫正（<min 取 min，>max 取 max）/ 边界按钮禁用 */
  function parseStepDigits(raw) {
    var s = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (s === '') return null;
    s = s.replace(/^0+(?=\d)/, ''); // 去前导零
    return s === '' ? 0 : parseInt(s, 10);
  }
  function clampStep(v, min, max, fallback) {
    if (v == null || isNaN(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }
  function initNumStep(root, opts) {
    var min = opts.min, max = opts.max, fallback = opts.fallback;
    var input = root.querySelector('.step-val');
    var btns = root.querySelectorAll('[data-step]');
    if (!input || btns.length === 0) return;
    function syncBtns(n) {
      btns.forEach(function (b) {
        var s = parseInt(b.getAttribute('data-step'), 10) || 0;
        if (s < 0) b.disabled = n <= min;
        else if (s > 0) b.disabled = n >= max;
      });
    }
    function setVal(n) {
      n = parseStepDigits(n);          // 先去非数字字符 + 去前导零（如 007 → 7）
      n = clampStep(n, min, max, fallback); // 再按 min/max 夹取（失焦矫正）
      input.value = String(n);
      syncBtns(n);
      opts.onChange(n);
    }
    // 增减按钮：读取 data-step 步长（与全站 .step-btn 约定一致）
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var s = parseInt(b.getAttribute('data-step'), 10) || 0;
        setVal(parseStepDigits(input.value) + s);
      });
    });
    // 实时限制：只允许数字字符（粘贴 / 输入非数字会被清洗掉）
    input.addEventListener('input', function () {
      var cleaned = String(input.value).replace(/\D/g, '');
      if (cleaned !== input.value) input.value = cleaned;
    });
    // 失焦：去前导零 + 范围矫正 + 边界同步（关键矫正点）
    input.addEventListener('blur', function () { setVal(input.value); });
    // Enter = 失焦；上下方向键 = 加/减
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); var inc = root.querySelector('[data-step="1"]'); if (inc) inc.click(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); var dec = root.querySelector('[data-step="-1"]'); if (dec) dec.click(); }
    });
    // 初始化（用存档值或 input 默认值）
    setVal(opts.initValue != null ? opts.initValue : input.value);
  }
  /* 程序化设置步进器值（用于模板切换/配置恢复时同步 UI） */
  function setNumStepValue(target, v) {
    var root = document.querySelector('#stitchCustomCtl [data-step-target="' + target + '"]');
    if (!root) return;
    var input = root.querySelector('.step-val');
    var btns = root.querySelectorAll('[data-step]');
    var n = clampStep(parseStepDigits(v), 1, 6, 3);
    if (input) input.value = String(n);
    btns.forEach(function (b) {
      var s = parseInt(b.getAttribute('data-step'), 10) || 0;
      if (s < 0) b.disabled = n <= 1;
      else if (s > 0) b.disabled = n >= 6;
    });
  }

  function wireGridParams() {
    // 模板
    if (el.tplBtns) el.tplBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var tpl = b.getAttribute('data-tpl');
        applyTemplate(tpl);
      });
    });
    // 自定义行列（复用全站 .step 标准步进器）
    document.querySelectorAll('#stitchCustomCtl [data-step-target]').forEach(function (root) {
      var target = root.getAttribute('data-step-target'); // 'rows' 或 'cols'
      initNumStep(root, {
        min: 1, max: 6, fallback: 3,
        initValue: state.gParams[target],
        onChange: function (v) {
          state.gParams[target] = v;
          rebuildCells();
          renderGridCells();
          scheduleRender();
          scheduleSave();
        }
      });
    });
    // 间距
    if (el.gapSliderG) {
      el.gapSliderG.value = state.gParams.gap;
      el.gapSliderG.addEventListener('input', function () {
        state.gParams.gap = parseInt(el.gapSliderG.value, 10) || 0;
        if (el.gapValG) el.gapValG.textContent = state.gParams.gap + 'px';
        el.gapSliderG.style.setProperty('--p', state.gParams.gap + '%');
        renderGridCells();
        scheduleRender();
        scheduleSave();
      });
    }
    // 背景
    if (el.bgSegG) el.bgSegG.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.gParams.bgColor = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 圆角
    if (el.radiusSliderG) {
      el.radiusSliderG.value = state.gParams.radius;
      el.radiusSliderG.addEventListener('input', function () {
        state.gParams.radius = parseInt(el.radiusSliderG.value, 10) || 0;
        if (el.radiusValG) el.radiusValG.textContent = state.gParams.radius + 'px';
        el.radiusSliderG.style.setProperty('--p', state.gParams.radius * 2 + '%');
        applyGridPreviewRadius(); // 立即生效，不等 300ms 防抖，拖动手感更跟手
        scheduleRender();
        scheduleSave();
      });
    }
    // 填充方式
    if (el.fillSeg) el.fillSeg.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.gParams.fillMode = b.value;
        applyGridPreviewFill(); // 立即生效，不等 300ms 防抖
        scheduleRender();
        scheduleSave();
      });
    });
    // 格子宽高比
    if (el.ratioSeg) el.ratioSeg.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.gParams.cellRatio = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 格式
    if (el.fmtSegG) el.fmtSegG.forEach(function (b) {
      b.addEventListener('change', function () {
        if (!b.checked) return;
        state.gParams.format = b.value;
        scheduleRender();
        scheduleSave();
      });
    });
    // 质量
    if (el.qualitySliderG) {
      el.qualitySliderG.value = state.gParams.quality;
      el.qualitySliderG.addEventListener('input', function () {
        state.gParams.quality = parseInt(el.qualitySliderG.value, 10) || 92;
        if (el.qualityValG) el.qualityValG.textContent = state.gParams.quality + '%';
        el.qualitySliderG.style.setProperty('--p', state.gParams.quality + '%');
        scheduleSave();
      });
    }
    // 单格面板
    if (el.cellPanelClose) el.cellPanelClose.addEventListener('click', closeCellPanel);
    if (el.cellPanelClear) el.cellPanelClear.addEventListener('click', function () {
      if (state.selectedCell != null) clearCell(state.selectedCell);
    });
    if (el.cellPanelMask) el.cellPanelMask.addEventListener('click', function (e) {
      if (e.target === el.cellPanelMask) closeCellPanel();
    });
    // 移动模式
    if (el.moveModeBtn) el.moveModeBtn.addEventListener('click', enterMoveMode);
    if (el.moveModeExit) el.moveModeExit.addEventListener('click', exitMoveMode);
  }

  function applyTemplate(tpl) {
    state.gParams.template = tpl;
    el.tplBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tpl') === tpl); });
    if (tpl === 'custom') {
      if (el.customCtl) el.customCtl.classList.add('active');
    } else {
      if (el.customCtl) el.customCtl.classList.remove('active');
      var parts = tpl.split('x');
      state.gParams.rows = parseInt(parts[0], 10);
      state.gParams.cols = parseInt(parts[1], 10);
      // 走步进器同步（夹取 1-6 + 更新增减按钮禁用态），不再直接写原生 input
      setNumStepValue('rows', state.gParams.rows);
      setNumStepValue('cols', state.gParams.cols);
    }
    rebuildCells();
    renderGridCells();
    scheduleRender();
    scheduleSave();
  }

  /* ---------- 同步 UI 从参数 ---------- */
  function syncUIFromParams() {
    // 单向
    if (el.dirSeg) el.dirSeg.forEach(function (b) { b.checked = (b.value === state.vParams.direction); });
    if (el.gapSlider) {
      el.gapSlider.value = state.vParams.gap;
      el.gapSlider.style.setProperty('--p', state.vParams.gap + '%');
    }
    if (el.gapVal) el.gapVal.textContent = state.vParams.gap + 'px';
    if (el.bgSeg) el.bgSeg.forEach(function (b) { b.checked = (b.value === state.vParams.bgColor); });
    if (el.radiusSlider) {
      el.radiusSlider.value = state.vParams.radius;
      el.radiusSlider.style.setProperty('--p', state.vParams.radius * 2 + '%');
    }
    if (el.radiusVal) el.radiusVal.textContent = state.vParams.radius + 'px';
    if (el.alignSeg) el.alignSeg.forEach(function (b) { b.checked = (b.value === state.vParams.align); });
    if (el.marginSlider) {
      el.marginSlider.value = state.vParams.margin;
      el.marginSlider.style.setProperty('--p', state.vParams.margin + '%');
    }
    if (el.marginVal) el.marginVal.textContent = state.vParams.margin + 'px';
    if (el.unifiedToggle) el.unifiedToggle.checked = state.vParams.unified;
    if (el.fmtSeg) el.fmtSeg.forEach(function (b) { b.checked = (b.value === state.vParams.format); });
    if (el.qualitySlider) {
      el.qualitySlider.value = state.vParams.quality;
      el.qualitySlider.style.setProperty('--p', state.vParams.quality + '%');
    }
    if (el.qualityVal) el.qualityVal.textContent = state.vParams.quality + '%';
    // 网格
    if (el.tplBtns) el.tplBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tpl') === state.gParams.template); });
    if (el.customCtl) el.customCtl.classList.toggle('active', state.gParams.template === 'custom');
    setNumStepValue('rows', state.gParams.rows);
    setNumStepValue('cols', state.gParams.cols);
    if (el.gapSliderG) {
      el.gapSliderG.value = state.gParams.gap;
      el.gapSliderG.style.setProperty('--p', state.gParams.gap + '%');
    }
    if (el.gapValG) el.gapValG.textContent = state.gParams.gap + 'px';
    if (el.bgSegG) el.bgSegG.forEach(function (b) { b.checked = (b.value === state.gParams.bgColor); });
    if (el.radiusSliderG) {
      el.radiusSliderG.value = state.gParams.radius;
      el.radiusSliderG.style.setProperty('--p', state.gParams.radius * 2 + '%');
    }
    if (el.radiusValG) el.radiusValG.textContent = state.gParams.radius + 'px';
    if (el.fillSeg) el.fillSeg.forEach(function (b) { b.checked = (b.value === state.gParams.fillMode); });
    applyGridPreviewFill(); // 从存档恢复填充方式后同步预览
    if (el.ratioSeg) el.ratioSeg.forEach(function (b) { b.checked = (b.value === state.gParams.cellRatio); });
    if (el.fmtSegG) el.fmtSegG.forEach(function (b) { b.checked = (b.value === state.gParams.format); });
    if (el.qualitySliderG) {
      el.qualitySliderG.value = state.gParams.quality;
      el.qualitySliderG.style.setProperty('--p', state.gParams.quality + '%');
    }
    if (el.qualityValG) el.qualityValG.textContent = state.gParams.quality + '%';
  }

  /* ---------- 初始化 ---------- */
  function init() {
    cacheDom();
    if (!el.importZone) return; // 不是拼接页

    // 加载配置
    state.vParams = Object.assign({}, DEFAULT_VERTICAL);
    state.gParams = Object.assign({}, DEFAULT_GRID);
    loadConfig();

    // 初始化导入器
    initImporter();

    // 模式切换
    if (el.modeBtns) el.modeBtns.forEach(function (b) {
      b.addEventListener('change', function () {
        if (b.checked) switchMode(b.value);
      });
    });
    switchMode(state.mode);

    // 导入事件
    if (el.importZone) {
      el.importZone.addEventListener('click', function (e) {
        if (el.gallery && !el.gallery.hidden && el.gallery.contains(e.target)) return;
        if (el.fileInput) el.fileInput.click();
      });
      el.importZone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (el.fileInput) el.fileInput.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        el.importZone.addEventListener(ev, function (e) {
          if (isInternalThumbDrag(e)) return;    // 内部缩略图排序，交给 #stitchGalleryList
          if (!isExternalFileDrag(e)) return;   // 既非内部排序也非外部文件，不拦截
          e.preventDefault();
          el.importZone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        el.importZone.addEventListener(ev, function (e) {
          if (isInternalThumbDrag(e)) return;
          e.preventDefault();
          if (ev === 'dragleave' && e.relatedTarget && el.importZone.contains(e.relatedTarget)) return;
          el.importZone.classList.remove('dragover');
        });
      });
      el.importZone.addEventListener('drop', function (e) {
        if (isInternalThumbDrag(e)) return; // 内部排序由 #stitchGalleryList 的 handler 处理
        if (!isExternalFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) {
          cancelWipe();
          state.importer.addFiles(dt.files);
        }
      });
    }
    if (el.importZoneG) {
      el.importZoneG.addEventListener('click', function (e) {
        if (el.galleryG && !el.galleryG.hidden && el.galleryG.contains(e.target)) return;
        if (el.fileInput) el.fileInput.click();
      });
      el.importZoneG.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (el.fileInput) el.fileInput.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        el.importZoneG.addEventListener(ev, function (e) {
          if (isInternalThumbDrag(e)) return;
          if (!isExternalFileDrag(e)) return;
          e.preventDefault();
          el.importZoneG.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        el.importZoneG.addEventListener(ev, function (e) {
          if (isInternalThumbDrag(e)) return;
          e.preventDefault();
          if (ev === 'dragleave' && e.relatedTarget && el.importZoneG.contains(e.relatedTarget)) return;
          el.importZoneG.classList.remove('dragover');
        });
      });
      el.importZoneG.addEventListener('drop', function (e) {
        if (isInternalThumbDrag(e)) return;
        if (!isExternalFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) {
          cancelWipe();
          state.importer.addFiles(dt.files);
        }
      });
    }
    if (el.fileInput) {
      el.fileInput.addEventListener('change', function (e) {
        cancelWipe();
        state.importer.addFiles(e.target.files);
        el.fileInput.value = '';
      });
    }
    if (el.addMoreBtn) {
      el.addMoreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (el.fileInput) el.fileInput.click();
      });
    }
    if (el.addMoreBtnG) {
      el.addMoreBtnG.addEventListener('click', function (e) {
        e.stopPropagation();
        if (el.fileInput) el.fileInput.click();
      });
    }
    function doClear() {
      if (state.images.length > 0) {
        cancelWipe();
        state.importer.clear();
        state.cells = [];
        if (state.mode === 'grid') renderGridCells();
        flashNote(tr('v03_wipe_done_all'), 'success');
      }
    }
    if (el.clearThumbsBtn) el.clearThumbsBtn.addEventListener('click', function (e) { e.stopPropagation(); doClear(); });
    if (el.clearThumbsBtnG) el.clearThumbsBtnG.addEventListener('click', function (e) { e.stopPropagation(); doClear(); });
    if (el.clearBtn) el.clearBtn.addEventListener('click', doClear);
    if (el.clearBtnG) el.clearBtnG.addEventListener('click', doClear);

    // 全页拖放
    document.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', function (e) {
      if (isInternalThumbDrag(e)) return; // 内部缩略图排序绝不当作文件处理
      if (e.target === el.importZone || (el.importZone && el.importZone.contains(e.target))) return;
      if (e.target === el.importZoneG || (el.importZoneG && el.importZoneG.contains(e.target))) return;
      if (!isExternalFileDrag(e)) return; // 仅外部文件拖入才在全页范围接收
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        e.preventDefault();
        cancelWipe();
        state.importer.addFiles(dt.files);
      }
    });

    // 导出
    if (el.exportBtn) el.exportBtn.addEventListener('click', exportImage);
    if (el.exportBtnG) el.exportBtnG.addEventListener('click', exportImage);

    // 参数接线
    wireVerticalParams();
    wireGridParams();
    syncUIFromParams();

    // 初始渲染
    rebuildCells();
    renderGallery();
    renderGridCells();
    syncEmptyState();
    scheduleRender();

    // 语言切换刷新
    document.querySelectorAll('.lang-item').forEach(function (li) {
      li.addEventListener('click', function () {
        setTimeout(function () {
          renderGallery();
          syncEmptyState();
        }, 0);
      });
    });

    // 关页保存
    window.addEventListener('pagehide', function () {
      try { saveConfigNow(); } catch (e) {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
