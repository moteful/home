/*!
 * Moteful 成果对比卡片（V1.4）— 通用 before/after 合成函数（F-09…F-11、F-14）
 * 纯前端 Canvas 本地合成：before/after 缩略图 + VS + 压缩率 + 内联 SVG 品牌三角标水印。
 * 设计为接收 before / after 两张图的通用函数：image-tool 为首个调用方，
 * stitch / annotate 后续直接复用，不各写一套。
 *
 * 安全红线：水印用内联 SVG 三角标路径绘制（不走 logo-mark.png，
 * 避开 09-23 WAF「含 log 路径误拦」事故），零外部图片请求。
 */
(function () {
  'use strict';

  var BRAND_BLUE = '#0284C7';
  var INK = '#0F172A';
  var PAPER = '#FFFFFF';
  var LINE = '#DCE5F0';

  function tr(key) {
    if (typeof window.t === 'function') {
      var s = window.t(key);
      if (s !== key) return s;
    }
    var d = (window.MOTEFUL_I18N || {})[(window.currentLang === 'zh' ? 'zh' : 'en')] || {};
    return (d[key] != null) ? d[key] : key;
  }

  /* 等比 contain 绘制（大图先缩略到目标框，避免合成卡顿） */
  function drawContain(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var r = Math.min(w / iw, h / ih);
    var dw = iw * r, dh = ih * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function loadImg(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('decode')); };
      img.src = url;
    });
  }

  /* 内联 SVG 品牌三角标（8.3：<svg viewBox="0 0 24 24"><path d="M12 3 L21 20 L3 20 Z"/></svg>） */
  function drawWatermark(ctx, x, y) {
    ctx.save();
    // 三角标（品牌蓝）
    ctx.fillStyle = BRAND_BLUE;
    ctx.beginPath();
    ctx.moveTo(x + 0, y + 16);
    ctx.lineTo(x + 14, y + 16);
    ctx.lineTo(x + 7, y + 2);
    ctx.closePath();
    ctx.fill();
    // 品牌名（深色 14px 档）
    ctx.fillStyle = INK;
    ctx.font = '600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Moteful', x + 20, y + 16);
    ctx.restore();
  }

  /* 合成 1200×600（2:1 横版）对比卡片，返回 Promise<canvas> */
  function create(opts) {
    opts = opts || {};
    var W = 1200, H = 600;
    return Promise.all([loadImg(opts.beforeUrl), loadImg(opts.afterUrl)]).then(function (imgs) {
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');

      // 背景
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      // 顶部品牌线
      ctx.fillStyle = BRAND_BLUE;
      ctx.fillRect(0, 0, W, 6);

      // 布局参数
      var padL = 44, padT = 64, imgW = 500, imgH = 384, imgGap = 56;
      var vsR = 36;

      // 左图标签
      ctx.fillStyle = INK;
      ctx.font = '600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.beforeLabel || tr('compare_before'), padL, 40);

      // 右图标签（右对齐）
      var afterLabel = opts.afterLabel || tr('compare_after');
      ctx.textAlign = 'right';
      ctx.fillText(afterLabel, W - padL, 40);
      ctx.textAlign = 'left';

      // 左图区
      var bx = padL, by = padT;
      ctx.fillStyle = '#F4F7FB';
      ctx.fillRect(bx, by, imgW, imgH);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, imgW, imgH);
      drawContain(ctx, imgs[0], bx, by, imgW, imgH);

      // 右图区
      var ax = padL + imgW + imgGap, ay = by;
      ctx.fillStyle = '#F4F7FB';
      ctx.fillRect(ax, ay, imgW, imgH);
      ctx.strokeRect(ax, ay, imgW, imgH);
      drawContain(ctx, imgs[1], ax, ay, imgW, imgH);

      // VS 圆（居中于两图之间）
      var cx = padL + imgW + imgGap / 2;
      var cy = by + imgH / 2;
      ctx.fillStyle = BRAND_BLUE;
      ctx.beginPath();
      ctx.arc(cx, cy, vsR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VS', cx, cy + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // 底部：压缩率大字（32px 档）
      var saved = opts.savedText || '';
      if (saved) {
        ctx.fillStyle = BRAND_BLUE;
        ctx.font = '700 32px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(saved, W / 2, H - 64);
        ctx.textAlign = 'left';
      }

      // 右下角品牌水印（内联 SVG 三角标 + 文字）
      drawWatermark(ctx, W - 128, H - 52);

      return canvas;
    });
  }

  /* 下载 PNG（文件名含压缩率语义由调用方传入） */
  function download(canvas, filename) {
    canvas.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'moteful-compare.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, 'image/png');
  }

  /* 复制到剪贴板（Canvas → ClipboardItem） */
  function copyToClipboard(canvas) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (blob) {
        if (!blob) { rej(new Error('no-blob')); return; }
        if (navigator.clipboard && window.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(res, rej);
        } else {
          rej(new Error('unsupported'));
        }
      }, 'image/png');
    });
  }

  /* 预览弹窗（复用 modal 组件）：下载 PNG / 复制到剪贴板 / 关闭 */
  function preview(canvas, opts) {
    opts = opts || {};
    // 清理历史实例（Esc 关闭由 moteful.js 处理，仅移除 open 类；此处兜底防 DOM 累积）
    document.querySelectorAll('.share-preview-modal').forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    var box = document.createElement('div');
    box.className = 'modal share-preview-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', tr('compare_card_title'));
    box.innerHTML =
      '<div class="modal-mask" data-share-close></div>' +
      '<div class="modal-card share-preview-card">' +
        '<button type="button" class="modal-x" data-share-close aria-label="close"><i data-lucide="x"></i></button>' +
        '<h3 data-i18n="compare_card_title">' + escHtml(tr('compare_card_title')) + '</h3>' +
        '<div class="share-preview-img-wrap"><img class="share-preview-img" alt="' + escHtml(tr('compare_card_title')) + '"></div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-primary" data-share-dl><i data-lucide="download"></i><span data-i18n="compare_card_download">' + escHtml(tr('compare_card_download')) + '</span></button>' +
          '<button type="button" class="btn btn-secondary" data-share-copyimg><i data-lucide="copy"></i><span data-i18n="compare_card_copy">' + escHtml(tr('compare_card_copy')) + '</span></button>' +
          '<button type="button" class="btn btn-ghost" data-share-close><span data-i18n="rec_close">' + escHtml(tr('rec_close')) + '</span></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);

    var img = box.querySelector('.share-preview-img');
    img.src = canvas.toDataURL('image/png');

    function closePreview() {
      box.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 200);
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    box.querySelectorAll('[data-share-close]').forEach(function (b) {
      b.addEventListener('click', closePreview);
    });
    box.querySelector('[data-share-dl]').addEventListener('click', function () {
      download(canvas, opts.filename || 'moteful-compare.png');
    });
    box.querySelector('[data-share-copyimg]').addEventListener('click', function () {
      copyToClipboard(canvas).then(function () {
        toast(tr('compare_card_copied'), 'success');
      }, function () {
        toast(tr('compare_copy_fallback'), 'warning');
      });
    });

    box.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.MotefulCompareCard = {
    create: create,
    download: download,
    copyToClipboard: copyToClipboard,
    preview: preview
  };
})();
