/* Moteful · png-compressor.js · v1.8.0
 * PNG 压缩工具页面逻辑：共享导入 → 解码 → 量化(Worker,失败降级) → 自研编码 →
 * 内嵌对比预览 / 结果列表 / ZIP 导出 / 带参分享 / 配置记忆（独立 key，不碰 tool.js）。
 * 依赖：moteful.js、MFImageImport(image-import.js)、zip.js、share.js、
 *       png-quantize.js、png-encode.js、pako(vendor，懒加载)。
 */
(function () {
  'use strict';
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var on = function (el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  /* i18n 辅助（对齐 stitch/annotate：调用全局语言包，动态文案不走硬编码） */
  var tr = function (key) {
    var d = (window.DICT && window.DICT[window.currentLang]) || {};
    return (d[key] != null) ? d[key] : key;
  };
  var trn = function (key, n) { return String(tr(key)).replace('{n}', n); };
  var root = window;

  var CFG_KEY = 'png_compress_config_v1';   /* 评审吸收①：独立配置记忆 key */
  var MAX_PIXELS = 30000000;                /* 内存护栏：>3000 万像素拒绝 */

  var S = {
    items: [],        /* {id,name,file,thumbUrl,origUrl,imageData,origBytes,outBytes,outUrl,bigger,rate,err} */
    activeId: null,
    config: { preset: 'balanced', colors: 128, dither: false, level: 9 },
    busy: false,
    timer: null,
    cmpPos: 50
  };

  /* =====================================================================
     ① 配置记忆（独立 key；load 初始化 + save 于参数变更）
     ===================================================================== */
  function defaultConfig() { return { preset: 'balanced', colors: 128, dither: false, level: 9 }; }
  function loadConfig() {
    var c = defaultConfig();
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          if (typeof o.preset === 'string') c.preset = o.preset;
          if (typeof o.colors === 'number') c.colors = Math.max(8, Math.min(256, Math.round(o.colors)));
          c.dither = !!o.dither;
          if (typeof o.level === 'number') c.level = Math.max(0, Math.min(9, Math.round(o.level)));
        }
      }
    } catch (e) {}
    return c;
  }
  function saveConfig() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.config)); } catch (e) {}
  }

  /* =====================================================================
     ② 导入（复用 MFImageImport 队列 + 双态画廊；PNG 页额外解码 ImageData）
     ===================================================================== */
  function initImport(tries) {
    tries = tries || 0;
    if (root.__PNG_IMPORT_BOUND) return;
    if (!window.MFImageImport) return;
    var dz = $('#pngDropzone'), file = $('#pngFile');
    /* 防御：defer 时序下 DOM 可能尚未就绪 → 轮询重试，不依赖 DOMContentLoaded 事件 */
    if (!dz || !file) {
      if (tries < 60) setTimeout(function () { initImport(tries + 1); }, 120);
      return;
    }
    S.imp = new window.MFImageImport({ onChange: renderGallery, onImport: function () {} });
    dz.addEventListener('click', function () { if (!S.imp.queue.length) $('#pngFile').click(); });
    dz.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && !S.imp.queue.length) { e.preventDefault(); $('#pngFile').click(); }
    });
    file.addEventListener('change', function () { S.imp.addFiles(file.files); file.value = ''; });
    ['dragover', 'drop'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files) S.imp.addFiles(e.dataTransfer.files);
      });
    });
    var reset = $('#pngDzReset');
    if (reset) reset.addEventListener('click', function () {
      S.imp.queue.slice().forEach(function (it) { S.imp.remove(it.id); });
      renderGallery();
    });
    /* 继续添加图片（对齐 image-tool addMoreBtn）：触发文件选择，不清空现有队列 */
    var addMore = $('#pngDzAddMore');
    if (addMore) addMore.addEventListener('click', function (e) {
      e.stopPropagation();
      $('#pngFile').click();
    });
    if (window.MFImageImport.enablePaste) {
      window.MFImageImport.enablePaste(function (files) { S.imp.addFiles(files); });
    }
    root.__PNG_IMPORT_BOUND = true;
  }

  function renderGallery() {
    var q = S.imp ? S.imp.queue : [];
    var ids = {};
    q.forEach(function (it) { ids[it.id] = 1; });
    /* 移除项：释放 URL 并摘除 */
    S.items = S.items.filter(function (it) {
      if (ids[it.id]) return true;
      if (it.origUrl) { try { URL.revokeObjectURL(it.origUrl); } catch (e) {} }
      if (it.outUrl) { try { URL.revokeObjectURL(it.outUrl); } catch (e) {} }
      if (S.activeId === it.id) S.activeId = null;
      return false;
    });
    /* 新增项：解码 ImageData（异步） */
    var needDecode = false;
    q.forEach(function (it) {
      if (S.items.some(function (x) { return x.id === it.id; })) return;
      needDecode = true;
      var entry = { id: it.id, name: it.name, file: it.file, thumbUrl: it.thumbUrl, origBytes: it.file.size || 0 };
      S.items.push(entry);
      loadPng(it.file).then(function (r) {
        entry.imageData = r.imageData;
        entry.origUrl = r.origUrl;
        entry.decoded = true;
        if (!S.activeId) S.activeId = entry.id;
        renderGalleryUI();
        syncPreview();
        /* 手动触发：导入后不自动压缩，等待用户点「开始处理」（对齐 image-tool） */
      }).catch(function (err) {
        entry.err = (err && err.message === 'too_large') ? 'too_large' : 'decode';
        renderGalleryUI();
      });
    });
    renderGalleryUI();
  }

  function loadPng(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); rej(new Error('decode')); return; }
        if (w * h > MAX_PIXELS) { URL.revokeObjectURL(url); rej(new Error('too_large')); return; }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var id = ctx.getImageData(0, 0, w, h);
        res({ imageData: id, origUrl: url });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }

  function renderGalleryUI() {
    var q = S.imp ? S.imp.queue : [];
    var empty = $('#pngDzEmpty'), gal = $('#pngDzGallery'), list = $('#pngDzList'), cnt = $('#pngDzCount');
    var dz = $('#pngDropzone');
    var processBtn = $('#pngProcessBtn');
    if (!empty || !gal || !list) return;
    if (!q.length) {
      empty.hidden = false; gal.hidden = true;
      if (dz) dz.classList.remove('mini');
      if (processBtn) processBtn.disabled = true;
      if (S.activeId) { S.activeId = null; syncPreview(); }
      return;
    }
    empty.hidden = true; gal.hidden = false;
    if (dz) dz.classList.add('mini');
    if (processBtn) processBtn.disabled = false;
    cnt.textContent = trn('png_dz_count', q.length);
    list.innerHTML = '';
    q.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'dz-thumb' + (it.id === S.activeId ? ' id-active' : '');
      el.setAttribute('data-id', it.id);
      el.setAttribute('title', it.name);
      el.innerHTML = '<img alt="">' +
        '<button type="button" class="dz-rm" aria-label="' + tr('png_res_remove') + '"><i data-lucide="x"></i></button>';
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

  function selectItem(id) {
    S.activeId = id;
    renderGalleryUI();
    syncPreview();
  }

  /* =====================================================================
     ③ 参数面板（预设 seg + 颜色数 + 抖动 + 级别；自定义态）
     ===================================================================== */
  function estimateColors(imgData) {
    var d = imgData.data, w = imgData.width, h = imgData.height;
    var step = Math.max(2, Math.floor(Math.sqrt((w * h) / 20000)));
    var set = {};
    var y, x, o, key;
    for (y = 0; y < h; y += step) {
      for (x = 0; x < w; x += step) {
        o = (y * w + x) * 4;
        key = ((d[o] & 0xF0) << 8) | ((d[o + 1] & 0xF0) << 4) | (d[o + 2] & 0xF0);
        set[key] = 1;
      }
    }
    var c = 0;
    for (var k in set) c++;
    /* 采样色数即近似量化桶数（16 级量化已合并邻近色），不做 step² 外推：
       外推会让大图色数虚高（如插画被误判为丰富图），导致均衡档误切真彩 */
    return c;
  }

  /* 预设 → 具体参数（评审③⑤：色数少→低档+关抖动；渐变多→高档+开抖动；'raw' = 真彩无损）
     均衡判档按估色数【下探一档】：量化目标低于图本身色数，保证体积有实际变化且损失比例小
     【抖动策略对齐 TinyPNG】全档关抖动：FS 抖动产生的高频噪声破坏索引数据可压缩性
     （实测同图 64 色抖动开 +3547% vs 关 -67%；256 色无抖动色带轻微，画质靠色数保证）；
     照片类（est>2000）真彩直通零丢失。
     【色数档位】8bit 索引图 IDAT 大小与色数无关（恒 1B/px，PLTE 每色仅 +3B），
     但 Deflate 效率随色数上升而下降（真实复杂插画：32色-44% / 64色-32%）——
     极限档取 48 色：画质 RMSE 14.7 ≈ 64 色水平、体积仅比 32 色多 ~4 点（甜点档）；
     usedColors≤16 时编码器自动降 4bit 再省一半 */
  function presetToCfg(preset, imgData) {
    if (preset === 'high') return { preset: 'high', colors: 'raw', dither: true, level: 6 };
    if (preset === 'extreme') return { preset: 'extreme', colors: 48, dither: false, level: 9 }; /* 极限档：48 色（画质 RMSE 14.7 ≈ 64 色，体积仅比 32 色多 ~4 点） */
    var est = imgData ? estimateColors(imgData) : 128;
    var cfg = { preset: 'balanced', colors: 128, dither: false, level: 9 };
    if (est <= 64) { cfg.colors = 64; }                            /* 低色图：64 色 8bit（无损，走调色板编码） */
    else if (est <= 128) { cfg.colors = 128; }                     /* 色数最大化：画质免费（8bit IDAT 大小与色数无关） */
    else if (est <= 256) { cfg.colors = 256; }                     /* 同上 */
    else if (est <= 2000) { cfg.colors = 256; }                    /* 复杂图：256 色（8bit 色数不增体积），关抖动保可压缩性 */
    else { cfg.colors = 'raw'; }                                   /* 照片/渐变丰富 → 真彩直通，像素零丢失 */
    return cfg;
  }

  function initControls() {
    /* 预设 seg */
    $$('input[name="pngPreset"]').forEach(function (r) {
      on(r, 'change', function () {
        var p = r.value;
        var imgData = activeImgData();
        var cfg = presetToCfg(p, imgData);
        S.config = cfg;
        syncControls();
        saveConfig();
        markDirty();
      });
    });
    /* 颜色数 */
    var colors = $('#pngColors');
    if (colors) on(colors, 'input', function () {
      S.config.colors = parseInt(colors.value, 10) || 128;
      S.config.preset = 'custom';
      if (window.MF && MF.sliderPct) colors.style.setProperty('--p', MF.sliderPct(colors) + '%');
      syncControls();
      saveConfig();
      markDirty();
    });
    /* 抖动 */
    var dither = $('#pngDither');
    if (dither) on(dither, 'change', function () {
      S.config.dither = dither.checked;
      S.config.preset = 'custom';
      syncControls();
      saveConfig();
      markDirty();
    });
    /* 级别 */
    var level = $('#pngLevel');
    if (level) on(level, 'input', function () {
      S.config.level = parseInt(level.value, 10) || 6;
      S.config.preset = 'custom';
      if (window.MF && MF.sliderPct) level.style.setProperty('--p', MF.sliderPct(level) + '%');
      syncControls();
      saveConfig();
      markDirty();
    });
    /* 开始处理（手动触发压缩，对齐 image-tool）：空队列禁用 */
    var processBtn = $('#pngProcessBtn');
    if (processBtn) on(processBtn, 'click', function () { scheduleCompress(); });
    /* 步进器：- / + 按钮联动滑杆（全局 .step 委托只改文本；此处以 slider 值为基准统一设值，
       再派发 input 事件走现有 S.config/syncControls/压缩链路，避免双写冲突） */
    $$('#pngConfig .step').forEach(function (step) {
      var sl = step.dataset.for ? $('#' + step.dataset.for) : null;
      if (!sl) return;
      var out = step.querySelector('.step-val');
      $$('.step-btn', step).forEach(function (b) {
        on(b, 'click', function () {
          var v = Math.max(+step.dataset.min, Math.min(+step.dataset.max, +sl.value + (+b.dataset.step)));
          if (window.MF && MF.sliderSet) MF.sliderSet(sl, v); else sl.value = v;
          if (out) out.textContent = v;
          sl.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
    });
    /* 对比滑块拖动（对齐 image-tool compare.js 交互模型）：
       整个对比区 pointerdown 即可拖动（点哪跳哪 + 跟手移动 + rAF 节流），双击复位中央 */
    var cmp = $('#pngCompare');
    var area = cmp ? cmp.querySelector('.compare-area') : null;
    if (area) {
      var rafPending = false, dragging = false, dragStartX = 0, dragStartPos = 50;
      var applyPos = function () { rafPending = false; syncCmpPos(); };
      area.addEventListener('pointerdown', function (e) {
        if (e.button && e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        dragStartX = e.clientX;
        var r = cmp.getBoundingClientRect();
        if (r.width) {
          /* 点哪跳哪：按下瞬间分割线移动到按下处（对齐 compare.js startDrag） */
          var p = ((e.clientX - r.left) / r.width) * 100;
          p = Math.max(2, Math.min(98, p));
          dragStartPos = p;   /* 以按下处为拖动基准，跟手移动 */
          S.cmpPos = p;
          applyPos();
        } else {
          dragStartPos = S.cmpPos;
        }
        var move = function (ev) {
          if (!dragging) return;
          var r2 = cmp.getBoundingClientRect();
          if (!r2.width) return;
          var p = dragStartPos + ((ev.clientX - dragStartX) / r2.width) * 100;
          p = Math.max(2, Math.min(98, p));
          S.cmpPos = p;
          if (!rafPending) { rafPending = true; requestAnimationFrame(applyPos); }
        };
        var up = function () {
          dragging = false;
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          if (rafPending) { rafPending = false; applyPos(); }
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      });
      /* 双击复位（对齐 compare.js） */
      area.addEventListener('dblclick', function () { S.cmpPos = 50; syncCmpPos(); });
      /* 翻页：上一张 / 下一张（多图时可见） */
      var prev = $('#pngCmpPrev'), next = $('#pngCmpNext');
      if (prev) on(prev, 'click', function () { stepCmp(-1); });
      if (next) on(next, 'click', function () { stepCmp(1); });
    }
  }

  /* 切换对比预览对象（按队列顺序前后翻页）；切图后分割线回到中央，避免遮挡翻页按钮 */
  function stepCmp(d) {
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i].id === S.activeId) {
        var j = i + d;
        if (j >= 0 && j < S.items.length) {
          S.activeId = S.items[j].id;
          S.cmpPos = 50;
          syncPreview();
        }
        return;
      }
    }
  }

  function activeImgData() {
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === S.activeId && S.items[i].imageData) return S.items[i].imageData;
    return null;
  }

  /* 参数变更 → 全部结果标记为待重压（释放旧输出 URL，清空结果行） */
  function markDirty() {
    S.items.forEach(function (it) {
      it.outBytes = null; it.outBlob = null; it.bigger = false; it.rate = 0;
      if (it.outUrl) { try { URL.revokeObjectURL(it.outUrl); } catch (e) {} it.outUrl = null; }
    });
    renderResults();
    syncPreview();
  }

  function syncControls() {
    var c = S.config;
    var colors = $('#pngColors'), cv = $('#pngColorsVal');
    var level = $('#pngLevel'), lv = $('#pngLevelVal');
    var dither = $('#pngDither');
    if (colors) {
      /* 'raw' = 真彩直通：不量化颜色（像素零丢失），滑条到顶（256），数值区显示「原画质」 */
      colors.value = (c.colors === 'raw') ? 256 : c.colors;
      if (cv) cv.textContent = (c.colors === 'raw') ? tr('png_colors_lossless') : c.colors;
      if (window.MF && MF.sliderPct) colors.style.setProperty('--p', MF.sliderPct(colors) + '%');
    }
    if (level) {
      level.value = c.level;
      if (lv) lv.textContent = c.level;
      if (window.MF && MF.sliderPct) level.style.setProperty('--p', MF.sliderPct(level) + '%');
    }
    if (dither) dither.checked = !!c.dither;
    /* 预设匹配：均衡按自动判档集合（64/128/'raw'/256）匹配，不逐项比 dither（判档决定） */
    var presetMatched = false;
    if (c.preset === 'high') presetMatched = c.colors === 'raw' && c.dither === true && c.level === 6;
    else if (c.preset === 'extreme') presetMatched = c.colors === 48 && c.dither === false && c.level === 9;
    else if (c.preset === 'balanced') presetMatched = (c.colors === 64 || c.colors === 128 || c.colors === 'raw' || c.colors === 256) && c.level === 9;
    else if (c.preset === 'custom') presetMatched = true;
    if (presetMatched) {
      $$('input[name="pngPreset"]').forEach(function (r) {
        r.checked = (r.value === c.preset);
      });
    } else {
      $$('input[name="pngPreset"]').forEach(function (r) { r.checked = false; });
    }
  }

  /* =====================================================================
     ④ 压缩流水线（量化 Worker → pako 懒加载 → 自研编码 → 结果行）
     ===================================================================== */
  var pakoPromise = null;
  function ensurePako() {
    if (root.pako) return Promise.resolve(true);
    if (pakoPromise) return pakoPromise;
    pakoPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = '../assets/vendor/pako/pako.min.js';
      s.onload = function () { (root.pako ? res(true) : rej(new Error('missing'))); };
      s.onerror = function () { rej(new Error('load fail')); };
      document.head.appendChild(s);
    });
    return pakoPromise;
  }

  function scheduleCompress() {
    if (S.timer) clearTimeout(S.timer);
    S.timer = setTimeout(compressAll, 600);
  }

  function compressAll() {
    if (S.busy) return;
    var targets = S.items.filter(function (it) { return it.decoded && !it.err && !it.outBytes; });
    if (!targets.length) return;
    S.busy = true;
    showBusy(true, targets.length, 0);
    var idx = 0;
    var next = function () {
      if (idx >= targets.length) {
        S.busy = false;
        showBusy(false);
        renderResults();
        syncPreview();
        return;
      }
      var it = targets[idx++];
      showBusy(true, targets.length, idx - 1);
      compressItem(it).then(function () {
        renderResults();
        next();
      }).catch(function (err) {
        it.err = 'compress';
        it.errMsg = (err && err.message) || '';
        renderResults();
        next();
      });
    };
    next();
  }

  function compressItem(it) {
    var cfg = S.config;
    var id = it.imageData, w = id.width, h = id.height, d = id.data;
    var job;
    if (cfg.colors === 'raw') {
      /* 真彩档智能判定：估色 ≤256 → 调色板（索引格式体积更小、色数不超过容量即不丢像素）；
         估色 >256 → 真彩无损（RGBA 全量拷贝，像素零丢失） */
      var est = estimateColors(id);
      if (est <= 256) {
        job = PNGQuant.quantize(id, { colors: 256, dither: cfg.dither });
      } else {
        var raw = new Uint8Array(w * h * 4);
        raw.set(d);
        job = Promise.resolve({ raw: raw });
      }
    } else if (cfg.colors >= 256) {
      /* 显式 256 档（均衡复杂图判档）：直接量化到 256，保证体积有实际变化 */
      job = PNGQuant.quantize(id, { colors: 256, dither: cfg.dither });
    } else {
      job = PNGQuant.quantize(id, { colors: cfg.colors, dither: cfg.dither });
    }
    return job.then(function (res) {
      return ensurePako().then(function () {
        var bytes = PNGEncode.encode({
          width: w,
          height: h,
          colors: res.colors,
          palette: res.palette,
          indices: res.indices,
          raw: res.raw,
          level: cfg.level
        });
          it.outBytes = bytes.length;
          if (it.outBytes >= it.origBytes) {
            /* 评审②：压不小（无损重压无法更小，如原图已高度优化）→ 输出保持原文件，体积永不增大 */
            if (it.outUrl) { try { URL.revokeObjectURL(it.outUrl); } catch (e) {} }
            it.outBlob = it.file;
            it.outUrl = URL.createObjectURL(it.file);
            it.outBytes = it.origBytes;
            it.rate = 1;
            it.bigger = false;
            it.kept = true;
          } else {
            it.outBlob = new Blob([bytes], { type: 'image/png' });
            if (it.outUrl) { try { URL.revokeObjectURL(it.outUrl); } catch (e) {} }
            it.outUrl = URL.createObjectURL(it.outBlob);
            it.rate = it.origBytes ? it.outBytes / it.origBytes : 1;
            it.bigger = it.outBytes >= it.origBytes;
            it.kept = false;
          }
          return it;
        });
      });
  }

  /* 实时取缩略图：导入队列 item 的 thumbUrl（异步生成，结果行不固化快照），无则用原图 URL 兜底 */
  function liveThumb(id) {
    var q = S.imp ? S.imp.queue : [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].id === id) return q[i].thumbUrl || '';
    }
    for (var j = 0; j < S.items.length; j++) {
      if (S.items[j].id === id) return S.items[j].origUrl || S.items[j].thumbUrl || '';
    }
    return '';
  }

  /* =====================================================================
     ⑤ 渲染：结果列表 + 汇总 + 对比预览
     ===================================================================== */
  function renderResults() {
    var list = $('#pngResList'), summary = $('#pngSummary');
    if (!list) return;
    list.innerHTML = '';
    var done = S.items.filter(function (it) { return it.outBytes; });
    var totalOrig = 0, totalNew = 0;
    done.forEach(function (it) { totalOrig += it.origBytes; totalNew += it.outBytes; });
    if (summary) {
      var saved = totalOrig ? Math.round((1 - totalNew / totalOrig) * 100) : 0;
      summary.innerHTML = '<span>' + trn('png_sum_n', S.items.length) + '</span>' +
        '<span>' + tr('png_sum_orig') + ' <b>' + fmtSize(totalOrig) + '</b></span>' +
        '<span>' + tr('png_sum_new') + ' <b>' + fmtSize(totalNew) + '</b></span>' +
        '<span>' + tr('png_sum_saved') + ' <b class="' + (saved >= 0 ? 'ok' : 'bad') + '">' + saved + '%</b></span>';
    }
    S.items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'png-res-row';
      var stateHtml = '';
      if (it.err) {
        stateHtml = '<div class="field-err">' + (it.err === 'too_large' ? tr('png_err_too_large') : it.err === 'decode' ? tr('png_err_decode') : tr('png_err_fail') + '：' + (it.errMsg || '')) + '</div>';
      } else if (it.outBytes) {
        var cls = it.bigger ? 'bad' : 'ok';
        var rateText = it.bigger ? '+' + Math.round((it.rate - 1) * 100) + '%' : '-' + Math.round((1 - it.rate) * 100) + '%';
        stateHtml = '<div class="png-size-bar">' +
          '<span>' + tr('png_res_orig') + ' <b>' + fmtSize(it.origBytes) + '</b></span>' +
          '<span class="png-bar-track"><i class="' + cls + '" style="width:' + Math.min(100, Math.round(it.rate * 100)) + '%"></i></span>' +
          '<span>' + tr('png_res_new') + ' <b>' + fmtSize(it.outBytes) + '</b> <span class="' + cls + '">' + rateText + '</span></span>' +
          '</div>';
        if (it.kept) {
          stateHtml += '<div class="png-res-warn"><i data-lucide="info"></i><span>' + tr('png_kept_hint') + '</span></div>';
        } else if (it.bigger) {
          stateHtml += '<div class="png-res-warn"><i data-lucide="alert-triangle"></i><span>' + tr('png_bigger_hint') + '</span></div>';
        }
      } else {
        stateHtml = '<div class="png-res-state">' + tr('png_pending') + '</div>';
      }
      row.innerHTML = '<img class="thumb" alt="" src="' + (liveThumb(it.id) || '') + '">' +
        '<div class="png-res-main"><div class="png-res-name">' + esc(it.name) + '</div>' + stateHtml + '</div>' +
        '<div class="png-res-acts">' +
        (it.outUrl ? '<a class="btn btn-secondary btn-sm" href="' + it.outUrl + '" download="' + esc(downloadName(it.name)) + '" data-i18n-aria="png_res_download" aria-label="' + tr('png_res_download') + '"><i data-lucide="download"></i></a>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="' + tr('png_res_remove') + '"><i data-lucide="trash-2"></i></button>' +
        '</div>';
      var rm = row.querySelector('[data-rm]');
      if (rm) rm.addEventListener('click', function () {
        if (S.imp) S.imp.remove(it.id);
        if (S.activeId === it.id) S.activeId = null;
        renderGallery();
      });
      row.querySelector('.png-res-main').addEventListener('click', function () { selectItem(it.id); });
      list.appendChild(row);
    });
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
  }

  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function downloadName(name) {
    return String(name).replace(/\.png$/i, '') + '-c.png';
  }

  function showBusy(on_, total, done) {
    var b = $('#pngBusy');
    if (b) {
      b.hidden = !on_;
      if (on_) { var p = $('#pngBusyProg'); if (p) p.textContent = done + '/' + total; }
    }
    /* 参数区进度条（点击开始处理后显示）：.progress 填充 + mono 计数 + aria */
    var pw = $('#pngProgress'), pt = $('#pngProgressTxt'), fill = $('#pngProgressFill');
    if (pw) pw.hidden = !on_;
    if (pt) pt.hidden = !on_;
    if (on_ && pw && fill) {
      var pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
      fill.style.width = pct + '%';
      if (pt) pt.textContent = done + '/' + total;
      pw.setAttribute('aria-valuenow', String(pct));
    }
  }

  function syncPreview() {
    var cmp = $('#pngCompare'), empty = $('#pngCompareEmpty');
    if (!cmp || !empty) return;
    var it = null;
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === S.activeId) { it = S.items[i]; break; }
    if (!it || !it.origUrl || !it.outUrl) {
      cmp.hidden = true;
      empty.hidden = false;
      var strip = $('#pngCmpStrip');
      if (strip) { strip.hidden = true; strip.innerHTML = ''; }
      var pv = $('#pngCmpPrev'), nx = $('#pngCmpNext');
      if (pv) pv.hidden = true;
      if (nx) nx.hidden = true;
      empty.innerHTML = it && it.origUrl
        ? '<p class="muted">' + tr('png_cmp_wait') + '</p>'
        : '<p class="muted">' + tr('png_compare_placeholder') + '</p>';
      if (window.MF && MF.refreshIcons) MF.refreshIcons();
      return;
    }
    cmp.hidden = false;
    empty.hidden = true;
    var top = $('#pngCmpTop'), base = $('#pngCmpBase');
    if (top && top.getAttribute('src') !== it.origUrl) top.src = it.origUrl;
    if (base && base.getAttribute('src') !== it.outUrl) base.src = it.outUrl;
    fitCmpFrame(it);
    renderCmpStrip();
    updateCmpNav();
    syncCmpPos();
  }

  /* ① 对比框高度自适应：图片本身高度 ≤480 按图片尺寸，超过 480 封顶 480 */
  function fitCmpFrame(it) {
    var frame = $('#pngCompare');
    if (!frame) return;
    var id = it && it.imageData;
    if (!id || !id.width || !id.height) { frame.style.height = ''; return; }
    var MAX = 480, MIN = 200;
    var h = Math.min(id.height, MAX);
    frame.style.height = Math.max(h, MIN) + 'px';
  }

  /* ② 批量缩略图条：多图时显示，点击切换预览对象（复用共享 .dz-thumb） */
  function renderCmpStrip() {
    var strip = $('#pngCmpStrip');
    if (!strip) return;
    if (S.items.length < 2) { strip.hidden = true; strip.innerHTML = ''; return; }
    strip.hidden = false;
    var html = '';
    S.items.forEach(function (it) {
      var src = it.outUrl || it.origUrl || it.thumbUrl || '';
      html += '<div class="dz-thumb' + (it.id === S.activeId ? ' id-active' : '') + '" data-id="' + it.id + '" role="button" tabindex="0"><img alt="" draggable="false" src="' + esc(src) + '"></div>';
    });
    strip.innerHTML = html;
    Array.prototype.forEach.call(strip.querySelectorAll('.dz-thumb'), function (t) {
      var pick = function () {
        var id = t.getAttribute('data-id');
        if (id && id !== S.activeId) { S.activeId = id; S.cmpPos = 50; syncPreview(); }
      };
      t.addEventListener('click', pick);
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  /* ③ 翻页按钮显隐：单图或无 active 时隐藏 */
  function updateCmpNav() {
    var prev = $('#pngCmpPrev'), next = $('#pngCmpNext');
    if (!prev || !next) return;
    var idx = -1;
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === S.activeId) { idx = i; break; }
    var multi = S.items.length > 1;
    prev.hidden = !multi || idx <= 0;
    next.hidden = !multi || idx < 0 || idx >= S.items.length - 1;
  }

  /* 对比分割位置同步（对齐共享 compare.js 写法：上层图 clip-path + 分隔线 left + aria） */
  function syncCmpPos() {
    var cmp = $('#pngCompare');
    if (!cmp || cmp.hidden) return;
    var p = S.cmpPos, top = $('#pngCmpTop'), div = $('#pngCmpDivider');
    if (top) top.style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)';
    if (div) div.style.left = p + '%';
    var handle = $('#pngCmpHandle');
    if (handle) handle.setAttribute('aria-valuenow', Math.round(p));
  }

  /* =====================================================================
     ⑥ 导出：单张 / ZIP / 分享（带参）
     ===================================================================== */
  function initExport() {
    var zipBtn = $('#pngExportZip');
    if (zipBtn) on(zipBtn, 'click', exportZip);
    /* 逐张下载（结果行 <a download>）后弹内联推荐（对齐 image-tool/qrcode 的 rec_download 约定） */
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.png-res-row a[download]') : null;
      if (a && window.Moteful && window.Moteful.recommend) {
        setTimeout(function () { window.Moteful.recommend.show({ actionKey: 'rec_download' }); }, 350);
      }
    });
    /* 分享按钮由 share.js 的 [data-share-open] 自动绑定 open() */
    if (window.MotefulShare) {
      window.MotefulShare.setShareable(true);
      window.MotefulShare.register('png-compressor', {
        getParams: function () {
          return { p: S.config.preset, c: S.config.colors, d: S.config.dither ? 1 : 0, l: S.config.level };
        }
      });
    }
  }

  function exportZip() {
    var ready = S.items.filter(function (it) { return it.outBlob; });
    if (!ready.length) return;
    var btn = $('#pngExportZip');
    var old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>' + tr('png_zip_busy') + '</span>'; }
    Promise.all(ready.map(function (it) {
      return it.outBlob.arrayBuffer().then(function (buf) {
        return { name: downloadName(it.name), data: new Uint8Array(buf) };
      });
    })).then(function (files) {
      var blob = window.MotefulZip ? window.MotefulZip.build(files) : null;
      if (!blob) throw new Error('zip missing');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'png-compressed.zip';
      a.click();
      /* 打包导出后弹内联推荐（对齐 annotate/stitch 的 rec_export 约定） */
      if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    });
  }

  /* =====================================================================
     ⑦ 分享链接参数恢复（p/c/d/l）+ 启动
     ===================================================================== */
  function applyUrlParams() {
    var qs = {};
    try {
      (location.search || '').replace(/[?&]([^=&#]+)=([^&#]*)/g, function (m, k, v) {
        qs[k] = decodeURIComponent(v);
      });
    } catch (e) {}
    if (qs.p && (qs.p === 'balanced' || qs.p === 'high' || qs.p === 'extreme')) {
      /* ?p= 携带完整预设语义：缺省参数时取该档全套配置 */
      var base = presetToCfg(qs.p, null);
      S.config = { preset: qs.p, colors: base.colors, dither: base.dither, level: base.level };
      if (qs.c) S.config.colors = Math.max(8, Math.min(256, parseInt(qs.c, 10) || base.colors));
      if (qs.d !== undefined) S.config.dither = qs.d !== '0';
      if (qs.l) S.config.level = Math.max(0, Math.min(9, parseInt(qs.l, 10) || base.level));
      /* 与预设档不一致的显式参数 → 视为自定义配置 */
      var m = S.config.colors === base.colors && S.config.dither === base.dither && S.config.level === base.level;
      if (!m) S.config.preset = 'custom';
    }
    syncControls();
  }

  function init() {
    S.config = loadConfig();
    initImport();
    initControls();
    initExport();
    applyUrlParams();
    /* 语言切换：动态文案（画廊计数/汇总/结果行/对比空态）走语言包重绘；
       syncControls 同步参数区 JS 写入文本（raw 档「原画质/Original」数值区等） */
    document.addEventListener('moteful:langchange', function () {
      syncControls();
      renderGalleryUI();
      renderResults();
      syncPreview();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
