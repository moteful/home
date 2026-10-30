/* Moteful · crop-tool.js · v2.0.0（裁切工具页面逻辑 · 功能开发）
 * 依赖：moteful.js、MFImageImport（image-import.js）、transform.js、zip.js、share.js、recommend.js、i18n
 * F-01~F-13 按设计文档逐步落地。
 * 取景窗固定模型契约（复用证件照已验收模型，不得破坏语义）：
 *   窗内拖 = 移动取景窗；窗外拖 / 滚轮 = 只移动图片（取景窗大小位置固定）；
 *   crop 由取景窗 + 视图反算并钳制；overlay 定位含 canvas 与预览盒 rect 差值补偿。
 */
(function () {
  'use strict';
  var root = {};
  window.CropTool = window.CropTool || { version: '2.0.0', ready: false };
  var S = { imp: null, items: [], activeId: null };

  function $(id) { return document.getElementById(id); }
  function tr(key) { return window.t ? window.t(key) : key; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* =====================================================================
     F-01 导入：复用 MFImageImport 队列 + 双态画廊（对齐 png-compressor.js
     initImport / renderGallery / renderGalleryUI；本页预览用 item.img 直绘 canvas）
     ===================================================================== */
  function initImport(tries) {
    tries = tries || 0;
    if (root.__CROP_IMPORT_BOUND) return;
    if (!window.MFImageImport) return;
    var dz = $('cropDropzone'), file = $('cropFile');
    /* 防御：defer 时序下 DOM 可能尚未就绪 → 轮询重试，不依赖 DOMContentLoaded 事件 */
    if (!dz || !file) {
      if (tries < 60) setTimeout(function () { initImport(tries + 1); }, 120);
      return;
    }
    S.imp = new window.MFImageImport({ onChange: renderGallery, onImport: function () {} });
    dz.addEventListener('click', function () { if (!S.imp.queue.length) file.click(); });
    dz.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && !S.imp.queue.length) { e.preventDefault(); file.click(); }
    });
    file.addEventListener('change', function () { S.imp.addFiles(file.files); file.value = ''; });
    ['dragover', 'drop'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files) S.imp.addFiles(e.dataTransfer.files);
      });
    });
    var reset = $('cropDzReset');
    if (reset) reset.addEventListener('click', function (e) {
      e.stopPropagation(); /* 阻止冒泡到 dropzone 的 click（queue 清空后会被判为「选择文件」而弹窗） */
      S.imp.queue.slice().forEach(function (it) { S.imp.remove(it.id); });
      renderGallery();
    });
    var addMore = $('cropDzAddMore');
    if (addMore) addMore.addEventListener('click', function (e) {
      e.stopPropagation();
      file.click();
    });
    if (window.MFImageImport.enablePaste) {
      window.MFImageImport.enablePaste(function (files) { S.imp.addFiles(files); });
    }
    root.__CROP_IMPORT_BOUND = true;
  }

  function currentItem() {
    var item = null;
    S.items.forEach(function (x) { if (x.id === S.activeId) item = x; });
    return item;
  }

  function renderGallery() {
    var q = S.imp ? S.imp.queue : [];
    var ids = {};
    q.forEach(function (it) { ids[it.id] = 1; });
    /* 移除项：摘除 */
    S.items = S.items.filter(function (it) {
      if (ids[it.id]) return true;
      if (S.activeId === it.id) S.activeId = null;
      return false;
    });
    /* 新增项：登记（img 由 MFImageImport 异步加载，加载完成后 onChange 再同步；drawImage 直用） */
    q.forEach(function (it) {
      var found = null;
      S.items.forEach(function (x) { if (x.id === it.id) found = x; });
      if (found) {
        found.img = it.img; found.width = it.width; found.height = it.height;
        found.thumbUrl = it.thumbUrl; found.status = it.status;
        return;
      }
      S.items.push({ id: it.id, name: it.name, file: it.file, img: it.img, width: it.width, height: it.height, thumbUrl: it.thumbUrl, status: it.status });
    });
    renderGalleryUI();
    gridNormalize();
    syncPreview();
    updateGridInfo();
    /* 有图可处理 → 启用「开始处理」 */
    var pb = $('cropProcessBtn');
    if (pb) pb.disabled = !S.items.length;
  }

  function renderGalleryUI() {
    var q = S.imp ? S.imp.queue : [];
    var empty = $('cropDzEmpty'), gal = $('cropDzGallery'), list = $('cropDzList'), cnt = $('cropDzCount');
    var dz = $('cropDropzone'), processBtn = $('cropProcessBtn');
    if (!empty || !gal || !list) return;
    bindDzSort();
    initCropNav();
    if (!q.length) {
      empty.hidden = false; gal.hidden = true;
      if (cnt) cnt.textContent = tr('crop_dz_count').replace('{n}', 0);
      if (dz) dz.classList.remove('mini');
      if (processBtn) processBtn.disabled = true;
      if (S.activeId) { S.activeId = null; syncPreview(); }
      return;
    }
    empty.hidden = true; gal.hidden = false;
    if (dz) dz.classList.add('mini');
    if (processBtn) processBtn.disabled = false;
    cnt.textContent = tr('crop_dz_count').replace('{n}', q.length);
    list.innerHTML = '';
    q.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'dz-thumb' + (it.id === S.activeId ? ' id-active' : '');
      el.setAttribute('data-id', it.id);
      el.setAttribute('title', it.name);
      el.innerHTML = '<img alt="">' +
        '<button type="button" class="dz-rm" aria-label="' + esc(tr('crop_res_remove')) + '"><i data-lucide="x"></i></button>';
      el.querySelector('img').src = it.thumbUrl || '';
      el.querySelector('.dz-rm').addEventListener('click', function (e) {
        e.stopPropagation();
        S.imp.remove(it.id);
        if (S.activeId === it.id) S.activeId = null;
        renderGallery();
      });
      el.addEventListener('click', function () { selectItem(it.id); });
      list.appendChild(el);
    });
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
    if (!S.activeId && q.length) selectItem(q[0].id);
  }

  /* ---- 导入区拖拽排序（复用 stitch.js 的 mousedown/move/up + touch 排序模式：
         插入指示线 .dz-insert-line、目标高亮 .drag-over、按行分组槽位计算；
         重排走 MFImageImport.move -> onChange -> renderGallery 联动预览） ---- */
  function bindDzSort() {
    var list = $('cropDzList');
    if (!list || list._cropSortBound) return;
    list._cropSortBound = true;
    var insertLine = document.createElement('div');
    insertLine.className = 'dz-insert-line';
    var lastIdx = -2;
    function hideLine() {
      insertLine.style.display = 'none';
      if (insertLine.parentNode) insertLine.parentNode.removeChild(insertLine);
      lastIdx = -2;
      var act = list.querySelectorAll('.dz-thumb.drag-over');
      Array.prototype.forEach.call(act, function (nd) { nd.classList.remove('drag-over'); });
    }
    function showLine(idx) {
      var thumbs = list.querySelectorAll('.dz-thumb');
      if (!thumbs.length) { hideLine(); return; }
      var listRect = list.getBoundingClientRect();
      var ref, before = true;
      if (idx >= thumbs.length) { ref = thumbs[thumbs.length - 1]; before = false; }
      else { ref = thumbs[idx]; before = true; }
      if (!ref) { hideLine(); return; }
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
    /* 槽位：落在缩略图左半=>插到它前，右半=>后；按行分组支持换行（对齐 stitch calcInsertIndex） */
    function calcIdx(clientX, clientY) {
      var thumbs = list.querySelectorAll('.dz-thumb');
      var n = thumbs.length;
      if (!n) return 0;
      var rects = [];
      for (var k = 0; k < n; k++) rects.push(thumbs[k].getBoundingClientRect());
      var rows = [];
      for (var a = 0; a < n; a++) {
        var top = rects[a].top, hgt = rects[a].height || 0;
        var row = null;
        for (var b = 0; b < rows.length; b++) {
          if (Math.abs(rows[b].top - top) <= rows[b].h * 0.5) { row = rows[b]; break; }
        }
        if (!row) { row = { top: top, h: hgt, items: [] }; rows.push(row); }
        row.items.push({ idx: a, r: rects[a] });
      }
      for (var c = 0; c < rows.length; c++) {
        var rw = rows[c];
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
              return clientX < mid ? it.idx : it.idx + 1;
            }
          }
          return rw.items[rw.items.length - 1].idx + 1;
        }
        if (clientY < rowTop) return rw.items[0].idx;
      }
      return n;
    }
    function reorder(srcId, idx) {
      if (!srcId || !S.imp) return;
      var srcIdx = -1;
      S.items.forEach(function (x, i) { if (x.id === srcId) srcIdx = i; });
      if (srcIdx < 0) return;
      var dst = idx;
      if (srcIdx < dst) dst = dst - 1;
      if (dst < 0) dst = 0;
      if (dst !== srcIdx) S.imp.move(srcIdx, dst);
    }
    function thumbFromTarget(t) {
      if (t && t.closest && (t.closest('.dz-rm') || t.closest('button'))) return null;
      return t && t.closest ? t.closest('.dz-thumb') : null;
    }
    var md = { on: false, active: false, srcId: null, sx: 0, sy: 0, last: -2 };
    /* 桌面：mousedown/mousemove/mouseup */
    list.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var thumb = thumbFromTarget(e.target);
      if (!thumb) return;
      md.on = true; md.active = false; md.srcId = thumb.getAttribute('data-id');
      md.sx = e.clientX; md.sy = e.clientY; md.last = -2;
    });
    document.addEventListener('mousemove', function (e) {
      if (!md.on) return;
      if (!md.active && Math.abs(e.clientX - md.sx) + Math.abs(e.clientY - md.sy) > 5) {
        md.active = true;
        var src = list.querySelector('.dz-thumb[data-id="' + md.srcId + '"]');
        if (src) src.classList.add('dragging');
      }
      if (!md.active) return;
      var idx = calcIdx(e.clientX, e.clientY);
      if (idx !== md.last) { md.last = idx; showLine(idx); }
    });
    document.addEventListener('mouseup', function () {
      if (!md.on) return;
      var wasActive = md.active;
      md.on = false; md.active = false;
      if (wasActive) reorder(md.srcId, md.last >= 0 ? md.last : 0);
      hideLine();
      var src = list.querySelector('.dz-thumb[data-id="' + md.srcId + '"]');
      if (src) src.classList.remove('dragging');
    });
    /* 触屏：touchstart/touchmove/touchend（对齐 stitch 同构逻辑） */
    list.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      var thumb = thumbFromTarget(e.target);
      if (!thumb || !t) return;
      md.on = true; md.active = false; md.srcId = thumb.getAttribute('data-id');
      md.sx = t.clientX; md.sy = t.clientY; md.last = -2;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!md.on) return;
      var t = e.touches[0];
      if (!t) return;
      if (!md.active && Math.abs(t.clientX - md.sx) + Math.abs(t.clientY - md.sy) > 5) {
        md.active = true;
        var src = list.querySelector('.dz-thumb[data-id="' + md.srcId + '"]');
        if (src) src.classList.add('is-dragging');
      }
      if (!md.active) return;
      e.preventDefault();
      var idx = calcIdx(t.clientX, t.clientY);
      if (idx !== md.last) { md.last = idx; showLine(idx); }
    }, { passive: false });
    document.addEventListener('touchend', function () {
      if (!md.on) return;
      var wasActive = md.active;
      md.on = false; md.active = false;
      if (wasActive) reorder(md.srcId, md.last >= 0 ? md.last : 0);
      hideLine();
      var src = list.querySelector('.dz-thumb[data-id="' + md.srcId + '"]');
      if (src) src.classList.remove('is-dragging');
    });
    list.addEventListener('mouseleave', hideLine);
  }

  function selectItem(id) {
    S.activeId = id;
    VIEW = { scale: 1, panX: 0, panY: 0 };
    var item = currentItem();
    if (item && item.width && item.height) { fitCropFrame(); setFitForItem(item); }
    gridNormalize();
    resetCrop();
    renderGalleryUI();
    renderPreview();
    updateGridInfo();
  }

  /* =====================================================================
     F-02/F-03 取景窗固定模型（对齐 id-photo-tool.js 已验收契约：
     S.ov 锚点固定；pointerdown 分流（窗内=cropDrag 拖窗 / 窗外=平移 dragState）；
     syncCropFromView 反算钳制；overlayRectFromCrop 正算；缩放下限防取景窗越界）
     ===================================================================== */
  var VIEW = { scale: 1, panX: 0, panY: 0 };   // 图片视图（相对 fit 的缩放与平移，预览盒坐标）
  S.crop = { x: 0, y: 0, w: 0, h: 0, visible: false };  // 原图像素坐标
  S.ov = null;                                        // 取景窗锚点（预览盒坐标，固定大小/位置）
  S.handles = {};                                     // 自由模式缩放手柄（角/边）
  S.fit = 0; S.prevW = 0; S.prevH = 0;                // 基础 fit 缩放与预览盒可视尺寸
  S.curW = 0; S.curH = 0;                             // 当前图片像素尺寸
  S.cropDrag = false;

  function currentMethod() {
    var v = document.querySelector('[name="cropMethod"]:checked');
    return v ? v.value : 'grid';
  }
  function currentRatio() {
    var v = document.querySelector('[name="cropRatio"]:checked');
    var val = v ? v.value : '1:1';
    if (val === 'custom') {
      var rw = parseInt(($('cropRatioWVal') || {}).textContent, 10) || 1;
      var rh = parseInt(($('cropRatioHVal') || {}).textContent, 10) || 1;
      return rh ? rw / rh : 1;
    }
    var p = String(val).split(':');
    return (+p[1]) ? (+p[0]) / (+p[1]) : 1;
  }

  /* 按当前图片设置 fit 与预览盒可视尺寸 */
  /* 预览窗口比例自适应（对齐 png-compressor fitCmpFrame：高度 = 图片按宽度等比缩放，≤480 封顶、≥200 兜底） */
  function fitCropFrame() {
    var frame = $('cropCanvasFrame');
    var item = currentItem();
    if (!frame || !item || !item.width || !item.height) return;
    var MAX = 480, MIN = 200;
    /* 90/270° 展示宽高互换，框架高度必须按旋转后的有效宽高计算，否则旋转图溢出并裁错网格线 */
    var swap = rotateDeg() === 90 || rotateDeg() === 270;
    var ew = swap ? item.height : item.width;
    var eh = swap ? item.width : item.height;
    var s = frame.clientWidth / ew;
    var h = Math.min(eh * s, MAX);
    frame.style.height = Math.max(h, MIN) + 'px';
  }

  function setFitForItem(item) {
    var frame = $('cropCanvasFrame');
    if (!frame) return;
    var r = frame.getBoundingClientRect();
    S.prevW = Math.max(1, r.width);
    S.prevH = Math.max(1, r.height);
    S.curW = item.width; S.curH = item.height;
    var swap = rotateDeg() === 90 || rotateDeg() === 270;
    var ew = swap ? item.height : item.width;
    var eh = swap ? item.width : item.height;
    S.fit = Math.min(S.prevW / ew, S.prevH / eh);
  }

  /* 渲染预览：图片视图（fit × scale + pan）绘制到画布 + 取景窗定位；
     单个模式：切换为每张图片处理效果网格（参考实验网页），取景窗/缩略图条隐藏 */
  function renderPreview() {
    var sg = $('cropSingleGrid');
    if (currentMethod() === 'single') {
      var frame = $('cropCanvasFrame'), strip = $('cropCmpStrip');
      if (sg) { sg.hidden = false; scheduleSingleRender(); }
      if (frame) frame.hidden = true;
      if (strip) strip.hidden = true;
      return;
    }
    if (sg) sg.hidden = true;
    var frameEl = $('cropCanvasFrame');
    if (frameEl) frameEl.hidden = false;
    renderCropStrip();
    var cv = $('cropCv'), ph = $('cropPreviewPh');
    if (!cv || !ph) return;
    var item = currentItem();
    if (!item || !item.img || !item.width || !item.height) {
      ph.hidden = false; cv.hidden = true;
      return;
    }
    /* 预览窗口高度随图片比例自适应；每次按当前 frame 尺寸重算基础 fit
       （single 态 frame 隐藏导致 selectItem 时缓存过旧高度，切回 grid 必须重算） */
    fitCropFrame();
    setFitForItem(item);
    ph.hidden = true; cv.hidden = false;
    cv.width = S.prevW; cv.height = S.prevH;
    cv.style.width = S.prevW + 'px'; cv.style.height = S.prevH + 'px';
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, S.prevW, S.prevH);
    var sc = S.fit * VIEW.scale;
    var dw0 = S.curW * sc, dh0 = S.curH * sc;
    var rot = rotateDeg(), fl = flipState();
    var swap = (rot === 90 || rot === 270);
    /* 90/270 展示宽高互换；旋转/翻转在同一上下文内施加，图片与网格线同处变换空间保持对齐 */
    var cx0 = S.prevW / 2 + VIEW.panX, cy0 = S.prevH / 2 + VIEW.panY;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.translate(cx0, cy0);
    if (fl.flipH || fl.flipV) ctx.scale(fl.flipH ? -1 : 1, fl.flipV ? -1 : 1);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(item.img, -dw0 / 2, -dh0 / 2, dw0, dh0);
    if (currentMethod() === 'grid') drawGridLines(ctx, -dw0 / 2, -dh0 / 2, dw0, dh0);
    ctx.restore();
    updateCropOverlay();
    updateGridInfo();
  }

  /* 网格裁切线：直接按已绘制整图框均匀等分（外框闭合 + 内部贯穿分隔线，仅视觉提示，导出仍按格子独立输出）；
     不依赖 gridCells 的方形居中/sx 偏移，避免预览分割线与整图错位、间距不等 */
  function drawGridLines(ctx, ox, oy, w, h) {
    var rows = Math.max(1, Math.min(6, cropRowsVal()));
    var cols = Math.max(1, Math.min(6, cropColsVal()));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, w, h);
    for (var c = 1; c < cols; c++) {
      var vx = ox + w * c / cols;
      ctx.beginPath();
      ctx.moveTo(vx, oy); ctx.lineTo(vx, oy + h);
      ctx.stroke();
    }
    for (var r = 1; r < rows; r++) {
      var hy = oy + h * r / rows;
      ctx.beginPath();
      ctx.moveTo(ox, hy); ctx.lineTo(ox + w, hy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 批量缩略图条（复用 png-compressor renderCmpStrip 模式 + 共享 .dz-thumb）：多图时显示，点击切换预览对象 */
  function renderCropStrip() {
    var strip = $('cropCmpStrip');
    if (!strip) return;
    if (S.items.length < 2) {
      strip.hidden = true;
      strip.innerHTML = '';
      var nav = $('cropCmpNav');
      if (nav) nav.hidden = true;
      updateCropNav();
      return;
    }
    strip.hidden = false;
    var html = '';
    S.items.forEach(function (it) {
      var src = it.thumbUrl || '';
      html += '<div class="dz-thumb' + (it.id === S.activeId ? ' id-active' : '') + '" data-id="' + it.id + '" role="button" tabindex="0"><img alt="" draggable="false" src="' + esc(src) + '"></div>';
    });
    strip.innerHTML = html;
    Array.prototype.forEach.call(strip.querySelectorAll('.dz-thumb'), function (t) {
      var pick = function () {
        var id = t.getAttribute('data-id');
        if (id && id !== S.activeId) selectItem(id);
      };
      t.addEventListener('click', pick);
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    var nav = $('cropCmpNav');
    if (nav) nav.hidden = false;
    updateCropNav();
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
  }

  /* 翻页按钮显隐（对齐 png-compressor updateCmpNav）：多图时显示，首尾对应隐藏 */
  function updateCropNav() {
    var prev = $('cropCmpPrev'), next = $('cropCmpNext');
    if (!prev || !next) return;
    var idx = -1;
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === S.activeId) { idx = i; break; }
    var multi = S.items.length > 1;
    prev.hidden = !multi || idx <= 0;
    next.hidden = !multi || idx < 0 || idx >= S.items.length - 1;
  }

  /* 翻页点击：切换到相邻图片（selectItem 内会同步渲染预览与缩略图条） */
  function initCropNav() {
    var prev = $('cropCmpPrev'), next = $('cropCmpNext');
    if (!prev || !next) return;
    if (prev._cropNavBound) return;
    prev._cropNavBound = true;
    next._cropNavBound = true;
    prev.addEventListener('click', function () {
      for (var i = 0; i < S.items.length; i++) {
        if (S.items[i].id === S.activeId) {
          if (i > 0) selectItem(S.items[i - 1].id);
          return;
        }
      }
    });
    next.addEventListener('click', function () {
      for (var i = 0; i < S.items.length; i++) {
        if (S.items[i].id === S.activeId) {
          if (i < S.items.length - 1) selectItem(S.items[i + 1].id);
          return;
        }
      }
    });
  }

  /* 取景窗锚点正算：crop（原图像素）→ 预览盒坐标（canvas 与预览盒同原点，保留 rect 差值补偿契约代码） */
  function overlayRectFromCrop(cr) {
    var sc = S.fit * VIEW.scale;
    var workLeft = S.prevW / 2 + VIEW.panX - S.curW * sc / 2;
    var workTop = S.prevH / 2 + VIEW.panY - S.curH * sc / 2;
    return { x: workLeft + cr.x * sc, y: workTop + cr.y * sc, w: cr.w * sc, h: cr.h * sc };
  }

  /* 取景窗固定模型核心：crop 由 ov 与当前视图反算并 clamp 到图片内，再回写对齐：
       fixOv=true  → 拖取景窗（pan 不动，ov 回写对齐 crop）
       fixOv=false → 图片平移/缩放（ov 不动，pan 回写对齐 crop） */
  function syncCropFromView(fixOv) {
    if (!S.crop.visible || !S.ov) return;
    var sc = S.fit * VIEW.scale;
    var workLeft = S.prevW / 2 + VIEW.panX - S.curW * sc / 2;
    var workTop = S.prevH / 2 + VIEW.panY - S.curH * sc / 2;
    var o = S.ov;
    var cw = Math.max(1, Math.min(S.curW, Math.round(o.w / sc)));
    var ch = Math.max(1, Math.min(S.curH, Math.round(o.h / sc)));
    var cx = Math.max(0, Math.min(S.curW - cw, Math.round((o.x - workLeft) / sc)));
    var cy = Math.max(0, Math.min(S.curH - ch, Math.round((o.y - workTop) / sc)));
    S.crop.x = cx; S.crop.y = cy; S.crop.w = cw; S.crop.h = ch;
    if (fixOv) {
      S.ov.x = workLeft + cx * sc;
      S.ov.y = workTop + cy * sc;
    } else {
      VIEW.panX = o.x - cx * sc - S.prevW / 2 + S.curW * sc / 2;
      VIEW.panY = o.y - cy * sc - S.prevH / 2 + S.curH * sc / 2;
    }
  }

  function updateCropOverlay() {
    var ov = $('cropOverlay');
    if (!ov) return;
    if (!S.crop.visible || !S.ov) { ov.hidden = true; }
    else {
      ov.hidden = false;
      /* 仅显示层裁掉四边越界（满高/满宽居中产生的 ±1px 超出），内部 S.ov 坐标保持不变，不影响 crop 反算；
         顶/左为负时先把框拉回框内并相应缩减尺寸，底/右超出时再截掉多出量，四边描边都不被 overflow:hidden 裁掉 */
      var fr = $('cropCanvasFrame');
      var fh = fr ? fr.clientHeight : 0, fw = fr ? fr.clientWidth : 0;
      var dx = S.ov.x, dy = S.ov.y, dw = S.ov.w, dh = S.ov.h;
      if (fh) {
        if (dy < 0) { dh += dy; dy = 0; }
        var overB = dy + dh - fh; if (overB > 0) dh = Math.max(1, dh - overB);
      }
      if (fw) {
        if (dx < 0) { dw += dx; dx = 0; }
        var overR = dx + dw - fw; if (overR > 0) dw = Math.max(1, dw - overR);
      }
      ov.style.left = dx + 'px';
      ov.style.top = dy + 'px';
      ov.style.width = dw + 'px';
      ov.style.height = dh + 'px';
    }
    /* 缩放手柄仅自由模式显示（比例模式框比例锁定，网格/单个无取景窗） */
    var showH = !ov.hidden && currentMethod() === 'free';
    Object.keys(S.handles).forEach(function (h) { S.handles[h].hidden = !showH; });
  }

  /* 重置取景窗：比例=图片内最大比例矩形居中；自由=80% 居中；网格=隐藏取景窗 */
  function resetCrop() {
    var m = currentMethod();
    var item = currentItem();
    if (!item || !item.width || !item.height) { S.crop.visible = false; S.ov = null; updateCropOverlay(); return; }
    S.curW = item.width; S.curH = item.height;
    if (m === 'grid' || m === 'single') {
      S.crop.visible = false; S.ov = null;
      updateCropOverlay();
      return;
    }
    S.crop.visible = true;
    var ratio = currentRatio();
    var w = S.curW, h = S.curH, cw, ch;
    if (m === 'ratio') {
      if (w / h > ratio) { ch = h; cw = Math.max(1, Math.round(h * ratio)); }
      else { cw = w; ch = Math.max(1, Math.round(w / ratio)); }
    } else {
      cw = Math.max(1, Math.round(w * 0.8)); ch = Math.max(1, Math.round(h * 0.8));
    }
    S.crop.x = Math.round((w - cw) / 2); S.crop.y = Math.round((h - ch) / 2);
    S.crop.w = cw; S.crop.h = ch;
    S.ov = overlayRectFromCrop(S.crop);
    updateCropOverlay();
    syncFreeSizeFields();
  }

  /* 预览区交互：平移（窗外拖）/ 滚轮缩放 / 双击复位 / 取景窗拖动（窗内拖） */
  function initPreviewEvents() {
    var frame = $('cropCanvasFrame');
    if (!frame) return;
    frame.addEventListener('dragstart', function (e) { e.preventDefault(); });
    frame.addEventListener('pointerdown', function (e) {
      if (S.cropDrag) return;                       // 取景窗拖动占用中：平移不得抢
      if (e.target && (e.target.closest('.crop-overlay') || e.target.closest('.dz-rm') || e.target.closest('button'))) return;
      if (!S.crop.visible) return;                  // 网格模式无取景交互
      S.dragState = { x: e.clientX, y: e.clientY, px: VIEW.panX, py: VIEW.panY };
      frame.classList.add('drag-active');
      if (frame.setPointerCapture) frame.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    frame.addEventListener('pointermove', function (e) {
      if (!S.dragState || S.cropDrag) return;       // 拖取景窗期间绝不平移图片
      VIEW.panX = S.dragState.px + (e.clientX - S.dragState.x);
      VIEW.panY = S.dragState.py + (e.clientY - S.dragState.y);
      syncCropFromView(false);
      renderPreview();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      frame.addEventListener(ev, function () {
        if (!S.dragState) return;
        S.dragState = null;
        frame.classList.remove('drag-active');
      });
    });
    frame.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!S.crop.visible) return;
      var z = VIEW.scale * (e.deltaY < 0 ? 1.1 : 0.9);
      z = Math.min(8, Math.max(0.5, z));
      /* 取景窗固定模型：缩放下限 = 取景窗覆盖区域不得超出图片（图片不够裁会出空白） */
      if (S.ov) {
        var minSc = Math.max(S.ov.w / S.curW, S.ov.h / S.curH);
        if (S.fit * z < minSc) z = minSc / S.fit;
      }
      VIEW.scale = z;
      syncCropFromView(false);
      renderPreview();
    }, { passive: false });
    frame.addEventListener('dblclick', function () {
      if (!S.crop.visible) return;
      VIEW = { scale: 1, panX: 0, panY: 0 };
      resetCrop();
      renderPreview();
    });
    /* 取景窗拖动：窗内拖只动取景窗（S.cropDrag=true 时平移监听一律让路） */
    var ov = $('cropOverlay');
    if (ov) {
      /* 自由模式缩放手柄（角 nw/ne/sw/se + 边 n/s/w/e）：一次性建节点，updateCropOverlay 按模式显隐 */
      ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].forEach(function (h) {
        var el = document.createElement('div');
        el.className = 'crop-h';
        el.setAttribute('data-h', h);
        el.hidden = true;
        ov.appendChild(el);
        S.handles[h] = el;
      });
      Object.keys(S.handles).forEach(function (h) {
        S.handles[h].addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          e.preventDefault();
          if (!S.crop.visible || !S.ov || currentMethod() !== 'free') return;
          S.dragState = null;
          S.cropDrag = true;
          var sc = S.fit * VIEW.scale || 1;
          var sx = e.clientX, sy = e.clientY;
          var c0 = { x: S.crop.x, y: S.crop.y, w: S.crop.w, h: S.crop.h };
          function move(ev) {
            var dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
            var nx = c0.x, ny = c0.y, nw = c0.w, nh = c0.h;
            if (h.indexOf('w') >= 0) { nx = c0.x + dx; nw = c0.w - dx; }
            else if (h.indexOf('e') >= 0) { nw = c0.w + dx; }
            if (h.indexOf('n') >= 0) { ny = c0.y + dy; nh = c0.h - dy; }
            else if (h.indexOf('s') >= 0) { nh = c0.h + dy; }
            var MIN = 20;
            nw = Math.max(MIN, Math.min(S.curW, nw));
            nh = Math.max(MIN, Math.min(S.curH, nh));
            nx = Math.max(0, Math.min(S.curW - nw, nx));
            ny = Math.max(0, Math.min(S.curH - nh, ny));
            S.crop.x = Math.round(nx); S.crop.y = Math.round(ny);
            S.crop.w = Math.round(nw); S.crop.h = Math.round(nh);
            S.ov = overlayRectFromCrop(S.crop);
            updateCropOverlay();
            syncFreeSizeFields();
          }
          function up() {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            S.cropDrag = false;
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', up);
        });
      });
      ov.addEventListener('pointerdown', function (e) {
      if (!S.crop.visible || !S.ov) return;
      e.stopPropagation();
      e.preventDefault();
      S.dragState = null;
      S.cropDrag = true;
      frame.classList.remove('drag-active');
      var startX = e.clientX, startY = e.clientY;
      var ox = S.ov.x, oy = S.ov.y;
      function move(ev) {
        if (!S.ov) return;
        S.ov.x = ox + (ev.clientX - startX);
        S.ov.y = oy + (ev.clientY - startY);
        syncCropFromView(true);                       // 拖取景窗：pan 固定，ov 钳制在图片范围内
        updateCropOverlay();
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        S.cropDrag = false;
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    }
    /* 键盘微调：方向键 1px / Shift+方向键 10px 移动取景窗；Esc 退出自由取景回比例模式 */
    window.addEventListener('keydown', function (e) {
      if (!S.crop.visible || !S.ov) return;
      var tag = (document.activeElement || {}).tagName || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      var step = e.shiftKey ? 10 : 1;
      var dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === 'Escape') {
        if (currentMethod() === 'free') {
          var r = document.querySelector('[name="cropMethod"][value="ratio"]');
          if (r) { r.checked = true; syncSegOn(); syncPreset(); resetCrop(); renderPreview(); }
        }
        return;
      }
      if (dx || dy) {
        e.preventDefault();
        S.ov.x += dx; S.ov.y += dy;
        syncCropFromView(true);
        updateCropOverlay();
      }
    });
  }

  /* 基础预览入口（F-01 阶段保留；现在统一走 renderPreview） */
  function syncPreview() { renderPreview(); }
  window.addEventListener('resize', function () {
    var item = currentItem();
    if (item && item.width && item.height) setFitForItem(item);
    renderPreview();
  });

  /* =====================================================================
     数字步进器：全站统一复用 moteful.js 共享 .step 组件（input/span 兼容读写 + 边界 disabled + input 派发），
     本页不再重复绑定，杜绝双触发
     ===================================================================== */

  /* 比例预设自定义：cropRatio=custom 时显示自定义比例（宽:高步进器），其余隐藏 */
  var ratioBar = $('cropRatioBar');
  if (ratioBar) {
    var ratioCustom = $('cropRatioCustom');
    function syncRatioCustom() {
      var v = document.querySelector('[name="cropRatio"]:checked');
      if (ratioCustom) ratioCustom.hidden = !v || v.value !== 'custom';
    }
    document.querySelectorAll('[name="cropRatio"]').forEach(function (r) {
      r.addEventListener('change', function () {
        syncRatioCustom();
        /* 比例切换 → 取景窗按新比例重算居中（F-02 语义，避免沿用旧比例） */
        resetCrop();
        renderPreview();
      });
    });
    syncRatioCustom();
  }

  /* 裁剪方式 ↔ 预设区互斥（相同位置）：网格→网格预设，比例→比例预设，自由/单个→隐藏预设 */
  function syncPreset() {
    var v = document.querySelector('[name="cropMethod"]:checked');
    var m = v ? v.value : '';
    var ratioBarEl = $('cropRatioBar');
    var gridBarEl = $('cropGridBar');
    if (ratioBarEl) ratioBarEl.hidden = m !== 'ratio';
    if (gridBarEl) gridBarEl.hidden = m !== 'grid';
  }
  /* 裁剪方式 ↔ 预设区互斥（相同位置）：网格→网格预设，比例→比例预设，自由/单个→隐藏预设；
     方式联动画布模式：自由→指定尺寸(custom)；网格→原尺寸(original)且内距归0；比例/单个沿用用户当前画布选择 */
  function setCanvasMode(val) {
    var r = document.querySelector('[name="cropCanvas"][value="' + val + '"]');
    if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function setPadValue(n) {
    var pv = $('cropPadVal');
    if (!pv) return;
    n = Math.max(0, Math.min(100, parseInt(n, 10) || 0));
    pv.textContent = n;
    var step = pv.closest('.step');
    if (step) {
      step.querySelectorAll('.step-btn').forEach(function (b) {
        var st = parseInt(b.dataset.step, 10) || 0;
        b.disabled = st < 0 ? n <= 0 : n >= 100;
      });
    }
  }
  /* 网格态强制原尺寸画布 + 内距0：新图选中 / 刷新恢复为网格时统一复位，不沿用上次画布模式与内距 */
  function gridNormalize() {
    if (currentMethod() !== 'grid') return;
    setCanvasMode('original');
    setPadValue(0);
  }
  /* 自由模式自动关闭锁比例（取景框可自由变形，宽高不再按图片比例互算） */
  function unlockLock() {
    var lb = $('cropLock');
    if (!lb) return;
    lb.setAttribute('aria-pressed', 'false');
    lb.classList.remove('on');
    lb.querySelectorAll('svg[data-link]').forEach(function (s) {
      s.hidden = s.getAttribute('data-link') === 'on';
    });
  }
  /* 自由 + 指定尺寸：取景框选区像素尺寸实时回写输出尺寸（输出=选区，等比缩放系数为1） */
  function syncFreeSizeFields() {
    if (currentMethod() !== 'free') return;
    if (canvasMode() !== 'custom') return;
    if (!S.crop.visible || !S.crop.w) return;
    var wi = $('cropWidth'), hi = $('cropHeight');
    if (!wi || !hi) return;
    wi.value = String(Math.max(1, Math.round(S.crop.w)));
    hi.value = String(Math.max(1, Math.round(S.crop.h)));
  }
  document.querySelectorAll('[name="cropMethod"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var mv = currentMethod();
      if (mv === 'free') { setCanvasMode('custom'); unlockLock(); }
      else if (mv === 'grid') { setCanvasMode('original'); setPadValue(0); }
      syncPreset();
      syncTplHighlight();
      resetCrop();
      syncFreeSizeFields();
      renderPreview();
      updateGridInfo();
    });
  });
  syncPreset();

  /* 网格行列步进器程序化设值（对齐共享 stepSet：夹取 data-min/max + 写值 + 同步 +/- 禁用态 + 派发 input） */
  function setGridStepValue(root, n) {
    if (!root) return;
    var out = root.querySelector('.step-val');
    if (!out) return;
    var min = +(root.dataset.min || 1), max = +(root.dataset.max || 6);
    n = Math.max(min, Math.min(max, parseInt(n, 10) || 3));
    out.textContent = n;
    root.querySelectorAll('.step-btn').forEach(function (b) {
      var st = parseInt(b.dataset.step, 10) || 0;
      if (st < 0) b.disabled = n <= min;
      else if (st > 0) b.disabled = n >= max;
    });
    out.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 模板按钮高亮与行列值对齐（记忆/分享恢复后调用，避免高亮与实际分割错位） */
  function syncTplHighlight() {
    var gridBarEl = $('cropGridBar');
    if (!gridBarEl) return;
    var tplBtns = gridBarEl.querySelectorAll('[data-tpl]');
    var customCtl = $('cropGridCustom');
    var r = cropRowsVal(), c = cropColsVal();
    var match = null;
    tplBtns.forEach(function (b) {
      var t = b.getAttribute('data-tpl');
      if (t === 'custom') return;
      var parts = t.split('x');
      if (parseInt(parts[0], 10) === r && parseInt(parts[1], 10) === c) match = t;
    });
    tplBtns.forEach(function (x) {
      var t = x.getAttribute('data-tpl');
      x.classList.toggle('on', t === match || (!match && t === 'custom'));
    });
    /* 内置模板命中则隐藏自定义面板；自定义/非模板组合保持自定义选中并展开 */
    if (customCtl) customCtl.hidden = !!match;
  }

  /* 网格模板：点击切换 .on 高亮 + 自定义行列显隐（对齐 stitch.js applyTemplate L1346-1363） */
  var gridBarEl = $('cropGridBar');
  if (gridBarEl) {
    var tplBtns = gridBarEl.querySelectorAll('[data-tpl]');
    var customCtl = $('cropGridCustom');
    /* 程序态计数：内置模板会连续派发两行/列两次 input，计数归零后才走 syncTplHighlight；
       用户手动点自定义步进器（计数=0）才保持「自定义」选中与面板打开 */
    var tplProgrammatic = 0;
    tplBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var tpl = b.getAttribute('data-tpl');
        tplBtns.forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tpl') === tpl); });
        if (customCtl) customCtl.hidden = tpl !== 'custom';
        if (tpl !== 'custom') {
          var parts = tpl.split('x');
          var rows = document.querySelector('.step[data-for="cropRowsVal"]');
          var cols = document.querySelector('.step[data-for="cropColsVal"]');
          tplProgrammatic = 2;
          /* 对齐共享 stepSet：写值 + 按 data-min/data-max 同步 +/- 禁用态 + 派发 input（不直接裸写 textContent） */
          setGridStepValue(rows, parseInt(parts[0], 10));
          setGridStepValue(cols, parseInt(parts[1], 10));
        }
        if (currentMethod() === 'grid') { resetCrop(); renderPreview(); }
      });
    });
    /* 步进按钮由 moteful.js 全局 .step 绑定（readV+step→写值→派发 input）：
       内置模板程序化设值 → 计数归零后 syncTplHighlight 对齐；手动自定义步进 → 保持自定义选中/面板打开并刷新预览 */
    ['cropRowsVal', 'cropColsVal'].forEach(function (key) {
      var sv = $('' + key);
      if (sv) sv.addEventListener('input', function () {
        if (tplProgrammatic > 0) {
          tplProgrammatic -= 1;
          if (tplProgrammatic === 0) syncTplHighlight();
        } else {
          var customBtn = gridBarEl.querySelector('[data-tpl="custom"]');
          tplBtns.forEach(function (x) { x.classList.toggle('on', x === customBtn); });
          if (customCtl) customCtl.hidden = false;
        }
        /* 自定义行列步进后实时重算取景状态并重绘网格预览（resetCrop 仅在网格态隐藏取景窗） */
        resetCrop();
        if (currentMethod() === 'grid') renderPreview();
      });
    });
    syncTplHighlight();
  }

  /* 旋转/翻转 segment 高亮：对齐 tool.js L476-484（点击 toggle .on）；transform.js rotateFlip 在 F-06/F-10 导出应用 */
  function syncSegOn() {
    document.querySelectorAll('input[type="radio"]').forEach(function (r) {
      var seg = r.closest('.seg');
      if (seg) seg.classList.toggle('on', r.checked);
    });
    document.querySelectorAll('input[type="checkbox"]').forEach(function (c) {
      var seg = c.closest('.seg');
      if (seg) seg.classList.toggle('on', c.checked);
    });
  }
  document.querySelectorAll('.seg input').forEach(function (inp) {
    inp.addEventListener('change', syncSegOn);
  });
  syncSegOn();

  /* 旋转 / 翻转：切换即实时重绘预览（导出仍走 transform.js rotateFlip） */
  document.querySelectorAll('[name="cropRot"]').forEach(function (r) {
    r.addEventListener('change', function () {
      VIEW = { scale: 1, panX: 0, panY: 0 };
      renderPreview();
    });
  });
  ['cropFlipH', 'cropFlipV'].forEach(function (id) {
    var box = $(id), inp = box && box.querySelector('input');
    if (inp) inp.addEventListener('change', function () { renderPreview(); });
  });

  /* 质量滑杆数值联动（F-10：cropQualityVal 与滑杆同步；--p 归一化填充对齐 moteful.js sliderPct 契约，R11b） */
  var qualitySlider = $('cropQuality');
  if (qualitySlider) {
    var qualityVal = $('cropQualityVal');
    if (qualityVal) {
      qualitySlider.addEventListener('input', function () {
        qualityVal.textContent = qualitySlider.value;
        var mn = parseFloat(qualitySlider.min), mx = parseFloat(qualitySlider.max);
        if (isFinite(mn) && isFinite(mx) && mx !== mn) {
          qualitySlider.style.setProperty('--p', ((qualitySlider.value - mn) / (mx - mn) * 100) + '%');
        }
      });
    }
  }

  /* 锁比例图标按钮（link 链环，PS 风格）：点击切换锁定/解锁（aria-pressed + 图标 + .on 高亮）；
     F-07 宽高互算联动：锁定开启时，以当前图片原始宽高比为基准 */
  var lockBtn = $('cropLock');
  var widthInput = $('cropWidth'), heightInput = $('cropHeight');
  function lockOn() { return lockBtn && lockBtn.getAttribute('aria-pressed') === 'true'; }
  function lockBase() {
    var item = currentItem();
    return (item && item.width && item.height) ? item.width / item.height : 1;
  }
  if (lockBtn) {
    lockBtn.addEventListener('click', function () {
      var on = lockBtn.getAttribute('aria-pressed') === 'true';
      lockBtn.setAttribute('aria-pressed', String(!on));
      lockBtn.classList.toggle('on', !on);
      lockBtn.querySelectorAll('svg[data-link]').forEach(function (s) {
        s.hidden = (s.getAttribute('data-link') === 'on') === !on;
      });
    });
    if (lockBtn.getAttribute('aria-pressed') === 'true') lockBtn.classList.add('on');
  }
  /* 自由+指定尺寸：手动输入宽/高实时改取景框（钳制到图内，位置不越界）；锁开启时再按比例互算另一维 */
  function applyFreeSizeToCrop() {
    if (currentMethod() !== 'free' || canvasMode() !== 'custom') return;
    if (!S.crop.visible) return;
    var nw = parseInt(widthInput.value, 10), nh = parseInt(heightInput.value, 10);
    if (isNaN(nw) || isNaN(nh) || nw < 1 || nh < 1) return;
    nw = Math.max(1, Math.min(S.curW, nw));
    nh = Math.max(1, Math.min(S.curH, nh));
    S.crop.w = nw; S.crop.h = nh;
    S.crop.x = Math.max(0, Math.min(S.curW - nw, S.crop.x));
    S.crop.y = Math.max(0, Math.min(S.curH - nh, S.crop.y));
    S.ov = overlayRectFromCrop(S.crop);
    updateCropOverlay();
  }
  if (widthInput && heightInput && lockBtn) {
    widthInput.addEventListener('input', function () {
      applyFreeSizeToCrop();
      if (!lockOn()) return;
      var w = parseInt(widthInput.value, 10);
      if (!isNaN(w) && w > 0) {
        var h = Math.max(1, Math.round(w / lockBase()));
        heightInput.value = String(h);
        heightInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    heightInput.addEventListener('input', function () {
      applyFreeSizeToCrop();
      if (!lockOn()) return;
      var h = parseInt(heightInput.value, 10);
      if (!isNaN(h) && h > 0) {
        var w = Math.max(1, Math.round(h * lockBase()));
        widthInput.value = String(w);
        widthInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  /* 画布模式联动：输出尺寸（宽高 + 锁比例）仅「指定尺寸」模式显示；F-09 模式提示行随切换 */
  var sizeGroup = $('cropSizeGroup');
  var modeHint = $('cropModeHint');
  function hintKey(m) {
    return m === 'custom' ? 'crop_hint_custom' : m === 'original' ? 'crop_hint_original' : 'crop_hint_trim';
  }
  function syncSizeGroup() {
    var v = document.querySelector('[name="cropCanvas"]:checked');
    var m = v ? v.value : 'custom';
    if (sizeGroup) sizeGroup.hidden = m !== 'custom';
    if (modeHint) modeHint.textContent = tr(hintKey(m));
  }
  if (sizeGroup || modeHint) {
    document.querySelectorAll('[name="cropCanvas"]').forEach(function (r) {
      r.addEventListener('change', syncSizeGroup);
    });
    syncSizeGroup();
  }

  /* =====================================================================
     F-04 网格切图 / F-05 去透明 / F-06 旋转翻转 / F-10~F-13 处理、导出、ZIP、分享、记忆
     复用：transform.js rotateFlip / zip.js MotefulZip.build / share.js register /
           recommend.js rec_download + rec_export / 下载即清除单条（V0.3 模式）
     ===================================================================== */
  function cropRowsVal() { return parseInt(($('cropRowsVal') || {}).textContent, 10) || 3; }
  function cropColsVal() { return parseInt(($('cropColsVal') || {}).textContent, 10) || 3; }
  function currentFmt() {
    var v = document.querySelector('[name="cropFmt"]:checked');
    return v ? v.value : 'png';
  }
  function exportQualityVal() {
    var s = $('cropQuality');
    return s ? parseInt(s.value, 10) : 90;
  }
  function canvasMode() {
    var v = document.querySelector('[name="cropCanvas"]:checked');
    return v ? v.value : 'custom';
  }
  function rotateDeg() {
    var v = document.querySelector('[name="cropRot"]:checked');
    var seg = v && v.closest('.seg');
    return seg ? parseInt(seg.getAttribute('data-rot'), 10) || 0 : 0;
  }
  function flipState() {
    var h = $('cropFlipH'), v = $('cropFlipV');
    return {
      flipH: !!(h && h.querySelector('input') && h.querySelector('input').checked),
      flipV: !!(v && v.querySelector('input') && v.querySelector('input').checked)
    };
  }
  function ratioStr() {
    var v = document.querySelector('[name="cropRatio"]:checked');
    return v ? v.value : '1:1';
  }

  /* 网格信息行：裁剪为 N 张、每张宽x高；仅网格模式且有图时显示，90/270° 输出宽高互换 */
  function updateGridInfo() {
    var el = $('cropGridInfo');
    if (!el) return;
    if (currentMethod() !== 'grid') { el.hidden = true; el.innerHTML = ''; return; }
    var item = currentItem();
    if (!item || !item.width || !item.height) { el.hidden = true; el.innerHTML = ''; return; }
    var rows = cropRowsVal(), cols = cropColsVal();
    var cw = Math.round(item.width / cols), ch = Math.round(item.height / rows);
    var rot = rotateDeg();
    if (rot === 90 || rot === 270) { var t = cw; cw = ch; ch = t; }
    el.innerHTML = tr('crop_grid_info')
      .replace('{n}', '<span class="crop-grid-num">' + (rows * cols) + '</span>')
      .replace('{w}', '<span class="crop-grid-num">' + cw + '</span>')
      .replace('{h}', '<span class="crop-grid-num">' + ch + '</span>')
      .replace(' x ', ' <span class="crop-grid-num">x</span> ')
      .replace(' × ', ' <span class="crop-grid-num">×</span> ');
    el.hidden = false;
  }

  /* ---- F-04 网格单元格：按整图精确浮点均分，末行/列不吸收余数；每格独立导出 ---- */
  function gridCells(item) {
    var rows = Math.max(1, Math.min(6, cropRowsVal()));
    var cols = Math.max(1, Math.min(6, cropColsVal()));
    var sw = item.width, sh = item.height, sx = 0, sy = 0;
    /* 精确浮点均分（去 floor 取整与末格吸收余数，保证列/行严格等宽等高；导出 buildOutput 内 Math.round 兼容） */
    var cw = sw / cols, ch = sh / rows;
    var cells = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        cells.push({
          rect: {
            x: sx + c * cw, y: sy + r * ch,
            w: cw, h: ch
          },
          suffix: '_' + (r + 1) + '-' + (c + 1)
        });
      }
    }
    return cells;
  }

  /* ---- F-05 去透明扫描：cap 1500 降采样、容差 2px、按图缓存、全透明回退 ---- */
  function getTrimBounds(item) {
    if (item.bounds !== undefined) return item.bounds;
    var w = item.width, h = item.height;
    if (!w || !h) { item.bounds = null; return null; }
    var scale = 1, CAP = 1500;
    if (Math.max(w, h) > CAP) scale = CAP / Math.max(w, h);
    var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
    var cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(item.img, 0, 0, tw, th);
    var d = ctx.getImageData(0, 0, tw, th).data;
    var minX = tw, minY = th, maxX = -1, maxY = -1;
    for (var y = 0; y < th; y++) {
      for (var x = 0; x < tw; x++) {
        if (d[(y * tw + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { item.bounds = null; return null; }
    var pad = parseInt(($('cropPadVal') || {}).textContent, 10) || 0;
    var TOL = 2;
    var x0 = Math.max(0, Math.round(minX / scale) - TOL - pad);
    var y0 = Math.max(0, Math.round(minY / scale) - TOL - pad);
    var bw = Math.min(w - x0, Math.round((maxX - minX + 1) / scale) + TOL * 2 + pad * 2);
    var bh = Math.min(h - y0, Math.round((maxY - minY + 1) / scale) + TOL * 2 + pad * 2);
    item.bounds = { x: x0, y: y0, w: bw, h: bh };
    return item.bounds;
  }

  /* ---- 取景矩形：active 图用实时取景窗；其余图按模式居中默认（批量套用） ---- */
  function defaultRectFor(item) {
    if (currentMethod() === 'ratio') {
      var r = currentRatio();
      var sw, sh;
      if (item.width / item.height > r) { sh = item.height; sw = Math.round(item.height * r); }
      else { sw = item.width; sh = Math.round(item.width / r); }
      return { x: Math.round((item.width - sw) / 2), y: Math.round((item.height - sh) / 2), w: sw, h: sh };
    }
    return {
      x: Math.round(item.width * 0.1), y: Math.round(item.height * 0.1),
      w: Math.round(item.width * 0.8), h: Math.round(item.height * 0.8)
    };
  }
  function rectsForItem(item) {
    /* 去透明画布模式：忽略取景窗，自动扫描非透明边界 + 内距（各图独立输出尺寸，全透明回退整体）——优先于 single/grid，单张与批量都裁 */
    if (canvasMode() === 'trim') {
      var tb = getTrimBounds(item) || { x: 0, y: 0, w: item.width, h: item.height };
      return [{ rect: tb, suffix: '' }];
    }
    /* 单个模式：不做比例/自由/网格裁剪，整图按画布模式（原尺寸/指定尺寸）输出 */
    if (currentMethod() === 'single') {
      return [{ rect: { x: 0, y: 0, w: item.width, h: item.height }, suffix: '' }];
    }
    if (currentMethod() === 'grid') return gridCells(item);
    var isActive = item.id === S.activeId && S.crop && S.crop.visible;
    var r = isActive ? S.crop : defaultRectFor(item);
    return [{ rect: r, suffix: '' }];
  }

  /* ---- 单输出构建：裁剪区 → rotateFlip（F-06）→ 画布模式尺寸 → toBlob ---- */
  function buildOutput(item, rect, suffix) {
    var fmt = currentFmt();
    var mode = canvasMode();
    var q = exportQualityVal();
    var fl = flipState();
    /* 内距：输出四周留白（trim 模式 rect 已含内距，避免重复叠加） */
    var pad = mode === 'trim' ? 0 : (parseInt(($('cropPadVal') || {}).textContent, 10) || 0);
    var rotated = window.MotefulTransform ? window.MotefulTransform.rotateFlip(item.img, {
      sx: Math.max(0, Math.round(rect.x)), sy: Math.max(0, Math.round(rect.y)),
      sw: Math.max(1, Math.round(rect.w)), sh: Math.max(1, Math.round(rect.h))
    }, { rotate: rotateDeg(), flipH: fl.flipH, flipV: fl.flipV }) : null;
    if (!rotated) return Promise.resolve(null);
    var outW = rotated.width, outH = rotated.height;
    var targetW = outW, targetH = outH;
    if (mode === 'custom') {
      targetW = parseInt(($('cropWidth') || {}).value, 10) || outW;
      targetH = parseInt(($('cropHeight') || {}).value, 10) || outH;
      /* 内距 = 画布内四周留白：内容可占区域 = 设定 - 2×内距，内容缩放后居中于画布；输出尺寸 = 设定值 */
      var innerW = Math.max(1, targetW - 2 * pad), innerH = Math.max(1, targetH - 2 * pad);
      var sc = Math.min(innerW / outW, innerH / outH);
      var up = $('cropUpscale');
      if (!(up && up.checked)) sc = Math.min(sc, 1);
      var dw = Math.max(1, Math.round(outW * sc)), dh = Math.max(1, Math.round(outH * sc));
      var ox = Math.round((targetW - dw) / 2), oy = Math.round((targetH - dh) / 2);
      var c = document.createElement('canvas');
      c.width = targetW; c.height = targetH;
      var ctx = c.getContext('2d');
      if (fmt === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, targetW, targetH); }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (dw < outW || dh < outH) {
        /* 缩小：PS「两次立方（较锐利）缩减」——级联 2× 面积平均 + 锐利 bicubic 核（transform.js downscale） */
        var ds = window.MotefulTransform && window.MotefulTransform.downscale
          ? window.MotefulTransform.downscale(rotated, dw, dh) : null;
        if (ds) ctx.drawImage(ds, ox, oy);
        else ctx.drawImage(rotated, ox, oy, dw, dh);
      } else {
        ctx.drawImage(rotated, ox, oy, dw, dh);
      }
      targetW = c.width; targetH = c.height;
    } else {
      /* 原尺寸模式：内距 = 四周加白边（画布 = 原图 + 2×内距，内容原尺寸居中） */
      var c2 = document.createElement('canvas');
      c2.width = targetW + 2 * pad; c2.height = targetH + 2 * pad;
      var ctx2 = c2.getContext('2d');
      if (fmt === 'jpg') { ctx2.fillStyle = '#ffffff'; ctx2.fillRect(0, 0, c2.width, c2.height); }
      ctx2.drawImage(rotated, pad, pad);
      var c = c2;
      targetW = c.width; targetH = c.height;
    }
    return new Promise(function (resolve) {
      c.toBlob(function (blob) {
        resolve(blob ? { blob: blob, w: targetW, h: targetH } : null);
      }, fmt === 'png' ? 'image/png' : fmt === 'jpg' ? 'image/jpeg' : 'image/webp',
         fmt === 'png' ? undefined : q / 100);
    });
  }

  /* ---- 输出命名：网格「原名_行-列」；单输出沿用原名 ---- */
  function outName(it, suffix) {
    var base = String(it.name || 'image').replace(/\.(png|jpe?g|webp)$/i, '');
    var ext = currentFmt() === 'jpg' ? 'jpg' : currentFmt() === 'webp' ? 'webp' : 'png';
    return base + (suffix || '') + '.' + ext;
  }

  /* ---- 进度条（对齐 png-compressor showBusy：参数区 .progress + 导出区 busy 行；doneText 传参时为完成态文字） ---- */
  function showBusy(on_, total, done, doneText) {
    var b = $('cropBusy');
    if (b) {
      b.hidden = !on_;
      if (on_) { var p = $('cropBusyProg'); if (p) p.textContent = done + '/' + total; }
    }
    var pw = $('cropProgress'), fill = $('cropProgressFill'), pt = $('cropProgressTxt'), dt = $('cropDoneTxt');
    if (pw) pw.hidden = !on_;
    if (pt) { pt.hidden = !on_; if (on_) pt.textContent = done + '/' + total; }
    if (dt) dt.hidden = !doneText;
    if (on_ && pw && fill) {
      var pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
      fill.style.width = pct + '%';
      pw.setAttribute('aria-valuenow', String(pct));
    }
  }

  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /* ---- 单个模式实时网格预览（参考实验网页：每张处理效果 + 名称 + 尺寸转换 + 下载） ---- */
  var singleRenderTimer = null;
  function scheduleSingleRender() {
    clearTimeout(singleRenderTimer);
    singleRenderTimer = setTimeout(function () {
      if (currentMethod() === 'single') renderSingleGrid();
    }, 250);
  }
  function renderSingleGrid() {
    var sg = $('cropSingleGrid');
    if (!sg) return;
    var items = S.items.slice();
    sg.innerHTML = '';
    if (!items.length) {
      sg.innerHTML = '<p class="muted">' + tr('crop_preview_placeholder') + '</p>';
      return;
    }
    var hint = document.createElement('p');
    hint.className = 'muted crop-single-hint';
    hint.textContent = tr('crop_single_hint');
    sg.appendChild(hint);
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        if (!it.img || !it.width || !it.height) return;
        var r0 = rectsForItem(it)[0];
        if (!r0) return;
        return buildOutput(it, r0.rect, r0.suffix).then(function (res) {
          if (!res) return;
          var url = URL.createObjectURL(res.blob);
          var card = document.createElement('div');
          card.className = 'crop-single-card';
          card.setAttribute('data-id', it.id);
          card.innerHTML = '<img class="crop-single-thumb" alt="" draggable="false" src="' + esc(url) + '">' +
            '<a class="btn btn-secondary btn-sm" href="' + esc(url) + '" download="' + esc(outName(it, '')) + '" data-i18n-aria="crop_res_download" aria-label="' + tr('crop_res_download') + '"><i data-lucide="download"></i></a>' +
            '<div class="crop-single-meta"><div class="crop-single-name">' + esc(it.name) + '</div>' +
            '<div class="crop-single-size">' + it.width + '×' + it.height + '→' + res.w + '×' + res.h + '</div></div>';
          sg.appendChild(card);
          if (window.MF && MF.refreshIcons) MF.refreshIcons();
        });
      });
    });
  }

  /* ---- 单个模式网格下载：仅下载 + 内联推荐 rec_download；预览区是批处理效果展示，下载不删除预览卡片 ---- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.crop-single-card a[download]') : null;
    if (!a) return;
    setTimeout(function () {
      if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_download' });
    }, 400);
  });

  /* ---- 结果列表 + 汇总 ---- */
  function renderResults() {
    var list = $('cropResList');
    if (!list) return;
    var html = '';
    S.items.forEach(function (it) {
      (it.outputs || []).forEach(function (o) {
        html += '<div class="crop-res-row" data-id="' + it.id + '">' +
          '<img class="thumb" alt="" draggable="false" src="' + esc(o.url) + '">' +
          '<div class="crop-res-main"><div class="crop-res-name">' + esc(o.name) + '</div>' +
          '<div class="crop-res-size">' + fmtSize(o.blob.size) + ' · ' + o.w + '×' + o.h + '</div></div>' +
          '<a class="btn btn-secondary btn-sm" href="' + esc(o.url) + '" download="' + esc(o.name) + '" data-i18n-aria="crop_res_download" aria-label="' + tr('crop_res_download') + '"><i data-lucide="download"></i></a>' +
          '</div>';
      });
    });
    list.innerHTML = html;
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
  }

  function updateSummary() {
    var el = $('cropSummary');
    if (!el) return;
    var count = 0, total = 0, transparent = 0;
    S.items.forEach(function (it) {
      (it.outputs || []).forEach(function (o) { count++; total += o.blob.size; });
      if (it.outputs && it.outputs.length && it.bounds === null) transparent++;
    });
    var parts = [];
    if (count) parts.push(tr('crop_sum_count') + ' ' + count);
    if (total) parts.push(tr('crop_sum_size') + ' ' + fmtSize(total));
    if (transparent) parts.push(tr('crop_sum_transparent'));
    el.textContent = parts.join(' · ');
  }

  /* ---- F-10 批量处理（串行按图，网格多输出计入进度） ---- */
  function processAll() {
    var items = S.items.slice();
    if (!items.length) return;
    var btn = $('cropProcessBtn');
    if (btn) btn.disabled = true;
    var zipBtn = $('cropExportZip');
    if (zipBtn) zipBtn.disabled = true;
    items.forEach(function (it) { it.outputs = []; it.outBlob = null; });
    var total = 0;
    items.forEach(function (it) { total += rectsForItem(it).length; });
    var done = 0;
    showBusy(true, total, 0);
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        var outs = rectsForItem(it);
        var seq = Promise.resolve();
        outs.forEach(function (o) {
          seq = seq.then(function () {
            return buildOutput(it, o.rect, o.suffix).then(function (res) {
              if (res) {
                res.name = outName(it, o.suffix);
                res.url = URL.createObjectURL(res.blob);
                it.outputs = it.outputs || [];
                it.outputs.push(res);
                it.outBlob = res.blob;
              }
              done++;
              showBusy(true, total, done);
            });
          });
        });
        return seq;
      });
    });
    chain.then(function () {
      showBusy(false, total, done, tr('crop_done_txt'));
      if (btn) btn.disabled = false;
      renderResults();
      updateSummary();
      var any = S.items.some(function (it) { return it.outputs && it.outputs.length; });
      if (zipBtn) zipBtn.disabled = !any;
    }).catch(function () {
      showBusy(false, total, done);
      if (btn) btn.disabled = false;
    });
  }

  /* ---- F-10 下载即清除单条记录（V0.3 模式）+ 下载后内联推荐 rec_download ---- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.crop-res-row a[download]') : null;
    if (!a) return;
    var row = a.closest('.crop-res-row');
    var id = row && row.getAttribute('data-id');
    var url = a.getAttribute('href');
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (err) {}
      if (id) {
        var it = null;
        S.items.forEach(function (x) { if (x.id === id) it = x; });
        if (it) {
          it.outputs = (it.outputs || []).filter(function (o) { return o.url !== url; });
          it.outBlob = it.outputs.length ? it.outputs[0].blob : null;
        }
      }
      renderResults();
      updateSummary();
      var any = S.items.some(function (x) { return x.outputs && x.outputs.length; });
      var zipBtn = $('cropExportZip');
      if (zipBtn) zipBtn.disabled = !any;
      if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_download' });
    }, 400);
  });

  /* ---- F-11 一键 ZIP 打包（行优先归档）→ rec_export + 全量清记录 ---- */
  function exportZip() {
    var files = [];
    S.items.forEach(function (it) { (it.outputs || []).forEach(function (o) { files.push(o); }); });
    if (!files.length) return;
    var btn = $('cropExportZip');
    var old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>' + tr('crop_zip_busy') + '</span>'; }
    Promise.all(files.map(function (o) {
      return o.blob.arrayBuffer().then(function (buf) { return { name: o.name, data: new Uint8Array(buf) }; });
    })).then(function (arr) {
      var blob = window.MotefulZip ? window.MotefulZip.build(arr) : null;
      if (!blob) throw new Error('zip missing');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'moteful-crop.zip';
      a.click();
      if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
      S.items.forEach(function (it) {
        (it.outputs || []).forEach(function (o) { try { URL.revokeObjectURL(o.url); } catch (e) {} });
        it.outputs = []; it.outBlob = null;
      });
      renderResults();
      updateSummary();
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    });
  }

  /* ---- F-12 配置记忆 + 分享参数（share.js register 'crop-tool'） ---- */
  var MEM_KEY = 'moteful:crop-tool';
  function collectParams() {
    return {
      m: currentMethod(),
      cm: canvasMode(),
      cr: ratioStr(),
      rows: cropRowsVal(), cols: cropColsVal(),
      rt: rotateDeg(),
      fh: flipState().flipH ? 1 : 0,
      fv: flipState().flipV ? 1 : 0,
      w: parseInt(($('cropWidth') || {}).value, 10) || 0,
      h: parseInt(($('cropHeight') || {}).value, 10) || 0,
      up: ($('cropUpscale') || {}).checked ? 1 : 0,
      pd: parseInt(($('cropPadVal') || {}).textContent, 10) || 0,
      f: currentFmt(), q: exportQualityVal()
    };
  }
  function saveConfig() {
    try { localStorage.setItem(MEM_KEY, JSON.stringify(collectParams())); } catch (e) {}
  }
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(MEM_KEY) || 'null') || null; } catch (e) { return null; }
  }
  function applyParams(p) {
    if (!p) return;
    var setRadio = function (name, val) {
      var r = document.querySelector('[name="' + name + '"][value="' + val + '"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    if (p.m) setRadio('cropMethod', p.m);
    if (p.cm) setRadio('cropCanvas', p.cm);
    if (p.cr) setRadio('cropRatio', p.cr);
    if (p.f) setRadio('cropFmt', p.f);
    if (p.rt !== undefined) {
      var seg = document.querySelector('.seg[data-rot="' + p.rt + '"]');
      if (seg) { var ri = seg.querySelector('input'); if (ri) { ri.checked = true; ri.dispatchEvent(new Event('change', { bubbles: true })); } }
    }
    if (p.fh !== undefined) { var h = $('cropFlipH'); if (h) { var hi = h.querySelector('input'); if (hi) { hi.checked = !!p.fh; hi.dispatchEvent(new Event('change', { bubbles: true })); } } }
    if (p.fv !== undefined) { var v = $('cropFlipV'); if (v) { var vi = v.querySelector('input'); if (vi) { vi.checked = !!p.fv; vi.dispatchEvent(new Event('change', { bubbles: true })); } } }
    if (p.up !== undefined) { var up = $('cropUpscale'); if (up) { up.checked = !!p.up; up.dispatchEvent(new Event('change', { bubbles: true })); } }
    if (p.rows) setGridStepValue(document.querySelector('.step[data-for="cropRowsVal"]'), p.rows);
    if (p.cols) setGridStepValue(document.querySelector('.step[data-for="cropColsVal"]'), p.cols);
    syncTplHighlight();
    if (p.pd !== undefined) { var pv = $('cropPadVal'); if (pv) pv.textContent = Math.max(0, Math.min(100, parseInt(p.pd, 10) || 0)); }
    if (p.w) { var wi = $('cropWidth'); if (wi) wi.value = parseInt(p.w, 10) || wi.value; }
    if (p.h) { var hi2 = $('cropHeight'); if (hi2) hi2.value = parseInt(p.h, 10) || hi2.value; }
    if (p.q !== undefined) { var qs = $('cropQuality'); if (qs) { qs.value = Math.max(1, Math.min(100, parseInt(p.q, 10) || 90)); qs.dispatchEvent(new Event('input', { bubbles: true })); } }
    syncSegOn();
    syncPreset();
    syncSizeGroup();
    /* 刷新恢复为网格时强制原尺寸画布 + 内距0，不沿用上次 cm/pd */
    if (p.m === 'grid') gridNormalize();
    if (typeof resetCrop === 'function') resetCrop();
    if (typeof renderPreview === 'function') renderPreview();
  }
  function parseQs() {
    var qs = {};
    try {
      (location.search || '').replace(/[?&]([^=&#]+)=([^&#]*)/g, function (m, k, v) { qs[k] = decodeURIComponent(v); });
    } catch (e) {}
    return qs;
  }
  function applyUrlParams() {
    var qs = parseQs();
    if (qs && Object.keys(qs).length) applyParams(qs);
  }

  /* ---- 启动（F-10~F-13 绑定） ---- */
  var processBtn = $('cropProcessBtn');
  if (processBtn) processBtn.addEventListener('click', processAll);
  var zipBtn = $('cropExportZip');
  if (zipBtn) zipBtn.addEventListener('click', exportZip);
  if (window.MotefulShare) {
    window.MotefulShare.setShareable(true);
    window.MotefulShare.register('crop-tool', { getParams: collectParams });
  }
  /* 参数变更即记忆（F-12：配置记忆，下次进入恢复；页面仅工具参数与画廊，无无关 input）；
     单个模式下参数变更实时刷新预览网格 */
  ['change', 'input'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('input, select, .step, .seg, .switch')) {
        if (typeof saveConfig === 'function') saveConfig();
        if (typeof scheduleSingleRender === 'function') scheduleSingleRender();
      }
    });
  });

  /* =====================================================================
     init
     ===================================================================== */
  initImport();
  initPreviewEvents();
  var memCfg = loadConfig();
  if (memCfg) applyParams(memCfg);
  applyUrlParams();
  /* 语言切换：结果列表 / 汇总 / 模式提示行 / 分段高亮重绘 */
  document.addEventListener('moteful:langchange', function () {
    renderResults();
    updateSummary();
    syncSegOn();
    var mh = $('cropModeHint');
    if (mh) mh.textContent = tr(hintKey(canvasMode()));
  });
  window.CropTool.ready = true;
  document.documentElement.setAttribute('data-crop-ready', '1');
})();
