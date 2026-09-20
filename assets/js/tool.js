/*
 * Moteful 核心闭环（V0.1 基础 + V0.2 变换 + V0.2.2 体验重构）
 * 流程：导入 → 裁剪/旋转/翻转/改尺寸 → 压缩与转格式 → 打包下载
 * 纯前端、零外部请求。所有图片处理在浏览器本地完成，绝不上传。
 *
 * 对应需求：V0.1 F1 批量导入 / F2 压缩 / F3 转格式 / F4 打包下载 /
 *           F5 进度与结果 / F6 异常处理
 *           V0.2 改尺寸 / 旋转 / 翻转 / 裁剪 / 预估耗时
 *           V0.2.2 行卡片二合一 / 处理中锁定与取消 / 细分导入提示 /
 *                  清空二次确认 / 单张删除 / 高级编辑折叠 / ZIP 防双击
 *
 * 铁律①：所有展示文案走 i18n 集中源，本文件不含硬编码文案。
 */
(function () {
  'use strict';

  /* ---------- i18n 辅助（动态文案，支持占位符） ---------- */
  function tr(key) {
    var d = (window.DICT && window.DICT[window.currentLang]) || {};
    return (d[key] != null) ? d[key] : key;
  }
  function trn(key, n) { return String(tr(key)).replace('{n}', n); }
  function tr2(key, a, b) { return String(tr(key)).replace('{n}', a).replace('{total}', b); }
  function trwh(key, w, h) { return String(tr(key)).replace('{w}', w).replace('{h}', h); }

  /* ---------- 工具函数 ---------- */
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }
  /* V0.4.2修整：提取重复的体积变化率计算（原updateRow和openCompare各有一份） */
  function calcRate(it) {
    if (!it || it.size <= 0) return 0;
    return ((it.size - it.newSize) / it.size) * 100;
  }
  function extFor(mime, origName) {
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/png') return '.png';
    if (mime === 'image/webp') return '.webp';
    var m = /\.[a-z0-9]+$/i.exec(origName || '');
    return m ? m[0].toLowerCase() : '';
  }
  function baseName(name) {
    var m = /\.[a-z0-9]+$/i.exec(name || '');
    return m ? name.slice(0, m.index) : (name || 'image');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function numOr(el, dflt, lo, hi) {
    var n = parseFloat(el && el.value);
    if (!isFinite(n)) n = dflt;
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    return n;
  }

  /* V0.4优化：步进器文本框整数规范化（实时过滤非数字+清除前导零+失焦兜底） */
  function normalizeIntInput(el, dflt, lo, hi, isBlur) {
    if (!el) return;
    var raw = el.value;
    // 1. 只保留数字字符
    var digits = raw.replace(/[^0-9]/g, '');
    // 2. 清除前导零（"000"→"0"，"007"→"7"，空→空）
    if (digits.length > 0) {
      digits = String(parseInt(digits, 10));
    }
    // 3. input 事件时：如果用户正在输入（还没输完），暂时保留空值让用户继续输
    if (!isBlur && digits === '') {
      el.value = '';
      return;
    }
    // 4. blur 事件时或有值时：解析为整数，夹取范围
    var n = digits === '' ? dflt : parseInt(digits, 10);
    if (!isFinite(n)) n = dflt;
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    el.value = String(n);
  }

  /* ---------- 状态 ---------- */
  var queue = [];        // {id, file, name, size, iw, ih, status, blob, newSize, thumb, outName, err}
  var fmt = 'keep';      // keep | image/jpeg | image/png | image/webp
  var quality = 80;      // 1-100
  var uid = 0;
  var usedNames = {};

  /* V0.2.2：运行态标记 */
  var processing = false;   // 处理中：锁定参数控件，拒绝继续导入
  var cancelFlag = false;   // 请求取消：当前批次结束后停止
  var zipping = false;      // ZIP 打包中：防止双击重复下载
  var clearArmed = false;   // 清空按钮二次确认状态
  var clearTimer = 0;
  var rowMap = {};          // 结果行 DOM 缓存：id -> {root, thumb, name, ...}，增量更新用
  /* V0.3：下载后自动清除记录 */
  var wipeTimer = 0;        // 清除倒计时 timer
  var wipeTargetId = null;  // 清除目标：null=全量清除，数字=单张图片 id

  /* V0.2 变换参数 */
  var DEFAULTS = {
    sizeMode: 'none',    // none | percent | longest | exact
    percent: 50,
    longest: 1920,
    width: 1920,
    height: 1080,
    keepRatio: true,
    rotate: 0,           // 0 | 90 | 180 | 270
    advEnabled: false,   // 高级编辑总开关：关闭时不应用 crop（翻转已移出高级编辑，始终生效）
    flipH: false,
    flipV: false,
    cropMode: 'none',    // none | ratio | free
    cropRatio: '1:1',
    mTop: 0, mBottom: 0, mLeft: 0, mRight: 0
  };
  var tf = {};
  function resetTf() { tf = JSON.parse(JSON.stringify(DEFAULTS)); }
  resetTf();

  /* ---------- V0.4：配置记忆（localStorage） ----------
     记住用户上次的参数设置，下次打开自动恢复。
     存储键名：moteful.imageTool.config
     存储内容：格式、质量、缩放模式/百分比/最长边/宽高、旋转、水平/垂直翻转、四边边距
     保存策略：参数变化后防抖300ms保存；关页面前(beforeunload)强制保存兜底 */
  var CONFIG_KEY = 'moteful.imageTool.config';
  var CONFIG_VERSION = 1;
  var saveTimer = 0;

  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return false;
      var cfg = JSON.parse(raw);
      if (!cfg || cfg.__version !== CONFIG_VERSION) return false;
      // 恢复格式
      if (cfg.fmt) fmt = cfg.fmt;
      // 恢复质量
      if (cfg.quality != null) quality = parseInt(cfg.quality, 10) || 80;
      // 恢复变换参数
      if (cfg.sizeMode) tf.sizeMode = cfg.sizeMode;
      if (cfg.percent != null) tf.percent = parseInt(cfg.percent, 10) || 50;
      if (cfg.longest != null) tf.longest = parseInt(cfg.longest, 10) || 1920;
      if (cfg.width != null) tf.width = parseInt(cfg.width, 10) || 1920;
      if (cfg.height != null) tf.height = parseInt(cfg.height, 10) || 1080;
      if (cfg.rotate != null) tf.rotate = parseInt(cfg.rotate, 10) || 0;
      if (cfg.flipH != null) tf.flipH = !!cfg.flipH;
      if (cfg.flipV != null) tf.flipV = !!cfg.flipV;
      if (cfg.mTop != null) tf.mTop = parseInt(cfg.mTop, 10) || 0;
      if (cfg.mBottom != null) tf.mBottom = parseInt(cfg.mBottom, 10) || 0;
      if (cfg.mLeft != null) tf.mLeft = parseInt(cfg.mLeft, 10) || 0;
      if (cfg.mRight != null) tf.mRight = parseInt(cfg.mRight, 10) || 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveConfigNow() {
    try {
      var cfg = {
        __version: CONFIG_VERSION,
        fmt: fmt,
        quality: quality,
        sizeMode: tf.sizeMode,
        percent: tf.percent,
        longest: tf.longest,
        width: tf.width,
        height: tf.height,
        rotate: tf.rotate,
        flipH: tf.flipH,
        flipV: tf.flipV,
        mTop: tf.mTop,
        mBottom: tf.mBottom,
        mLeft: tf.mLeft,
        mRight: tf.mRight
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {
      // 存储失败（如隐私模式）静默忽略，不影响功能
    }
  }

  function scheduleSaveConfig() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveConfigNow, 300);
  }

  /* ---------- V0.2.1：参数签名（判断已出结果是否过期） ----------
     处理开始时记录一次参数快照；之后任何参数变动，若与快照不一致，
     就把已完成项标回待处理，让"开始处理"按钮能按新参数重算整批。 */
  var lastSig = '';
  var baseSig = '';   // V0.3.3：导入基线参数签名（队列从空变非空时捕获），用于「未改参数禁用开始处理」
  /* V0.3.4：队列是否全部为 PNG（MIME 优先，扩展名兜底——部分系统拖放 file.type 为空）。
     默认参数下只有 PNG 处理无意义（无损重编码还可能变大）；JPG/WebP 有质量压缩收益，始终允许处理 */
  function allPng() {
    for (var i = 0; i < queue.length; i++) {
      var it = queue[i];
      var isPng = /^image\/png$/i.test(it.file && it.file.type) || /\.png$/i.test(it.name || '');
      if (!isPng) return false;
    }
    return true;
  }
  function paramSig() {
    return [fmt, quality, tf.sizeMode, tf.percent, tf.longest, tf.width, tf.height,
            tf.keepRatio, tf.rotate, tf.flipH, tf.flipV, tf.cropMode, tf.cropRatio,
            tf.mTop, tf.mBottom, tf.mLeft, tf.mRight].join('|');
  }
  function markStale() {
    var dirty = !(lastSig === '' || lastSig === paramSig());
    if (dirty) {
      var n = 0;
      queue.forEach(function (it) {
        if (it.status === 'done') {
          it.status = 'ready'; it.blob = null; it.newSize = 0; it.outName = ''; n++;
        }
      });
      if (n) { usedNames = {}; lastSig = ''; }  // 结果作废：清空名字池
    }
    refreshDynamic();   // V0.3.3：参数变更统一刷新「开始处理」禁用态（pristine 判定依赖 lastSig/baseSig）
    scheduleSaveConfig();  // V0.4：配置记忆 - 参数变化后防抖保存到 localStorage
  }

  /* ---------- DOM 引用 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var dropzone, fileInput, controls, segBtns, qualityEl, qualityVal, pngNote,
      actions, processBtn, cancelBtn, zipBtn, clearBtn, countLabel, progressWrap,
      progressFill, progressTxt, etaTxt, results, resultList, totalSaved,
      resetBtn, advSwitch, advBody,
      dzEmpty, dzGallery, dzGalleryList, dzCount, addMoreBtn, dzResetBtn;
  var sizeSegs, sizePercentCtl, sizePercent, sizeLongestCtl, sizeLongest,
      sizeExactCtl, sizeW, sizeH, keepRatio,
      rotSegs, flipHBtn, flipVBtn,
      cropSegs, cropRatioCtl, cropRatioBtns, cropFreeCtl, mTop, mBottom, mLeft, mRight;

  /* ---------- 初始化 ---------- */
  function init() {
    dropzone = $('dropzone'); fileInput = $('fileInput'); controls = $('controls');
    // 必须按 data-fmt 精确选取：页面已有多个分段组，不能用 .seg-btn 笼统选择
    segBtns = document.querySelectorAll('[data-fmt]');
    qualityEl = $('quality'); qualityVal = $('qualityVal'); pngNote = $('pngNote');
    actions = $('actions'); processBtn = $('processBtn'); cancelBtn = $('cancelBtn');
    zipBtn = $('zipBtn');
    clearBtn = $('clearBtn'); countLabel = $('countLabel'); progressWrap = $('progressWrap');
    progressFill = $('progressFill'); progressTxt = $('progressTxt'); etaTxt = $('etaTxt');
    results = $('results'); resultList = $('resultList'); totalSaved = $('totalSaved');
    resetBtn = $('resetBtn');
    advSwitch = $('advSwitch'); advBody = $('advBody');
    dzEmpty = $('dzEmpty'); dzGallery = $('dzGallery'); dzGalleryList = $('dzGalleryList');
    dzCount = $('dzCount'); addMoreBtn = $('addMoreBtn'); dzResetBtn = $('dzResetBtn');

    sizeSegs = document.querySelectorAll('[data-size]');
    sizePercentCtl = $('sizePercentCtl'); sizePercent = $('sizePercent');
    sizeLongestCtl = $('sizeLongestCtl'); sizeLongest = $('sizeLongest');
    sizeExactCtl = $('sizeExactCtl'); sizeW = $('sizeW'); sizeH = $('sizeH'); keepRatio = $('keepRatio');
    rotSegs = document.querySelectorAll('[data-rot]');
    flipHBtn = $('flipH'); flipVBtn = $('flipV');
    cropSegs = document.querySelectorAll('[data-crop]');
    cropRatioCtl = $('cropRatioCtl'); cropRatioBtns = document.querySelectorAll('[data-ratio]');
    cropFreeCtl = $('cropFreeCtl');
    mTop = $('mTop'); mBottom = $('mBottom'); mLeft = $('mLeft'); mRight = $('mRight');

    if (!dropzone) return;

    // V0.4：配置记忆 - 从 localStorage 恢复上次的参数设置
    var hasSavedConfig = loadConfig();
    // 同步格式按钮选中状态
    if (segBtns) segBtns.forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-fmt') === fmt);
    });
    // 同步质量滑块和数值显示
    if (qualityEl) qualityEl.value = String(quality);
    if (qualityEl) qualityEl.style.setProperty('--p', Math.max(0, Math.min(100, quality)) + '%');
    if (qualityVal) qualityVal.textContent = quality + '%';
    // 同步变换参数和子控件显示
    syncUIFromTf();
    syncSubCtl();

    // 导入：点击 / 键盘；V0.3 画廊态下点击缩略图不重复触发文件选择
    dropzone.addEventListener('click', function (e) {
      if (dzGallery && !dzGallery.hidden && dzGallery.contains(e.target)) return;
      fileInput.click();
    });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', function (e) { addFiles(e.target.files); fileInput.value = ''; });

    // 导入：拖拽
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'dragleave' && e.relatedTarget && dropzone.contains(e.relatedTarget)) return;
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();   // 阻止冒泡到 document 全页处理，防双导
      dropzone.classList.remove('dragover');
      var dt = e.dataTransfer; if (dt && dt.files && dt.files.length) addFiles(dt.files);
    });

    // V0.2.10：全页拖放导入——拖到页面任意位置均可导入，不再限定上传虚线框
    function dtHasFiles(e) {
      try { return Array.prototype.indexOf.call((e.dataTransfer && e.dataTransfer.types) || [], 'Files') >= 0; }
      catch (err) { return false; }
    }
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (!dtHasFiles(e)) return;
        e.preventDefault();                       // 阻止浏览器默认打开图片
        if (dropzone && !processing) dropzone.classList.add('dragover');   // 高亮提示可松手
      }, false);
    });
    document.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        if (dropzone) dropzone.classList.remove('dragover');
      }
    }, false);
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (dropzone) dropzone.classList.remove('dragover');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) addFiles(dt.files);
    }, false);

    // 输出格式（V0.1）
    if (segBtns) segBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        fmt = b.getAttribute('data-fmt');
        segBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
        markStale();
      });
    });
    // V0.4：配置记忆 - 只有当没有任何格式按钮被选中时，才默认选中 keep
    if (segBtns) {
      var hasOn = false;
      segBtns.forEach(function (x) { if (x.classList.contains('on')) hasOn = true; });
      if (!hasOn) {
        segBtns.forEach(function (x) {
          if (x.getAttribute('data-fmt') === 'keep') x.classList.add('on');
        });
      }
    }

    // 质量滑块
    if (qualityEl) qualityEl.addEventListener('input', function () {
      quality = parseInt(qualityEl.value, 10) || 80;
      // V0905 规范 .slider：进度填充由 --p 驱动，须与值同步
      qualityEl.style.setProperty('--p', Math.max(0, Math.min(100, quality)) + '%');
      if (qualityVal) qualityVal.textContent = quality + '%';
      markStale();
    });

    // ---- V0.2：改尺寸 ----
    if (sizeSegs) sizeSegs.forEach(function (b) {
      b.addEventListener('click', function () {
        tf.sizeMode = b.getAttribute('data-size');
        sizeSegs.forEach(function (x) { x.classList.toggle('on', x === b); });
        syncSubCtl(); updateOutSize(); markStale();
      });
    });
    if (sizePercent) {
      sizePercent.addEventListener('input', function () {
        normalizeIntInput(sizePercent, 50, 1, 400, false);
        tf.percent = numOr(sizePercent, 50, 1, 400); updateOutSize(); markStale();
      });
      sizePercent.addEventListener('blur', function () {
        normalizeIntInput(sizePercent, 50, 1, 400, true);
        tf.percent = numOr(sizePercent, 50, 1, 400); updateOutSize(); markStale();
      });
    }
    if (sizeLongest) {
      sizeLongest.addEventListener('input', function () {
        normalizeIntInput(sizeLongest, 1920, 1, 20000, false);
        tf.longest = numOr(sizeLongest, 1920, 1, 20000); updateOutSize(); markStale();
      });
      sizeLongest.addEventListener('blur', function () {
        normalizeIntInput(sizeLongest, 1920, 1, 20000, true);
        tf.longest = numOr(sizeLongest, 1920, 1, 20000); updateOutSize(); markStale();
      });
    }
    if (sizeW) {
      sizeW.addEventListener('input', function () {
        normalizeIntInput(sizeW, 1920, 1, 20000, false);
        tf.width = numOr(sizeW, 1920, 1, 20000); updateOutSize(); markStale();
      });
      sizeW.addEventListener('blur', function () {
        normalizeIntInput(sizeW, 1920, 1, 20000, true);
        tf.width = numOr(sizeW, 1920, 1, 20000); updateOutSize(); markStale();
      });
    }
    if (sizeH) {
      sizeH.addEventListener('input', function () {
        normalizeIntInput(sizeH, 1080, 1, 20000, false);
        tf.height = numOr(sizeH, 1080, 1, 20000); updateOutSize(); markStale();
      });
      sizeH.addEventListener('blur', function () {
        normalizeIntInput(sizeH, 1080, 1, 20000, true);
        tf.height = numOr(sizeH, 1080, 1, 20000); updateOutSize(); markStale();
      });
    }
    if (keepRatio) keepRatio.addEventListener('change', function () {
      tf.keepRatio = !!keepRatio.checked; updateOutSize(); markStale();
    });

    // ---- V0.2：旋转 / 翻转 ----
    if (rotSegs) rotSegs.forEach(function (b) {
      b.addEventListener('click', function () {
        tf.rotate = parseInt(b.getAttribute('data-rot'), 10) || 0;
        rotSegs.forEach(function (x) { x.classList.toggle('on', x === b); });
        updateOutSize(); markStale();
      });
    });
    if (flipHBtn) flipHBtn.addEventListener('click', function () {
      tf.flipH = !tf.flipH; flipHBtn.classList.toggle('on', tf.flipH); updateOutSize(); markStale();
    });
    if (flipVBtn) flipVBtn.addEventListener('click', function () {
      tf.flipV = !tf.flipV; flipVBtn.classList.toggle('on', tf.flipV); updateOutSize(); markStale();
    });

    // ---- V0.2：裁剪 ----
    if (cropSegs) cropSegs.forEach(function (b) {
      b.addEventListener('click', function () {
        tf.cropMode = b.getAttribute('data-crop');
        cropSegs.forEach(function (x) { x.classList.toggle('on', x === b); });
        syncSubCtl(); updateOutSize(); markStale();
      });
    });
    // V0.2.8：比例裁剪改为分段按钮组
    if (cropRatioBtns) cropRatioBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        tf.cropRatio = b.getAttribute('data-ratio');
        cropRatioBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
        updateOutSize(); markStale();
      });
    });
    [[mTop, 'mTop'], [mBottom, 'mBottom'], [mLeft, 'mLeft'], [mRight, 'mRight']].forEach(function (p) {
      if (p[0]) {
        p[0].addEventListener('input', function () {
          normalizeIntInput(p[0], 0, 0, 20000, false);
          tf[p[1]] = numOr(p[0], 0, 0, 20000); updateOutSize(); markStale();
        });
        p[0].addEventListener('blur', function () {
          normalizeIntInput(p[0], 0, 0, 20000, true);
          tf[p[1]] = numOr(p[0], 0, 0, 20000); updateOutSize(); markStale();
        });
      }
    });

    // V0.2.8：数字步进器 圆形[−] [input] 圆形[+]；V0.2.11：data-qstep 按钮走质量专属逻辑
    // V0.4优化：步进值强制取整，避免产生小数
    document.querySelectorAll('.step-btn').forEach(function (btn) {
      if (btn.hasAttribute('data-qstep')) return;
      btn.addEventListener('click', function () {
        var targetId = btn.getAttribute('data-for');
        var target = $(targetId);
        if (!target) return;
        var step = parseInt(btn.getAttribute('data-step'), 10) || 1;
        var val = (parseInt(target.value, 10) || 0) + step;
        var min = parseInt(target.getAttribute('min'), 10), max = parseInt(target.getAttribute('max'), 10);
        if (Number.isFinite(min) && val < min) val = min;
        if (Number.isFinite(max) && val > max) val = max;
        target.value = String(val);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    // V0.2.11：质量滑块两侧圆形步进钮（±1，夹取 1-100，派发 input 复用联动逻辑）
    document.querySelectorAll('[data-qstep]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!qualityEl) return;
        var d = parseInt(btn.getAttribute('data-qstep'), 10) || 1;
        var v = Math.max(1, Math.min(100, (parseInt(qualityEl.value, 10) || 80) + d));
        qualityEl.value = String(v);
        qualityEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    // ---- V0.2：重置 ----
    if (resetBtn) resetBtn.addEventListener('click', function () {
      resetTf(); syncUIFromTf(); syncSubCtl(); updateOutSize(); markStale();
    });

    // ---- V0.2.8：高级编辑总开关 ----
    if (advSwitch) advSwitch.addEventListener('change', function () {
      tf.advEnabled = advSwitch.checked;
      setHidden(advBody, !tf.advEnabled);
      // 关闭时当前 UI 值保留，但 collectOpts 会忽略 crop；预览实时刷新
      updateOutSize(); markStale();
    });

    // 操作按钮
    if (processBtn) processBtn.addEventListener('click', process);
    if (cancelBtn) cancelBtn.addEventListener('click', function () { cancelFlag = true; });
    if (zipBtn) zipBtn.addEventListener('click', downloadZip);
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    // V0.3：拖入区画廊态的继续添加 / 重置
    if (addMoreBtn) addMoreBtn.addEventListener('click', function (e) {
      e.stopPropagation(); if (fileInput && !processing) fileInput.click();
    });
    if (dzResetBtn) dzResetBtn.addEventListener('click', function (e) {
      e.stopPropagation(); if (!processing) doClear();
    });

    // V0.2.2：结果列表统一事件委托（下载 / 单删 / 错误详情展开）
    // V0.4：缩略图点击 → 打开预览/对比模态框
    if (resultList) resultList.addEventListener('click', function (e) {
      /* 缩略图点击 → 打开对比 */
      var thumb = e.target && e.target.closest ? e.target.closest('.r-thumb') : null;
      if (thumb) {
        var row = thumb.closest('.result-row');
        if (row) {
          var dlBtn = row.querySelector('[data-dl]');
          if (dlBtn) openCompare(parseInt(dlBtn.getAttribute('data-dl'), 10), thumb);
        }
        return;
      }
      var t = e.target && e.target.closest ? e.target.closest('[data-dl],[data-rm],[data-why]') : null;
      if (!t) return;
      if (t.hasAttribute('data-dl')) {
        var id = parseInt(t.getAttribute('data-dl'), 10);
        for (var i = 0; i < queue.length; i++) {
          if (queue[i].id === id && queue[i].blob) { downloadOne(queue[i]); break; }
        }
      } else if (t.hasAttribute('data-rm')) {
        removeOne(parseInt(t.getAttribute('data-rm'), 10));
      } else {
        var rec = rowMap[parseInt(t.getAttribute('data-why'), 10)];
        if (rec) {
          rec.open = !rec.open;
          setHidden(rec.errText, !rec.open);
          rec.errWhy.setAttribute('aria-expanded', rec.open ? 'true' : 'false');
        }
      }
    });

    // 语言切换时刷新动态文案（i18n.js 已先更新 currentLang）
    // V0.3.2：本页语种控件是 .lang-item 下拉（无 #langBtn），旧钩子从未触发过 → 两种控件都监听
    var langBtn = $('langBtn');
    if (langBtn) langBtn.addEventListener('click', function () { setTimeout(refreshDynamic, 0); });
    document.querySelectorAll('.lang-item').forEach(function (li) {
      li.addEventListener('click', function () { setTimeout(refreshDynamic, 0); });
    });

    syncUIFromTf(); syncSubCtl(); updateOutSize(); refreshDynamic();
  }

  /* ---------- V0.2：UI 与参数同步 ---------- */
  function syncSubCtl() {
    if (sizePercentCtl) setHidden(sizePercentCtl, (tf.sizeMode !== 'percent'));
    if (sizeLongestCtl) setHidden(sizeLongestCtl, (tf.sizeMode !== 'longest'));
    if (sizeExactCtl) setHidden(sizeExactCtl, (tf.sizeMode !== 'exact'));
    if (advBody) setHidden(advBody, !tf.advEnabled);
    if (cropRatioCtl) setHidden(cropRatioCtl, (tf.cropMode !== 'ratio' || !tf.advEnabled));
    if (cropFreeCtl) setHidden(cropFreeCtl, (tf.cropMode !== 'free' || !tf.advEnabled));
  }

  function syncUIFromTf() {
    // V0905 规范组件：分段组为 .segment（label.seg > input radio），选中态由 :checked 驱动，
    // 程序化同步时必须同时设 radio.checked（.on 类仅为旧版兼容保留，无样式作用）。
    function syncSegChecked(label, on) {
      if (!label) return;
      label.classList.toggle('on', on);
      var ci = label.querySelector('input[type=radio],input[type=checkbox]');
      if (ci) ci.checked = !!on;
    }
    if (sizeSegs) sizeSegs.forEach(function (x) {
      syncSegChecked(x, x.getAttribute('data-size') === tf.sizeMode);
    });
    if (rotSegs) rotSegs.forEach(function (x) {
      syncSegChecked(x, String(tf.rotate) === x.getAttribute('data-rot'));
    });
    if (cropSegs) cropSegs.forEach(function (x) {
      syncSegChecked(x, x.getAttribute('data-crop') === tf.cropMode);
    });
    syncSegChecked(flipHBtn, !!tf.flipH);
    syncSegChecked(flipVBtn, !!tf.flipV);
    if (sizePercent) sizePercent.value = tf.percent;
    if (sizeLongest) sizeLongest.value = tf.longest;
    if (sizeW) sizeW.value = tf.width;
    if (sizeH) sizeH.value = tf.height;
    if (keepRatio) keepRatio.checked = !!tf.keepRatio;
    if (cropRatioBtns) cropRatioBtns.forEach(function (x) {
      syncSegChecked(x, x.getAttribute('data-ratio') === tf.cropRatio);
    });
    if (mTop) mTop.value = tf.mTop;
    if (mBottom) mBottom.value = tf.mBottom;
    if (mLeft) mLeft.value = tf.mLeft;
    if (mRight) mRight.value = tf.mRight;
    if (advSwitch) advSwitch.checked = !!tf.advEnabled;
  }

  /* 收集变换参数，交给 transform.js */
  function collectOpts() {
    // 高级编辑总开关关闭时，忽略裁剪参数（翻转已移出高级编辑，始终生效）
    var adv = !!tf.advEnabled;
    return {
      cropMode: adv ? tf.cropMode : 'none',
      cropRatio: adv ? tf.cropRatio : '1:1',
      margins: adv
        ? { top: tf.mTop, right: tf.mRight, bottom: tf.mBottom, left: tf.mLeft }
        : { top: 0, right: 0, bottom: 0, left: 0 },
      rotate: tf.rotate,
      flipH: tf.flipH,
      flipV: tf.flipV,
      sizeMode: tf.sizeMode,
      percent: tf.percent,
      longest: tf.longest,
      width: tf.width,
      height: tf.height,
      keepRatio: tf.keepRatio
    };
  }

  /* 输出尺寸预览（V0905b 移入结果表格"尺寸"列：每行随参数实时刷新） */
  function dimText(it) {
    if (!it.iw || !it.ih || !window.MotefulTransform) return '—';
    var s = window.MotefulTransform.previewSize(it.iw, it.ih, collectOpts());
    return s.w + ' × ' + s.h;
  }
  function updateOutSize() {
    queue.forEach(function (it) {
      var rec = rowMap[it.id];
      if (rec && rec.dim) rec.dim.textContent = dimText(it);
    });
  }

  /* ---------- 导入（F1 / V0.2.2：细分计数 + mini 态） ---------- */
  function addFiles(fileList) {
    if (processing) { flashNote(tr('v01_processing'), 'warning'); return; }   // 处理中锁定导入
    cancelWipe();   // V0.3：导入新图片时取消自动清除
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var added = 0, dup = 0, bad = 0, heic = 0;
    var seen = {};
    var wasEmpty = !queue.length;   // V0.3.3：记录本次导入是否让队列从空变非空
    queue.forEach(function (it) { seen[it.file.name + '|' + it.file.size + '|' + it.file.lastModified] = true; });

    files.forEach(function (f) {
      var key = f.name + '|' + f.size + '|' + f.lastModified;
      if (/image\/heic/i.test(f.type) || /\.heic$/i.test(f.name)) { heic++; return; }   // HEIC 暂不支持
      if (!/^image\//i.test(f.type)) { bad++; return; }                                 // 非图片过滤
      if (seen[key]) { dup++; return; }                                                 // 重复去重
      seen[key] = true;
      queue.push({
        id: ++uid, file: f, name: f.name, size: f.size, iw: 0, ih: 0,
        status: 'ready', blob: null, newSize: 0, thumb: '', outName: '', err: ''
      });
      makeThumb(queue[queue.length - 1]);
      added++;
    });

    // V0.2.2：细分计数提示（各自只在 >0 时出现）
    var parts = [];
    if (added) parts.push(trn('v022_import_added', added));
    if (dup) parts.push(trn('v022_import_dup', dup));
    if (bad) parts.push(trn('v022_import_bad', bad));
    if (heic) parts.push(tr('v01_heic_note'));
    if (parts.length) flashNote(parts.join(' · '), 'info');

    // V0.3.3：队列从空变非空时，把当前参数签名记为导入基线——
    // 参数与基线一致且从未处理过 → 「开始处理」禁用（点了也只是原样重编码）
    if (wasEmpty && added) baseSig = paramSig();

    syncEmptyState();
    renderQueue(); updateOutSize(); refreshDynamic();
  }

  /* V0.3：空态/非空态切换——拖入区在空态提示与缩略图画廊之间切换，
     控制区/操作条/结果区随显隐 */
  function syncEmptyState() {
    var empty = !queue.length;
    if (dropzone) dropzone.classList.toggle('mini', !empty);
    if (dzEmpty) setHidden(dzEmpty, !empty);
    if (dzGallery) setHidden(dzGallery, empty);
    if (controls) setHidden(controls, empty);
    if (actions) setHidden(actions, empty);
    if (results) setHidden(results, empty);
    renderDropzone();
  }

  /* V0.3：拖入区缩略图画廊（大于结果区 40px 缩略图，每张可点 X 删除） */
  function renderDropzone() {
    if (!dzGalleryList) return;
    var alive = {};
    queue.forEach(function (it) { alive[it.id] = true; });
    var existing = {}, toRemove = [];
    Array.prototype.forEach.call(dzGalleryList.children, function (el) {
      var id = parseInt(el.getAttribute('data-id'), 10);
      if (!alive[id]) toRemove.push(el); else existing[id] = el;
    });
    toRemove.forEach(function (el) { el.remove(); });
    queue.forEach(function (it) {
      var el = existing[it.id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'dz-thumb';
        el.setAttribute('data-id', it.id);
        el.setAttribute('title', it.name);
        el.innerHTML = '<img alt="">' +
          '<button type="button" class="dz-rm" aria-label="' + esc(tr('v022_remove')) + '"><i data-lucide="x"></i></button>';
        el.querySelector('.dz-rm').addEventListener('click', function (e) {
          e.stopPropagation();
          if (!processing) removeOne(it.id);
        });
        dzGalleryList.appendChild(el);
      }
      var img = el.querySelector('img');
      if (it.thumb) img.src = it.thumb;
      else img.removeAttribute('src');
    });
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
    if (dzCount) dzCount.textContent = queue.length ? trn('v022_dz_count', queue.length) : tr('v01_empty');
  }

  function makeThumb(item) {
    var url = URL.createObjectURL(item.file);
    var img = new Image();
    img.onload = function () {
      item.iw = img.width; item.ih = img.height;      // 记录原始尺寸，供输出尺寸预览使用
      var s = 80, c = document.createElement('canvas');
      c.width = s; c.height = s;
      var ctx = c.getContext('2d');
      var r = Math.min(img.width, img.height) || 1;
      var sx = (img.width - r) / 2, sy = (img.height - r) / 2;
      ctx.drawImage(img, sx, sy, r, r, 0, 0, s, s);
      try { item.thumb = c.toDataURL('image/png'); } catch (e) { item.thumb = ''; }
      URL.revokeObjectURL(url);
      renderQueue(); renderDropzone(); updateOutSize();
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  }

  /* ---------- 渲染结果列表（F5 / V0.2.2 行卡片增量更新） ----------
     行 DOM 按 id 缓存在 rowMap；重复渲染只 patch 变化内容，
     不再整表 innerHTML 重建（避免缩略图闪烁与事件重复绑定）。
     事件统一由 resultList 上的委托处理（见 init）。 */
  /* V0905：[hidden] 会被组件自身 display 规则覆盖（moteful.css 框架缺口，见页面缺失清单第 1 条），
     统一走 setHidden 以 style.display 兜底，行为与 hidden 属性语义一致。 */
  function setHidden(el, on) {
    if (!el) return;
    el.hidden = !!on;
    if (on) el.style.display = 'none'; else el.style.removeProperty('display');
  }

  function statusText(st) {
    return st === 'done' ? tr('v01_status_done')
      : st === 'error' ? tr('v01_status_error')
      : st === 'processing' ? tr('v01_status_processing')
      : tr('v01_status_ready');
  }

  function buildRow(it) {
    /* V0905 规范映射：结果队列 = .table 数据表格行（规范 14 章 DATA）；
       缩略图/文件名/大小(mono)/状态(.tag)/操作(.btn-ghost.btn-sm + .btn-icon)。 */
    var row = document.createElement('tr');
    row.className = 'result-row';
    row.innerHTML =
      '<td><span class="row"><img class="r-thumb" width="40" height="40" alt="" hidden><span class="r-name"></span></span>' +
        '<span class="r-err" hidden>' +
          '<button type="button" class="err-why" data-why="' + it.id + '" aria-expanded="false"></button>' +
          '<span class="err-text muted" hidden></span>' +
        '</span>' +
      '</td>' +
      '<td class="mono">' +
        '<span class="r-orig"></span> <span class="r-arrow">→</span> <span class="r-new"></span> <span class="r-rate"></span>' +
      '</td>' +
      '<td><span class="r-status"></span></td>' +
      '<td class="mono"><span class="r-dim">—</span></td>' +
      '<td class="r-side">' +
        '<span class="r-acts">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-dl="' + it.id + '"><i data-lucide="download"></i><span class="r-dl-txt"></span></button>' +
          '<button type="button" class="btn btn-icon btn-sm" data-rm="' + it.id + '" aria-label="remove"><i data-lucide="x"></i></button>' +
        '</span>' +
      '</td>';
    rowMap[it.id] = {
      root: row,
      thumb: row.querySelector('.r-thumb'),
      dim: row.querySelector('.r-dim'),
      name: row.querySelector('.r-name'),
      orig: row.querySelector('.r-orig'),
      newEl: row.querySelector('.r-new'),
      rate: row.querySelector('.r-rate'),
      status: row.querySelector('.r-status'),
      errBox: row.querySelector('.r-err'),
      errWhy: row.querySelector('.err-why'),
      errText: row.querySelector('.err-text'),
      dlBtn: row.querySelector('[data-dl]'),
      dlTxt: row.querySelector('.r-dl-txt'),
      rmBtn: row.querySelector('[data-rm]'),
      open: false
    };
    resultList.appendChild(row);
    if (window.MF && MF.refreshIcons) MF.refreshIcons();   // 动态行图标走 moteful.js 内置库
  }

  function updateRow(it) {
    var rec = rowMap[it.id];
    if (!rec) return;
    var isDone = it.status === 'done';
    var cls = isDone ? 'done' : it.status === 'error' ? 'error'
      : it.status === 'processing' ? 'processing' : 'ready';
    if (it.thumb) { rec.thumb.src = it.thumb; rec.thumb.hidden = false; }
    else rec.thumb.hidden = true;
    rec.name.textContent = it.name;
    rec.name.title = it.name;
    rec.orig.textContent = formatBytes(it.size);
    rec.newEl.textContent = isDone ? formatBytes(it.newSize) : '—';
    if (isDone && it.size > 0) {
      var rate = calcRate(it);
      if (Math.abs(rate) < 0.1) {
        rec.rate.textContent = tr('v01_rate_same');
        rec.rate.className = 'r-rate';
      } else if (rate > 0) {
        /* 变小：绿色双向下箭头 chevrons-down */
        rec.rate.innerHTML = '<svg class="rate-icon" viewBox="0 0 24 24"><path d="m7 13 5 5 5-5"/><path d="m7 6 5 5 5-5"/></svg>' + rate.toFixed(1) + '%';
        rec.rate.className = 'r-rate rate-down';
      } else {
        /* 变大：红色双向上箭头 chevrons-up */
        rec.rate.innerHTML = '<svg class="rate-icon" viewBox="0 0 24 24"><path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/></svg>' + Math.abs(rate).toFixed(1) + '%';
        rec.rate.className = 'r-rate rate-up';
      }
    } else {
      rec.rate.textContent = '—';
      rec.rate.className = 'r-rate';
    }
    if (rec.dim) rec.dim.textContent = dimText(it);
    rec.status.textContent = statusText(it.status);
    rec.status.className = 'tag ' + (isDone ? 't-success'
      : it.status === 'error' ? 't-danger'
      : it.status === 'processing' ? 't-blue' : 't-gray');
    rec.dlTxt.textContent = tr('v01_dl');
    setHidden(rec.dlBtn, !(isDone && it.blob));
    setHidden(rec.rmBtn, (it.status === 'processing'));            // 处理中禁止删除
    rec.rmBtn.setAttribute('aria-label', tr('v022_remove'));    // 动态行 aria 走集中源
    setHidden(rec.errBox, (it.status !== 'error'));
    if (it.status === 'error') {
      rec.errText.textContent = it.err || tr('v022_err_unknown');
      rec.errWhy.textContent = tr('v022_err_why');
      setHidden(rec.errText, !rec.open);
      rec.errWhy.setAttribute('aria-expanded', rec.open ? 'true' : 'false');
    }
    rec.root.setAttribute('aria-label', it.name + ' — ' + statusText(it.status));
  }

  function renderQueue() {
    if (!resultList) return;
    var alive = {};
    queue.forEach(function (it) { alive[it.id] = true; });
    Object.keys(rowMap).forEach(function (id) {
      if (!alive[id]) {
        if (rowMap[id].root.parentNode) rowMap[id].root.remove();
        delete rowMap[id];
      }
    });
    queue.forEach(function (it) {
      if (!rowMap[it.id]) buildRow(it);
      updateRow(it);
    });
  }

  function refreshDynamic() {
    if (countLabel) countLabel.textContent = queue.length ? trn('v01_count', queue.length) : tr('v01_empty');
    if (totalSaved) {
      var saved = 0;
      queue.forEach(function (it) { if (it.status === 'done') saved += (it.size - it.newSize); });
      totalSaved.textContent = saved > 0 ? trn('v01_total_saved', formatBytes(saved)) : '';
      setHidden(totalSaved, !(saved > 0));   // 空态不显示空 tag 色块
    }
    if (qualityVal) qualityVal.textContent = quality + '%';
    // 已有完成结果 → 按钮文案改"重新处理 N 张"；参数变更后已完成项会自动标回待处理
    if (processBtn) {
      var btnTxt = processBtn.querySelector('[data-i18n]');
      if (btnTxt) {
        var doneN = 0;
        queue.forEach(function (it) { if (it.status === 'done') doneN++; });
        btnTxt.textContent = doneN ? trn('v021_restart', doneN) : tr('v01_process');
      }
      // V0.3.3/V0.3.4：禁用判定——处理中 / 队列空 / 没有待处理项 / 从未处理且参数与导入基线一致且全部为 PNG。
      // 语义：全 PNG 未改参数时点「开始处理」只会原样重编码（还可能变大）→ 置灰；
      // 队列中出现 PNG 以外的格式（JPG/WebP 等）→ 未改参数也启用（默认压缩有收益）。
      var pendingN = 0;
      queue.forEach(function (it) { if (it.status === 'ready' || it.status === 'error') pendingN++; });
      var pristine = (lastSig === '') && (paramSig() === baseSig) && allPng();
      processBtn.disabled = processing || !queue.length || !pendingN || pristine;
    }
    // ZIP 按钮：有可下载结果才可用（打包中不抢控制权）
    if (zipBtn && !zipping) {
      var anyBlob = false;
      queue.forEach(function (it) { if (it.status === 'done' && it.blob) anyBlob = true; });
      zipBtn.disabled = !anyBlob;
    }
    // 清空按钮处于二次确认态时，语言切换后仍显示确认文案
    if (clearArmed && clearBtn) {
      var cs = clearBtn.querySelector('span');
      if (cs) cs.textContent = tr('v022_confirm_clear');
    }
    renderQueue(); updateOutSize();
    renderDropzone();   // V0.3.2：语言切换后同步画廊计数等动态文案（dzCount 不走 data-i18n 属性系统）
  }

  /* ---------- 预估耗时（V0.2） ---------- */
  var etaStart = 0;
  function etaReset() { etaStart = Date.now(); }
  function formatDur(ms) {
    var s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return trn('v02_eta_sec', s);
    return String(tr('v02_eta_min')).replace('{n}', Math.floor(s / 60)).replace('{m}', s % 60);
  }
  function updateETA(done, total) {
    if (!etaTxt) return;
    var remain = total - done;
    if (remain <= 0) { etaTxt.textContent = ''; return; }
    if (done <= 0) { etaTxt.textContent = tr('v02_eta_calc'); return; }
    var avg = (Date.now() - etaStart) / done;
    etaTxt.textContent = String(tr('v02_eta')).replace('{s}', formatDur(avg * remain));
  }

  /* ---------- 处理（F2/F3 + V0.2 变换 + V0.2.2 锁定与取消） ---------- */
  function lockUI(on) {
    if (controls) controls.querySelectorAll('input,select,button').forEach(function (el) { el.disabled = on; });
    if (processBtn) processBtn.disabled = on;
    if (zipBtn) zipBtn.disabled = on;
    if (clearBtn) clearBtn.disabled = on;
    if (cancelBtn) setHidden(cancelBtn, !on);
  }

  function process() {
    if (processing) return;
    cancelWipe();   // V0.3：开始处理时取消自动清除
    var pending = queue.filter(function (it) { return it.status === 'ready' || it.status === 'error'; });
    if (!pending.length) return;
    processing = true; cancelFlag = false;
    lastSig = paramSig();          // 记录本次处理所用的参数快照
    lockUI(true);
    if (queue.length > 50) flashNote(tr('v01_warn_big'), 'warning');

    var total = pending.length, idx = 0, batch = 50;
    showProgress(true);
    setProgress(0, tr('v01_processing'));
    etaReset();
    updateETA(0, total);

    function step() {
      if (cancelFlag) { finish(true); return; }
      if (idx >= pending.length) { finish(false); return; }
      var slice = pending.slice(idx, Math.min(idx + batch, pending.length));
      idx = Math.min(idx + batch, pending.length);
      Promise.all(slice.map(processOne)).then(function () {
        setProgress(idx / total, tr('v01_processing') + ' ' + idx + '/' + total);
        updateETA(idx, total);
        setTimeout(step, 0); // 让 UI 喘息，避免大批量卡死
      }).catch(function () { setTimeout(step, 0); });
    }
    step();

    function finish(cancelled) {
      processing = false; cancelFlag = false;
      showProgress(false);
      lockUI(false);
      refreshDynamic();
      // V0.2.2：完成/取消结果提示（含节省量统计）
      var doneN = 0, savedTotal = 0;
      queue.forEach(function (it) {
        if (it.status === 'done') { doneN++; savedTotal += (it.size - it.newSize); }
      });
      if (cancelled) flashNote(trn('v022_cancelled', doneN), 'info');
      else if (doneN && savedTotal > 0) flashNote(trn('v022_done_toast', formatBytes(savedTotal)), 'success');
    }
  }

  /* 单张图片处理核心：加载图片 → 应用变换（缩放/旋转/翻转/裁剪/边距）→ JPG铺白底 → 导出Blob
     处理流程：loadImage → MotefulTransform.apply → toBlob，全程在浏览器本地完成 */
  function processOne(it) {
    it.status = 'processing';
    renderQueue();
    return new Promise(function (resolve) {
      var mime = (fmt === 'keep') ? (it.file.type || 'image/jpeg') : fmt;
      if (fmt === 'keep' && !/^image\/(jpeg|png|webp)$/i.test(mime)) mime = 'image/jpeg';
      var q = Math.max(0.01, Math.min(1, quality / 100));
      function fail(reason) { it.status = 'error'; it.err = reason; renderQueue(); resolve(); }

      loadImage(it.file).then(function (img) {
        var canvas;
        try {
          if (window.MotefulTransform) {
            canvas = window.MotefulTransform.apply(img, collectOpts());
          } else {
            canvas = document.createElement('canvas');
            canvas.width = img.width || 1; canvas.height = img.height || 1;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        } catch (e) {
          releaseImg(img);
          fail(tr('v022_err_unknown')); return;
        }

        // JPG 不支持透明，先铺白底，避免透明区变黑
        var out = canvas;
        if (mime === 'image/jpeg') {
          out = document.createElement('canvas');
          out.width = canvas.width; out.height = canvas.height;
          var c2 = out.getContext('2d');
          c2.fillStyle = '#fff';
          c2.fillRect(0, 0, out.width, out.height);
          c2.drawImage(canvas, 0, 0);
        }
        releaseImg(img);

        out.toBlob(function (blob) {
          if (!blob) { fail(tr('v022_err_unknown')); return; }
          it.blob = blob; it.newSize = blob.size;
          it.outName = uniqueName(baseName(it.name) + extFor(mime, it.name));
          it.status = 'done'; it.err = '';
          renderQueue();
          resolve();
        }, mime, q);
      }).catch(function () {
        fail(tr('v022_err_decode'));
      });
    });
  }

  function releaseImg(img) { if (img && img.close) { try { img.close(); } catch (e) {} } }

  /* 图片加载：优先用 createImageBitmap（现代浏览器，更快），失败降级到 Image 对象 */
  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return legacyLoad(file); });
    }
    return legacyLoad(file);
  }
  function legacyLoad(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }

  function uniqueName(name) {
    if (!usedNames[name]) { usedNames[name] = 1; return name; }
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var i = 2;
    while (usedNames[base + ' (' + i + ')' + ext]) i++;
    var out = base + ' (' + i + ')' + ext;
    usedNames[out] = 1;
    return out;
  }

  /* ---------- 进度条 ---------- */
  function showProgress(on) { if (progressWrap) setHidden(progressWrap, !on); }
  function setProgress(p, txt) {
    if (progressFill) progressFill.style.width = Math.round(p * 100) + '%';
    if (progressTxt) progressTxt.textContent = txt;
    if (progressWrap) progressWrap.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  /* ---------- V0.4 功能一：预览/对比模态框 ---------- */
  var compareUrls = [];  /* 对比模态框用的 blob URL，关闭时释放 */
  /* 打开预览/对比模态框：收集已完成项的前后对比图，调用 MFCompare 模块展示
     支持单张放大预览和左右拖动对比两种模式，关闭时释放所有 blob URL */
  function openCompare(activeId, triggerEl) {
    if (!window.MFCompare) return;
    /* 先释放上次的 URL */
    compareUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    compareUrls = [];
    var items = [];
    var activeIndex = 0;
    queue.forEach(function (it) {
      if (it.status === 'done' && it.blob && it.file) {
        var beforeUrl = URL.createObjectURL(it.file);
        var afterUrl = URL.createObjectURL(it.blob);
        compareUrls.push(beforeUrl, afterUrl);
        /* 变化率文本（单箭头+颜色class，与结果列表一致） */
        var rateText = '';
        var rateClass = '';
        if (it.size > 0) {
          var rate = calcRate(it);
          if (Math.abs(rate) >= 0.1) {
            rateText = (rate > 0 ? '↓ ' : '↑ ') + Math.abs(rate).toFixed(1) + '%';
            rateClass = rate > 0 ? 'rate-down' : 'rate-up';
          }
        }
        items.push({
          id: it.id,
          name: it.name,
          origSize: formatBytes(it.size),
          newSize: formatBytes(it.newSize),
          rateText: rateText,
          rateClass: rateClass,
          dim: dimText(it),
          beforeUrl: beforeUrl,
          afterUrl: afterUrl
        });
        if (it.id === activeId) activeIndex = items.length - 1;
      }
    });
    if (items.length === 0) return;
    /* 关闭时释放 URL */
    window.MFCompare.onClose = function () {
      compareUrls.forEach(function (u) { URL.revokeObjectURL(u); });
      compareUrls = [];
    };
    window.MFCompare.open(items, activeIndex, triggerEl);
  }

  /* ---------- 下载（F4） ---------- */
  function downloadOne(it) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(it.blob);
    a.download = it.outName || it.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    scheduleWipe(it.id);   // V0.3：单张下载后 5 秒清除该张记录
    if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_download' });
  }

  function downloadZip() {
    if (zipping) return;                                   // V0.2.2：防双击
    var done = queue.filter(function (it) { return it.status === 'done' && it.blob; });
    if (!done.length) return;
    zipping = true;
    if (zipBtn) {
      zipBtn.disabled = true;
      var zt = zipBtn.querySelector('[data-i18n]');
      if (zt) zt.textContent = tr('v022_zipping');
    }
    Promise.all(done.map(function (it) {
      return it.blob.arrayBuffer().then(function (ab) {
        return { name: it.outName || it.name, data: new Uint8Array(ab) };
      });
    })).then(function (files) {
      var blob = window.MotefulZip ? window.MotefulZip.build(files) : null;
      if (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'moteful-images.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        scheduleWipe(null);   // V0.3：ZIP 下载后 5 秒全量清除
        if (window.Moteful && window.Moteful.recommend) window.Moteful.recommend.show({ actionKey: 'rec_export' });
      }
      zipping = false;
      if (zipBtn) {
        var zt2 = zipBtn.querySelector('[data-i18n]');
        if (zt2) zt2.textContent = tr('v01_zip');
      }
      refreshDynamic();
    });
  }

  /* ---------- 清空（V0.2.2：二次点击确认，3 秒超时还原） ---------- */
  function clearAll() {
    if (processing) return;
    if (!queue.length) return;
    if (!clearArmed) {
      clearArmed = true;
      var s = clearBtn ? clearBtn.querySelector('span') : null;
      if (s) s.textContent = tr('v022_confirm_clear');
      clearTimer = setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    doClear();
  }
  function disarmClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    var s = clearBtn ? clearBtn.querySelector('span') : null;
    if (s) s.textContent = tr('v01_clear');
  }
  function doClear() {
    queue = []; usedNames = {}; uid = 0; lastSig = ''; rowMap = {};
    baseSig = '';   // V0.3.3：清空后重置导入基线
    if (resultList) resultList.innerHTML = '';
    showProgress(false);
    resetTf(); syncUIFromTf(); syncSubCtl();
    syncEmptyState(); renderQueue(); updateOutSize(); refreshDynamic();
    /* V0.4：对比模态框联动清除 */
    if (window.MFCompare) window.MFCompare.clearAll();
  }

  /* ---------- V0.3：下载后自动清除记录 ---------- */
  /* 计划自动擦除：下载后启动5秒倒计时，期间用户可继续操作，超时后清除对应记录
     targetId 为单张图片ID时只擦除该张；为 null 时全量清除（ZIP下载后） */
  function scheduleWipe(targetId) {
    cancelWipe();
    wipeTargetId = targetId;
    flashNote(tr('v03_wipe_scheduled'), 'warning');
    wipeTimer = setTimeout(doWipe, 5000);
  }
  function cancelWipe() {
    if (wipeTimer) {
      clearTimeout(wipeTimer);
      wipeTimer = 0;
      wipeTargetId = null;
    }
  }
  /* 执行自动擦除：释放 blob 内存 + 清除队列记录，只擦除浏览器内存中的处理结果
     不影响用户电脑上的原始文件（原始文件从未被读取修改，只在导入时创建了引用） */
  function doWipe() {
    wipeTimer = 0;
    if (wipeTargetId === null) {
      // 全量清除：ZIP 下载后
      queue.forEach(function (it) { if (it.blob) it.blob = null; });
      doClear();
      flashNote(tr('v03_wipe_done_all'), 'success');
      /* V0.4：对比模态框联动清除 */
      if (window.MFCompare) window.MFCompare.clearAll();
    } else {
      // 单张清除：单张下载后，只清该张处理结果，原始文件保留
      var id = wipeTargetId;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].id === id) {
          var it = queue[i];
          if (it.blob) it.blob = null;
          it.newSize = 0; it.outName = ''; it.status = 'ready'; it.err = '';
          break;
        }
      }
      if (rowMap[id] && rowMap[id].root && rowMap[id].root.parentNode) {
        rowMap[id].root.parentNode.removeChild(rowMap[id].root);
      }
      delete rowMap[id];
      // 重算节省量统计
      refreshDynamic();
      flashNote(tr('v03_wipe_done_one'), 'success');
      /* V0.4：对比模态框联动清除单张 */
      if (window.MFCompare) window.MFCompare.removeItem(id);
    }
    wipeTargetId = null;
  }

  /* ---------- 单张删除（V0.2.2） ---------- */
  function removeOne(id) {
    if (processing) return;
    var idx = -1;
    for (var i = 0; i < queue.length; i++) { if (queue[i].id === id) { idx = i; break; } }
    if (idx < 0) return;
    var it = queue[idx];
    queue.splice(idx, 1);
    if (it.outName && usedNames[it.outName]) delete usedNames[it.outName];  // 释放重名占位
    if (!queue.length) { baseSig = ''; lastSig = ''; }   // V0.3.3：删空后重置基线，下次导入重新捕获
    syncEmptyState(); renderQueue(); updateOutSize(); refreshDynamic();
  }

  /* ---------- 临时提示：V0.9 收口到全站统一 Toast（moteful.js -> window.toast） ----------
     原先自建 #v01Note 元素、自定 6 秒时长与位置，与其它页提示风格/位置/时长不一致；
     现统一为四态（success/danger/warning/info）+ 顶部居中浮层 + 统一动画时长。 */
  function flashNote(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type || 'info');
  }

  /* V0905：[hidden] 框架缺口兜底——初始态对带自身 display 的容器激活 style.display
     （moteful.css 无 [hidden]{display:none!important}，见页面缺失清单第 1 条） */
  function initHiddenGuard() {
    [controls, actions, results, progressWrap, advBody, cancelBtn, pngNote, totalSaved].forEach(function (el) {
      if (el && el.hidden) setHidden(el, true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHiddenGuard);
  else initHiddenGuard();

  /* V0.3：关页面兜底清除（静默，不弹提示） */
  window.addEventListener('pagehide', function () {
    try {
      saveConfigNow();  // V0.4：配置记忆 - 关页面前强制保存配置
      queue.forEach(function (it) { if (it.blob) it.blob = null; });
      queue = [];
    } catch (e) {}
  });
})();
