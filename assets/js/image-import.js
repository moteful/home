/*
 * Moteful 图片导入与队列管理组件（V0.5 拼接功能共用）
 * 职责：文件导入、去重、格式校验、图片加载、缩略图生成、队列管理、排序
 * 纯逻辑模块，不直接操作 DOM；通过回调通知外部更新 UI。
 * 零外部请求，所有图片在浏览器本地处理。
 *
 * 铁律：所有展示文案走 i18n 集中源，本文件不含硬编码文案。
 */
(function () {
  'use strict';

  /* ---------- 工具函数 ---------- */
  function isSupportedImage(file) {
    if (!file) return false;
    if (/^image\/(png|jpeg|webp)$/i.test(file.type)) return true;
    if (/\.(png|jpe?g|webp)$/i.test(file.name || '')) return true;
    return false;
  }
  function isHeic(file) {
    if (!file) return false;
    return /image\/heic/i.test(file.type) || /\.heic$/i.test(file.name || '');
  }
  function fileKey(file) {
    return file.name + '|' + file.size + '|' + file.lastModified;
  }
  function genId() {
    return 'img_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  }

  /* ---------- 图片加载 ---------- */
  function loadImageFile(file) {
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

  /* ---------- 缩略图生成（64px 正方形居中裁剪） ---------- */
  function makeThumbnail(img, size) {
    size = size || 64;
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    var r = Math.min(img.width || 1, img.height || 1);
    var sx = (img.width - r) / 2, sy = (img.height - r) / 2;
    ctx.drawImage(img, sx, sy, r, r, 0, 0, size, size);
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }

  /* ---------- 队列管理 ---------- */
  function ImageImport(opts) {
    opts = opts || {};
    this.queue = [];           // {id, file, name, size, type, img, width, height, thumbUrl, status}
    this.onChange = opts.onChange || function () {};
    this.onImport = opts.onImport || function () {};   // (added, dup, bad, heic)
    this.onError = opts.onError || function () {};
    this._seen = {};
  }

  ImageImport.prototype.addFiles = function (fileList) {
    var self = this;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var added = 0, dup = 0, bad = 0, heic = 0;
    var toLoad = [];

    files.forEach(function (f) {
      if (isHeic(f)) { heic++; return; }
      if (!isSupportedImage(f)) { bad++; return; }
      var key = fileKey(f);
      if (self._seen[key]) { dup++; return; }
      self._seen[key] = true;
      var item = {
        id: genId(), file: f, name: f.name, size: f.size, type: f.type,
        img: null, width: 0, height: 0, thumbUrl: '', status: 'loading'
      };
      self.queue.push(item);
      toLoad.push(item);
      added++;
    });

    if (added > 0) {
      this.onChange();
      // 并行加载（限制并发 4）
      this._loadWithConcurrency(toLoad, 4);
    }
    this.onImport(added, dup, bad, heic);
  };

  ImageImport.prototype._loadWithConcurrency = function (items, limit) {
    var self = this;
    var idx = 0;
    function next() {
      if (idx >= items.length) return;
      var batch = items.slice(idx, idx + limit);
      idx += limit;
      Promise.all(batch.map(function (item) {
        return loadImageFile(item.file).then(function (img) {
          item.img = img;
          item.width = img.width || img.naturalWidth || 0;
          item.height = img.height || img.naturalHeight || 0;
          item.thumbUrl = makeThumbnail(img, 64);
          item.status = 'ready';
        }).catch(function () {
          item.status = 'error';
        });
      })).then(function () {
        self.onChange();
        if (idx < items.length) setTimeout(next, 0);
      });
    }
    next();
  };

  ImageImport.prototype.remove = function (id) {
    var idx = -1;
    for (var i = 0; i < this.queue.length; i++) {
      if (this.queue[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    var item = this.queue[idx];
    var key = fileKey(item.file);
    delete this._seen[key];
    if (item.img && item.img.close) { try { item.img.close(); } catch (e) {} }
    this.queue.splice(idx, 1);
    this.onChange();
  };

  ImageImport.prototype.clear = function () {
    var self = this;
    this.queue.forEach(function (item) {
      if (item.img && item.img.close) { try { item.img.close(); } catch (e) {} }
    });
    this.queue = [];
    this._seen = {};
    this.onChange();
  };

  ImageImport.prototype.move = function (fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.queue.length) return;
    if (toIdx < 0 || toIdx >= this.queue.length) return;
    if (fromIdx === toIdx) return;
    var item = this.queue.splice(fromIdx, 1)[0];
    this.queue.splice(toIdx, 0, item);
    this.onChange();
  };

  ImageImport.prototype.swap = function (idxA, idxB) {
    if (idxA < 0 || idxA >= this.queue.length) return;
    if (idxB < 0 || idxB >= this.queue.length) return;
    if (idxA === idxB) return;
    var tmp = this.queue[idxA];
    this.queue[idxA] = this.queue[idxB];
    this.queue[idxB] = tmp;
    this.onChange();
  };

  ImageImport.prototype.getReadyImages = function () {
    return this.queue.filter(function (it) { return it.status === 'ready'; });
  };

  ImageImport.prototype.count = function () {
    return this.queue.length;
  };

  ImageImport.prototype.readyCount = function () {
    return this.getReadyImages().length;
  };

  /* ---------- 暴露全局 ---------- */
  window.MFImageImport = ImageImport;

  /* V1.6 F-02：剪贴板粘贴导入（共享单一实现——粘贴监听只在此处，其他页面经回调启用，严禁重复实现）
     enablePaste(handler)：document paste 只收 image/* 文件；非图片静默忽略；
     位图无文件名 → 生成占位名（paste-N.ext，按 mime 定扩展名）；
     去重 / HEIC 识别 / 处理中锁由页面回调（addFiles）的既有判定链负责，本模块不重复。 */
  var pasteSeq = 0;
  var pasteBound = false;
  function enablePaste(handler) {
    if (pasteBound) return;   // 全局只挂一次监听
    pasteBound = true;
    document.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var items = cd.items;
      var files = cd.files;
      var out = [];
      if (files && files.length) {
        for (var i = 0; i < files.length; i++) {
          if (/^image\//i.test(files[i].type)) out.push(files[i]);
        }
      }
      if (items && !out.length) {
        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          if (it.kind === 'file' && /^image\//i.test(it.type)) {
            var f = it.getAsFile && it.getAsFile();
            if (f) out.push(f);
          }
        }
      }
      if (!out.length) return;   // 非图片静默忽略
      out = out.map(function (f) {
        if (!f.name) {
          pasteSeq++;
          var ext = f.type === 'image/png' ? '.png'
            : f.type === 'image/webp' ? '.webp'
            : f.type === 'image/jpeg' ? '.jpg' : '';
          try { f = new File([f], 'paste-' + pasteSeq + ext, { type: f.type, lastModified: Date.now() }); } catch (e) {}
        }
        return f;
      });
      handler(out);
    });
  }
  window.MFImageImport.enablePaste = enablePaste;

  /* ---------- V1.6.1：HEIC 解码（共享单一实现，其他页面经回调启用，严禁重复实现） ----------
     懒加载：首次检测到 HEIC 才注入本地 vendor 脚本（assets/vendor/heic/heic2any.min.js，
     工具页统一位于 tools/ 一层，相对路径 '../assets/vendor/heic/' 契约成立）；
     解码并发上限 2 排队；成功 → PNG Blob → File(name.png) 回调 onOk(File)；
     解码失败 → onFail(name)；库加载失败 → onUnsupported()（页面回退"暂不支持"提示）。 */
  var heicLibPath = '../assets/vendor/heic/heic2any.min.js';
  var heicPromise = null;      // 库加载 Promise（只加载一次）
  var heicQueue = [];          // 待解码任务
  var heicActive = 0;          // 当前并发数
  var heicLibFailed = false;   // 库加载失败标记（后续任务直接 onUnsupported）
  var HEIC_CONCURRENCY = 2;

  function loadHeicLib() {
    if (heicPromise) return heicPromise;
    heicPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = heicLibPath;
      s.onload = function () { (window.heic2any ? resolve(true) : reject(new Error('missing'))); };
      s.onerror = function () { reject(new Error('load fail')); };
      document.head.appendChild(s);
    }).catch(function (err) {
      heicLibFailed = true;
      throw err;
    });
    return heicPromise;
  }

  function decodeHeicFile(file, onOk, onFail, onUnsupported) {
    heicQueue.push({ file: file, onOk: onOk, onFail: onFail, onUnsupported: onUnsupported });
    pumpHeic();
  }

  function pumpHeic() {
    while (heicActive < HEIC_CONCURRENCY && heicQueue.length) {
      var job = heicQueue.shift();
      heicActive++;
      (function (job) {
        if (heicLibFailed) { heicActive--; job.onUnsupported && job.onUnsupported(); pumpHeic(); return; }
        loadHeicLib().then(function () {
          return window.heic2any({ blob: job.file, toType: 'image/png', quality: 1 });
        }).then(function (out) {
          var blob = Array.isArray(out) ? (out[0] || null) : out;
          if (!blob) throw new Error('empty');
          var base = (job.file.name || 'image').replace(/\.heic$/i, '');
          var f = new File([blob], base + '.png', { type: 'image/png', lastModified: job.file.lastModified || Date.now() });
          job.onOk(f);
        }).catch(function () {
          job.onFail(job.file.name);
        }).then(function () {
          heicActive--;
          pumpHeic();
        });
      })(job);
    }
  }

  window.MFImageImport.decodeHeic = decodeHeicFile;
  window.MFImageImport.loadHeicLib = loadHeicLib;
})();
