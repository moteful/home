/* Moteful 图标工具 · 页面主逻辑（icon-tool.js）
   依赖：moteful.js（MF.toast / refreshIcons）、i18n（window.t）、icon-render.js、
        compare-card.js（预览 modal）、zip.js（一键 ZIP）、share.js（分享带参）。
   功能：导入（文件/拖入/代码/文本拖入）→ 净化 → 编辑（颜色/描边/背景/内边距/
        画布/缩放/旋转/翻转）→ 撤销重做 → 预览 → 导出（SVG/PNG/JPG/WebP/多尺寸 ZIP）
        → 复制（SVG 代码/DataURI/图像）→ 配置记忆 → 分享带参（PARAMS 注册）。
   安全：导入即净化（DOMParser 只解析不执行）；导出前再净化；URL 参数白名单校验。 */
(function () {
  'use strict';

  var $id = function (id) { return document.getElementById(id); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function tr(k) { return typeof window.t === 'function' ? window.t(k) : k; }
  function toast(msg, type) { if (window.MF && window.MF.toast) window.MF.toast(msg, type || 'info'); }

  var MEM_KEY = 'moteful-icon-tool-v1';
  var MAX_BYTES = 1024 * 1024;          // 1MB 上限
  var COMPLEX_NODES = 2000;             // 元素数超阈值提示
  var SIZE_PRESETS = [16, 24, 32, 48, 64, 128, 256, 512];
  var ROT_MAP = [0, 90, 180, 270];
  var FMT_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  var FMT_EXT = { svg: 'svg', png: 'png', jpg: 'jpg', webp: 'webp' };

  /* ================= 状态 ================= */
  var svgDoc = null;        // 净化后的 SVG Document（编辑对象）
  var loaded = false;
  var params = {
    color: '#111827', sc: '#111827', sw: 2, bg: 'raw', pdPct: 10, pdPx: 10, pdu: 'pct', zoom: 100,
    cm: 'raw', sm: 'none',
    scale: 100, scaleMode: 'raw', canvas: 128,
    fmt: 'png', sizes: [128], customSize: '', sizeMode: 'single',
    rt: 0, fl: 0, padOn: false, rotOn: false, flipOn: false
  };
  var origSvgStr = null;   /* 导入时净化后的原始 SVG（原图模式渲染基准，防原图被强行加入参数） */
  var paramsDefaults = JSON.parse(JSON.stringify(params));   /* 纯默认参数（未受记忆影响），供「重做=一键还原」使用 */
  var undoStack = [], redoStack = [], initialState = null;
  var baseViewBox = null;   /* 导入时的原始 viewBox（applyViewBox 从基准重算，防内边距累积） */
  /* 预览查看器状态：抓手平移（内容层 CSS transform，任何缩放级别可拖）+ 滚轮缩放 */
  var pan = { x: 0, y: 0 };
  var dragView = null;
  var renderSeq = 0;          /* 异步渲染竞态防护：仅应用最新一次渲染结果 */

  /* ================= 净化（安全红线 8.4） ================= */
  function isExternalUrl(v) {
    v = String(v || '').trim();
    return /^(https?:)?\/\//i.test(v) || /^\/\//.test(v);
  }
  function sanitizeStyleText(txt) {
    // 剥离 @import 规则与 url(javascript:)
    return String(txt || '')
      .replace(/@import\s+(url\()?[^;)]*\)?;?/gi, '')
      .replace(/url\(\s*javascript:[^)]*\)/gi, 'none');
  }
  function sanitize(root) {
    if (!root) return root;
    var kill = [];
    var i, el, attrs, j, name, val;
    /* 快照数组：根自身 + 全部后代（getElementsByTagName('*') 不含根，根属性同样需净化） */
    var all = root.getElementsByTagName('*');
    var nodes = [root].concat(Array.prototype.slice.call(all));
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      var tag = el.nodeName.toLowerCase();
      if (tag === 'script' || tag === 'foreignobject') { kill.push(el); continue; }
      attrs = el.attributes;
      for (j = attrs.length - 1; j >= 0; j--) {
        name = attrs[j].name.toLowerCase();
        val = attrs[j].value;
        if (/^on/i.test(name)) { el.removeAttribute(attrs[j].name); continue; }
        if ((name === 'href' || name === 'xlink:href' || name === 'src') && val) {
          if (/^\s*javascript:/i.test(val)) { el.removeAttribute(attrs[j].name); continue; }
          if (tag === 'image' && !/^data:/i.test(val.trim()) && isExternalUrl(val)) { kill.push(el); continue; }
          if (tag === 'use' && isExternalUrl(val)) { el.removeAttribute(attrs[j].name); continue; }
          if (tag === 'a' && /^\s*javascript:/i.test(val)) { el.removeAttribute(attrs[j].name); }
        }
      }
      var st = el.getAttribute('style');
      if (st && (/javascript:/i.test(st) || /@import/i.test(st))) {
        el.setAttribute('style', sanitizeStyleText(st));
      }
      if (tag === 'style') {
        if (el.textContent && (/@import/i.test(el.textContent) || /javascript:/i.test(el.textContent))) {
          el.textContent = sanitizeStyleText(el.textContent);
        }
      }
    }
    for (i = 0; i < kill.length; i++) if (kill[i] && kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]);
    return root;
  }

  /* ================= 解析 ================= */
  function parseSvg(str) {
    var d;
    try { d = new DOMParser().parseFromString(str, 'image/svg+xml'); } catch (e) { return null; }
    if (!d || d.querySelector('parsererror')) return null;
    var r = d.documentElement;
    if (!r || r.nodeName.toLowerCase() !== 'svg') return null;
    return d;
  }
  function svgString() { return new XMLSerializer().serializeToString(svgDoc); }
  function sanitizeForExport(str) {
    var d = parseSvg(str);
    if (!d) return str;
    sanitize(d.documentElement);
    return new XMLSerializer().serializeToString(d.documentElement);
  }
  function parseViewBox(s) {
    if (!s) return null;
    var a = String(s).trim().split(/[\s,]+/).map(parseFloat);
    if (a.length !== 4 || a.some(function (n) { return isNaN(n); })) return null;
    return { x: a[0], y: a[1], w: a[2], h: a[3] };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ================= 导入 ================= */
  function loadFromString(str, srcName) {
    var d = parseSvg(str);
    if (!d) { toast(tr('icon_invalid'), 'warning'); return false; }
    var nodeCount = d.getElementsByTagName('*').length;
    sanitize(d.documentElement);
    svgDoc = d;
    var r0 = d.documentElement;
    /* 补命名空间：无 xmlns 的 SVG（在线图标/手写常见）序列化后作为 Image 源会 decode 失败 → 渲染失败 */
    if (!r0.getAttribute('xmlns')) r0.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    /* 记录净化后的原始 SVG（任何参数应用前），作为 原图/无描边 模式的渲染基准 */
    origSvgStr = new XMLSerializer().serializeToString(r0);
    var vb0 = parseViewBox(r0.getAttribute('viewBox'));
    if (!vb0) { var w0 = parseFloat(r0.getAttribute('width')) || 128, h0 = parseFloat(r0.getAttribute('height')) || 128; vb0 = { x: 0, y: 0, w: Math.max(w0, 1), h: Math.max(h0, 1) }; }
    baseViewBox = vb0;
    loaded = true;
    ensureCanvasFromSvg();
    /* 初始状态 = 纯加载文件态（净化原始 SVG + 默认参数，无记忆影响）：「重做=一键还原」目标 */
    undoStack = []; redoStack = [];
    initialState = { svg: origSvgStr, params: JSON.parse(JSON.stringify(paramsDefaults)) };
    // 记忆参数（颜色/描边/背景/内边距/尺寸/格式），画布随 SVG 重算
    var mem = loadMem();
    if (mem) applyParams(mem, true);
    enableUi();
    syncUi();
    renderPreview();
    showGallery(srcName || 'SVG 代码');
    if (nodeCount > COMPLEX_NODES) toast(tr('icon_complex'), 'info');
    else toast(tr('icon_loaded'), 'success');
    return true;
  }
  function ensureCanvasFromSvg() {
    var r = svgDoc.documentElement;
    var vb = parseViewBox(r.getAttribute('viewBox'));
    var w = vb ? vb.w : parseFloat(r.getAttribute('width')) || 0;
    var h = vb ? vb.h : parseFloat(r.getAttribute('height')) || 0;
    var base = Math.max(w, h) || 128;
    var cand = SIZE_PRESETS.filter(function (s) { return s >= base; });
    params.canvas = cand.length ? cand[0] : 512;
  }
  function loadFromFile(file) {
    if (!file) return;
    var isSvg = /\.svg$/i.test(file.name) || (file.type && file.type === 'image/svg+xml');
    if (!isSvg) { toast(tr('icon_bad_type'), 'warning'); return; }
    if (file.size > MAX_BYTES) { toast(tr('icon_too_big'), 'warning'); return; }
    var rd = new FileReader();
    rd.onload = function () { loadFromString(String(rd.result || ''), file.name); };
    rd.onerror = function () { toast(tr('icon_err_decode'), 'danger'); };
    rd.readAsText(file);
  }

  /* ================= 编辑引擎 ================= */
  function walk(doc, fn) {
    if (typeof doc === 'function') { fn = doc; doc = svgDoc; }
    doc = doc || svgDoc;
    var els = doc.getElementsByTagName('*');
    for (var i = 0; i < els.length; i++) fn(els[i]);
  }
  function isNoneFill(v) { return /^(none|transparent|inherit)$/i.test(String(v).trim()); }
  function replaceStyleProp(style, prop, val) {
    var re = new RegExp('(^|;)\\s*' + prop + '\\s*:\\s*[^;]*', 'g');
    return String(style).replace(re, '$1' + prop + ':' + val);
  }
  function setFill(doc, hex) {
    if (typeof doc === 'string' || doc == null) { hex = doc; doc = svgDoc; }
    walk(doc, function (el) {
      var a = el.getAttribute('fill');
      if (a != null && a.trim() && !isNoneFill(a)) el.setAttribute('fill', hex);
      var s = el.getAttribute('style');
      if (s && /fill\s*:/.test(s)) el.setAttribute('style', replaceStyleProp(s, 'fill', hex));
    });
  }
  /* 可描边图形元素（自定义描边模式：即使原图无 stroke 属性也为其添加描边，否则 fill-only 图标描边无效） */
  var STROKE_SHAPES = /^(path|rect|circle|ellipse|line|polyline|polygon)$/i;
  function setStrokeColor(doc, hex) {
    if (typeof doc === 'string' || doc == null) { hex = doc; doc = svgDoc; }
    walk(doc, function (el) {
      if (!STROKE_SHAPES.test(el.tagName)) return;
      el.setAttribute('stroke', hex);
      var s = el.getAttribute('style');
      if (s && /stroke\s*:/.test(s)) el.setAttribute('style', replaceStyleProp(s, 'stroke', hex));
    });
  }
  function setStrokeWidth(doc, n) {
    if (typeof doc === 'number' || doc == null) { n = doc; doc = svgDoc; }
    walk(doc, function (el) {
      if (!STROKE_SHAPES.test(el.tagName)) return;
      el.setAttribute('stroke-width', String(n));
      var s = el.getAttribute('style');
      if (s && /stroke-width\s*:/.test(s)) el.setAttribute('style', replaceStyleProp(s, 'stroke-width', String(n)));
    });
  }
  /* 无描边：去掉全部描边（stroke:none + stroke-width:0），防止原图被强行加入描边参数 */
  function removeStroke(doc) {
    doc = doc || svgDoc;
    walk(doc, function (el) {
      var a = el.getAttribute('stroke');
      if (a != null && a.trim() && !isNoneFill(a)) el.setAttribute('stroke', 'none');
      var s = el.getAttribute('style');
      if (s && /stroke\s*:/.test(s)) el.setAttribute('style', replaceStyleProp(s, 'stroke', 'none'));
      var w = el.getAttribute('stroke-width');
      if (w != null) el.setAttribute('stroke-width', '0');
      if (s && /stroke-width\s*:/.test(s)) el.setAttribute('style', replaceStyleProp(s, 'stroke-width', '0'));
    });
  }
  function applyViewBox(doc) {
    doc = doc || svgDoc;
    var r = doc.documentElement;
    var vb = baseViewBox || parseViewBox(r.getAttribute('viewBox'));
    if (!vb) {
      var w = parseFloat(r.getAttribute('width')) || 128, h = parseFloat(r.getAttribute('height')) || 128;
      vb = { x: 0, y: 0, w: Math.max(w, 1), h: Math.max(h, 1) };
    }
    var pdv = params.padOn ? Math.max(0, Math.min(50, (params.pdu === 'px' ? params.pdPx : params.pdPct) || 0)) : 0;
    var pw, ph;
    if (params.pdu === 'px') { pw = pdv; ph = pdv; }
    else { var p = pdv / 100; pw = vb.w * p; ph = vb.h * p; }
    r.setAttribute('viewBox', (vb.x - pw) + ' ' + (vb.y - ph) + ' ' + (vb.w + pw * 2) + ' ' + (vb.h + ph * 2));
    var s = Math.max(16, Math.min(1024, params.canvas || 128));
    r.setAttribute('width', s);
    r.setAttribute('height', s);
  }
  function applyTransform(doc) {
    doc = doc || svgDoc;
    var r = doc.documentElement;
    var t = '';
    if (params.rotOn && params.rt) t += 'rotate(' + params.rt + ') ';
    /* 等比缩放：原图模式强制 100（不缩放），自定义模式应用滑杆值（防原图被强行加入缩放参数） */
    var sc = (params.scaleMode === 'raw') ? 100 : (params.scale || 100);
    if (sc !== 100) t += 'scale(' + (sc / 100) + ') ';
    var fx = (params.flipOn && (params.fl & 1)) ? -1 : 1, fy = (params.flipOn && (params.fl & 2)) ? -1 : 1;
    if (fx !== 1 || fy !== 1) t += 'scale(' + fx + ',' + fy + ') ';
    if (t) r.setAttribute('transform', t.trim());
    else r.removeAttribute('transform');
  }
  function applySvgParams() { applyViewBox(); applyTransform(); }
  /* 渲染基准：按 图标颜色模式(原图/自定义) 与 描边模式(无描边/自定义) 重建 SVG 副本，
     原图/无描边时以导入时的原始 SVG 为基准，防止原图被强行加入颜色/描边参数 */
  function buildRenderSvg() {
    var d;
    if (params.cm === 'raw') {
      d = parseSvg(origSvgStr);
      if (!d) d = parseSvg(new XMLSerializer().serializeToString(svgDoc));
    } else {
      d = parseSvg(new XMLSerializer().serializeToString(svgDoc));
      setFill(d, params.color);
    }
    /* 描边模式独立于颜色模式：none → 移除全部描边；custom → 应用自定义描边（覆盖原图） */
    if (params.sm === 'none') removeStroke(d);
    else { setStrokeColor(d, params.sc); setStrokeWidth(d, params.sw); }
    applyViewBox(d);
    applyTransform(d);
    return new XMLSerializer().serializeToString(d);
  }
  /* 渲染/导出的画布背景：原图/透明均按透明画布处理（原图=不改背景语义） */
  function renderBg() { return (params.bg === 't' || params.bg === 'raw') ? 't' : params.bg; }

  /* ================= 撤销 / 重做 ================= */
  function snapshotState() {
    return { svg: svgString(), params: clone(params) };
  }
  function pushSnapshot() {
    if (!loaded) return;
    undoStack.push(snapshotState());
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    syncUndoBtns();
  }
  function applyState(s) {
    var d = parseSvg(s.svg);
    if (!d) return;
    sanitize(d.documentElement);
    svgDoc = d;
    var r0 = d.documentElement;
    /* 补命名空间：无 xmlns 的 SVG（在线图标/手写常见）序列化后作为 Image 源会 decode 失败 → 渲染失败 */
    if (!r0.getAttribute('xmlns')) r0.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var vb0 = parseViewBox(r0.getAttribute('viewBox'));
    if (!vb0) { var w0 = parseFloat(r0.getAttribute('width')) || 128, h0 = parseFloat(r0.getAttribute('height')) || 128; vb0 = { x: 0, y: 0, w: Math.max(w0, 1), h: Math.max(h0, 1) }; }
    baseViewBox = vb0;
    params = clone(s.params);
    syncUi();
    renderPreview();
    syncUndoBtns();
  }
  function doUndo() {
    if (!loaded) return;
    if (!undoStack.length) { toast(tr('icon_no_more'), 'info'); return; }
    redoStack.push(snapshotState());
    var s = undoStack.pop();
    applyState(s);
  }
  function doRedo() {
    if (!loaded) return;
    if (!redoStack.length) { toast(tr('icon_no_more'), 'info'); return; }
    undoStack.push(snapshotState());
    var s = redoStack.pop();
    applyState(s);
  }
  /* 还原 = 一键回到刚加载文件的状态（开关全关、参数归零），按钮加载后始终亮显 */
  function doReset() {
    if (!loaded) return;
    if (!initialState) return;
    applyState(initialState);
    undoStack = []; redoStack = [];
    syncUndoBtns();
    toast(tr('icon_reset_toast'));
  }
  function syncUndoBtns() {
    if ($id('iconUndo')) $id('iconUndo').disabled = !loaded || !undoStack.length;
    if ($id('iconRedo')) $id('iconRedo').disabled = !loaded || !redoStack.length;
    /* 还原按钮：加载文件后始终亮显、可点击 */
    if ($id('iconReset')) $id('iconReset').disabled = !loaded;
  }

  /* ================= 渲染预览 ================= */
  /* 内边距换算：pct 直接传；px 按目标画布换算为百分比（最终画布留 n px 空白） */
  function padForRender(size) {
    if (params.pdu === 'px') {
      var n = Math.max(0, Math.min(50, params.pdPx || 0));
      var s = Math.max(1, size || 1);
      return Math.min(50, n / s * 100);
    }
    return params.pdPct;
  }
  /* 滑杆填充进度：.slider 轨道填充由 CSS 变量 --p 控制（moteful.css 共享实现），必须按值实时同步 */
  function fillSlider(el) {
    if (!el) return;
    var mn = parseFloat(el.min), mx = parseFloat(el.max);
    var v = parseFloat(el.value);
    var pct = (!isFinite(mn) || !isFinite(mx)) ? 50 : (mx === mn ? 50 : (v - mn) / (mx - mn) * 100);
    el.style.setProperty('--p', pct + '%');
  }
  /* 查看器视图：内容层（图片区域+图标）CSS transform 整体缩放平移，画布窗口固定裁剪 */
  function updateView() {
    var cv = $id('iconPreview');
    if (!cv || cv.hidden) return;
    var z = clampInt(params.zoom, 50, 800, 100);
    var f = z / 100;
    var maxPan = 128 * f;   /* 内容中心最多到画布边缘（内容至少一半可见） */
    pan.x = Math.max(-maxPan, Math.min(maxPan, pan.x));
    pan.y = Math.max(-maxPan, Math.min(maxPan, pan.y));
    cv.style.transformOrigin = 'center center';
    cv.style.transform = 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + f + ')';
  }
  function renderPreview() {
    if (!loaded) {
      $id('iconPreview').hidden = true;
      $id('iconEmpty').hidden = false;
      return;
    }
    var rseq = ++renderSeq;
    var size = 256;
    var cv = $id('iconPreview');
    /* canvas 像素/显示固定 256px；仅在首次或尺寸变化时赋值（赋值会清空画布，避免拖拽/缩放闪烁） */
    if (cv.width !== size) { cv.width = size; cv.height = size; }
    cv.style.width = '256px';
    cv.style.height = '256px';
    var d = parseSvg(buildRenderSvg());
    if (!d) { toast(tr('icon_render_fail'), 'danger'); return; }
    /* 渲染完整内容（图片区域含留白 + 图标），缩放/平移由 updateView 的 CSS transform 承担 */
    var svgStr = new XMLSerializer().serializeToString(d.documentElement);
    window.MotefulIconRender.render(svgStr, size, { padding: 0, bg: renderBg() })
      .then(function (c) {
        if (rseq !== renderSeq) return;   /* 已有更新的渲染请求，丢弃过期结果 */
        var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(c, 0, 0);
        cv.hidden = false;
        $id('iconEmpty').hidden = true;
        updateView();
      })
      .catch(function () { toast(tr('icon_render_fail'), 'danger'); });
  }
  function resetView() {
    pan = { x: 0, y: 0 };
    params.zoom = 100;   /* 复位 = 原图 100% 完整显示（不再强行放大） */
    syncUi();
    if (loaded) updateView();
    scheduleSave();
  }

  /* ================= 导出 ================= */
  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function selectedSizes() {
    var arr = [];
    $$('input[name="iconSize"]:checked').forEach(function (cb) {
      var n = parseInt(cb.value, 10);
      if (isFinite(n) && arr.indexOf(n) < 0) arr.push(n);
    });
    var cs = normalizeCustomSize(params.customSize);
    if (cs && arr.indexOf(cs) < 0) arr.push(cs);
    return arr;
  }
  function normalizeCustomSize(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return 0;
    return Math.max(1, Math.min(1024, n));
  }
  function exportSvg() {
    if (!loaded) return;
    var str = sanitizeForExport(buildRenderSvg());
    downloadBlob(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }), 'icon-' + (selectedSizes()[0] || params.canvas) + '.svg');
    afterExport();
  }
  function exportRaster(fmt, size) {
    return window.MotefulIconRender.render(buildRenderSvg(), size, { padding: padForRender(size), bg: renderBg() })
      .then(function (c) {
        return window.MotefulIconRender.canvasToBlob(c, FMT_MIME[fmt], 0.92);
      })
      .then(function (blob) {
        downloadBlob(blob, 'icon-' + size + '.' + FMT_EXT[fmt]);
      });
  }
  function exportFiles() {
    if (!loaded) return;
    if (params.fmt === 'svg') { exportSvg(); return; }
    var sizes = selectedSizes();
    if (!sizes.length) { toast(tr('icon_pick_size'), 'warning'); return; }
    if (params.fmt === 'jpg' && (params.bg === 't' || params.bg === 'raw')) {
      toast(tr('icon_jpg_alpha'), 'warning'); return;
    }
    var p = Promise.resolve();
    sizes.forEach(function (s) {
      p = p.then(function () { return exportRaster(params.fmt, s); });
    });
    p.then(function () { afterExport(); })
      .catch(function () { toast(tr('icon_export_fail'), 'danger'); });
  }
  function exportZip() {
    if (!loaded) return;
    var sizes = selectedSizes();
    if (!sizes.length) { toast(tr('icon_pick_size'), 'warning'); return; }
    if (params.fmt === 'jpg' && (params.bg === 't' || params.bg === 'raw')) {
      toast(tr('icon_jpg_alpha'), 'warning'); return;
    }
    Promise.all(sizes.map(function (s) {
      return window.MotefulIconRender.render(buildRenderSvg(), s, { padding: padForRender(s), bg: renderBg() })
        .then(function (c) { return window.MotefulIconRender.canvasToBlob(c, 'image/png', 0.92); })
        .then(function (b) { return b.arrayBuffer().then(function (buf) { return { name: 'icon-' + s + '.png', data: new Uint8Array(buf) }; }); });
    })).then(function (files) {
      var zip = window.MotefulZip ? window.MotefulZip.build(files) : null;
      if (!zip) { toast(tr('icon_export_fail'), 'danger'); return; }
      downloadBlob(zip, 'icon-tool-' + sizes.join('-') + '.zip');
      afterExport();
    }).catch(function () { toast(tr('icon_export_fail'), 'danger'); });
  }
  function afterExport() {
    if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
  }
  function previewModal() {
    if (!loaded) return;
    var sizes = selectedSizes();
    var size = sizes.length ? sizes[0] : params.canvas;
    window.MotefulIconRender.render(buildRenderSvg(), size, { padding: padForRender(size), bg: renderBg() })
      .then(function (c) {
        if (window.MotefulCompareCard && window.MotefulCompareCard.preview) {
          window.MotefulCompareCard.preview(c, { title: tr('icon_export_preview') });
        } else {
          exportRaster(params.fmt === 'svg' ? 'png' : params.fmt, size).catch(function () {});
        }
      })
      .catch(function () { toast(tr('icon_render_fail'), 'danger'); });
  }

  /* ================= 复制 ================= */
  function copyText(text, okKey) {
    function done(ok) { toast(ok ? tr(okKey) : tr('icon_copy_fallback'), ok ? 'success' : 'warning'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else { done(false); }
  }
  function copySvg() {
    if (!loaded) return;
    copyText(sanitizeForExport(buildRenderSvg()), 'icon_copied_svg');
  }
  function copyDataURI() {
    if (!loaded) return;
    var size = selectedSizes()[0] || params.canvas;
    window.MotefulIconRender.render(buildRenderSvg(), size, { padding: padForRender(size), bg: renderBg() })
      .then(function (c) {
        copyText(window.MotefulIconRender.canvasToDataURL(c, 'image/png', 0.92), 'icon_copied_datauri');
      })
      .catch(function () { toast(tr('icon_render_fail'), 'danger'); });
  }
  function copyImage() {
    if (!loaded) return;
    if (!(navigator.clipboard && window.ClipboardItem)) {
      toast(tr('icon_copy_img_unsupported'), 'warning'); return;
    }
    var size = selectedSizes()[0] || params.canvas;
    window.MotefulIconRender.render(buildRenderSvg(), size, { padding: padForRender(size), bg: renderBg() })
      .then(function (c) { return window.MotefulIconRender.canvasToBlob(c, 'image/png'); })
      .then(function (b) { return navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); })
      .then(function () { toast(tr('icon_copied_img'), 'success'); })
      .catch(function () { toast(tr('icon_copy_fallback'), 'warning'); });
  }

  /* ================= 配置记忆 ================= */
  function loadMem() {
    try { var s = localStorage.getItem(MEM_KEY); if (s) { var o = JSON.parse(s); if (o && typeof o === 'object') return o; } } catch (e) {}
    return null;
  }
  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(MEM_KEY, JSON.stringify({
          color: params.color, sc: params.sc, sw: params.sw, bg: params.bg,
          cm: params.cm, sm: params.sm,
          pdPct: params.pdPct, pdPx: params.pdPx, pdu: params.pdu, zoom: params.zoom, scale: params.scale, scaleMode: params.scaleMode, canvas: params.canvas,
          fmt: params.fmt, sizes: params.sizes, customSize: params.customSize, sizeMode: params.sizeMode,
          rt: params.rt, fl: params.fl, padOn: params.padOn, rotOn: params.rotOn, flipOn: params.flipOn
        }));
      } catch (e) {}
    }, 400);
  }
  function applyParams(mem, silent) {
    var changed = false;
    if (/^#[0-9A-Fa-f]{6}$/.test(mem.color)) { params.color = mem.color; changed = true; }
    if (/^#[0-9A-Fa-f]{6}$/.test(mem.sc)) { params.sc = mem.sc; changed = true; }
    if (mem.sw >= 1 && mem.sw <= 20) { params.sw = mem.sw; changed = true; }
    if (mem.bg === 't' || mem.bg === 'raw' || /^#[0-9A-Fa-f]{6}$/.test(mem.bg)) { params.bg = mem.bg; changed = true; }
    if (mem.cm === 'raw' || mem.cm === 'custom') { params.cm = mem.cm; changed = true; }
    if (mem.sm === 'none' || mem.sm === 'custom') { params.sm = mem.sm; changed = true; }
    var hasPdNew = (mem.pdPct >= 0 && mem.pdPct <= 50) || (mem.pdPx >= 0 && mem.pdPx <= 50);
    if (mem.pdPct >= 0 && mem.pdPct <= 50) { params.pdPct = mem.pdPct; changed = true; }
    if (mem.pdPx >= 0 && mem.pdPx <= 50) { params.pdPx = mem.pdPx; changed = true; }
    if (!hasPdNew && mem.pd >= 0 && mem.pd <= 50) { params.pdPct = params.pdPx = mem.pd; changed = true; }
    if (typeof mem.padOn === 'boolean') { params.padOn = mem.padOn; changed = true; }
    else if (hasPdNew || (mem.pd >= 0 && mem.pd <= 50)) { params.padOn = true; changed = true; } /* 旧记忆有内边距值 → 迁移开启 */
    if (mem.pdu === 'pct' || mem.pdu === 'px') { params.pdu = mem.pdu; changed = true; }
    if (mem.zoom >= 100 && mem.zoom <= 400) { params.zoom = mem.zoom; changed = true; }
    if (mem.scale >= 25 && mem.scale <= 200) { params.scale = mem.scale; changed = true; }
    if (mem.scaleMode === 'raw' || mem.scaleMode === 'custom') { params.scaleMode = mem.scaleMode; changed = true; }
    if (SIZE_PRESETS.indexOf(mem.canvas) >= 0) { params.canvas = mem.canvas; changed = true; }
    if (['svg', 'png', 'jpg', 'webp'].indexOf(mem.fmt) >= 0) { params.fmt = mem.fmt; changed = true; }
    if (Array.isArray(mem.sizes)) {
      var ok = [];
      mem.sizes.forEach(function (s) { if (SIZE_PRESETS.indexOf(s) >= 0 && ok.indexOf(s) < 0) ok.push(s); });
      if (ok.length) { params.sizes = ok; changed = true; }
    }
    if (typeof mem.customSize === 'string') { params.customSize = mem.customSize; changed = true; }
    if (mem.sizeMode === 'single' || mem.sizeMode === 'multi') { params.sizeMode = mem.sizeMode; changed = true; }
    if (ROT_MAP.indexOf(mem.rt) >= 0) { params.rt = mem.rt; changed = true; }
    if (mem.fl >= 0 && mem.fl <= 3) { params.fl = mem.fl; changed = true; }
    if (typeof mem.rotOn === 'boolean') { params.rotOn = mem.rotOn; changed = true; }
    else if (mem.rt !== 0 && ROT_MAP.indexOf(mem.rt) >= 0) { params.rotOn = true; changed = true; } /* 旧记忆有旋转角度 → 迁移开启 */
    if (typeof mem.flipOn === 'boolean') { params.flipOn = mem.flipOn; changed = true; }
    else if (mem.fl !== 0) { params.flipOn = true; changed = true; } /* 旧记忆有翻转 → 迁移开启 */
    if (changed && !silent) { syncUi(); if (loaded) { pushSnapshot(); renderPreview(); } scheduleSave(); }
    return changed;
  }

  /* ================= 分享带参（F-22） ================= */
  function getShareParams() {
    return {
      c: params.color.replace('#', ''),
      sc: params.sc.replace('#', ''),
      sw: params.sw,
      cm: params.cm, sm: params.sm,
      bg: params.bg === 't' || params.bg === 'raw' ? params.bg : params.bg.replace('#', ''),
      pdPct: params.pdPct, pdPx: params.pdPx, pdu: params.pdu,
      sz: (selectedSizes()[0] || params.canvas),
      fmt: params.fmt,
      rt: params.rt,
      fl: params.fl,
      padOn: params.padOn, rotOn: params.rotOn, flipOn: params.flipOn
    };
  }
  function applyShareParams(p) {
    var changed = false;
    if (/^[0-9A-Fa-f]{6}$/.test(p.c)) { params.color = '#' + p.c; changed = true; }
    if (/^[0-9A-Fa-f]{6}$/.test(p.sc)) { params.sc = '#' + p.sc; changed = true; }
    if (p.sw >= 1 && p.sw <= 20) { params.sw = p.sw; changed = true; }
    if (p.bg === 't' || p.bg === 'raw') { params.bg = p.bg; changed = true; }
    else if (/^[0-9A-Fa-f]{6}$/.test(p.bg)) { params.bg = '#' + p.bg; changed = true; }
    if (p.cm === 'raw' || p.cm === 'custom') { params.cm = p.cm; changed = true; }
    if (p.sm === 'none' || p.sm === 'custom') { params.sm = p.sm; changed = true; }
    var hasPdNew = (p.pdPct >= 0 && p.pdPct <= 50) || (p.pdPx >= 0 && p.pdPx <= 50);
    if (p.pdPct >= 0 && p.pdPct <= 50) { params.pdPct = p.pdPct; changed = true; }
    if (p.pdPx >= 0 && p.pdPx <= 50) { params.pdPx = p.pdPx; changed = true; }
    if (!hasPdNew && p.pd >= 0 && p.pd <= 50) { params.pdPct = params.pdPx = p.pd; changed = true; }
    if (typeof p.padOn === 'boolean') { params.padOn = p.padOn; changed = true; }
    else if (hasPdNew || (p.pd >= 0 && p.pd <= 50)) { params.padOn = true; changed = true; } /* 旧分享有内边距值 → 迁移开启 */
    if (p.pdu === 'pct' || p.pdu === 'px') { params.pdu = p.pdu; changed = true; }
    var szN = parseInt(p.sz, 10);
    if (!isNaN(szN) && SIZE_PRESETS.indexOf(szN) >= 0) { params.sizes = [szN]; params.canvas = szN; changed = true; }
    if (['svg', 'png', 'jpg', 'webp'].indexOf(p.fmt) >= 0) { params.fmt = p.fmt; changed = true; }
    if (ROT_MAP.indexOf(p.rt) >= 0) { params.rt = p.rt; changed = true; }
    if (p.fl >= 0 && p.fl <= 3) { params.fl = p.fl; changed = true; }
    if (typeof p.rotOn === 'boolean') { params.rotOn = p.rotOn; changed = true; }
    else if (p.rt !== 0 && ROT_MAP.indexOf(p.rt) >= 0) { params.rotOn = true; changed = true; } /* 旧分享有旋转角度 → 迁移开启 */
    if (typeof p.flipOn === 'boolean') { params.flipOn = p.flipOn; changed = true; }
    else if (p.fl !== 0) { params.flipOn = true; changed = true; } /* 旧分享有翻转 → 迁移开启 */
    if (changed) {
      syncUi();
      if (loaded) { pushSnapshot(); renderPreview(); }
      scheduleSave();
    }
  }
  if (window.MotefulShare && window.MotefulShare.register) {
    window.MotefulShare.register('icon-tool', {
      getParams: getShareParams,
      shareText: function () { return tr('icon_share_text'); }
    });
  }
  /* 导出到全局：share.js APPLY['icon-tool'] 委托套用（含 rt/fl 等无控件参数） */
  window.MotefulIconTool = {
    applyShareParams: applyShareParams,
    getShareParams: getShareParams
  };

  /* ================= UI 同步 ================= */
  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function syncUi() {
    if ($id('iconColorChip')) $id('iconColorChip').style.background = params.color;
    if ($id('iconColorHex')) $id('iconColorHex').value = params.color;
    if ($id('iconStrokeColorChip')) $id('iconStrokeColorChip').style.background = params.sc;
    if ($id('iconStrokeColorHex')) $id('iconStrokeColorHex').value = params.sc;
    if ($id('iconStrokeWidth')) $id('iconStrokeWidth').value = params.sw;
    if ($id('iconStrokeWidthOut')) $id('iconStrokeWidthOut').value = String(params.sw);
    if ($id('iconScale')) $id('iconScale').value = params.scale;
    if ($id('iconScaleOut')) $id('iconScaleOut').value = String(params.scale);
    var pdCur = params.pdu === 'px' ? params.pdPx : params.pdPct;
    if ($id('iconPadding')) $id('iconPadding').value = pdCur;
    if ($id('iconPaddingOut')) $id('iconPaddingOut').value = String(pdCur);
    if ($id('iconZoomRange')) $id('iconZoomRange').value = params.zoom;
    if ($id('iconZoomOut')) $id('iconZoomOut').textContent = params.zoom + '%';
    ['iconScale', 'iconStrokeWidth', 'iconPadding', 'iconZoomRange'].forEach(function (id) { fillSlider($id(id)); });
    $$('input[name="iconPadU"]').forEach(function (r) { r.checked = r.value === params.pdu; });
    $$('input[name="iconBg"]').forEach(function (r) {
      r.checked = r.value === (params.bg === 't' ? 't' : params.bg === 'raw' ? 'raw' : 'custom');
    });
    var bgIsRaw = params.bg === 'raw';
    if ($id('iconBgColorWrap')) $id('iconBgColorWrap').hidden = (params.bg === 't' || params.bg === 'raw');
    var bgChecker = 'repeating-conic-gradient(var(--border) 0 25%, var(--code-bg) 0 50%) 0 0/10px 10px';
    if ($id('iconBgColorChip')) $id('iconBgColorChip').style.background = (params.bg === 't' || params.bg === 'raw') ? bgChecker : params.bg;
    if ($id('iconBgColorHex')) $id('iconBgColorHex').value = params.bg === 't' ? tr('icon_bg_none') : (params.bg === 'raw' ? tr('icon_bg_raw') : params.bg);
    $$('input[name="iconFmt"]').forEach(function (r) { r.checked = r.value === params.fmt; });
    $$('input[name="iconSize"]').forEach(function (cb) {
      cb.checked = params.sizes.indexOf(parseInt(cb.value, 10)) >= 0;
    });
    if ($id('iconSizeMulti')) $id('iconSizeMulti').checked = params.sizeMode === 'multi';
    /* 多选模式：单张导出禁用（只能打包 ZIP；未导入时本就禁用） */
    if ($id('iconExport')) $id('iconExport').disabled = !loaded || params.sizeMode === 'multi';
    $$('input[name="iconRot"]').forEach(function (r) { r.checked = String(params.rt % 360) === r.value; });
    if ($id('iconFlipH')) $id('iconFlipH').checked = !!(params.fl & 1);
    if ($id('iconFlipV')) $id('iconFlipV').checked = !!(params.fl & 2);
    if ($id('iconCustomSize')) $id('iconCustomSize').value = params.customSize || '';
    /* 编辑区开关：checked 同步（关=原图/无功能状态；开=启用自定义） */
    if ($id('iconScaleSw')) $id('iconScaleSw').checked = params.scaleMode === 'custom';
    if ($id('iconColorSw')) $id('iconColorSw').checked = params.cm === 'custom';
    if ($id('iconBgSw')) $id('iconBgSw').checked = params.bg !== 'raw';
    if ($id('iconStrokeSw')) $id('iconStrokeSw').checked = params.sm === 'custom';
    if ($id('iconPadSw')) $id('iconPadSw').checked = !!params.padOn;
    if ($id('iconRotSw')) $id('iconRotSw').checked = !!params.rotOn;
    if ($id('iconFlipSw')) $id('iconFlipSw').checked = !!params.flipOn;
    var scaleOn = params.scaleMode === 'custom';
    var colorOn = params.cm === 'custom';
    var bgOn = params.bg !== 'raw';
    var strokeOn = params.sm === 'custom';
    /* 自定义组件区显隐：开关开才显示（原图/无描边等关闭态隐藏，防原图被强行加入参数） */
    if ($id('iconColorPickRow')) $id('iconColorPickRow').hidden = !colorOn;
    if ($id('iconStrokePickRow')) $id('iconStrokePickRow').hidden = !strokeOn;
    if ($id('iconScaleRow')) $id('iconScaleRow').hidden = !scaleOn;
    if ($id('iconBgBody')) $id('iconBgBody').hidden = !bgOn;
    if ($id('iconStrokeWidthField')) $id('iconStrokeWidthField').hidden = !strokeOn;
    if ($id('iconPadBody')) $id('iconPadBody').hidden = !params.padOn;
    if ($id('iconRotBody')) $id('iconRotBody').hidden = !params.rotOn;
    if ($id('iconFlipBody')) $id('iconFlipBody').hidden = !params.flipOn;
    if (!scaleOn && $id('iconScale')) { params.scale = 100; if ($id('iconScaleOut')) $id('iconScaleOut').value = '100'; }
    if ($id('iconColorChip')) $id('iconColorChip').closest('button').disabled = !colorOn;
    if ($id('iconColorHex')) $id('iconColorHex').disabled = !colorOn;
    if ($id('iconStrokeColorChip')) $id('iconStrokeColorChip').closest('button').disabled = !strokeOn;
    if ($id('iconStrokeColorHex')) $id('iconStrokeColorHex').disabled = !strokeOn;
    if ($id('iconStrokeWidth')) $id('iconStrokeWidth').disabled = !strokeOn;
    if ($id('iconStrokeWidthOut')) {
      $id('iconStrokeWidthOut').disabled = !strokeOn;
      var swStep = $id('iconStrokeWidthOut').closest('.step');
      if (swStep) $$('.step-btn', swStep).forEach(function (b) { b.disabled = !strokeOn; });
    }
    if ($id('iconBgColorChip')) $id('iconBgColorChip').closest('button').disabled = !bgOn;
    if ($id('iconBgColorHex')) $id('iconBgColorHex').disabled = !bgOn;
    syncUndoBtns();
  }
  function enableUi() {
    $$('[data-icon-enable]').forEach(function (el) { el.disabled = false; });
  }
  function disableUi() {
    $$('[data-icon-enable]').forEach(function (el) { el.disabled = true; });
    if ($id('iconUndo')) $id('iconUndo').disabled = true;
    if ($id('iconRedo')) $id('iconRedo').disabled = true;
    if ($id('iconReset')) $id('iconReset').disabled = true;
  }
  /* 已导入态画廊（复用共享层 .dz-gallery/.dz-thumb，与 image-tool 同构）：缩略图 + 计数 */
  function showGallery(name) {
    var dz = $id('iconDropzone');
    if (dz) dz.classList.add('mini');
    if ($id('iconDzEmpty')) $id('iconDzEmpty').hidden = true;
    if ($id('iconDzGallery')) $id('iconDzGallery').hidden = false;
    var list = $id('iconDzList');
    if (!list) return;
    list.innerHTML = '';
    var thumb = document.createElement('div');
    thumb.className = 'dz-thumb';
    thumb.title = name;
    var img = document.createElement('img');
    img.alt = name;
    thumb.appendChild(img);
    list.appendChild(thumb);
    window.MotefulIconRender.render(buildRenderSvg(), 96, { padding: 0, bg: 't' })
      .then(function (c) { img.src = c.toDataURL('image/png'); })
      .catch(function () { /* 缩略图失败不阻塞主流程 */ });
    var r = svgDoc ? svgDoc.documentElement : null;
    var vb = r ? parseViewBox(r.getAttribute('viewBox')) : null;
    var w = vb ? vb.w : (r ? (parseFloat(r.getAttribute('width')) || 0) : 0);
    var h = vb ? vb.h : (r ? (parseFloat(r.getAttribute('height')) || 0) : 0);
    if ($id('iconDzCount')) $id('iconDzCount').textContent = name + ' · ' + Math.round(w) + '×' + Math.round(h) + ' px';
  }
  function resetIcon() {
    loaded = false;
    svgDoc = null;
    undoStack = []; redoStack = [];
    if ($id('iconPreview')) $id('iconPreview').hidden = true;
    if ($id('iconEmpty')) $id('iconEmpty').hidden = false;
    var dz = $id('iconDropzone');
    if (dz) dz.classList.remove('mini');
    if ($id('iconDzEmpty')) $id('iconDzEmpty').hidden = false;
    if ($id('iconDzGallery')) $id('iconDzGallery').hidden = true;
    if ($id('iconDzList')) $id('iconDzList').innerHTML = '';
    disableUi();
  }

  /* ================= 事件绑定 ================= */
  function bindEvents() {
    // ---- 导入方式切换 ----
    $$('input[name="iconImport"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var code = r.value === 'code';
        $id('iconDropzone').hidden = code;
        $id('iconCodeWrap').hidden = !code;
        if ($id('iconParseRow')) $id('iconParseRow').hidden = !code;
        if (code) $id('iconCode').focus();
      });
    });
    // ---- 拖放 / 点选 ----
    var dz = $id('iconDropzone');
    dz.addEventListener('click', function () { $id('iconFile').click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $id('iconFile').click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      e.stopPropagation();   // 阻止冒泡到 document 全页处理，防双导
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) { loadFromFile(files[0]); return; }
      var txt = e.dataTransfer && e.dataTransfer.getData('text');
      if (txt && /^\s*<svg/i.test(txt)) loadFromString(txt);
    });
    // 全页拖放：拖到页面任意位置均可导入，不再限定上传虚线框（对齐 image-tool V0.2.10）
    function dtHasFiles(e) {
      try { return Array.prototype.indexOf.call((e.dataTransfer && e.dataTransfer.types) || [], 'Files') >= 0; }
      catch (err) { return false; }
    }
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (!dtHasFiles(e)) return;
        e.preventDefault();
        if (dz && !dz.hidden) dz.classList.add('dragover');
      }, false);
    });
    document.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        if (dz) dz.classList.remove('dragover');
      }
    }, false);
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (dz) dz.classList.remove('dragover');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) { loadFromFile(dt.files[0]); return; }
      var txt = e.dataTransfer && e.dataTransfer.getData('text');
      if (txt && /^\s*<svg/i.test(txt)) loadFromString(txt);
    }, false);
    $id('iconFile').addEventListener('change', function (e) {
      loadFromFile(e.target.files[0]);
      this.value = '';
    });
    if ($id('iconDzReset')) $id('iconDzReset').addEventListener('click', function () {
      resetIcon();
      toast(tr('icon_reset_done'), 'info');
    });
    $id('iconParse').addEventListener('click', function () {
      var t = $id('iconCode').value;
      if (t && t.trim()) loadFromString(t);
      else toast(tr('icon_invalid'), 'warning');
    });

    // ---- 编辑：颜色（色板面板 + 行内 hex 直输双向联动） ----
    function bindHexInput(id, key, apply) {
      var el = $id(id);
      if (!el) return;
      el.addEventListener('change', function () {
        var v = this.value.trim();
        if (!/^#[0-9A-Fa-f]{6}$/.test(v)) { toast(tr('icon_bad_color'), 'warning'); this.value = params[key]; return; }
        pushSnapshot(); /* 先推变更前快照，再改参数（保证撤销/重做可回退） */
        params[key] = v;
        syncUi();
        if (key === 'color' && $id('iconColorChip')) $id('iconColorChip').style.background = v;
        if (key === 'sc' && $id('iconStrokeColorChip')) $id('iconStrokeColorChip').style.background = v;
        if (key === 'bg' && $id('iconBgColorChip')) $id('iconBgColorChip').style.background = v;
        if (loaded) { if (apply) apply(v); renderPreview(); }
        scheduleSave();
      });
    }
    bindHexInput('iconColorHex', 'color', setFill);
    bindHexInput('iconStrokeColorHex', 'sc', setStrokeColor);
    bindHexInput('iconBgColorHex', 'bg', null);
    $id('iconStrokeWidth').addEventListener('input', function () {
      var n = clampInt(this.value, 1, 20, 2);
      if (n !== params.sw && !this.dataset.u) { pushSnapshot(); this.dataset.u = '1'; } /* 首次变化推旧值快照 */
      params.sw = n;
      fillSlider(this);
      if ($id('iconStrokeWidthOut')) $id('iconStrokeWidthOut').value = String(params.sw);
      if (loaded) { setStrokeWidth(params.sw); renderPreview(); }
    });
    $id('iconStrokeWidth').addEventListener('change', function () { delete this.dataset.u; scheduleSave(); });
    /* 描边粗细还原按钮：恢复默认值 2（图标按钮，对齐 imagetool 步进器还原范式） */
    if ($id('iconStrokeReset')) $id('iconStrokeReset').addEventListener('click', function () {
      pushSnapshot(); /* 先推变更前快照 */
      params.sw = 2;
      if ($id('iconStrokeWidth')) { $id('iconStrokeWidth').value = 2; fillSlider($id('iconStrokeWidth')); }
      if ($id('iconStrokeWidthOut')) $id('iconStrokeWidthOut').value = '2';
      if (loaded) { setStrokeWidth(2); renderPreview(); }
      scheduleSave();
      toast(tr('icon_stroke_reset_toast'));
    });

    // ---- 编辑：7 项功能开关（关=原图/无功能状态；开=启用自定义组件） ----
    ['iconScaleSw', 'iconColorSw', 'iconBgSw', 'iconStrokeSw', 'iconPadSw', 'iconRotSw', 'iconFlipSw'].forEach(function (id) {
      var sw = $id(id);
      if (!sw) return;
      sw.addEventListener('change', function () {
        pushSnapshot(); /* 先推变更前快照，再切换参数 */
        switch (id) {
          case 'iconScaleSw': params.scaleMode = this.checked ? 'custom' : 'raw'; break;
          case 'iconColorSw': params.cm = this.checked ? 'custom' : 'raw'; break;
          case 'iconBgSw': params.bg = this.checked ? (params.bg === 'raw' ? 't' : params.bg) : 'raw'; break;
          case 'iconStrokeSw': params.sm = this.checked ? 'custom' : 'none'; break;
          case 'iconPadSw': params.padOn = this.checked; break;
          case 'iconRotSw': params.rotOn = this.checked; break;
          case 'iconFlipSw': params.flipOn = this.checked; break;
        }
        syncUi();
        if (loaded) { applyViewBox(); applyTransform(); renderPreview(); }
        scheduleSave();
      });
    });
    $id('iconScale').addEventListener('input', function () {
      var n = clampInt(this.value, 25, 200, 100);
      if (n !== params.scale && !this.dataset.u) { pushSnapshot(); this.dataset.u = '1'; } /* 首次变化推旧值快照 */
      params.scale = n;
      fillSlider(this);
      if ($id('iconScaleOut')) $id('iconScaleOut').value = String(params.scale);
      if (loaded) { applyTransform(); renderPreview(); }
    });
    $id('iconScale').addEventListener('change', function () { delete this.dataset.u; scheduleSave(); });

    // ---- 编辑：背景色 ----
    $$('input[name="iconBg"]').forEach(function (r) {
      r.addEventListener('change', function () {
        pushSnapshot(); /* 先推变更前快照 */
        if (r.value === 'custom') {
          if ($id('iconBgColorWrap')) $id('iconBgColorWrap').hidden = false;
          params.bg = (params.bg && params.bg !== 't' && params.bg !== 'raw') ? params.bg : '#FFFFFF';
          syncUi();
        } else {
          if ($id('iconBgColorWrap')) $id('iconBgColorWrap').hidden = true;
          params.bg = r.value; /* 'raw' 或 't' */
          syncUi();
        }
        if (loaded) renderPreview();
        scheduleSave();
      });
    });
    // （图标颜色 / 描边模式：由开关 iconColorSw / iconStrokeSw 控制，分段按钮已移除）
    // （背景色由共享色板组件统一处理）

    // ---- 编辑：内边距 ----
    $id('iconPadding').addEventListener('input', function () {
      var n = clampInt(this.value, 0, 50, 10);
      var cur = params.pdu === 'px' ? params.pdPx : params.pdPct;
      if (n !== cur && !this.dataset.u) { pushSnapshot(); this.dataset.u = '1'; } /* 首次变化推旧值快照 */
      if (params.pdu === 'px') { params.pdPx = n; } else { params.pdPct = n; }
      fillSlider(this);
      if ($id('iconPaddingOut')) $id('iconPaddingOut').value = String(n);
      if (loaded) { applyViewBox(); renderPreview(); }
    });
    $id('iconPadding').addEventListener('change', function () { delete this.dataset.u; scheduleSave(); });
    $$('input[name="iconPadU"]').forEach(function (r) {
      r.addEventListener('change', function () {
        pushSnapshot(); /* 先推变更前快照 */
        params.pdu = r.value;
        syncUi();
        if (loaded) { applyViewBox(); renderPreview(); }
        scheduleSave();
      });
    });

    // ---- 编辑：旋转（segment 单选，对齐 image-tool） ----
    $$('input[name="iconRot"]').forEach(function (r) {
      r.addEventListener('change', function () {
        pushSnapshot(); /* 先推变更前快照 */
        params.rt = parseInt(r.value, 10) % 360;
        applyTransform(); renderPreview(); scheduleSave();
      });
    });
    // ---- 编辑：翻转（segment 多选，对齐 image-tool） ----
    if ($id('iconFlipH')) $id('iconFlipH').addEventListener('change', function () {
      pushSnapshot(); /* 先推变更前快照 */
      params.fl = (this.checked ? 1 : 0) | (($id('iconFlipV') && $id('iconFlipV').checked) ? 2 : 0);
      applyTransform(); renderPreview(); scheduleSave();
    });
    if ($id('iconFlipV')) $id('iconFlipV').addEventListener('change', function () {
      pushSnapshot(); /* 先推变更前快照 */
      params.fl = (($id('iconFlipH') && $id('iconFlipH').checked) ? 1 : 0) | (this.checked ? 2 : 0);
      applyTransform(); renderPreview(); scheduleSave();
    });

    // ---- 撤销 / 重做 / 还原 ----
    $id('iconUndo').addEventListener('click', doUndo);
    $id('iconRedo').addEventListener('click', doRedo);
    if ($id('iconReset')) $id('iconReset').addEventListener('click', doReset);
    /* 撤销快捷键 Ctrl+Z：输入控件（文本编辑）聚焦时不拦截，保留浏览器原生文本撤销 */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      var k = String(e.key).toLowerCase();
      if (k !== 'z') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      doUndo();
    });

    // ---- 滑块步进器（.step 组件，对齐 image-tool quality 形态）----
    ['iconScale','iconStrokeWidth','iconPadding'].forEach(function (id) {
      var sl = $id(id);
      if (!sl) return;
      // .step 与 slider 是兄弟（同属 .row），用输出元素定位 .step（slider.closest('.step') 为 null 曾致绑定跳过）
      var outEl = $id(id + 'Out');
      var step = outEl ? outEl.closest('.step') : null;
      if (!step) return;
      $$('.step-btn', step).forEach(function (b) {
        // stopImmediatePropagation：彻底拦截 moteful.js 全局 .step 委托（其把带 % 数值解析为 NaN 并覆盖文本）
        // 直接更新 slider 值 / params / 文本 / 渲染 / 快照，不依赖事件派生的 input 监听，保证与 moteful.js 无竞态
        b.addEventListener('click', function (e) {
          e.stopImmediatePropagation();
          var st = parseInt(b.getAttribute('data-step'), 10) || 0;
          var cur = parseInt(sl.value, 10);
          if (!isFinite(cur)) cur = parseInt(sl.getAttribute('value'), 10) || 0;
          var n = clampInt(cur + st, parseInt(sl.min, 10), parseInt(sl.max, 10), 0);
          pushSnapshot(); /* 先推变更前快照，再改参数 */
          sl.value = n;
          fillSlider(sl);
          var out = outEl || null;
          if (id === 'iconScale') { params.scale = n; if (out) out.value = String(n); }
          else if (id === 'iconStrokeWidth') { params.sw = n; if (out) out.value = String(n); }
          else if (id === 'iconPadding') { if (params.pdu === 'px') { params.pdPx = n; } else { params.pdPct = n; } if (out) out.value = String(n); }
          if (loaded) { applyViewBox(); renderPreview(); }
          scheduleSave();
        }, true);
      });
      /* 步进器文本框：用户手输数字（对齐 image-tool .step-val input 编辑行为） */
      if (outEl && outEl.tagName === 'INPUT') {
        outEl.addEventListener('change', function () {
          var v = parseInt(this.value, 10);
          if (!isFinite(v)) { this.value = String(sl.value); return; }
          var n = clampInt(v, parseInt(sl.min, 10), parseInt(sl.max, 10), 0);
          if (n !== v) this.value = String(n);
          pushSnapshot(); /* 先推变更前快照，再改参数 */
          sl.value = n;
          fillSlider(sl);
          if (id === 'iconScale') { params.scale = n; }
          else if (id === 'iconStrokeWidth') { params.sw = n; }
          else if (id === 'iconPadding') { if (params.pdu === 'px') { params.pdPx = n; } else { params.pdPct = n; } }
          syncUi();
          if (loaded) { applyViewBox(); renderPreview(); }
          scheduleSave();
        });
      }
    });
    // ---- 导出：格式 ----
    $$('input[name="iconFmt"]').forEach(function (r) {
      r.addEventListener('change', function () {
        params.fmt = r.value;
        scheduleSave();
      });
    });

    // ---- 导出：尺寸（单选=互斥，多选=自由勾选；复选框由 JS 管理互斥） ----
    $$('input[name="iconSize"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var n = parseInt(cb.value, 10);
        if (!isFinite(n)) return;
        if (params.sizeMode === 'multi') {
          /* 多选：收集全部勾选尺寸 */
          params.sizes = [];
          $$('input[name="iconSize"]:checked').forEach(function (c) {
            var v = parseInt(c.value, 10);
            if (isFinite(v) && params.sizes.indexOf(v) < 0) params.sizes.push(v);
          });
          params.sizes.sort(function (a, b) { return a - b; });
        } else {
          /* 单选：互斥（仅保留当前），并清空自定义（自定义与预设互斥） */
          params.sizes = [n];
          $$('input[name="iconSize"]').forEach(function (c) { c.checked = (c === cb); });
          if ($id('iconCustomSize')) $id('iconCustomSize').value = '';
          params.customSize = '';
        }
        scheduleSave();
      });
    });
    if ($id('iconCustomSize')) $id('iconCustomSize').addEventListener('change', function () {
      var v = this.value.trim();
      if (!v) { params.customSize = ''; scheduleSave(); return; }
      var n = clampInt(v, 1, 1024, 0);
      if (n < 1 || n > 1024) { toast(tr('icon_size_range'), 'warning'); this.value = ''; params.customSize = ''; scheduleSave(); return; }
      params.customSize = String(n);
      if (parseInt(v, 10) !== n) this.value = String(n);
      /* 单选模式：输入自定义后预设尺寸全部取消（预设不激活） */
      if (params.sizeMode === 'single') {
        params.sizes = [];
        $$('input[name="iconSize"]').forEach(function (c) { c.checked = false; });
      }
      scheduleSave();
    });
    if ($id('iconSizeMulti')) $id('iconSizeMulti').addEventListener('change', function () {
      params.sizeMode = this.checked ? 'multi' : 'single';
      if (params.sizeMode === 'single') {
        /* 切回单选：只保留第一个勾选尺寸，并清空自定义（单选下自定义与预设互斥） */
        var first = null;
        $$('input[name="iconSize"]:checked').forEach(function (c) { if (!first) first = c; else c.checked = false; });
        if (first) {
          params.sizes = [parseInt(first.value, 10)];
          if ($id('iconCustomSize')) $id('iconCustomSize').value = '';
          params.customSize = '';
        } else {
          params.sizes = [];
        }
      } else {
        /* 切到多选：收集全部勾选尺寸（含自定义，selectedSizes 会追加） */
        params.sizes = [];
        $$('input[name="iconSize"]:checked').forEach(function (c) {
          var v = parseInt(c.value, 10);
          if (isFinite(v)) params.sizes.push(v);
        });
      }
      syncUi();
      scheduleSave();
    });

    // ---- 预览放大滑杆（纯展示，不影响导出尺寸；CSS transform 缩放内容层，画布窗口固定） ----
    if ($id('iconZoomRange')) {
      $id('iconZoomRange').addEventListener('input', function () {
        params.zoom = clampInt(this.value, 50, 800, 200);
        fillSlider(this);
        if ($id('iconZoomOut')) $id('iconZoomOut').textContent = params.zoom + '%';
        if (loaded) updateView();
      });
      $id('iconZoomRange').addEventListener('change', function () { scheduleSave(); });
    }

    // ---- 预览查看器：直接鼠标拖动平移 + 滚轮缩放 + 双击复位（均只改 CSS transform，不重渲染画布） ----
    var box = $id('iconPreviewBox');
    if (box) {
      var wheelTimer = null;
      box.addEventListener('wheel', function (e) {
        if (!loaded) return;
        e.preventDefault();
        var old = params.zoom;
        var next = Math.round(old * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
        next = Math.round(next / 10) * 10;   /* 对齐滑杆步进（10 的倍数，保证小缩放可见） */
        next = Math.max(50, Math.min(800, next));
        if (next === old) return;
        params.zoom = next;
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(function () { scheduleSave(); }, 300);
        var el = $id('iconZoomRange');
        if (el) { el.value = next; fillSlider(el); }
        if ($id('iconZoomOut')) $id('iconZoomOut').textContent = next + '%';
        updateView();
      }, { passive: false });
      box.addEventListener('dblclick', function () {
        if (loaded) resetView();
      });
      box.addEventListener('mousedown', function (e) {
        if (!loaded || e.button !== 0) return;
        /* 阻止默认：防止文本选中/激活其他区域组件（页面滚动、拖选等） */
        e.preventDefault();
        box.classList.add('drag-active');
        dragView = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragView) return;
        var maxPan = 128 * (params.zoom / 100);   /* 内容中心最多到画布边缘（随缩放动态） */
        pan.x = Math.max(-maxPan, Math.min(maxPan, dragView.ox + (e.clientX - dragView.sx)));
        pan.y = Math.max(-maxPan, Math.min(maxPan, dragView.oy + (e.clientY - dragView.sy)));
        updateView();
      });
      window.addEventListener('mouseup', function () {
        if (!dragView) return;
        dragView = null;
        box.classList.remove('drag-active');
        scheduleSave();
      });
    }

    // ---- 导出：按钮 ----
    $id('iconPreviewBtn').addEventListener('click', previewModal);
    $id('iconExport').addEventListener('click', exportFiles);
    if ($id('iconZip')) $id('iconZip').addEventListener('click', exportZip);

    // ---- 复制 ----
    if ($id('iconCopySvg')) $id('iconCopySvg').addEventListener('click', copySvg);
    if ($id('iconCopyDatauri')) $id('iconCopyDatauri').addEventListener('click', copyDataURI);
    if ($id('iconCopyImg')) $id('iconCopyImg').addEventListener('click', copyImage);
  }

  /* ================= 色板组件（HSV 取色，共享面板服务三个颜色字段） ================= */
  var CP_PRESETS = ['#FF6B6B', '#F9A826', '#FDCB6E', '#00B894', '#0984E3', '#6C5CE7', '#E17055', '#B2BEC3', '#2D3436', '#00CEC9', '#E84393', '#74B9FF', '#55EFC4', '#FFEAA7', '#D63031', '#FFFFFF'];
  var cpState = { target: null, h: 30, s: 100, v: 100 };
  function hsvToRgb(h, s, v) {
    s /= 100; v /= 100;
    var k = function (n) { return (n + h / 60) % 6; };
    var f = function (n) { return v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1)); };
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (x) { return x.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  function hexToRgb(hex) {
    var m = String(hex).replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(m)) return null;
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, hh = 0;
    if (d) {
      if (max === r) hh = ((g - b) / d) % 6;
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60;
      if (hh < 0) hh += 360;
    }
    return [hh, max ? d / max * 100 : 0, max * 100];
  }
  function cpCurrentHex() {
    var rgb = hsvToRgb(cpState.h, cpState.s, cpState.v);
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }
  function cpGetHex() {
    if (cpState.target === 'iconBgColor') return params.bg !== 't' ? params.bg : '#FFFFFF';
    if (cpState.target === 'iconStrokeColor') return params.sc;
    return params.color;
  }
  function cpRender() {
    var base = hsvToRgb(cpState.h, 100, 100);
    var sv = $id('iconCpSv');
    if (sv) sv.style.background = 'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,rgb(' + base.join(',') + '))';
    var c1 = $id('iconCpCursor');
    if (c1) { c1.style.left = cpState.s + '%'; c1.style.top = (100 - cpState.v) + '%'; }
    var c2 = $id('iconCpHueCursor');
    if (c2) c2.style.left = (cpState.h / 360 * 100) + '%';
    var hex = cpCurrentHex();
    var prev = $id('iconCpPrev');
    if (prev) prev.style.background = hex;
    var inp = $id('iconCpHex');
    if (inp) inp.value = hex;
    $$('#iconCpPal button').forEach(function (b) { b.classList.toggle('on', b.dataset.c === hex); });
  }
  function cpCommit(hex, withUndo) {
    var v = String(hex).toUpperCase();
    if (cpState.target === 'iconBgColor') {
      params.bg = v;
      if ($id('iconBgColorChip')) $id('iconBgColorChip').style.background = v;
      if ($id('iconBgColorHex')) $id('iconBgColorHex').value = v;
      if (loaded) renderPreview();
    } else if (cpState.target === 'iconStrokeColor') {
      params.sc = v;
      if ($id('iconStrokeColorChip')) $id('iconStrokeColorChip').style.background = v;
      if ($id('iconStrokeColorHex')) $id('iconStrokeColorHex').value = v;
      if (loaded) { setStrokeColor(v); renderPreview(); }
    } else {
      params.color = v;
      if ($id('iconColorChip')) $id('iconColorChip').style.background = v;
      if ($id('iconColorHex')) $id('iconColorHex').value = v;
      if (loaded) { setFill(v); renderPreview(); }
    }
    if (withUndo) pushSnapshot();
    scheduleSave();
  }
  function cpOpen(target) {
    if (target === 'iconBgColor' && params.bg === 't') return;
    cpState.target = target;
    var rgb = hexToRgb(cpGetHex());
    if (rgb) {
      var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      cpState.h = hsv[0]; cpState.s = hsv[1]; cpState.v = hsv[2];
    }
    var pop = $id('iconCpPop');
    var trig = document.querySelector('.icon-cp-trig[data-cp-for="' + target + '"]');
    if (!pop || !trig) return;
    pop.hidden = false;
    cpRender();
    var r = trig.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function cpClose() {
    var pop = $id('iconCpPop');
    if (pop) pop.hidden = true;
  }
  function initColorPicker() {
    var pop = $id('iconCpPop');
    if (!pop) return;
    // 触发行
    $$('.icon-cp-trig').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (b.disabled) return;
        var t = b.getAttribute('data-cp-for');
        if (!pop.hidden && cpState.target === t) { cpClose(); return; }
        cpOpen(t);
      });
    });
    // 拖拽（色相条 / SV 色域）
    function cpDrag(el, cb) {
      if (!el) return;
      var move = function (e) {
        var rect = el.getBoundingClientRect();
        var p = e.touches ? e.touches[0] : e;
        var x = Math.min(Math.max((p.clientX - rect.left) / rect.width, 0), 1);
        var y = Math.min(Math.max((p.clientY - rect.top) / rect.height, 0), 1);
        cb(x, y);
      };
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
        move(e);
        var onMove = function (ev) { move(ev); };
        var onUp = function () {
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          pushSnapshot();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      });
    }
    cpDrag($id('iconCpHue'), function (x) { cpState.h = x * 360; cpRender(); cpCommit(cpCurrentHex(), false); });
    cpDrag($id('iconCpSv'), function (x, y) { cpState.s = x * 100; cpState.v = (1 - y) * 100; cpRender(); cpCommit(cpCurrentHex(), false); });
    // hex 直输
    var hexIn = $id('iconCpHex');
    if (hexIn) hexIn.addEventListener('change', function () {
      var v = this.value.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(v)) { toast(tr('icon_bad_color'), 'warning'); this.value = cpCurrentHex(); return; }
      var rgb = hexToRgb(v);
      var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      cpState.h = hsv[0]; cpState.s = hsv[1]; cpState.v = hsv[2];
      cpRender();
      cpCommit(v, true);
    });
    // 预设色板
    var pal = $id('iconCpPal');
    if (pal) {
      CP_PRESETS.forEach(function (col) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.c = col;
        b.style.background = col;
        b.title = col;
        b.addEventListener('click', function () {
          var rgb = hexToRgb(col);
          var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
          cpState.h = hsv[0]; cpState.s = hsv[1]; cpState.v = hsv[2];
          cpRender();
          cpCommit(col, true);
        });
        pal.appendChild(b);
      });
    }
    // 屏幕取色：EyeDropper 优先，回退原生 color
    var eye = $id('iconCpEye');
    if (eye) eye.addEventListener('click', function () {
      if (window.EyeDropper) {
        try {
          new EyeDropper().open().then(function (res) {
            if (res && res.sRGBHex) {
              var v = res.sRGBHex.toUpperCase();
              var rgb = hexToRgb(v);
              var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
              cpState.h = hsv[0]; cpState.s = hsv[1]; cpState.v = hsv[2];
              cpRender();
              cpCommit(v, true);
            }
          });
        } catch (err) { }
      } else {
        var n = $id('iconCpNative');
        if (n) n.click();
      }
    });
    var nativ = $id('iconCpNative');
    if (nativ) nativ.addEventListener('input', function () {
      var v = this.value.toUpperCase();
      var rgb = hexToRgb(v);
      var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      cpState.h = hsv[0]; cpState.s = hsv[1]; cpState.v = hsv[2];
      cpRender();
      cpCommit(v, true);
    });
    // 外部点击 / Esc 关闭
    document.addEventListener('click', function (e) {
      if (pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.icon-cp-trig')) return;
      cpClose();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cpClose(); });
  }

  /* ================= 初始化 ================= */
  function init() {
    bindEvents();
    initColorPicker();
    var mem = loadMem();
    if (mem) applyParams(mem, true);
    renderPreview();
    syncUi();
    /* 覆盖浏览器表单恢复（range 旧值会覆盖 syncUi 设置，导致滑杆显示与视图不一致） */
    var resync = function () { setTimeout(function () { syncUi(); if (loaded) updateView(); }, 0); };
    if (document.readyState === 'complete') resync();
    else window.addEventListener('load', resync);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
