/* =====================================================================
   Moteful 证件照工具 · 功能引擎（id-photo-tool.js）
   F-01 导入（复用 image-import.js）｜F-02 规格库换算｜F-04/05 裁剪+参考线
   F-06 换底色（魔棒/画笔/橡皮 + 色板）｜F-07 画布/撤销重做还原
   F-03 排版｜F-08~11 导出（格式/质量/目标大小/命名+ZIP）｜F-12 记忆分享
   ===================================================================== */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function tr(k) { return (window.DICT && window.DICT[window.currentLang] && window.DICT[window.currentLang][k]) || k; }
  function pxOf(mm, dpi) { return Math.round(mm / 25.4 * dpi); }

  /* ===== 规格库（F-02：数据独立于 assets/js/id-photo-specs.js，mm 结构供 pxOf 换算） ===== */
  var SPECS = {};
  (function (raw) {
    if (!raw) return;
    Object.keys(raw).forEach(function (k) {
      var it = raw[k];
      SPECS[k] = { mm: [it.mmW, it.mmH] };
    });
  })(window.ID_PHOTO_SPECS && window.ID_PHOTO_SPECS.items);

  /* ===== 状态 ===== */
  var S = {
    imp: null,
    items: [],
    activeId: null,
    work: null, workCtx: null,
    fit: 1,
    view: { scale: 1, panX: 0, panY: 0 },
    lv: { scale: 1, panX: 0, panY: 0 }, // 排版预览视图（独立变换：排版态拖/缩只动它，不碰 view/crop）
    dragState: null,
    cropDrag: false,
    crop: { x: 0, y: 0, w: 0, h: 0, visible: false },
    ov: null, // 取景窗锚点（预览盒坐标，固定大小/位置；图片平移缩放时不动，crop 由它+视图反算）
    guides: { head: true, eye: true, third: true },
    bg: { enabled: false, toolEnabled: false, color: 'red', custom: '#FF6B6B', tool: 'wand', size: 40, threshold: 32 },
    layout: { enabled: false, rows: 2, cols: 2, gap: 3, cut: true },
    undo: [], redo: [], baseline: null,
    fmt: 'jpg', quality: 92, target: 0,
    spec: 'cun1', dpi: 300,
    prevW: 0, prevH: 0
  };

  /* =====================================================================
     ① 导入（F-01：复用 MFImageImport 队列 + 双态画廊渲染）
     ===================================================================== */
  function initImport() {
    if (!window.MFImageImport) return;
    S.imp = new window.MFImageImport({
      onChange: renderGallery,
      onImport: function () {}
    });
    var dz = $('idDropzone');
    if (dz) {
      dz.addEventListener('click', function () { if (!S.imp.queue.length) $('idFile').click(); });
      dz.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !S.imp.queue.length) { e.preventDefault(); $('idFile').click(); } });
    }
    var file = $('idFile');
    if (file) file.addEventListener('change', function () { S.imp.addFiles(file.files); file.value = ''; });
    // 全页拖放
    ['dragover', 'drop'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files) S.imp.addFiles(e.dataTransfer.files);
      });
    });
    var reset = $('idDzReset');
    if (reset) reset.addEventListener('click', function () {
      S.imp.queue.slice().forEach(function (it) { S.imp.remove(it.id); });
      renderGallery();
    });
    if (window.MFImageImport.enablePaste) {
      window.MFImageImport.enablePaste(function (files) { S.imp.addFiles(files); });
    }
  }

  function renderGallery() {
    var q = S.imp ? S.imp.queue : [];
    S.items = q;
    var empty = $('idDzEmpty'), gal = $('idDzGallery'), list = $('idDzList'), cnt = $('idDzCount');
    if (!q.length) {
      empty.hidden = false; gal.hidden = true;
      if (S.activeId) { S.activeId = null; resetEditor(); }
      return;
    }
    empty.hidden = true; gal.hidden = false;
    cnt.textContent = q.length + ' 张';
    list.innerHTML = '';
    q.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'dz-thumb' + (it.id === S.activeId ? ' id-active' : '');
      el.setAttribute('data-id', it.id);
      el.setAttribute('title', it.name);
      el.innerHTML = '<img alt="">' +
        '<button type="button" class="dz-rm" aria-label="移除"><i data-lucide="x"></i></button>';
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

  /* =====================================================================
     ② 选中图 → 工作画布（F-15：>4096 降采样；基线=出厂）
     ===================================================================== */
  function selectItem(id) {
    var it = null;
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) { it = S.items[i]; break; }
    if (!it || !it.img) return;
    S.activeId = id;
    buildWorkCanvas(it.img, it.width || it.img.width || it.img.naturalWidth, it.height || it.img.height || it.img.naturalHeight);
    resetView();
    resetCrop();
    syncOps();
    renderPreview();
    renderGallery();
  }

  function buildWorkCanvas(img, w, h) {
    var MAX = 4096, s = 1;
    if (w > MAX || h > MAX) s = MAX / Math.max(w, h);
    var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    S.work = c; S.workCtx = ctx;
    S.baseline = ctx.getImageData(0, 0, cw, ch);
    S.undo = []; S.redo = [];
    // 若裁剪已开启，重置裁剪框
    S.crop.visible = !!$('idCropSw') && $('idCropSw').checked;
  }

  function resetEditor() {
    S.work = null; S.workCtx = null; S.baseline = null; S.undo = []; S.redo = [];
    S.view = { scale: 1, panX: 0, panY: 0 };
    S.lv = { scale: 1, panX: 0, panY: 0 };
    var cv = $('idPreview'), empty = $('idEmpty');
    if (cv) { cv.hidden = true; }
    if (empty) empty.hidden = false;
    if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    syncOps();
  }

  /* =====================================================================
     ③ 预览渲染（画布固定尺寸；内容层 scale/pan；双击复位）
     ===================================================================== */
  function setupPreview() {
    var box = $('idPreviewBox'), cv = $('idPreview');
    if (!box || !cv) return;
    var r = box.getBoundingClientRect();
    S.prevW = Math.max(200, Math.floor(r.width - 32));
    S.prevH = 440;
    cv.width = S.prevW; cv.height = S.prevH;
    cv.hidden = !S.work;

    // 缩放滑杆（统一设值入口：value + --p 填充同步，禁止绕过；实现见顶层 setZoomVal）
    var zoom = $('idZoomRange'), zoomOut = $('idZoomOut');
    if (zoom && zoomOut) {
      zoom.addEventListener('input', function () {
        var v = parseInt(zoom.value, 10);
        if (S.layout.enabled && S.crop.visible) { setZoomVal(v); return; }  // 排版态：滑杆只缩放相纸视图
        S.view.scale = v / 100;
        setZoomVal(v);
      });
    }
    // 滚轮缩放（在预览盒上，防页面滚动冲突：仅当指针在盒内）
    box.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (S.layout.enabled && S.crop.visible) {
        // 排版态：滚轮只缩放相纸视图（S.lv），图片/裁剪不受影响
        S.lv.scale = Math.max(0.5, Math.min(8, S.lv.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
        sliderFill(Math.round(S.lv.scale * 100));
        renderPreview();
        return;
      }
      var z = S.view.scale * (e.deltaY < 0 ? 1.1 : 0.9);
      S.view.scale = Math.min(8, Math.max(0.5, z));
      setZoomVal(Math.round(S.view.scale * 100));
    }, { passive: false });
    // 拖拽平移（纯鼠标，不依赖空格）；工具组激活时不启动平移（交给魔棒/画笔监听器，避免冲突）
    // 阻止原生 dragstart 导致浏览器导航/页面刷新
    box.addEventListener('dragstart', function (e) { e.preventDefault(); });
    box.addEventListener('pointerdown', function (e) {
      if (S.cropDrag) return;  // 取景窗拖动占用中：平移不得抢
      if (e.target && (e.target.closest('.id-crop-overlay') || e.target.closest('.dz-rm'))) return;
      if (S.bg.toolEnabled) return;
      var base = (S.layout.enabled && S.crop.visible) ? S.lv : S.view;  // 排版态平移作用于相纸视图
      S.dragState = { x: e.clientX, y: e.clientY, px: base.panX, py: base.panY };
      box.classList.add('drag-active');
      box.setPointerCapture && box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove', function (e) {
      if (!S.dragState || S.cropDrag) return;  // 拖取景窗期间绝不平移图片
      var lv = S.layout.enabled && S.crop.visible;
      var base = lv ? S.lv : S.view;
      base.panX = S.dragState.px + (e.clientX - S.dragState.x);
      base.panY = S.dragState.py + (e.clientY - S.dragState.y);
      if (!lv) syncCropFromView(false);  // 编辑态：图片平移 → crop 反算；排版态：仅相纸视图平移，crop 不动
      renderPreview();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      box.addEventListener(ev, function () {
        if (!S.dragState) return;
        S.dragState = null;
        box.classList.remove('drag-active');
      });
    });
    // 双击复位：编辑态复位图片视图+取景窗；排版态只复位相纸视图
    box.addEventListener('dblclick', function () {
      if (S.layout.enabled && S.crop.visible) {
        // 排版态双击：仅复位相纸视图（缩放/位置），不触碰图片/裁剪
        S.lv = { scale: 1, panX: 0, panY: 0 };
        sliderFill(100);
        renderPreview();
        return;
      }
      S.view = { scale: 1, panX: 0, panY: 0 };
      setZoomVal(100);
      resetCrop();
      renderPreview();
    });
    // 魔棒/画笔/橡皮：点击画布操作（工作画布像素；工具组开关激活时才生效）
    box.addEventListener('pointerdown', function (e) {
      if (!S.work || !S.bg.toolEnabled || S.cropDrag) return;
      if (S.layout.enabled && S.crop.visible) return;  // 排版态画布显示相纸，不进行像素编辑
      if (e.target && (e.target.closest('.id-crop-overlay'))) return;
      var p = canvasPoint(e);
      if (!p) return;
      if (S.bg.tool === 'wand') applyWand(p.x, p.y);
      else applyBrush(p.x, p.y, S.bg.tool);
    });
    // 画笔/橡皮光标预览：虚线圆圈跟随鼠标，直径=笔刷大小×预览缩放（纯展示）
    var brushCursor = $('idBrushCursor');
    function hideBrushCursor() { if (brushCursor) brushCursor.style.display = 'none'; }
    box.addEventListener('mousemove', function (e) {
      if (!brushCursor) return;
      if (!S.bg.toolEnabled || S.bg.tool === 'wand' || !S.work || (S.layout.enabled && S.crop.visible)) { brushCursor.style.display = 'none'; return; }
      var br = box.getBoundingClientRect();
      brushCursor.style.display = 'block';
      brushCursor.style.left = (e.clientX - br.left) + 'px';
      brushCursor.style.top = (e.clientY - br.top) + 'px';
      var cv = $('idPreview');
      var cw = cv ? cv.getBoundingClientRect().width : 0;
      var d = S.bg.size * S.fit * S.view.scale * (cw / S.prevW);
      brushCursor.style.width = d + 'px';
      brushCursor.style.height = d + 'px';
    });
    box.addEventListener('mouseleave', function () {
      if (brushCursor) brushCursor.style.display = 'none';
    });
    // 拖拽连续画笔
    box.addEventListener('pointermove', function (e) {
      if (!S.work || !S.bg.enabled || S.bg.tool === 'wand') return;
      if (!dragState) return;
      var p = canvasPoint(e);
      if (p) applyBrush(p.x, p.y, S.bg.tool);
    });
  }

  /* 缩放滑杆统一设值（顶层共享：setupPreview 事件与 resetView 均可调用；
     必须走 MF.sliderSet 保证 --p 归一化填充与滑块位置同步） */
  function setZoomVal(v) {
    if (S.layout.enabled && S.crop.visible) {
      // 排版预览态：缩放只作用于相纸视图（S.lv），编辑视图/裁剪严格不动
      S.lv.scale = Math.max(0.5, Math.min(8, v / 100));
      sliderFill(Math.round(S.lv.scale * 100));
      renderPreview();
      return;
    }
    // 取景窗固定模型：缩放下限 = 取景窗覆盖区域不得超出工作画布（图片不够裁会出空白）
    if (S.work && S.crop.visible && S.ov) {
      var minSc = Math.max(S.ov.w / S.work.width, S.ov.h / S.work.height);
      if (S.fit * S.view.scale < minSc) {
        S.view.scale = minSc / S.fit;
        v = Math.round(S.view.scale * 100);
      }
      syncCropFromView(false);  // 图片缩放：取景窗固定，crop 反算并钳制
    }
    sliderFill(v);
    renderPreview();
  }

  /* 缩放滑杆/百分比文本统一填充（必须走 MF.sliderSet 保证 --p 归一化填充与滑块位置同步） */
  function sliderFill(v) {
    var zoom = $('idZoomRange'), zoomOut = $('idZoomOut');
    if (window.MF && MF.sliderSet) MF.sliderSet(zoom, v);
    else if (zoom) {
      zoom.value = v;
      var mn = parseFloat(zoom.min), mx = parseFloat(zoom.max);
      zoom.style.setProperty('--p', (isFinite(mn) && isFinite(mx) && mx !== mn ? (v - mn) / (mx - mn) * 100 : 50) + '%');
    }
    if (zoomOut) zoomOut.textContent = v + '%';
  }

  function resetView() {
    if (!S.work) return;
    var box = $('idPreviewBox'), cv = $('idPreview');
    if (!cv) return;
    var r = box.getBoundingClientRect();
    S.prevW = Math.max(200, Math.floor(r.width - 32));
    S.prevH = 440;
    cv.width = S.prevW; cv.height = S.prevH;
    cv.hidden = false;
    var empty = $('idEmpty');
    if (empty) empty.hidden = true;
    S.fit = Math.min((S.prevW - 16) / S.work.width, (S.prevH - 16) / S.work.height);
    S.view = { scale: 1, panX: 0, panY: 0 };
    S.lv = { scale: 1, panX: 0, panY: 0 };  // 排版相纸视图一并复位
    var zoom = $('idZoomRange'), zoomOut = $('idZoomOut');
    setZoomVal(100);
  }

  function renderPreview() {
    var cv = $('idPreview');
    if (!cv || !S.work) return;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, S.prevW, S.prevH);

    // 排版预览开 + 裁剪框有效 → 渲染相纸排版效果（裁剪区域缩放到规格像素尺寸后排版）
    if (S.layout.enabled && S.crop.visible && S.crop.w && S.crop.h) {
      var spec = SPECS[S.spec];
      var outW = pxOf(spec.mm[0], S.dpi);
      var outH = pxOf(spec.mm[1], S.dpi);
      var tmp = document.createElement('canvas');
      tmp.width = outW; tmp.height = outH;
      tmp.getContext('2d').drawImage(S.work, S.crop.x, S.crop.y, S.crop.w, S.crop.h, 0, 0, outW, outH);
      var layout = buildLayout(tmp);
      var sc = Math.min(S.prevW / layout.width, S.prevH / layout.height);
      var dw = layout.width * sc, dh = layout.height * sc;
      ctx.save();
      // 排版预览使用独立相纸视图 S.lv：拖拽/缩放只移动缩放相纸，编辑视图/裁剪严格不动
      ctx.translate(S.prevW / 2 + S.lv.panX, S.prevH / 2 + S.lv.panY);
      ctx.scale(S.lv.scale, S.lv.scale);
      ctx.drawImage(layout, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      // 排版预览下隐藏裁剪框 overlay（已是最终效果）
      var ov = $('idCropOverlay');
      if (ov) ov.hidden = true;
      var gov = $('idGuideOverlay');
      if (gov) gov.hidden = true;
      return;
    }

    ctx.save();
    ctx.translate(S.prevW / 2 + S.view.panX, S.prevH / 2 + S.view.panY);
    ctx.scale(S.view.scale, S.view.scale);
    ctx.drawImage(S.work, -S.work.width * S.fit / 2, -S.work.height * S.fit / 2, S.work.width * S.fit, S.work.height * S.fit);
    ctx.restore();
    updateCropOverlay();
    updateGuideOverlay();
  }

  /* 事件坐标 → 工作画布像素 */
  function canvasPoint(e) {
    var cv = $('idPreview');
    if (!cv) return null;
    var r = cv.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width * S.prevW;
    var py = (e.clientY - r.top) / r.height * S.prevH;
    var sx = (px - S.prevW / 2 - S.view.panX) / (S.view.scale * S.fit);
    var sy = (py - S.prevH / 2 - S.view.panY) / (S.view.scale * S.fit);
    return { x: Math.round(sx + S.work.width / 2), y: Math.round(sy + S.work.height / 2) };
  }

  /* =====================================================================
     ④ 裁剪框（F-04：固定规格比例，可拖动定位）+ 参考线（F-05）
     ===================================================================== */
  function resetCrop() {
    if (!S.work) return;
    var spec = SPECS[S.spec];
    var ratio = spec.mm[0] / spec.mm[1];  // 规格比例（宽/高）
    // 裁剪框按预览比例设置：高占图高 60%，宽按规格比例换算；保持规格比例
    var h = Math.round(S.work.height * 0.6);
    var w = Math.round(h * ratio);
    S.crop = {
      x: Math.max(0, Math.round((S.work.width - w) / 2)),
      y: Math.max(0, Math.round((S.work.height - h) / 2)),
      w: w, h: h,
      visible: S.crop.visible
    };
    // 取景窗锚点（固定大小/位置）：按当前视图把 crop 居中映射到预览盒坐标
    S.ov = overlayRectFromCrop(S.crop);
  }

  /* 取景窗锚点正算：由 crop + 当前视图 → 预览盒内位置/大小（含画布居中偏移补偿）。
     注意 workLeft/workTop 是画布坐标，overlay 定位参照系是预览盒（padding + 居中），
     必须补 getBoundingClientRect 差值，否则取景窗偏左上、排版/导出头顶被裁。 */
  function overlayRectFromCrop(cr) {
    var cv = $('idPreview'), box = $('idPreviewBox');
    var offX = 0, offY = 0;
    if (cv && box) {
      var cvr = cv.getBoundingClientRect(), br = box.getBoundingClientRect();
      offX = cvr.left - br.left; offY = cvr.top - br.top;
    }
    var sc = S.fit * S.view.scale;
    var workLeft = S.prevW / 2 + S.view.panX - S.work.width * sc / 2;
    var workTop = S.prevH / 2 + S.view.panY - S.work.height * sc / 2;
    return {
      x: offX + workLeft + cr.x * sc,
      y: offY + workTop + cr.y * sc,
      w: cr.w * sc,
      h: cr.h * sc
    };
  }

  /* 取景窗固定模型核心：取景窗锚点 S.ov 大小/位置固定（不随图片变换），
     crop（导出/排版依据）由 ov 与当前视图反算，并 clamp 到工作画布内，
     再把“自由变量”回写对齐，保证取景窗显示 = 导出内容严格一致：
       fixOv=true  → 拖取景窗（pan 不动，ov 回写对齐 crop）
       fixOv=false → 图片平移/缩放（ov 不动，pan 回写对齐 crop） */
  function syncCropFromView(fixOv) {
    if (!S.work || !S.crop.visible || !S.ov) return;
    var cv = $('idPreview'), box = $('idPreviewBox');
    var offX = 0, offY = 0;
    if (cv && box) {
      var cvr = cv.getBoundingClientRect(), br = box.getBoundingClientRect();
      offX = cvr.left - br.left; offY = cvr.top - br.top;
    }
    var sc = S.fit * S.view.scale;
    var workLeft = S.prevW / 2 + S.view.panX - S.work.width * sc / 2;
    var workTop = S.prevH / 2 + S.view.panY - S.work.height * sc / 2;
    var o = S.ov;
    var cw = Math.max(1, Math.min(S.work.width, Math.round(o.w / sc)));
    var ch = Math.max(1, Math.min(S.work.height, Math.round(o.h / sc)));
    var cx = Math.max(0, Math.min(S.work.width - cw, Math.round((o.x - offX - workLeft) / sc)));
    var cy = Math.max(0, Math.min(S.work.height - ch, Math.round((o.y - offY - workTop) / sc)));
    S.crop.x = cx; S.crop.y = cy; S.crop.w = cw; S.crop.h = ch;
    if (fixOv) {
      // 拖取景窗：pan 固定，把 ov 回写对齐 clamp 后的 crop
      S.ov.x = offX + workLeft + cx * sc;
      S.ov.y = offY + workTop + cy * sc;
    } else {
      // 平移/缩放：ov 固定，把 pan 回写对齐 clamp 后的 crop
      S.view.panX = o.x - offX - cx * sc - S.prevW / 2 + S.work.width * sc / 2;
      S.view.panY = o.y - offY - cy * sc - S.prevH / 2 + S.work.height * sc / 2;
    }
  }

  function updateCropOverlay() {
    var ov = $('idCropOverlay');
    if (!ov) return;
    if (!S.work || !S.crop.visible || !S.ov) { ov.hidden = true; return; }
    ov.hidden = false;
    // 取景窗固定：位置/大小直接来自锚点 S.ov（图片平移/缩放不再影响它）
    ov.style.left = S.ov.x + 'px';
    ov.style.top = S.ov.y + 'px';
    ov.style.width = S.ov.w + 'px';
    ov.style.height = S.ov.h + 'px';
  }

  function initCropDrag() {
    var ov = $('idCropOverlay');
    if (!ov) return;
    ov.addEventListener('pointerdown', function (e) {
      if (!S.work) return;
      e.stopPropagation();
      e.preventDefault();
      // 清除 box 的平移拖动状态 + 显式占用取景窗拖动：
      // 取景窗内拖动只动取景窗（S.cropDrag=true 时平移监听一律让路），杜绝图片跟随
      S.dragState = null;
      S.cropDrag = true;
      var box = $('idPreviewBox');
      if (box) box.classList.remove('drag-active');
      var startX = e.clientX, startY = e.clientY;
      var ox = S.ov ? S.ov.x : 0, oy = S.ov ? S.ov.y : 0;  // 拖动起点锚定（避免逐次累加）
      var moved = false;
      function move(ev) {
        // 取景窗内拖动 = 移动取景窗（大小不变）：ov 跟随鼠标绝对位移，crop 由 ov+视图反算
        if (!S.ov) return;
        S.ov.x = ox + (ev.clientX - startX);
        S.ov.y = oy + (ev.clientY - startY);
        syncCropFromView(true);  // 拖取景窗：pan 固定，ov 钳制在图片范围内
        moved = true;
        updateCropOverlay();
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        S.cropDrag = false;
        if (moved) renderPreview();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function initGuides() {
    [['idGuideHead', 'head'], ['idGuideEye', 'eye'], ['idGuideThird', 'third']].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener('change', function () {
        S.guides[pair[1]] = el.checked;
        updateGuideOverlay();
      });
    });
  }

  function updateGuideOverlay() {
    var g = $('idGuideOverlay');
    if (!g) return;
    g.hidden = !(S.work && (S.guides.head || S.guides.eye || S.guides.third));
    if (g.hidden) return;
    g.querySelector('.id-guide-head').style.display = S.guides.head ? '' : 'none';
    g.querySelector('.id-guide-eye').style.display = S.guides.eye ? '' : 'none';
    g.querySelectorAll('.id-guide-third-v, .id-guide-third-h').forEach(function (el) { el.style.display = S.guides.third ? '' : 'none'; });
  }

  /* =====================================================================
     ⑤ 换底色（F-06：魔棒 RGB 距离阈值 / 画笔 / 橡皮；入撤销栈）
     ===================================================================== */
  function bgTargetRGB() {
    var c = S.bg.color;
    if (c === 'red') return { r: 225, g: 29, b: 72, a: 255 };
    if (c === 'white') return { r: 255, g: 255, b: 255, a: 255 };
    if (c === 'blue') return { r: 38, g: 97, b: 156, a: 255 };
    if (c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    var hx = (S.bg.custom || '#FF6B6B').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hx)) return { r: 255, g: 107, b: 107, a: 255 };
    return { r: parseInt(hx.slice(0, 2), 16), g: parseInt(hx.slice(2, 4), 16), b: parseInt(hx.slice(4, 6), 16), a: 255 };
  }

  function applyWand(wx, wy) {
    pushUndo();   // 先存当前快照，再改像素（撤销可回到操作前）
    var c = S.workCtx, imgData = c.getImageData(0, 0, S.work.width, S.work.height);
    var d = imgData.data;
    var seed = getPixel(d, wx, wy, imgData.width);
    if (!seed) return;
    var t = S.bg.threshold;
    var target = bgTargetRGB();
    var n = d.length;
    for (var i = 0; i < n; i += 4) {
      var dist = Math.abs(d[i] - seed.r) + Math.abs(d[i + 1] - seed.g) + Math.abs(d[i + 2] - seed.b);
      if (dist <= t) {
        d[i] = target.r; d[i + 1] = target.g; d[i + 2] = target.b; d[i + 3] = target.a;
      }
    }
    c.putImageData(imgData, 0, 0);
    renderPreview();
  }

  function applyBrush(wx, wy, tool) {
    pushUndo();   // 先存当前快照，再改像素
    var c = S.workCtx;
    var imgData = c.getImageData(0, 0, S.work.width, S.work.height);
    var d = imgData.data, W = imgData.width;
    var target = bgTargetRGB();
    var base = tool === 'eraser' ? S.baseline.data : null;
    var r = Math.max(1, S.bg.size);
    var r2 = r * r;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var px = wx + dx, py = wy + dy;
        if (px < 0 || py < 0 || px >= W || py >= imgData.height) continue;
        var idx = (py * W + px) * 4;
        if (tool === 'eraser' && base) {
          d[idx] = base[idx]; d[idx + 1] = base[idx + 1]; d[idx + 2] = base[idx + 2]; d[idx + 3] = base[idx + 3];
        } else {
          d[idx] = target.r; d[idx + 1] = target.g; d[idx + 2] = target.b; d[idx + 3] = target.a;
        }
      }
    }
    c.putImageData(imgData, 0, 0);
    renderPreview();
  }

  function getPixel(d, x, y, w) {
    if (x < 0 || y < 0 || x >= w || y >= Math.ceil(d.length / 4 / w)) return null;
    var i = (y * w + x) * 4;
    return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
  }

  /* =====================================================================
     ⑥ 撤销 / 重做 / 还原（F-07：基线=出厂，还原常驻亮显）
     ===================================================================== */
  function snapshot() { return S.workCtx.getImageData(0, 0, S.work.width, S.work.height); }
  function pushUndo() {
    S.undo.push(snapshot());
    if (S.undo.length > 50) S.undo.shift();
    S.redo = [];
    syncOps();
  }
  function doUndo() {
    if (!S.undo.length || !S.work) return;
    S.redo.push(snapshot());
    S.workCtx.putImageData(S.undo.pop(), 0, 0);
    renderPreview();
    syncOps();
  }
  function doRedo() {
    if (!S.redo.length || !S.work) return;
    S.undo.push(snapshot());
    S.workCtx.putImageData(S.redo.pop(), 0, 0);
    renderPreview();
    syncOps();
  }
  function doReset() {
    if (!S.work || !S.baseline) return;
    S.workCtx.putImageData(S.baseline, 0, 0);
    S.undo = []; S.redo = [];
    // 关闭背景/裁剪/排版开关（还原到刚加载状态）
    ['idBgSw', 'idCropSw', 'idLayoutSw', 'idToolSw'].forEach(function (id) {
      var sw = $(id);
      if (sw && sw.checked) { sw.checked = false; sw.dispatchEvent(new Event('change')); }
    });
    S.bg.enabled = false; S.crop.visible = false; S.layout.enabled = false;
    resetCrop();
    renderPreview();
    syncOps();
  }
  function syncOps() {
    var u = $('idUndo'), r = $('idRedo'), rs = $('idReset');
    if (u) u.disabled = !(S.undo.length > 0);
    if (r) r.disabled = !(S.redo.length > 0);
    if (rs) rs.disabled = !S.work;
  }
  function initOps() {
    var u = $('idUndo'), r = $('idRedo'), rs = $('idReset');
    if (u) u.addEventListener('click', doUndo);
    if (r) r.addEventListener('click', doRedo);
    if (rs) rs.addEventListener('click', doReset);
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) { e.preventDefault(); doRedo(); }
        else { e.preventDefault(); doUndo(); }
      }
    });
  }

  /* =====================================================================
     ⑦ 排版（F-03：行×列 + 间距 + 裁切线 → 排版画布）
     ===================================================================== */
  function buildLayout(src) {
    var rows = S.layout.rows, cols = S.layout.cols, gapMm = S.layout.gap;
    var gap = gapMm / 25.4 * S.dpi;  // mm → 像素（按当前 DPI）
    var W = Math.round(cols * src.width + (cols - 1) * gap);
    var H = Math.round(rows * src.height + (rows - 1) * gap);
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    for (var r = 0; r < rows; r++) {
      for (var cc = 0; cc < cols; cc++) {
        var x = Math.round(cc * (src.width + gap)), y = Math.round(r * (src.height + gap));
        ctx.drawImage(src, x, y);
        if (S.layout.cut) {
          ctx.strokeStyle = 'rgba(80,140,180,.8)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, src.width - 1, src.height - 1);
          ctx.setLineDash([]);
        }
      }
    }
    return c;
  }

  /* =====================================================================
     ⑧ 导出（F-08~11：裁剪 → 规格画布 → 排版 → 编码；命名+ZIP）
     ===================================================================== */
  function specName() {
    var map = { cun1: '1inch', cun1s: '1inch-s', cun1b: '1inch-l', cun2: '2inch', cun2s: '2inch-s', cun2b: '2inch-l', w5: '5inch', cnid: 'cnid', marriage: 'marriage', us: 'us', jp: 'jp', sc: 'schengen' };
    return map[S.spec] || S.spec;
  }
  function bgName() {
    if (S.bg.color === 'transparent') return 'transparent';
    if (S.bg.color === 'custom') return 'custom';
    return S.bg.color;
  }
  function buildFinalCanvas() {
    if (!S.work) return null;
    var spec = SPECS[S.spec];
    var outW = pxOf(spec.mm[0], S.dpi), outH = pxOf(spec.mm[1], S.dpi);
    var c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    var ctx = c.getContext('2d');
    var trans = S.bg.enabled && S.bg.color === 'transparent';
    var jpg = S.fmt === 'jpg';
    if (!trans || jpg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH); }
    var cr = S.crop;
    if (!cr.w) { cr = { x: 0, y: 0, w: S.work.width, h: S.work.height }; }
    ctx.drawImage(S.work, cr.x, cr.y, cr.w, cr.h, 0, 0, outW, outH);
    if (S.layout.enabled) c = buildLayout(c);
    return c;
  }
  function canvasBytes(c, mime, q) {
    return new Promise(function (res) { c.toBlob(function (b) { res(b); }, mime, q); });
  }
  function encodeToTargetSize(canvas, mime, q0, targetBytes) {
    var limit = Math.ceil(targetBytes * 1.05);
    function encode(qv) { return canvasBytes(canvas, mime, qv); }
    return new Promise(function (resolve) {
      var bestOk = null, bestSmall = null;
      function consider(b, qv) {
        if (!b) return;
        if (b.size <= limit) { if (!bestOk || qv > bestOk.q) bestOk = { blob: b, size: b.size, q: qv }; }
        else if (!bestSmall || b.size < bestSmall.size) bestSmall = { blob: b, size: b.size, q: qv };
      }
      function done() { resolve(bestOk ? { blob: bestOk.blob, ok: true } : (bestSmall ? { blob: bestSmall.blob, ok: false } : null)); }
      encode(q0).then(function (b0) {
        if (!b0) { resolve(null); return; }
        consider(b0, q0);
        if (bestOk) { done(); return; }
        var lo = 1, hi = Math.max(1, Math.round(q0 * 100) - 1), iters = 6;
        function step() {
          if (iters <= 0 || lo > hi) { done(); return; }
          iters--;
          var mid = Math.round((lo + hi) / 2);
          encode(mid / 100).then(function (b) {
            if (!b) { done(); return; }
            consider(b, mid / 100);
            if (b.size <= limit) lo = mid + 1;
            else hi = mid - 1;
            step();
          });
        }
        step();
      });
    });
  }

  function exportName(i) {
    var ext = S.fmt === 'jpg' ? 'jpg' : S.fmt === 'png' ? 'png' : 'webp';
    var base = S.layout.enabled
      ? 'layout-' + specName() + '-' + S.layout.rows + 'x' + S.layout.cols
      : 'idphoto-' + specName() + (S.bg.enabled ? '-' + bgName() : '');
    return base + (i > 0 ? '-' + String(i).padStart(2, '0') : '') + '.' + ext;
  }

  function initExport() {
    var exp = $('idExport'), zip = $('idZip');
    if (exp) exp.addEventListener('click', function () {
      var c = buildFinalCanvas();
      if (!c) return;
      var mime = 'image/' + (S.fmt === 'jpg' ? 'jpeg' : S.fmt);
      var q = S.quality / 100;
      var done = function (blob) {
        if (!blob) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = exportName(0);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      };
      if (S.target > 0) {
        encodeToTargetSize(c, mime, q, S.target * 1024).then(function (res) { if (res) done(res.blob); });
      } else {
        canvasBytes(c, mime, q).then(done);
      }
    });
    if (zip) zip.addEventListener('click', function () {
      var c = buildFinalCanvas();
      if (!c || !window.MotefulZip) return;
      var mime = 'image/' + (S.fmt === 'jpg' ? 'jpeg' : S.fmt);
      var q = S.quality / 100;
      canvasBytes(c, mime, q).then(function (blob) {
        if (!blob) return;
        blob.arrayBuffer().then(function (ab) {
          var data = new Uint8Array(ab);
          var zipBlob = window.MotefulZip.build([{ name: exportName(0), data: data }]);
          if (!zipBlob) return;
          var a = document.createElement('a');
          a.href = URL.createObjectURL(zipBlob);
          a.download = exportName(0).replace(/\.(jpg|png|webp)$/, '.zip');
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        });
      });
    });
    // 格式/质量/目标大小 联动
    document.querySelectorAll('input[name="idFmt"]').forEach(function (r) {
      r.addEventListener('change', function () { S.fmt = r.value; syncFmt(); });
    });
    var q = $('idQuality'), qOut = $('idQualityOut');
    if (q && qOut) {
      q.addEventListener('input', function () {
        S.quality = parseInt(q.value, 10);
        qOut.value = S.quality;
        q.style.setProperty('--p', (S.quality - 1) / 99 * 100 + '%');
        syncFmt();
      });
      var step = q.closest('.step');
      if (step) {
        step.querySelectorAll('.step-btn').forEach(function (b) {
          b.addEventListener('click', function () {
            var d = parseInt(b.getAttribute('data-step'), 10);
            var v = Math.min(100, Math.max(1, S.quality + d));
            S.quality = v; q.value = v; qOut.value = v;
            q.style.setProperty('--p', (v - 1) / 99 * 100 + '%');
            syncFmt();
          });
        });
      }
      qOut.addEventListener('change', function () {
        var v = Math.min(100, Math.max(1, parseInt(qOut.value, 10) || 92));
        S.quality = v; q.value = v; qOut.value = v;
        q.style.setProperty('--p', (v - 1) / 99 * 100 + '%');
      });
    }
    document.querySelectorAll('#idTargetSegs .seg input').forEach(function (r) {
      r.addEventListener('change', function () {
        var seg = r.closest('.seg');
        S.target = parseInt(seg.getAttribute('data-target'), 10);
        syncFmt();
      });
    });
    var t = $('idTargetCustom');
    if (t) t.addEventListener('input', function () {
      var v = parseInt(t.value, 10);
      if (v > 0) S.target = v;
    });
  }

  function syncFmt() {
    var png = S.fmt === 'png';
    var note = $('idPngNote');
    if (note) note.hidden = !png;
    var tn = $('idTargetPngNote');
    if (tn) tn.hidden = !png;
    var exp = $('idExport'), zip = $('idZip');
    if (exp) exp.disabled = !S.work;
    if (zip) zip.disabled = !S.work;
  }

  /* =====================================================================
     ⑨ 编辑区联动（开关/目标色/工具/排版/规格/DPI）
     ===================================================================== */
  function initControls() {
    // 开关联动（界面显隐 + 状态同步：开=显示组件区，关=隐藏回原图态）
    // idCropSw 内嵌 idCropBody（含排版预览开关 idLayoutSw）；裁剪关→排版预览自动关
    [['idCropSw', 'crop', 'idCropBody'], ['idBgSw', 'bg', 'idBgBody'], ['idToolSw', 'tool', 'idToolBody'], ['idLayoutSw', 'layout', 'idLayoutBody']].forEach(function (pair) {
      var sw = $(pair[0]);
      if (!sw) return;
      sw.addEventListener('change', function () {
        var body = $(pair[2]);
        if (body) body.hidden = !sw.checked;
        if (pair[1] === 'crop') {
          S.crop.visible = sw.checked;
          if (sw.checked) {
            // 开裁剪时重置预览视图，保证 crop.x/y 居中与 overlay 位置对齐
            S.view = { scale: 1, panX: 0, panY: 0 };
            setZoomVal(100);
            resetCrop();
          } else {
            // 裁剪关 → 排版预览自动关
            var lw = $('idLayoutSw');
            if (lw && lw.checked) { lw.checked = false; lw.dispatchEvent(new Event('change')); }
          }
          renderPreview();
        }
        if (pair[1] === 'bg') {
          S.bg.enabled = sw.checked;
          // 关闭背景开关：还原工作画布到 baseline（魔棒/画笔已改像素，必须回滚到原图）
          if (!sw.checked && S.workCtx && S.baseline) {
            S.workCtx.putImageData(S.baseline, 0, 0);
            renderPreview();
          }
        }
        if (pair[1] === 'tool') { S.bg.toolEnabled = sw.checked; if (!sw.checked) hideBrushCursor(); }
        if (pair[1] === 'layout') {
          // 排版预览开关只切换渲染，不复位视图/裁剪：
          // 取景窗固定模型下，复位视图会使 crop 反算跳变，破坏用户已调好的取景
          S.layout.enabled = sw.checked;
          if (sw.checked) sliderFill(Math.round(S.lv.scale * 100));  // 滑杆切到相纸视图缩放
          else setZoomVal(Math.round(S.view.scale * 100));           // 退出排版恢复编辑视图缩放显示
          renderPreview();
        }
        syncFmt();
      });
    });
    // 目标色（选"自定义"才显示色板触发 + hex 输入）
    document.querySelectorAll('input[name="idBgColor"]').forEach(function (r) {
      r.addEventListener('change', function () {
        S.bg.color = r.value;
        var cw = $('idBgCustomWrap');
        if (cw) cw.hidden = r.value !== 'custom';
      });
    });
    var hex = $('idBgHex');
    if (hex) hex.addEventListener('input', function () { S.bg.custom = hex.value; });
    // 工具
    document.querySelectorAll('input[name="idBgTool"]').forEach(function (r) {
      r.addEventListener('change', function () { S.bg.tool = r.value; });
    });
    // 大小滑杆（range input，实时更新 S.bg.size + 输出数值 + --p 填充同步）
    var ts = $('idToolSize'), tsOut = $('idToolSizeOut');
    if (ts) {
      var syncP = function (el) {
        var mn = parseFloat(el.min), mx = parseFloat(el.max);
        el.style.setProperty('--p', ((el.value - mn) / (mx - mn) * 100) + '%');
      };
      syncP(ts);
      ts.addEventListener('input', function () {
        S.bg.size = Math.min(200, Math.max(1, parseInt(ts.value, 10) || 40));
        if (tsOut) tsOut.textContent = ts.value;
        syncP(ts);
      });
    }
    // 容差滑杆（range input，实时更新 S.bg.threshold + 输出数值 + --p 填充同步）
    var tol = $('idTol'), tolOut = $('idTolOut');
    if (tol) {
      var syncP2 = function (el) {
        var mn = parseFloat(el.min), mx = parseFloat(el.max);
        el.style.setProperty('--p', ((el.value - mn) / (mx - mn) * 100) + '%');
      };
      syncP2(tol);
      tol.addEventListener('input', function () {
        S.bg.threshold = Math.min(100, Math.max(1, parseInt(tol.value, 10) || 32));
        if (tolOut) tolOut.textContent = tol.value;
        syncP2(tol);
      });
    }
    // 排版（参数变更立即刷新预览；gap 单位 mm，范围 0-20；rows/cols 范围 1-9）
    [['idLayoutRows', 'rows'], ['idLayoutCols', 'cols'], ['idLayoutGap', 'gap']].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      var maxV = pair[1] === 'gap' ? 20 : 9;
      var minV = pair[1] === 'gap' ? 0 : 1;
      var defV = pair[1] === 'gap' ? 3 : 2;
      el.addEventListener('change', function () {
        S.layout[pair[1]] = Math.min(maxV, Math.max(minV, parseInt(el.value, 10) || defV));
        renderPreview();
      });
      var step = el.closest('.step');
      if (step) step.querySelectorAll('.step-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          var d = parseInt(b.getAttribute('data-step'), 10);
          var v = Math.min(maxV, Math.max(minV, S.layout[pair[1]] + d));
          S.layout[pair[1]] = v; el.value = v;
          renderPreview();
        });
      });
    });
    var cut = $('idLayoutCut');
    if (cut) cut.addEventListener('change', function () { S.layout.cut = cut.checked; renderPreview(); });
    // 规格 / DPI（联动更新 px 换算显示）
    function updateSpecPx() {
      var el = $('idSpecPx');
      if (!el) return;
      var spec = SPECS[S.spec];
      if (!spec) { el.textContent = ''; return; }
      el.textContent = pxOf(spec.mm[0], S.dpi) + '×' + pxOf(spec.mm[1], S.dpi) + 'px';
    }
    document.querySelectorAll('input[name="idSpec"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { S.spec = r.value; resetCrop(); renderPreview(); updateSpecPx(); } });
    });
    document.querySelectorAll('input[name="idDpi"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { S.dpi = parseInt(r.value, 10); updateSpecPx(); } });
    });
    updateSpecPx();
  }

  /* =====================================================================
     ⑩ 色板（HSV：色相条 + 饱和度/明度面板 + hex + 取色器 + 预设）
     ===================================================================== */
  function initColorPicker() {
    var trig = $('idBgCpTrig'), pop = $('idCpPop');
    if (!trig || !pop) return;
    var hue = $('idCpHue'), sv = $('idCpSv'), cursor = $('idCpCursor'), hueCursor = $('idCpHueCursor');
    var hexInput = $('idCpHex'), prev = $('idCpPrev'), pal = $('idCpPal'), native = $('idCpNative');
    var h = 6, s = 100, v = 100;

    function hsvToRgb(hh, ss, vv) {
      ss /= 100; vv /= 100;
      var k = function (n) { return (n + hh / 60) % 6; };
      var f = function (n) { return vv - vv * ss * Math.max(0, Math.min(k(n), 4 - k(n), 1)); };
      return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
    }
    function rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(function (x) { return x.toString(16).padStart(2, '0'); }).join('').toUpperCase();
    }
    function render() {
      var base = hsvToRgb(h, 100, 100);
      sv.style.background = 'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,rgb(' + base.join(',') + '))';
      cursor.style.left = s + '%';
      cursor.style.top = (100 - v) + '%';
      hueCursor.style.left = (h / 360 * 100) + '%';
      var rgb = hsvToRgb(h, s, v);
      var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
      prev.style.background = hex;
      hexInput.value = hex;
      if (native) native.value = hex.toLowerCase();
    }
    function drag(el, cb) {
      el.addEventListener('pointerdown', function (e) {
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        move(e);
        function move(ev) {
          var r = el.getBoundingClientRect();
          var p = ev.touches ? ev.touches[0] : ev;
          var x = Math.min(Math.max((p.clientX - r.left) / r.width, 0), 1);
          var y = Math.min(Math.max((p.clientY - r.top) / r.height, 0), 1);
          cb(x, y);
        }
        function up() {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
    }
    drag(hue, function (x) { h = x * 360; render(); });
    drag(sv, function (x, y) { s = x * 100; v = (1 - y) * 100; render(); });
    hexInput.addEventListener('input', function () {
      var m = hexInput.value.replace('#', '');
      if (/^[0-9a-fA-F]{6}$/.test(m)) {
        var r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
        var hh = 0;
        if (dd) {
          if (mx === r) hh = ((g - b) / dd) % 6; else if (mx === g) hh = (b - r) / dd + 2; else hh = (r - g) / dd + 4;
          hh *= 60; if (hh < 0) hh += 360;
        }
        h = hh; s = mx ? dd / mx * 100 : 0; v = mx / 255 * 100;
        render();
      }
    });
    if (native) native.addEventListener('input', function () {
      var m = native.value.replace('#', '');
      if (/^[0-9a-fA-F]{6}$/.test(m)) {
        hexInput.value = native.value.toUpperCase();
        hexInput.dispatchEvent(new Event('input'));
      }
    });
    var presets = ['#FF6B6B', '#F9A826', '#FDCB6E', '#00B894', '#0984E3', '#6C5CE7', '#E17055', '#B2BEC3', '#2D3436', '#00CEC9', '#E84393', '#74B9FF', '#55EFC4', '#FFEAA7', '#D63031', '#FFFFFF'];
    presets.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', function () {
        hexInput.value = c;
        hexInput.dispatchEvent(new Event('input'));
      });
      pal.appendChild(b);
    });
    // 取色器（EyeDropper 可用时）
    var eye = $('idCpEye');
    if (eye) eye.addEventListener('click', function () {
      if (window.EyeDropper) {
        new EyeDropper().open().then(function (res) {
          hexInput.value = res.sRGBHex;
          hexInput.dispatchEvent(new Event('input'));
        }).catch(function () {});
      } else {
        native && native.click();
      }
    });
    // 打开/关闭定位（对齐 icon-tool cpOpen：底部空间不足向上翻转；滚动即关闭避免 fixed 浮窗与触发按钮脱节）
    trig.addEventListener('click', function (e) {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
      if (!pop.hidden) {
        var r = trig.getBoundingClientRect();
        var w = pop.offsetWidth, h = pop.offsetHeight;
        var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
        var top = r.bottom + 6;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
      }
    });
    window.addEventListener('scroll', function () { pop.hidden = true; }, true);
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== trig) pop.hidden = true;
    });
    // 确认选色 → 写回 hex
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn-primary btn-sm';
    ok.style.width = '100%';
    ok.style.marginTop = '8px';
    ok.textContent = '确定';
    ok.addEventListener('click', function () {
      var hx = $('idBgHex');
      if (hx) { hx.value = hexInput.value; S.bg.custom = hexInput.value; }
      pop.hidden = true;
    });
    pop.appendChild(ok);
    render();
  }

  /* =====================================================================
     ⑪ 分享（F-12：参数入 URL，siteUrl 正式域名）
     ===================================================================== */
  function initShare() {
    if (!window.MotefulShare) return;
    window.MotefulShare.setShareable(true);
    window.MotefulShare.register('id-photo-tool', {
      getParams: function () {
        return { sp: S.spec, dpi: S.dpi, f: S.fmt, q: S.quality, t: S.target > 0 ? S.target : 0, bg: S.bg.enabled ? S.bg.color : '', c: S.bg.custom };
      }
    });
  }

  /* =====================================================================
     ⑫ 启动
     ===================================================================== */
  function init() {
    initImport();
    setupPreview();
    initCropDrag();
    initGuides();
    initOps();
    initExport();
    initControls();
    initColorPicker();
    initShare();
    syncFmt();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
