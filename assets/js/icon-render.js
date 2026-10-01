/* Moteful 图标工具 · SVG → Canvas 栅格化（icon-render.js）
   零依赖、纯前端。导出 window.MotefulIconRender。
   安全约定：本模块只做 Blob→Image→Canvas 渲染，不解析、不执行任何 SVG 内容；
   调用方必须传入已净化（剥离 script / on* / 外部引用）的 SVG 字符串。
   渲染链：净化 SVG 字符串 → Blob → objectURL → Image(onload) → Canvas → toBlob */
(function () {
  'use strict';

  function svgToBlob(svgStr) {
    return new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  }

  function svgToImage(svgStr) {
    var url = URL.createObjectURL(svgToBlob(svgStr));
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }

  /* contain 绘制：目标 size×size 画布，图标等比缩放 + padding%（0~50）后居中 */
  function drawContain(ctx, img, size, padding) {
    var pad = Math.max(0, Math.min(50, padding == null ? 0 : padding)) / 100;
    var inner = size * (1 - pad * 2);
    var iw = img.width || 1, ih = img.height || 1;
    var k = Math.min(inner / iw, inner / ih);
    var w = iw * k, h = ih * k;
    var x = (size - w) / 2, y = (size - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function isTransparent(bg) {
    return !bg || bg === '' || bg === 't' || bg === 'transparent';
  }

  /* 核心：SVG → 目标尺寸 canvas。
     opts: { padding: 0~50（%）, bg: 十六进制(#RRGGBB) 或 't'（透明） } */
  function render(svgStr, size, opts) {
    opts = opts || {};
    var pad = opts.padding != null ? opts.padding : 0;
    var bg = opts.bg;
    return svgToImage(svgStr).then(function (img) {
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var ctx = c.getContext('2d');
      if (!isTransparent(bg)) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);
      }
      drawContain(ctx, img, size, pad);
      return c;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { b ? res(b) : rej(new Error('toBlob')); }, type, quality);
    });
  }

  function canvasToDataURL(canvas, type, quality) {
    return canvas.toDataURL(type || 'image/png', quality);
  }

  window.MotefulIconRender = {
    render: render,
    svgToBlob: svgToBlob,
    svgToImage: svgToImage,
    canvasToBlob: canvasToBlob,
    canvasToDataURL: canvasToDataURL
  };
})();
